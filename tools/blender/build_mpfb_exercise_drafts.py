"""Animate additional exercise drafts from the saved, clothed MPFB figure.

Preserves the source file and mesh data. Choreography values describe authored
display poses, not clinical targets, scoring thresholds or prescribed timing.
Only ex_005, ex_006 and ex_007 are included in this draft batch.
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_ex001_mpfb_figure import aim_bone, smoothstep


SIDE_BEND_PEAK_DEG = 42.0

SPECS = {
    "ex_005": {
        "title": "Standing side bends", "frames": 360,
        "phases": [(1, 20, "Ready"), (21, 79, "Bend"), (80, 100, "Pause"),
                   (101, 159, "Return"), (160, 200, "Ready"),
                   (201, 259, "Bend"), (260, 280, "Pause"),
                   (281, 339, "Return"), (340, 360, "Ready")],
        "checkpoints": [1, 50, 80, 100, 130, 180, 230, 260, 280, 310, 360],
        "pose_note": "Alternating lateral spine bend; feet and pelvis fixed. "
                     f"{SIDE_BEND_PEAK_DEG:g} degrees distributed across three spine controls; "
                     "head and neck retain their neutral relation to the upper torso; "
                     "soft elbows, hanging forearms and relaxed fingers. "
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
}
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


def press_girdle(rig, side, sign, progress):
    cb = rig.pose.bones["clavicle_" + side]
    rest = (cb.bone.tail_local-cb.bone.head_local).normalized()
    girdle = math.radians(22.0*progress)
    aim_bone(cb, Vector((sign*abs(rest.x)*math.cos(girdle), rest.y, math.sin(girdle))))
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


def make_animation(scene, rig, exercise, source_poses):
    neutral = source_poses[1]
    rig.animation_data_clear()
    fingers = hand_profile(rig, neutral, exercise == "ex_007") if exercise in ["ex_005", "ex_007"] else {}
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
        elif exercise == "ex_005":
            lean = SIDE_BEND_PEAK_DEG * (excursion(frame, 20, 80, 100, 160) -
                           excursion(frame, 200, 260, 280, 340))
            # The pelvis and lower limbs are never keyed. Distributing the
            # bend lets the trunk curve while the neck follows the torso.
            for name, weight in [("spine_01", .40), ("spine_02", .35), ("spine_03", .25)]:
                rotate_world(rig.pose.bones[name], Vector((0, 1, 0)), math.radians(lean * weight))
                bpy.context.view_layer.update()
            for side, sign in [("l", 1), ("r", -1)]:
                # Upper arms follow the torso while the softer elbows let the
                # forearms hang downward instead of forming rigid diagonal bars.
                spread = 12.0 - abs(lean) if sign * lean > 0 else 12.0 + abs(lean)
                angle = math.radians(sign * spread)
                direction = Vector((math.sin(angle), 0, -math.cos(angle)))
                aim_bone(rig.pose.bones["upperarm_" + side], direction)
                bpy.context.view_layer.update()
                # The raised-side hand clears the front of the waist at the
                # deeper bend instead of passing through the shirt/shorts.
                forward = .12 + (.37 * abs(lean)/SIDE_BEND_PEAK_DEG if sign * lean < 0 else 0)
                forearm_spread = 10.0 - 4.0*abs(lean)/SIDE_BEND_PEAK_DEG
                direction = Vector((sign*math.sin(math.radians(forearm_spread)), -forward, -1)).normalized()
                aim_bone(rig.pose.bones["lowerarm_" + side], direction)
                bpy.context.view_layer.update()
                aim_bone(rig.pose.bones["hand_" + side], direction)
                bpy.context.view_layer.update()
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
        for name in KEY_BONES + list(fingers):
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


def labels(scene, spec):
    for obj in list(scene.objects):
        if obj.name.startswith("Preview "):
            bpy.data.objects.remove(obj, do_unlink=True)
    scene.timeline_markers.clear()
    corners = [v / abs(v.z) for v in scene.camera.data.view_frame(scene=scene)]
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
        obj.parent = scene.camera
        obj.location = (xmin + x * (xmax - xmin), ymin + y * (ymax - ymin), -1)
        obj.data.materials.append(material)
        obj.visible_shadow = False
        return obj

    text("Preview title", spec["title"], .065, .951, 28)
    text("Preview guides", "Draft preview | Timing is illustrative", .065, .910, 19)
    for start, end, word in spec["phases"]:
        obj = text(f"Preview phase {start:03d}", word, .935, .951, 25, "RIGHT")
        for frame in sorted({1, start, end + 1, scene.frame_end + 1}):
            obj.hide_render = obj.hide_viewport = not (start <= frame <= end)
            obj.keyframe_insert("hide_render", frame=frame)
            obj.keyframe_insert("hide_viewport", frame=frame)
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
                              if exercise == "ex_007" else None)
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
        make_animation(scene, rig, exercise, source_poses)
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
        labels(scene, spec)
        if any(mesh_digest(scene.objects[n]) != original_meshes[n] for n in MESH_NAMES):
            raise RuntimeError("Source mesh coordinates changed")
        for key in [k for k in scene.keys() if k.startswith("figure_camera_fit")]:
            del scene[key]
        revision = ("mpfb-side-bend-depth-2026-09-16" if exercise == "ex_005" else
                    "mpfb-straight-press-2026-09-15" if exercise == "ex_007" else
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
        scene["exercise_draft"] = json.dumps(manifest)
        if exercise != "ex_006":
            scene["figure_source_girdle_scale"] = scene.get("figure_girdle_scale", .475)
            if "figure_girdle_scale" in scene:
                del scene["figure_girdle_scale"]
            scene["figure_hand_pose"] = "neutral wrist; " + ("closed fist" if exercise == "ex_007" else "relaxed fingers")
        scene.frame_set(1)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.wm.save_as_mainfile(filepath=str(output.resolve()))
        output.with_suffix(".json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print("DRAFT_SAVED=" + str(output), flush=True)
    if hashlib.sha256(source.read_bytes()).hexdigest() != source_hash:
        raise RuntimeError("Original figure changed during the build")


if __name__ == "__main__":
    main()
