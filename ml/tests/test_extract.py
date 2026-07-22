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


# ex_001 scapularElevation is primary-coupled: clean form is NOT a flat low
# scap, it rides the scapulohumeral-rhythm line. These constants mirror the
# registry fit so a "clean" test rep produces a ~0 coupled residual.
_EX001_SCAP_INTERCEPT = -0.0077
_EX001_SCAP_SLOPE = 0.00124


def _ex001_clean_scap_rep(
    peak: float = 95.0, trunk: float = 1.0, shoulder: float = 1.0
) -> pd.DataFrame:
    """A clean ex_001 rep whose scapularElevation follows the primary-coupled
    expectation, so the coupled score isolates the other metrics."""
    df = _ex001_rep(peak=peak, trunk=trunk, scap=0.0, shoulder=shoulder)
    df["scapularElevation"] = (
        _EX001_SCAP_INTERCEPT + _EX001_SCAP_SLOPE * np.abs(df["primary"].to_numpy())
    )
    return df


def test_banded_deduction_matches_app_knots():
    # trunkLean GLOBAL knots: 2->0, 5->35, 10->75, 20->100 (clamps past 20).
    assert banded_deduction(np.array([2.0]), "trunkLean")[0] == 0.0
    assert banded_deduction(np.array([5.0]), "trunkLean")[0] == 35.0
    assert banded_deduction(np.array([10.0]), "trunkLean")[0] == 75.0
    assert banded_deduction(np.array([20.0]), "trunkLean")[0] == 100.0
    assert banded_deduction(np.array([50.0]), "trunkLean")[0] == 100.0
    # scapularElevation knot: 0.04 -> 35.
    assert banded_deduction(np.array([0.04]), "scapularElevation")[0] == 35.0


def test_clean_form_scores_near_100():
    # Clean form: trunk/shoulder near zero AND scap on its coupled line.
    params = get_exercise("ex_001")
    scores = compensation_score_frames(_ex001_clean_scap_rep(trunk=1.0), params)
    assert np.all(scores > 98.0)  # well below every warning band


def test_heavy_trunk_lean_lowers_score():
    params = get_exercise("ex_001")
    # ex_001 trunkLean uses the per-exercise override knots [0,6,10,15,25] ->
    # [0,0,35,75,100]; 25 deg saturates to 100 deduction. Equal-weighted with a
    # clean (coupled) scap and clean symmetry -> ~67.
    assert compensation_score_frames(_ex001_clean_scap_rep(trunk=25.0), params).mean() < 70.0


def test_primary_coupled_scap_excess_deducts():
    # Scap ON its coupled line -> ~no deduction; the SAME excess above the line
    # deducts. This is the whole point of primary-coupled scoring: intrinsic
    # scapulohumeral rhythm is not punished, excess over it is.
    params = get_exercise("ex_001")
    on_line = compensation_score_frames(_ex001_clean_scap_rep(trunk=1.0), params).mean()
    excess = _ex001_clean_scap_rep(trunk=1.0)
    excess["scapularElevation"] = excess["scapularElevation"] + 0.06  # well past the 0.04 band
    excess_score = compensation_score_frames(excess, params).mean()
    assert on_line > 98.0
    assert excess_score < on_line - 20.0


def test_band_override_relaxes_trunk_floor():
    # 4 deg trunk lean sits above the GLOBAL 2 deg floor (would deduct) but
    # below ex_001's overridden 6 deg floor (must not deduct).
    params = get_exercise("ex_001")
    assert banded_deduction(np.array([4.0]), "trunkLean")[0] > 0.0   # global floor 2
    assert compensation_score_frames(_ex001_clean_scap_rep(trunk=4.0), params).mean() > 98.0


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


# NOTE: these framing pins used ex_004 until its registry conversion to an
# isometric hold; ex_005 is now the bidirectional dynamic exemplar. The
# isometric framing (which ex_004 now selects) is pinned in test_isometric.py.


def test_extract_uses_registry_compensations():
    # ex_005's compensations are neckTilt + scapularElevation (NOT trunkLean):
    # the extractor must emit comp features for exactly those metrics.
    frames = _rep_frames(20.0, {"neckTilt": 1.0, "scapularElevation": 0.01})
    feats = extract_rep_features(frames, "ex_005").iloc[0]
    assert "comp_neckTilt_over_frac" in feats.index
    assert "comp_scapularElevation_over_frac" in feats.index
    assert "comp_trunkLean_mean" not in feats.index
    assert feats["classification"] == "partial"                # 20 < targetROM 25


def test_bidirectional_tags_both_sides_and_uses_comps():
    params = get_exercise("ex_005")
    assert params.framing == "bidirectional"
    rng = np.random.default_rng(0)
    sess = generate_session(
        params, subject=sample_subject(rng), subject_id=0,
        session_id=0, label=1, rng=rng,
    )
    sides = {r.side for r in sess.reps}
    assert sides <= {"left", "right"} and "left" in sides and "right" in sides
    # Channels are exactly the exercise's compensation metrics.
    assert set(sess.reps[0].channels.keys()) == {"neckTilt", "scapularElevation"}


def test_ex004_loads_as_isometric_framing():
    # ex_004 converted from a dynamic bidirectional exercise to an isometric
    # hold; the registry round-trip must surface that as the isometric framing
    # with the target band intact and no rep thresholds.
    params = get_exercise("ex_004")
    assert params.kind == "isometric"
    assert params.framing == "isometric"
    assert params.target_rom is None
    band = (params.isometric or {}).get("targetBand", {})
    assert band.get("center", 0) > band.get("tolerance", 0) > 0
