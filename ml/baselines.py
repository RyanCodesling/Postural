"""
Baselines the learned model must beat or match.

1. Majority class -- the trivial floor.
2. Rule-based compensation score -- a faithful port of the app's per-frame
   `computeCompensationScore` (equal-weighted banded deductions over the active
   compensation metrics), aggregated per rep then per session. This is the
   headline comparison: "ML vs the rule the system already ships."

The banded deduction is piecewise-linear between knot points, so it is expressed
here with np.interp over the same knots as the app's COMPENSATION_BANDS. With
equal weights, the per-frame score reduces to 100 - mean(deductions).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from generators.registry import ExerciseParams, get_exercise

# Knot points mirroring COMPENSATION_BANDS in the app's pose metrics. Only the
# scored metrics (a band with a positive deduction ceiling) are represented; the
# others are warning-only and excluded from the score, as in the app.
DEDUCTION_KNOTS: dict[str, tuple[list[float], list[float]]] = {
    "neckTilt":          ([0, 5, 10, 20, 30],     [0, 0, 35, 75, 100]),
    "shoulderSymmetry":  ([0, 3, 7, 12, 20],      [0, 0, 35, 75, 100]),
    "trunkLean":         ([0, 2, 5, 10, 20],      [0, 0, 35, 75, 100]),
    "scapularElevation": ([0, 0.02, 0.04, 0.06, 0.10], [0, 0, 35, 75, 100]),
}


def banded_deduction(values: np.ndarray, metric: str) -> np.ndarray:
    xs, ys = DEDUCTION_KNOTS[metric]
    return np.interp(np.abs(values), xs, ys)  # np.interp clamps outside the range


def scored_metrics(params: ExerciseParams) -> list[str]:
    return [c.name for c in params.compensations if c.name in DEDUCTION_KNOTS]


def compensation_score_frames(frames: pd.DataFrame, params: ExerciseParams) -> np.ndarray:
    """Per-frame 0-100 compensation score = 100 - mean(deductions) over scored metrics."""
    metrics = scored_metrics(params)
    if not metrics:
        return np.full(len(frames), np.nan)
    deductions = np.stack([banded_deduction(frames[m].to_numpy(dtype=float), m)
                           for m in metrics], axis=0)
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
