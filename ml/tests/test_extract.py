"""
Deterministic checks for feature extraction, the rule-baseline port, and the
bidirectional framing.

These pin the parts most prone to silent drift: the per-rep feature derivation,
the banded-deduction knots that must match the app's compensation score, and the
exercise-agnostic compensation channels.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from baselines import banded_deduction, compensation_score_frames
from features.extract import extract_rep_features
from generators.base import sample_subject
from generators.framings import generate_session
from generators.registry import get_exercise


def _rep_frames(peak: float, channels: dict[str, float], side: str = "right") -> pd.DataFrame:
    """A single clean rep: cosine rise to `peak`, brief hold, fall; flat comp channels."""
    def ease(n):
        return 0.5 - 0.5 * np.cos(np.pi * np.linspace(0, 1, n))

    primary = np.concatenate([peak * ease(30), np.full(6, peak), peak * ease(30)[::-1]])
    n = primary.size
    cols = {
        "session_id": 0, "subject_id": 0, "label": 0,
        "set_index": 1, "side": side, "rep_index": 1,
        "frame": np.arange(n), "primary": primary,
    }
    for name, val in channels.items():
        cols[name] = np.full(n, val)
    return pd.DataFrame(cols)


def _ex001_rep(
    peak: float = 95.0,
    trunk: float = 1.0,
    scap: float = 0.01,
    shoulder: float = 1.0,
) -> pd.DataFrame:
    return _rep_frames(
        peak,
        {
            "trunkLean": trunk,
            "scapularElevation": scap,
            "shoulderSymmetry": shoulder,
        },
    )


def test_banded_deduction_matches_app_knots():
    # trunkLean knots: 2->0, 5->35, 10->75, 20->100 (clamps past 20).
    assert banded_deduction(np.array([2.0]), "trunkLean")[0] == 0.0
    assert banded_deduction(np.array([5.0]), "trunkLean")[0] == 35.0
    assert banded_deduction(np.array([10.0]), "trunkLean")[0] == 75.0
    assert banded_deduction(np.array([20.0]), "trunkLean")[0] == 100.0
    assert banded_deduction(np.array([50.0]), "trunkLean")[0] == 100.0
    # scapularElevation knot: 0.04 -> 35.
    assert banded_deduction(np.array([0.04]), "scapularElevation")[0] == 35.0


def test_clean_form_scores_near_100():
    params = get_exercise("ex_001")
    scores = compensation_score_frames(_ex001_rep(trunk=1.0, scap=0.01), params)
    assert np.all(scores > 98.0)  # well below every warning band


def test_heavy_trunk_lean_lowers_score():
    params = get_exercise("ex_001")
    # trunkLean 20 deg -> 100 deduction; equal-weighted with clean scap/symmetry -> ~67.
    assert compensation_score_frames(_ex001_rep(trunk=20.0, scap=0.01), params).mean() < 70.0


def test_rep_features_basic():
    feats = extract_rep_features(_ex001_rep(peak=95.0), "ex_001").iloc[0]
    assert abs(feats["peak_value"] - 95.0) < 1e-6
    assert feats["classification"] == "complete"               # 95 >= targetROM 90
    assert feats["comp_trunkLean_over_frac"] == 0.0            # 1 deg < 5 deg warn
    assert feats["comp_scapularElevation_over_frac"] == 0.0    # 0.01 < 0.04 warn
    assert feats["comp_shoulderSymmetry_over_frac"] == 0.0     # 1 deg < 5 deg warn
    assert 0.0 < feats["time_to_peak_ms"] < feats["total_ms"]
    for q in ("shape_p25", "shape_p50", "shape_p75"):
        assert 0.0 <= feats[q] <= 1.01


def test_partial_classification_below_target():
    feats = extract_rep_features(_ex001_rep(peak=70.0), "ex_001").iloc[0]
    assert feats["classification"] == "partial"                # 70 < targetROM 90


def test_extract_uses_registry_compensations():
    # ex_004's compensations are trunkLean + shoulderSymmetry (NOT scapularElevation):
    # the extractor must emit comp features for exactly those metrics.
    frames = _rep_frames(25.0, {"trunkLean": 1.0, "shoulderSymmetry": 2.0})
    feats = extract_rep_features(frames, "ex_004").iloc[0]
    assert "comp_trunkLean_over_frac" in feats.index
    assert "comp_shoulderSymmetry_over_frac" in feats.index
    assert "comp_scapularElevation_mean" not in feats.index
    assert feats["classification"] == "partial"                # 25 < targetROM 30


def test_bidirectional_tags_both_sides_and_uses_comps():
    params = get_exercise("ex_004")
    assert params.framing == "bidirectional"
    rng = np.random.default_rng(0)
    sess = generate_session(
        params, subject=sample_subject(rng), subject_id=0,
        session_id=0, label=1, rng=rng,
    )
    sides = {r.side for r in sess.reps}
    assert sides <= {"left", "right"} and "left" in sides and "right" in sides
    # Channels are exactly the exercise's compensation metrics.
    assert set(sess.reps[0].channels.keys()) == {"trunkLean", "shoulderSymmetry"}
