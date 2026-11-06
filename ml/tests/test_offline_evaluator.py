"""Transport/model fixtures exercise the real offline callers; no human data."""
import copy
from importlib.metadata import version
import json

import joblib
import numpy as np
import pandas as pd
import pytest
from sklearn.linear_model import LogisticRegression

from analysis.evaluate_real import (VERSION, check_bundle, check_manifest,
                                    evaluate_manifest, freeze_bundle)
from analysis.prepare_real import ROOT, digest, prepare_session
from analysis.session_input import prepare_session_features, session_contract
from features.extract import aggregate_session_features, feature_columns
from tests.test_prepare_real import fixture


def capture(tmp_path, exercise="ex_001"):
    data, model, rows, reps, meta, _ = fixture(tmp_path)
    folder = data / exercise
    folder.mkdir(exist_ok=True)
    registry = json.loads((ROOT / "config/registry.json").read_text())
    definition = registry["exercises"][exercise]
    context = meta["measurementContext"]
    context["exercise"] = {"id": exercise, "kind": definition["kind"], "definition": definition,
        "effectiveCompensationBands": {c["name"]: c.get("bandsOverride", registry["compensationBands"].get(c["name"]))
                                       for c in definition["compensationMetrics"]}}
    context["versions"]["coachingConfig"] = "fixture-coaching"
    context["prescription"] = {"exerciseId": exercise, "sets": 1, "reps": 2,
                               "holdSeconds": 2, "prescribedSide": "both"}
    start, end = reps[0]["start_ts"], reps[0]["end_ts"]
    meta.update(exerciseId=exercise, patientId=123, startedAt=start, endedAt=end, endReason="user")
    sets = [{"set_index": 1, "exercise_kind": definition["kind"], "target_reps": 2,
             "target_hold_ms": 2000, "left_reps": 1, "right_reps": 1,
             "terminated_by": "user", "start_ts": start, "end_ts": end}]
    if exercise == "ex_006":
        reps.clear()
        sets[0].update(left_reps=0, right_reps=0, target_reps=0)
        for r in rows:
            r["metrics"].update(exerciseId=exercise, shoulderHorizAbdDeg={"left": 90, "right": 90})
        md = json.loads((model / "ex_001_model.metadata.json").read_text())
        md.update(exercise=exercise, featureDefinition="hold-v1")
        (model / f"{exercise}_model.joblib").write_bytes((model / "ex_001_model.joblib").read_bytes())
        (model / f"{exercise}_model.metadata.json").write_text(json.dumps(md))
        (model / f"{exercise}_audit.json").write_bytes((model / "ex_001_audit.json").read_bytes())
    else:
        reps[0]["target_rom"] = 90
        reps.append({**reps[0], "rep_index": 2, "side": "right"})
        for r in rows:
            r["metrics"]["shoulderAbductionDeg"]["right"] = r["metrics"]["shoulderAbductionDeg"]["left"]

    def save():
        meta.update(frameCount=len(rows), repCount=len(reps), setCount=len(sets))
        (folder / "session_1_meta.json").write_text(json.dumps(meta))
        for name, values in [("frames", rows), ("reps", reps), ("sets", sets)]:
            (folder / f"session_1_{name}.ndjson").write_text("\n".join(json.dumps(r) for r in values))
    save()
    return data, model, rows, reps, sets, meta, save


def test_model(data, model, exercise):
    """Tiny fixture classifier, never a reported benchmark/trained artifact."""
    _, targets = session_contract(exercise, 1, data)
    frames, reps, _ = prepare_session(exercise, 1, data, model, "person")
    session = aggregate_session_features(reps, targets, pd.DataFrame(), exercise, frames=frames)
    cols = feature_columns(session)
    x = pd.concat([session[cols] - 1, session[cols] + 1], ignore_index=True)
    classifier = LogisticRegression(max_iter=1000).fit(x, [0, 1])
    joblib.dump(classifier, model / f"{exercise}_model.joblib")
    mp = model / f"{exercise}_model.metadata.json"
    md = json.loads(mp.read_text())
    md.update(features=cols, classes=[0, 1], evaluation="synthetic-only",
              modelSha256=digest(model / f"{exercise}_model.joblib"))
    mp.write_text(json.dumps(md))
    ap = model / f"{exercise}_audit.json"
    audit = json.loads(ap.read_text())
    audit.update(evaluation="synthetic-only", rows=[{"label": 0}, {"label": 1}],
                 packages={p: version(p) for p in ("numpy", "scikit-learn", "joblib")})
    ap.write_text(json.dumps(audit))


test_model.__test__ = False


def manifest(tmp_path, model, exercise="ex_001", purpose="fixture"):
    freeze_bundle(model, [exercise], tmp_path / "bundle", {exercise: ["fixture-coaching"]})
    m = {"version": VERSION, "purpose": purpose, "bundle": "bundle", "dataDir": "captures",
         "sessions": [{"sessionId": 1, "exercise": exercise, "participantId": "person-a",
                       "cohort": "baseline_no_feedback"}]}
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(m))
    return m, path


@pytest.mark.parametrize("exercise", ["ex_001", "ex_006"])
def test_complete_caller_unknown_label_and_frozen_inference(tmp_path, exercise):
    data, model, *_ = capture(tmp_path, exercise)
    test_model(data, model, exercise)
    session, frames, prep, _ = prepare_session_features(exercise, 1, data, model, "person-a")
    assert prep["sessionInferenceReady"] and prep["prescriptionChecked"]
    assert session.subject_id.iloc[0] == "person-a" and session.label.isna().all()
    if exercise == "ex_001":
        assert session.completion_rate.iloc[0] == .5  # Both saved counts under prescription.
    else:
        assert len(frames) == 120  # 60 samples per side, no double-counted endpoint.
        assert session.in_band_ms_mean.iloc[0] == pytest.approx(2000)
        assert session.completion_rate.iloc[0] == session.paired_in_band_frac.iloc[0] == 1
    m, path = manifest(tmp_path, model, exercise)
    report = evaluate_manifest(path, tmp_path / "result")
    assert report["included"] == 1 and report["excluded"] == 0, report
    assert report["performance"] is None
    first = report["sessions"][0]
    assert len(first["inputSha256"]) == 4 and all(first["inputSha256"].values())
    assert 0 <= first["probabilityCompensated"] <= 1
    assert first["majorityProbability"] == .5
    assert first["qualityProbabilityScore"] == 100 * (1 - first["probabilityCompensated"])
    # Declaring a condition does not change model inputs or predictions.
    m["sessions"][0]["label"] = 1
    path.write_text(json.dumps(m))
    again = evaluate_manifest(path, tmp_path / "labelled")
    assert again["sessions"][0]["probabilityCompensated"] == first["probabilityCompensated"]
    with pytest.raises(ValueError, match="already exists"):
        evaluate_manifest(path, tmp_path / "result")


def test_one_arm_sag_keeps_separate_achievement_and_simultaneous_time(tmp_path):
    data, model, rows, _, _, _, save = capture(tmp_path, "ex_006")
    test_model(data, model, "ex_006")
    for r in rows:
        r["metrics"]["shoulderHorizAbdDeg"]["right"] = 60
    save()
    s, _, _, _ = prepare_session_features("ex_006", 1, data, model, "p")
    assert s.completion_rate.iloc[0] == .5
    assert s.paired_in_band_frac.iloc[0] == 0
    assert s.hold_asym.iloc[0] == 1


@pytest.mark.parametrize("change", ["missing-set", "missing-rep", "target", "bounds", "gap", "single-side", "overlap", "identity"])
def test_whole_session_exclusions_are_reported(tmp_path, change):
    data, model, rows, reps, sets, meta, save = capture(tmp_path)
    test_model(data, model, "ex_001")
    _, path = manifest(tmp_path, model)
    if change == "missing-set":
        meta["measurementContext"]["prescription"]["sets"] = 2
    elif change == "missing-rep":
        reps.pop()
    elif change == "target":
        sets[0]["target_reps"] = 3
    elif change == "bounds":
        reps[0]["end_ts"] = "2026-09-27T01:00:03Z"
    elif change == "gap":
        del rows[8:15]
    elif change == "single-side":
        reps.pop()
        sets[0]["right_reps"] = 0
    elif change == "overlap":
        reps.append({**reps[0], "rep_index": 3})
        sets[0]["left_reps"] = 2
    else:
        meta["sessionId"] = 9
    save()
    report = evaluate_manifest(path, tmp_path / "excluded")
    assert report["excluded"] == 1 and report["included"] == 0
    assert report["sessions"][0]["reason"]
    assert "probabilityCompensated" not in report["sessions"][0]


def test_hold_gaps_and_export_count_disagreement_fail(tmp_path):
    data, model, rows, _, _, meta, save = capture(tmp_path, "ex_006")
    test_model(data, model, "ex_006")
    del rows[8:15]
    save()
    with pytest.raises(ValueError, match="Whole session"):
        prepare_session_features("ex_006", 1, data, model, "p")
    meta["frameCount"] += 1
    (data / "ex_006/session_1_meta.json").write_text(json.dumps(meta))
    with pytest.raises(ValueError, match="row counts"):
        session_contract("ex_006", 1, data)


@pytest.mark.parametrize("change", ["model", "code", "runtime", "features"])
def test_frozen_contract_refuses_drift(tmp_path, change):
    data, model, *_ = capture(tmp_path)
    test_model(data, model, "ex_001")
    if change in {"runtime", "features"}:
        name = "ex_001_audit.json" if change == "runtime" else "ex_001_model.metadata.json"
        p = model / name
        value = json.loads(p.read_text())
        if change == "runtime":
            value["packages"]["numpy"] = "wrong"
        else:
            value["features"].reverse()
        p.write_text(json.dumps(value))
    _, path = manifest(tmp_path, model)
    if change == "model":
        (tmp_path / "bundle/ex_001_model.joblib").write_bytes(b"tampered")
        with pytest.raises(ValueError, match="hash mismatch"):
            check_bundle(tmp_path / "bundle")
    elif change == "code":
        p = tmp_path / "bundle/bundle.json"
        b = json.loads(p.read_text())
        b["codeSha256"]["analysis/session_input.py"] = "changed"
        p.write_text(json.dumps(b))
        with pytest.raises(ValueError, match="changed after freeze"):
            check_bundle(tmp_path / "bundle")
    else:
        r = evaluate_manifest(path, tmp_path / "output")
        assert r["excluded"] == 1
        assert ("runtime" if change == "runtime" else "feature names/order") in r["sessions"][0]["reason"]


@pytest.mark.parametrize("change", ["label", "tuning", "neck", "duplicate", "pseudonym", "source", "untouched"])
def test_held_out_declarations_fail_closed(tmp_path, change):
    m = {"version": VERSION, "purpose": "held_out_visit", "bundle": "bundle", "dataDir": "captures",
         "sessions": [{"sessionId": 1, "exercise": "ex_001", "participantId": "p", "label": 0,
                       "cohort": "baseline_no_feedback", "labelSource": "scripted_condition",
                       "untouchedParticipant": True, "usedForTuning": False}]}
    e = m["sessions"][0]
    if change == "label": e.pop("label")
    elif change == "tuning": e["sessionId"] = 192
    elif change == "neck": e["exercise"] = "ex_004"
    elif change == "duplicate": m["sessions"].append(copy.deepcopy(e))
    elif change == "pseudonym": e["participantId"] = ""
    elif change == "source": e["labelSource"] = "coaching_cue"
    else: e["untouchedParticipant"] = False
    with pytest.raises(ValueError):
        check_manifest(m)


def test_held_out_time_coaching_identity_and_cohort_separation(tmp_path):
    data, model, _, _, _, meta, save = capture(tmp_path)
    test_model(data, model, "ex_001")
    m, path = manifest(tmp_path, model, purpose="held_out_visit")
    m["sessions"][0].update(label=0, labelSource="scripted_condition", untouchedParticipant=True, usedForTuning=False)
    path.write_text(json.dumps(m))
    r = evaluate_manifest(path, tmp_path / "pre-freeze")
    assert "predates" in r["sessions"][0]["reason"]
    # Artificial fixture freeze time ONLY, to test the post-freeze code path.
    bp = tmp_path / "bundle/bundle.json"
    b = json.loads(bp.read_text())
    b["frozenAt"] = "2020-01-01T00:00:00Z"
    b["coachingConfigs"] = {}
    bp.write_text(json.dumps(b))
    r = evaluate_manifest(path, tmp_path / "unfrozen-coaching")
    assert "Coaching configuration" in r["sessions"][0]["reason"]
    b["coachingConfigs"] = {"ex_001": ["fixture-coaching"]}
    bp.write_text(json.dumps(b))
    folder = data / "ex_001"
    for kind in ("frames.ndjson", "reps.ndjson", "sets.ndjson"):
        (folder / f"session_2_{kind}").write_bytes((folder / f"session_1_{kind}").read_bytes())
    meta2 = {**meta, "sessionId": 2}
    (folder / "session_2_meta.json").write_text(json.dumps(meta2))
    m["sessions"].append({**m["sessions"][0], "sessionId": 2, "participantId": "different"})
    path.write_text(json.dumps(m))
    with pytest.raises(ValueError, match="split or merge"):
        evaluate_manifest(path, tmp_path / "bad-identity")
    m["sessions"][1].update(participantId="person-a", cohort="feedback_assisted", label=1)
    path.write_text(json.dumps(m))
    r = evaluate_manifest(path, tmp_path / "cohorts")
    assert r["included"] == 2, r
    assert len(r["performance"]) == 2
    for group in r["performance"].values():
        assert group["sessions"] == group["participants"] == 1
        assert group["classifier"]["roc_auc"] is None
        assert "uncertainty" not in group
    meta2["patientId"] = 456
    (folder / "session_2_meta.json").write_text(json.dumps(meta2))
    m["sessions"][1].update(participantId="person-b", cohort="baseline_no_feedback")
    path.write_text(json.dumps(m))
    r = evaluate_manifest(path, tmp_path / "uncertainty")
    group, = r["performance"].values()
    assert group["participants"] == 2
    assert 0 < group["uncertainty"]["validDraws"] <= 1000
    assert "frozen held-out" in group["uncertainty"]["method"]
