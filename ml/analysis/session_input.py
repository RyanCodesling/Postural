"""Closed-session completeness checks before offline aggregation."""
import json
from pathlib import Path

import numpy as np
import pandas as pd

from analysis.real_frames import _read_ndjson
from analysis.prepare_real import prepare_session, digest
from features.extract import aggregate_session_features, feature_columns
from generators.registry import get_exercise


def timestamp(value):
    t = pd.Timestamp(value)
    if pd.isna(t) or t.tzinfo is None:
        raise ValueError("Missing/timezone-naive window timestamp")
    return t


def positive_integer(value, name):
    if type(value) is not int or value < 1:
        raise ValueError(f"Missing/invalid {name}")
    return value


def session_contract(exercise, sid, data_dir):
    folder = Path(data_dir) / exercise
    meta = json.loads((folder / f"session_{sid}_meta.json").read_text())
    sets = _read_ndjson(folder / f"session_{sid}_sets.ndjson")
    reps = _read_ndjson(folder / f"session_{sid}_reps.ndjson")
    source = _read_ndjson(folder / f"session_{sid}_frames.ndjson")
    if meta.get("sessionId") != sid or meta.get("exerciseId") != exercise:
        raise ValueError("Export session/exercise identity mismatch")
    start, end = timestamp(meta.get("startedAt")), timestamp(meta.get("endedAt"))
    if end <= start or meta.get("endReason") not in {"completed", "user", "pain"}:
        raise ValueError("Session is not closed with a supported outcome")
    if (meta.get("frameCount") != len(source) or meta.get("repCount") != len(reps)
            or meta.get("setCount") != len(sets)):
        raise ValueError("Export row counts do not match metadata; re-export")
    prescription = (meta.get("measurementContext") or {}).get("prescription") or {}
    count = positive_integer(prescription.get("sets"), "prescribed sets")
    if prescription.get("exerciseId") != exercise or prescription.get("prescribedSide") != "both":
        raise ValueError("Current synthetic model supports matching bilateral prescriptions only")
    params = get_exercise(exercise)
    hold = params.kind == "isometric"
    target = positive_integer(prescription.get("holdSeconds" if hold else "reps"), "prescribed target")
    if [s.get("set_index") for s in sets] != list(range(1, count + 1)):
        raise ValueError("Missing, duplicate, unordered or extra prescribed set outcomes")
    if not source or any(r.get("set_index") not in range(1, count + 1) for r in source + reps):
        raise ValueError("Empty capture or events outside prescribed sets")
    previous_end = start
    for s in sets:
        a, b = timestamp(s.get("start_ts")), timestamp(s.get("end_ts"))
        if not (previous_end <= a < b <= end):
            raise ValueError("Set windows overlap or fall outside the closed session")
        previous_end = b
        if s.get("exercise_kind") != params.kind or s.get("terminated_by") not in {"min_reached", "user", "pain"}:
            raise ValueError("Unsupported set outcome/kind")
        if s.get("target_hold_ms" if hold else "target_reps") != target * (1000 if hold else 1):
            raise ValueError("Set target differs from recorded prescription")
        members = [r for r in reps if r["set_index"] == s["set_index"]]
        if hold:
            if exercise != "ex_006" or members:
                raise ValueError("Only simultaneous arm holds are supported")
            continue
        if not members or any(r.get("side") not in {"left", "right"} for r in members):
            raise ValueError("No dynamic reps or ambiguous side attribution")
        for side in ("left", "right"):
            expected = s.get(f"{side}_reps")
            if type(expected) is not int or expected < 0 or sum(r["side"] == side for r in members) != expected:
                raise ValueError("Rep-event count disagrees with saved set outcome")
            if expected == 0:
                raise ValueError("Bilateral model requires measured repetitions on both sides of every set")
            ordered = sorted((timestamp(r["start_ts"]), timestamp(r["end_ts"]))
                             for r in members if r["side"] == side)
            if any(first[1] > second[0] for first, second in zip(ordered, ordered[1:])):
                raise ValueError("Repetition windows overlap on the same side")
        for r in members:
            if not (a <= timestamp(r["start_ts"]) < timestamp(r["end_ts"]) <= b):
                raise ValueError("Rep window falls outside its set")
            if r.get("target_rom") != params.target_rom:
                raise ValueError("Recorded repetition target ROM differs from model protocol")
    # Reaching every target is not required: legitimate partial reps/under-target
    # completed set records contribute to completion_rate. Missing set records do not.
    targets = pd.DataFrame({"session_id": sid, "set_index": range(1, count + 1), "target_reps": target})
    return meta, targets


def prepare_session_features(exercise, sid, data_dir, model_dir, participant, label=None):
    meta, targets = session_contract(exercise, sid, data_dir)
    frames, reps, report = prepare_session(exercise, sid, data_dir, model_dir, participant, label)
    if not report["allRecordedRepsEligible"]:
        reasons = sorted({r["reason"] for r in report["repetitions"] if not r["eligible"]})
        raise ValueError("Whole session excluded: " + ", ".join(reasons))
    # Use the exact training aggregation, including separate per-side and paired
    # hold features. Identifiers/labels never enter the model matrix.
    sessions = aggregate_session_features(reps, targets, pd.DataFrame(), exercise, frames=frames)
    if len(sessions) != 1:
        raise ValueError("Expected one complete session feature row")
    model_meta = json.loads((Path(model_dir) / f"{exercise}_model.metadata.json").read_text())
    columns = feature_columns(sessions)
    if columns != model_meta.get("features"):
        raise ValueError("Session feature names/order differ from frozen model")
    if not np.isfinite(sessions[columns].to_numpy(dtype=float)).all():
        raise ValueError("Session features contain unavailable/nonfinite measurements")
    report["sessionInferenceReady"] = True
    report["prescriptionChecked"] = True
    report["sessionInputSha256"] = digest(Path(__file__))
    return sessions, frames, report, meta
