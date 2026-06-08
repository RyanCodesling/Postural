"""
Engineered features from raw per-frame trajectories.

Two stages mirror the live analytics surface:
  extract_rep_features        one row per rep  (like rep_events + a rep_quality blob)
  aggregate_session_features  one row per session (the model's training unit)

The same code is designed to run unchanged on real per-frame capture logs once
that capture surface exists (not built yet), so feature definitions would stay
identical across synthetic and real data. Tier 1 features mirror scalars the rule
system already has; Tier 2 features (smoothness, trajectory shape, per-rep
compensation aggregates) are the ones the rules do NOT use and are where a learned
model can add value over the rule-based score.

Everything is exercise-agnostic: the primary metric and per-rep features are
computed the same way for any exercise, and one set of compensation features is
emitted per metric the exercise's registry entry declares.

Discipline: features are computed from RAW, unsmoothed frames. The only internal
smoothing is a short moving average used solely to count submovements robustly
(documented at the call site); it is not the display-side filter and is never
fed back into the pipeline.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.signal import find_peaks

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from generators.registry import get_exercise

DATA_DIR = Path(__file__).resolve().parents[1] / "data"

REP_GROUP_KEYS = ["session_id", "set_index", "side", "rep_index"]
ID_COLUMNS = ("session_id", "subject_id", "label")  # never model features


def _moving_average(x: np.ndarray, w: int = 5) -> np.ndarray:
    if x.size < w or w <= 1:
        return x
    kernel = np.ones(w) / w
    return np.convolve(x, kernel, mode="same")


def _smoothness(primary: np.ndarray, fps: int) -> tuple[float, float]:
    """Return (neg_log_dimensionless_jerk, submovement_count). Higher first = smoother."""
    n = primary.size
    duration = n / fps
    peak = float(np.max(np.abs(primary))) or 1.0
    dt = 1.0 / fps

    # Dimensionless jerk on the raw position signal.
    jerk = np.diff(primary, n=3) * (fps ** 3) if n > 3 else np.array([0.0])
    integral_jerk_sq = float(np.sum(jerk ** 2) * dt)
    dj = (duration ** 3 / peak ** 2) * integral_jerk_sq + 1e-9
    neg_log_dj = float(-np.log(dj))

    # Submovement count: prominent peaks of the speed profile (lightly smoothed
    # only so measurement noise is not miscounted as separate submovements).
    speed = np.abs(np.diff(_moving_average(primary, 5))) * fps
    if speed.size:
        prom = max(0.05 * float(np.max(speed)), 1e-6)
        peaks, _ = find_peaks(speed, prominence=prom)
        n_sub = int(peaks.size)
    else:
        n_sub = 0
    return neg_log_dj, float(n_sub)


def _rep_features_one(g: pd.DataFrame, target_rom: float,
                      comps: list[tuple[str, float]]) -> dict:
    g = g.sort_values("frame")
    primary = g["primary"].to_numpy(dtype=float)
    n = primary.size
    fps = 30
    total_ms = n / fps * 1000.0

    peak_idx = int(np.argmax(primary))
    peak_value = float(primary[peak_idx])
    ascent_ms = peak_idx / fps * 1000.0
    hold_frames = int(np.sum(primary >= 0.95 * peak_value))
    hold_ms = hold_frames / fps * 1000.0
    descent_ms = max(total_ms - ascent_ms - hold_ms, 0.0)
    tempo_ratio = ascent_ms / descent_ms if descent_ms > 1e-6 else np.nan

    # Trajectory shape: value at 25/50/75% of the rep, as a fraction of peak.
    qs = [int(q * (n - 1)) for q in (0.25, 0.50, 0.75)]
    shape = [float(primary[i] / peak_value) if peak_value else 0.0 for i in qs]

    neg_log_dj, n_sub = _smoothness(primary, fps)

    feats = {
        **{k: g[k].iloc[0] for k in ("session_id", "subject_id", "label",
                                     "set_index", "side", "rep_index")},
        # Tier 1
        "peak_value": peak_value,
        "time_to_peak_ms": ascent_ms,
        "hold_ms": hold_ms,
        "descent_ms": descent_ms,
        "total_ms": total_ms,
        "tempo_ratio": tempo_ratio,
        "classification": "complete" if peak_value >= target_rom else "partial",
        # Tier 2 — smoothness & shape (rules don't use these)
        "neg_log_djerk": neg_log_dj,
        "submovement_count": n_sub,
        "shape_p25": shape[0],
        "shape_p50": shape[1],
        "shape_p75": shape[2],
    }
    # Tier 2 — per-rep compensation aggregates, one trio per tracked metric.
    for name, warn in comps:
        ch = np.abs(g[name].to_numpy(dtype=float))
        feats[f"comp_{name}_mean"] = float(np.mean(ch))
        feats[f"comp_{name}_peak"] = float(np.max(ch))
        feats[f"comp_{name}_over_frac"] = float(np.mean(ch >= warn))
    return feats


def extract_rep_features(frames: pd.DataFrame, exercise_id: str) -> pd.DataFrame:
    params = get_exercise(exercise_id)
    target_rom = float(params.target_rom)
    comps = [(c.name, c.warning_threshold) for c in params.compensations]
    rows = [
        _rep_features_one(g, target_rom, comps)
        for _, g in frames.groupby(REP_GROUP_KEYS, sort=False)
    ]
    return pd.DataFrame(rows)


def _cv(x: np.ndarray) -> float:
    m = float(np.mean(x))
    return float(np.std(x) / m) if abs(m) > 1e-9 else 0.0


def _fatigue_drift(rep_feats_sorted: pd.DataFrame) -> float:
    """First-third vs last-third mean peak ROM, normalized; negative = fade."""
    peaks = rep_feats_sorted["peak_value"].to_numpy(dtype=float)
    k = max(len(peaks) // 3, 1)
    first, last = peaks[:k].mean(), peaks[-k:].mean()
    return float((last - first) / first) if first > 1e-9 else 0.0


def aggregate_session_features(rep_feats: pd.DataFrame, sets: pd.DataFrame,
                               sessions: pd.DataFrame, exercise_id: str) -> pd.DataFrame:
    params = get_exercise(exercise_id)
    comp_names = [c.name for c in params.compensations]
    # Per-limb runs both sides every set (2x the per-set target); bidirectional
    # alternates within one target count (1x).
    sides = 2 if params.framing == "dynamic_per_limb" else 1
    target_per_session = sets.groupby("session_id")["target_reps"].sum() * sides

    rows = []
    for sid, g in rep_feats.groupby("session_id", sort=False):
        g = g.sort_values(["set_index", "rep_index"])
        peaks = g["peak_value"].to_numpy(dtype=float)
        left = g[g["side"] == "left"]["peak_value"].to_numpy(dtype=float)
        right = g[g["side"] == "right"]["peak_value"].to_numpy(dtype=float)
        mean_lr = 0.5 * (left.mean() + right.mean()) if left.size and right.size else np.nan
        rom_asym = (abs(right.mean() - left.mean()) / mean_lr
                    if left.size and right.size and mean_lr > 1e-9 else 0.0)
        target = float(target_per_session.get(sid, np.nan))
        completion = len(g) / target if target and target > 0 else np.nan

        row = {
            "session_id": sid,
            "subject_id": int(g["subject_id"].iloc[0]),
            "label": int(g["label"].iloc[0]),
            "n_reps": len(g),
            "completion_rate": completion,
            "count_asym": abs(left.size - right.size),
            "rom_mean": float(peaks.mean()),
            "rom_min": float(peaks.min()),
            "rom_cv": _cv(peaks),
            "rom_asym": rom_asym,
            "tempo_ratio_mean": float(np.nanmean(g["tempo_ratio"])),
            "tempo_ratio_cv": _cv(g["tempo_ratio"].dropna().to_numpy(dtype=float)),
            "neg_log_djerk_mean": float(g["neg_log_djerk"].mean()),
            "submovement_mean": float(g["submovement_count"].mean()),
            "shape_p25_mean": float(g["shape_p25"].mean()),
            "shape_p50_mean": float(g["shape_p50"].mean()),
            "shape_p75_mean": float(g["shape_p75"].mean()),
            "complete_frac": float((g["classification"] == "complete").mean()),
            "fatigue_drift": _fatigue_drift(g),
        }
        for name in comp_names:
            row[f"comp_{name}_mean_mean"] = float(g[f"comp_{name}_mean"].mean())
            row[f"comp_{name}_peak_max"] = float(g[f"comp_{name}_peak"].max())
            row[f"comp_{name}_over_frac_mean"] = float(g[f"comp_{name}_over_frac"].mean())
        rows.append(row)
    return pd.DataFrame(rows)


def feature_columns(df: pd.DataFrame) -> list[str]:
    """Model feature columns: numeric columns excluding identifiers and the label."""
    return [c for c in df.columns
            if c not in ID_COLUMNS and pd.api.types.is_numeric_dtype(df[c])]


def main() -> None:
    import argparse

    p = argparse.ArgumentParser(description="Extract features from generated frames.")
    p.add_argument("--exercise", default="ex_001")
    args = p.parse_args()
    ex = args.exercise

    frames = pd.read_parquet(DATA_DIR / f"{ex}_frames.parquet")
    sets = pd.read_parquet(DATA_DIR / f"{ex}_sets.parquet")
    sessions = pd.read_parquet(DATA_DIR / f"{ex}_sessions.parquet")

    rep_feats = extract_rep_features(frames, ex)
    sess_feats = aggregate_session_features(rep_feats, sets, sessions, ex)

    rep_feats.to_parquet(DATA_DIR / f"{ex}_rep_features.parquet", index=False)
    sess_feats.to_parquet(DATA_DIR / f"{ex}_session_features.parquet", index=False)
    print(f"{ex}: {len(rep_feats):,} reps -> {len(sess_feats)} sessions, "
          f"{len(feature_columns(sess_feats))} session features")


if __name__ == "__main__":
    main()
