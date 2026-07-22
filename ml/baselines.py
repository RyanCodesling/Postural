"""
Baselines the learned model must beat or match.

1. Majority class -- the trivial floor.
2. Rule-based compensation score -- the app's per-frame
   `computeCompensationScore` (equal-weighted banded deductions over the active
   compensation metrics), aggregated per rep then per session. This is the
   headline comparison: "ML vs the rule the system already ships."

The deduction bands, per-metric scoring modes, primary-coupling constants, and
per-exercise band overrides are ALL READ FROM THE EXPORTED REGISTRY
(`config/registry.json`, regenerated via `npx tsx scripts/export-registry.ts`
in the web project) -- not hand-mirrored -- so this baseline cannot drift from
the app's scoring by construction. The banded deduction is piecewise-linear
between knot points, evaluated with np.interp over knots converted from the
exported bands (the loader asserts the continuity that makes the two
formulations identical). A `primary-coupled` metric deducts on the residual
`|value - (intercept + slope*|primary|)|` instead of `|value|`, using each
frame's own primary (so the coupling is naturally per-side); a per-exercise
`bandsOverride` wins over the metric's global bands. With equal weights, the
per-frame score reduces to 100 - mean(deductions).

NOTE on per-limb aggregation: the live app surfaces the WORSE of the two sides
for per-limb exercises (each side scored against its own primary), a
display-surface rollup. Here the per-frame coupled deduction -- the part that
must match the app's per-frame function -- is identical per frame; the rule
session score keeps its mean-over-reps aggregation.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from generators.registry import (
    CompensationSpec,
    ExerciseParams,
    get_exercise,
    load_compensation_bands,
)

# Deduction knots loaded once from the exported registry (the app exports only
# the metrics that actually deduct -- warning-only metrics have no entry).
_DEDUCTION_KNOTS: dict[str, tuple[list[float], list[float]]] = load_compensation_bands()


def _interp_knots(values: np.ndarray, knots: tuple[list[float], list[float]]) -> np.ndarray:
    xs, ys = knots
    return np.interp(np.abs(values), xs, ys)  # np.interp clamps outside the range


def banded_deduction(values: np.ndarray, metric: str) -> np.ndarray:
    """Static |value| deduction against the metric's GLOBAL bands. Kept as a
    by-name helper for the deduction report and tests; the per-exercise score
    path (compensation_score_frames) routes through override-aware knots and
    the primary-coupled residual instead."""
    return _interp_knots(values, _DEDUCTION_KNOTS[metric])


def scored_comps(params: ExerciseParams) -> list[CompensationSpec]:
    # Scoring is an explicit per-metric registry decision: mode "off" metrics
    # are warning-only and excluded from the score and its weighting, exactly
    # as in the app. A metric counts as scored when it has deduction bands --
    # either the global entry or a per-exercise override.
    return [
        c
        for c in params.compensations
        if c.scoring_mode != "off"
        and (c.bands_override is not None or c.name in _DEDUCTION_KNOTS)
    ]


def scored_metrics(params: ExerciseParams) -> list[str]:
    """Names of the scored compensation metrics (deduction report / tests)."""
    return [c.name for c in scored_comps(params)]


def frame_deduction(frames: pd.DataFrame, c: CompensationSpec) -> np.ndarray:
    """Per-frame deduction for one scored metric, matching the app's
    computeCompensationScore: a `primary-coupled` metric deducts on the residual
    from its primary-driven expectation (intercept + slope*|primary|), every
    other metric on |value|. The per-exercise band override wins over the
    global bands. Falls back to the static |value| input if the primary column
    is absent (mirrors the app's missing-primary fallback). Public so the
    deduction-report tool scores frames exactly as this baseline does."""
    value = frames[c.name].to_numpy(dtype=float)
    if (
        c.scoring_mode == "primary-coupled"
        and c.intercept is not None
        and "primary" in frames.columns
    ):
        primary = np.abs(frames["primary"].to_numpy(dtype=float))
        value = value - (c.intercept + c.slope_per_primary_unit * primary)
    knots = c.bands_override if c.bands_override is not None else _DEDUCTION_KNOTS[c.name]
    return _interp_knots(value, knots)


def compensation_score_frames(frames: pd.DataFrame, params: ExerciseParams) -> np.ndarray:
    """Per-frame 0-100 compensation score = 100 - mean(deductions) over scored metrics."""
    comps = scored_comps(params)
    if not comps:
        return np.full(len(frames), np.nan)
    deductions = np.stack([frame_deduction(frames, c) for c in comps], axis=0)
    return 100.0 - deductions.mean(axis=0)


def rule_session_scores(frames: pd.DataFrame, exercise_id: str) -> pd.DataFrame:
    """
    Aggregate the per-frame rule score to a per-session score: mean over frames
    within each rep, then mean over reps within each session (so long reps don't
    dominate). Lower score = more compensation.
    """
    params = get_exercise(exercise_id)
    df = frames[["session_id", "set_index", "side", "rep_index"]].copy()
    df["frame_score"] = compensation_score_frames(frames, params)
    rep_mean = df.groupby(["session_id", "set_index", "side", "rep_index"], sort=False)[
        "frame_score"].mean().reset_index()
    sess = rep_mean.groupby("session_id", sort=False)["frame_score"].mean().reset_index()
    return sess.rename(columns={"frame_score": "rule_score"})


def rule_decision_function(rule_score: np.ndarray) -> np.ndarray:
    """Map rule score (high = good) to a P(compensated)-like score in [0,1]."""
    return (100.0 - np.asarray(rule_score, dtype=float)) / 100.0


def majority_class_proba(y_train: np.ndarray, n_test: int) -> np.ndarray:
    """Constant P(compensated) = training prior; the trivial baseline."""
    prior = float(np.mean(y_train)) if len(y_train) else 0.5
    return np.full(n_test, prior)
