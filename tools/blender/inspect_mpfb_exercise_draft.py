"""Inspect saved exercise drafts without calling the motion builder or saving.

Checks the visible silhouette, feet, wrist alignment, motion continuity, phase
text, loop closure and movement endpoints. Samples garment/skin clearance at
eleven poses; this does not prove continuous surface collision avoidance.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from inspect_ex001_mpfb_figure import body_digest, bounds, hand_error, visible_phases
from inspect_ex001_mpfb_clothing import topology, signed_clearance


MESHES = ["Figure_Body", "Figure_Top", "Figure_Shorts"]


def bone_points(rig):
    return np.array([list(p) for pb in rig.pose.bones for p in [pb.head, pb.tail]])


def shoulder_points(rig):
    return np.array([list(p) for n in ["clavicle_l", "clavicle_r", "upperarm_l", "upperarm_r"]
                     for p in [rig.pose.bones[n].head, rig.pose.bones[n].tail]])


def angle(a, b):
    a, b = a.normalized(), b.normalized()
    return math.degrees(math.atan2(a.cross(b).length, a.dot(b)))


def head_relative_rotation(rig):
    return (rig.pose.bones["spine_03"].matrix.to_quaternion().inverted() @
            rig.pose.bones["head"].matrix.to_quaternion())


def movement(rig):
    result = {}
    for side in ["l", "r"]:
        upper, lower, hand = [rig.pose.bones[n + "_" + side] for n in ["upperarm", "lowerarm", "hand"]]
        u, f = upper.tail - upper.head, lower.tail - lower.head
        fist = np.mean([list(rig.pose.bones[f"{finger}_01_{side}"].head)
                        for finger in ["index", "middle", "ring", "pinky"]], axis=0)
        result[side] = {"upper_arm_deg_from_down": angle(u, Vector((0, 0, -1))),
                        "elbow_flexion_deg": angle(u, f),
                        "forearm_frontal_angle_from_down": math.degrees(math.atan2(abs(f.x), -f.z)),
                        "shoulder_height": float(upper.head.z),
                        "wrist_minus_shoulder_mm": float(lower.tail.z-upper.head.z)*1000,
                        "wrist_height": float(lower.tail.z),
                        "wrist": list(lower.tail), "hand_tip": list(hand.tail),
                        "fist_center": fist.tolist()}
    center = rig.pose.bones["head"].head - rig.pose.bones["pelvis"].head
    result["trunk_lean_deg"] = math.degrees(math.atan2(center.x, center.z))
    result["head_height"] = float(rig.pose.bones["head"].tail.z)
    return result


def hand_shape(rig, side):
    hand = rig.pose.bones["hand_" + side]
    index, pinky, middle = [rig.pose.bones[n + "_01_" + side] for n in ["index", "pinky", "middle"]]
    forward = (middle.head-hand.head).normalized()
    sign = 1 if side == "l" else -1
    normal = (-sign*(index.head-pinky.head).cross(forward)).normalized()
    measurements = []
    for finger in ["index", "middle", "ring", "pinky"]:
        chain = [rig.pose.bones[f"{finger}_{joint:02d}_{side}"] for joint in [1, 2, 3]]
        span = chain[-1].tail-chain[0].head
        length = sum((b.tail-b.head).length for b in chain)
        measurements.append({"finger": finger, "span_length_ratio": span.length/length,
                             "tip_displacement_into_palm_mm": span.dot(normal)*1000})
    return measurements


def inspect(args):
    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    baseline_hash = hashlib.sha256(args.baseline.read_bytes()).hexdigest()
    previous_peak = None
    previous_hash = None
    if args.previous:
        previous_hash = hashlib.sha256(args.previous.read_bytes()).hexdigest()
        bpy.ops.wm.open_mainfile(filepath=str(args.previous.resolve()))
        bpy.context.scene.frame_set(80)
        previous_peak = abs(movement(bpy.data.objects["Figure_Rig"])["trunk_lean_deg"])
    bpy.ops.wm.open_mainfile(filepath=str(args.baseline.resolve()))
    baseline_meshes = {n: body_digest(bpy.data.objects[n]) for n in MESHES}
    bpy.context.scene.frame_set(96)
    baseline_peak = shoulder_points(bpy.data.objects["Figure_Rig"])
    bpy.ops.wm.open_mainfile(filepath=str(args.source.resolve()))
    scene, failures = bpy.context.scene, []
    rig = scene.objects["Figure_Rig"]
    draft = json.loads(scene["exercise_draft"])
    exercise = draft["exercise"]
    peak_frame = draft.get("peak_frame", 96)
    if exercise not in ["ex_005", "ex_006", "ex_007"]:
        raise RuntimeError("Unexpected draft exercise")
    if draft["source_sha256"] != baseline_hash:
        failures.append("Source provenance does not match baseline")
    if scene.frame_start != 1 or scene.frame_end != draft["frames"] or scene.render.fps / scene.render.fps_base != 30:
        failures.append("Unexpected timeline")
    mesh_equal = {n: body_digest(scene.objects[n]) == baseline_meshes[n] for n in MESHES}
    if not all(mesh_equal.values()):
        failures.append("Body or garment mesh coordinates differ from baseline")
    topologies = {n: topology(scene.objects[n].data) for n in MESHES[1:]}
    for name, openings in [("Figure_Top", 4), ("Figure_Shorts", 3)]:
        t = topologies[name]
        if t["components"] != 1 or t["openings"] != openings or t["branching_boundary_vertices"] or t["nonmanifold_edges"]:
            failures.append(name + ": changed or torn garment topology")
        if any(m.show_render != m.show_viewport for m in scene.objects[name].modifiers):
            failures.append(name + ": render/evaluation modifier mismatch")
    samples, clothing, first, previous = [], [], None, None
    max_step, max_feet, max_wrist, hold_drift = 0., 0., 0., 0.
    min_margin, min_y, max_y = 1., 1., 0.
    first_feet, hold_pose, first_head_relative = None, None, None
    max_head_relative_change = 0.
    for frame in range(1, scene.frame_end + 1):
        scene.frame_set(frame)
        boxes = [bounds(scene, scene.objects[n]) for n in MESHES]
        box = {k: min(b[k] for b in boxes) for k in ["xmin", "ymin"]}
        box.update({k: max(b[k] for b in boxes) for k in ["xmax", "ymax"]})
        min_margin = min(min_margin, box["xmin"], 1-box["xmax"])
        min_y, max_y = min(min_y, box["ymin"]), max(max_y, box["ymax"])
        if box["xmin"] < .06 or box["xmax"] > .94 or box["ymin"] < .035 or box["ymax"] > .88:
            failures.append(f"Framing violation at frame {frame}")
        phases = visible_phases(scene)
        expected = [word for start, end, word in draft["phases"] if start <= frame <= end]
        if phases != expected or len(phases) != 1:
            failures.append(f"Incorrect phase visibility at {frame}: {phases}")
        for obj in scene.objects:
            if obj.type == "FONT" and not obj.hide_render:
                corners = [world_to_camera_view(scene, scene.camera, obj.matrix_world @ Vector(v)) for v in obj.bound_box]
                if any(p.x < .04 or p.x > .96 or p.y < .89 or p.y > .995 for p in corners):
                    failures.append(f"Header clipped at {frame}: {obj.name}")
        points = bone_points(rig)
        feet = np.array([list(p) for name in ["foot_l", "foot_r", "ball_l", "ball_r", "pelvis"]
                         for p in [rig.pose.bones[name].head, rig.pose.bones[name].tail]])
        if first is None:
            first, first_feet = points.copy(), feet.copy()
            first_head_relative = head_relative_rotation(rig)
        if exercise == "ex_005":
            max_head_relative_change = max(max_head_relative_change, math.degrees(
                first_head_relative.rotation_difference(head_relative_rotation(rig)).angle))
        if previous is not None:
            max_step = max(max_step, float(np.linalg.norm(points-previous, axis=1).max()))
        max_feet = max(max_feet, float(np.linalg.norm(feet-first_feet, axis=1).max()))
        max_wrist = max(max_wrist, *(hand_error(rig, side) for side in ["l", "r"]))
        previous = points.copy()
        measured = movement(rig)
        if exercise == "ex_006" and max(measured[s]["elbow_flexion_deg"] for s in ["l", "r"]) > 1:
            failures.append(f"Arm hold has bent elbows at {frame}")
        if abs(measured["l"]["upper_arm_deg_from_down"] - measured["r"]["upper_arm_deg_from_down"]) > .1 and exercise != "ex_005":
            failures.append(f"Arm symmetry mismatch at {frame}")
        if exercise == "ex_006" and 96 <= frame <= 204:
            if hold_pose is None:
                hold_pose = points.copy()
            hold_drift = max(hold_drift, float(np.linalg.norm(points-hold_pose, axis=1).max()))
        hands = {side: hand_shape(rig, side) for side in ["l", "r"]}
        if exercise == "ex_007":
            for side, digits in hands.items():
                if max(d["span_length_ratio"] for d in digits) > .60 or min(d["tip_displacement_into_palm_mm"] for d in digits) < 3:
                    failures.append(f"Hand is not curled into a palm-facing fist at {frame}, {side}")
                if measured[side]["elbow_flexion_deg"] < 12:
                    failures.append(f"Press elbow approaches full extension at {frame}, {side}")
        samples.append({"frame": frame, "bounds": box, "phase": phases, "movement": measured, "hands": hands})
        if frame in draft["checkpoints"]:
            body = scene.objects["Figure_Body"].evaluated_get(bpy.context.evaluated_depsgraph_get())
            mesh = body.to_mesh()
            try:
                tree = BVHTree.FromPolygons([body.matrix_world @ v.co for v in mesh.vertices],
                                           [list(p.vertices) for p in mesh.polygons])
            finally:
                body.to_mesh_clear()
            measurements = {n: signed_clearance(scene.objects[n], tree) for n in MESHES[1:]}
            for n, measure in measurements.items():
                if measure["vertices_below_minus_half_mm"]:
                    failures.append(f"{n}: sampled body penetration at {frame}")
            clothing.append({"frame": frame, "garments": measurements})
        if frame % 60 == 0:
            print(f"DRAFT_INSPECTED={exercise}:{frame}/{scene.frame_end}", flush=True)
    closure = float(np.linalg.norm(previous-first, axis=1).max())
    if max_step > .025:
        failures.append("A joint jumps more than 25 mm between adjacent frames")
    if max_feet > .00001 or closure > .00001 or max_wrist > .05:
        failures.append("Feet/pelvis drift, loop seam, or bent wrist")
    endpoints = {}
    if exercise == "ex_005":
        leans = [s["movement"]["trunk_lean_deg"] for s in samples]
        endpoints = {"minimum_trunk_lean_deg": min(leans), "maximum_trunk_lean_deg": max(leans)}
        if min(leans) > -24 or max(leans) < 24 or abs(min(leans) + max(leans)) > .1:
            failures.append("Missing or asymmetric left/right trunk excursion")
        if previous_peak is not None:
            endpoints["previous_peak_trunk_lean_deg"] = previous_peak
            endpoints["peak_increase_factor"] = max(leans)/previous_peak
            endpoints["minimum_peak_increase_required"] = args.minimum_peak_increase
            if max(leans) < previous_peak*args.minimum_peak_increase:
                failures.append("Side bend does not meet the requested increase over the previous draft")
        endpoints["maximum_head_relative_upper_spine_change_deg"] = max_head_relative_change
        if max_head_relative_change > .05:
            failures.append("Side-bend head does not retain its relation to the upper torso")
        if max(s["movement"][side]["forearm_frontal_angle_from_down"] for s in samples for side in ["l", "r"]) > 12:
            failures.append("Side-bend forearms do not hang downward in the frontal view")
        endpoints["peak_arm_poses"] = samples[79]["movement"]
    else:
        peak = samples[peak_frame-1]["movement"]
        endpoints = {"start": samples[0]["movement"], "peak": peak}
        if exercise == "ex_006":
            scene.frame_set(96)
            delta = float(np.linalg.norm(shoulder_points(rig)-baseline_peak, axis=1).max())
            endpoints.update({"baseline_peak_shoulder_delta_mm": delta*1000, "hold_joint_drift_mm": hold_drift*1000})
            if delta > .00001 or hold_drift > .00001:
                failures.append("Arm hold differs from the accepted source pose or drifts")
        else:
            paths = {}
            for side in ["l", "r"]:
                start = samples[0]["movement"][side]
                if start["elbow_flexion_deg"] < 135 or abs(start["wrist_minus_shoulder_mm"]) > 1:
                    failures.append("Press must start folded, with wrists level with shoulders")
                if start["upper_arm_deg_from_down"] > 35:
                    failures.append("Press upper arm is not lowered at the start")
                if not 14 <= peak[side]["elbow_flexion_deg"] <= 16 or peak[side]["wrist_height"] <= peak["head_height"]:
                    failures.append("Press must finish overhead with a soft 15-degree elbow bend")
                centers = np.array([s["movement"][side]["fist_center"] for s in samples])
                deviation = float(np.linalg.norm(centers[:, :2]-centers[0, :2], axis=1).max())*1000
                ascent = np.diff(centers[23:peak_frame, 2])
                descent = np.diff(centers[143:240, 2])
                if deviation > .5 or ascent.min() < -1e-6 or descent.max() > 1e-6:
                    failures.append("Fist does not follow a straight vertical rise and return")
                paths[side] = {"maximum_horizontal_deviation_mm": deviation,
                               "vertical_travel_mm": float(np.ptp(centers[:, 2]))*1000,
                               "minimum_elbow_flexion_deg": min(s["movement"][side]["elbow_flexion_deg"] for s in samples)}
            endpoints["fist_paths"] = paths
    # Deliberately corrupt two independent properties in memory. Never save.
    scene.frame_set(peak_frame if exercise != "ex_005" else 80)
    lens = scene.camera.data.lens
    scene.camera.data.lens *= 2
    bad = bounds(scene, scene.objects["Figure_Body"])
    narrow_rejected = bad["xmin"] < .06 or bad["xmax"] > .94 or bad["ymin"] < .035 or bad["ymax"] > .88
    scene.camera.data.lens = lens
    hand = rig.pose.bones["hand_l"]
    saved_q = hand.rotation_quaternion.copy()
    hand.rotation_quaternion = saved_q @ Quaternion((1, 0, 0), math.radians(15))
    bpy.context.view_layer.update()
    wrist_rejected = hand_error(rig, "l") > .05
    hand.rotation_quaternion = saved_q
    negatives = {"narrow_camera_rejected": narrow_rejected, "bent_wrist_rejected": wrist_rejected}
    if exercise == "ex_005":
        head = rig.pose.bones["head"]
        saved_head = head.rotation_quaternion.copy()
        head.rotation_quaternion = saved_head @ Quaternion((0, 1, 0), math.radians(10))
        bpy.context.view_layer.update()
        negatives["extra_head_rotation_rejected"] = math.degrees(
            first_head_relative.rotation_difference(head_relative_rotation(rig)).angle) > .05
        head.rotation_quaternion = saved_head
    if exercise == "ex_007":
        bpy.context.view_layer.update()
        saved_hand = hand.matrix.copy()
        shifted = saved_hand.copy()
        shifted.translation.x += .02
        hand.matrix = shifted
        bpy.context.view_layer.update()
        center = np.array(movement(rig)["l"]["fist_center"])
        start_center = np.array(samples[0]["movement"]["l"]["fist_center"])
        negatives["sideways_hand_path_rejected"] = float(np.linalg.norm(center[:2]-start_center[:2])) > .0005
        hand.matrix = saved_hand
        bpy.context.view_layer.update()
        upper, lower = rig.pose.bones["upperarm_l"], rig.pose.bones["lowerarm_l"]
        saved_lower = lower.matrix.copy()
        swing = (lower.tail-lower.head).rotation_difference(upper.tail-upper.head)
        straightened = (swing.to_matrix() @ saved_lower.to_3x3()).to_4x4()
        straightened.translation = saved_lower.translation
        lower.matrix = straightened
        bpy.context.view_layer.update()
        negatives["locked_elbow_rejected"] = movement(rig)["l"]["elbow_flexion_deg"] < 12
        lower.matrix = saved_lower
    if not all(negatives.values()):
        failures.append("Negative control unexpectedly passed")
    report = {"source_file": args.source.name, "source_sha256": source_hash,
              "baseline_sha256": baseline_hash, "exercise": exercise,
              "previous_scene_sha256": previous_hash,
              "frames_measured": len(samples), "mesh_coordinates_unchanged": mesh_equal,
              "topology": topologies, "minimum_horizontal_margin": min_margin,
              "vertical_extent": [min_y, max_y], "maximum_joint_step_mm": max_step*1000,
              "maximum_feet_pelvis_drift_mm": max_feet*1000, "loop_closure_error_mm": closure*1000,
              "maximum_wrist_axis_error_deg": max_wrist, "endpoints": endpoints,
              "negative_controls": negatives, "clothing_poses_checked": len(clothing),
              "clothing_clearance_scope": "All evaluated garment vertices against nearest body face at eleven poses; not continuous collision proof.",
              "failures": failures, "pass": not failures, "samples": samples, "clothing": clothing}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    for path, expected_hash in [(args.source, source_hash), (args.baseline, baseline_hash)]:
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected_hash:
            raise RuntimeError("An inspected scene changed on disk")
    if args.previous and hashlib.sha256(args.previous.read_bytes()).hexdigest() != previous_hash:
        raise RuntimeError("Previous draft changed during comparison")
    print("DRAFT_INSPECTION=" + json.dumps({k: v for k, v in report.items() if k not in ["samples", "clothing"]}), flush=True)
    if failures:
        raise RuntimeError("Draft inspection failed; see report")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--previous", type=Path, help="Previous side-bend draft for a measured range comparison")
    parser.add_argument("--minimum-peak-increase", type=float, default=1.35,
                        help="Minimum measured peak ratio when comparing a previous side-bend scene")
    inspect(parser.parse_args(sys.argv[sys.argv.index("--") + 1:]))
