"""
Parity test: the Python metrics port must reproduce the TypeScript source
(web/src/lib/pose/poseMetrics.ts) on the same landmark vectors used by its
own tests (scapularElevation.test.ts, neckSideAgreement.test.ts).

Anchors are computed analytically from the identical formula, so this is a true
numeric-parity gate, not a self-consistency check.
"""
import math

from comparison import metrics as M
from comparison.landmark_map import MEDIAPIPE_33

# Neutral standing pose from scapularElevation.test.ts (ear above shoulder
# above hip, patient facing camera). (x, y, visibility) per anatomical point.
NEUTRAL = dict(
    left_ear=(0.58, 0.18, 1.0), right_ear=(0.42, 0.18, 1.0),
    left_shoulder=(0.60, 0.30, 1.0), right_shoulder=(0.40, 0.30, 1.0),
    left_hip=(0.58, 0.55, 1.0), right_hip=(0.42, 0.55, 1.0),
)


def mp_array(**named):
    """Build a MediaPipe-indexed list (len 25) like makeLandmarks() in the TS
    tests: unset indices carry visibility 0."""
    arr = [{"x": 0.0, "y": 0.0, "visibility": 0.0} for _ in range(25)]
    for name, (x, y, v) in named.items():
        arr[MEDIAPIPE_33[name]] = {"x": x, "y": y, "visibility": v}
    return arr


def lms(**named):
    return M.landmarks_from_mediapipe(mp_array(**named))


# ── Scapular elevation ───────────────────────────────────────────────────────

def test_scapular_neutral_exact():
    # shoulderMid=(0.5,0.30), hipMid=(0.5,0.55) -> trunkLen 0.25, trunkUp (0,-1).
    # left: earOffset (-0.02,-0.12) -> proj 0.12 -> 0.12/0.25 = 0.48. Same right.
    f = lms(**NEUTRAL)
    assert math.isclose(M.compute_scapular_elevation(f, "left"), 0.48, abs_tol=1e-12)
    assert math.isclose(M.compute_scapular_elevation(f, "right"), 0.48, abs_tol=1e-12)


def test_scapular_shrug_below_rest_exact():
    rest = lms(**NEUTRAL)
    shrug_named = dict(NEUTRAL, left_shoulder=(0.60, 0.26, 1.0))
    shrug = lms(**shrug_named)
    rest_left = M.compute_scapular_elevation(rest, "left")
    shrug_left = M.compute_scapular_elevation(shrug, "left")
    assert shrug_left < rest_left
    # shoulderMid=(0.5,0.28), hipMid=(0.5,0.55) -> trunkLen 0.27.
    # earOffsetY = 0.18-0.26 = -0.08 -> proj 0.08 -> 0.08/0.27.
    assert math.isclose(shrug_left, 0.08 / 0.27, rel_tol=0, abs_tol=1e-12)


def test_scapular_scale_invariant():
    rest_left = M.compute_scapular_elevation(lms(**NEUTRAL), "left")
    scaled = lms(
        left_ear=(0.54, 0.28, 1.0), right_ear=(0.46, 0.28, 1.0),
        left_shoulder=(0.55, 0.34, 1.0), right_shoulder=(0.45, 0.34, 1.0),
        left_hip=(0.54, 0.46, 1.0), right_hip=(0.46, 0.46, 1.0),
    )
    assert math.isclose(M.compute_scapular_elevation(scaled, "left"),
                        rest_left, abs_tol=0.05)


def test_scapular_low_vis_ear_nulls_only_that_side():
    f = lms(**dict(NEUTRAL, left_ear=(0.58, 0.18, 0.2)))
    assert M.compute_scapular_elevation(f, "left") is None
    assert M.compute_scapular_elevation(f, "right") is not None


def test_scapular_low_vis_hip_nulls_both_sides():
    f = lms(**dict(NEUTRAL, right_hip=(0.42, 0.55, 0.2)))
    assert M.compute_scapular_elevation(f, "left") is None
    assert M.compute_scapular_elevation(f, "right") is None


# ── Neck lateral flexion (signed) + tilt reference ──────────────────────────

def test_tilt_reference_neutral_is_high_and_level():
    t = M.compute_tilt_reference(lms(**NEUTRAL))
    assert t.confidence == "high"
    assert math.isclose(t.camera_tilt_deg, 0.0, abs_tol=1e-12)


def test_neck_signed_scenario1_exact_and_side():
    # LM7 higher (y .18), LM8 lower (y .22): ear-line slopes, hips level.
    f = lms(**dict(NEUTRAL, left_ear=(0.58, 0.18, 1.0), right_ear=(0.42, 0.22, 1.0)))
    t = M.compute_tilt_reference(f)
    signed = M.compute_neck_lateral_flexion_signed(f, t)
    expected = math.degrees(math.atan2(-0.04, 0.16))  # ~ -14.036
    assert math.isclose(signed, expected, abs_tol=1e-9)
    # sign -> side mapping must match the display path (>0 left, <0 right).
    assert (signed > 0) is False  # this scenario is the patient's right


def test_neck_signed_scenario2_is_mirror():
    f = lms(**dict(NEUTRAL, left_ear=(0.58, 0.22, 1.0), right_ear=(0.42, 0.18, 1.0)))
    t = M.compute_tilt_reference(f)
    signed = M.compute_neck_lateral_flexion_signed(f, t)
    expected = math.degrees(math.atan2(0.04, 0.16))  # ~ +14.036
    assert math.isclose(signed, expected, abs_tol=1e-9)
    assert signed > 0  # patient's left


def test_neck_null_without_ears():
    f = lms(**dict(NEUTRAL, left_ear=(0.58, 0.18, 0.2)))
    t = M.compute_tilt_reference(f)
    assert M.compute_neck_lateral_flexion_signed(f, t) is None
