"""
segment.py — extract per-rep peak values from a primary-metric trajectory,
offline, on clean recorded clips. Mirrors the find_peaks usage in
features/extract.py rather than re-running the live rep state machine: the
recorded reps are deliberate and well-separated, so prominence-gated peak
picking is sufficient and backend-agnostic.

The caller passes a primary signal oriented so that a rep is a POSITIVE hump:
  ex_003 -> baseline-adjusted scapular elevation (shrug reads positive)
  ex_004 -> abs(signed neck angle)             (either-side bend reads positive)
"""
from __future__ import annotations

import numpy as np
from scipy.signal import find_peaks


def extract_peaks(primary, fps: int = 30, min_separation_s: float = 0.8,
                  prominence_frac: float = 0.15) -> list[float]:
    p = np.asarray(primary, dtype=float)
    p = p[np.isfinite(p)]
    if p.size < 3:
        return []
    distance = max(int(min_separation_s * fps), 1)
    span = float(np.max(p) - np.min(p))
    prominence = max(prominence_frac * span, 1e-9)
    idx, _ = find_peaks(p, distance=distance, prominence=prominence)
    return [float(p[i]) for i in idx]
