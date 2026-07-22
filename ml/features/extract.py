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


def _hold_features_one(g: pd.DataFrame, center: float, tol: float,
                       comps: list[tuple[str, float]]) -> dict:
    """One isometric hold (a (session, set, side) group): time-in-band features."""
    g = g.sort_values("frame")
    primary = g["primary"].to_numpy(dtype=float)
    n = primary.size
    fps = 30
    total_ms = n / fps * 1000.0

    in_band = (primary >= center - tol) & (primary <= center + tol)
    in_idx = np.flatnonzero(in_band)
    in_band_ms = in_idx.size / fps * 1000.0
    settle_ms = in_idx[0] / fps * 1000.0 if in_idx.size else total_ms

    # Longest unbroken in-band run and the number of band exits (in -> out).
    b = in_band.astype(np.int8)
    edges = np.diff(np.concatenate(([0], b, [0])))
    starts = np.flatnonzero(edges == 1)
    ends = np.flatnonzero(edges == -1)
    longest = int((ends - starts).max()) if starts.size else 0
    exit_count = int(np.sum(in_band[:-1] & ~in_band[1:])) if n > 1 else 0

    # Steadiness/drift over the held portion (from the first in-band frame; the
    # settle ramp would otherwise dominate the deviation and slope).
    post = primary[in_idx[0]:] if in_idx.size else primary
    mean_abs_dev = float(np.mean(np.abs(post - center)))
    hold_sd = float(np.std(post))
    if post.size >= 2:
        t = np.arange(post.size) / fps
        drift_slope = float(np.polyfit(t, post, 1)[0])  # deg/s; negative = sag
    else:
        drift_slope = 0.0
    mean_speed = float(np.mean(np.abs(np.diff(primary))) * fps) if n > 1 else 0.0

    feats = {
        **{k: g[k].iloc[0] for k in ("session_id", "subject_id", "label",
                                     "set_index", "side", "rep_index")},
        "hold_total_ms": total_ms,
        "in_band_ms": in_band_ms,
        "in_band_frac": float(in_band.mean()),
        "settle_ms": settle_ms,
        "longest_in_band_frac": longest / n if n else 0.0,
        "exit_count": exit_count,
        "mean_abs_dev": mean_abs_dev,
        "hold_sd": hold_sd,
        "drift_slope_deg_s": drift_slope,
        "mean_speed": mean_speed,
    }
    for name, warn in comps:
        ch = np.abs(g[name].to_numpy(dtype=float))
        feats[f"comp_{name}_mean"] = float(np.mean(ch))
        feats[f"comp_{name}_peak"] = float(np.max(ch))
        feats[f"comp_{name}_over_frac"] = float(np.mean(ch >= warn))
    return feats


def _extract_hold_features(frames: pd.DataFrame, exercise_id: str) -> pd.DataFrame:
    params = get_exercise(exercise_id)
    band = (params.isometric or {}).get("targetBand") or {}
    center, tol = float(band["center"]), float(band["tolerance"])
    comps = [(c.name, c.warning_threshold) for c in params.scored_compensations]
    # Real side-split captures carry NaN primary on the side not being held;
    # synthetic holds have no NaN rows, so dropping is a no-op there.
    frames = frames[frames["primary"].notna()]
    rows = [
        _hold_features_one(g, center, tol, comps)
        for _, g in frames.groupby(REP_GROUP_KEYS, sort=False)
    ]
    return pd.DataFrame(rows)


def extract_rep_features(frames: pd.DataFrame, exercise_id: str) -> pd.DataFrame:
    params = get_exercise(exercise_id)
    if params.framing == "isometric":
        return _extract_hold_features(frames, exercise_id)
    target_rom = float(params.target_rom)
    comps = [(c.name, c.warning_threshold) for c in params.scored_compensations]
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


def _aggregate_isometric(rep_feats: pd.DataFrame, sets: pd.DataFrame,
                         exercise_id: str,
                         frames: pd.DataFrame | None) -> pd.DataFrame:
    """
    Session aggregates for isometric holds. completion_rate is the per-side
    CREDITED hold time (each side capped at its own prescription) summed over
    both sides, divided by both sides' prescriptions (denominator = prescribed
    seconds x 2) — i.e. the manuscript's "credited hold time against the
    prescription for both sides."

    NOTE this is NOT the live ex_006 set-completion gate, which requires
    SIMULTANEOUS both-arms-in-band time (pairedHoldMs). Because each side is
    credited independently here, an asymmetric hold (one arm in band while the
    other sags) scores higher than under the live paired gate. That is
    deliberate: completion_rate measures per-side achievement, and the
    simultaneity signal is carried separately by the `paired_in_band_frac`
    feature, so the model sees both. Left/right are aggregated separately into
    asymmetry features, never merged.
    """
    params = get_exercise(exercise_id)
    comp_names = [c.name for c in params.scored_compensations]
    band = (params.isometric or {}).get("targetBand") or {}
    center, tol = float(band["center"]), float(band["tolerance"])

    g2 = rep_feats.merge(sets, on=["session_id", "set_index"], how="left")
    g2["target_ms"] = g2["target_reps"].astype(float) * 1000.0
    g2["credited_ms"] = np.minimum(g2["in_band_ms"], g2["target_ms"])

    # Paired both-sides-in-band fraction: only meaningful when the two sides
    # hold simultaneously on a shared timeline (per-limb isometrics).
    paired: pd.Series | None = None
    if params.bilateral_mode != "bidirectional-alternating" and frames is not None:
        f = frames[frames["primary"].notna()]
        inb = (f["primary"] >= center - tol) & (f["primary"] <= center + tol)
        wide = (f.assign(inb=inb.astype(float))
                .pivot_table(index=["session_id", "set_index", "frame"],
                             columns="side", values="inb", aggfunc="first"))
        if "left" in wide.columns and "right" in wide.columns:
            both = ((wide["left"] > 0) & (wide["right"] > 0)).astype(float)
            paired = both.groupby(level="session_id").mean()

    hold_cols = ["in_band_ms", "in_band_frac", "settle_ms", "longest_in_band_frac",
                 "exit_count", "mean_abs_dev", "hold_sd", "drift_slope_deg_s",
                 "mean_speed"]

    rows = []
    for sid, g in g2.groupby("session_id", sort=False):
        g = g.sort_values(["set_index", "side"])
        left = g[g["side"] == "left"]
        right = g[g["side"] == "right"]
        target_total_ms = float(sets[sets["session_id"] == sid]["target_reps"].sum()) * 1000.0 * 2
        completion = float(g["credited_ms"].sum()) / target_total_ms if target_total_ms > 0 else np.nan

        # Fatigue across sets: first-set vs last-set in-band fraction (negative = fade).
        by_set = g.groupby("set_index")["in_band_frac"].mean().sort_index()
        fatigue = float(by_set.iloc[-1] - by_set.iloc[0]) if len(by_set) > 1 else 0.0

        row = {
            "session_id": sid,
            "subject_id": int(g["subject_id"].iloc[0]),
            "label": int(g["label"].iloc[0]),
            "n_holds": len(g),
            "n_sets": int(g["set_index"].nunique()),
            "completion_rate": completion,
            "fatigue_drift": fatigue,
            "hold_asym": (abs(float(left["in_band_frac"].mean()) - float(right["in_band_frac"].mean()))
                          if len(left) and len(right) else 0.0),
            "dev_asym": (abs(float(left["mean_abs_dev"].mean()) - float(right["mean_abs_dev"].mean()))
                         if len(left) and len(right) else 0.0),
        }
        for c in hold_cols:
            row[f"{c}_mean"] = float(g[c].mean())
        row["in_band_frac_min"] = float(g["in_band_frac"].min())
        if paired is not None:
            row["paired_in_band_frac"] = float(paired.get(sid, np.nan))
        for name in comp_names:
            row[f"comp_{name}_mean_mean"] = float(g[f"comp_{name}_mean"].mean())
            row[f"comp_{name}_peak_max"] = float(g[f"comp_{name}_peak"].max())
            row[f"comp_{name}_over_frac_mean"] = float(g[f"comp_{name}_over_frac"].mean())
        rows.append(row)
    return pd.DataFrame(rows)


def aggregate_session_features(rep_feats: pd.DataFrame, sets: pd.DataFrame,
                               sessions: pd.DataFrame, exercise_id: str,
                               frames: pd.DataFrame | None = None) -> pd.DataFrame:
    params = get_exercise(exercise_id)
    if params.framing == "isometric":
        return _aggregate_isometric(rep_feats, sets, exercise_id, frames)
    comp_names = [c.name for c in params.scored_compensations]
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
    sess_feats = aggregate_session_features(rep_feats, sets, sessions, ex, frames=frames)

    rep_feats.to_parquet(DATA_DIR / f"{ex}_rep_features.parquet", index=False)
    sess_feats.to_parquet(DATA_DIR / f"{ex}_session_features.parquet", index=False)
    print(f"{ex}: {len(rep_feats):,} reps -> {len(sess_feats)} sessions, "
          f"{len(feature_columns(sess_feats))} session features")


if __name__ == "__main__":
    main()
