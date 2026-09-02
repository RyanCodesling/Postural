"""
Pins the claims made by comparison/normalization_audit.py.

These are not tests of product code — they are tests of the EVIDENCE. Each one
asserts a number that appears in the 2026-09-02 findings, so a later reader can
re-run them instead of trusting the write-up. If a control assertion ever fails,
the fixture is wrong and every number derived from it must be discarded.
"""
from __future__ import annotations

import math

import pytest

from comparison.normalization_audit import (
    P,
    band_true_span,
    build_body,
    build_trunk_lean,
    demo_neck_tilt_halving,
    effective_threshold,
    elbow_flexion,
    normalize,
    rescale_x,
    scapular_elevation,
    shoulder_abduction,
    shoulder_symmetry,
    tilt_reference,
    trunk_lean,
)

SQUARE = (720, 720)
WIDE = (1280, 720)


# ---------------------------------------------------------------------------
# CONTROLS. If any of these fail, the fixtures are wrong — not the product.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("true_deg", [45.0, 70.0, 80.0, 90.0, 100.0, 110.0])
def test_square_frame_reproduces_true_arm_elevation(true_deg):
    W, H = SQUARE
    L = normalize(build_body(W, H, arm_elev_deg=true_deg), W, H)
    assert shoulder_abduction(L, "left") == pytest.approx(true_deg, abs=1e-6)


@pytest.mark.parametrize("true_deg", [1.0, 2.0, 3.0, 5.0, 8.0])
def test_square_frame_reproduces_true_shoulder_tilt(true_deg):
    W, H = SQUARE
    L = normalize(build_body(W, H, shoulder_tilt_deg=true_deg), W, H)
    assert abs(shoulder_symmetry(L, tilt_reference(L)[0])) == pytest.approx(true_deg, abs=1e-6)


@pytest.mark.parametrize("true_deg", [2.0, 3.0, 5.0, 8.0, 12.0])
def test_square_frame_reproduces_true_trunk_lean(true_deg):
    """Guards the fixture bug that was caught during development: an earlier
    version rotated the pelvis with the trunk, and this control read 0.00."""
    W, H = SQUARE
    L = normalize(build_trunk_lean(W, H, true_deg), W, H)
    assert abs(trunk_lean(L, tilt_reference(L)[0])) == pytest.approx(true_deg, abs=1e-6)


@pytest.mark.parametrize("roll", [0.0, 3.0, 6.0, 10.0])
def test_square_frame_cancels_camera_roll_for_both_metrics(roll):
    W, H = SQUARE
    L = normalize(build_body(W, H, camera_roll_deg=roll), W, H)
    tilt = tilt_reference(L)[0]
    assert shoulder_symmetry(L, tilt) == pytest.approx(0.0, abs=1e-6)
    assert trunk_lean(L, tilt) == pytest.approx(0.0, abs=1e-6)


# ---------------------------------------------------------------------------
# THE FINDINGS.
# ---------------------------------------------------------------------------
def test_horizontal_and_vertical_metrics_distort_reciprocally():
    """Two metrics declaring the SAME 5 degree threshold fire ~3.1x apart."""
    W, H = WIDE
    sym = effective_threshold(5, W, H, "horizontal")
    lean = effective_threshold(5, W, H, "vertical")
    assert sym == pytest.approx(2.82, abs=0.01)
    assert lean == pytest.approx(8.84, abs=0.01)
    assert lean / sym == pytest.approx((W / H) ** 2, rel=0.02)


def test_ex006_band_is_narrower_than_declared():
    """The 90 +/- 10 band admits only about +/-5.65 TRUE degrees on 16:9."""
    lo, hi = band_true_span(80.0, 100.0, *WIDE)
    assert lo == pytest.approx(84.35, abs=0.1)
    assert hi == pytest.approx(95.65, abs=0.1)
    assert (hi - lo) < 12.0

    lo_sq, hi_sq = band_true_span(80.0, 100.0, *SQUARE)
    assert (hi_sq - lo_sq) == pytest.approx(20.0, abs=0.1)


def test_ninety_degrees_is_the_only_exact_point():
    """Arm-horizontal and trunk-vertical are both axis-aligned at 90, so the
    target reads true while everything either side of it does not."""
    W, H = WIDE
    at90 = shoulder_abduction(normalize(build_body(W, H, arm_elev_deg=90.0), W, H), "left")
    assert at90 == pytest.approx(90.0, abs=1e-6)
    for off in (80.0, 100.0):
        v = shoulder_abduction(normalize(build_body(W, H, arm_elev_deg=off), W, H), "left")
        assert abs(v - off) > 5.0


def test_camera_roll_leaks_into_trunk_lean_on_wide_frames():
    """The tilt reference is built from near-horizontal lines and applied to a
    near-vertical one, so roll is cancelled for symmetry but not for lean."""
    W, H = WIDE
    L = normalize(build_body(W, H, camera_roll_deg=10.0), W, H)
    tilt = tilt_reference(L)[0]
    assert shoulder_symmetry(L, tilt) == pytest.approx(0.0, abs=1e-6)
    assert trunk_lean(L, tilt) == pytest.approx(-11.74, abs=0.05)
    # Above the 5 degree warning threshold: a false positive from camera roll.
    assert abs(trunk_lean(L, tilt)) > 5.0


def test_neck_tilt_is_halved_inside_the_agreement_window():
    """Not an aspect effect — reproduces in the square control, and the
    transfer function is discontinuous at the 3 degree agreement boundary."""
    rows = {round(t, 2): (r, conf) for t, r, conf, _ in demo_neck_tilt_halving()}
    assert rows[3.0][0] == pytest.approx(1.5, abs=1e-6)
    assert rows[3.0][1] == "high"
    assert rows[3.01][0] == pytest.approx(3.01, abs=1e-6)
    assert rows[3.01][1] == "low"
    # A 0.01 degree change in truth moves the reading by more than 1.5 degrees.
    assert rows[3.01][0] - rows[3.0][0] > 1.5


def test_elbow_flexion_threshold_fires_earlier_than_declared():
    """Declared 'warn below 150' fires at roughly true 163-165 on 16:9."""
    W, H = WIDE
    reading_at_150 = elbow_flexion(
        normalize(build_body(W, H, elbow_flex_deg=150.0, arm_elev_deg=90.0), W, H), "left")
    assert reading_at_150 == pytest.approx(134.25, abs=0.1)
    reading_at_160 = elbow_flexion(
        normalize(build_body(W, H, elbow_flex_deg=160.0, arm_elev_deg=90.0), W, H), "left")
    assert reading_at_160 < 150.0  # a true 160 degree elbow still warns


def test_scapular_elevation_is_invariant_when_the_trunk_is_vertical():
    """A projection divided by trunk length; with a vertical trunk both scale
    by 1/H. NOT asserted under lean, where the invariance is not expected."""
    for tilt_deg in (0.0, 3.0, 6.0, 10.0):
        wide = scapular_elevation(
            normalize(build_body(*WIDE, neck_tilt_deg=tilt_deg), *WIDE), "left")
        square = scapular_elevation(
            normalize(build_body(*SQUARE, neck_tilt_deg=tilt_deg), *SQUARE), "left")
        assert wide == pytest.approx(square, rel=1e-9)


# ---------------------------------------------------------------------------
# THE FIX.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("true_deg", [45.0, 70.0, 80.0, 90.0, 100.0, 110.0])
def test_rescaling_x_restores_the_true_angle(true_deg):
    W, H = WIDE
    L = normalize(build_body(W, H, arm_elev_deg=true_deg), W, H)
    assert shoulder_abduction(rescale_x(L, W, H), "left") == pytest.approx(true_deg, abs=1e-6)


def test_fix_is_a_no_op_on_a_square_frame():
    """Rescaling by W/H = 1 must change nothing, so the correction is safe to
    apply unconditionally rather than branching on aspect ratio."""
    W, H = SQUARE
    L = normalize(build_body(W, H, arm_elev_deg=83.0), W, H)
    assert shoulder_abduction(rescale_x(L, W, H), "left") == pytest.approx(
        shoulder_abduction(L, "left"), abs=1e-12)
