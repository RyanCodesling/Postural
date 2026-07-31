"""
Deterministic checks for the real-trace -> frames-schema mapper.

These pin the parts most prone to silent drift against the live system's
semantics: the scapularElevation sign convention (scored value =
baseline_raw - raw, positive = shrug), ex_005's neutral-baseline-relative
primary, the rep-window join (including side matching and rest frames), the
    per-limb two-rows-per-frame shape, current v3 payload acceptance, and
    acceptance of the original v1 (ex_007-only) payload that carries no
    baselines.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from analysis.real_frames import real_frames


def _ts(seconds: float) -> str:
    whole = int(seconds)
    ms = int(round((seconds - whole) * 1000))
    return f"2026-06-10T10:00:{whole:02d}.{ms:03d}Z"


def _write_session(
    data_dir: Path,
    exercise_id: str,
    sid: int,
    frames: list[dict],
    reps: list[dict],
) -> None:
    folder = data_dir / exercise_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"session_{sid}_frames.ndjson").write_text(
        "".join(json.dumps(f) + "\n" for f in frames), encoding="utf-8"
    )
    (folder / f"session_{sid}_reps.ndjson").write_text(
        "".join(json.dumps(r) + "\n" for r in reps), encoding="utf-8"
    )
    (folder / f"session_{sid}_meta.json").write_text(
        json.dumps({"sessionId": sid, "exerciseId": exercise_id}), encoding="utf-8"
    )


def _frame(seconds: float, set_index: int, metrics: dict) -> dict:
    return {
        "frame_index": int(seconds * 10) + 1,
        "set_index": set_index,
        "elapsed_ms": int(seconds * 1000),
        "captured_at": _ts(seconds),
        "trace_kind": "upper_body_v3",
        "metrics": metrics,
        "landmarks": {},
    }


def _rep(rep_index: int, side: str, start_s: float, end_s: float) -> dict:
    return {
        "rep_index": rep_index,
        "set_index": 1,
        "side": side,
        "peak_value": 90.0,
        "target_rom": 90.0,
        "classification": "complete",
        "start_ts": _ts(start_s),
        "end_ts": _ts(end_s),
    }


def _ex001_metrics(scap_left_raw: float, scap_right_raw: float) -> dict:
    return {
        "exerciseId": "ex_001",
        "shoulderAbductionDeg": {"left": 45.0, "right": 50.0},
        "scapularElevationRaw": {"left": scap_left_raw, "right": scap_right_raw},
        "trunkLeanDeg": 3.0,
        "shoulderSymmetryDeg": 4.0,
        "baselines": {"scapLeft": 0.30, "scapRight": 0.31, "bidirectionalPrimary": None},
        "baselinePhase": "captured",
    }


def test_per_limb_two_rows_scap_sign_and_rep_join(tmp_path):
    # Left rep window [0, 2]; right rep window [0.5, 2]. Frames at 0, 1, 5 s.
    frames = [_frame(s, 1, _ex001_metrics(0.28, 0.30)) for s in (0.0, 1.0, 5.0)]
    reps = [_rep(1, "left", 0.0, 2.0), _rep(2, "right", 0.5, 2.0)]
    _write_session(tmp_path, "ex_001", 1, frames, reps)

    df = real_frames("ex_001", data_dir=tmp_path)

    # Two rows per captured frame (one per side).
    assert len(df) == 6
    assert set(df["side"]) == {"left", "right"}

    left = df[df["side"] == "left"].reset_index(drop=True)
    right = df[df["side"] == "right"].reset_index(drop=True)

    # Scap channel = baseline_raw - raw, per side (positive = shrug).
    assert np.allclose(left["scapularElevation"], 0.30 - 0.28)
    assert np.allclose(right["scapularElevation"], 0.31 - 0.30)

    # Per-side primary.
    assert np.allclose(left["primary"], 45.0)
    assert np.allclose(right["primary"], 50.0)

    # Rep-window join with side matching: at t=0 only the left rep is open.
    assert left["rep_index"].tolist()[0] == 1.0
    assert np.isnan(right["rep_index"].tolist()[0])
    # At t=1 both windows are open.
    assert left["rep_index"].tolist()[1] == 1.0
    assert right["rep_index"].tolist()[1] == 2.0
    # At t=5 both rows are rest frames.
    assert np.isnan(left["rep_index"].tolist()[2])
    assert np.isnan(right["rep_index"].tolist()[2])

    # Within-rep frame counter restarts per rep group; rest frames carry NaN.
    assert left["frame"].tolist()[:2] == [0, 1]
    assert np.isnan(left["frame"].tolist()[2])


def test_bidirectional_ex005_primary_and_worst_side_scap(tmp_path):
    metrics = {
        "exerciseId": "ex_005",
        "neckTiltDeg": 8.0,
        "trunkLateralFlexionFromNeutralSignedDeg": -12.0,
        "scapularElevationRaw": {"left": 0.27, "right": 0.29},
        "baselines": {"scapLeft": 0.30, "scapRight": 0.30, "bidirectionalPrimary": 1.5},
        "baselinePhase": "captured",
    }
    frames = [_frame(0.0, 1, metrics)]
    reps = [_rep(1, "left", 0.0, 2.0)]
    _write_session(tmp_path, "ex_005", 2, frames, reps)

    df = real_frames("ex_005", data_dir=tmp_path)

    # One row per frame; side comes from the matched rep.
    assert len(df) == 1
    assert df["side"].tolist() == ["left"]
    # Primary = |neutral-relative signed lean|.
    assert np.allclose(df["primary"], 12.0)
    # Worst-side scap delta (left 0.03 vs right 0.01), sign kept.
    assert np.allclose(df["scapularElevation"], 0.03)
    assert np.allclose(df["neckTilt"], 8.0)


def test_v1_payload_accepted_with_nan_scap(tmp_path):
    v1_metrics = {
        # No exerciseId, no baselines — the original ex_007-only payload.
        "wristShoulderVertical": {"left": 0.30, "right": 0.25},
        "elbowFlexionDeg": {"left": 170.0, "right": 165.0},
        "scapularElevationRaw": {"left": 0.30, "right": 0.30},
        "trunkLeanDeg": 2.0,
        "shoulderSymmetryDeg": 1.0,
    }
    frame = _frame(0.0, 1, v1_metrics)
    frame["trace_kind"] = "ex_007_upper_body_v1"
    _write_session(tmp_path, "ex_007", 3, [frame], [_rep(1, "left", 0.0, 1.0)])

    df = real_frames("ex_007", data_dir=tmp_path)

    assert len(df) == 2  # per-limb: one row per side
    left = df[df["side"] == "left"].iloc[0]
    right = df[df["side"] == "right"].iloc[0]
    assert left["primary"] == 0.30
    assert right["primary"] == 0.25
    assert left["elbowFlexion"] == 170.0
    # No baselines in v1 -> scap channel unavailable, not fabricated.
    assert "scapularElevation" not in df.columns or df["scapularElevation"].isna().all()


def test_v3_frozen_tilt_metadata_does_not_change_feature_mapping(tmp_path):
    metrics = _ex001_metrics(0.28, 0.30)
    metrics.update(
        {
            "metricAlgorithmVersion": "pose_metrics_v2_frozen_neutral_tilt",
            "tilt": {
                "cameraTiltDeg": 4.5,
                "observedCameraTiltDeg": 7.0,
                "confidence": "high",
                "source": "average",
                "divergenceDeg": 1.0,
            },
            "calibration": {
                "sampleCount": 20,
                "validElapsedMs": 3000,
                "frozenCameraTiltDeg": 4.5,
            },
        }
    )
    _write_session(
        tmp_path,
        "ex_001",
        5,
        [_frame(0.0, 1, metrics)],
        [_rep(1, "left", 0.0, 1.0)],
    )

    df = real_frames("ex_001", data_dir=tmp_path)

    assert len(df) == 2
    assert np.allclose(df["primary"], [45.0, 50.0])
    assert np.allclose(df["trunkLean"], [3.0, 3.0])


def test_verdict_table_smoke(tmp_path):
    from analysis.deduction_report import metric_verdicts

    frames = [_frame(s, 1, _ex001_metrics(0.28, 0.30)) for s in (0.0, 1.0, 5.0)]
    reps = [_rep(1, "left", 0.0, 2.0), _rep(2, "right", 0.5, 2.0)]
    _write_session(tmp_path, "ex_001", 4, frames, reps)

    df = real_frames("ex_001", data_dir=tmp_path)
    verdicts = metric_verdicts(df, "ex_001")

    assert set(verdicts["metric"]) == {"trunkLean", "scapularElevation", "shoulderSymmetry"}
    # All three are scored on ex_001 -> effective + static deduction stats present.
    scored_rows = verdicts[verdicts["ded_mean"].notna()]
    assert len(scored_rows) == 3
    assert scored_rows["static_ded_mean"].notna().all()
    # trunkLean 3 deg: above the 2 deg GLOBAL floor (static deducts) but below
    # ex_001's 6 deg override floor (effective deduction is 0). The override is
    # visible as the gap between static_ded_mean and the effective ded_mean.
    trunk = verdicts[verdicts["metric"] == "trunkLean"].iloc[0]
    assert trunk["scoring"] == "static+override"
    assert trunk["static_ded_mean"] > 0
    assert trunk["ded_mean"] == 0
    assert isinstance(df, pd.DataFrame)
