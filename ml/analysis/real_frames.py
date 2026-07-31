"""
Map exported tuning traces (real webcam sessions) onto the frames schema the
rest of the pipeline already speaks.

Input: the ndjson files written by the web exporter (one folder per exercise
under data/real/<exercise_id>/):
    session_<id>_frames.ndjson  raw per-frame trace payloads
    session_<id>_reps.ndjson    counted reps (rep windows: start_ts..end_ts)
    session_<id>_meta.json      session metadata

Output: a DataFrame with the same columns as the synthetic frames parquet —
    session_id, subject_id, label, set_index, side, rep_index, frame,
    primary, <one column per compensation metric>
so `features.extract.extract_rep_features` and `baselines.banded_deduction` /
`compensation_score_frames` run on real data unchanged.

Mapping notes (mirrors the live camera loop / scoring semantics):
  - per-limb exercises (ex_001/ex_007/ex_008, isometric ex_006): TWO rows per
    captured frame, one per side. `primary` is that side's primary metric;
    `scapularElevation` is that side's baseline-subtracted delta
    (baseline_raw − raw, positive = shrug). Body-relative channels
    (trunkLean, shoulderSymmetry) are duplicated across sides.
  - bidirectional dynamic exercises (ex_005): ONE row per frame. primary =
    |trunkLateralFlexionFromNeutralSignedDeg| (the neutral-baseline-relative
    signal the rep counter consumes). `side` comes from the matched rep
    window. `scapularElevation` on ex_005 is the worst-side delta (largest
    |delta|, sign kept), matching the live score's single-value input.
  - side-split isometric (ex_004, since its conversion from a dynamic
    bidirectional exercise to an isometric hold): TWO rows per frame, one per
    side; each side's primary is |neckLateralFlexionSignedDeg| while the sign
    points at that side (positive = patient's LEFT) and NaN otherwise,
    mirroring the live per-side hold attribution. Pre-conversion ex_004
    traces flow through the same mapping (their rep windows are ignored).
  - isometric exercises have no rep_events: rep_index = 1 within each set, so
    the deduction report can group by set. NOT claimed extract-compatible.
  - rep_index is assigned by captured_at ∈ [start_ts, end_ts] of a rep with a
    matching side (per-limb) or any rep (bidirectional). Frames outside every
    window keep rep_index = NaN — rest frames, used for noise statistics and
    dropped before feature extraction.
  - all persisted trace generations are accepted. v3 (`upper_body_v3`) adds
    frozen-neutral-tilt provenance but keeps the raw feature field names used
    here; v2 (`upper_body_v2`) remains readable. v1
    (`ex_007_upper_body_v1`, the original ex_007-only trace) carries no
    baselines, so the scapularElevation channel is NaN.

Rep windows come from the rep counter, which runs on the SMOOTHED signal, so
window edges are approximate against the raw trace — adequate for tuning,
stated here so nobody mistakes them for ground-truth segmentation.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from generators.registry import ExerciseParams, get_exercise  # noqa: E402

DATA_REAL_DIR = Path(__file__).resolve().parents[1] / "data" / "real"

PER_LIMB_PRIMARY_FIELD = {
    "ex_001": "shoulderAbductionDeg",
    "ex_007": "wristShoulderVertical",
    "ex_008": "shoulderAbductionDeg",
    "ex_006": "shoulderHorizAbdDeg",
}


def load_session_files(exercise_id: str, data_dir: Path | None = None):
    """Yield (session_id, frames_rows, reps_rows, meta) per exported session."""
    folder = (data_dir or DATA_REAL_DIR) / exercise_id
    if not folder.is_dir():
        raise FileNotFoundError(
            f"No exported traces at {folder} — run the web exporter first "
            f"(npx tsx scripts/export-tuning-traces.ts --exercise {exercise_id})"
        )
    for meta_path in sorted(folder.glob("session_*_meta.json")):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        sid = meta["sessionId"]
        frames = _read_ndjson(folder / f"session_{sid}_frames.ndjson")
        reps = _read_ndjson(folder / f"session_{sid}_reps.ndjson")
        yield sid, frames, reps, meta


def _read_ndjson(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _channel_value(metrics: dict, name: str, side: str | None) -> float:
    """One compensation channel from a trace payload, as the score reads it."""
    baselines = metrics.get("baselines") or {}
    if name == "trunkLean":
        return _f(metrics.get("trunkLeanDeg"))
    if name == "shoulderSymmetry":
        return _f(metrics.get("shoulderSymmetryDeg"))
    if name == "neckTilt":
        v = metrics.get("neckTiltDeg")
        if v is None:  # v1 payloads / missing — derive from the signed value
            signed = metrics.get("neckLateralFlexionSignedDeg")
            return abs(_f(signed)) if signed is not None else np.nan
        return _f(v)
    if name == "scapularElevation":
        raw = metrics.get("scapularElevationRaw") or {}
        if side is not None:
            base = baselines.get(f"scap{side.capitalize()}")
            r = raw.get(side)
            return _f(base) - _f(r) if base is not None and r is not None else np.nan
        # Bidirectional: worst side (largest |delta|), sign kept — mirrors the
        # live score's single-value input.
        deltas = []
        for s in ("left", "right"):
            base = baselines.get(f"scap{s.capitalize()}")
            r = raw.get(s)
            if base is not None and r is not None:
                deltas.append(_f(base) - _f(r))
        if not deltas:
            return np.nan
        return max(deltas, key=abs)
    if name == "elbowFlexion":
        v = (metrics.get("elbowFlexionDeg") or {}).get(side or "left")
        return _f(v)
    return np.nan


def _f(v) -> float:
    return float(v) if isinstance(v, (int, float)) else np.nan


def _assign_rep_index(
    captured: pd.Series, reps: list[dict], side: str | None
) -> pd.Series:
    """rep_index per frame from rep windows (NaN outside every window)."""
    out = pd.Series(np.nan, index=captured.index)
    for rep in reps:
        if side is not None and rep["side"] not in (side, "both", "bidirectional"):
            continue
        start = pd.Timestamp(rep["start_ts"])
        end = pd.Timestamp(rep["end_ts"])
        mask = (captured >= start) & (captured <= end)
        out[mask] = rep["rep_index"]
    return out


def _rep_side_lookup(reps: list[dict]) -> dict[int, str]:
    return {r["rep_index"]: r["side"] for r in reps}


def real_frames(
    exercise_id: str,
    params: ExerciseParams | None = None,
    data_dir: Path | None = None,
) -> pd.DataFrame:
    """All exported sessions of one exercise, in the synthetic frames schema."""
    params = params or get_exercise(exercise_id)
    comp_names = [c.name for c in params.compensations]
    chunks: list[pd.DataFrame] = []

    for sid, frame_rows, rep_rows, _meta in load_session_files(exercise_id, data_dir):
        if not frame_rows:
            continue
        captured = pd.Series(
            pd.to_datetime([r["captured_at"] for r in frame_rows], utc=True)
        )
        set_index = [r["set_index"] for r in frame_rows]
        metrics = [r["metrics"] for r in frame_rows]

        if params.framing == "bidirectional":
            # ex_005 — neutral-baseline-relative head lean
            primary = [
                abs(_f(m.get("trunkLateralFlexionFromNeutralSignedDeg")))
                for m in metrics
            ]
            df = pd.DataFrame({
                "session_id": sid,
                "subject_id": 0,
                "label": 0,
                "set_index": set_index,
                "primary": primary,
            })
            for name in comp_names:
                df[name] = [_channel_value(m, name, None) for m in metrics]
            df["rep_index"] = _assign_rep_index(captured, rep_rows, None)
            side_of = _rep_side_lookup(rep_rows)
            df["side"] = df["rep_index"].map(
                lambda ri: side_of.get(int(ri)) if pd.notna(ri) else None
            )
            chunks.append(df)
        elif (
            params.kind == "isometric"
            and params.bilateral_mode == "bidirectional-alternating"
        ):
            # Side-split isometric (ex_004): ONE signed signal (positive =
            # patient's LEFT). Two rows per frame, one per side; each side's
            # primary is the magnitude while the sign points at that side and
            # NaN otherwise — mirroring the live per-side hold attribution.
            # No rep windows: rep_index = 1 within each set (set grouping).
            signed = [_f(m.get("neckLateralFlexionSignedDeg")) for m in metrics]
            for side in ("left", "right"):
                sign = 1.0 if side == "left" else -1.0
                # NaN-safe: NaN * sign is NaN, NaN > 0 is False -> stays NaN.
                primary = [s * sign if s * sign > 0 else np.nan for s in signed]
                df = pd.DataFrame({
                    "session_id": sid,
                    "subject_id": 0,
                    "label": 0,
                    "set_index": set_index,
                    "side": side,
                    "primary": primary,
                })
                for name in comp_names:
                    df[name] = [_channel_value(m, name, side) for m in metrics]
                df["rep_index"] = 1.0
                chunks.append(df)
        else:
            # Per-limb (and isometric per-side): two rows per captured frame.
            field = PER_LIMB_PRIMARY_FIELD[exercise_id]
            for side in ("left", "right"):
                primary = [_f((m.get(field) or {}).get(side)) for m in metrics]
                df = pd.DataFrame({
                    "session_id": sid,
                    "subject_id": 0,
                    "label": 0,
                    "set_index": set_index,
                    "side": side,
                    "primary": primary,
                })
                for name in comp_names:
                    df[name] = [_channel_value(m, name, side) for m in metrics]
                if params.kind == "isometric":
                    # No rep_events for isometrics: group by set instead.
                    df["rep_index"] = 1.0
                else:
                    df["rep_index"] = _assign_rep_index(captured, rep_rows, side)
                chunks.append(df)

    if not chunks:
        return pd.DataFrame(
            columns=["session_id", "subject_id", "label", "set_index", "side",
                     "rep_index", "frame", "primary", *comp_names]
        )

    out = pd.concat(chunks, ignore_index=True)
    # Within-rep frame counter, matching the synthetic schema's `frame` column.
    grouped = out.groupby(
        ["session_id", "set_index", "side", "rep_index"], dropna=True, sort=False
    )
    out["frame"] = grouped.cumcount()
    out.loc[out["rep_index"].isna(), "frame"] = np.nan
    return out
