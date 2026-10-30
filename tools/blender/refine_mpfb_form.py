"""Create separate neck/press pose candidates from a saved presentation scene.

Only arm and hand controls change. Existing animation outside those controls,
mesh coordinates/weights, appearance, camera and timing are preserved. These
are illustrative display choices, not clinical targets. Never overwrites.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_mpfb_exercise_drafts as draft
from polish_mpfb_presentation import mesh_digest, weights_digest

ARM_BONES = [f'{stem}_{side}' for side in ['l', 'r']
             for stem in ['upperarm', 'lowerarm', 'hand']] + draft.FINGER_BONES

# Press start, by user direction 2026-10-11 ("The shoulder press starting form
# should be deeper, with hands slightly above the shoulder, in line with the
# neck"): the wrists start just above the shoulder joints and the fists beside
# the neck. This figure's forearm and fist are longer than its upper arm, so a
# vertical forearm could only bring the fists this low with the elbow folded
# past about 150 degrees; the forearms lean slightly outward instead. The
# wrist height also leaves the press counter room to re-arm: it completes a
# repetition only when the wrist returns below 0.05 trunk lengths above the
# shoulder, and a rendered start 25 mm up, replayed through the camera loop,
# read as much as 0.047 on one side.
DEEP_PRESS_START = {
    'wrist_above_shoulder_m': .015,  # wrist joint above the shoulder joint
    'elbow_flexion_deg': 144.,       # 0 is a straight elbow
    'plane_anterior_deg': 20.,       # shoulder-to-wrist direction, forward of the frontal plane
}

# Resting arms for the neck demo, by user direction 2026-10-11 ("The resting
# hands on the neck side bends seems to be in an unnatural position"). The
# earlier open hand kept the rig's rest thumb, which pointed into the thigh,
# and its arms angled out to keep the curled fingers off the shorts. Now the
# arms hang close to the body with the hands beside the thighs: palms toward
# them, fingers in a soft cascade and the thumb along the index finger.
RELAXED_ARMS = {
    'upper_spread_deg': 9.,        # upper arm out from vertical
    'upper_forward_deg': 3.,       # and forward
    'forearm_forward_deg': 10.,    # forearm forward of vertical: a soft elbow
    'palm_back_deg': 15.,          # palm toward the thigh, turned slightly back
    'hand_gap_m': .004,            # nearest hand or forearm skin outside the clothes
    'forearm_out_deg': (4., 16.),  # outward forearm angles searched for that gap
}
RELAXED_CURLS = {'index': (8, 12, 6), 'middle': (11, 16, 8), 'ring': (14, 20, 10), 'pinky': (17, 24, 12)}
RELAXED_FINGER_CLOSE = .85  # share of each finger's base turned onto the middle finger's line
# Each thumb bone aims at a point beside the index finger: a mix of the index
# joints (1 knuckle, 2 and 3 the next joints), then offsets in metres toward
# the thumb side and in front of the palm.
RELAXED_THUMB = [({1: 1.}, .018, .012), ({2: 1.}, .014, .010), ({2: .5, 3: .5}, .011, .008)]


def arm_snapshot(rig):
    result = {}
    for side in ['l', 'r']:
        upper, lower, hand = [rig.pose.bones[f'{stem}_{side}'] for stem in ['upperarm', 'lowerarm', 'hand']]
        fore = hand.head - lower.head
        hum = lower.head - upper.head
        result[side] = {'shoulder': list(upper.head), 'elbow': list(lower.head), 'wrist': list(hand.head),
                        'upper_arm_from_vertical_deg': math.degrees(math.atan2(math.hypot(hum.x, hum.y), hum.z)),
                        'forearm_from_vertical_deg': math.degrees(math.atan2(math.hypot(fore.x, fore.y), fore.z)),
                        'wrist_shoulder_horizontal_offset_mm': math.hypot(hand.head.x - upper.head.x, hand.head.y - upper.head.y) * 1000,
                        'wrist_ahead_of_elbow_mm': -fore.y * 1000,
                        'forearm_sagittal_lean_deg': math.degrees(math.atan2(-fore.y, fore.z)),
                        'upper_plane_anterior_deg': math.degrees(math.atan2(-hum.y, abs(hum.x))),
                        'wrist_above_shoulder_mm': (hand.head.z - upper.head.z) * 1000}
    return result


def neutral_hip_hands(scene, rig, neutral):
    """Fit both resting palms to the evaluated, upright clothed figure."""
    fingers = draft.hand_profile(rig, neutral, False)
    body = scene.objects['Figure_Body']
    saved = [(m, m.show_viewport) for o in scene.objects if o.type == 'MESH' for m in o.modifiers]
    for modifier, _ in saved:
        modifier.show_viewport = True
    hip, record = {}, {}
    try:
        for side, sign in [('l', 1), ('r', -1)]:
            draft.reset_pose(rig, neutral, fingers)
            skin, kept = draft.forearm_hand_skin(body, side)
            if len(draft.evaluated_points(body)) != kept:
                raise RuntimeError('Unexpected evaluated skin mask')
            tree, hits = draft.garment_tree(scene), []
            for dy in [.02, 0, -.03]:
                for dz in [.025, 0, -.03]:
                    origin = Vector((sign * .5, draft.SIDE_BEND_HIP['palm_depth'] + dy,
                                     draft.SIDE_BEND_HIP['palm_height'] + dz))
                    hit, normal, _, _ = tree.ray_cast(origin, Vector((-sign, 0, 0)))
                    if hit is None:
                        raise RuntimeError('Missing hip garment surface')
                    hits.append((hit, normal if normal.x * sign > 0 else -normal))
            point = hits[4][0]
            normal = sum((n for _, n in hits), Vector()).normalized()
            wanted = Vector(draft.SIDE_BEND_HIP['finger_direction']).normalized()
            target = {'point': point, 'normal': normal,
                      'fingers': (wanted - normal * wanted.dot(normal)).normalized(),
                      'bends': [0, 1], 'gaps': [.03, .03]}
            draft.side_bend_arms(rig, 0, {side: target})
            target['thumb'] = draft.akimbo_thumb(rig, side, target)

            def clearance(gap):
                target['gaps'] = [gap, gap]
                draft.reset_pose(rig, neutral, fingers)
                draft.side_bend_arms(rig, 0, {side: target})
                return draft.garment_clearance(draft.garment_tree(scene), draft.evaluated_points(body)[skin])

            low, high = 0., .08
            for _ in range(12):
                middle = (low + high) / 2
                low, high = (middle, high) if clearance(middle) < .002 else (low, middle)
            if high > .079:
                raise RuntimeError('Hand cannot rest at hip without garment intersection')
            gap = clearance(high)
            hip[side] = target
            record[side] = {'surface_point': list(point), 'surface_normal': list(normal),
                            'palm_gap_m': high, 'nearest_skin_mm': gap * 1000}
        draft.reset_pose(rig, neutral, fingers)
        draft.side_bend_arms(rig, 0, hip)
        # Recheck with BOTH hands placed, including their effect on the top.
        for side in hip:
            skin, _ = draft.forearm_hand_skin(body, side)
            gap = draft.garment_clearance(draft.garment_tree(scene), draft.evaluated_points(body)[skin])
            if gap < .0018:
                raise RuntimeError('Bilateral resting-hand clearance failed')
            record[side]['bilateral_nearest_skin_mm'] = gap * 1000
        pose = {name: rig.pose.bones[name].matrix_basis.copy() for name in ARM_BONES}
    finally:
        for modifier, value in saved:
            modifier.show_viewport = value
    return pose, record


def neutral_hanging_arms(scene, rig, neutral):
    """Let both arms hang beside the thighs, with soft elbows and loose hands."""
    fingers = draft.hand_profile(rig, neutral, False)
    draft.reset_pose(rig, neutral, fingers)
    body = scene.objects['Figure_Body']
    states = [(m, m.show_viewport) for obj in scene.objects if obj.type == 'MESH' for m in obj.modifiers]
    for modifier, _ in states: modifier.show_viewport = modifier.show_render
    record = {}

    def place(side, sign, spread):
        for name in ARM_BONES:
            if name.endswith('_' + side): rig.pose.bones[name].matrix_basis = neutral[name]
        for name, rotation in fingers.items():
            if name.endswith('_' + side): rig.pose.bones[name].rotation_quaternion = rotation
        bpy.context.view_layer.update()
        upper, lower, hand = [rig.pose.bones[f'{n}_{side}'] for n in ['upperarm', 'lowerarm', 'hand']]
        upper_direction = Vector((sign * math.sin(math.radians(spread)), 0, -math.cos(math.radians(spread))))
        forearm_direction = Vector((sign * math.sin(math.radians(10)), -math.sin(math.radians(5)), -1)).normalized()
        for bone, direction in [(upper, upper_direction), (lower, forearm_direction)]:
            draft.aim_bone(bone, direction)
            bpy.context.view_layer.update()
        frame, _ = draft.hand_palm(rig, side, sign)
        wanted = draft.palm_frame(forearm_direction, Vector((-sign, 0, 0)))
        matrix = (wanted @ frame.transposed() @ hand.matrix.to_3x3()).to_4x4()
        matrix.translation = hand.head
        hand.matrix = matrix
        bpy.context.view_layer.update()
    try:
        # The small outward forearm angle lets the fingers clear the shorts
        # while the upper arms remain close to the body. Check both arms in
        # place: the clothes are evaluated against the complete posed body.
        for side, sign in [('l', 1), ('r', -1)]:
            place(side, sign, 12.)
        tree, points = draft.garment_tree(scene), draft.evaluated_points(body)
        for side, sign in [('l', 1), ('r', -1)]:
            skin, kept = draft.forearm_hand_skin(body, side)
            if len(points) != kept:
                raise RuntimeError('Unexpected evaluated skin mask')
            gap = draft.garment_clearance(tree, points[skin])
            if gap < .003:
                raise RuntimeError('Cannot fit a relaxed arm beside the clothing')
            record[side] = {'upper_arm_spread_deg': 12., 'nearest_garment_mm': gap * 1000,
                            'palm_normal': list(draft.palm_normal_world(rig, side, sign)),
                            'wrist': list(rig.pose.bones['hand_' + side].head), 'fingers': 'loose curl, palm toward thigh'}
    finally:
        for modifier, value in states: modifier.show_viewport = value
    return {name: rig.pose.bones[name].matrix_basis.copy() for name in ARM_BONES}, record


def relaxed_finger_curls(rig, side, sign):
    """Curl the fingers softly toward the palm, more toward the little finger.

    Authored in palm space from the saved hand geometry, as hand_profile does,
    so the local rotations hold through any arm pose.
    """
    hand = rig.data.bones['hand_' + side]
    index, pinky = [rig.data.bones[f'{n}_01_{side}'].head_local for n in ['index', 'pinky']]
    middle = rig.data.bones['middle_01_' + side]
    forward = (middle.head_local - hand.head_local).normalized()
    palm_normal = (-sign * (index - pinky).cross(forward)).normalized()
    along = (middle.tail_local - middle.head_local).normalized()
    for finger, angles in RELAXED_CURLS.items():
        for joint, degrees in enumerate(angles, 1):
            pb = rig.pose.bones[f'{finger}_{joint:02d}_{side}']
            rest = (pb.bone.tail_local - pb.bone.head_local).normalized()
            rotation = pb.bone.matrix_local.to_3x3()
            curl = Quaternion((rotation.inverted() @ rest.cross(palm_normal)).normalized(), math.radians(degrees))
            if joint == 1:
                swing = rest.rotation_difference(rest.lerp(along, RELAXED_FINGER_CLOSE).normalized())
                curl = rotation.inverted().to_quaternion() @ swing @ rotation.to_quaternion() @ curl
            pb.rotation_quaternion = curl
    bpy.context.view_layer.update()


def relaxed_thumb(rig, side, sign):
    """Lay the thumb along the index finger's side, slightly in front of the palm.

    The rig's rest thumb stands away from the palm; kept in a hanging hand it
    pointed into the thigh.
    """
    hand = rig.pose.bones['hand_' + side]
    index, middle, pinky = [rig.pose.bones[f'{n}_01_{side}'].head for n in ['index', 'middle', 'pinky']]
    forward = (middle - hand.head).normalized()
    normal = (-sign * (index - pinky).cross(forward)).normalized()
    radial = index - pinky
    radial = (radial - forward * radial.dot(forward) - normal * radial.dot(normal)).normalized()
    joints = [rig.pose.bones[f'index_{j:02d}_{side}'] for j in [1, 2, 3]]
    points = {j: joints[j - 1].head.copy() for j in [1, 2, 3]}
    for joint, (mix, out, palmar) in enumerate(RELAXED_THUMB, 1):
        target = sum((points[j] * share for j, share in mix.items()), Vector()) + radial * out + normal * palmar
        pb = rig.pose.bones[f'thumb_{joint:02d}_{side}']
        draft.aim_bone(pb, target - pb.head)
        bpy.context.view_layer.update()


def relaxed_hanging_arms(scene, rig, neutral):
    """Hang both arms close to the body with the hands resting beside the thighs.

    The forearm's outward angle is solved so the nearest hand or forearm skin
    stays RELAXED_ARMS['hand_gap_m'] outside the evaluated clothes: close
    enough to read as resting against the thigh, never inside the shorts.
    """
    fingers = draft.hand_profile(rig, neutral, False)
    body = scene.objects['Figure_Body']
    states = [(m, m.show_viewport) for obj in scene.objects if obj.type == 'MESH' for m in obj.modifiers]
    for modifier, _ in states: modifier.show_viewport = modifier.show_render
    spec = RELAXED_ARMS
    spread, lean = math.radians(spec['upper_spread_deg']), math.radians(spec['upper_forward_deg'])
    back = math.radians(spec['palm_back_deg'])

    def place(out_deg):
        draft.reset_pose(rig, neutral, fingers)
        for side, sign in [('l', 1), ('r', -1)]:
            upper, lower, hand = [rig.pose.bones[f'{n}_{side}'] for n in ['upperarm', 'lowerarm', 'hand']]
            upper_direction = Vector((sign * math.sin(spread), -math.sin(lean),
                                      -math.cos(spread) * math.cos(lean))).normalized()
            forearm_direction = Vector((sign * math.tan(math.radians(out_deg)),
                                        -math.tan(math.radians(spec['forearm_forward_deg'])), -1)).normalized()
            for bone, direction in [(upper, upper_direction), (lower, forearm_direction)]:
                draft.aim_bone(bone, direction)
                bpy.context.view_layer.update()
            # The hand continues the forearm; its palm faces the thigh.
            frame, _ = draft.hand_palm(rig, side, sign)
            wanted = draft.palm_frame(forearm_direction, Vector((-sign * math.cos(back), math.sin(back), 0)))
            matrix = (wanted @ frame.transposed() @ hand.matrix.to_3x3()).to_4x4()
            matrix.translation = hand.head
            hand.matrix = matrix
            bpy.context.view_layer.update()
            relaxed_finger_curls(rig, side, sign)
            relaxed_thumb(rig, side, sign)

    def gaps():
        # Both arms in place: the clothes are evaluated on the whole posed body.
        tree, points = draft.garment_tree(scene), draft.evaluated_points(body)
        result = {}
        for side in ['l', 'r']:
            skin, kept = draft.forearm_hand_skin(body, side)
            if len(points) != kept:
                raise RuntimeError('Unexpected evaluated skin mask')
            result[side] = draft.garment_clearance(tree, points[skin])
        return result

    try:
        low, high = spec['forearm_out_deg']
        place(high)
        if min(gaps().values()) < spec['hand_gap_m']:
            raise RuntimeError('Cannot fit a relaxed hand beside the clothing')
        for _ in range(14):
            middle = (low + high) / 2
            place(middle)
            low, high = (middle, high) if min(gaps().values()) < spec['hand_gap_m'] else (low, middle)
        place(high)
        final = gaps()
        record = {}
        for side, sign in [('l', 1), ('r', -1)]:
            upper, lower, hand = [rig.pose.bones[f'{n}_{side}'] for n in ['upperarm', 'lowerarm', 'hand']]
            tip = rig.pose.bones['thumb_03_' + side].tail
            index = [rig.pose.bones[f'index_{j:02d}_{side}'].head for j in [2, 3]]
            record[side] = {**{k: v for k, v in spec.items() if k != 'forearm_out_deg'},
                            'forearm_out_deg': high, 'nearest_garment_mm': final[side] * 1000,
                            'elbow_flexion_deg': math.degrees((lower.head - upper.head).angle(hand.head - lower.head)),
                            'palm_normal': list(draft.palm_normal_world(rig, side, sign)),
                            'wrist': list(hand.head), 'finger_curls_deg': RELAXED_CURLS,
                            'thumb_tip_to_index_middle_joint_mm': ((index[0] + index[1]) / 2 - tip).length * 1000,
                            'fingers': 'soft cascade, palm toward thigh, thumb along the index finger'}
    finally:
        for modifier, value in states: modifier.show_viewport = value
    return {name: rig.pose.bones[name].matrix_basis.copy() for name in ARM_BONES}, record


def deep_press_profile(rig, neutral):
    """Start low: wrists just above the shoulders and the fists beside the neck.

    The wrist sits in a vertical plane turned DEEP_PRESS_START's angle forward
    of the frontal plane, at the reach the set elbow flexion gives. The elbow
    solves straight below the shoulder-to-wrist line, so the forearm leans
    only slightly outward. Fills the same profile as upright_forearm_profile.
    """
    fingers = draft.hand_profile(rig, neutral, True)
    draft.reset_pose(rig, neutral, fingers)
    spec = DEEP_PRESS_START
    profiles = {}
    for side, sign in [('l', 1), ('r', -1)]:
        # Clavicle is already at the saved start pose; never rewrite it.
        upper, lower, hand = [rig.pose.bones[f'{n}_{side}'] for n in ['upperarm', 'lowerarm', 'hand']]
        shoulder = upper.head.copy()
        upper_length, fore_length = upper.bone.length, lower.bone.length
        interior = math.radians(180 - spec['elbow_flexion_deg'])
        reach = math.sqrt(upper_length**2 + fore_length**2 - 2 * upper_length * fore_length * math.cos(interior))
        rise = spec['wrist_above_shoulder_m']
        plane = math.radians(spec['plane_anterior_deg'])
        wrist = shoulder + Vector((sign * math.cos(plane), -math.sin(plane), 0)) * math.sqrt(reach**2 - rise**2)
        wrist.z += rise
        elbow = draft.two_bone_elbow(shoulder, wrist, upper_length, fore_length, Vector((0, 0, -1)))
        upper_direction, direction = (elbow - shoulder).normalized(), (wrist - elbow).normalized()
        # The elbow's hinge from the two segments, as in upright_forearm_profile.
        hinge = upper_direction.cross(direction).normalized()
        draft.set_bone_frame(upper, hinge, upper_direction)
        bpy.context.view_layer.update()
        draft.set_bone_frame(lower, hinge, direction)
        bpy.context.view_layer.update()
        draft.aim_bone(hand, direction)
        bpy.context.view_layer.update()
        fist = sum((rig.pose.bones[f'{finger}_01_{side}'].head for finger in
                    ['index', 'middle', 'ring', 'pinky']), Vector()) / 4
        effective = fist - lower.head
        profiles[side] = {'fist_start': fist.copy(), 'upper_length': upper.bone.length,
                          'effective_length': effective.length, 'effective_direction': effective.normalized(),
                          'pole': upper.tail - upper.head, 'forearm_direction': direction,
                          'upper_rotation': upper.matrix.to_quaternion(),
                          'lower_rotation': lower.matrix.to_quaternion(), 'hand_basis': hand.matrix_basis.copy(),
                          'shoulder_start': shoulder,
                          'start': {**spec, 'wrist': list(hand.head), 'elbow': list(lower.head),
                                    'fist_above_shoulder_mm': (fist.z - shoulder.z) * 1000,
                                    'forearm_from_vertical_deg': math.degrees(direction.angle(Vector((0, 0, 1)))),
                                    'upper_arm_from_down_deg': math.degrees(upper_direction.angle(Vector((0, 0, -1))))}}
    return profiles, fingers


def upright_forearm_profile(rig, neutral):
    """Set a folded start with the wrists directly above the elbows.

    The upper arm starts about 26 degrees anterior to the frontal plane.
    Upper arms turn smoothly upward while forearms remain vertical.
    The hand path can converge above the shoulders as the elbows straighten.
    Forearms start vertically, with wrists directly over elbows. The upper
    arms start 20 degrees below horizontal so the elbows stay comfortably
    open; the hands consequently start above shoulder height.
    """
    fingers = draft.hand_profile(rig, neutral, True)
    draft.reset_pose(rig, neutral, fingers)
    profiles = {}
    for side, sign in [('l', 1), ('r', -1)]:
        # Clavicle is already at the saved start pose; never rewrite it.
        upper, lower, hand = [rig.pose.bones[f'{n}_{side}'] for n in ['upperarm', 'lowerarm', 'hand']]
        down = math.sin(math.radians(20))
        spread = math.sqrt(1 - down * down)
        plane = math.radians(26)
        upper_start = Vector((sign * spread * math.cos(plane), -spread * math.sin(plane), -down))
        direction = Vector((0, 0, 1))
        # Define the elbow's hinge from the two segments, as in the existing
        # wall-angel authoring. A saved press already contains shoulder roll;
        # applying the source builder's extra roll to it would double it.
        hinge = upper_start.cross(direction).normalized()
        draft.set_bone_frame(upper, hinge, upper_start)
        bpy.context.view_layer.update()
        draft.set_bone_frame(lower, hinge, direction)
        bpy.context.view_layer.update()
        draft.aim_bone(hand, direction)
        bpy.context.view_layer.update()
        fist = sum((rig.pose.bones[f'{finger}_01_{side}'].head for finger in
                    ['index', 'middle', 'ring', 'pinky']), Vector()) / 4
        effective = fist - lower.head
        profile = {'fist_start': fist.copy(), 'upper_length': upper.bone.length,
                   'effective_length': effective.length, 'effective_direction': effective.normalized(),
                   'pole': upper.tail - upper.head, 'forearm_direction': direction,
                   'upper_rotation': upper.matrix.to_quaternion(),
                   'lower_rotation': lower.matrix.to_quaternion(), 'hand_basis': hand.matrix_basis.copy()}
        # Use the original peak clavicle position for the intermediate path;
        # finish_vertical then brings both segments vertically overhead.
        profile['shoulder_start'] = upper.head.copy()
        profiles[side] = profile
    return profiles, fingers


def solve_press_lift(rig, profiles):
    """Solve the stable intermediate path used before the final extension pass."""
    for side, profile in profiles.items():
        shoulder = rig.pose.bones[f'upperarm_{side}'].head.copy()
        fist = profile['fist_start']
        horizontal_sq = (fist.x - shoulder.x)**2 + (fist.y - shoulder.y)**2
        # The narrower start can put an arbitrary low search height inside
        # the two-segment arm's unreachable inner radius. Bracket on the
        # reachable shell instead of changing the requested fist path.
        inner = abs(profile['upper_length'] - profile['effective_length']) + .001
        low = max(fist.z, shoulder.z + math.sqrt(max(0., inner**2 - horizontal_sq)) + .001)
        high = shoulder.z + math.sqrt((profile['upper_length'] + profile['effective_length'] - 1e-6)**2 - horizontal_sq)

        def flexion(height):
            elbow, swing = draft.press_solution(profile, shoulder, Vector((fist.x, fist.y, height)))
            return math.degrees((elbow - shoulder).angle(swing @ profile['forearm_direction']))

        if not flexion(high) < 15 < flexion(low):
            raise RuntimeError('Cannot bracket soft-elbow finish')
        for _ in range(40):
            middle = (low + high) / 2
            low, high = (middle, high) if flexion(middle) > 15 else (low, middle)
        profile['lift'] = (low + high) / 2 - fist.z


def finish_vertical(rig, side):
    """Fit the endpoint: straight vertical segments and an unpinched shoulder."""
    upper, lower, hand = [rig.pose.bones[f'{n}_{side}'] for n in ['upperarm', 'lowerarm', 'hand']]
    shoulder = upper.head.copy()
    along = Vector((0, 0, 1))
    upper_direction = lower_direction = along
    draft.aim_bone(upper, upper_direction)
    bpy.context.view_layer.update()
    draft.aim_bone(lower, lower_direction)
    bpy.context.view_layer.update()
    # Roll the upper arm outward as it approaches vertical so the existing
    # shoulder skin and shirt do not pinch at the collar. Preserve the
    # forearm's world orientation and grip while twisting about the humerus.
    forearm_matrix = lower.matrix.copy()
    sign = 1 if side == 'l' else -1
    roll = Quaternion(upper_direction, math.radians(30) * sign)
    matrix = (roll.to_matrix() @ upper.matrix.to_3x3()).to_4x4()
    matrix.translation = upper.head
    upper.matrix = matrix
    bpy.context.view_layer.update()
    lower.matrix = forearm_matrix
    bpy.context.view_layer.update()


def press_endpoints(rig, profiles):
    """Derive the checked overhead orientation once, before baking motion."""
    solve_press_lift(rig, profiles)
    for side, profile in profiles.items():
        upper, lower, hand = [rig.pose.bones[f'{n}_{side}'] for n in ['upperarm', 'lowerarm', 'hand']]
        fist = profile['fist_start'] + Vector((0, 0, profile['lift']))
        elbow, swing = draft.press_solution(profile, upper.head, fist)
        direction = (elbow - upper.head).normalized()
        forearm = swing @ profile['forearm_direction']
        draft.set_bone_frame(upper, direction.cross(forearm).normalized(), direction)
        bpy.context.view_layer.update()
        matrix = (swing @ profile['lower_rotation']).to_matrix().to_4x4()
        matrix.translation = lower.head
        lower.matrix = matrix
        hand.matrix_basis = profile['hand_basis']
        bpy.context.view_layer.update()
        finish_vertical(rig, side)
        profile['upper_finish'] = upper.matrix.to_quaternion()
        profile['lower_finish'] = lower.matrix.to_quaternion()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--exercise', choices=['ex_004', 'ex_007'], required=True)
    parser.add_argument('--neck-rest', choices=['relaxed', 'sides', 'hips'], default='relaxed')
    parser.add_argument('--press-start', choices=['deep', 'raised'], default='deep',
                        help='deep: fists beside the neck; raised: the earlier vertical forearms with hands above the head')
    parser.add_argument('--press-finish-source', type=Path,
                        help='Preserve the checked overhead pose from a prior press candidate')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if args.output.exists() or args.output.with_suffix('.form.json').exists():
        parser.error('Use a fresh output')
    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    finish_pose, finish_record, finish_meshes = {}, {}, None
    if args.press_finish_source:
        if args.exercise != 'ex_007':
            parser.error('--press-finish-source applies only to the press')
        finish_record = {'file': args.press_finish_source.name,
                         'sha256': hashlib.sha256(args.press_finish_source.read_bytes()).hexdigest()}
        bpy.ops.wm.open_mainfile(filepath=str(args.press_finish_source.resolve()))
        bpy.context.scene.frame_set(120)
        finish_rig = bpy.context.scene.objects['Figure_Rig']
        finish_meshes = {o.name: (mesh_digest(o), weights_digest(o)) for o in bpy.context.scene.objects if o.type == 'MESH'}
        for side in ['l', 'r']:
            finish_pose[side] = {key + '_finish': finish_rig.pose.bones[bone + '_' + side].matrix.to_quaternion().copy()
                                 for key, bone in [('upper', 'upperarm'), ('lower', 'lowerarm')]}
            finish_pose[side]['hand_finish'] = finish_rig.pose.bones['hand_' + side].matrix_basis.to_quaternion().copy()
    bpy.ops.wm.open_mainfile(filepath=str(args.source.resolve()))
    scene = bpy.context.scene
    rig = scene.objects['Figure_Rig']
    meshes = {o.name: (mesh_digest(o), weights_digest(o)) for o in scene.objects if o.type == 'MESH'}
    if finish_meshes is not None and finish_meshes != meshes:
        raise RuntimeError('Finish reference must use the same mesh coordinates and weights')
    modifiers = [(m, m.show_viewport) for o in scene.objects if o.type == 'MESH' for m in o.modifiers]
    for modifier, _ in modifiers:
        modifier.show_viewport = False
    original, original_world = {}, {}
    for frame in range(scene.frame_start, scene.frame_end + 1):
        scene.frame_set(frame)
        original[frame] = {b.name: b.matrix_basis.copy() for b in rig.pose.bones}
        original_world[frame] = {b.name: b.matrix.copy() for b in rig.pose.bones if b.name not in ARM_BONES}
    rig.animation_data_clear()
    neutral = original[scene.frame_start]
    draft.reset_pose(rig, neutral, {})
    records = {}
    if args.exercise == 'ex_004':
        pose_builder = {'relaxed': relaxed_hanging_arms, 'sides': neutral_hanging_arms,
                        'hips': neutral_hip_hands}[args.neck_rest]
        static_pose, records = pose_builder(scene, rig, neutral)
    else:
        start_builder = deep_press_profile if args.press_start == 'deep' else upright_forearm_profile
        profiles, fingers = start_builder(rig, neutral)
        records = {side: profile['start'] for side, profile in profiles.items() if 'start' in profile}
        if finish_pose:
            for side, pose in finish_pose.items(): profiles[side].update(pose)
        else:
            draft.reset_pose(rig, original[120], {})
            press_endpoints(rig, profiles)
    rig.animation_data_create()
    rig.animation_data.action = bpy.data.actions.new(args.exercise + '_form_refinement')
    samples, largest_error, previous = [], 0., {}
    for frame in range(scene.frame_start, scene.frame_end + 1):
        scene.frame_set(frame)
        draft.reset_pose(rig, original[frame], {})
        if args.exercise == 'ex_004':
            for name, basis in static_pose.items():
                rig.pose.bones[name].matrix_basis = basis
        else:
            for name, rotation in fingers.items():
                rig.pose.bones[name].rotation_quaternion = rotation
            progress = draft.excursion(frame, 24, 120, 144, 240)
            for side, sign in [('l', 1), ('r', -1)]:
                upper, lower, hand = [rig.pose.bones[f'{n}_{side}'] for n in ['upperarm', 'lowerarm', 'hand']]
                profile = profiles[side]
                # Interpolate world orientations across the entire eased lift.
                # A late correction concentrated the hand convergence into a
                # few frames. This follows one smooth rotation per segment.
                for bone, key in [(upper, 'upper'), (lower, 'lower')]:
                    rotation = profile[key + '_rotation'].slerp(profile[key + '_finish'], progress)
                    matrix = rotation.to_matrix().to_4x4()
                    matrix.translation = bone.head
                    bone.matrix = matrix
                    bpy.context.view_layer.update()
                hand.matrix_basis = profile['hand_basis']
                if 'hand_finish' in profile:
                    hand.rotation_quaternion = profile['hand_basis'].to_quaternion().slerp(profile['hand_finish'], progress)
                bpy.context.view_layer.update()
        bpy.context.view_layer.update()
        for name, matrix in original_world[frame].items():
            error = max(abs(a - b) for row_a, row_b in zip(matrix, rig.pose.bones[name].matrix) for a, b in zip(row_a, row_b))
            largest_error = max(largest_error, error)
        for bone in rig.pose.bones:
            bone.rotation_mode = 'QUATERNION'
            q = bone.rotation_quaternion.copy()
            if bone.name in previous and q.dot(previous[bone.name]) < 0:
                q.negate()
                bone.rotation_quaternion = q
            previous[bone.name] = q
            for channel in ['location', 'rotation_quaternion', 'scale']:
                bone.keyframe_insert(channel, frame=frame, group=bone.name)
        if frame in [1, 23, 48, 68, 72, 96, 120]:
            samples.append({'frame': frame, 'arms': arm_snapshot(rig)})
    if largest_error > 2e-6:
        raise RuntimeError(f'Unrelated bone motion changed: {largest_error}')
    if meshes != {o.name: (mesh_digest(o), weights_digest(o)) for o in scene.objects if o.type == 'MESH'}:
        raise RuntimeError('Mesh data or weights changed')
    for modifier, value in modifiers:
        modifier.show_viewport = value
    scene.frame_set(scene.frame_start)
    scene['form_refinement'] = 'mpfb-arm-hand-refinement-2026-10-10'
    scene['form_refinement_note'] = ({'relaxed': 'Both arms hang close to the body, hands resting beside the thighs '
                                                  'with the thumbs along the index fingers; original neck swing retained.',
                                      'sides': 'Both arms hang relaxed at the sides; original neck swing retained.',
                                      'hips': 'Both relaxed hands rest on the hips; original neck swing retained.'}[args.neck_rest]
                                     if args.exercise == 'ex_004' else
                                     {'deep': 'Fists start beside the neck with the wrists just above the shoulders; '
                                              'hands converge to straight vertical arms above the shoulders at the top.',
                                      'raised': 'Forearms start vertically over the elbows; hands converge to straight '
                                                'vertical arms above the shoulders at the top.'}[args.press_start])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output.resolve()))
    if hashlib.sha256(args.source.read_bytes()).hexdigest() != source_hash:
        raise RuntimeError('Source changed')
    report = {'exercise': args.exercise, 'source_file': args.source.name, 'source_sha256': source_hash,
              'pose_mode': args.neck_rest if args.exercise == 'ex_004' else args.press_start,
              'output_sha256': hashlib.sha256(args.output.read_bytes()).hexdigest(),
              'changed_controls': ARM_BONES, 'all_mesh_coordinates_and_weights_unchanged': True,
              'outside_arm_controls_max_matrix_error': largest_error,
              'rest_pose': records, 'press_finish_reference': finish_record,
              'samples': samples, 'status': 'candidate; visual acceptance pending'}
    args.output.with_suffix('.form.json').write_text(json.dumps(report, indent=2))
    print('FORM_CANDIDATE=' + json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
