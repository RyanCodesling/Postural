"""
noise_report.py — variance decomposition of a clinical-metric signal into
landmark-noise vs movement (biological) variance, with a swap-decision verdict.

Self-contained (numpy only). Given three measured signals for one exercise and
one backend:
  static_angles : per-frame primary during a motionless hold (pure noise floor)
  slow_peaks    : per-rep peak values, slow deliberate reps
  normal_peaks  : per-rep peak values, natural-pace reps (what analytics see)
it estimates the fraction of per-rep variance attributable to the pose backend.

The static-hold variance approximates the landmark-noise floor; the normal-rep
peak variance approximates the total noise the analytics see; the difference
approximates movement (biological) variation.

Decision bands (a smaller landmark fraction means the backend matters less):
  < 20%   backend is NOT the bottleneck
  20-50%  backend is a minor contributor
  > 50%   backend could be a bottleneck; an empirical swap may be justified
"""
from __future__ import annotations

import numpy as np


def _stats(x) -> dict | None:
    x = np.asarray(x, dtype=float)
    x = x[np.isfinite(x)]
    if x.size < 2:
        return None
    return {
        "n": int(x.size),
        "mean": float(np.mean(x)),
        "sd": float(np.std(x, ddof=1)),
        "min": float(np.min(x)),
        "max": float(np.max(x)),
        "range": float(np.max(x) - np.min(x)),
        "robust_p2p": float(np.percentile(x, 99) - np.percentile(x, 1)),
    }


def verdict(landmark_fraction: float) -> str:
    pct = landmark_fraction * 100.0
    if pct < 20.0:
        return "backend_not_bottleneck"
    if pct < 50.0:
        return "backend_minor_contributor"
    return "backend_possible_bottleneck"


def variance_decomposition(static_angles, slow_peaks, normal_peaks,
                           units: str = "deg") -> dict:
    static = _stats(static_angles)
    slow = _stats(slow_peaks)
    normal = _stats(normal_peaks)

    out = {"units": units, "static": static, "slow": slow, "normal": normal}
    if static is None or normal is None:
        out["landmark_fraction"] = None
        out["verdict"] = "insufficient_data"
        return out

    landmark_var = static["sd"] ** 2
    normal_var = normal["sd"] ** 2
    out["landmark_var"] = landmark_var
    out["normal_total_var"] = normal_var
    out["biological_var_est"] = max(0.0, normal_var - landmark_var)
    if slow is not None:
        out["slow_total_var"] = slow["sd"] ** 2
        out["biological_var_slow_est"] = max(0.0, slow["sd"] ** 2 - landmark_var)

    frac = (landmark_var / normal_var) if normal_var > 0 else 0.0
    out["landmark_fraction"] = float(frac)
    out["verdict"] = verdict(frac)
    return out
