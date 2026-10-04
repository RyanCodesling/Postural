"""Series with a known truth for Test A (evaluation protocol v1, section 6)."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Config:
    cid: str
    exercise: str
    measure: str
    is_angle: bool
    delta_min: float
    level: float
    sigma_u: float
    tau_hat: float
    units_base: float
    units_stress: tuple[float, float]


@dataclass(frozen=True)
class Condition:
    name: str
    noise: str          # gauss | t3 | ar1
    tau_mult: float
    units: str          # base | low | high


CONDITIONS: tuple[Condition, ...] = (
    Condition("base", "gauss", 1.0, "base"),
    Condition("tau_0.5", "gauss", 0.5, "base"),
    Condition("tau_1.5", "gauss", 1.5, "base"),
    Condition("tau_2", "gauss", 2.0, "base"),
    Condition("t3", "t3", 1.0, "base"),
    Condition("ar1", "ar1", 1.0, "base"),
    Condition("units_low", "gauss", 1.0, "low"),
    Condition("units_high", "gauss", 1.0, "high"),
)

TRUTHS: tuple[tuple[str, float], ...] = (
    ("flat", 0.0), ("outlier", 0.0),
    ("linear", -4.0), ("linear", -3.0), ("linear", -2.0), ("linear", -1.0),
    ("linear", 1.0), ("linear", 2.0), ("linear", 3.0), ("linear", 4.0),
    ("step", -3.0), ("plateau", 4.0),
)

SESSION_COUNTS: tuple[int, ...] = (3, 4, 5, 6, 8, 10, 15)


def units_for(config: Config, condition: Condition) -> float:
    if condition.units == "low":
        return config.units_stress[0]
    if condition.units == "high":
        return config.units_stress[1]
    return config.units_base


def truth_direction(truth: str, multiple: float) -> int:
    if truth in ("flat", "outlier"):
        return 0
    return 1 if multiple > 0 else -1


def simulate(config: Config, condition: Condition, truth: str, multiple: float, n: int,
             count: int, rng: np.random.Generator) -> tuple[np.ndarray, float]:
    """Returns (series values, within-session variance given to the model)."""
    idx = np.arange(n, dtype=float)
    scale = config.tau_hat
    if truth == "linear":
        g = multiple * scale * idx / (n - 1)
    elif truth == "step":
        g = np.where(idx >= n - 2, multiple * scale, 0.0)
    elif truth == "plateau":
        g = multiple * scale * np.minimum(1.0, idx / ((n - 1) / 2.0))
    else:
        g = np.zeros(n)
    tau_true = condition.tau_mult * scale
    if condition.noise == "gauss":
        day = rng.normal(0.0, tau_true, (count, n))
    elif condition.noise == "t3":
        day = rng.standard_t(3, (count, n)) * tau_true / np.sqrt(3.0)
    elif condition.noise == "ar1":
        shocks = rng.normal(0.0, 1.0, (count, n))
        day = np.empty((count, n))
        day[:, 0] = tau_true * shocks[:, 0]
        for i in range(1, n):
            day[:, i] = 0.5 * day[:, i - 1] + np.sqrt(1 - 0.25) * tau_true * shocks[:, i]
    else:
        raise ValueError(condition.noise)
    units = units_for(config, condition)
    within = rng.normal(0.0, config.sigma_u / np.sqrt(units), (count, n))
    values = config.level + g[None, :] + day + within
    if truth == "outlier":
        hit = rng.integers(0, n, count)
        values[np.arange(count), hit] += 4.0 * scale
    return values, config.sigma_u**2 / units
