"""Sanity tests for offline rep-peak extraction and the noise decomposition."""
import numpy as np

from comparison.segment import extract_peaks
from comparison.noise_report import variance_decomposition, verdict


def test_extract_peaks_counts_known_reps():
    fps = 30
    t = np.arange(0, 10, 1 / fps)
    # Half-wave rectified 0.5 Hz sine -> one positive hump per 2 s period -> 5.
    signal = np.maximum(0.0, np.sin(2 * np.pi * 0.5 * t))
    peaks = extract_peaks(signal, fps=fps)
    assert 4 <= len(peaks) <= 6
    assert all(p > 0.8 for p in peaks)


def test_extract_peaks_handles_flat_and_nan():
    assert extract_peaks([1.0, 1.0, 1.0, 1.0], fps=30) == []
    assert extract_peaks([float("nan")] * 5, fps=30) == []


def test_variance_decomposition_low_fraction():
    rng = np.random.default_rng(0)
    static = rng.normal(0.0, 1.0, 300)     # noise floor ~1 deg sd
    normal = rng.normal(100.0, 8.0, 30)    # large biological spread
    out = variance_decomposition(static, normal, normal)
    assert out["landmark_fraction"] < 0.2
    assert out["verdict"] == "backend_not_bottleneck"


def test_verdict_thresholds():
    assert verdict(0.10) == "backend_not_bottleneck"
    assert verdict(0.35) == "backend_minor_contributor"
    assert verdict(0.70) == "backend_possible_bottleneck"
