"""
normalization_audit.py — does the frame aspect ratio distort the clinical angles?

FINDING THIS MODULE EXISTS TO SUPPORT
-------------------------------------
MediaPipe Pose Landmarker returns landmarks NORMALIZED as x/frameWidth and
y/frameHeight. On a non-square frame those two divisors differ, so normalized
space is anisotropically scaled and an angle measured with `atan2` in it is NOT
the angle in real space. Every clinical angle in
`web/src/lib/pose/poseMetrics.ts` is computed with `lineAngleDeg`, which is
`atan2` over exactly those coordinates, and no aspect correction is applied
anywhere in that file.

Consequences, all reproduced by `main()` below on a 1280x720 frame (k = W/H =
1.778):

  * Near-HORIZONTAL lines are AMPLIFIED by k. `shoulderSymmetry` and
    `neckTilt` are near-horizontal line angles.
  * Near-VERTICAL lines are COMPRESSED by 1/k. `trunkLean` is a near-vertical
    line angle.
  * So two metrics that DECLARE the same 5-degree warning threshold fire at
    true 2.82 deg (`shoulderSymmetry`) and true 8.85 deg (`trunkLean`) — a
    factor of k-squared apart, about 3.1x.
  * Shoulder abduction is exact at 90 deg only, because arm-horizontal and
    trunk-vertical are both axis-aligned there. The ex_006 band of 90 +/- 10
    admits true 84.35 to 95.65, i.e. +/-5.65 anatomical degrees.
  * The tilt reference is built from the hip and ear lines (both near-
    horizontal) and applied to the trunk line (near-vertical). Those two
    orientation classes distort reciprocally, so camera roll is NOT fully
    cancelled for `trunkLean`: a 10-degree camera roll produces a -11.74
    degree trunk-lean reading on an upright subject.

HOW TO FALSIFY ANY CLAIM ABOVE
-------------------------------
Every fixture is built in ISOTROPIC PIXEL space, where the true angle is known
by construction, and then normalized exactly the way MediaPipe does. A SQUARE
frame is the control: it must reproduce truth for every metric. If the control
ever fails, the fixture is wrong and the numbers must be discarded — that
happened once during development (see `build_trunk_lean`'s docstring).

A SEPARATE, non-aspect finding also reproduced here: `neckTilt` reads HALF its
true value while the ear and hip lines agree within 3 degrees, because
`computeTiltReference` averages those two lines and `neckTilt` is the ear line
minus that average. Visible in the square control, so it is not an aspect
effect. See `demo_neck_tilt_halving`.

WHAT THIS MODULE IS NOT
-----------------------
It measures the MATHEMATICS of the formulas under perfect landmarks. It says
nothing about how well MediaPipe places landmarks on real bodies; that needs
real imagery and independent annotation. It changes no product behaviour and
imports nothing from the web app — the ports below are transcriptions of
`poseMetrics.ts`, kept deliberately verbatim so a reviewer can diff them by eye.

Run:  python -m comparison.normalization_audit
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

# Mirrors the TS constants of the same name.
MIN_VIS = 0.5
AGREEMENT_THRESHOLD_DEG = 3.0
TRUNK_LEN_EPSILON = 0.05


@dataclass(frozen=True)
class P:
    """A landmark. Coordinates are whatever space the caller is working in."""
    x: float
    y: float
    vis: float = 1.0


# ---------------------------------------------------------------------------
# Verbatim ports of poseMetrics.ts helpers. Do not "improve" these — their
# value is that they match the TypeScript line for line.
# ---------------------------------------------------------------------------
def line_angle_deg(a: P, b: P) -> float:
    return math.degrees(math.atan2(b.y - a.y, b.x - a.x))


def angle_diff_deg(a: float, b: float) -> float:
    d = a - b
    while d > 180:
        d -= 360
    while d < -180:
        d += 360
    return d


def body_pair_angle_deg(subject_left: P, subject_right: P) -> float:
    return line_angle_deg(subject_right, subject_left)


def in_frame01(p: P) -> bool:
    return 0.0 <= p.x <= 1.0 and 0.0 <= p.y <= 1.0


def tilt_reference(L: dict) -> tuple[float, str, float]:
    """Port of computeTiltReference. Returns (cameraTiltDeg, confidence, divergence)."""
    hip = body_pair_angle_deg(L["left_hip"], L["right_hip"])
    ear = body_pair_angle_deg(L["left_ear"], L["right_ear"])
    divergence = abs(angle_diff_deg(hip, ear))
    if divergence <= AGREEMENT_THRESHOLD_DEG:
        return (hip + ear) / 2, "high", divergence
    return hip, "low", divergence


def neck_tilt(L: dict, tilt: float) -> float:
    """Port of signedNeckFlexionAngle."""
    return angle_diff_deg(body_pair_angle_deg(L["left_ear"], L["right_ear"]), tilt)


def shoulder_symmetry(L: dict, tilt: float) -> float:
    """Port of computeShoulderSymmetry's corrected angle (before Math.abs)."""
    return angle_diff_deg(
        body_pair_angle_deg(L["left_shoulder"], L["right_shoulder"]), tilt)


def _midpoints(L: dict) -> tuple[P, P]:
    sm = P((L["left_shoulder"].x + L["right_shoulder"].x) / 2,
           (L["left_shoulder"].y + L["right_shoulder"].y) / 2)
    hm = P((L["left_hip"].x + L["right_hip"].x) / 2,
           (L["left_hip"].y + L["right_hip"].y) / 2)
    return sm, hm


def trunk_lean(L: dict, tilt: float) -> float:
    """Port of signedTrunkLeanAngle: tilt-corrected, then expressed vs vertical."""
    sm, hm = _midpoints(L)
    return angle_diff_deg(angle_diff_deg(line_angle_deg(hm, sm), tilt), -90)


def shoulder_abduction(L: dict, side: str) -> Optional[float]:
    """Port of computeShoulderAbduction. computeShoulderHorizAbduction (the
    ex_006 T-pose primary) delegates to this verbatim, and the TS takes its
    tiltRef parameter UNUSED — so camera roll cannot affect it directly."""
    sh = L["left_shoulder"] if side == "left" else L["right_shoulder"]
    el = L["left_elbow"] if side == "left" else L["right_elbow"]
    sm, hm = _midpoints(L)
    signed = angle_diff_deg(line_angle_deg(sh, el), line_angle_deg(sm, hm))
    lateral = -signed if side == "left" else signed
    if lateral <= -180 + 1e-9:
        return 180.0
    return None if lateral < 0 else lateral


def elbow_flexion(L: dict, side: str) -> float:
    """Port of computeElbowFlexion. Interior angle; 180 = straight."""
    sh = L["left_shoulder"] if side == "left" else L["right_shoulder"]
    el = L["left_elbow"] if side == "left" else L["right_elbow"]
    wr = L["left_wrist"] if side == "left" else L["right_wrist"]
    return abs(angle_diff_deg(line_angle_deg(el, sh), line_angle_deg(el, wr)))


def scapular_elevation(L: dict, side: str) -> Optional[float]:
    """Port of computeScapularElevation. Trunk-length units, not an angle."""
    sm, hm = _midpoints(L)
    tvx, tvy = sm.x - hm.x, sm.y - hm.y
    tlen = math.hypot(tvx, tvy)
    if tlen < TRUNK_LEN_EPSILON:
        return None
    ux, uy = tvx / tlen, tvy / tlen
    ear = L["left_ear"] if side == "left" else L["right_ear"]
    sh = L["left_shoulder"] if side == "left" else L["right_shoulder"]
    return ((ear.x - sh.x) * ux + (ear.y - sh.y) * uy) / tlen


# ---------------------------------------------------------------------------
# Fixtures. Built in ISOTROPIC PIXEL space so every "*_deg" argument is TRUE by
# construction, then normalized the way MediaPipe does.
# ---------------------------------------------------------------------------
def normalize(L: dict, W: float, H: float) -> dict:
    """Exactly what MediaPipe hands the application: x/W, y/H."""
    return {k: P(p.x / W, p.y / H, p.vis) for k, p in L.items()}


def rescale_x(L: dict, W: float, H: float) -> dict:
    """THE CANDIDATE FIX. Rescales x by W/H to restore isotropy. A mathematical
    identity: it undoes the anisotropic squash exactly, at no cost in the
    observability of the underlying landmarks."""
    k = W / H
    return {key: P(p.x * k, p.y, p.vis) for key, p in L.items()}


def build_body(W, H, *, neck_tilt_deg=0.0, shoulder_tilt_deg=0.0,
               trunk_lean_deg=0.0, arm_elev_deg=90.0, elbow_flex_deg=180.0,
               camera_roll_deg=0.0) -> dict:
    """Girdles perpendicular to the trunk axis. `trunk_lean_deg` here tilts the
    WHOLE body including the pelvis, which the hip-line tilt reference then
    absorbs — use `build_trunk_lean` for the clinical lean case instead."""
    cx, cy = W / 2.0, H * 0.32
    sw, hw, ew, tl, ual, fal = 200.0, 150.0, 150.0, 300.0, 170.0, 160.0
    t = math.radians(90.0 + trunk_lean_deg)
    sm = P(cx, cy)
    hm = P(cx + tl * math.cos(t), cy + tl * math.sin(t))

    def pair(mid: P, width: float, extra_deg: float) -> tuple[P, P]:
        a = t - math.radians(90.0) + math.radians(extra_deg)
        return (P(mid.x + (width / 2) * math.cos(a), mid.y + (width / 2) * math.sin(a)),
                P(mid.x - (width / 2) * math.cos(a), mid.y - (width / 2) * math.sin(a)))

    ls, rs = pair(sm, sw, shoulder_tilt_deg)
    lh, rh = pair(hm, hw, 0.0)
    head = P(sm.x - 90.0 * math.cos(t), sm.y - 90.0 * math.sin(t))
    le, re = pair(head, ew, neck_tilt_deg)
    a_l = t - math.radians(arm_elev_deg)
    a_r = t + math.radians(arm_elev_deg)
    lel = P(ls.x + ual * math.cos(a_l), ls.y + ual * math.sin(a_l))
    rel = P(rs.x + ual * math.cos(a_r), rs.y + ual * math.sin(a_r))
    bend = math.radians(180.0 - elbow_flex_deg)
    lwr = P(lel.x + fal * math.cos(a_l - bend), lel.y + fal * math.sin(a_l - bend))
    rwr = P(rel.x + fal * math.cos(a_r + bend), rel.y + fal * math.sin(a_r + bend))
    L = {"left_shoulder": ls, "right_shoulder": rs, "left_hip": lh, "right_hip": rh,
         "left_ear": le, "right_ear": re, "left_elbow": lel, "right_elbow": rel,
         "left_wrist": lwr, "right_wrist": rwr}
    if camera_roll_deg:
        c, s = math.cos(math.radians(camera_roll_deg)), math.sin(math.radians(camera_roll_deg))
        L = {k: P(cx + (p.x - cx) * c - (p.y - cy) * s,
                  cy + (p.x - cx) * s + (p.y - cy) * c, p.vis) for k, p in L.items()}
    return L


def build_trunk_lean(W, H, lean_deg: float) -> dict:
    """Trunk lean with a LEVEL PELVIS — the clinical case, where the ribcage
    shifts over the hips.

    DEVELOPMENT NOTE, kept deliberately: the first version of this fixture
    rotated the pelvis along with the trunk. The hip-line tilt reference then
    absorbed the entire lean and the SQUARE CONTROL read 0.00 at every angle,
    which is how the error was caught. Any fixture whose control does not
    reproduce truth is wrong; discard its numbers rather than reporting them.
    """
    cx, cy = W / 2.0, H * 0.32
    tl, sw, hw, ew = 300.0, 200.0, 150.0, 150.0
    t = math.radians(90.0 + lean_deg)
    sm = P(cx, cy)
    hm = P(cx + tl * math.cos(t), cy + tl * math.sin(t))
    return {
        "left_hip": P(hm.x + hw / 2, hm.y), "right_hip": P(hm.x - hw / 2, hm.y),
        "left_shoulder": P(sm.x + sw / 2, sm.y), "right_shoulder": P(sm.x - sw / 2, sm.y),
        "left_ear": P(sm.x - 90.0 * math.cos(t) + ew / 2, sm.y - 90.0 * math.sin(t)),
        "right_ear": P(sm.x - 90.0 * math.cos(t) - ew / 2, sm.y - 90.0 * math.sin(t)),
    }


FRAMES = (("16:9 1280x720", 1280, 720),
          ("4:3  640x480", 640, 480),
          ("1:1  720x720 CONTROL", 720, 720))


# ---------------------------------------------------------------------------
# Reportable quantities. Each returns numbers; `main()` only formats them, so
# the tests can assert on the same values a reader sees.
# ---------------------------------------------------------------------------
def effective_threshold(declared_deg: float, W: float, H: float,
                        orientation: str) -> float:
    """The TRUE angle at which a DECLARED threshold actually fires.

    A near-horizontal line reads atan(tan(true) * k); inverting it gives the
    true angle that produces a reading of `declared`. Near-vertical lines use
    the reciprocal.
    """
    k = W / H
    t = math.tan(math.radians(declared_deg))
    return math.degrees(math.atan(t / k if orientation == "horizontal" else t * k))


def band_true_span(lo_deg: float, hi_deg: float, W: float, H: float,
                   step: float = 0.05) -> tuple[float, float]:
    """The TRUE arm elevations admitted by a reading band, by sweeping truth."""
    found_lo = found_hi = None
    t = 20.0
    while t < 160.0:
        v = shoulder_abduction(normalize(build_body(W, H, arm_elev_deg=t), W, H), "left")
        if v is not None and lo_deg <= v <= hi_deg:
            if found_lo is None:
                found_lo = t
            found_hi = t
        t += step
    return found_lo, found_hi


def demo_neck_tilt_halving(W=720, H=720):
    """NOT an aspect effect — reproduces in the square control.

    `computeTiltReference` averages the hip and ear lines when they diverge by
    at most AGREEMENT_THRESHOLD_DEG, and `neckTilt` is the ear line minus that
    average, so with level hips it reads exactly half. Above the threshold the
    reference falls back to hips-only and the reading becomes correct, which
    makes the transfer function DISCONTINUOUS at the agreement boundary.
    """
    out = []
    for true_deg in (1.0, 2.0, 3.0, 3.01, 5.0, 8.0):
        L = normalize(build_body(W, H, neck_tilt_deg=true_deg), W, H)
        tilt, conf, div = tilt_reference(L)
        out.append((true_deg, neck_tilt(L, tilt), conf, div))
    return out


def main() -> None:
    print("=" * 96)
    print("NORMALIZATION AUDIT — square frame is the control and MUST reproduce truth")
    print("=" * 96)

    print("\n1. NEAR-HORIZONTAL vs NEAR-VERTICAL: identical declared thresholds, different effect")
    for name, thr, orient in (("shoulderSymmetry", 5, "horizontal"),
                              ("neckTilt", 5, "horizontal"),
                              ("trunkLean", 5, "vertical"),
                              ("trunkLean (ex_004)", 3, "vertical")):
        row = f"   {name:22s} declared {thr:>2} deg ->"
        for label, W, H in FRAMES:
            row += f"  {label.split()[0]:>4}: true {effective_threshold(thr, W, H, orient):5.2f}"
        print(row)

    print("\n2. SHOULDER ABDUCTION / ex_006 T-POSE BAND (reading 80-100)")
    for label, W, H in FRAMES:
        lo, hi = band_true_span(80.0, 100.0, W, H)
        print(f"   {label:24s} admits TRUE {lo:6.2f} to {hi:6.2f}  (span {hi - lo:5.2f} vs nominal 20.00)")

    print("\n3. TRUNK LEAN, LEVEL PELVIS (the clinical case)")
    for true_deg in (2, 3, 5, 8, 12):
        row = f"   true {true_deg:2d} deg ->"
        for label, W, H in FRAMES:
            L = normalize(build_trunk_lean(W, H, true_deg), W, H)
            tilt, _, _ = tilt_reference(L)
            row += f"  {label.split()[0]:>4}: {trunk_lean(L, tilt):6.2f}"
        print(row)

    print("\n4. CAMERA ROLL — is it cancelled? (upright, level subject)")
    for roll in (0, 3, 6, 10):
        row = f"   roll {roll:2d} deg ->"
        for label, W, H in FRAMES:
            L = normalize(build_body(W, H, camera_roll_deg=roll), W, H)
            tilt, _, _ = tilt_reference(L)
            row += f"  {label.split()[0]:>4}: sym {shoulder_symmetry(L, tilt):5.2f} lean {trunk_lean(L, tilt):6.2f}"
        print(row)

    print("\n5. NECK TILT HALVING (square control — NOT an aspect effect)")
    for true_deg, reading, conf, div in demo_neck_tilt_halving():
        print(f"   true {true_deg:5.2f} deg -> reads {reading:5.2f}  (tiltRef confidence {conf}, divergence {div:5.2f})")

    print("\n6. THE CANDIDATE FIX: rescale x by W/H, then recompute")
    for true_deg in (80, 90, 100):
        L = build_body(1280, 720, arm_elev_deg=true_deg)
        before = shoulder_abduction(normalize(L, 1280, 720), "left")
        after = shoulder_abduction(rescale_x(normalize(L, 1280, 720), 1280, 720), "left")
        print(f"   true {true_deg:3d} deg -> current {before:6.2f}   aspect-fixed {after:6.2f}")


if __name__ == "__main__":
    main()
