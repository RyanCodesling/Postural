"""Build the separate atlas-derived ex_001 V3 muscle-motion proof.

The protected atlas source is opened read-only. Its registered Basis muscle and
tendon surfaces are copied into a new file, while its armature modifiers,
shape keys, actions, cameras, lights, and skeleton are discarded. V3 bakes six
evaluated atlas surface poses into an armature-free shape system, applies an
attachment-protected volume correction to mapped shoulder muscles, and adds a
coherent control hierarchy sampled from the verified shoulder action. Evaluated
OpenSim paths identify the attachment regions and muscle correspondence; they
are not misused as volumetric surface targets.

Visible atlas-derived outputs are CC BY-SA 4.0. This Python authoring code is
original Postural software covered by the repository MIT license.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import bpy
from mathutils import Matrix, Vector


SOURCE_SHA256 = "EBACE389A833056E424D0EDE53C641B8DC543FA0429836E5090BF5718779A82C"
PATH_REFERENCE_SHA256 = "964E2D119EEDD18C3C2789AE5E0EA97485C64E55C0A0693686791563927E7548"
SCHEMA_VERSION = 1
FRAME_START = 1
FRAME_END = 210
FPS = 30
THORAX_WORLD_OFFSET = Vector((0.0, 0.0, 1.45))
SAGITTAL_REFLECTION = Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0))

ROOT_COLLECTION = "EX001_MuscleAtlasV3"
MUSCLE_COLLECTION = "EX001_MuscleAtlasV3_Muscles"
RIG_COLLECTION = "EX001_MuscleAtlasV3_Rig"
STAGE_COLLECTION = "EX001_MuscleAtlasV3_Stage"
QA_COLLECTION = "EX001_MuscleAtlasV3_QA"

POSE_LABELS = (
    "rest",
    "raise_30",
    "raise_45",
    "raise_60",
    "raise_75",
    "shoulder_height",
)
POSE_KEY_NAMES = {
    "rest": "V3 Pose 12deg Rest",
    "raise_30": "V3 Pose 30deg",
    "raise_45": "V3 Pose 45deg",
    "raise_60": "V3 Pose 60deg",
    "raise_75": "V3 Pose 75deg",
    "shoulder_height": "V3 Pose 90deg",
}

# The frame knots preserve the existing 24/72/24/72/18 presentation contract.
# Interpolation is linear between adjacent authored shapes, so at most two pose
# shapes are active and their weights sum to one.
POSE_SCHEDULE = (
    (1, "rest"),
    (24, "rest"),
    (45, "raise_30"),
    (58, "raise_45"),
    (71, "raise_60"),
    (84, "raise_75"),
    (96, "shoulder_height"),
    (120, "shoulder_height"),
    (132, "raise_75"),
    (145, "raise_60"),
    (158, "raise_45"),
    (171, "raise_30"),
    (192, "rest"),
    (210, "rest"),
)

# Atlas mesh base name -> evaluated OpenSim GeometryPath channels. The mapping
# is inherited from the already documented anatomy pipeline, but V3 uses the
# paths for attachment correspondence and volume-preserving correction rather
# than treating one-dimensional lines of action as volumetric surface targets.
PATH_OBJECT_MAP = {
    "Transverse part of trapezius muscle": ("TrapeziusScapula_M",),
    "Descending part of trapezius muscle": (
        "TrapeziusScapula_S",
        "TrapeziusClavicle_S",
    ),
    "Ascending part of trapezius muscle": ("TrapeziusScapula_I",),
    "Serratus anterior muscle": (
        "SerratusAnterior_I",
        "SerratusAnterior_M",
        "SerratusAnterior_S",
    ),
    "Rhomboid major muscle": ("Rhomboideus_I",),
    "Rhomboid minor muscle": ("Rhomboideus_S",),
    "Levator scapulae": ("LevatorScapulae",),
    "Coracobrachialis muscle": ("Coracobrachialis",),
    "Clavicular part of deltoid muscle": ("DeltoideusClavicle_A",),
    "Scapular spinal part of deltoid muscle": ("DeltoideusScapula_P",),
    "Acromial part of deltoid muscle": ("DeltoideusScapula_M",),
    "Latissimus dorsi muscle": (
        "LatissimusDorsi_S",
        "LatissimusDorsi_M",
        "LatissimusDorsi_I",
    ),
    "Clavicular head of pectoralis major muscle": (
        "PectoralisMajorClavicle_S",
    ),
    "Sternocostal head of pectoralis major muscle": (
        "PectoralisMajorThorax_M",
    ),
    "(Abdominal part of pectoralis major muscle)": (
        "PectoralisMajorThorax_I",
    ),
    "Teres major muscle": ("TeresMajor",),
    "Infraspinatus muscle": ("Infraspinatus_I", "Infraspinatus_S"),
    "Pectoralis minor muscle": ("PectoralisMinor",),
    "Teres minor muscle": ("TeresMinor",),
    "Subscapularis muscle": (
        "Subscapularis_S",
        "Subscapularis_M",
        "Subscapularis_I",
    ),
    "Supraspinatus muscle": ("Supraspinatus_P", "Supraspinatus_A"),
    "Long head of triceps brachii": ("TRIlong",),
    "Long head of biceps brachii": ("BIC_long",),
    "Short head of biceps brachii": ("BIC_brevis",),
}

FRAME_TO_SOURCE_BONE = {
    "thorax": None,
    "clavicle": "Clavicle-X.{side}",
    "scapula": "Scapula.{side}",
    "humerus": {"r": "RightArm", "l": "LeftArm"},
    "radius": "Radius.{side}",
    "ulna": "Ulna.{side}",
}

CONTROL_BONES = {
    "Clavicle": "Clavicle-X.{side}",
    "Scapula": "Scapula.{side}",
    "Humerus": {"r": "RightArm", "l": "LeftArm"},
    "Forearm": "Radius.{side}",
    "Ulna": "Ulna.{side}",
    "Hand": "Proximal carpal bones-abduction.{side}",
}


@dataclass(frozen=True)
class PathSample:
    name: str
    points: tuple[Vector, ...]
    frames: tuple[str, ...]
    cumulative: tuple[float, ...]
    length: float


@dataclass(frozen=True)
class VertexPathBinding:
    weight: float
    fraction: float


@dataclass
class SourceRecord:
    name: str
    mesh: bpy.types.Mesh
    material_names: tuple[str, ...]
    properties: dict[str, Any]
    pose_coordinates: dict[str, list[Vector]]


def blender_args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    root = repo_root()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=root / "assets" / "blender" / "ex_001_lateral_arm_raise_anatomy.blend",
    )
    parser.add_argument(
        "--paths",
        type=Path,
        default=root
        / "assets"
        / "blender"
        / "reference"
        / "ex_001_ecorche_v2_paths.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=root
        / "assets"
        / "blender"
        / "ex_001_lateral_arm_raise_muscle_atlas_v3.blend",
    )
    parser.add_argument(
        "--no-volume-correction",
        action="store_true",
        help=(
            "Bake the evaluated atlas surfaces verbatim for the 48 path-mapped "
            "shoulder meshes instead of applying the surface-normal volume "
            "correction. Keeps every posed vertex traceable to the protected "
            "atlas deformation."
        ),
    )
    return parser.parse_args(blender_args())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def strip_side(name: str) -> str:
    return name[:-2] if name.endswith((".r", ".l")) else name


def side_of(name: str) -> str | None:
    if name.endswith(".r"):
        return "r"
    if name.endswith(".l"):
        return "l"
    return None


def source_bone_name(frame_name: str, side: str) -> str | None:
    template = FRAME_TO_SOURCE_BONE.get(frame_name)
    if template is None:
        return None
    if isinstance(template, dict):
        return template[side]
    return template.format(side=side)


def control_bone_name(role: str, side: str) -> str:
    template = CONTROL_BONES[role]
    if isinstance(template, dict):
        return template[side]
    return template.format(side=side)


def load_reference(path: Path) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if int(payload.get("schema_version", -1)) != 1:
        raise RuntimeError("Unexpected V3 path reference schema")
    pose_rows = {str(row["label"]): row for row in payload["poses"]}
    if tuple(payload["pose_order"]) != POSE_LABELS:
        raise RuntimeError(f"Unexpected pose order: {payload['pose_order']}")
    if set(pose_rows) != set(POSE_LABELS):
        raise RuntimeError("The path reference is missing an authored pose")
    return payload, pose_rows


def vector_path(point_row: dict[str, Any], side: str) -> Vector:
    point = Vector(point_row["blender_thorax_m"]) + THORAX_WORLD_OFFSET
    if side == "l":
        point.x *= -1.0
    return point


def make_path_sample(row: dict[str, Any], side: str) -> PathSample:
    points = tuple(vector_path(point, side) for point in row["points"])
    frames = tuple(str(point["parent_frame"]) for point in row["points"])
    cumulative = [0.0]
    for first, second in zip(points, points[1:], strict=False):
        cumulative.append(cumulative[-1] + (second - first).length)
    length = cumulative[-1]
    if length <= 1e-8:
        raise RuntimeError(f"Collapsed path: {row['name']}")
    return PathSample(
        name=str(row["name"]),
        points=points,
        frames=frames,
        cumulative=tuple(cumulative),
        length=length,
    )


def pose_paths(pose_row: dict[str, Any], side: str) -> dict[str, PathSample]:
    return {
        str(row["name"]): make_path_sample(row, side)
        for row in pose_row["muscles"]
    }


def nearest_polyline(path: PathSample, point: Vector) -> tuple[float, Vector, Vector, float]:
    best: tuple[float, Vector, Vector, float] | None = None
    for index in range(len(path.points) - 1):
        start = path.points[index]
        segment = path.points[index + 1] - start
        length_squared = segment.length_squared
        amount = (
            0.0
            if length_squared <= 1e-12
            else max(0.0, min(1.0, (point - start).dot(segment) / length_squared))
        )
        nearest = start + segment * amount
        distance = (point - nearest).length
        segment_length = math.sqrt(max(length_squared, 1e-24))
        fraction = (
            path.cumulative[index] + segment_length * amount
        ) / path.length
        tangent = segment / segment_length
        candidate = (fraction, nearest, tangent, distance)
        if best is None or distance < best[3]:
            best = candidate
    if best is None:
        raise RuntimeError(f"Path has no segments: {path.name}")
    return best


def smoothstep01(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def mesh_volume(vertices: list[Vector], polygons: Iterable[bpy.types.MeshPolygon]) -> float:
    if not vertices:
        return 0.0
    reference = sum(vertices, Vector()) / len(vertices)
    signed = 0.0
    for polygon in polygons:
        indices = tuple(polygon.vertices)
        if len(indices) < 3:
            continue
        first = vertices[indices[0]] - reference
        for offset in range(1, len(indices) - 1):
            second = vertices[indices[offset]] - reference
            third = vertices[indices[offset + 1]] - reference
            signed += first.dot(second.cross(third)) / 6.0
    return abs(signed)


def signed_mesh_volume(
    vertices: list[Vector],
    polygons: Iterable[bpy.types.MeshPolygon],
) -> float:
    if not vertices:
        return 0.0
    reference = sum(vertices, Vector()) / len(vertices)
    signed = 0.0
    for polygon in polygons:
        indices = tuple(polygon.vertices)
        if len(indices) < 3:
            continue
        first = vertices[indices[0]] - reference
        for offset in range(1, len(indices) - 1):
            second = vertices[indices[offset]] - reference
            third = vertices[indices[offset + 1]] - reference
            signed += first.dot(second.cross(third)) / 6.0
    return signed


def correct_volume_along_normals(
    vertices: list[Vector],
    polygons: Iterable[bpy.types.MeshPolygon],
    target_volume: float,
    belly_strengths: list[float],
) -> tuple[list[Vector], float]:
    """Restore volume by a small surface-normal bulge away from attachments."""

    polygon_rows = tuple(polygons)
    output = [vertex.copy() for vertex in vertices]
    for _ in range(10):
        signed_volume = signed_mesh_volume(output, polygon_rows)
        current_volume = abs(signed_volume)
        if current_volume <= 1e-14:
            raise RuntimeError("An evaluated atlas muscle collapsed to zero volume")
        ratio = current_volume / target_volume
        if 0.99 <= ratio <= 1.01:
            break
        orientation = 1.0 if signed_volume >= 0.0 else -1.0
        normal_sums = [Vector() for _ in output]
        vertex_areas = [0.0] * len(output)
        for polygon in polygon_rows:
            indices = tuple(polygon.vertices)
            if len(indices) < 3:
                continue
            first_index = indices[0]
            first = output[first_index]
            for offset in range(1, len(indices) - 1):
                second_index = indices[offset]
                third_index = indices[offset + 1]
                cross = (output[second_index] - first).cross(
                    output[third_index] - first
                )
                twice_area = cross.length
                if twice_area <= 1e-16:
                    continue
                area = twice_area * 0.5
                outward = cross * (orientation / twice_area)
                for vertex_index in (first_index, second_index, third_index):
                    normal_sums[vertex_index] += outward * area
                    vertex_areas[vertex_index] += area / 3.0
        effective_area = sum(
            area * strength
            for area, strength in zip(vertex_areas, belly_strengths, strict=True)
        )
        if effective_area <= 1e-12:
            break
        displacement = max(
            -0.006,
            min(0.006, (target_volume - current_volume) / effective_area),
        )
        corrected = []
        for vertex, normal, strength in zip(
            output,
            normal_sums,
            belly_strengths,
            strict=True,
        ):
            direction = normal.normalized() if normal.length_squared > 1e-18 else Vector()
            corrected.append(vertex + direction * displacement * strength)
        output = corrected
    return output, mesh_volume(output, polygon_rows) / target_volume


def nearest_anchor_indices(
    vertices: list[Vector],
    endpoints: Iterable[Vector],
    count: int,
) -> list[int]:
    endpoint_rows = tuple(endpoints)
    distances = [
        min((vertex - endpoint).length for endpoint in endpoint_rows)
        for vertex in vertices
    ]
    return sorted(range(len(vertices)), key=distances.__getitem__)[:count]


def build_bindings(
    vertices: list[Vector],
    paths: dict[str, PathSample],
    path_names: tuple[str, ...],
) -> tuple[list[list[VertexPathBinding]], list[int], list[int]]:
    bindings: list[list[VertexPathBinding]] = []
    for vertex in vertices:
        candidates = []
        for path_name in path_names:
            path = paths[path_name]
            fraction, nearest, tangent, distance = nearest_polyline(path, vertex)
            candidates.append((path, fraction, nearest, tangent, distance))
        raw_weights = [1.0 / ((candidate[4] + 0.004) ** 2) for candidate in candidates]
        total = sum(raw_weights)
        bindings.append(
            [
                VertexPathBinding(
                    weight=raw_weight / total,
                    fraction=candidate[1],
                )
                for candidate, raw_weight in zip(candidates, raw_weights, strict=True)
            ]
        )
    count = max(6, min(32, int(round(len(vertices) * 0.004))))
    origins = nearest_anchor_indices(
        vertices,
        (paths[name].points[0] for name in path_names),
        count,
    )
    insertions = nearest_anchor_indices(
        vertices,
        (paths[name].points[-1] for name in path_names),
        count,
    )
    return bindings, origins, insertions


def make_material(
    name: str,
    color: tuple[float, float, float, float],
    roughness: float,
    metallic: float = 0.0,
) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    result.diffuse_color = color
    principled = result.node_tree.nodes.get("Principled BSDF")
    if principled is not None:
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Roughness"].default_value = roughness
        principled.inputs["Metallic"].default_value = metallic
        if "Coat Weight" in principled.inputs:
            principled.inputs["Coat Weight"].default_value = 0.08
    return result


def create_collection(
    name: str,
    parent: bpy.types.Collection,
) -> bpy.types.Collection:
    collection = bpy.data.collections.new(name)
    parent.children.link(collection)
    return collection


def elevation_from_down(rig: bpy.types.Object, bone_name: str) -> float:
    pose_bone = rig.pose.bones[bone_name]
    direction = (pose_bone.tail - pose_bone.head).normalized()
    return math.degrees(direction.angle(Vector((0.0, 0.0, -1.0))))


def choose_source_frames(
    scene: bpy.types.Scene,
    rig: bpy.types.Object,
    pose_rows: dict[str, dict[str, Any]],
) -> dict[str, int]:
    samples = []
    for frame in range(1, 121):
        scene.frame_set(frame)
        samples.append((frame, elevation_from_down(rig, "RightArm")))
    chosen = {}
    for label in POSE_LABELS:
        requested = float(pose_rows[label]["evaluated_arm_elevation_degrees"])
        chosen[label] = min(samples, key=lambda row: abs(row[1] - requested))[0]
    if len(set(chosen.values())) != len(POSE_LABELS):
        raise RuntimeError(f"Source pose frames are not unique: {chosen}")
    return chosen


def capture_bone_matrices(
    scene: bpy.types.Scene,
    rig: bpy.types.Object,
    source_frames: dict[str, int],
) -> dict[str, dict[str, Matrix]]:
    names = set()
    for side in ("r", "l"):
        for frame_name in FRAME_TO_SOURCE_BONE:
            bone_name = source_bone_name(frame_name, side)
            if bone_name is not None:
                names.add(bone_name)
        for role in CONTROL_BONES:
            names.add(control_bone_name(role, side))
    missing = sorted(name for name in names if name not in rig.pose.bones)
    if missing:
        raise RuntimeError(f"Atlas source is missing V3 control bones: {missing}")
    result: dict[str, dict[str, Matrix]] = {}
    for label, frame in source_frames.items():
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        result[label] = {
            name: rig.matrix_world @ rig.pose.bones[name].matrix.copy()
            for name in sorted(names)
        }
    return result


def capture_source_records(
    scene: bpy.types.Scene,
    collection: bpy.types.Collection,
    source_frames: dict[str, int],
) -> list[SourceRecord]:
    source_objects = [
        obj
        for obj in sorted(collection.all_objects, key=lambda item: item.name)
        if obj.type == "MESH"
    ]
    if len(source_objects) != 482:
        raise RuntimeError(
            f"Expected 482 atlas muscle/tendon meshes, found {len(source_objects)}"
        )
    # Sample only topology-preserving armature deformation. Display modifiers
    # such as subdivision make evaluated vertex indices incompatible with the
    # atlas Basis mesh and are intentionally not carried into the V3 asset.
    for obj in source_objects:
        for modifier in obj.modifiers:
            if modifier.type != "ARMATURE":
                modifier.show_viewport = False
    pose_coordinates: dict[str, dict[str, list[Vector]]] = {
        obj.name: {} for obj in source_objects
    }
    for label in POSE_LABELS:
        scene.frame_set(source_frames[label])
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        capture_objects = (
            source_objects
            if label == "rest"
            else [
                obj
                for obj in source_objects
                if side_of(obj.name) is not None and strip_side(obj.name) in PATH_OBJECT_MAP
            ]
        )
        for index, obj in enumerate(capture_objects, start=1):
            evaluated = obj.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            try:
                if len(mesh.vertices) != len(obj.data.vertices):
                    raise RuntimeError(
                        f"Evaluated topology changed for {obj.name}: "
                        f"{len(obj.data.vertices)} -> {len(mesh.vertices)}"
                    )
                pose_coordinates[obj.name][label] = [
                    evaluated.matrix_world @ vertex.co for vertex in mesh.vertices
                ]
            finally:
                evaluated.to_mesh_clear()
            if index % 120 == 0 or index == len(capture_objects):
                print(
                    f"Captured atlas pose {label}: {index}/{len(capture_objects)}",
                    flush=True,
                )

    rows = []
    for obj in source_objects:
        mesh = obj.data.copy()
        properties = {
            key: obj[key]
            for key in (
                "atlas_upper_limb",
                "rigid_upper_limb_segment",
                "segment_bone",
                "atlas_registered_center_world",
                "source",
            )
            if key in obj
        }
        rows.append(
            SourceRecord(
                name=obj.name,
                mesh=mesh,
                material_names=tuple(
                    material.name if material is not None else ""
                    for material in obj.data.materials
                ),
                properties=properties,
                pose_coordinates=pose_coordinates[obj.name],
            )
        )
    return rows


def clear_loaded_source(new_scene: bpy.types.Scene) -> None:
    bpy.context.window.scene = new_scene
    for scene in tuple(bpy.data.scenes):
        if scene is not new_scene:
            bpy.data.scenes.remove(scene)
    for obj in tuple(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in tuple(bpy.data.collections):
        bpy.data.collections.remove(collection)


def create_muscle_objects(
    records: list[SourceRecord],
    collection: bpy.types.Collection,
    muscle_material: bpy.types.Material,
    tendon_material: bpy.types.Material,
    source_hash: str,
) -> tuple[list[bpy.types.Object], dict[str, SourceRecord]]:
    objects = []
    record_by_name = {record.name: record for record in records}
    for record in records:
        obj = bpy.data.objects.new(record.name, record.mesh)
        collection.objects.link(obj)
        obj.matrix_world = Matrix.Identity(4)
        if obj.data.shape_keys is not None:
            obj.shape_key_clear()
        rest_coordinates = record.pose_coordinates["rest"]
        if len(rest_coordinates) != len(obj.data.vertices):
            raise RuntimeError(f"Atlas rest topology changed for {obj.name}")
        for vertex, coordinate in zip(
            obj.data.vertices,
            rest_coordinates,
            strict=True,
        ):
            vertex.co = coordinate
        for modifier in tuple(obj.modifiers):
            obj.modifiers.remove(modifier)
        obj.parent = None
        if not obj.data.materials:
            obj.data.materials.append(muscle_material)
        else:
            for index, source_name in enumerate(record.material_names):
                obj.data.materials[index] = (
                    tendon_material
                    if "tendon" in source_name.casefold()
                    else muscle_material
                )
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        obj["v3_schema_version"] = SCHEMA_VERSION
        obj["atlas_source_name"] = record.name
        obj["atlas_source_sha256"] = source_hash
        obj["asset_license"] = "CC BY-SA 4.0"
        obj["asset_attribution"] = "Z-Anatomy; BodyParts3D / DBCLS"
        objects.append(obj)
    return objects, record_by_name


def action_fcurves(action: bpy.types.Action | None) -> list[bpy.types.FCurve]:
    """Return legacy or Blender 4.4+ layered Action F-Curves."""

    if action is None:
        return []
    legacy = getattr(action, "fcurves", None)
    if legacy is not None:
        curves = list(legacy)
        if curves:
            return curves
    curves = []
    for layer in getattr(action, "layers", ()):
        for strip in layer.strips:
            for channelbag in getattr(strip, "channelbags", ()):
                curves.extend(channelbag.fcurves)
    return curves


def add_pose_shapes(
    obj: bpy.types.Object,
    pose_coordinates: dict[str, list[Vector]],
) -> None:
    obj.shape_key_add(name="Basis")
    for label in POSE_LABELS:
        key = obj.shape_key_add(name=POSE_KEY_NAMES[label])
        coordinates = pose_coordinates[label]
        if len(coordinates) != len(key.data):
            raise RuntimeError(f"Pose vertex count changed for {obj.name}")
        for target, coordinate in zip(key.data, coordinates, strict=True):
            target.co = coordinate
        key.value = 0.0
    for frame, active_label in POSE_SCHEDULE:
        for label in POSE_LABELS:
            key = obj.data.shape_keys.key_blocks[POSE_KEY_NAMES[label]]
            key.value = 1.0 if label == active_label else 0.0
            key.keyframe_insert(data_path="value", frame=frame)
    action = (
        obj.data.shape_keys.animation_data.action
        if obj.data.shape_keys.animation_data is not None
        else None
    )
    for curve in action_fcurves(action):
        for keyframe in curve.keyframe_points:
            keyframe.interpolation = "LINEAR"


def animate_controls(
    rig_collection: bpy.types.Collection,
    bone_matrices: dict[str, dict[str, Matrix]],
) -> dict[str, bpy.types.Object]:
    root = bpy.data.objects.new("V3_Rig_Thorax", None)
    rig_collection.objects.link(root)
    root.empty_display_type = "CUBE"
    root.empty_display_size = 0.06
    root["v3_control_role"] = "thorax"
    controls: dict[str, bpy.types.Object] = {"Thorax": root}
    parent_roles = {
        "Clavicle": "Thorax",
        "Scapula": "Clavicle",
        "Humerus": "Scapula",
        "Forearm": "Humerus",
        "Ulna": "Forearm",
        "Hand": "Forearm",
    }
    for side in ("r", "l"):
        side_label = "R" if side == "r" else "L"
        for role in ("Clavicle", "Scapula", "Humerus", "Forearm", "Ulna", "Hand"):
            name = f"V3_Rig_{role}.{side_label}"
            control = bpy.data.objects.new(name, None)
            rig_collection.objects.link(control)
            control.empty_display_type = "ARROWS"
            control.empty_display_size = 0.045 if role != "Humerus" else 0.07
            parent_role = parent_roles[role]
            parent = root if parent_role == "Thorax" else controls[f"{parent_role}.{side_label}"]
            control.parent = parent
            control.matrix_parent_inverse = Matrix.Identity(4)
            control.rotation_mode = "QUATERNION"
            control["v3_control_role"] = role.casefold()
            control["v3_parent_control"] = parent.name
            controls[f"{role}.{side_label}"] = control

    for frame, label in POSE_SCHEDULE:
        world_by_control: dict[str, Matrix] = {root.name: Matrix.Identity(4)}
        for side in ("r", "l"):
            side_label = "R" if side == "r" else "L"
            for role in ("Clavicle", "Scapula", "Humerus", "Forearm", "Ulna", "Hand"):
                control = controls[f"{role}.{side_label}"]
                target_world = bone_matrices[label][control_bone_name(role, side)]
                parent_world = world_by_control[control.parent.name]
                local = parent_world.inverted_safe() @ target_world
                location, rotation, scale = local.decompose()
                control.location = location
                control.rotation_quaternion = rotation
                control.scale = scale
                control.keyframe_insert(data_path="location", frame=frame)
                control.keyframe_insert(data_path="rotation_quaternion", frame=frame)
                control.keyframe_insert(data_path="scale", frame=frame)
                world_by_control[control.name] = target_world
    for control in controls.values():
        action = control.animation_data.action if control.animation_data else None
        for curve in action_fcurves(action):
            for keyframe in curve.keyframe_points:
                keyframe.interpolation = "LINEAR"
    return controls


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def configure_stage(
    scene: bpy.types.Scene,
    stage_collection: bpy.types.Collection,
) -> None:
    floor_material = make_material("V3_Stage", (0.045, 0.055, 0.065, 1.0), 0.72)
    bpy.ops.mesh.primitive_plane_add(size=14.0, location=(0.0, 0.0, -0.018))
    floor = bpy.context.object
    floor.name = "V3_Stage_Floor"
    for collection in tuple(floor.users_collection):
        collection.objects.unlink(floor)
    stage_collection.objects.link(floor)
    floor.data.materials.append(floor_material)

    camera_data = bpy.data.cameras.new("V3_Camera_Data")
    camera = bpy.data.objects.new("V3_Camera", camera_data)
    stage_collection.objects.link(camera)
    camera.location = (2.25, -4.75, 1.35)
    camera.data.lens = 62
    camera.data.sensor_width = 36
    look_at(camera, Vector((0.0, 0.0, 0.92)))
    scene.camera = camera

    lights = (
        ("V3_Key", (2.8, -3.5, 3.8), 1850.0, 3.0),
        ("V3_Fill", (-3.0, -2.1, 2.4), 1250.0, 3.2),
        ("V3_Rim", (0.0, 2.8, 3.2), 1700.0, 2.5),
        ("V3_Front", (0.0, -4.0, 1.45), 900.0, 2.4),
    )
    for name, location, energy, size in lights:
        data = bpy.data.lights.new(f"{name}_Data", "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        light = bpy.data.objects.new(name, data)
        stage_collection.objects.link(light)
        light.location = location
        look_at(light, Vector((0.0, 0.0, 1.0)))

    world = bpy.data.worlds.new("V3_World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (
        0.012,
        0.016,
        0.022,
        1.0,
    )
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.42
    scene.world = world
    scene.frame_start = FRAME_START
    scene.frame_end = FRAME_END
    scene.frame_step = 1
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 960
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.view_settings.exposure = 0.35
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.timeline_markers.clear()
    for frame, name in (
        (1, "Rest"),
        (25, "Raise"),
        (97, "Hold"),
        (121, "Lower"),
        (193, "Settle"),
    ):
        scene.timeline_markers.new(name, frame=frame)


def build_dynamic_geometry(
    objects: list[bpy.types.Object],
    records: dict[str, SourceRecord],
    pose_rows: dict[str, dict[str, Any]],
    bone_matrices: dict[str, dict[str, Matrix]],
    volume_correction: bool,
) -> dict[str, Any]:
    rest_paths_by_side = {
        side: pose_paths(pose_rows["rest"], side) for side in ("r", "l")
    }
    path_deformed = 0
    rigid_segment = 0
    static = 0
    volume_ratios: dict[str, list[float]] = {}
    for index, obj in enumerate(objects, start=1):
        record = records[obj.name]
        base_name = strip_side(obj.name)
        side = side_of(obj.name)
        base_vertices = [
            vertex.copy() for vertex in record.pose_coordinates["rest"]
        ]
        if side is not None and base_name in PATH_OBJECT_MAP:
            path_names = PATH_OBJECT_MAP[base_name]
            rest_paths = rest_paths_by_side[side]
            missing = sorted(name for name in path_names if name not in rest_paths)
            if missing:
                raise RuntimeError(f"Missing V3 paths for {obj.name}: {missing}")
            bindings, origins, insertions = build_bindings(
                base_vertices,
                rest_paths,
                path_names,
            )
            base_volume = mesh_volume(base_vertices, obj.data.polygons)
            if base_volume <= 1e-14:
                raise RuntimeError(f"Atlas mesh is not a closed volume: {obj.name}")
            belly_strengths = [
                max(
                    0.0,
                    min(
                        1.0,
                        sum(
                            smoothstep01(
                                min(binding.fraction, 1.0 - binding.fraction) / 0.12
                            )
                            * binding.weight
                            for binding in vertex_bindings
                        ),
                    ),
                )
                for vertex_bindings in bindings
            ]
            pose_coordinates = {"rest": [point.copy() for point in base_vertices]}
            ratios = [1.0]
            for label in POSE_LABELS[1:]:
                if volume_correction:
                    coordinates, ratio = correct_volume_along_normals(
                        record.pose_coordinates[label],
                        obj.data.polygons,
                        base_volume,
                        belly_strengths,
                    )
                else:
                    # Verbatim atlas surface. The evaluated armature deformation
                    # is not isovolumetric, so the ratio is reported rather than
                    # driven to 1.0; forcing it along vertex normals self-
                    # intersects thin, broad sheets such as the pectoral heads.
                    coordinates = [
                        point.copy() for point in record.pose_coordinates[label]
                    ]
                    ratio = mesh_volume(coordinates, obj.data.polygons) / base_volume
                pose_coordinates[label] = coordinates
                ratios.append(ratio)
            add_pose_shapes(obj, pose_coordinates)
            obj["v3_deformation"] = (
                "baked evaluated atlas pose; attachment-protected normal-volume correction"
                if volume_correction
                else "baked evaluated atlas pose; verbatim atlas surface"
            )
            obj["v3_path_names_json"] = json.dumps(path_names)
            obj["v3_origin_anchor_indices"] = origins
            obj["v3_insertion_anchor_indices"] = insertions
            obj["v3_pose_volume_ratios"] = ratios
            volume_ratios[obj.name] = ratios
            path_deformed += 1
        else:
            rigid_bone = record.properties.get("rigid_upper_limb_segment")
            if side is not None and isinstance(rigid_bone, str):
                pose_coordinates = {"rest": [point.copy() for point in base_vertices]}
                rest_matrix = bone_matrices["rest"][rigid_bone]
                for label in POSE_LABELS[1:]:
                    delta = bone_matrices[label][rigid_bone] @ rest_matrix.inverted_safe()
                    rotation = delta.to_quaternion().normalized()
                    translation = delta.to_translation()
                    pose_coordinates[label] = [
                        rotation @ point + translation for point in base_vertices
                    ]
                add_pose_shapes(obj, pose_coordinates)
                base_volume = mesh_volume(base_vertices, obj.data.polygons)
                ratios = [
                    mesh_volume(pose_coordinates[label], obj.data.polygons) / base_volume
                    for label in POSE_LABELS
                ]
                obj["v3_deformation"] = "rigid anatomical segment pose"
                obj["v3_segment_bone"] = rigid_bone
                obj["v3_pose_volume_ratios"] = ratios
                volume_ratios[obj.name] = ratios
                rigid_segment += 1
            else:
                obj["v3_deformation"] = "static atlas rest surface"
                static += 1
        if index % 40 == 0:
            print(f"Processed V3 muscles: {index}/{len(objects)}", flush=True)
    if path_deformed != 48 or rigid_segment != 78 or static != 356:
        raise RuntimeError(
            "Unexpected V3 deformation coverage: "
            f"path={path_deformed}, rigid={rigid_segment}, static={static}"
        )
    return {
        "path_deformed": path_deformed,
        "rigid_segment": rigid_segment,
        "static": static,
        "volume_correction": volume_correction,
        "max_volume_delta_pct": max(
            abs(ratio - 1.0) * 100.0
            for ratios in volume_ratios.values()
            for ratio in ratios
        ),
    }


def purge_orphans() -> None:
    for _ in range(4):
        result = bpy.ops.outliner.orphans_purge(
            do_local_ids=True,
            do_linked_ids=True,
            do_recursive=True,
        )
        if result != {"FINISHED"}:
            break


def main() -> None:
    args = parse_args()
    source = args.source.resolve()
    paths_path = args.paths.resolve()
    output = args.output.resolve()
    if not source.is_file() or not paths_path.is_file():
        raise FileNotFoundError("V3 source blend and path reference must exist")
    source_hash = sha256(source)
    path_hash = sha256(paths_path)
    if source_hash != SOURCE_SHA256:
        raise RuntimeError(f"Protected atlas hash changed: {source_hash}")
    if path_hash != PATH_REFERENCE_SHA256:
        raise RuntimeError(f"V3 path reference hash changed: {path_hash}")
    reference, pose_rows = load_reference(paths_path)

    print(f"Opening protected atlas read-only: {source}", flush=True)
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False)
    source_scene = bpy.context.scene
    source_rig = bpy.data.objects.get("Anatomy_Armature")
    source_collection = bpy.data.collections.get("EX001_Anatomy_Muscles")
    if source_rig is None or source_collection is None:
        raise RuntimeError("Protected atlas source is missing required V3 inputs")
    source_frames = choose_source_frames(source_scene, source_rig, pose_rows)
    bone_matrices = capture_bone_matrices(source_scene, source_rig, source_frames)
    records = capture_source_records(source_scene, source_collection, source_frames)

    new_scene = bpy.data.scenes.new("ex_001_muscle_atlas_v3")
    clear_loaded_source(new_scene)
    root = bpy.data.collections.new(ROOT_COLLECTION)
    new_scene.collection.children.link(root)
    muscle_collection = create_collection(MUSCLE_COLLECTION, root)
    rig_collection = create_collection(RIG_COLLECTION, root)
    stage_collection = create_collection(STAGE_COLLECTION, root)
    qa_collection = create_collection(QA_COLLECTION, root)
    qa_collection.hide_render = True

    muscle_material = make_material(
        "V3_Muscle_Red",
        (0.46, 0.025, 0.018, 1.0),
        0.46,
    )
    tendon_material = make_material(
        "V3_Tendon_Ivory",
        (0.78, 0.63, 0.43, 1.0),
        0.56,
    )
    objects, record_by_name = create_muscle_objects(
        records,
        muscle_collection,
        muscle_material,
        tendon_material,
        source_hash,
    )
    coverage = build_dynamic_geometry(
        objects,
        record_by_name,
        pose_rows,
        bone_matrices,
        not args.no_volume_correction,
    )
    controls = animate_controls(rig_collection, bone_matrices)
    configure_stage(new_scene, stage_collection)

    root["v3_schema_version"] = SCHEMA_VERSION
    root["exercise_id"] = "ex_001"
    root["asset_family"] = "atlas-derived muscle model V3"
    root["asset_license"] = "CC BY-SA 4.0"
    root["source_attribution"] = "Z-Anatomy; BodyParts3D / DBCLS"
    root["source_atlas_sha256"] = source_hash
    root["path_reference_sha256"] = path_hash
    root["path_reference_source"] = reference["source"]["repository"]
    root["pose_labels_json"] = json.dumps(POSE_LABELS)
    root["pose_schedule_json"] = json.dumps(POSE_SCHEDULE)
    root["source_pose_frames_json"] = json.dumps(source_frames, sort_keys=True)
    root["muscle_meshes"] = len(objects)
    root["path_deformed_meshes"] = coverage["path_deformed"]
    root["rigid_segment_meshes"] = coverage["rigid_segment"]
    root["static_meshes"] = coverage["static"]
    root["control_objects"] = len(controls)
    root["authored_max_volume_delta_pct"] = coverage["max_volume_delta_pct"]
    root["v3_volume_correction"] = not args.no_volume_correction
    root["medical_accuracy_boundary"] = (
        "anatomically grounded instructional asset; not clinically validated"
    )
    new_scene["v3_peak_frame"] = 108
    new_scene["v3_frame_count"] = FRAME_END
    new_scene["v3_fps"] = FPS
    new_scene["v3_primary_visibility"] = "muscle and tendon surfaces only"
    new_scene.frame_set(1)
    bpy.context.view_layer.update()
    purge_orphans()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    print(
        "EX001_MUSCLE_ATLAS_V3_BUILD="
        + json.dumps(
            {
                "output": str(output),
                "source_hash": source_hash,
                "path_hash": path_hash,
                "source_pose_frames": source_frames,
                "muscle_meshes": len(objects),
                **coverage,
            },
            sort_keys=True,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
