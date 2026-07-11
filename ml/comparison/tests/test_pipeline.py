"""
Orchestration tests for the driver, runnable WITHOUT the heavy backend deps
(process_clips imports cv2 and the backends lazily, so importing it here only
pulls numpy/scipy + the pure comparison modules). Validates the per-exercise
rep-peak orientation, JSON-serializability of a result, and the comparison
table builder. The cv2-reads-a-real-mp4 link is exercised on the first real run.
"""
import json

import numpy as np

from comparison import process_clips as pc
from comparison.noise_report import variance_decomposition


def test_rep_peaks_ex004_rectifies_signed_angle():
    fps = 30
    t = np.arange(0, 8, 1 / fps)
    signed = 20.0 * np.sin(2 * np.pi * 0.5 * t)  # +/-20 deg alternating bends
    peaks = pc._rep_peaks("ex_004", signed, float(fps))
    assert len(peaks) >= 4
    assert all(p > 0 for p in peaks)            # abs() makes both sides positive
    assert max(peaks) <= 20.0 + 1e-6


def test_rep_peaks_ex003_baseline_makes_shrug_positive():
    fps = 30
    rest = 0.48                                  # raw projection at rest
    sig = np.full(300, rest)
    for c in (80, 160, 240):                     # three shrugs: projection drops
        sig[c - 10:c + 10] = 0.30
    peaks = pc._rep_peaks("ex_003", sig, float(fps))
    assert len(peaks) >= 3
    # baseline(0.48) - raw(0.30) ~= 0.18 elevation per shrug
    assert all(0.10 < p < 0.25 for p in peaks)


def test_result_is_json_serializable_and_md_renders():
    rng = np.random.default_rng(0)
    decomp = variance_decomposition(
        rng.normal(0.0, 1.0, 200), rng.normal(20.0, 5.0, 20),
        rng.normal(20.0, 5.0, 20), units="deg")
    result = {
        "exercise": "ex_004", "backend": "rtmw", "clip_fps": 30.0,
        "infer_ms_mean": 12.3, "infer_fps_cpu": 81.3,
        "clips_used": ["normal_reps", "static_hold"],
        "per_side": {"bidirectional": decomp},
    }
    json.dumps(result)  # must not raise (all values plain floats / None / str)
    md = pc.build_comparison_md([result])
    assert "ex_004" in md and "rtmw" in md and "81.3" in md
