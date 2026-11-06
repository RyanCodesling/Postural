"""Comparison rules for the trend model (evaluation protocol v1, section 8).

All three work on a batch of series (rows) with the same number of sessions and
return +1 (rising), -1 (falling) or 0 (no call) per row.
"""
from __future__ import annotations

import numpy as np
from scipy import stats


def ols_projection(values: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """Least-squares slope over the session index and the projected change."""
    y = np.asarray(values, dtype=float)
    n = y.shape[1]
    centred = np.arange(n, dtype=float) - (n - 1) / 2.0
    sxx = float(np.sum(centred**2))
    slope = (y - y.mean(axis=1, keepdims=True)) @ centred / sxx
    return slope, slope * (n - 1), sxx


def b0_current_rule(values: np.ndarray, is_angle: bool) -> np.ndarray:
    """Port of the dashboard's trendStatus(): projected change against
    max(3 for angle metrics, 5 % of the mean); needs at least 3 sessions."""
    y = np.asarray(values, dtype=float)
    if y.shape[1] < 3:
        return np.zeros(y.shape[0], dtype=int)
    _, projected, _ = ols_projection(y)
    deadband = np.maximum(3.0 if is_angle else 0.0, 0.05 * np.abs(y.mean(axis=1)))
    return np.where(projected > deadband, 1, np.where(projected < -deadband, -1, 0))


def b1_slope_t_test(values: np.ndarray, alpha: float, delta_min: float) -> np.ndarray:
    """Two-sided least-squares slope t-test with n - 2 degrees of freedom."""
    y = np.asarray(values, dtype=float)
    m, n = y.shape
    if n < 3:
        return np.zeros(m, dtype=int)
    slope, projected, sxx = ols_projection(y)
    centred = np.arange(n, dtype=float) - (n - 1) / 2.0
    fitted = y.mean(axis=1, keepdims=True) + slope[:, None] * centred[None, :]
    rss = np.sum((y - fitted) ** 2, axis=1)
    se = np.sqrt(rss / (n - 2) / sxx)
    with np.errstate(divide="ignore", invalid="ignore"):
        t_value = np.where(se > 0, slope / se, 0.0)
    critical = stats.t.ppf(1.0 - alpha / 2.0, n - 2)
    rising = (t_value > critical) & (projected >= delta_min)
    falling = (t_value < -critical) & (projected <= -delta_min)
    return np.where(rising, 1, np.where(falling, -1, 0))


def b2_fixed_cutoff(values: np.ndarray, cutoff: float) -> np.ndarray:
    """Projected change against a fixed cutoff (tuned elsewhere)."""
    y = np.asarray(values, dtype=float)
    if y.shape[1] < 3:
        return np.zeros(y.shape[0], dtype=int)
    _, projected, _ = ols_projection(y)
    return np.where(projected > cutoff, 1, np.where(projected < -cutoff, -1, 0))


def tune_b2_cutoff(flat_values: np.ndarray, nominal_rate: float, delta_min: float) -> float:
    """Cutoff whose false-call rate on the given no-change series equals nominal_rate."""
    _, projected, _ = ols_projection(flat_values)
    cutoff = float(np.quantile(np.abs(projected), 1.0 - nominal_rate))
    return max(cutoff, delta_min)
