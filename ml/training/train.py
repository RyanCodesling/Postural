"""
Train, calibrate, and evaluate the form-quality model for one exercise.

Pipeline:
  session features -> leave-one-subject-out CV -> RandomForest (calibrated) +
  XGBoost (secondary) -> compare against majority-class and the rule-based score.

The headline question is whether the learned model beats the rule it ships with
(ROC-AUC, PR-AUC), while staying well calibrated (the calibrated probability is
the 0-100 quality score). A separability check first confirms the task is not a
disguised single-threshold rule (no single feature should already solve it).

Exercise-agnostic: feature columns are derived from the session-feature table at
runtime, so it works for any framing without code changes.

Run from ml/ (after generate + extract; see run.py):
  python -m training.train --exercise ex_004
"""
from __future__ import annotations

import argparse
import json
import hashlib
import platform
from importlib.metadata import version
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import roc_auc_score, roc_curve
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.pipeline import Pipeline

from baselines import majority_class_proba, rule_decision_function, rule_session_scores
from features.extract import feature_columns
from training.evaluation import EVALUATION_VERSION, calibration_splits, cluster_bootstrap, metrics

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
OUT_DIR = Path(__file__).resolve().parent / "out" / "features-v2" / EVALUATION_VERSION
SEED = 0

try:
    from xgboost import XGBClassifier
    HAS_XGB = True
except Exception:  # pragma: no cover - optional dependency
    HAS_XGB = False


def _rf_pipeline() -> Pipeline:
    return Pipeline([
        ("impute", SimpleImputer(strategy="median")),
        ("rf", RandomForestClassifier(
            n_estimators=300, min_samples_leaf=2,
            class_weight="balanced", random_state=SEED, n_jobs=-1)),
    ])


def univariate_separability(X: pd.DataFrame, y: np.ndarray,
                            feat_cols: list[str]) -> pd.DataFrame:
    rows = []
    for col in feat_cols:
        v = X[col].to_numpy(dtype=float)
        mask = ~np.isnan(v)
        if mask.sum() < 10 or len(np.unique(v[mask])) < 2 or len(np.unique(y[mask])) < 2:
            auc = 0.5
        else:
            auc = roc_auc_score(y[mask], v[mask])
        rows.append({"feature": col, "auc": max(auc, 1.0 - auc)})
    return pd.DataFrame(rows).sort_values("auc", ascending=False).reset_index(drop=True)


def loso_oof(make_estimator, X: pd.DataFrame, y: np.ndarray, groups: np.ndarray,
             feat_cols: list[str], calibrate: bool, audit: list | None = None) -> np.ndarray:
    """Out-of-fold P(compensated) from leave-one-subject-out CV."""
    oof = np.full(len(y), np.nan)
    Xv = X[feat_cols]
    for tr, te in LeaveOneGroupOut().split(Xv, y, groups):
        est = make_estimator()
        inner = calibration_splits(y[tr], groups[tr]) if calibrate else []
        if calibrate:
            est = CalibratedClassifierCV(est, method="sigmoid", cv=inner, ensemble=True)
        if audit is not None:
            audit.append({"trainRows": tr.tolist(), "testRows": te.tolist(),
                          "calibration": [{"trainRows": tr[a].tolist(),
                                           "testRows": tr[b].tolist()} for a, b in inner]})
        est.fit(Xv.iloc[tr], y[tr])
        oof[te] = est.predict_proba(Xv.iloc[te])[:, 1]
    return oof


def loso_majority(y: np.ndarray, groups: np.ndarray) -> np.ndarray:
    oof = np.full(len(y), np.nan)
    for tr, te in LeaveOneGroupOut().split(np.zeros(len(y)), y, groups):
        oof[te] = majority_class_proba(y[tr], len(te))
    return oof


def main(exercise: str | None = None) -> None:
    if exercise is None:
        ap = argparse.ArgumentParser(description="Train/evaluate the form-quality model.")
        ap.add_argument("--exercise", default="ex_001")
        exercise = ap.parse_args().exercise
    ex = exercise

    from features.extract import FEATURE_DIR, FEATURE_DEFINITION, require_current_feature_definition
    from generators.registry import get_exercise
    sess = pd.read_parquet(FEATURE_DIR / f"{ex}_session_features.parquet")
    if get_exercise(ex).framing != "isometric":
        require_current_feature_definition(sess)
    frames = pd.read_parquet(DATA_DIR / f"{ex}_frames.parquet")

    # Derive model feature columns BEFORE merging the rule score, so the rule
    # baseline can never leak in as a model feature.
    feat_cols = feature_columns(sess)
    rule = rule_session_scores(frames, ex)
    sess = sess.merge(rule, on="session_id", how="left", validate="one_to_one")

    y = sess["label"].to_numpy(dtype=int)
    groups = sess["subject_id"].to_numpy()
    n_subj = len(np.unique(groups))
    print(f"{ex}: {len(sess)} sessions / {n_subj} subjects / "
          f"{y.sum()} compensated / {len(feat_cols)} features\n")

    # --- Separability check -------------------------------------------------
    sep = univariate_separability(sess, y, feat_cols)
    print("Top single-feature AUCs (none should be ~1.0 -> not a disguised rule):")
    print(sep.head(8).to_string(index=False))
    top1 = sep["auc"].iloc[0]
    print(f"  best single feature AUC = {top1:.3f}"
          f"{'  [WARN: near-perfect single feature]' if top1 > 0.95 else '  [ok]'}\n")

    # --- Models + baselines (out-of-fold, leave-one-subject-out) ------------
    results: dict[str, dict] = {}
    audit: list = []
    rf_oof = loso_oof(_rf_pipeline, sess, y, groups, feat_cols, calibrate=True, audit=audit)
    predictions = {"RandomForest (calibrated)": rf_oof}
    results["RandomForest (calibrated)"] = metrics(y, rf_oof)

    if HAS_XGB:
        def make_xgb():
            return XGBClassifier(
                n_estimators=300, max_depth=3, learning_rate=0.05,
                subsample=0.9, colsample_bytree=0.9, eval_metric="logloss",
                random_state=SEED, n_jobs=-1)
        xgb_oof = loso_oof(make_xgb, sess, y, groups, feat_cols, calibrate=False)
        results["XGBoost"] = metrics(y, xgb_oof)
        predictions["XGBoost"] = xgb_oof

    predictions["Rule-based score"] = rule_decision_function(sess["rule_score"].to_numpy())
    results["Rule-based score"] = metrics(y, predictions["Rule-based score"], probability=False)
    prior_oof = loso_majority(y, groups)
    results["Majority class"] = metrics(y, prior_oof)
    # Different training priors across LOSO folds are not a meaningful ranking
    # predictor. Report probability/threshold performance, without pooled AUC.
    results["Majority class"].update(roc_auc=None, pr_auc=None)
    uncertainty = cluster_bootstrap(y, predictions, groups)

    table = pd.DataFrame(results).T
    print("Leave-one-subject-out performance:")
    print(table.round(3).to_string(), "\n")

    rf_auc = results["RandomForest (calibrated)"]["roc_auc"]
    rule_auc = results["Rule-based score"]["roc_auc"]
    ci = uncertainty["rfMinusRuleAuc95"]
    verdict = ("HIGHER (conditional interval above zero)" if ci and ci[0] > 0
               else "LOWER (conditional interval below zero)" if ci and ci[1] < 0
               else "INCONCLUSIVE")
    print(f"RandomForest {verdict} the rule baseline on ROC-AUC "
          f"({rf_auc:.3f} vs {rule_auc:.3f}).\n")

    # --- Feature importance (full-data RF) ----------------------------------
    full = _rf_pipeline().fit(sess[feat_cols], y)
    importances = pd.DataFrame({
        "feature": feat_cols,
        "importance": full.named_steps["rf"].feature_importances_,
    }).sort_values("importance", ascending=False).reset_index(drop=True)
    print("Top feature importances:")
    print(importances.head(8).to_string(index=False), "\n")

    # --- Persist final calibrated model + artifacts -------------------------
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    final_splits = calibration_splits(y, groups)
    final = CalibratedClassifierCV(_rf_pipeline(), method="sigmoid", cv=final_splits,
                                   ensemble=True).fit(sess[feat_cols], y)
    import joblib
    joblib.dump(final, OUT_DIR / f"{ex}_model.joblib")
    (OUT_DIR / f"{ex}_model.metadata.json").write_text(json.dumps({
        "featureDefinition": FEATURE_DEFINITION if get_exercise(ex).framing != "isometric" else "hold-v1",
        "features": feat_cols,
        "evaluation": "synthetic-only",
        "evaluationVersion": EVALUATION_VERSION,
        "exercise": ex,
        "classes": final.classes_.tolist(),
        "probabilityMeaning": "P(compensated); quality interpretation = 100 * (1 - p)",
        "modelSha256": hashlib.sha256((OUT_DIR / f"{ex}_model.joblib").read_bytes()).hexdigest(),
    }, indent=2), encoding="utf-8")

    _plots(y, rf_oof, ex)
    _write_report(ex, sess, sep, table, importances, verdict, rf_auc, rule_auc)
    _write_audit(ex, sess, predictions, prior_oof, audit, final_splits, uncertainty, results)
    print(f"Artifacts written to {OUT_DIR}")


def _write_audit(ex, sess, predictions, prior, audit, final_splits, uncertainty, results):
    from features.extract import FEATURE_DIR
    oof = sess[["session_id", "subject_id", "label"]].copy()
    for name, values in {**predictions, "Majority class": prior}.items():
        oof[name] = values
    oof.to_csv(OUT_DIR / f"{ex}_oof.csv", index=False)
    root = Path(__file__).resolve().parents[1]
    inputs = [FEATURE_DIR / f"{ex}_session_features.parquet", DATA_DIR / f"{ex}_frames.parquet",
              root / "config/registry.json", root / "features/extract.py",
              root / "baselines.py", Path(__file__), root / "training/evaluation.py"]
    provenance = {
        "evaluationVersion": EVALUATION_VERSION, "seed": SEED, "evaluation": "synthetic-only",
        "rows": oof[["session_id", "subject_id", "label"]].to_dict("records"),
        "outerFolds": audit,
        "finalCalibration": [{"trainRows": a.tolist(), "testRows": b.tolist()} for a, b in final_splits],
        "sha256": {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs},
        "python": platform.python_version(),
        "packages": {p: version(p) for p in ["numpy", "pandas", "scipy", "scikit-learn", "joblib"]
                     + (["xgboost"] if HAS_XGB else [])},
        "uncertainty": uncertainty,
    }
    for suffix, value in [("audit", provenance), ("metrics", results)]:
        (OUT_DIR / f"{ex}_{suffix}.json").write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")


def _plots(y: np.ndarray, rf_oof: np.ndarray, ex: str) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.5))
    fpr, tpr, _ = roc_curve(y, rf_oof)
    axes[0].plot(fpr, tpr, label=f"RF (AUC={roc_auc_score(y, rf_oof):.3f})")
    axes[0].plot([0, 1], [0, 1], "--", color="grey")
    axes[0].set(xlabel="False positive rate", ylabel="True positive rate",
                title="ROC (leave-one-subject-out)")
    axes[0].legend(loc="lower right")

    frac_pos, mean_pred = calibration_curve(y, rf_oof, n_bins=10, strategy="quantile")
    axes[1].plot(mean_pred, frac_pos, "o-", label="RF (calibrated)")
    axes[1].plot([0, 1], [0, 1], "--", color="grey")
    axes[1].set(xlabel="Mean predicted P(compensated)", ylabel="Observed fraction",
                title="Calibration")
    axes[1].legend(loc="upper left")
    fig.tight_layout()
    fig.savefig(OUT_DIR / f"{ex}_eval.png", dpi=120)
    plt.close(fig)


def _write_report(ex, sess, sep, table, importances, verdict, rf_auc, rule_auc) -> None:
    lines = [
        f"# {ex} form-quality model -- results",
        "",
        f"- Sessions: {len(sess)} ({int(sess['label'].sum())} compensated) "
        f"from {sess['subject_id'].nunique()} subjects",
        "- Evaluation: leave-one-subject-out cross-validation",
        "- Calibration: three subject-disjoint folds inside every training split and final fit.",
        f"- Verdict: RandomForest **{verdict}** the rule baseline on ROC-AUC "
        f"({rf_auc:.3f} vs {rule_auc:.3f})",
        "- Verdict uses a paired subject-bootstrap 95% interval on fixed OOF predictions; no refitting.",
        "  It does not measure training-run uncertainty or synthetic-to-real transfer.",
        "- Rule scores are ranking scores, not calibrated probabilities: Brier/threshold metrics are unavailable.",
        "- Majority uses each training fold's prior; pooled ranking metrics are unavailable.",
        "- Classifier sensitivity/specificity use a fixed 0.5 threshold, not a deployment-approved cutoff.",
        "- Exact intervals, row/fold membership, input hashes and versions are in the audit JSON; predictions in OOF CSV.",
        "",
        "## Performance (out-of-fold)",
        "",
        "```",
        table.round(3).to_string(),
        "```",
        "",
        "## Single-feature separability (sanity: none ~1.0)",
        "",
        "```",
        sep.head(10).to_string(index=False),
        "```",
        "",
        "## Feature importance (full-data RandomForest)",
        "",
        "```",
        importances.to_string(index=False),
        "```",
        "",
        "The model is trained on synthetic data; results are a feasibility "
        "demonstration, not clinical validation.",
        "",
    ]
    (OUT_DIR / f"{ex}_report.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
