"""Import the exported anatomy GLB and verify its portable animation contract."""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector


JSON_CHUNK_TYPE = 0x4E4F534A
DISTAL_HAND_REST_DIRECTION = Vector((0.045, -0.050, -1.0)).normalized()
DISTAL_HAND_PEAK_DIRECTION = Vector((1.0, -0.018, -0.025)).normalized()


def parse_args() -> argparse.Namespace:
    blender_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--glb", required=True, type=Path)
    return parser.parse_args(blender_args)


def set_imported_frame(scene: bpy.types.Scene, imported_frame: float) -> None:
    whole = math.floor(imported_frame)
    scene.frame_set(whole, subframe=imported_frame - whole)


def evaluated_center(obj: bpy.types.Object) -> Vector:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    corners = [evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box]
    return sum(corners, Vector()) / len(corners)


def world_pose_head(rig: bpy.types.Object, bone_name: str) -> Vector:
    return rig.matrix_world @ rig.pose.bones[bone_name].head


def world_pose_tail(rig: bpy.types.Object, bone_name: str) -> Vector:
    return rig.matrix_world @ rig.pose.bones[bone_name].tail


def hand_longitudinal_direction(rig: bpy.types.Object, side: str) -> Vector:
    wrist = world_pose_head(rig, f"Proximal carpal bones-abduction.{side}")
    middle_tip = world_pose_tail(rig, f"Metacarpal bone-3rd finger.{side}")
    return (middle_tip - wrist).normalized()


def palm_dorsal_normal(rig: bpy.types.Object, side: str) -> Vector:
    longitudinal = hand_longitudinal_direction(rig, side)
    across = (
        world_pose_head(rig, f"Metacarpal bone-2nd finger.{side}")
        - world_pose_head(rig, f"Metacarpal bone-5th finger.{side}")
    )
    raw = longitudinal.cross(across).normalized()
    return raw if side == "r" else -raw


def distal_target_frame(side: str, peak: bool) -> tuple[Vector, Vector]:
    side_sign = 1.0 if side == "l" else -1.0
    source = DISTAL_HAND_PEAK_DIRECTION if peak else DISTAL_HAND_REST_DIRECTION
    longitudinal = Vector((source.x * side_sign, source.y, source.z))
    dorsal = Vector((0.0, 0.0, 1.0)) if peak else Vector((side_sign, 0.0, 0.0))
    dorsal = dorsal - longitudinal * dorsal.dot(longitudinal)
    return longitudinal.normalized(), dorsal.normalized()


def angle_degrees(first: Vector, second: Vector) -> float:
    return math.degrees(first.angle(second, 0.0))


def read_glb_json(path: Path) -> dict:
    with path.open("rb") as handle:
        magic, version, declared_length = struct.unpack("<4sII", handle.read(12))
        if magic != b"glTF" or version != 2 or declared_length != path.stat().st_size:
            raise RuntimeError("Unexpected GLB header")
        chunk_length, chunk_type = struct.unpack("<II", handle.read(8))
        if chunk_type != JSON_CHUNK_TYPE:
            raise RuntimeError("GLB does not begin with a JSON chunk")
        return json.loads(handle.read(chunk_length).decode("utf-8").rstrip("\x00 "))


def material_base_color(material: bpy.types.Material) -> tuple[float, ...]:
    if material.node_tree is None:
        return tuple(float(value) for value in material.diffuse_color)
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled is None:
        return tuple(float(value) for value in material.diffuse_color)
    return tuple(float(value) for value in principled.inputs["Base Color"].default_value)


def main() -> None:
    args = parse_args()
    glb = args.glb.resolve()
    if not glb.is_file():
        raise FileNotFoundError(glb)

    gltf = read_glb_json(glb)
    extensions_used = set(gltf.get("extensionsUsed", []))
    if "KHR_draco_mesh_compression" not in extensions_used:
        raise RuntimeError("GLB is missing Draco mesh compression")
    pointer_targets = [
        channel["target"]["extensions"]["KHR_animation_pointer"]["pointer"]
        for animation in gltf.get("animations", [])
        for channel in animation.get("channels", [])
        if "KHR_animation_pointer"
        in channel.get("target", {}).get("extensions", {})
    ]
    activation_color_pointers = [
        pointer
        for pointer in pointer_targets
        if pointer.endswith("/pbrMetallicRoughness/baseColorFactor")
    ]
    animated_material_indices = {
        int(pointer.split("/")[2]) for pointer in activation_color_pointers
    }
    activation_material_names = {
        material_data.get("name", "")
        for material_data in gltf.get("materials", [])
        if material_data.get("name", "").startswith("Anatomy_Activation_")
    }
    animated_activation_material_names = {
        gltf["materials"][index].get("name", "")
        for index in animated_material_indices
        if gltf["materials"][index].get("name", "").startswith(
            "Anatomy_Activation_"
        )
    }
    static_activation_material_names = (
        activation_material_names - animated_activation_material_names
    )
    # These source channels are exactly zero on the elevation-retimed
    # shoulder-height branches. Blender therefore omits their constant color
    # curves while retaining the materials and length morphs.
    expected_static_activation_material_names = {
        "Anatomy_Activation_(Abdominal part of pectoralis major muscle).l",
        "Anatomy_Activation_(Abdominal part of pectoralis major muscle).r",
        "Anatomy_Activation_Pectoralis minor muscle.l",
        "Anatomy_Activation_Pectoralis minor muscle.r",
        "Anatomy_Activation_Sternocostal head of pectoralis major muscle.l",
        "Anatomy_Activation_Sternocostal head of pectoralis major muscle.r",
    }
    if (
        len(activation_material_names) != 48
        or len(activation_color_pointers) != 42
        or static_activation_material_names
        != expected_static_activation_material_names
    ):
        raise RuntimeError(
            "GLB activation color contract changed: "
            f"materials={len(activation_material_names)}, "
            f"base_color_pointers={len(activation_color_pointers)}, "
            f"static={sorted(static_activation_material_names)}"
        )

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    scene = bpy.context.scene
    armatures = [obj for obj in bpy.data.objects if obj.type == "ARMATURE"]
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    shape_meshes = [
        obj
        for obj in meshes
        if obj.data.shape_keys is not None
        and len(obj.data.shape_keys.key_blocks) > 1
    ]
    actions = list(bpy.data.actions)
    if len(armatures) != 1 or len(armatures[0].data.bones) != 237:
        raise RuntimeError(
            f"GLB rig contract changed: armatures={len(armatures)}, "
            f"bones={[len(obj.data.bones) for obj in armatures]}"
        )
    # Blender can split one source mesh during glTF import according to its
    # skin/material primitives, so the portable lower bound is the 761 source
    # anatomy surfaces rather than an importer-specific exact count.
    if len(meshes) < 761:
        raise RuntimeError(f"GLB lost anatomy surfaces: meshes={len(meshes)}")
    if len(shape_meshes) != 48:
        raise RuntimeError(
            f"GLB lost contraction morph targets: shape_meshes={len(shape_meshes)}"
        )
    if not actions:
        raise RuntimeError("The imported GLB has no animation")

    action = max(actions, key=lambda candidate: candidate.frame_range[1])
    rig = armatures[0]
    imported_duration = (
        float(action.frame_range[1] - action.frame_range[0]) / float(scene.render.fps)
    )
    if not 6.90 <= imported_duration <= 7.05:
        raise RuntimeError(
            f"Imported animation duration changed: {imported_duration:.6f}s"
        )

    humerus = bpy.data.objects.get("Humerus.r")
    if humerus is None:
        raise RuntimeError("Imported GLB is missing Humerus.r")
    action_start = float(action.frame_range[0])
    action_end = float(action.frame_range[1])
    set_imported_frame(scene, action_start)
    rest_center = evaluated_center(humerus)
    sampled_frames = [
        action_start + (action_end - action_start) * index / 120.0
        for index in range(121)
    ]
    sampled_centers: list[tuple[float, Vector]] = []
    for imported_frame in sampled_frames:
        set_imported_frame(scene, imported_frame)
        sampled_centers.append((imported_frame, evaluated_center(humerus)))
    peak_imported_frame, peak_center = max(
        sampled_centers,
        key=lambda item: (item[1] - rest_center).length,
    )
    key_frames = {
        "rest": action_start,
        "peak": peak_imported_frame,
        "final": action_end,
    }

    centers: dict[str, Vector] = {}
    hand_directions: dict[str, dict[str, Vector]] = {}
    palm_dorsals: dict[str, dict[str, Vector]] = {}
    wrist_positions: dict[str, dict[str, Vector]] = {}
    morph_maxima: dict[str, float] = {}
    imported_frames: dict[str, float] = {}
    activation_materials = [
        material_data
        for material_data in bpy.data.materials
        if material_data.name.startswith("Anatomy_Activation_")
    ]
    if len(activation_materials) != 48:
        raise RuntimeError(
            "Imported activation material count changed: "
            f"{len(activation_materials)}"
        )
    activation_colors: dict[str, dict[str, tuple[float, ...]]] = {}
    for label, imported_frame in key_frames.items():
        set_imported_frame(scene, imported_frame)
        imported_frames[label] = imported_frame
        centers[label] = evaluated_center(humerus)
        hand_directions[label] = {
            side: hand_longitudinal_direction(rig, side) for side in ("r", "l")
        }
        palm_dorsals[label] = {
            side: palm_dorsal_normal(rig, side) for side in ("r", "l")
        }
        wrist_positions[label] = {
            side: world_pose_head(
                rig, f"Proximal carpal bones-abduction.{side}"
            )
            for side in ("r", "l")
        }
        morph_maxima[label] = max(
            (
                abs(key.value)
                for obj in shape_meshes
                for key in tuple(obj.data.shape_keys.key_blocks)[1:]
            ),
            default=0.0,
        )
        activation_colors[label] = {
            material_data.name: material_base_color(material_data)
            for material_data in activation_materials
        }

    rest_to_peak = (centers["peak"] - centers["rest"]).length
    return_error = (centers["final"] - centers["rest"]).length
    if rest_to_peak < 0.12:
        raise RuntimeError(
            f"Imported humerus did not animate to shoulder height: {rest_to_peak:.4f} m"
        )
    if return_error > 0.01:
        raise RuntimeError(
            f"Imported humerus did not return to rest: {return_error:.4f} m"
        )
    if morph_maxima["peak"] < 0.1:
        raise RuntimeError("Imported model-length morphs are not animated")
    max_activation_color_change = max(
        math.dist(activation_colors["rest"][name], activation_colors["peak"][name])
        for name in activation_colors["rest"]
    )
    if max_activation_color_change < 0.02:
        raise RuntimeError("Imported activation material colors are not animated")

    hand_target_errors: dict[str, float] = {}
    palm_target_errors: dict[str, float] = {}
    for label in ("rest", "peak", "final"):
        is_peak = label == "peak"
        hand_target_errors[label] = max(
            angle_degrees(
                hand_directions[label][side],
                distal_target_frame(side, is_peak)[0],
            )
            for side in ("r", "l")
        )
        palm_target_errors[label] = max(
            angle_degrees(
                palm_dorsals[label][side],
                distal_target_frame(side, is_peak)[1],
            )
            for side in ("r", "l")
        )
    max_hand_target_error = max(hand_target_errors.values())
    max_palm_target_error = max(palm_target_errors.values())
    max_wrist_return_error = max(
        (wrist_positions["final"][side] - wrist_positions["rest"][side]).length
        for side in ("r", "l")
    )
    if max_hand_target_error > 0.5:
        raise RuntimeError(
            "Imported hand direction contract changed: "
            f"errors={hand_target_errors}"
        )
    if max_palm_target_error > 0.5:
        raise RuntimeError(
            "Imported palm-facing contract changed: "
            f"errors={palm_target_errors}"
        )
    if max_wrist_return_error > 0.001:
        raise RuntimeError(
            "Imported wrists did not return to rest: "
            f"{max_wrist_return_error:.6f} m"
        )

    metrics = {
        "glb": str(glb),
        "bytes": glb.stat().st_size,
        "meshes": len(meshes),
        "armatures": len(armatures),
        "bones": len(armatures[0].data.bones),
        "shape_meshes": len(shape_meshes),
        "activation_materials": len(activation_materials),
        "activation_color_pointer_channels": len(activation_color_pointers),
        "extensions_used": sorted(extensions_used),
        "action": action.name,
        "action_range": [round(float(value), 4) for value in action.frame_range],
        "import_fps": scene.render.fps,
        "imported_duration_seconds": round(imported_duration, 6),
        "imported_frames": {
            key: round(value, 4) for key, value in imported_frames.items()
        },
        "humerus_rest_to_peak_m": round(rest_to_peak, 5),
        "humerus_return_error_m": round(return_error, 6),
        "peak_max_morph": round(morph_maxima["peak"], 6),
        "max_activation_color_change": round(max_activation_color_change, 6),
        "hand_direction_target_error_deg": {
            key: round(value, 6) for key, value in hand_target_errors.items()
        },
        "palm_dorsal_target_error_deg": {
            key: round(value, 6) for key, value in palm_target_errors.items()
        },
        "max_wrist_return_error_m": round(max_wrist_return_error, 7),
    }
    print("EX001_ANATOMY_GLB_VALIDATION=" + json.dumps(metrics, sort_keys=True))


if __name__ == "__main__":
    main()
