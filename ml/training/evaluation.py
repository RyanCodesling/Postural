"""Subject-separated evaluation helpers. No product inference or real-data fitting."""
from __future__ import annotations

import numpy as np
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold

EVALUATION_VERSION = "subject_calibration_v2"


def calibration_splits(y, groups):
    """Indices relative to the supplied training subset; never mix subjects."""
    y, groups = np.asarray(y), np.asarray(groups)
    if len(np.unique(groups)) < 3:
        raise ValueError("Calibration requires at least three training subjects")
    splits = list(GroupKFold(3).split(np.zeros(len(y)), y, groups))
    for tr, te in splits:
        if len(np.unique(y[tr])) != 2 or len(np.unique(y[te])) != 2:
            raise ValueError("Each subject-separated calibration fold needs both classes")
        if set(groups[tr]) & set(groups[te]):
            raise ValueError("Calibration subject overlap")
    return splits


def metrics(y, proba, *, probability=True):
    y, proba = np.asarray(y), np.asarray(proba)
    if (y.ndim != 1 or proba.shape != y.shape or not len(y)
            or not np.isin(y, [0, 1]).all() or not np.isfinite(proba).all()
            or ((proba < 0) | (proba > 1)).any()):
        raise ValueError("Expected binary labels and finite aligned scores in [0, 1]")
    both = len(np.unique(y)) == 2
    result = {"roc_auc": float(roc_auc_score(y, proba)) if both else None,
              "pr_auc": float(average_precision_score(y, proba)) if both else None,
              "brier": None, "accuracy": None, "sensitivity": None, "specificity": None}
    if probability:
        pred = proba >= .5
        result.update(brier=float(brier_score_loss(y, proba)),
                      accuracy=float(np.mean(pred == y)),
                      sensitivity=float(pred[y == 1].mean()) if (y == 1).any() else None,
                      specificity=float((~pred[y == 0]).mean()) if (y == 0).any() else None)
    return result


def cluster_bootstrap(y, scores, groups, *, draws=1000, seed=0):
    """Paired subject bootstrap of fixed OOF predictions, without model refitting.

    Intervals describe test-subject sampling uncertainty conditional on fitted
    folds, not uncertainty over training runs or generator specifications.
    """
    y, groups = np.asarray(y), np.asarray(groups)
    units = [np.flatnonzero(groups == g) for g in np.unique(groups)]
    if len(units) < 2 or draws < 1:
        raise ValueError("Bootstrap requires multiple subjects and positive draws")
    for values in scores.values():
        metrics(y, values, probability=False)
    rng = np.random.default_rng(seed)
    values = {name: [] for name in scores}
    delta = []
    for _ in range(draws):
        ix = np.concatenate([units[i] for i in rng.integers(0, len(units), len(units))])
        if len(np.unique(y[ix])) < 2:
            continue
        aucs = {name: float(roc_auc_score(y[ix], np.asarray(p)[ix])) for name, p in scores.items()}
        for name, auc in aucs.items():
            values[name].append(auc)
        delta.append(aucs["RandomForest (calibrated)"] - aucs["Rule-based score"])
    def interval(samples):
        return np.quantile(samples, [.025, .975]).tolist() if samples else None
    return {"method": "paired subject bootstrap of fixed OOF predictions; no refitting",
            "seed": seed, "requestedDraws": draws, "validDraws": len(delta),
            "rocAuc95": {name: interval(v) for name, v in values.items()},
            "rfMinusRuleAuc95": interval(delta)}
