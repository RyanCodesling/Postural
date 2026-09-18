"""Independently validate the saved ex_001 atlas-derived V3 motion proof.

The inspector does not import the builder. It verifies the saved V3 scene,
compares its rest surfaces and attachment regions with the protected atlas,
measures every authored shape, checks the complete 210-frame weight schedule,
and exercises in-memory negative controls. Nothing is saved back to either
``.blend`` input.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any, Callable

import bpy
from mathutils import Vector


ATLAS_SHA256 = "EBACE389A833056E424D0EDE53C641B8DC543FA0429836E5090BF5718779A82C"
PATHS_SHA256 = "964E2D119EEDD18C3C2789AE5E0EA97485C64E55C0A0693686791563927E7548"
ROOT_COLLECTION = "EX001_MuscleAtlasV3"
MUSCLE_COLLECTION = "EX001_MuscleAtlasV3_Muscles"
RIG_COLLECTION = "EX001_MuscleAtlasV3_Rig"
SOURCE_COLLECTION = "EX001_Anatomy_Muscles"
POSE_LABELS = (
    "rest",
    "raise_30",
    "raise_45",
    "raise_60",
    "raise_75",
    "shoulder_height",
)
POSE_KEYS = {
    "rest": "V3 Pose 12deg Rest",
    "raise_30": "V3 Pose 30deg",
    "raise_45": "V3 Pose 45deg",
    "raise_60": "V3 Pose 60deg",
    "raise_75": "V3 Pose 75deg",
    "shoulder_height": "V3 Pose 90deg",
}
POSE_FRAMES = {
    "rest": 1,
    "raise_30": 45,
    "raise_45": 58,
    "raise_60": 71,
    "raise_75": 84,
    "shoulder_height": 96,
}
PATH_BASE_NAMES = {
    "Transverse part of trapezius muscle",
    "Descending part of trapezius muscle",
    "Ascending part of trapezius muscle",
    "Serratus anterior muscle",
    "Rhomboid major muscle",
    "Rhomboid minor muscle",
    "Levator scapulae",
    "Coracobrachialis muscle",
    "Clavicular part of deltoid muscle",
    "Scapular spinal part of deltoid muscle",
    "Acromial part of deltoid muscle",
    "Latissimus dorsi muscle",
    "Clavicular head of pectoralis major muscle",
    "Sternocostal head of pectoralis major muscle",
    "(Abdominal part of pectoralis major muscle)",
    "Teres major muscle",
    "Infraspinatus muscle",
    "Pectoralis minor muscle",
    "Teres minor muscle",
    "Subscapularis muscle",
    "Supraspinatus muscle",
    "Long head of triceps brachii",
    "Long head of biceps brachii",
    "Short head of biceps brachii",
}
EXPECTED_CONTROL_PARENTS = {
    "V3_Rig_Thorax": None,
    "V3_Rig_Clavicle.R": "V3_Rig_Thorax",
    "V3_Rig_Scapula.R": "V3_Rig_Clavicle.R",
    "V3_Rig_Humerus.R": "V3_Rig_Scapula.R",
    "V3_Rig_Forearm.R": "V3_Rig_Humerus.R",
    "V3_Rig_Ulna.R": "V3_Rig_Forearm.R",
    "V3_Rig_Hand.R": "V3_Rig_Forearm.R",
    "V3_Rig_Clavicle.L": "V3_Rig_Thorax",
    "V3_Rig_Scapula.L": "V3_Rig_Clavicle.L",
    "V3_Rig_Humerus.L": "V3_Rig_Scapula.L",
    "V3_Rig_Forearm.L": "V3_Rig_Humerus.L",
    "V3_Rig_Ulna.L": "V3_Rig_Forearm.L",
    "V3_Rig_Hand.L": "V3_Rig_Forearm.L",
}
MAX_VOLUME_DELTA_PERCENT = 1.5
MAX_REST_REGISTRATION_M = 1e-6
MAX_ATTACHMENT_ERROR_M = 0.015
MAX_RIGID_EDGE_STRAIN = 0.005
MAX_RIGID_EDGE_ABSOLUTE_ERROR_M = 2e-6
RIGID_RELATIVE_EDGE_MIN_LENGTH_M = 1e-4
MAX_PATH_EDGE_P95_STRAIN = 1.25
MAX_ELEVATION_ERROR_DEG = 3.0


class ValidationError(RuntimeError):
    """Expected validation rejection used by positive and negative checks."""


def blender_args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--atlas",
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
        / "reference"
        / "ex_001_muscle_atlas_v3_validation.json",
    )
    return parser.parse_args(blender_args())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def strip_side(name: str) -> str:
    return name[:-2] if name.endswith((".r", ".l")) else name


def mesh_volume(vertices: list[Vector], polygons: list[tuple[int, ...]]) -> float:
    if not vertices:
        return 0.0
    reference = sum(vertices, Vector()) / len(vertices)
    signed = 0.0
    for polygon in polygons:
        if len(polygon) < 3:
            continue
        first = vertices[polygon[0]] - reference
        for index in range(1, len(polygon) - 1):
            second = vertices[polygon[index]] - reference
            third = vertices[polygon[index + 1]] - reference
            signed += first.dot(second.cross(third)) / 6.0
    return abs(signed)


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(math.ceil(fraction * len(ordered))) - 1)
    return ordered[max(0, index)]


def pose_coordinates(obj: bpy.types.Object, label: str) -> list[Vector]:
    shape_keys = obj.data.shape_keys
    if shape_keys is None or POSE_KEYS[label] not in shape_keys.key_blocks:
        raise ValidationError(f"Missing {label} shape for {obj.name}")
    return [point.co.copy() for point in shape_keys.key_blocks[POSE_KEYS[label]].data]


def validate_exact_hash(actual: str, expected: str, label: str) -> None:
    if actual != expected:
        raise ValidationError(f"{label} hash mismatch: {actual}")


def validate_manifest(actual: list[str], expected: list[str]) -> None:
    if actual != expected:
        missing = sorted(set(expected) - set(actual))[:5]
        extra = sorted(set(actual) - set(expected))[:5]
        raise ValidationError(f"Manifest mismatch; missing={missing}, extra={extra}")


def validate_volume_delta(delta_percent: float) -> None:
    if delta_percent > MAX_VOLUME_DELTA_PERCENT:
        raise ValidationError(f"Volume delta {delta_percent:.6f}% exceeds tolerance")


def validate_attachment_error(error_m: float) -> None:
    if error_m > MAX_ATTACHMENT_ERROR_M:
        raise ValidationError(f"Attachment error {error_m:.6f} m exceeds tolerance")


def validate_pose_weights(values: list[float]) -> None:
    if any(value < -1e-6 or value > 1.000001 for value in values):
        raise ValidationError(f"Pose weight outside [0, 1]: {values}")
    active = [index for index, value in enumerate(values) if value > 1e-5]
    if len(active) > 2:
        raise ValidationError(f"More than two pose weights active: {values}")
    if active and max(active) - min(active) > 1:
        raise ValidationError(f"Non-adjacent pose weights active: {values}")
    if abs(sum(values) - 1.0) > 1e-5:
        raise ValidationError(f"Pose weights do not sum to one: {values}")


def validate_parent_map(actual: dict[str, str | None]) -> None:
    if actual != EXPECTED_CONTROL_PARENTS:
        raise ValidationError(f"Control hierarchy mismatch: {actual}")


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


def action_curve_value(
    shape_keys: bpy.types.Key,
    key_name: str,
    frame: int,
) -> float:
    animation_data = shape_keys.animation_data
    action = animation_data.action if animation_data is not None else None
    if action is None:
        raise ValidationError(f"Shape-key action missing for {shape_keys.name}")
    data_path = f'key_blocks["{key_name}"].value'
    matches = [curve for curve in action_fcurves(action) if curve.data_path == data_path]
    if len(matches) != 1:
        raise ValidationError(
            f"Expected one curve for {shape_keys.name}:{key_name}, found {len(matches)}"
        )
    return float(matches[0].evaluate(frame))


def expected_path_names(names: list[str]) -> list[str]:
    return sorted(
        name
        for name in names
        if name.endswith((".r", ".l")) and strip_side(name) in PATH_BASE_NAMES
    )


def run_negative_controls(
    manifest: list[str],
    parent_map: dict[str, str | None],
) -> list[dict[str, Any]]:
    controls: list[tuple[str, Callable[[], None]]] = [
        (
            "source_hash_tamper",
            lambda: validate_exact_hash("0" * 64, ATLAS_SHA256, "atlas"),
        ),
        (
            "manifest_missing_mesh",
            lambda: validate_manifest(manifest[:-1], manifest),
        ),
        ("volume_scale", lambda: validate_volume_delta(20.0)),
        ("attachment_shift", lambda: validate_attachment_error(0.05)),
        (
            "pose_weight_overlap",
            lambda: validate_pose_weights([0.5, 0.5, 0.5, 0.0, 0.0, 0.0]),
        ),
        (
            "control_parent_corruption",
            lambda: validate_parent_map(
                {**parent_map, "V3_Rig_Humerus.R": "V3_Rig_Thorax"}
            ),
        ),
    ]
    results = []
    for name, control in controls:
        try:
            control()
        except ValidationError as error:
            results.append({"name": name, "rejected": True, "reason": str(error)})
        else:
            results.append({"name": name, "rejected": False, "reason": None})
    return results


def main() -> None:
    args = parse_args()
    source_blend = Path(bpy.data.filepath).resolve()
    atlas_path = args.atlas.resolve()
    paths_path = args.paths.resolve()
    output_path = args.output.resolve()
    if not source_blend.is_file():
        raise RuntimeError("Inspector must run from the saved V3 .blend")
    if not atlas_path.is_file() or not paths_path.is_file():
        raise FileNotFoundError("Protected atlas and path reference are required")

    failures: list[str] = []

    def record_check(callback: Callable[[], None]) -> None:
        try:
            callback()
        except (ValidationError, KeyError, TypeError, ValueError) as error:
            failures.append(str(error))

    atlas_hash = sha256(atlas_path)
    paths_hash = sha256(paths_path)
    record_check(lambda: validate_exact_hash(atlas_hash, ATLAS_SHA256, "atlas"))
    record_check(lambda: validate_exact_hash(paths_hash, PATHS_SHA256, "paths"))
    paths_payload = json.loads(paths_path.read_text(encoding="utf-8"))
    expected_elevations = {
        str(row["label"]): float(row["evaluated_arm_elevation_degrees"])
        for row in paths_payload["poses"]
    }

    scene = bpy.context.scene
    root = bpy.data.collections.get(ROOT_COLLECTION)
    muscle_collection = bpy.data.collections.get(MUSCLE_COLLECTION)
    rig_collection = bpy.data.collections.get(RIG_COLLECTION)
    if root is None or muscle_collection is None or rig_collection is None:
        raise RuntimeError("Saved V3 collections are incomplete")
    # Builds predating the verbatim mode carry no flag and were volume-corrected.
    volume_correction_enabled = bool(root.get("v3_volume_correction", True))
    expected_root_properties = {
        "v3_schema_version": 1,
        "exercise_id": "ex_001",
        "asset_family": "atlas-derived muscle model V3",
        "asset_license": "CC BY-SA 4.0",
        "muscle_meshes": 482,
        "path_deformed_meshes": 48,
        "rigid_segment_meshes": 78,
        "static_meshes": 356,
    }
    root_property_failures = {
        key: {"expected": expected, "actual": root.get(key)}
        for key, expected in expected_root_properties.items()
        if root.get(key) != expected
    }
    if root_property_failures:
        failures.append(f"Root property mismatch: {root_property_failures}")
    if scene.frame_start != 1 or scene.frame_end != 210 or scene.render.fps != 30:
        failures.append(
            f"Timeline mismatch: {scene.frame_start}-{scene.frame_end} at {scene.render.fps}fps"
        )
    if any(obj.type == "ARMATURE" for obj in bpy.data.objects):
        failures.append("V3 contains a live armature")

    muscles = sorted(
        (
            obj
            for obj in muscle_collection.all_objects
            if obj is not None and obj.type == "MESH"
        ),
        key=lambda obj: obj.name,
    )
    names = [obj.name for obj in muscles]
    if len(muscles) != 482 or len(set(names)) != 482:
        failures.append(f"Expected 482 unique V3 meshes, found {len(muscles)}")
    if any(obj.modifiers for obj in muscles):
        failures.append("V3 mesh unexpectedly retains modifiers")

    path_names = expected_path_names(names)
    path_name_set = set(path_names)
    rigid = [obj for obj in muscles if isinstance(obj.get("v3_segment_bone"), str)]
    rigid_names = sorted(obj.name for obj in rigid)
    dynamic_names = sorted(set(path_names) | set(rigid_names))
    static_names = sorted(set(names) - set(dynamic_names))
    if (len(path_names), len(rigid_names), len(static_names)) != (48, 78, 356):
        failures.append(
            "Computed deformation coverage mismatch: "
            f"path={len(path_names)}, rigid={len(rigid_names)}, static={len(static_names)}"
        )

    snapshots: dict[str, dict[str, Any]] = {}
    max_volume_delta = 0.0
    worst_volume: dict[str, Any] = {}
    max_path_volume_delta = 0.0
    worst_path_volume: dict[str, Any] = {}
    max_rigid_volume_delta = 0.0
    worst_rigid_volume: dict[str, Any] = {}
    max_rigid_edge_strain = 0.0
    worst_rigid_strain: dict[str, Any] = {}
    max_rigid_edge_absolute_error = 0.0
    worst_rigid_absolute_error: dict[str, Any] = {}
    max_path_edge_p95 = 0.0
    worst_path_strain: dict[str, Any] = {}
    max_path_edge_absolute = 0.0
    worst_path_edge_absolute: dict[str, Any] = {}
    weight_checks = 0
    weight_failures = 0
    for obj in muscles:
        base = [vertex.co.copy() for vertex in obj.data.vertices]
        polygons = [tuple(int(index) for index in poly.vertices) for poly in obj.data.polygons]
        edges = [tuple(int(index) for index in edge.vertices) for edge in obj.data.edges]
        snapshot: dict[str, Any] = {
            "rest": base,
            "polygons": polygons,
            "edges": edges,
            "anchors_origin": [int(index) for index in obj.get("v3_origin_anchor_indices", [])],
            "anchors_insertion": [
                int(index) for index in obj.get("v3_insertion_anchor_indices", [])
            ],
            "poses": {},
        }
        is_dynamic = obj.name in dynamic_names
        if is_dynamic:
            shape_keys = obj.data.shape_keys
            expected_key_names = {"Basis", *POSE_KEYS.values()}
            actual_key_names = (
                set(shape_keys.key_blocks.keys()) if shape_keys is not None else set()
            )
            if actual_key_names != expected_key_names:
                failures.append(f"Unexpected shape keys for {obj.name}: {actual_key_names}")
                continue
            interpolation_modes = {
                point.interpolation
                for curve in action_fcurves(
                    shape_keys.animation_data.action
                    if shape_keys.animation_data is not None
                    else None
                )
                for point in curve.keyframe_points
            }
            if interpolation_modes != {"LINEAR"}:
                failures.append(
                    f"Non-linear pose interpolation for {obj.name}: {interpolation_modes}"
                )
            for label in POSE_LABELS:
                snapshot["poses"][label] = pose_coordinates(obj, label)
            base_volume = mesh_volume(snapshot["poses"]["rest"], polygons)
            if base_volume <= 1e-14:
                failures.append(f"Zero rest volume for {obj.name}")
                continue
            for label in POSE_LABELS:
                ratio = mesh_volume(snapshot["poses"][label], polygons) / base_volume
                delta = abs(ratio - 1.0) * 100.0
                if delta > max_volume_delta:
                    max_volume_delta = delta
                    worst_volume = {"object": obj.name, "pose": label, "ratio": ratio}
                row = {"object": obj.name, "pose": label, "ratio": ratio}
                if obj.name in path_name_set:
                    if delta > max_path_volume_delta:
                        max_path_volume_delta = delta
                        worst_path_volume = row
                elif delta > max_rigid_volume_delta:
                    max_rigid_volume_delta = delta
                    worst_rigid_volume = row
            for frame in range(1, 211):
                values = [
                    action_curve_value(shape_keys, POSE_KEYS[label], frame)
                    for label in POSE_LABELS
                ]
                try:
                    validate_pose_weights(values)
                except ValidationError as error:
                    weight_failures += 1
                    if weight_failures <= 10:
                        failures.append(f"{obj.name} frame {frame}: {error}")
                weight_checks += 1

            rest_lengths = []
            for first, second in edges:
                rest_lengths.append((base[first] - base[second]).length)
            for label in POSE_LABELS[1:]:
                coordinates = snapshot["poses"][label]
                strains = []
                for (first, second), rest_length in zip(edges, rest_lengths, strict=True):
                    if rest_length <= 1e-9:
                        continue
                    current = (coordinates[first] - coordinates[second]).length
                    strains.append(abs(current / rest_length - 1.0))
                if obj.name in rigid_names:
                    for (first, second), rest_length in zip(
                        edges,
                        rest_lengths,
                        strict=True,
                    ):
                        if rest_length <= 1e-9:
                            continue
                        current_length = (coordinates[first] - coordinates[second]).length
                        absolute_error = abs(current_length - rest_length)
                        strain = absolute_error / rest_length
                        row = {
                            "object": obj.name,
                            "pose": label,
                            "edge": [first, second],
                            "rest_length_m": rest_length,
                            "current_length_m": current_length,
                            "absolute_error_m": absolute_error,
                            "relative_strain": strain,
                        }
                        if strain > float(worst_rigid_strain.get("relative_strain", -1.0)):
                            worst_rigid_strain = row
                        if absolute_error > max_rigid_edge_absolute_error:
                            max_rigid_edge_absolute_error = absolute_error
                            worst_rigid_absolute_error = row
                        if (
                            rest_length >= RIGID_RELATIVE_EDGE_MIN_LENGTH_M
                            and strain > max_rigid_edge_strain
                        ):
                            max_rigid_edge_strain = strain
                else:
                    pose_max = max(strains, default=0.0)
                    if pose_max > max_path_edge_absolute:
                        max_path_edge_absolute = pose_max
                        worst_path_edge_absolute = {
                            "object": obj.name,
                            "pose": label,
                            "max": pose_max,
                        }
                    p95 = percentile(strains, 0.95)
                    if p95 > max_path_edge_p95:
                        max_path_edge_p95 = p95
                        worst_path_strain = {
                            "object": obj.name,
                            "pose": label,
                            "p95": p95,
                            "max": max(strains, default=0.0),
                        }
        elif obj.data.shape_keys is not None:
            failures.append(f"Static mesh has shape keys: {obj.name}")
        snapshots[obj.name] = snapshot

    # Rigid segments are rotation+translation only, so their volume must always
    # hold. Path-mapped shoulder surfaces are gated only when the build asked for
    # volume correction; in verbatim mode the protected atlas deformation sets
    # the volume and the delta is reported rather than enforced.
    record_check(lambda: validate_volume_delta(max_rigid_volume_delta))
    if volume_correction_enabled:
        record_check(lambda: validate_volume_delta(max_path_volume_delta))
    if max_rigid_edge_strain > MAX_RIGID_EDGE_STRAIN:
        failures.append(f"Rigid edge strain {max_rigid_edge_strain} exceeds tolerance")
    if max_rigid_edge_absolute_error > MAX_RIGID_EDGE_ABSOLUTE_ERROR_M:
        failures.append(
            f"Rigid absolute edge error {max_rigid_edge_absolute_error} m exceeds tolerance"
        )
    if max_path_edge_p95 > MAX_PATH_EDGE_P95_STRAIN:
        failures.append(f"Path edge p95 strain {max_path_edge_p95} exceeds tolerance")

    controls = {
        obj.name: obj
        for obj in rig_collection.all_objects
        if obj is not None and obj.type == "EMPTY"
    }
    parent_map = {
        name: control.parent.name if control.parent is not None else None
        for name, control in controls.items()
    }
    record_check(lambda: validate_parent_map(parent_map))
    pose_elevations: dict[str, dict[str, float]] = {}
    elevation_errors = []
    for label, frame in POSE_FRAMES.items():
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        pose_elevations[label] = {}
        for side in ("R", "L"):
            control = controls.get(f"V3_Rig_Humerus.{side}")
            if control is None:
                failures.append(f"Missing humerus control for side {side}")
                continue
            direction = control.matrix_world.to_quaternion() @ Vector((0.0, 1.0, 0.0))
            elevation = math.degrees(direction.normalized().angle(Vector((0.0, 0.0, -1.0))))
            pose_elevations[label][side] = elevation
            error = abs(elevation - expected_elevations[label])
            elevation_errors.append(error)
            if error > MAX_ELEVATION_ERROR_DEG:
                failures.append(
                    f"{label} {side} elevation {elevation:.3f} differs from "
                    f"expected {expected_elevations[label]:.3f}"
                )
        if len(pose_elevations[label]) == 2:
            symmetry = abs(pose_elevations[label]["R"] - pose_elevations[label]["L"])
            if symmetry > 1.0:
                failures.append(f"{label} bilateral elevation differs by {symmetry:.3f} deg")
    for side in ("R", "L"):
        series = [pose_elevations[label].get(side, math.nan) for label in POSE_LABELS]
        if any(math.isnan(value) for value in series) or any(
            second + 0.1 < first for first, second in zip(series, series[1:], strict=False)
        ):
            failures.append(f"Non-monotonic authored elevation for side {side}: {series}")

    source_frames = json.loads(str(root["source_pose_frames_json"]))
    v3_names = names.copy()
    v3_source_props = {
        obj.name: (
            str(obj.get("atlas_source_sha256", "")),
            str(obj.get("asset_license", "")),
        )
        for obj in muscles
    }
    if any(value != (ATLAS_SHA256, "CC BY-SA 4.0") for value in v3_source_props.values()):
        failures.append("One or more meshes has invalid source/license metadata")

    # Compare with the protected atlas after all V3-only checks and snapshots.
    bpy.ops.wm.open_mainfile(filepath=str(atlas_path), load_ui=False)
    atlas_scene = bpy.context.scene
    atlas_collection = bpy.data.collections.get(SOURCE_COLLECTION)
    if atlas_collection is None:
        raise RuntimeError("Protected atlas muscle collection is missing")
    atlas_objects = {
        obj.name: obj
        for obj in atlas_collection.all_objects
        if obj is not None and obj.type == "MESH"
    }
    record_check(lambda: validate_manifest(sorted(atlas_objects), v3_names))
    for obj in atlas_objects.values():
        for modifier in obj.modifiers:
            if modifier.type != "ARMATURE":
                modifier.show_viewport = False

    max_rest_registration = 0.0
    worst_rest_registration: dict[str, Any] = {}
    max_attachment_error = 0.0
    attachment_errors: list[float] = []
    for label in POSE_LABELS:
        atlas_scene.frame_set(int(source_frames[label]))
        bpy.context.view_layer.update()
        depsgraph = bpy.context.evaluated_depsgraph_get()
        source_rows = atlas_objects.items() if label == "rest" else (
            (name, atlas_objects[name]) for name in path_names
        )
        for name, obj in source_rows:
            evaluated = obj.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            try:
                coordinates = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
            finally:
                evaluated.to_mesh_clear()
            snapshot = snapshots[name]
            if len(coordinates) != len(snapshot["rest"]):
                failures.append(f"Atlas topology mismatch for {name} at {label}")
                continue
            if label == "rest":
                for index, (actual, expected) in enumerate(
                    zip(snapshot["rest"], coordinates, strict=True)
                ):
                    error = (actual - expected).length
                    if error > max_rest_registration:
                        max_rest_registration = error
                        worst_rest_registration = {"object": name, "vertex": index}
            elif name in path_names:
                target = snapshot["poses"][label]
                indices = sorted(
                    set(snapshot["anchors_origin"] + snapshot["anchors_insertion"])
                )
                for index in indices:
                    error = (target[index] - coordinates[index]).length
                    attachment_errors.append(error)
                    max_attachment_error = max(max_attachment_error, error)
    if max_rest_registration > MAX_REST_REGISTRATION_M:
        failures.append(
            f"Rest registration error {max_rest_registration:.9f} m exceeds tolerance"
        )
    record_check(lambda: validate_attachment_error(max_attachment_error))

    negative_controls = run_negative_controls(v3_names, parent_map)
    if not all(row["rejected"] for row in negative_controls):
        failures.append("One or more negative controls was not rejected")

    report = {
        "schema_version": 1,
        "status": "PASS" if not failures else "FAIL",
        "source": {
            "v3_blend": str(source_blend),
            "v3_sha256": sha256(source_blend),
            "atlas": str(atlas_path),
            "atlas_sha256": atlas_hash,
            "paths": str(paths_path),
            "paths_sha256": paths_hash,
        },
        "timeline": {"frame_start": 1, "frame_end": 210, "fps": 30},
        "manifest": {
            "meshes": len(v3_names),
            "path_deformed": len(path_names),
            "rigid_segment": len(rigid_names),
            "static": len(static_names),
        },
        "geometry": {
            "max_volume_delta_percent": max_volume_delta,
            "worst_volume": worst_volume,
            "max_path_volume_delta_percent": max_path_volume_delta,
            "worst_path_volume": worst_path_volume,
            "max_rigid_volume_delta_percent": max_rigid_volume_delta,
            "worst_rigid_volume": worst_rigid_volume,
            "max_rigid_edge_strain": max_rigid_edge_strain,
            "rigid_relative_edge_min_length_m": RIGID_RELATIVE_EDGE_MIN_LENGTH_M,
            "worst_rigid_strain": worst_rigid_strain,
            "max_rigid_edge_absolute_error_m": max_rigid_edge_absolute_error,
            "worst_rigid_absolute_error": worst_rigid_absolute_error,
            "max_path_edge_p95_strain": max_path_edge_p95,
            "max_path_edge_absolute_strain": max_path_edge_absolute,
            "worst_path_edge_absolute": worst_path_edge_absolute,
            "worst_path_strain": worst_path_strain,
            "max_rest_registration_m": max_rest_registration,
            "worst_rest_registration": worst_rest_registration,
            "max_attachment_error_m": max_attachment_error,
            "p95_attachment_error_m": percentile(attachment_errors, 0.95),
        },
        "animation": {
            "pose_weight_checks": weight_checks,
            "pose_weight_failures": weight_failures,
            "pose_elevations_degrees": pose_elevations,
            "max_elevation_error_degrees": max(elevation_errors, default=0.0),
            "control_parents": parent_map,
        },
        "negative_controls": negative_controls,
        "build_mode": {
            "volume_correction": volume_correction_enabled,
            "path_volume_gated": volume_correction_enabled,
        },
        "boundaries": {
            "primary_visibility": "muscle and tendon surfaces only",
            "runtime_armature_present": False,
            "asset_license": "CC BY-SA 4.0",
            "medical_claim": "anatomically grounded instructional asset; not clinically validated",
        },
        "failures": failures,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("EX001_MUSCLE_ATLAS_V3_VALIDATION=" + json.dumps(report, sort_keys=True), flush=True)
    if failures:
        raise RuntimeError(f"V3 validation failed with {len(failures)} issue(s)")


if __name__ == "__main__":
    main()
