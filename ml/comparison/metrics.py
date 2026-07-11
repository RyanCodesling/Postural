"""
metrics.py — Python port of the clinical-angle math from
web/src/lib/pose/poseMetrics.ts, restricted to the two metrics the backend
comparison evaluates:

  - compute_neck_lateral_flexion_signed  (ex_004 primary; degrees)
  - compute_scapular_elevation           (ex_003 primary; trunk-length units)

plus the consensus tilt reference both rely on. The math mirrors the TypeScript
1:1 so the comparison's angles match what the live system would compute from the
same landmarks; tests/test_metrics_parity.py pins this against the TS test
vectors (scapularElevation.test.ts, neckSideAgreement.test.ts).

Operates on a name-keyed landmark dict (see landmark_map.py) so it is
backend-agnostic.

Coordinate convention (identical to the TS source): normalized image space,
x and y in [0, 1], with y increasing DOWNWARD. That y-down convention is
load-bearing for every sign below — do not "fix" it.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

# Mirrors the TS constants of the same name.
MIN_VIS = 0.5
AGREEMENT_THRESHOLD_DEG = 3.0
TRUNK_LEN_EPSILON = 0.05  # 5% of frame height; below any real torso


@dataclass(frozen=True)
class Point:
    x: float
    y: float
    vis: float = 1.0  # absent visibility defaults to 1, matching TS `vis()`


# A landmark frame: anatomical name -> Point or None (missing/occluded).
Landmarks = dict


def _vis(p: Optional[Point]) -> float:
    return p.vis if p is not None else 0.0


def pair_visible(a: Optional[Point], b: Optional[Point]) -> bool:
    return a is not None and b is not None and _vis(a) >= MIN_VIS and _vis(b) >= MIN_VIS


def line_angle_deg(a: Point, b: Point) -> float:
    """Angle of the vector a->b vs the +x axis, degrees in (-180, 180].

    y increases downward, so a line sloping DOWN to the right is positive.
    """
    return math.degrees(math.atan2(b.y - a.y, b.x - a.x))


def angle_diff_deg(a: float, b: float) -> float:
    """Signed (a - b) normalized to [-180, 180], handling the wrap boundary."""
    d = a - b
    while d > 180:
        d -= 360
    while d < -180:
        d += 360
    return d


def body_pair_angle_deg(subject_left: Point, subject_right: Point) -> float:
    """Angle of a subject left/right landmark pair in camera order (right->left)
    so a level body line reads ~0 deg rather than ~180 deg."""
    return line_angle_deg(subject_right, subject_left)


@dataclass(frozen=True)
class TiltReference:
    camera_tilt_deg: float
    confidence: str  # "high" | "low" | "insufficient"
    divergence_deg: Optional[float]


def compute_tilt_reference(lms: Landmarks) -> TiltReference:
    """Consensus camera-roll estimate from the hip line and ear line.

    Both agree within AGREEMENT_THRESHOLD_DEG -> average (high). One missing or
    the two diverging -> hip line, flagged low. Neither visible -> 0 deg.
    """
    left_hip = lms.get("left_hip")
    right_hip = lms.get("right_hip")
    left_ear = lms.get("left_ear")
    right_ear = lms.get("right_ear")

    hips_ok = pair_visible(left_hip, right_hip)
    ears_ok = pair_visible(left_ear, right_ear)

    if not hips_ok and not ears_ok:
        return TiltReference(0.0, "insufficient", None)

    if not hips_ok or not ears_ok:
        tilt = (body_pair_angle_deg(left_hip, right_hip) if hips_ok
                else body_pair_angle_deg(left_ear, right_ear))
        return TiltReference(tilt, "low", None)

    hip_angle = body_pair_angle_deg(left_hip, right_hip)
    ear_angle = body_pair_angle_deg(left_ear, right_ear)
    divergence = abs(angle_diff_deg(hip_angle, ear_angle))

    if divergence <= AGREEMENT_THRESHOLD_DEG:
        return TiltReference((hip_angle + ear_angle) / 2.0, "high", divergence)
    return TiltReference(hip_angle, "low", divergence)


def signed_neck_flexion_angle(lms: Landmarks, tilt: TiltReference) -> Optional[float]:
    """Tilt-corrected ear-line angle, degrees. positive -> head tilts to the
    patient's LEFT, negative -> RIGHT (matches poseMetrics.ts)."""
    left_ear = lms.get("left_ear")
    right_ear = lms.get("right_ear")
    if not pair_visible(left_ear, right_ear):
        return None
    raw = body_pair_angle_deg(left_ear, right_ear)
    return angle_diff_deg(raw, tilt.camera_tilt_deg)


def compute_neck_lateral_flexion_signed(lms: Landmarks, tilt: TiltReference) -> Optional[float]:
    """ex_004 primary metric. Bidirectional; side attribution is done from the
    sign at peak downstream, exactly as in the live camera loop."""
    return signed_neck_flexion_angle(lms, tilt)


def compute_scapular_elevation(lms: Landmarks, side: str) -> Optional[float]:
    """ex_003 primary metric: signed projection of the ear-from-shoulder offset
    onto the trunk-up axis, normalized by trunk length (trunk-length units).

    Returns the RAW projection; the caller subtracts a resting baseline and
    inverts the sign so a shrug reads positive (see process_clips / the live
    camera loop). Higher raw value = ear further above shoulder = NOT shrugging.
    """
    left_shoulder = lms.get("left_shoulder")
    right_shoulder = lms.get("right_shoulder")
    left_hip = lms.get("left_hip")
    right_hip = lms.get("right_hip")

    if not pair_visible(left_shoulder, right_shoulder):
        return None
    if not pair_visible(left_hip, right_hip):
        return None

    ear = lms.get("left_ear") if side == "left" else lms.get("right_ear")
    if ear is None or _vis(ear) < MIN_VIS:
        return None

    shoulder_mid_x = (left_shoulder.x + right_shoulder.x) / 2.0
    shoulder_mid_y = (left_shoulder.y + right_shoulder.y) / 2.0
    hip_mid_x = (left_hip.x + right_hip.x) / 2.0
    hip_mid_y = (left_hip.y + right_hip.y) / 2.0

    # Trunk-up vector (hip -> shoulder). y is down, so "up" is negative dy.
    trunk_vec_x = shoulder_mid_x - hip_mid_x
    trunk_vec_y = shoulder_mid_y - hip_mid_y
    trunk_len = math.hypot(trunk_vec_x, trunk_vec_y)
    if trunk_len < TRUNK_LEN_EPSILON:
        return None

    trunk_up_x = trunk_vec_x / trunk_len
    trunk_up_y = trunk_vec_y / trunk_len

    # Same-side shoulder preserves the asymmetric signal (one shoulder hiking
    # only moves that side's reading).
    same_shoulder = left_shoulder if side == "left" else right_shoulder
    ear_offset_x = ear.x - same_shoulder.x
    ear_offset_y = ear.y - same_shoulder.y

    projection = ear_offset_x * trunk_up_x + ear_offset_y * trunk_up_y
    return projection / trunk_len


def landmarks_from_mediapipe(arr) -> Landmarks:
    """Build a name-keyed Landmarks dict from a MediaPipe-indexed sequence whose
    items expose x/y/visibility (as dict keys or attributes). Used by the parity
    test, which reuses the TS test vectors (MediaPipe indices)."""
    from comparison.landmark_map import MEDIAPIPE_33

    def get(i):
        item = arr[i]
        if isinstance(item, dict):
            return Point(item["x"], item["y"], item.get("visibility", 1.0))
        return Point(item.x, item.y, getattr(item, "visibility", 1.0))

    return {name: (get(idx) if idx < len(arr) else None)
            for name, idx in MEDIAPIPE_33.items()}
