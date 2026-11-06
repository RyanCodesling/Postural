"""Fail-closed offline repetition/arm-hold preparation. No fitting or inference."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from analysis.real_frames import load_session_files, real_frames, _read_ndjson
from features.extract import FEATURE_DEFINITION, REP_GROUP_KEYS, extract_rep_features
from generators.registry import get_exercise
from training.evaluation import EVALUATION_VERSION

PREPARATION_VERSION = "real_trace_30hz_v2"
POSE_VERSION = "pose_metrics_v2_frozen_neutral_tilt"
MAX_GAP_MS = 200.0  # Same bounded linear interpolation as browser rep quality.
ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def measurement_definition(definition):
    result = copy.deepcopy(definition)
    for metric in result.get("compensationMetrics", []):
        metric.pop("cue", None)
    return result


def calibration_available(key):
    saved = json.loads(key)
    tilt = saved.get("tilt")
    return (type(tilt) in (int, float) and np.isfinite(tilt)
            and isinstance(saved.get("baselines"), dict) and bool(saved["baselines"]))


def check_compatibility(exercise, meta, rows, model_meta, audit, registry):
    if model_meta.get("exercise") != exercise or meta.get("exerciseId") != exercise:
        raise ValueError("Exercise identity mismatch")
    if exercise == "ex_004":
        raise ValueError("Neck protocol migration awaits its counting gate")
    feature_definition = "hold-v1" if exercise == "ex_006" else FEATURE_DEFINITION
    if model_meta.get("featureDefinition") != feature_definition:
        raise ValueError("Unsupported model feature definition")
    if model_meta.get("evaluationVersion") != EVALUATION_VERSION or audit.get("evaluationVersion") != EVALUATION_VERSION:
        raise ValueError("Model/evaluation provenance mismatch")
    context = meta.get("measurementContext") or {}
    saved = context.get("exercise") or {}
    expected = registry["exercises"][exercise]
    if saved.get("id") != exercise or measurement_definition(saved.get("definition") or {}) != measurement_definition(expected):
        raise ValueError("Missing or incompatible recorded exercise protocol; re-export original context")
    if saved.get("kind") != expected["kind"] or (expected["kind"] != "dynamic" and exercise != "ex_006"):
        raise ValueError("Unsupported exercise kind")
    versions = context.get("versions") or {}
    if versions.get("poseMetrics") != POSE_VERSION or not versions.get("exerciseConfig"):
        raise ValueError("Missing or unsupported measurement version")
    bands = {c["name"]: c.get("bandsOverride", registry["compensationBands"].get(c["name"]))
             for c in expected["compensationMetrics"]}
    if saved.get("effectiveCompensationBands") != bands:
        raise ValueError("Recorded compensation bands do not match model registry")
    for row in rows:
        m = row.get("metrics") or {}
        if row.get("trace_kind") not in {"upper_body_v3", "upper_body_v4"}:
            raise ValueError("Unsupported or unversioned trace kind")
        if m.get("exerciseId") != exercise or m.get("metricAlgorithmVersion") != POSE_VERSION:
            raise ValueError("Trace measurement version/exercise mismatch")


def validate_prepared_timing(frames):
    if ("preparation_version" not in frames or frames.empty
            or not frames["preparation_version"].eq(PREPARATION_VERSION).all()):
        raise ValueError("Raw timestamped traces require analysis.prepare_real before ML extraction")
    for _, g in frames.groupby(REP_GROUP_KEYS, sort=False):
        t = pd.to_datetime(g["captured_at"], utc=True).astype("int64").to_numpy() / 1e6
        if len(t) < 4 or not np.allclose(np.diff(t), 1000 / 30, atol=.002, rtol=0):
            raise ValueError("Prepared timestamps are not a complete 30 Hz grid")
        if not np.array_equal(g["frame"].to_numpy(), np.arange(len(g))):
            raise ValueError("Prepared grid indices are invalid")


def resample_window(observations, start, end, channels, *, include_end=True):
    """Use real times, retain null targets, never extrapolate or bridge >200 ms."""
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    if start.tzinfo is None or end.tzinfo is None or end <= start:
        raise ValueError("Repetition bounds must be increasing timezone-aware timestamps")
    times = pd.to_datetime(observations["captured_at"], utc=True)
    t = (times - start).dt.total_seconds().to_numpy() * 1000
    if not np.isfinite(t).all() or (np.diff(t) <= 0).any():
        raise ValueError("Duplicate or nonmonotonic capture timestamps")
    duration = (end - start).total_seconds() * 1000
    targets = np.arange(int(np.floor(duration * 30 / 1000 + 1e-9)) + int(include_end)) * 1000 / 30
    output = np.full((len(targets), len(channels)), np.nan)
    data = observations[channels].to_numpy(dtype=float)
    for i, target in enumerate(targets):
        j = int(np.searchsorted(t, target - 1e-6))
        if j < len(t) and abs(t[j] - target) < 1e-6:
            output[i] = data[j]
        elif 0 < j < len(t) and t[j] - t[j - 1] <= MAX_GAP_MS + 1e-6:
            fraction = (target - t[j - 1]) / (t[j] - t[j - 1])
            output[i] = data[j - 1] + fraction * (data[j] - data[j - 1])
    return targets, output


def prepare_session(exercise, session_id, data_dir, model_dir, participant_id, label=None):
    """Return eligible rep grids/features and an explicit session eligibility report.

    Labels, when supplied, are externally declared intended conditions, never
    inferred from cue/score. Partial retained reps do not make a session eligible.
    """
    if not isinstance(participant_id, str) or not participant_id.strip():
        raise ValueError("An explicit participant ID is required")
    if label is not None and (type(label) is not int or label not in (0, 1)):
        raise ValueError("Label must be an explicit binary condition or absent")
    model_dir = Path(model_dir)
    metadata_path = model_dir / f"{exercise}_model.metadata.json"
    audit_path = model_dir / f"{exercise}_audit.json"
    model_meta = json.loads(metadata_path.read_text())
    audit = json.loads(audit_path.read_text())
    if digest(model_dir / f"{exercise}_model.joblib") != model_meta.get("modelSha256"):
        raise ValueError("Model hash mismatch")
    registry_path = ROOT / "config/registry.json"
    if digest(registry_path) != audit.get("sha256", {}).get("config/registry.json"):
        raise ValueError("Model registry hash mismatch")
    registry = json.loads(registry_path.read_text())
    sessions = [s for s in load_session_files(exercise, Path(data_dir)) if s[0] == session_id]
    if len(sessions) != 1:
        raise ValueError("Expected exactly one exported session")
    _, rows, reps, meta = sessions[0]
    check_compatibility(exercise, meta, rows, model_meta, audit, registry)
    is_hold = exercise == "ex_006"
    folder = Path(data_dir) / exercise
    source_sets = _read_ndjson(folder / f"session_{session_id}_sets.ndjson")
    if is_hold:
        if reps:
            raise ValueError("Arm-hold recording unexpectedly contains dynamic repetitions")
        reps = [{"set_index": s["set_index"], "rep_index": 1, "side": "both",
                 "start_ts": s["start_ts"], "end_ts": s["end_ts"]} for s in source_sets]
    if not rows or not reps:
        raise ValueError("No trace frames or repetition windows")
    # Validate source order BEFORE any sorting or replication into left/right.
    times = pd.to_datetime([r["captured_at"] for r in rows], utc=True, format="ISO8601")
    if times.isna().any() or (np.diff(times.astype("int64")) <= 0).any():
        raise ValueError("Duplicate or nonmonotonic capture timestamps")
    params = get_exercise(exercise)
    # Restrict mapping to this session, not other exports in the folder.
    mapped = real_frames(exercise, data_dir=Path(data_dir), session_id=session_id)
    channels = ["primary"] + [c.name for c in params.scored_compensations]
    kept, decisions = [], []
    keys = set()
    for rep in reps:
        sides = ["left", "right"] if rep["side"] in {"both", "bidirectional"} else [rep["side"]]
        for side in sides:
            key = (rep["set_index"], side, rep["rep_index"])
            if key in keys or side not in {"left", "right"}:
                raise ValueError("Duplicate or unsupported repetition identity")
            keys.add(key)
            start, end = pd.Timestamp(rep["start_ts"]), pd.Timestamp(rep["end_ts"])
            window = mapped[(mapped["set_index"] == rep["set_index"]) & (mapped.side == side)
                            & (mapped.captured_at >= start - pd.Timedelta(milliseconds=MAX_GAP_MS))
                            & (mapped.captured_at <= end + pd.Timedelta(milliseconds=MAX_GAP_MS))]
            target, values = resample_window(window, start, end, channels, include_end=not is_hold)
            finite = np.isfinite(values)
            complete = finite.all(axis=1)
            reason = None
            if (not window.baseline_phase.eq("captured").all() or window.calibration_key.nunique() != 1
                    or not all(calibration_available(k) for k in window.calibration_key.unique())):
                reason = "calibration-unavailable-or-changed"
            elif not complete.all():
                reason = "missing-channel-or-time-gap"
            elif len(target) < 4 or (not is_hold and np.ptp(values[:, 0]) <= 1e-9):
                reason = "insufficient-motion"
            record = {"setIndex": int(rep["set_index"]), "side": side, "repIndex": int(rep["rep_index"]),
                      "eligible": reason is None, "reason": reason, "targetSampleCount": len(target),
                      "completeSampleCount": int(complete.sum()),
                      "channelCoverage": {c: float(finite[:, i].mean()) if len(target) else 0.0
                                          for i, c in enumerate(channels)}}
            in_window = window[(window.captured_at >= start) & (window.captured_at <= end)]
            intervals = in_window.captured_at.diff().dt.total_seconds().dropna() * 1000
            record.update(sourceSampleCount=len(in_window),
                          sourceMedianIntervalMs=float(intervals.median()) if len(intervals) else None,
                          sourceMaxIntervalMs=float(intervals.max()) if len(intervals) else None)
            decisions.append(record)
            if reason is not None:
                continue
            g = pd.DataFrame(values, columns=channels)
            g["captured_at"] = start + pd.to_timedelta(target, unit="ms")
            g["frame"] = np.arange(len(g))
            g["session_id"], g["subject_id"], g["label"] = session_id, participant_id, label
            g["set_index"], g["side"], g["rep_index"] = key
            g["preparation_version"] = PREPARATION_VERSION
            kept.append(g)
    prepared = pd.concat(kept, ignore_index=True) if kept else pd.DataFrame()
    features = extract_rep_features(prepared, exercise) if kept else pd.DataFrame()
    folder = Path(data_dir) / exercise
    report = {"preparationVersion": PREPARATION_VERSION, "featureDefinition": "hold-v1" if is_hold else FEATURE_DEFINITION,
              "windowKind": "set-hold" if is_hold else "repetition",
              "exercise": exercise, "sessionId": session_id, "participantId": participant_id,
              "label": label, "labelMeaning": "externally supplied intended condition; not clinical ground truth",
              "modelSha256": model_meta["modelSha256"], "maxInterpolationGapMs": MAX_GAP_MS,
              "allRecordedRepsEligible": bool(decisions) and all(d["eligible"] for d in decisions),
              "sessionInferenceReady": False,
              "preprocessorSha256": digest(Path(__file__)),
              "repetitions": decisions,
              "inputSha256": {p.name: digest(p) for p in [metadata_path, audit_path,
                  folder / f"session_{session_id}_meta.json", folder / f"session_{session_id}_frames.ndjson",
                  folder / f"session_{session_id}_reps.ndjson"]}}
    if source_sets:
        report["inputSha256"][f"session_{session_id}_sets.ndjson"] = digest(folder / f"session_{session_id}_sets.ndjson")
    return prepared, features, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exercise", required=True)
    parser.add_argument("--session", required=True, type=int)
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--participant", required=True)
    parser.add_argument("--label", type=int, choices=[0, 1])
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    try:
        frames, features, report = prepare_session(args.exercise, args.session, args.data_dir,
                                                  args.model_dir, args.participant, args.label)
    except (ValueError, FileNotFoundError) as exc:
        parser.exit(2, f"Preparation refused: {exc}\n")
    # New folder only: never overwrite captures or a previous preparation.
    args.out.mkdir(parents=True, exist_ok=False)
    frames.to_parquet(args.out / "frames.parquet", index=False)
    features.to_parquet(args.out / "rep_features.parquet", index=False)
    (args.out / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8")
    print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
