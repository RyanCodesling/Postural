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


def upright_forearm_profile(rig, neutral):
    """Keep the folded start while moving the forearms into a frontal plane.

    The upper arm starts about 26 degrees anterior to the frontal plane.
    Both arm segments turn smoothly from this start to a vertical finish.
    The hand path can converge above the shoulders as the elbows straighten.
    A modest outward forearm angle keeps the start from folding the elbow
    unnaturally tightly. Wrists still start level with the shoulders.
    """
    fingers = draft.hand_profile(rig, neutral, True)
    draft.reset_pose(rig, neutral, fingers)
    profiles = {}
    for side, sign in [('l', 1), ('r', -1)]:
        # Clavicle is already at the saved start pose; never rewrite it.
        upper, lower, hand = [rig.pose.bones[f'{n}_{side}'] for n in ['upperarm', 'lowerarm', 'hand']]
        down = .915
        fore_z = down * upper.bone.length / lower.bone.length
        if not 0 < fore_z < 1:
            raise RuntimeError('Cannot place the starting wrist at shoulder height')
        spread = math.sqrt(1 - down * down)
        plane = math.radians(26)
        upper_start = Vector((sign * spread * math.cos(plane), -spread * math.sin(plane), -down))
        direction = Vector((sign * math.sqrt(1 - fore_z**2), 0, fore_z))
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
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if args.output.exists() or args.output.with_suffix('.form.json').exists():
        parser.error('Use a fresh output')
    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(args.source.resolve()))
    scene = bpy.context.scene
    rig = scene.objects['Figure_Rig']
    meshes = {o.name: (mesh_digest(o), weights_digest(o)) for o in scene.objects if o.type == 'MESH'}
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
        static_pose, records = neutral_hip_hands(scene, rig, neutral)
    else:
        profiles, fingers = upright_forearm_profile(rig, neutral)
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
    scene['form_refinement_note'] = ('Both relaxed hands rest on the hips; original neck swing retained.'
                                     if args.exercise == 'ex_004' else
                                     'Forearms start in a frontal plane with modest outward slant; hands converge to straight vertical arms above the shoulders at the top.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output.resolve()))
    if hashlib.sha256(args.source.read_bytes()).hexdigest() != source_hash:
        raise RuntimeError('Source changed')
    report = {'exercise': args.exercise, 'source_file': args.source.name, 'source_sha256': source_hash,
              'output_sha256': hashlib.sha256(args.output.read_bytes()).hexdigest(),
              'changed_controls': ARM_BONES, 'all_mesh_coordinates_and_weights_unchanged': True,
              'outside_arm_controls_max_matrix_error': largest_error,
              'hip_fit': records, 'samples': samples, 'status': 'candidate; visual acceptance pending'}
    args.output.with_suffix('.form.json').write_text(json.dumps(report, indent=2))
    print('FORM_CANDIDATE=' + json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
