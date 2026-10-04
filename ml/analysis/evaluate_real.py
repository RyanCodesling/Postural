"""Frozen offline session scoring. No training, tuning, or product writeback."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from importlib.metadata import version
import json
from pathlib import Path
import shutil

import numpy as np
import pandas as pd

from analysis.prepare_real import ROOT, digest
from analysis.session_input import prepare_session_features, timestamp
from baselines import rule_session_scores, rule_decision_function
from training.evaluation import metrics, cluster_bootstrap, EVALUATION_VERSION

VERSION = "offline_session_evaluator_v1"
CODE_FILES = ["analysis/evaluate_real.py", "analysis/session_input.py", "analysis/prepare_real.py",
              "analysis/real_frames.py", "features/extract.py", "baselines.py",
              "generators/registry.py", "training/evaluation.py", "config/registry.json"]
SUPPORTED = {"ex_001", "ex_005", "ex_006", "ex_007", "ex_008"}
KNOWN_TUNING_SESSIONS = set(range(168, 175)) | set(range(192, 197)) | {199}


def freeze_bundle(model_dir, exercises, out, coaching_configs=None):
    """Copy already-trained trusted local artifacts; never refit during freeze."""
    model_dir, out = Path(model_dir), Path(out)
    files, priors = {}, {}
    if not exercises or len(set(exercises)) != len(exercises):
        raise ValueError("Provide distinct supported exercises")
    for ex in exercises:
        if ex not in SUPPORTED:
            raise ValueError("Unsupported exercise (neck protocol remains gated)")
        metadata = json.loads((model_dir / f"{ex}_model.metadata.json").read_text())
        audit = json.loads((model_dir / f"{ex}_audit.json").read_text())
        if (metadata.get("evaluationVersion") != EVALUATION_VERSION or metadata.get("exercise") != ex
                or metadata.get("evaluation") != "synthetic-only" or audit.get("evaluation") != "synthetic-only"
                or audit.get("evaluationVersion") != EVALUATION_VERSION
                or audit.get("sha256", {}).get("config/registry.json") != digest(ROOT / "config/registry.json")):
            raise ValueError("Model/audit registry or evaluation contract mismatch")
        if digest(model_dir / f"{ex}_model.joblib") != metadata.get("modelSha256"):
            raise ValueError("Model hash mismatch")
        labels = [r["label"] for r in audit["rows"]]
        if not labels or not all(type(v) is int and v in (0, 1) for v in labels):
            raise ValueError("Missing synthetic training labels for prior baseline")
        priors[ex] = float(np.mean(labels))
        for suffix in ("model.joblib", "model.metadata.json", "audit.json"):
            name = f"{ex}_{suffix}"
            files[name] = digest(model_dir / name)
    coaching_configs = coaching_configs or {}
    if any(ex not in exercises or not isinstance(v, list) or not v
           or not all(isinstance(s, str) and s.strip() for s in v) for ex, v in coaching_configs.items()):
        raise ValueError("Coaching configs must map exercise IDs to nonempty version lists")
    bundle = {"version": VERSION, "frozenAt": datetime.now(timezone.utc).isoformat(),
              "files": files, "codeSha256": {p: digest(ROOT / p) for p in CODE_FILES},
              "trainingPrior": priors, "coachingConfigs": coaching_configs}
    out.mkdir(parents=True, exist_ok=False)
    for name in files:
        shutil.copyfile(model_dir / name, out / name)
    (out / "bundle.json").write_text(json.dumps(bundle, indent=2), encoding="utf-8")
    return bundle


def check_bundle(path):
    path = Path(path)
    bundle = json.loads((path / "bundle.json").read_text())
    if bundle.get("version") != VERSION:
        raise ValueError("Unsupported frozen bundle version")
    timestamp(bundle.get("frozenAt"))
    if bundle.get("codeSha256") != {p: digest(ROOT / p) for p in CODE_FILES}:
        raise ValueError("Evaluator/measurement code changed after freeze; create a new pre-collection freeze")
    expected_names = {f"{ex}_{suffix}" for ex in bundle.get("trainingPrior", {})
                      for suffix in ("model.joblib", "model.metadata.json", "audit.json")}
    if not expected_names or set(bundle["files"]) != expected_names or not set(bundle["trainingPrior"]) <= SUPPORTED:
        raise ValueError("Invalid bundle artifact inventory")
    for name, sha in bundle["files"].items():
        if digest(path / name) != sha:
            raise ValueError("Frozen artifact hash mismatch")
    return bundle


def check_manifest(manifest):
    purpose = manifest.get("purpose")
    if manifest.get("version") != VERSION or purpose not in {"fixture", "researcher_dry_run", "held_out_visit"}:
        raise ValueError("Manifest requires an explicit supported purpose/version")
    if any(not isinstance(manifest.get(p), str) or not manifest[p].strip() for p in ("bundle", "dataDir")):
        raise ValueError("Manifest requires bundle and dataDir paths")
    entries = manifest.get("sessions")
    if not isinstance(entries, list) or not entries:
        raise ValueError("Manifest has no sessions")
    seen = set()
    for e in entries:
        if type(e.get("sessionId")) is not int or e["sessionId"] < 1 or e.get("exercise") not in SUPPORTED:
            raise ValueError("Invalid session/exercise identity")
        key = e["sessionId"]
        if key in seen:
            raise ValueError("Duplicate session in manifest")
        seen.add(key)
        if not isinstance(e.get("participantId"), str) or not e["participantId"].strip():
            raise ValueError("Explicit participant pseudonym required")
        if e.get("cohort") not in {"baseline_no_feedback", "feedback_assisted"}:
            raise ValueError("Keep baseline and feedback-assisted cohorts explicit")
        label = e.get("label")
        if label is not None and (type(label) is not int or label not in (0, 1)):
            raise ValueError("Invalid intended-condition label")
        if purpose == "held_out_visit":
            if (label is None or e.get("labelSource") != "scripted_condition"
                    or e.get("untouchedParticipant") is not True or e.get("usedForTuning") is not False
                    or key in KNOWN_TUNING_SESSIONS):
                raise ValueError("Held-out visits require untouched participants and scripted labels; tuning sessions excluded")
    return purpose, entries


def check_participants(entries, data_dir):
    """Prevent splitting/merging recorded people across declared bootstrap IDs.

    Database IDs remain local and are not copied to the evaluation output.
    Missing input is reported per session; contradictory identity fails the run.
    """
    people, aliases = {}, {}
    for e in entries:
        path = data_dir / e["exercise"] / f"session_{e['sessionId']}_meta.json"
        if not path.exists():
            continue
        patient = json.loads(path.read_text()).get("patientId")
        if patient is None:
            raise ValueError("Held-out identity checks require exported patientId")
        alias = e["participantId"]
        if people.get(patient, alias) != alias or aliases.get(alias, patient) != patient:
            raise ValueError("Participant pseudonyms split or merge recorded people")
        people[patient], aliases[alias] = alias, patient


def evaluate_manifest(manifest_path, out):
    """Score trusted frozen local models; save exclusions rather than dropping rows."""
    manifest_path, out = Path(manifest_path), Path(out)
    manifest = json.loads(manifest_path.read_text())
    purpose, entries = check_manifest(manifest)
    bundle_dir = (manifest_path.parent / manifest["bundle"]).resolve()
    data_dir = (manifest_path.parent / manifest["dataDir"]).resolve()
    bundle = check_bundle(bundle_dir)
    if purpose == "held_out_visit":
        check_participants(entries, data_dir)
    # Check before expensive scoring; output cannot overwrite input or an older run.
    if out.exists():
        raise ValueError("Output folder already exists")
    rows, features, models = [], [], {}
    for e in entries:
        ex, sid = e["exercise"], e["sessionId"]
        inputs = [data_dir / ex / f"session_{sid}_{suffix}" for suffix in
                  ("meta.json", "frames.ndjson", "reps.ndjson", "sets.ndjson")]
        record = {**e, "status": "excluded", "reason": None,
                  "inputSha256": {p.name: digest(p) if p.exists() else None for p in inputs}}
        try:
            if ex not in bundle["trainingPrior"]:
                raise ValueError("Exercise has no model in frozen bundle")
            session, frames, prep, meta = prepare_session_features(ex, sid, data_dir, bundle_dir,
                                                                   e["participantId"], e.get("label"))
            context = meta["measurementContext"]
            coaching = context["versions"].get("coachingConfig")
            if not coaching:
                raise ValueError("Missing recorded coaching version")
            if purpose == "held_out_visit":
                if timestamp(meta["startedAt"]) <= timestamp(bundle["frozenAt"]):
                    raise ValueError("Recording predates model/evaluator freeze")
                if coaching not in bundle["coachingConfigs"].get(ex, []):
                    raise ValueError("Coaching configuration was not included in pre-visit freeze")
            metadata = json.loads((bundle_dir / f"{ex}_model.metadata.json").read_text())
            audit = json.loads((bundle_dir / f"{ex}_audit.json").read_text())
            if any(version(p) != audit.get("packages", {}).get(p) for p in ("scikit-learn", "numpy", "joblib")):
                raise ValueError("Frozen model runtime package mismatch")
            if ex not in models:
                import joblib
                models[ex] = joblib.load(bundle_dir / f"{ex}_model.joblib")
            model = models[ex]
            if list(model.classes_) != [0, 1] or list(model.feature_names_in_) != metadata["features"]:
                raise ValueError("Serialized model class/feature contract mismatch")
            p = float(model.predict_proba(session[metadata["features"]])[0, 1])
            if not np.isfinite(p) or not 0 <= p <= 1:
                raise ValueError("Model returned invalid probability")
            rule = float(rule_session_scores(frames, ex).rule_score.iloc[0])
            record.update(status="scored", probabilityCompensated=p, qualityProbabilityScore=100 * (1 - p),
                          ruleScore=rule, majorityProbability=bundle["trainingPrior"][ex],
                          coachingVersion=coaching, preparation=prep)
            features.append({"exercise": ex, **session.iloc[0].to_dict()})
        except (ValueError, KeyError, FileNotFoundError, TypeError) as exc:
            record["reason"] = str(exc)
        rows.append(record)
    scored = [r for r in rows if r["status"] == "scored"]
    groups = {}
    # No empirical performance from tuning plumbing or synthetic fixtures.
    if purpose == "held_out_visit":
        for key in sorted({(r["exercise"], r["cohort"], r["coachingVersion"]) for r in scored}):
            cohort = [r for r in scored if (r["exercise"], r["cohort"], r["coachingVersion"]) == key]
            y = np.array([r["label"] for r in cohort])
            rf = np.array([r["probabilityCompensated"] for r in cohort])
            rule = rule_decision_function(np.array([r["ruleScore"] for r in cohort]))
            prior = np.array([r["majorityProbability"] for r in cohort])
            participants = np.array([r["participantId"] for r in cohort])
            result = {"sessions": len(cohort), "participants": len(set(participants)),
                      "classifier": metrics(y, rf), "rule": metrics(y, rule, probability=False),
                      "majority": metrics(y, prior)}
            if len(set(participants)) >= 2 and len(set(y)) == 2:
                result["uncertainty"] = cluster_bootstrap(y, {"RandomForest (calibrated)": rf,
                    "Rule-based score": rule}, participants)
                result["uncertainty"]["method"] = "paired participant bootstrap of frozen held-out predictions; no refitting"
            groups["/".join(key)] = result
    report = {"version": VERSION, "purpose": purpose, "manifestSha256": digest(manifest_path),
              "bundleSha256": digest(bundle_dir / "bundle.json"), "frozenAt": bundle["frozenAt"],
              "included": len(scored), "excluded": len(rows) - len(scored), "sessions": rows,
              "performance": groups if purpose == "held_out_visit" else None,
              "interpretation": "Intended-condition classification; no clinical validity. Dry-run/fixture scores are plumbing only."}
    out.mkdir(parents=True, exist_ok=False)
    (out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    pd.DataFrame([{k: v for k, v in r.items() if k not in {"preparation", "inputSha256"}} for r in rows]).to_csv(out / "predictions.csv", index=False)
    pd.DataFrame(features).to_csv(out / "session_features.csv", index=False)
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    commands = p.add_subparsers(dest="command", required=True)
    freeze = commands.add_parser("freeze")
    freeze.add_argument("--model-dir", required=True, type=Path)
    freeze.add_argument("--exercises", required=True, nargs="+")
    freeze.add_argument("--coaching-configs", type=Path)
    freeze.add_argument("--out", required=True, type=Path)
    score = commands.add_parser("score")
    score.add_argument("--manifest", required=True, type=Path)
    score.add_argument("--out", required=True, type=Path)
    a = p.parse_args()
    try:
        if a.command == "freeze":
            configs = json.loads(a.coaching_configs.read_text()) if a.coaching_configs else None
            result = freeze_bundle(a.model_dir, a.exercises, a.out, configs)
            print(f"Frozen {len(result['trainingPrior'])} models at {result['frozenAt']}")
        else:
            r = evaluate_manifest(a.manifest, a.out)
            print(f"{r['purpose']}: {r['included']} scored, {r['excluded']} excluded; {a.out / 'report.json'}")
    except (ValueError, FileNotFoundError) as exc:
        p.exit(2, f"Offline evaluation refused: {exc}\n")


if __name__ == "__main__":
    main()
