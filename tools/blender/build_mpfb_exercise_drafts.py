"""Animate additional exercise drafts from the saved, clothed MPFB figure.

Preserves the source file and mesh data. Choreography values describe authored
display poses, not clinical targets, scoring thresholds or prescribed timing.
This draft batch covers ex_004, ex_005, ex_006, ex_007 and ex_008.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_ex001_mpfb_figure import aim_bone, smoothstep


SIDE_BEND_PEAK_DEG = 42.0
# Side bend, by user direction 2026-09-25: one side only, so the clip does not
# suggest alternating. The trunk bends toward the figure's left; that arm
# dangles under gravity while the right hand rests on the right hip from the
# first frame to the last.
SIDE_BEND_HIP_SIDE = "r"
SIDE_BEND_HIP = {
    "palm_height": 0.99,           # palm centre on the waist, just over the top's hem
    "palm_depth": -0.02,           # front-back position of the palm centre
    "contact_gap": 0.002,          # nearest hand or forearm skin this far outside the garments
    "finger_direction": (0.0, -0.95, -0.30),  # fingers forward along the waist, above the hip's flare
    "elbow_pole": (1.0, 0.35, 0.10),          # elbow out to the side and a little back (x mirrored)
    "contact_bends": (0.0, 0.25, 0.5, 0.75, 1.0),  # bend shares at which the resting gap is solved
    "finger_flatten": 0.7,         # share of the relaxed finger curl let go while the hand rests
    "thumb_tilt_deg": 20.0,        # the thumb points back along the waist, tilted up by this much
    "thumb_lift": 0.1,             # and slightly out from it
}
SIDE_BEND_DANGLE_DEG = (12.0, 3.0)  # hanging arm's outward angle from vertical: upright, full bend

# Neck side bends, by user direction 2026-10-07 ("no stop at the middle and
# continuous", "a very small pause when its in the farthest though, about .3
# seconds") and 2026-10-09 ("make it slower, about 40BPM"): the head swings ear
# toward shoulder from side to side like a metronome's pendulum, arriving at one
# side on each beat, first the figure's left. Each swing eases out of one side
# and into the other, fastest through the centre and never stopping there, then
# holds briefly at the far side. At 45 frames per beat a 9-frame (0.3 s) hold
# would put the centre between two frames, so the hold is 8 frames (0.27 s).
# The clip holds whole cycles so its loop is seamless. The tilt is shared
# between the base of the neck and the head. The head's skin weights reach down
# the neck to about 1.44 m, so a larger head share kinks the neck under the jaw
# instead of bending it.
NECK_TILT_PEAK_DEG = 35.0
NECK_TILT_NECK_SHARE = 0.65
NECK_TILT_BPM = 40
NECK_TILT_PERIOD_FRAMES = round(2 * 60 * 30 / NECK_TILT_BPM)  # two beats per cycle at 30 fps
NECK_TILT_HOLD_FRAMES = 8                                     # about 0.3 s at each side
NECK_TILT_CYCLES = 3
assert NECK_TILT_PERIOD_FRAMES * NECK_TILT_BPM == 2 * 60 * 30, "a cycle must be a whole number of frames"
assert (NECK_TILT_PERIOD_FRAMES // 2 - NECK_TILT_HOLD_FRAMES + 1) % 2 == 0, "the swing must cross the centre on a frame"
# MakeHuman's neck weights reach across the top of the shoulders, so the tilt
# lifted the far shoulder's skin about 12 mm (and lowered the near one's) though
# no shoulder bone moves; the user saw it as an uncanny shoulder rise. In the
# built scene, neck_01's influence fades out between these distances from the
# midline (rest space), handed to spine_03.
NECK_TILT_WEIGHT_FADE_M = (0.05, 0.08)

# Wall angels: frontal-plane upper-arm angles from straight down and interior
# elbow angles (180 = straight) at the W rest and the Y top. They were chosen so
# that, replayed through the app's own metric on a 16:9 frame, the W stays well
# under the 70 re-arm threshold and the Y reaches about the 150 target. The
# replay is the evidence for that, not these constants.
WALL_ANGEL_ARM_DEG = (60.0, 140.0)
WALL_ANGEL_ELBOW_DEG = (90.0, 180.0)
WALL_ANGEL_ELBOW_EASE = 1.15       # the elbows straighten slightly ahead of the arm rise
WALL_ANGEL_RETRACTION_DEG = 15.0   # girdle drawn back toward the wall
WALL_GAP_M = 0.003                 # wall surface behind the rearmost torso or garment point
WALL_ARM_GAP_M = 0.006             # authored skin gap for the arms and the backs of the hands
WALL_SIDE_VIEW = {                 # the second repetition's camera, seen full frame
    "yaw_deg": 22.0,               # from straight side-on, turned toward the front to show the wall face
    "band": (0.08, 0.92, 0.05, 0.86),  # figure envelope limits as view fractions: x min/max, y min/max from the bottom
    "switch_frame": 235,           # first frame of the side-view repetition
}
WALL_REP_FRAMES = 234
WALL_POSTURE = True                # bring the upper back and head to the wall
WALL_POSTURE_GAP_M = 0.005         # upper back and back of the head, as physiotherapy guides ask
WALL_RGBA = (0.200, 0.190, 0.175, 1.0)

SPECS = {
    "ex_004": {
        # Active alternating neck tilts, as the app counts them (one counter
        # per side): a continuous side-to-side swing, one side per beat.
        "title": "Neck side bends", "frames": NECK_TILT_CYCLES * NECK_TILT_PERIOD_FRAMES,
        # Frame 1 is the centre; the left hold is frames 20-27 and the right
        # hold 65-72 of each 90-frame cycle.
        "peak_frame": 23,
        "phases": [(1, NECK_TILT_CYCLES * NECK_TILT_PERIOD_FRAMES, "Swing")],
        "checkpoints": [1, 10, 20, 27, 36, 46, 56, 65, 72, 81, 181],
        "guides": f"Draft preview | {NECK_TILT_BPM} beats per minute",
        "pose_note": "Head swings ear toward shoulder in the frontal plane from side to side, "
                     f"arriving at one side on each beat at {NECK_TILT_BPM} beats per minute, "
                     "starting at the centre toward the figure's left. Each swing eases out of "
                     "one side and into the other without stopping at the centre, then holds "
                     f"{NECK_TILT_HOLD_FRAMES} frames at the far side. "
                     f"{NECK_TILT_PEAK_DEG:g} degrees of head tilt relative to the trunk at each "
                     f"peak, {NECK_TILT_NECK_SHARE:g} of it at the base of the neck and the rest at "
                     "the head; the face keeps looking forward. The trunk, shoulders and arms "
                     "hold the source's neutral pose, and the feet and pelvis are fixed. "
                     "The tilt is a display choice, not a measured or prescribed range.",
    },
    "ex_005": {
        "title": "Standing side bends", "frames": 180,
        "phases": [(1, 20, "Ready"), (21, 79, "Bend"), (80, 100, "Pause"),
                   (101, 159, "Return"), (160, 180, "Ready")],
        "checkpoints": [1, 20, 35, 50, 65, 80, 100, 115, 130, 145, 180],
        "pose_note": "One-sided lateral spine bend toward the figure's left, one repetition "
                     "per loop; feet and pelvis fixed. "
                     f"{SIDE_BEND_PEAK_DEG:g} degrees distributed across three spine controls; "
                     "head and neck retain their neutral relation to the upper torso; "
                     "the left arm hangs under gravity while the right hand rests on the right "
                     "hip throughout, fingers forward and thumb back. "
                     "The driver value is not a measured trunk angle.",
    },
    "ex_006": {
        "title": "Arm hold at shoulder height", "frames": 300,
        "phases": [(1, 24, "Ready"), (25, 95, "Raise"), (96, 204, "Hold"),
                   (205, 275, "Lower"), (276, 300, "Ready")],
        "checkpoints": [1, 24, 48, 72, 96, 150, 204, 228, 252, 276, 300],
        "pose_note": "Uses the source lateral-raise shoulder poses, with "
                     "straight forearms and a longer illustrative hold. Actual hold "
                     "duration is set by the therapist.",
    },
    "ex_007": {
        "title": "Overhead shoulder press", "frames": 300, "peak_frame": 120,
        "phases": [(1, 24, "Ready"), (25, 119, "Press"), (120, 144, "Pause"),
                   (145, 239, "Lower"), (240, 300, "Ready")],
        "checkpoints": [1, 24, 48, 72, 96, 120, 144, 168, 192, 216, 300],
        "pose_note": "Bilateral bodyweight press from folded arms with wrists "
                     "level with their shoulders and closed fists. Each fist "
                     "travels vertically with a 15-degree elbow bend at the top. "
                     "Elbow path and shoulder roll are authored. No scapula bone or "
                     "clinical shoulder rhythm is modelled.",
    },
    "ex_008": {
        # Two identical repetitions: the first seen from the front, the
        # second from the side (the camera switches at the rest between them).
        # Short rests keep the two-view loop near 15 s; the slides keep the
        # press's 95-frame pace.
        "title": "Wall angels", "frames": 468, "peak_frame": 108,
        "phases": [(1, 12, "Ready"), (13, 107, "Slide up"), (108, 119, "Pause"),
                   (120, 214, "Slide down"), (215, 234, "Ready"),
                   (235, 246, "Ready"), (247, 341, "Slide up"), (342, 353, "Pause"),
                   (354, 448, "Slide down"), (449, 468, "Ready")],
        "checkpoints": [1, 12, 36, 60, 84, 108, 119, 143, 167, 191, 234],
        "pose_note": "Back against a wall; both arms slide in the wall's plane from a W "
                     f"(upper arms {WALL_ANGEL_ARM_DEG[0]:g} degrees from the sides, elbows "
                     f"{WALL_ANGEL_ELBOW_DEG[0]:g} degrees) up to a Y (upper arms "
                     f"{WALL_ANGEL_ARM_DEG[1]:g} degrees, elbows {WALL_ANGEL_ELBOW_DEG[1]:g}) and back. "
                     "Palms face forward and the elbows straighten ahead of the top. "
                     "Girdle elevation and retraction are authored; no scapula bone or "
                     "clinical shoulder rhythm is modelled.",
    },
}
ARM_FINGERS = ["index", "middle", "ring", "pinky", "thumb"]
MESH_NAMES = ("Figure_Body", "Figure_Top", "Figure_Shorts")
KEY_BONES = ["spine_01", "spine_02", "spine_03"] + [
    stem + "_" + side for side in ("l", "r")
    for stem in ("clavicle", "upperarm", "lowerarm", "hand")]
FINGER_BONES = [f"{finger}_{joint:02d}_{side}" for side in ["l", "r"]
                for finger in ["index", "middle", "ring", "pinky", "thumb"]
                for joint in [1, 2, 3]]


def mesh_digest(obj):
    points = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
    obj.data.vertices.foreach_get("co", points)
    return hashlib.sha256(points.tobytes()).hexdigest()


def stabilize_press_top(top):
    """Keep the sleeveless shirt attached to the shoulder girdle, not humeri.

    Transferred weights retain their sum. This is an exercise-specific garment
    adjustment; neither the body weights nor the original saved top are edited.
    """
    names = {g.index: g.name for g in top.vertex_groups}
    changed = 0
    for vertex in top.data.vertices:
        weights = {names[g.group]: g.weight for g in vertex.groups}
        for side in ["l", "r"]:
            arm, shoulder = "upperarm_" + side, "clavicle_" + side
            amount = weights.get(arm, 0)
            if amount > 0:
                top.vertex_groups[shoulder].add([vertex.index], weights.get(shoulder, 0) + amount, "REPLACE")
                top.vertex_groups[arm].remove([vertex.index])
                changed += 1
    return {"vertices_reweighted": changed, "transfer": "upperarm to same-side clavicle"}


def excursion(frame, start, peak, hold_end, end):
    if frame <= start or frame >= end:
        return 0.0
    if frame < peak:
        return smoothstep((frame - start) / (peak - start))
    if frame <= hold_end:
        return 1.0
    return smoothstep((end - frame) / (end - hold_end))


def rotate_world(pb, axis, radians):
    matrix = pb.matrix.copy()
    rotated = (Quaternion(axis, radians).to_matrix() @ matrix.to_3x3()).to_4x4()
    rotated.translation = matrix.translation
    pb.matrix = rotated


def press_girdle(rig, side, sign, progress, retraction=0.0):
    cb = rig.pose.bones["clavicle_" + side]
    rest = (cb.bone.tail_local-cb.bone.head_local).normalized()
    girdle = math.radians(22.0*progress)
    target = Vector((sign*abs(rest.x)*math.cos(girdle), rest.y, math.sin(girdle)))
    if retraction:
        # Swing the clavicle's horizontal reach back toward the wall. The
        # press passes no retraction, so its target is unchanged.
        back, reach = math.radians(retraction), abs(rest.x)*math.cos(girdle)
        target = Vector((sign*reach*math.cos(back), rest.y+reach*math.sin(back), math.sin(girdle)))
    aim_bone(cb, target)
    bpy.context.view_layer.update()


def press_solution(profile, shoulder, fist):
    """Solve the elbow around an effective lower segment ending at the fist.

    The effective segment includes the closed hand's fixed offset from the
    forearm. Targeting this point avoids a curved fist path even when a wrist
    target would follow a straight line. Hand-to-forearm alignment stays fixed.
    """
    delta = fist-shoulder
    distance = delta.length
    upper_length, lower_length = profile["upper_length"], profile["effective_length"]
    if not abs(upper_length-lower_length) < distance < upper_length+lower_length:
        raise RuntimeError("Press fist target is outside the arm's reach")
    axis = delta/distance
    along = (upper_length**2-lower_length**2+distance**2)/(2*distance)
    radius = math.sqrt(max(0., upper_length**2-along**2))
    pole = profile["pole"]-axis*profile["pole"].dot(axis)
    if pole.length < 1e-6:
        raise RuntimeError("Press elbow plane is undefined")
    elbow = shoulder+axis*along+pole.normalized()*radius
    swing = profile["effective_direction"].rotation_difference((fist-elbow).normalized())
    return elbow, swing


def press_profile(rig, neutral, fingers):
    """Keep the accepted folded start, then solve a vertical, unlocked finish."""
    for name, matrix in neutral.items():
        rig.pose.bones[name].matrix_basis = matrix
    for name, quaternion in fingers.items():
        rig.pose.bones[name].rotation_quaternion = quaternion
    bpy.context.view_layer.update()
    profiles = {}
    for side, sign in [("l", 1), ("r", -1)]:
        press_girdle(rig, side, sign, 0)
        upper, lower, hand = [rig.pose.bones[n+"_"+side] for n in ["upperarm", "lowerarm", "hand"]]
        upper_start = Vector((sign*math.sqrt(1-.91**2-.18**2), -.18, -.91))
        aim_bone(upper, upper_start)
        bpy.context.view_layer.update()
        rotate_world(upper, upper_start, math.radians(-sign*90.0))
        bpy.context.view_layer.update()
        fore_z = .91*upper.bone.length/lower.bone.length
        fore_x = -sign*.18
        fore_direction = Vector((fore_x, -math.sqrt(1-fore_z**2-fore_x**2), fore_z))
        aim_bone(lower, fore_direction)
        bpy.context.view_layer.update()
        aim_bone(hand, fore_direction)
        bpy.context.view_layer.update()
        fist = sum((rig.pose.bones[f"{finger}_01_{side}"].head for finger in
                    ["index", "middle", "ring", "pinky"]), Vector())/4
        effective = fist-lower.head
        profile = {"fist_start": fist.copy(), "upper_length": upper.bone.length,
                   "effective_length": effective.length,
                   "effective_direction": effective.normalized(),
                   "pole": upper.tail-upper.head,
                   "forearm_direction": (lower.tail-lower.head).normalized(),
                   "lower_rotation": lower.matrix.to_quaternion(),
                   "hand_basis": hand.matrix_basis.copy()}
        press_girdle(rig, side, sign, 1)
        shoulder = upper.head.copy()
        horizontal_sq = (fist.x-shoulder.x)**2+(fist.y-shoulder.y)**2
        low = max(fist.z, shoulder.z+.01)
        high = shoulder.z+math.sqrt((profile["upper_length"]+effective.length-1e-6)**2-horizontal_sq)

        def elbow_flexion(height):
            elbow, swing = press_solution(profile, shoulder, Vector((fist.x, fist.y, height)))
            return math.degrees((elbow-shoulder).angle(swing @ profile["forearm_direction"]))

        # The authored endpoint is deliberately short of full extension. Solve
        # actual upper-arm/forearm flexion, not the virtual segment's angle.
        if not elbow_flexion(high) < 15.0 < elbow_flexion(low):
            raise RuntimeError("Cannot bracket the requested soft-elbow finish")
        for _ in range(40):
            middle = (low+high)/2
            if elbow_flexion(middle) > 15.0:
                low = middle
            else:
                high = middle
        profile["lift"] = (low+high)/2-fist.z
        profiles[side] = profile
    return profiles


def hand_profile(rig, neutral, closed):
    """Author static finger controls in palm space, respecting bone roll.

    Finger hinge axes are derived from the saved hand geometry instead of
    assuming every finger shares a local Euler axis. The resulting local
    quaternions follow the hand through any arm pose.
    """
    for name, matrix in neutral.items():
        rig.pose.bones[name].matrix_basis = matrix
    bpy.context.view_layer.update()
    for side, sign in [("l", 1), ("r", -1)]:
        hand = rig.pose.bones["hand_" + side]
        index = rig.data.bones["index_01_" + side].head_local
        pinky = rig.data.bones["pinky_01_" + side].head_local
        middle = rig.data.bones["middle_01_" + side]
        forward = (middle.head_local - hand.bone.head_local).normalized()
        palm_normal = (-sign * (index-pinky).cross(forward)).normalized()
        along = (middle.tail_local-middle.head_local).normalized()
        for finger in ["index", "middle", "ring", "pinky"]:
            for joint, degrees in enumerate(([60, 85, 45] if closed else [12, 22, 12]), 1):
                pb = rig.pose.bones[f"{finger}_{joint:02d}_{side}"]
                rest = (pb.bone.tail_local-pb.bone.head_local).normalized()
                rotation = pb.bone.matrix_local.to_3x3()
                axis = (rotation.inverted() @ rest.cross(palm_normal)).normalized()
                curl = Quaternion(axis, math.radians(degrees))
                if joint == 1:
                    target = rest.lerp(along, .8 if closed else .55).normalized()
                    swing = rest.rotation_difference(target)
                    local_swing = rotation.inverted().to_quaternion() @ swing @ rotation.to_quaternion()
                    curl = local_swing @ curl
                pb.rotation_quaternion = curl
        bpy.context.view_layer.update()
        hand_delta = hand.matrix.to_3x3() @ hand.bone.matrix_local.to_3x3().inverted()
        normal, forward_world = hand_delta @ palm_normal, hand_delta @ forward
        if closed:
            index = rig.pose.bones["index_01_" + side].head.copy()
            middle = rig.pose.bones["middle_01_" + side].head.copy()
            ring = rig.pose.bones["ring_01_" + side].head.copy()
            targets = [index.lerp(middle, .2) + normal*.020,
                       middle + normal*.052 - forward_world*.015,
                       ring + normal*.052 - forward_world*.012]
            for joint, target in enumerate(targets, 1):
                thumb = rig.pose.bones[f"thumb_{joint:02d}_{side}"]
                aim_bone(thumb, target-thumb.head)
                bpy.context.view_layer.update()
        else:
            for joint, degrees in [(1, 12), (2, 18), (3, 12)]:
                pb = rig.pose.bones[f"thumb_{joint:02d}_{side}"]
                rest = (pb.bone.tail_local-pb.bone.head_local).normalized()
                axis = (pb.bone.matrix_local.to_3x3().inverted() @ rest.cross(palm_normal)).normalized()
                pb.rotation_quaternion = Quaternion(axis, math.radians(degrees))
    bpy.context.view_layer.update()
    return {name: rig.pose.bones[name].rotation_quaternion.copy() for name in FINGER_BONES}


def side_bend_trunk(rig, lean):
    # The pelvis and lower limbs are never keyed. Distributing the
    # bend lets the trunk curve while the neck follows the torso.
    for name, weight in [("spine_01", .40), ("spine_02", .35), ("spine_03", .25)]:
        rotate_world(rig.pose.bones[name], Vector((0, 1, 0)), math.radians(lean * weight))
        bpy.context.view_layer.update()


def neck_swing_deg(frame):
    """The swing's head tilt at a frame; positive tilts toward the figure's left.

    Each beat the head eases from one side to the other over the frames left
    after the hold, fastest through the centre, then holds NECK_TILT_HOLD_FRAMES
    frames at the far side. The beat's first held frame is its arrival. Frame 1
    is the centre on the way to the figure's left. The position is taken modulo
    the cycle, so repeated poses are bit-identical and render once.
    """
    beat = NECK_TILT_PERIOD_FRAMES // 2
    travel = beat - NECK_TILT_HOLD_FRAMES + 1      # frame steps from the last held frame to the next arrival
    t = (frame - 1 + travel // 2) % NECK_TILT_PERIOD_FRAMES
    toward = 1                                     # the first half-cycle swings toward the figure's left
    if t >= beat:
        t, toward = t - beat, -1
    if t < travel:
        return -toward * NECK_TILT_PEAK_DEG * math.cos(math.pi * t / travel)
    return toward * NECK_TILT_PEAK_DEG


def fade_neck_weights(obj):
    """Hand neck_01's weight on skin beside the neck to spine_03, which the neck side bends never move.

    The fade runs across NECK_TILT_WEIGHT_FADE_M from the midline, measured on the
    rest mesh, and keeps each vertex's weight sum. Only this scene's copy changes;
    the source file and the mesh coordinates do not.
    """
    inner, outer = NECK_TILT_WEIGHT_FADE_M
    names = {g.index: g.name for g in obj.vertex_groups}
    neck, spine = obj.vertex_groups["neck_01"], obj.vertex_groups["spine_03"]
    moved = 0
    for vertex in obj.data.vertices:
        weights = {names[g.group]: g.weight for g in vertex.groups}
        amount = weights.get("neck_01", 0.0)
        keep = 1.0 - smoothstep((abs((obj.matrix_world @ vertex.co).x) - inner) / (outer - inner))
        if amount <= 0 or keep >= 1.0:
            continue
        neck.add([vertex.index], amount * keep, "REPLACE")
        spine.add([vertex.index], weights.get("spine_03", 0.0) + amount * (1 - keep), "REPLACE")
        moved += 1
    return moved


def settle_neck_weights(scene):
    """Fade the neck's weights off the shoulders on the body and the top, and confirm
    the neutral pose's skin does not move (neck_01 and spine_03 are at rest there)."""
    body = scene.objects["Figure_Body"]
    saved = [(m, m.show_viewport) for m in body.modifiers]
    for modifier, _ in saved:
        modifier.show_viewport = True
    try:
        scene.frame_set(1)
        before = evaluated_points(body)
        moved = {name: fade_neck_weights(scene.objects[name]) for name in ["Figure_Body", "Figure_Top"]}
        after = evaluated_points(body)
    finally:
        for modifier, value in saved:
            modifier.show_viewport = value
    return {"fade_from_midline_m": list(NECK_TILT_WEIGHT_FADE_M), "from": "neck_01", "to": "spine_03",
            "vertices_reweighted": moved, "neutral_skin_change_mm": float(np.abs(after - before).max()) * 1000}


def neck_tilt(rig, tilt):
    """Tilt the head toward a shoulder; positive tilts toward the figure's left.

    Both rotations turn about the camera's axis, so the head moves only in the
    frontal plane and the face keeps looking forward. Nothing below the neck
    moves: the shoulders stay level and still.
    """
    for name, share in [("neck_01", NECK_TILT_NECK_SHARE), ("head", 1 - NECK_TILT_NECK_SHARE)]:
        rotate_world(rig.pose.bones[name], Vector((0, 1, 0)), math.radians(tilt * share))
        bpy.context.view_layer.update()


def garment_tree(scene):
    """BVH of the evaluated garments as they render."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    vertices, faces = [], []
    for name in ["Figure_Top", "Figure_Shorts"]:
        evaluated = scene.objects[name].evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            faces += [[len(vertices) + i for i in p.vertices] for p in mesh.polygons]
            vertices += [evaluated.matrix_world @ v.co for v in mesh.vertices]
        finally:
            evaluated.to_mesh_clear()
    return BVHTree.FromPolygons(vertices, faces)


def garment_clearance(tree, points):
    """Lowest signed distance of the points from the garments; negative is inside.

    A point beside an open hem, rather than over a face, counts at its
    unsigned distance: there the face normal says nothing about inside.
    """
    lowest = math.inf
    for point in points:
        near, normal, _, distance = tree.find_nearest(Vector(point))
        signed = (Vector(point) - near).dot(normal)
        lowest = min(lowest, signed if abs(signed) >= .5 * distance else distance)
    return lowest


def forearm_hand_skin(body, side):
    """Evaluated-mesh indices of one side's forearm, hand and finger skin, and the kept count.

    The mask keeps the "body" group's vertices in their original order, so a
    kept vertex's evaluated index is its rank among them.
    """
    names = {g.index: g.name for g in body.vertex_groups}
    bones = {f"{stem}_{side}" for stem in ["lowerarm", "hand"] +
             [f"{finger}_{joint:02d}" for finger in ARM_FINGERS for joint in [1, 2, 3]]}
    kept, ids = 0, []
    for vertex in body.data.vertices:
        weights = {names[g.group]: g.weight for g in vertex.groups}
        if weights.get("body", 0) <= 0:
            continue
        if sum(weights.get(b, 0) for b in bones) >= .5:
            ids.append(kept)
        kept += 1
    return np.array(ids), kept


def calibrate_side_bend_hands(scene, rig, neutral, fingers):
    """Solve where the hip hand rests.

    At the full bend away from that hand, rays over roughly the hand's
    footprint at the waist find the garments' outer surface. The palm faces
    their mean normal, with the fingers forward in the surface's tangent plane
    and the thumb laid back along the waist. How far out along the normal the
    palm sits is then solved at bend shares from upright to full, so the
    hand's and forearm's nearest skin stays SIDE_BEND_HIP["contact_gap"]
    outside the evaluated garments while the waist moves with the trunk.
    Everything is measured as it renders, masked body included: the garments
    shrink-wrap to the body, and unmasked helper shells would push them out.
    The saved-scene inspector independently measures every frame.
    """
    body = scene.objects["Figure_Body"]
    garments = [scene.objects[n] for n in ["Figure_Top", "Figure_Shorts"]]
    saved = [(m, m.show_viewport) for obj in [body] + garments for m in obj.modifiers]
    for modifier, _ in saved:
        modifier.show_viewport = True
    hip, record = {}, {}
    try:
        for side, sign in [(SIDE_BEND_HIP_SIDE, 1 if SIDE_BEND_HIP_SIDE == "l" else -1)]:
            skin, kept = forearm_hand_skin(body, side)
            if len(evaluated_points(body)) != kept:
                raise RuntimeError("The evaluated body does not match its mask's kept vertices")
            reset_pose(rig, neutral, fingers)
            side_bend_trunk(rig, -sign * SIDE_BEND_PEAK_DEG)
            tree, hits = garment_tree(scene), []
            # The palm faces the waist's mean surface normal over roughly the hand's footprint.
            for dy in [.02, 0, -.03]:
                for dz in [.025, 0, -.03]:
                    origin = Vector((sign * .5, SIDE_BEND_HIP["palm_depth"] + dy, SIDE_BEND_HIP["palm_height"] + dz))
                    hit, normal, _, _ = tree.ray_cast(origin, Vector((-sign, 0, 0)))
                    if hit is None:
                        raise RuntimeError("No garment surface at the hip for side " + side)
                    hits.append((hit, normal if normal.x * sign > 0 else -normal))
            point = hits[4][0]
            normal = sum((n for _, n in hits), Vector()).normalized()
            wanted = Vector(SIDE_BEND_HIP["finger_direction"]).normalized()
            target = {"point": point, "normal": normal,
                      "fingers": (wanted - normal * wanted.dot(normal)).normalized(),
                      "bends": list(SIDE_BEND_HIP["contact_bends"]), "gaps": [.03] * len(SIDE_BEND_HIP["contact_bends"])}
            # The thumb's rotations depend only on the hand's resting orientation, not its gap.
            reset_pose(rig, neutral, fingers)
            side_bend_trunk(rig, -sign * SIDE_BEND_PEAK_DEG)
            side_bend_arms(rig, -sign * SIDE_BEND_PEAK_DEG, {side: target})
            target["thumb"] = akimbo_thumb(rig, side, target)
            solved = []
            for share in SIDE_BEND_HIP["contact_bends"]:
                lean = -sign * SIDE_BEND_PEAK_DEG * share

                def clearance(gap):
                    target["gaps"] = [gap] * len(target["bends"])
                    reset_pose(rig, neutral, fingers)
                    side_bend_trunk(rig, lean)
                    side_bend_arms(rig, lean, {side: target})
                    return garment_clearance(garment_tree(scene), evaluated_points(body)[skin])

                low, high = 0.0, .08
                for _ in range(11):
                    middle = (low + high) / 2
                    low, high = (middle, high) if clearance(middle) < SIDE_BEND_HIP["contact_gap"] else (low, middle)
                if high > .079:
                    raise RuntimeError(f"The {side} hand cannot reach its hip without touching the garments elsewhere")
                solved.append({"bend_share": share, "palm_gap_m": high, "nearest_skin_mm": clearance(high) * 1000})
            target["gaps"] = [s["palm_gap_m"] for s in solved]
            hip[side] = target
            record[side] = {"surface_point": list(point), "surface_normal": list(normal),
                            "finger_direction": list(target["fingers"]), "contact": solved}
    finally:
        for modifier, value in saved:
            modifier.show_viewport = value
        reset_pose(rig, neutral, fingers)
    return hip, record


def two_bone_elbow(shoulder, wrist, upper_length, fore_length, pole):
    """Elbow position reaching the wrist target (or as close as the arm allows), bent toward the pole."""
    delta = wrist - shoulder
    distance = min(delta.length, (upper_length + fore_length) * .999)
    axis = delta.normalized()
    along = (upper_length**2 - fore_length**2 + distance**2) / (2 * distance)
    radius = math.sqrt(max(0., upper_length**2 - along**2))
    bend = (pole - axis * pole.dot(axis)).normalized()
    return shoulder + axis * along + bend * radius


def palm_normal_world(rig, side, sign):
    hand = rig.pose.bones["hand_" + side]
    index, pinky, middle = [rig.pose.bones[f"{n}_01_{side}"].head for n in ["index", "pinky", "middle"]]
    return (-sign * (index - pinky).cross((middle - hand.head).normalized())).normalized()


def palm_frame(forward, normal):
    """World rotation whose columns are the palm's long axis, its normal and their cross product."""
    forward = forward.normalized()
    normal = (normal - forward * normal.dot(forward)).normalized()
    return Matrix((forward, normal, forward.cross(normal))).transposed()


def hand_palm(rig, side, sign):
    """The posed hand's palm frame (wrist to middle knuckle, palm normal) and palm centre."""
    hand = rig.pose.bones["hand_" + side]
    index, middle, pinky = [rig.pose.bones[f"{n}_01_{side}"].head for n in ["index", "middle", "pinky"]]
    return palm_frame(middle - hand.head, palm_normal_world(rig, side, sign)), (index + pinky + hand.head) / 3


def side_bend_arms(rig, lean, hip):
    """Pose both arms for the one-sided side bend.

    The arm on the bending side hangs from its shoulder under gravity, easing
    from the upright spread to nearly vertical. The other hand rests on its hip
    throughout: palm on the waist, fingers forward, thumb back and elbow out.
    `hip` holds the resting hand's solved placement, keyed by its side.
    """
    bend = abs(lean) / SIDE_BEND_PEAK_DEG
    upright, bent = SIDE_BEND_DANGLE_DEG
    for side, sign in [("l", 1), ("r", -1)]:
        upper, lower, hand = [rig.pose.bones[n + "_" + side] for n in ["upperarm", "lowerarm", "hand"]]
        if side not in hip:
            spread = math.radians(upright + (bent - upright) * bend)
            hang = Vector((sign * math.sin(spread), 0, -math.cos(spread)))
            fore_hang = Vector((sign * math.sin(math.radians(10.0 - 4.0 * bend)), -.12, -1)).normalized()
            for pb, direction in [(upper, hang), (lower, fore_hang), (hand, fore_hang)]:
                aim_bone(pb, direction)
                bpy.context.view_layer.update()
            continue
        target = hip[side]
        frame, centre = hand_palm(rig, side, sign)
        offset = frame.transposed() @ (centre - hand.head)
        resting_frame = palm_frame(target["fingers"], -target["normal"])
        resting = resting_frame @ frame.transposed() @ hand.matrix.to_3x3()
        gap = float(np.interp(bend, target["bends"], target["gaps"]))
        wrist = target["point"] + target["normal"] * gap - resting_frame @ offset
        x, y, z = SIDE_BEND_HIP["elbow_pole"]
        elbow = two_bone_elbow(upper.head, wrist, upper.bone.length, lower.bone.length, Vector((sign * x, y, z)))
        aim_bone(upper, elbow - upper.head)
        bpy.context.view_layer.update()
        aim_bone(lower, wrist - lower.head)
        bpy.context.view_layer.update()
        matrix = resting.to_4x4()
        matrix.translation = hand.head
        hand.matrix = matrix
        bpy.context.view_layer.update()
        # Let the fingers lie flatter on the waist, and lay the thumb back
        # along it: a relaxed thumb would point into the body.
        for finger in ["index", "middle", "ring", "pinky"]:
            for joint in [1, 2, 3]:
                pb = rig.pose.bones[f"{finger}_{joint:02d}_{side}"]
                pb.rotation_quaternion = pb.rotation_quaternion.slerp(Quaternion(), SIDE_BEND_HIP["finger_flatten"])
        for name, rotation in target.get("thumb", {}).items():
            rig.pose.bones[name].rotation_quaternion = rotation
        bpy.context.view_layer.update()


def akimbo_thumb(rig, side, target):
    """Local thumb rotations, taken with the hand at rest on the hip, that lay
    the thumb back along the waist."""
    normal, forward = target["normal"], target["fingers"]
    up = normal.cross(forward)
    up = (up if up.z > 0 else -up).normalized()
    tilt = math.radians(SIDE_BEND_HIP["thumb_tilt_deg"])
    back = (-forward * math.cos(tilt) + up * math.sin(tilt) + normal * SIDE_BEND_HIP["thumb_lift"]).normalized()
    names = [f"thumb_{joint:02d}_{side}" for joint in [1, 2, 3]]
    relaxed = {name: rig.pose.bones[name].rotation_quaternion.copy() for name in names}
    rotations = {}
    for name in names:
        aim_bone(rig.pose.bones[name], back)
        bpy.context.view_layer.update()
        rotations[name] = rig.pose.bones[name].rotation_quaternion.copy()
    for name in names:
        rig.pose.bones[name].rotation_quaternion = relaxed[name]
    bpy.context.view_layer.update()
    return rotations


def wall_angel_progress(frame):
    """Slide position: 0 at the W rest, 1 at the Y top. Every repetition is the same."""
    return excursion((frame - 1) % WALL_REP_FRAMES + 1, 12, 108, 119, 215)


def wall_angel_targets(progress):
    """Frontal upper-arm angle, interior elbow angle and girdle progress."""
    (arm_w, arm_y), (elbow_w, elbow_y) = WALL_ANGEL_ARM_DEG, WALL_ANGEL_ELBOW_DEG
    arm = arm_w + (arm_y-arm_w)*progress
    elbow = elbow_w + (elbow_y-elbow_w)*(1-(1-progress)**WALL_ANGEL_ELBOW_EASE)
    # Elevation follows the arm at about the lateral raise's rate and reaches
    # the press's 22-degree girdle at the top.
    return arm, elbow, (arm-30.0)/(arm_y-30.0)


def set_bone_frame(pb, x_axis, y_axis):
    """Give a pose bone an exact orientation; its head stays where it is."""
    matrix = Matrix((x_axis, y_axis, x_axis.cross(y_axis))).transposed().to_4x4()
    matrix.translation = pb.head
    pb.matrix = matrix


def wall_angel_arm(rig, side, sign, arm_deg, elbow_deg, lean):
    """Pose one arm against the wall as a pure elbow hinge.

    The upper arm keeps its frontal-plane angle and leans back toward the wall
    by `lean`. The hinge axis is the camera-facing axis made perpendicular to
    it, so the forearm bends toward the head within the leaning arm's plane,
    the palm faces forward and the backs of the arm and hand face the wall.
    Deriving the hinge from the two segments instead would swing it sideways
    as the elbow straightens and twist the palm.
    """
    upper, lower, hand = [rig.pose.bones[n + "_" + side] for n in ["upperarm", "lowerarm", "hand"]]
    arm, bend = math.radians(arm_deg), math.radians(180.0-elbow_deg)
    along = Vector((sign*math.sin(arm), 0, -math.cos(arm)))
    upper_direction = along*math.sqrt(1-lean**2) + Vector((0, lean, 0))
    facing = Vector((0, -sign, 0))
    hinge = (facing - upper_direction*facing.dot(upper_direction)).normalized()
    fore_direction = upper_direction*math.cos(bend) + hinge.cross(upper_direction)*math.sin(bend)
    set_bone_frame(upper, hinge, upper_direction)
    bpy.context.view_layer.update()
    set_bone_frame(lower, hinge, fore_direction)
    bpy.context.view_layer.update()
    aim_bone(hand, fore_direction)
    bpy.context.view_layer.update()


def pose_wall_angel(rig, progress, lean):
    """Pose both girdles and arms for a slide position, starting from the neutral pose."""
    arm, elbow, girdle = wall_angel_targets(progress)
    for side, sign in [("l", 1), ("r", -1)]:
        press_girdle(rig, side, sign, girdle, WALL_ANGEL_RETRACTION_DEG)
        wall_angel_arm(rig, side, sign, arm, elbow, lean)


def reset_pose(rig, neutral, fingers, posture=None):
    for name, matrix in neutral.items():
        rig.pose.bones[name].matrix_basis = matrix
    for name, quaternion in fingers.items():
        rig.pose.bones[name].rotation_quaternion = quaternion
    bpy.context.view_layer.update()
    if posture:
        wall_posture(rig, *posture)


def wall_posture(rig, extension_deg, retraction_deg):
    """Bring the upper back and the back of the head to the wall; the pelvis and legs stay put.

    The thoracic extension is shared between spine_02 and spine_03. The neck
    retracts by extending neck_01 while the head flexes by the same amount, a
    chin tuck that keeps the face upright. Both are held for the whole clip.
    """
    right = Vector((1, 0, 0))
    for name, share in [("spine_02", .5), ("spine_03", .5)]:
        rotate_world(rig.pose.bones[name], right, -math.radians(extension_deg*share))
        bpy.context.view_layer.update()
    rotate_world(rig.pose.bones["neck_01"], right, -math.radians(retraction_deg))
    bpy.context.view_layer.update()
    rotate_world(rig.pose.bones["head"], right, math.radians(retraction_deg))
    bpy.context.view_layer.update()


def posterior_gap(points, wall_y, z_range, half_width):
    selected = points[(points[:, 2] >= z_range[0]) & (points[:, 2] < z_range[1]) & (np.abs(points[:, 0]) < half_width)]
    return wall_y - float(selected[:, 1].max())


def calibrate_wall_posture(scene, rig, neutral, fingers, wall_y):
    """Solve the extension and retraction that put the upper back and head WALL_POSTURE_GAP_M from the wall.

    Measured on exactly what renders - the masked body, the evaluated garments
    and any hair - at the W pose; the trunk and head do not move during the
    clip. (Unmasking the body would let MakeHuman's hidden helper shells, such
    as the hair helper, touch the wall instead of the visible surfaces.)
    """
    surfaces = [scene.objects[n] for n in MESH_NAMES] + [o for o in [scene.objects.get("Figure_Hair")] if o]
    saved = [(m, m.show_viewport) for obj in surfaces for m in obj.modifiers]
    for modifier, _ in saved:
        modifier.show_viewport = True
    upper_back, head = (1.12, 1.36, .16), (1.48, 1.72, .13)
    extension, retraction = 0., 0.

    def rendered_points():
        return np.vstack([evaluated_points(obj) for obj in surfaces])

    try:
        for _ in range(12):
            reset_pose(rig, neutral, fingers, (extension, retraction))
            points = rendered_points()
            back_gap = posterior_gap(points, wall_y, upper_back[:2], upper_back[2])
            head_gap = posterior_gap(points, wall_y, head[:2], head[2])
            # About 0.25 m of trunk above spine_02 and 0.1 m of neck act as the levers.
            extension += math.degrees(.7*(back_gap-WALL_POSTURE_GAP_M)/.25)
            retraction += math.degrees(.7*(head_gap-WALL_POSTURE_GAP_M)/.10)
            extension, retraction = min(12., max(0., extension)), min(15., max(0., retraction))
        reset_pose(rig, neutral, fingers, (extension, retraction))
        points = rendered_points()
        result = {"thoracic_extension_deg": extension, "neck_retraction_deg": retraction,
                  "upper_back_gap_mm": posterior_gap(points, wall_y, upper_back[:2], upper_back[2])*1000,
                  "head_gap_mm": posterior_gap(points, wall_y, head[:2], head[2])*1000}
    finally:
        for modifier, value in saved:
            modifier.show_viewport = value
    return (extension, retraction), result


def wall_lean_at(fit, progress):
    return float(np.polyval(fit, progress))


def evaluated_points(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        co = np.empty(len(mesh.vertices)*3, dtype=np.float64)
        mesh.vertices.foreach_get("co", co)
        world = np.array(evaluated.matrix_world)
        return co.reshape(-1, 3) @ world[:3, :3].T + world[:3, 3]
    finally:
        evaluated.to_mesh_clear()


def arm_skin(body):
    """Unmasked body vertices dominated by an arm, hand or finger bone."""
    names = {g.index: g.name for g in body.vertex_groups}
    stems = ["upperarm", "lowerarm", "hand"] + [f"{finger}_{joint:02d}" for finger in ARM_FINGERS for joint in [1, 2, 3]]
    arm_groups = {f"{stem}_{side}" for stem in stems for side in ["l", "r"]}
    return np.array([vertex.index for vertex in body.data.vertices
                     if any(names[g.group] == "body" and g.weight > 0 for g in vertex.groups)
                     and sum(g.weight for g in vertex.groups if names[g.group] in arm_groups) >= .5])


def calibrate_wall_lean(scene, rig, neutral, fingers, wall_y, posture=None, knots=9):
    """Solve how far the arms lean back so their nearest skin sits WALL_ARM_GAP_M from the wall.

    Solved at evenly spaced slide positions on the body deformed by the rig
    alone, then fitted with a cubic so the lean changes smoothly. The saved-scene
    inspector independently measures the wall clearance of every frame.
    """
    body = scene.objects["Figure_Body"]
    saved = [(m, m.show_viewport) for m in body.modifiers]
    for modifier in body.modifiers:
        # Keep original vertex indices: deform with the rig, skip the mask.
        modifier.show_viewport = modifier.type == "ARMATURE"
    arm_ids = arm_skin(body)
    target = wall_y - WALL_ARM_GAP_M
    reach = rig.pose.bones["upperarm_l"].bone.length + rig.pose.bones["lowerarm_l"].bone.length
    solved = []
    try:
        for progress in np.linspace(0, 1, knots):
            lean = .15
            for _ in range(15):
                reset_pose(rig, neutral, fingers, posture)
                pose_wall_angel(rig, float(progress), lean)
                gap = target - evaluated_points(body)[arm_ids, 1].max()
                lean = min(.6, max(0., lean + .7*gap/(.6*reach)))
            reset_pose(rig, neutral, fingers, posture)
            pose_wall_angel(rig, float(progress), lean)
            points = evaluated_points(body)[arm_ids]
            nearest = int(points[:, 1].argmax())
            solved.append({"progress": float(progress), "lean": lean,
                           "arm_gap_mm": float(wall_y - points[nearest, 1])*1000,
                           "nearest_point": points[nearest].round(4).tolist()})
    finally:
        for modifier, value in saved:
            modifier.show_viewport = value
    fit = np.polyfit([s["progress"] for s in solved], [s["lean"] for s in solved], 3).tolist()
    return fit, solved


def rearmost_point(scene):
    return max(float(evaluated_points(scene.objects[n])[:, 1].max()) for n in MESH_NAMES)


def add_wall(scene, wall_y):
    """A plain matte wall facing the camera, for the figure to stand against.

    A source with the upgraded studio backdrop lends the wall its material, so
    the wall matches the other clips' background.
    """
    mesh = bpy.data.meshes.new("Exercise wall")
    mesh.from_pydata([(-4., wall_y, 0.), (4., wall_y, 0.), (4., wall_y, 4.5), (-4., wall_y, 4.5)],
                     [], [(0, 1, 2, 3)])
    # A perpendicular wall at the far end turns the side view's background
    # into a room corner instead of the open set past the wall's edge. The
    # front camera never sees it.
    corner = bpy.data.meshes.new("Room corner")
    corner.from_pydata([(-4., wall_y, 0.), (-4., wall_y, 4.5), (-4., wall_y - 8., 4.5), (-4., wall_y - 8., 0.)],
                       [], [(0, 1, 2, 3)])
    material = bpy.data.materials.get("Studio backdrop")
    if material is None:
        material = bpy.data.materials.new("Wall paint")
        material.use_nodes = True
        shader = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        shader.inputs["Base Color"].default_value = WALL_RGBA
        shader.inputs["Roughness"].default_value = .92
        if "Specular IOR Level" in shader.inputs:
            shader.inputs["Specular IOR Level"].default_value = .12
    mesh.materials.append(material)
    corner.materials.append(material)
    wall = bpy.data.objects.new("Exercise_Wall", mesh)
    scene.collection.objects.link(wall)
    scene.collection.objects.link(bpy.data.objects.new("Room corner", corner))
    return wall


def make_animation(scene, rig, exercise, source_poses, wall_fit=None, posture=None, hip=None):
    neutral = source_poses[1]
    rig.animation_data_clear()
    fingers = (hand_profile(rig, neutral, exercise == "ex_007")
               if exercise in ["ex_005", "ex_007", "ex_008"] else {})
    press = press_profile(rig, neutral, fingers) if exercise == "ex_007" else {}
    rig.animation_data_create()
    rig.animation_data.action = bpy.data.actions.new(exercise + "_figure_draft")
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    previous = {}
    for frame in range(1, scene.frame_end + 1):
        scene.frame_set(frame)
        pose = neutral
        if exercise == "ex_006":
            source_frame = (1 if frame <= 24 or frame >= 276 else
                            frame if frame <= 96 else
                            96 if frame <= 204 else 96 - (frame - 204))
            pose = source_poses[source_frame]
        for name, matrix in pose.items():
            rig.pose.bones[name].matrix_basis = matrix
        for name, quaternion in fingers.items():
            rig.pose.bones[name].rotation_quaternion = quaternion
        bpy.context.view_layer.update()
        if exercise == "ex_006":
            for side in ["l", "r"]:
                upper = rig.pose.bones["upperarm_" + side]
                direction = upper.tail - upper.head
                aim_bone(rig.pose.bones["lowerarm_" + side], direction)
                bpy.context.view_layer.update()
                aim_bone(rig.pose.bones["hand_" + side], direction)
                bpy.context.view_layer.update()
        elif exercise == "ex_004":
            neck_tilt(rig, neck_swing_deg(frame))
        elif exercise == "ex_005":
            # One bend per loop, away from the hip hand.
            away = 1 if SIDE_BEND_HIP_SIDE == "r" else -1
            lean = away * SIDE_BEND_PEAK_DEG * excursion(frame, 20, 80, 100, 160)
            side_bend_trunk(rig, lean)
            side_bend_arms(rig, lean, hip)
        elif exercise == "ex_007":
            progress = excursion(frame, 24, 120, 144, 240)
            for side, sign in [("l", 1), ("r", -1)]:
                press_girdle(rig, side, sign, progress)
                upper = rig.pose.bones["upperarm_" + side]
                profile = press[side]
                fist = profile["fist_start"]+Vector((0, 0, profile["lift"]*progress))
                elbow, swing = press_solution(profile, upper.head, fist)
                direction = (elbow-upper.head).normalized()
                aim_bone(upper, direction)
                bpy.context.view_layer.update()
                # Ease the upper-arm twist as it rises. Holding the folded
                # start's full roll overhead pinches this figure's shoulder
                # surface. The solved lower arm keeps the fist path unchanged.
                rotate_world(upper, direction, math.radians(-sign*(90.0-45.0*progress)))
                bpy.context.view_layer.update()
                lower = rig.pose.bones["lowerarm_" + side]
                matrix = (swing @ profile["lower_rotation"]).to_matrix().to_4x4()
                matrix.translation = lower.head
                lower.matrix = matrix
                rig.pose.bones["hand_" + side].matrix_basis = profile["hand_basis"]
                bpy.context.view_layer.update()
        elif exercise == "ex_008":
            if posture:
                wall_posture(rig, *posture)
            progress = wall_angel_progress(frame)
            pose_wall_angel(rig, progress, wall_lean_at(wall_fit, progress))
        # Only the neck side bends and the wall-angel posture move the neck and
        # head, so only they key them.
        extra = ["neck_01", "head"] if exercise == "ex_004" or (exercise == "ex_008" and posture) else []
        for name in KEY_BONES + extra + list(fingers):
            pb = rig.pose.bones[name]
            q = pb.rotation_quaternion.copy()
            if name in previous and q.dot(previous[name]) < 0:
                q.negate()
                pb.rotation_quaternion = q
            previous[name] = q
            pb.keyframe_insert("rotation_quaternion", frame=frame, group=name)
        if frame % 60 == 0:
            print(f"DRAFT_KEYED={exercise}:{frame}/{scene.frame_end}", flush=True)


def fit_camera(scene):
    # Fit an envelope of the actual skinned body. The independent saved-scene
    # inspector also measures the evaluated garments through every frame.
    body = scene.objects["Figure_Body"]
    xyz_min = np.full(3, np.inf)
    xyz_max = np.full(3, -np.inf)
    for frame in range(1, scene.frame_end + 1):
        scene.frame_set(frame)
        obj = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = obj.to_mesh()
        try:
            coordinates = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
            mesh.vertices.foreach_get("co", coordinates)
            points = coordinates.reshape(-1, 3)
            xyz_min = np.minimum(xyz_min, points.min(axis=0))
            xyz_max = np.maximum(xyz_max, points.max(axis=0))
        finally:
            obj.to_mesh_clear()
    span = max((xyz_max[2] - xyz_min[2]) / .79,
               (xyz_max[0] - xyz_min[0]) / .84 * 980 / 870)
    distance = span * scene.camera.data.lens / scene.camera.data.sensor_height - xyz_min[1]
    scene.camera.location = ((xyz_min[0] + xyz_max[0]) / 2, -distance,
                             (xyz_min[2] + xyz_max[2]) / 2 + .035 * span)
    scene.camera.rotation_euler = (math.pi / 2, 0, 0)
    bpy.context.view_layer.update()
    return {"body_envelope_min": xyz_min.tolist(), "body_envelope_max": xyz_max.tolist(),
            "camera_location": list(scene.camera.location), "frames_measured": scene.frame_end}


def add_side_camera(scene, spec, step=5):
    """A full-frame side camera for the second repetition, switched in by a timeline marker.

    It looks from the figure's left, turned toward the front so the wall's face
    shows. Its distance is solved in closed form from the skinned body's
    envelope sampled through the animation, so the figure stays inside the same
    view limits as the front camera's (the saved-scene inspector re-checks
    every frame with whichever camera is active). A lens shift moves the band
    below the title area. The camera gets its own labels.
    """
    body = scene.objects["Figure_Body"]
    points = []
    for frame in range(1, WALL_REP_FRAMES + 1, step):
        scene.frame_set(frame)
        points.append(evaluated_points(body))
    points = np.vstack(points)
    target = (points.min(axis=0) + points.max(axis=0)) / 2
    yaw = math.radians(WALL_SIDE_VIEW["yaw_deg"])
    forward = Vector((-math.cos(yaw), math.sin(yaw), 0.0))
    data = bpy.data.cameras.new("Side camera")
    data.lens, data.sensor_fit = 35.0, "VERTICAL"
    camera = bpy.data.objects.new("Side camera", data)
    scene.collection.objects.link(camera)
    camera.rotation_euler = forward.to_track_quat("-Z", "Y").to_euler()
    basis = camera.rotation_euler.to_matrix()
    right, up = np.array(basis.col[0]), np.array(basis.col[1])
    ahead = np.array(forward)
    x0, x1, y0, y1 = WALL_SIDE_VIEW["band"]
    half_h = data.sensor_height / 2 / data.lens
    half_w = half_h * scene.render.resolution_x / scene.render.resolution_y
    rel = points - target
    depth = rel @ ahead
    distance = float(max((np.abs(rel @ right) / ((x1 - x0) * half_w) - depth).max(),
                         (np.abs(rel @ up) / ((y1 - y0) * half_h) - depth).max()))
    camera.location = Vector(target) - forward * distance
    # Shift is measured in the frame's larger dimension (its height here).
    data.shift_x = .5 - (x0 + x1) / 2
    data.shift_y = .5 - (y0 + y1) / 2
    bpy.context.view_layer.update()
    main = scene.camera
    labels(scene, spec, camera=camera, prefix="Side preview ",
           guides="Side view | Draft preview | Timing is illustrative", markers=False)
    for name, frame, view in [("Front view", 1, main), ("Side view", WALL_SIDE_VIEW["switch_frame"], camera)]:
        scene.timeline_markers.new(name, frame=frame).camera = view
    return {"camera": camera.name, "main_camera": main.name, "location": list(camera.location),
            "rotation_euler": list(camera.rotation_euler), "lens_mm": data.lens,
            "shift": [data.shift_x, data.shift_y],
            **{k: list(v) if isinstance(v, tuple) else v for k, v in WALL_SIDE_VIEW.items()}}


def labels(scene, spec, camera=None, prefix="Preview ", guides="Draft preview | Timing is illustrative",
           markers=True):
    camera = camera or scene.camera
    for obj in list(scene.objects):
        if obj.name.startswith(prefix):
            bpy.data.objects.remove(obj, do_unlink=True)
    if markers:
        scene.timeline_markers.clear()
    corners = [v / abs(v.z) for v in camera.data.view_frame(scene=scene)]
    xmin, xmax = min(v.x for v in corners), max(v.x for v in corners)
    ymin, ymax = min(v.y for v in corners), max(v.y for v in corners)
    material = bpy.data.materials.get("Figure preview text")
    if material is None:
        raise RuntimeError("Source preview text material is missing")

    def text(name, body, x, y, size, align="LEFT"):
        data = bpy.data.curves.new(name, "FONT")
        data.body, data.align_x = body, align
        data.size = size / scene.render.resolution_y * (ymax - ymin)
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.parent = camera
        obj.location = (xmin + x * (xmax - xmin), ymin + y * (ymax - ymin), -1)
        obj.data.materials.append(material)
        obj.visible_shadow = False
        return obj

    text(prefix + "title", spec["title"], .065, .951, 28)
    text(prefix + "guides", guides, .065, .910, 19)
    for start, end, word in spec["phases"]:
        obj = text(f"{prefix}phase {start:03d}", word, .935, .951, 25, "RIGHT")
        for frame in sorted({1, start, end + 1, scene.frame_end + 1}):
            obj.hide_render = obj.hide_viewport = not (start <= frame <= end)
            obj.keyframe_insert("hide_render", frame=frame)
            obj.keyframe_insert("hide_viewport", frame=frame)
        if markers:
            scene.timeline_markers.new(word, frame=start)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--exercise", nargs="+", choices=list(SPECS), default=list(SPECS))
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    source = args.source.resolve()
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    outputs = [args.output_dir / f"{ex}_figure_mpfb.blend" for ex in args.exercise]
    if len(set(args.exercise)) != len(args.exercise):
        parser.error("Exercise IDs must be unique")
    if any(p.exists() or p.resolve() == source for p in outputs):
        parser.error("Use fresh outputs; existing scenes are never overwritten")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for exercise, output in zip(args.exercise, outputs):
        bpy.ops.wm.open_mainfile(filepath=str(source))
        scene = bpy.context.scene
        rig = scene.objects["Figure_Rig"]
        original_meshes = {n: mesh_digest(scene.objects[n]) for n in MESH_NAMES}
        garment_adjustment = (stabilize_press_top(scene.objects["Figure_Top"])
                              if exercise in ["ex_007", "ex_008"] else None)
        wall = hip = None
        if exercise == "ex_008":
            # The trunk, pelvis and legs never move, so the source's first frame
            # fixes the rearmost evaluated point of the body and garments.
            scene.frame_set(1)
            rear = rearmost_point(scene)
            wall = {"surface_y_m": rear + WALL_GAP_M, "rearmost_point_y_m": rear,
                    "torso_gap_m": WALL_GAP_M, "arm_skin_gap_target_m": WALL_ARM_GAP_M,
                    "retraction_deg": WALL_ANGEL_RETRACTION_DEG}
        # Disable costly evaluated surfaces while authoring bone controls.
        states = [(m, m.show_viewport) for n in MESH_NAMES for m in scene.objects[n].modifiers]
        for modifier, _ in states:
            modifier.show_viewport = False
        source_poses = {}
        for frame in range(1, 97):
            scene.frame_set(frame)
            source_poses[frame] = {pb.name: pb.matrix_basis.copy() for pb in rig.pose.bones}
        spec = SPECS[exercise]
        scene.frame_start, scene.frame_end = 1, spec["frames"]
        scene.render.fps, scene.render.fps_base = 30, 1.0
        scene.render.resolution_x, scene.render.resolution_y = 870, 980
        scene.render.resolution_percentage = 100
        wall_fit = posture = None
        if wall is not None:
            rig.animation_data_clear()
            relaxed = hand_profile(rig, source_poses[1], False)
            if WALL_POSTURE:
                # The posture moves the shoulders, so it is solved before the arms.
                posture, posture_record = calibrate_wall_posture(scene, rig, source_poses[1], relaxed,
                                                                 wall["surface_y_m"])
                wall["posture"] = posture_record
            wall_fit, solved = calibrate_wall_lean(scene, rig, source_poses[1], relaxed,
                                                   wall["surface_y_m"], posture)
            wall.update({"arm_lean_cubic": wall_fit, "arm_lean_calibration": solved})
        if exercise == "ex_005":
            rig.animation_data_clear()
            hip, hip_record = calibrate_side_bend_hands(scene, rig, source_poses[1],
                                                        hand_profile(rig, source_poses[1], False))
        neck_weights = settle_neck_weights(scene) if exercise == "ex_004" else None
        make_animation(scene, rig, exercise, source_poses, wall_fit, posture, hip)
        for modifier, value in states:
            modifier.show_viewport = value
        # Only the body is needed for camera fitting; restore garments before
        # saving and before the independent full-silhouette check.
        garment_states = [(m, m.show_viewport) for n in MESH_NAMES[1:] for m in scene.objects[n].modifiers]
        for modifier, _ in garment_states:
            modifier.show_viewport = False
        camera_fit = fit_camera(scene)
        for modifier, value in garment_states:
            modifier.show_viewport = value
        labels(scene, spec, **({"guides": spec["guides"]} if "guides" in spec else {}))
        if wall is not None:
            add_wall(scene, wall["surface_y_m"])
            wall["side_view"] = add_side_camera(scene, spec)
            scene["side_view"] = json.dumps(wall["side_view"])
        if any(mesh_digest(scene.objects[n]) != original_meshes[n] for n in MESH_NAMES):
            raise RuntimeError("Source mesh coordinates changed")
        for key in [k for k in scene.keys() if k.startswith("figure_camera_fit")]:
            del scene[key]
        revision = ("mpfb-neck-side-bends-40bpm-level-shoulders-2026-10-09" if exercise == "ex_004" else
                    "mpfb-side-bend-hands-2026-09-25" if exercise == "ex_005" else
                    "mpfb-straight-press-2026-09-15" if exercise == "ex_007" else
                    "mpfb-wall-angels-2026-09-25" if exercise == "ex_008" else
                    "mpfb-exercise-feedback-2026-09-14")
        manifest = {"exercise": exercise, "revision": revision,
                    "source_file": source.name, "source_sha256": source_hash,
                    "frames": spec["frames"], "fps": 30, "status": "animation draft",
                    "phases": spec["phases"], "checkpoints": spec["checkpoints"],
                    "peak_frame": spec.get("peak_frame", 96),
                    "pose_note": spec["pose_note"], "mesh_vertex_sha256": original_meshes,
                    "garment_weight_adjustment": garment_adjustment,
                    "camera_fit": camera_fit,
                    "scope": "Presentation asset only; no product integration or clinical validation."}
        if wall is not None:
            manifest["wall"] = wall
        if hip is not None:
            manifest["side_bend_hands"] = {"hip_side": SIDE_BEND_HIP_SIDE, "hip_rest": hip_record,
                                           **{k: list(v) if isinstance(v, tuple) else v for k, v in SIDE_BEND_HIP.items()},
                                           "dangle_spread_deg": list(SIDE_BEND_DANGLE_DEG)}
        if exercise == "ex_004":
            manifest["neck_tilt"] = {"peak_deg": NECK_TILT_PEAK_DEG, "neck_share": NECK_TILT_NECK_SHARE,
                                     "axis": "camera axis (world Y); positive toward the figure's left",
                                     "order": ["left", "right"], "bpm": NECK_TILT_BPM,
                                     "period_frames": NECK_TILT_PERIOD_FRAMES, "cycles": NECK_TILT_CYCLES,
                                     "hold_frames": NECK_TILT_HOLD_FRAMES,
                                     "waveform": "half-cosine swing from side to side, arriving at one side per "
                                                 "beat and holding there; frame 1 is the centre toward the figure's left"}
            manifest["neck_weight_adjustment"] = neck_weights
        scene["exercise_draft"] = json.dumps(manifest)
        if exercise != "ex_006":
            scene["figure_source_girdle_scale"] = scene.get("figure_girdle_scale", .475)
            if "figure_girdle_scale" in scene:
                del scene["figure_girdle_scale"]
            scene["figure_hand_pose"] = "neutral wrist; " + (
                "closed fist" if exercise == "ex_007" else
                "relaxed fingers, palms forward" if exercise == "ex_008" else
                "hands as in the source's first frame" if exercise == "ex_004" else "relaxed fingers")
        scene.frame_set(1)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.wm.save_as_mainfile(filepath=str(output.resolve()))
        output.with_suffix(".json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print("DRAFT_SAVED=" + str(output), flush=True)
    if hashlib.sha256(source.read_bytes()).hexdigest() != source_hash:
        raise RuntimeError("Original figure changed during the build")


if __name__ == "__main__":
    main()
