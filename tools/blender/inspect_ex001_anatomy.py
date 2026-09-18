"""Read-only deformation audit for the ex_001 anatomical Blender source."""

from __future__ import annotations

import argparse
import json
import sys

import bpy
import numpy as np
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frames", type=int, nargs="+")
    parser.add_argument("--top", type=int, default=20)
    parser.add_argument(
        "--match",
        nargs="*",
        default=(),
        help="Only report mesh names containing one of these case-insensitive terms.",
    )
    return parser.parse_args(args)


def evaluated_bounds(obj: bpy.types.Object, depsgraph: bpy.types.Depsgraph) -> tuple[Vector, Vector]:
    evaluated = obj.evaluated_get(depsgraph)
    corners = [evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box]
    minimum = Vector(tuple(min(point[index] for point in corners) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in corners) for index in range(3)))
    return minimum, maximum


def vertex_centroid_world(obj: bpy.types.Object) -> Vector:
    return sum(
        (obj.matrix_world @ vertex.co for vertex in obj.data.vertices), Vector()
    ) / len(obj.data.vertices)


def registration_audit() -> dict[str, object]:
    scene = bpy.context.scene
    root = bpy.data.collections["EX001_Anatomy"]
    muscles = bpy.data.collections["EX001_Anatomy_Muscles"]
    rig = bpy.data.objects["Anatomy_Armature"]
    current_frame = scene.frame_current
    action = rig.animation_data.action if rig.animation_data is not None else None
    saved_basis = {
        pose_bone.name: pose_bone.matrix_basis.copy() for pose_bone in rig.pose.bones
    }
    try:
        # Registration is a bind-pose property. The instructional hand correction
        # intentionally moves distal surfaces at frame 1, so auditing that animated
        # pose against atlas-space centers would report a false registration error.
        if rig.animation_data is not None:
            rig.animation_data.action = None
        for pose_bone in rig.pose.bones:
            pose_bone.matrix_basis.identity()
        bpy.context.view_layer.update()
        rows = []
        for obj in muscles.all_objects:
            if obj.type != "MESH" or "atlas_registered_center_world" not in obj:
                continue
            expected = Vector(obj["atlas_registered_center_world"])
            error = (vertex_centroid_world(obj) - expected).length
            rows.append({"name": obj.name, "base_center_error_m": error})
    finally:
        if rig.animation_data is not None:
            rig.animation_data.action = action
        if action is None:
            for bone_name, matrix_basis in saved_basis.items():
                rig.pose.bones[bone_name].matrix_basis = matrix_basis
        scene.frame_set(current_frame)
        bpy.context.view_layer.update()
    rows.sort(key=lambda row: float(row["base_center_error_m"]), reverse=True)
    errors = np.asarray([row["base_center_error_m"] for row in rows], dtype=float)
    return {
        "landmarks": int(root.get("atlas_registration_landmarks", 0)),
        "source_translation_m": float(
            root.get("atlas_registration_translation_m", float("nan"))
        ),
        "source_median_center_error_m": float(
            root.get("atlas_registration_median_center_error_m", float("nan"))
        ),
        "source_p95_center_error_m": float(
            root.get("atlas_registration_p95_center_error_m", float("nan"))
        ),
        "muscles_with_source_centers": len(rows),
        "rigid_segment_meshes": {
            segment: int(root.get(f"rigid_{segment}_muscle_meshes", 0))
            for segment in ("upper_arm", "radius", "ulna")
        },
        "base_center_error_m": {
            "median": float(np.median(errors)),
            "p95": float(np.percentile(errors, 95.0)),
            "max": float(np.max(errors)),
        },
        "worst_base_centers": rows[:20],
    }


def distance_to_segment(point: Vector, start: Vector, end: Vector) -> float:
    axis = end - start
    if axis.length_squared < 1e-8:
        return (point - start).length
    fraction = max(0.0, min(1.0, (point - start).dot(axis) / axis.length_squared))
    return (point - (start + axis * fraction)).length


def distal_bone_name(obj: bpy.types.Object) -> str | None:
    role = str(obj.get("attachment_distal", ""))
    side = "r" if obj.name.endswith(".r") else "l" if obj.name.endswith(".l") else None
    if side is None:
        return None
    if role == "Clavicle":
        return f"Clavicle-X.{side}"
    if role == "Scapula":
        return f"Scapula.{side}"
    if role == "Arm":
        return "RightArm" if side == "r" else "LeftArm"
    if role == "Radius":
        return f"Radius.{side}"
    if role == "Ulna":
        return f"Ulna.{side}"
    return None


def attachment_audit(frame: int) -> dict[str, object]:
    scene = bpy.context.scene
    scene.frame_set(frame)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    rig = bpy.data.objects["Anatomy_Armature"]
    muscles = bpy.data.collections["EX001_Anatomy_Muscles"]
    rows = []
    for obj in muscles.all_objects:
        if obj.type != "MESH":
            continue
        bone_name = distal_bone_name(obj)
        if bone_name is None:
            continue
        group = obj.vertex_groups.get(bone_name)
        pose_bone = rig.pose.bones.get(bone_name)
        if group is None or pose_bone is None:
            continue
        weighted_indices = []
        for vertex in obj.data.vertices:
            weight = next(
                (
                    membership.weight
                    for membership in vertex.groups
                    if membership.group == group.index
                ),
                0.0,
            )
            if weight >= 0.8:
                weighted_indices.append(vertex.index)
        if not weighted_indices:
            continue
        evaluated = obj.evaluated_get(depsgraph)
        evaluated_mesh = evaluated.to_mesh()
        start = rig.matrix_world @ pose_bone.head
        end = rig.matrix_world @ pose_bone.tail
        distances = np.asarray(
            [
                distance_to_segment(
                    evaluated.matrix_world @ evaluated_mesh.vertices[index].co,
                    start,
                    end,
                )
                for index in weighted_indices
            ],
            dtype=float,
        )
        evaluated.to_mesh_clear()
        rows.append(
            {
                "name": obj.name,
                "distal_bone": bone_name,
                "vertices": len(weighted_indices),
                "distance_to_bone_axis_m": {
                    "median": float(np.median(distances)),
                    "p95": float(np.percentile(distances, 95.0)),
                    "max": float(np.max(distances)),
                },
            }
        )
    rows.sort(
        key=lambda row: float(row["distance_to_bone_axis_m"]["p95"]),
        reverse=True,
    )
    return {
        "frame": frame,
        "muscles": len(rows),
        "worst_p95": rows[:20],
        "max_p95_m": max(
            (float(row["distance_to_bone_axis_m"]["p95"]) for row in rows),
            default=0.0,
        ),
    }


def inspect_collection(
    collection_name: str,
    frame: int,
    top: int,
    match_terms: tuple[str, ...],
) -> dict[str, object]:
    scene = bpy.context.scene
    scene.frame_set(frame)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    rows: list[dict[str, object]] = []
    collection = bpy.data.collections[collection_name]
    for obj in collection.all_objects:
        if obj.type != "MESH":
            continue
        if match_terms and not any(term in obj.name.casefold() for term in match_terms):
            continue
        minimum, maximum = evaluated_bounds(obj, depsgraph)
        dimensions = maximum - minimum
        rows.append(
            {
                "name": obj.name,
                "max_extent_m": round(max(dimensions), 5),
                "dimensions_m": [round(value, 5) for value in dimensions],
                "center_m": [round(value, 5) for value in (minimum + maximum) * 0.5],
                "attachment_method": obj.get("attachment_method", "static"),
                "parent_bone": obj.parent_bone if obj.parent_type == "BONE" else None,
            }
        )
    rows.sort(key=lambda row: float(row["max_extent_m"]), reverse=True)
    return {
        "collection": collection_name,
        "frame": frame,
        "mesh_count": len(rows),
        "over_one_meter": sum(float(row["max_extent_m"]) > 1.0 for row in rows),
        "largest": rows[:top],
    }


def main() -> None:
    args = parse_args()
    frames = tuple(args.frames or (1, int(bpy.context.scene.get("ex001_peak_frame", 0))))
    if any(frame <= 0 for frame in frames):
        raise RuntimeError(
            "Editable anatomy source does not declare ex001_peak_frame; pass --frames"
        )
    match_terms = tuple(term.casefold() for term in args.match)
    rig = bpy.data.objects["Anatomy_Armature"]
    bone_rows: list[dict[str, object]] = []
    for frame in frames:
        bpy.context.scene.frame_set(frame)
        for bone_name in (
            "Clavicle-X.r",
            "Scapula.r",
            "RightArm",
            "Clavicle-X.l",
            "Scapula.l",
            "LeftArm",
        ):
            pose_bone = rig.pose.bones[bone_name]
            head = rig.matrix_world @ pose_bone.head
            tail = rig.matrix_world @ pose_bone.tail
            bone_rows.append(
                {
                    "frame": frame,
                    "name": bone_name,
                    "parent": pose_bone.parent.name if pose_bone.parent else None,
                    "head_m": [round(value, 5) for value in head],
                    "tail_m": [round(value, 5) for value in tail],
                    "length_m": round((tail - head).length, 5),
                }
            )
    payload = {
        "blend": bpy.data.filepath,
        "registration": registration_audit(),
        "attachments": [attachment_audit(frame) for frame in frames],
        "bones": bone_rows,
        "collections": [
            inspect_collection(collection_name, frame, args.top, match_terms)
            for frame in frames
            for collection_name in (
                "EX001_Anatomy_Muscles",
                "EX001_Anatomy_Skeleton",
            )
        ],
    }
    print(f"EX001_ANATOMY_DEFORMATION_AUDIT={json.dumps(payload, sort_keys=True)}")


if __name__ == "__main__":
    main()
