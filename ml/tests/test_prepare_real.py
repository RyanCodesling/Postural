import copy
import json

import numpy as np
import pandas as pd
import pytest

from analysis.prepare_real import (FEATURE_DEFINITION, POSE_VERSION, ROOT, digest,
                                   prepare_session, validate_prepared_timing)
from analysis.real_frames import real_frames
from features.extract import extract_rep_features
from training.evaluation import EVALUATION_VERSION


def fixture(tmp_path):
    data = tmp_path / "captures"
    folder = data / "ex_001"
    folder.mkdir(parents=True)
    model = tmp_path / "model"
    model.mkdir()
    registry = json.loads((ROOT / "config/registry.json").read_text())
    definition = registry["exercises"]["ex_001"]
    bands = {c["name"]: c.get("bandsOverride", registry["compensationBands"].get(c["name"]))
             for c in definition["compensationMetrics"]}
    start = pd.Timestamp("2026-09-27T01:00:00Z")
    meta = {"sessionId": 1, "exerciseId": "ex_001", "measurementContext": {
        "exercise": {"id": "ex_001", "kind": "dynamic", "definition": definition,
                     "effectiveCompensationBands": bands},
        "versions": {"poseMetrics": POSE_VERSION, "exerciseConfig": "fixture-version"}}}
    rows = [{"frame_index": i, "set_index": 1, "elapsed_ms": i * 1000 / 15,
             "captured_at": (start + pd.Timedelta(seconds=i / 15)).isoformat(), "trace_kind": "upper_body_v4",
             "metrics": {"exerciseId": "ex_001", "metricAlgorithmVersion": POSE_VERSION,
                         "baselinePhase": "captured", "baselines": {"scapLeft": .3, "scapRight": .3},
                         "calibration": {"frozenCameraTiltDeg": 0},
                         "shoulderAbductionDeg": {"left": float(50 * (1 - np.cos(2 * np.pi * i / 30))), "right": 0},
                         "trunkLeanDeg": 1, "shoulderSymmetryDeg": 1,
                         "scapularElevationRaw": {"left": .29, "right": .29}}} for i in range(31)]
    reps = [{"rep_index": 1, "set_index": 1, "side": "left", "start_ts": start.isoformat(),
             "end_ts": (start + pd.Timedelta(seconds=2)).isoformat()}]
    (model / "ex_001_model.joblib").write_bytes(b"fixture-model-hash-only-no-inference")
    model_meta = {"exercise": "ex_001", "featureDefinition": FEATURE_DEFINITION,
                  "evaluationVersion": EVALUATION_VERSION, "modelSha256": digest(model / "ex_001_model.joblib")}
    (model / "ex_001_model.metadata.json").write_text(json.dumps(model_meta))
    (model / "ex_001_audit.json").write_text(json.dumps({"evaluationVersion": EVALUATION_VERSION,
        "sha256": {"config/registry.json": digest(ROOT / "config/registry.json")}}))
    def save():
        (folder / "session_1_meta.json").write_text(json.dumps(meta))
        for name, values in [("frames", rows), ("reps", reps)]:
            (folder / f"session_1_{name}.ndjson").write_text("\n".join(json.dumps(r) for r in values))
    save()
    return data, model, rows, reps, meta, save


def test_real_caller_resamples_15hz_to_30hz_without_shortening_time(tmp_path):
    data, model, _, _, _, _ = fixture(tmp_path)
    frames, features, report = prepare_session("ex_001", 1, data, model, "participant-a")
    assert len(frames) == 61 and len(features) == 1
    assert (frames.captured_at.iloc[-1] - frames.captured_at.iloc[0]).total_seconds() == 2
    assert frames.primary.max() == pytest.approx(100)
    assert frames.subject_id.eq("participant-a").all() and frames.label.isna().all()
    assert report["allRecordedRepsEligible"] and report["label"] is None
    assert report["repetitions"][0]["channelCoverage"]["primary"] == 1
    validate_prepared_timing(frames)
    frames.loc[4, "captured_at"] += pd.Timedelta(milliseconds=5)
    with pytest.raises(ValueError, match="30 Hz"):
        extract_rep_features(frames, "ex_001")


def test_raw_mapper_cannot_bypass_timing_gate(tmp_path):
    data, _, _, _, _, _ = fixture(tmp_path)
    raw = real_frames("ex_001", data_dir=data)
    with pytest.raises(ValueError, match="require"):
        extract_rep_features(raw[raw.rep_index.notna()], "ex_001")


@pytest.mark.parametrize("change", ["gap", "missing-channel", "baseline-change", "missing-calibration", "edge", "constant"])
def test_unusable_reps_are_excluded_with_coverage_not_compressed(tmp_path, change):
    data, model, rows, _, _, save = fixture(tmp_path)
    if change == "gap":
        del rows[8:15]
    elif change == "missing-channel":
        rows[10]["metrics"]["trunkLeanDeg"] = None
    elif change == "baseline-change":
        rows[10]["metrics"]["baselines"]["scapLeft"] = .4
    elif change == "missing-calibration":
        for r in rows:
            del r["metrics"]["calibration"]
    elif change == "edge":
        del rows[0]
    else:
        for r in rows:
            r["metrics"]["shoulderAbductionDeg"]["left"] = 0
    save()
    frames, features, report = prepare_session("ex_001", 1, data, model, "p")
    assert frames.empty and features.empty and not report["allRecordedRepsEligible"]
    decision = report["repetitions"][0]
    assert decision["targetSampleCount"] == 61 and decision["reason"]
    if change in {"gap", "missing-channel", "edge"}:
        assert decision["completeSampleCount"] < 61


@pytest.mark.parametrize("change", ["duplicate", "reversed", "protocol", "version", "context", "trace", "model"])
def test_incompatible_or_invalid_sources_fail_before_preparation(tmp_path, change):
    data, model, rows, _, meta, save = fixture(tmp_path)
    if change == "duplicate":
        rows[1]["captured_at"] = rows[0]["captured_at"]
    elif change == "reversed":
        rows.reverse()
    elif change == "protocol":
        meta["measurementContext"]["exercise"]["definition"]["primaryMetric"]["thresholds"]["targetROM"] = 42
    elif change == "version":
        rows[4]["metrics"]["metricAlgorithmVersion"] = "unknown"
    elif change == "context":
        del meta["measurementContext"]
    elif change == "trace":
        rows[4]["trace_kind"] = "future-version"
    else:
        (model / "ex_001_model.joblib").write_bytes(b"changed")
    save()
    with pytest.raises(ValueError):
        prepare_session("ex_001", 1, data, model, "p")


def test_rep_indices_reused_across_sets_keep_their_own_side(tmp_path):
    data, _, rows, reps, _, save = fixture(tmp_path)
    second = copy.deepcopy(rows)
    for r in second:
        r["set_index"] = 2
        r["captured_at"] = (pd.Timestamp(r["captured_at"]) + pd.Timedelta(seconds=4)).isoformat()
    rows.extend(second)
    rep = copy.deepcopy(reps[0])
    rep.update(set_index=2, side="right")
    rep["start_ts"] = (pd.Timestamp(rep["start_ts"]) + pd.Timedelta(seconds=4)).isoformat()
    rep["end_ts"] = (pd.Timestamp(rep["end_ts"]) + pd.Timedelta(seconds=4)).isoformat()
    reps.append(rep)
    save()
    mapped = real_frames("ex_001", data_dir=data)
    first = mapped[(mapped["set_index"] == 1) & mapped.rep_index.notna()]
    second = mapped[(mapped["set_index"] == 2) & mapped.rep_index.notna()]
    assert len(first) == len(second) == 31
    assert first.side.eq("left").all()
    assert second.side.eq("right").all()
