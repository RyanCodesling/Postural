"""Independently inspect the evaluated ex_001 ecorche V2 static scene.

The inspector is intentionally separate from the builder.  It reads the saved
scene, calculates topology, attachment, volume, hierarchy, and provenance
facts, compares fingerprints against the protected anatomy/rejected sources,
and writes a reviewable JSON report.  Negative controls mutate memory only and
are never saved back to the source ``.blend``.

Example:

    blender --background assets/blender/ex_001_lateral_arm_raise_ecorche_v2.blend \
      --python tools/blender/inspect_ex001_ecorche_v2.py -- \
      --output assets/blender/reference/ex_001_ecorche_v2_static_validation.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path
from typing import Any

import bmesh
import bpy
from mathutils import Vector


ATTACHMENT_TOLERANCE_M = 0.0005
VOLUME_TOLERANCE_PERCENT = 0.05
EXPECTED_CONTROL_PARENTS = {
    "CTRL_Thorax": None,
    "CTRL_ShoulderGirdle": "CTRL_Thorax",
    "CTRL_Humerus": "CTRL_ShoulderGirdle",
    "CTRL_ForearmGross": "CTRL_Humerus",
    "CTRL_ForearmPronation": "CTRL_ForearmGross",
    "CTRL_HandPalm": "CTRL_ForearmPronation",
}


def blender_args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parents[2]
    parser.add_argument(
        "--output",
        type=Path,
        default=(
            root
            / "assets"
            / "blender"
            / "reference"
            / "ex_001_ecorche_v2_static_validation.json"
        ),
    )
    parser.add_argument(
        "--paths",
        type=Path,
        default=(
            root
            / "assets"
            / "blender"
            / "reference"
            / "ex_001_ecorche_v2_paths.json"
        ),
    )
    parser.add_argument(
        "--atlas",
        type=Path,
        default=root / "assets" / "blender" / "ex_001_lateral_arm_raise_anatomy.blend",
    )
    parser.add_argument(
        "--rejected",
        type=Path,
        default=root / "assets" / "blender" / "ex_001_lateral_arm_raise_ecorche.blend",
    )
    parser.add_argument(
        "--negative-control",
        choices=("none", "attachment_shift", "volume_scale", "manifest_extra"),
        default="none",
    )
    return parser.parse_args(blender_args())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def mesh_fingerprint(mesh: bpy.types.Mesh) -> str:
    """Hash base coordinates and ordered topology, excluding names/materials."""

    digest = hashlib.sha256()
    digest.update(struct.pack("<III", len(mesh.vertices), len(mesh.edges), len(mesh.polygons)))
    for vertex in mesh.vertices:
        digest.update(struct.pack("<ddd", *map(float, vertex.co)))
    for edge in mesh.edges:
        digest.update(struct.pack("<II", *map(int, edge.vertices)))
    for polygon in mesh.polygons:
        indices = tuple(int(index) for index in polygon.vertices)
        digest.update(struct.pack("<I", len(indices)))
        digest.update(struct.pack(f"<{len(indices)}I", *indices))
    return digest.hexdigest().upper()


def world_volume_m3(obj: bpy.types.Object) -> float:
    mesh = bmesh.new()
    try:
        mesh.from_mesh(obj.data)
        mesh.transform(obj.matrix_world)
        return abs(float(mesh.calc_volume(signed=True)))
    finally:
        mesh.free()


def manifold_metrics(obj: bpy.types.Object) -> dict[str, int]:
    mesh = bmesh.new()
    try:
        mesh.from_mesh(obj.data)
        boundary = sum(1 for edge in mesh.edges if len(edge.link_faces) == 1)
        nonmanifold = sum(1 for edge in mesh.edges if len(edge.link_faces) != 2)
        return {
            "vertices": len(mesh.verts),
            "edges": len(mesh.edges),
            "faces": len(mesh.faces),
            "boundary_edges": boundary,
            "nonmanifold_edges": nonmanifold,
        }
    finally:
        mesh.free()


def load_library_fingerprints(path: Path) -> tuple[dict[str, list[str]], int]:
    if not path.is_file():
        raise FileNotFoundError(path)
    original_names: list[str] = []
    loaded_meshes: list[bpy.types.Mesh | None] = []
    with bpy.data.libraries.load(str(path), link=False) as (data_from, data_to):
        original_names = list(data_from.meshes)
        data_to.meshes = original_names
        loaded_meshes = data_to.meshes
    fingerprints: dict[str, list[str]] = {}
    for original_name, mesh in zip(original_names, loaded_meshes):
        if mesh is None:
            continue
        fingerprints.setdefault(mesh_fingerprint(mesh), []).append(original_name)
    loaded_count = sum(mesh is not None for mesh in loaded_meshes)
    for mesh in loaded_meshes:
        if mesh is not None and mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    return fingerprints, loaded_count


def apply_negative_control(kind: str, muscle_manifest: list[str], anchor_manifest: list[str]) -> str | None:
    if kind == "none":
        return None
    if kind == "attachment_shift":
        anchor = bpy.data.objects[anchor_manifest[0]]
        world = anchor.matrix_world.copy()
        world.translation += Vector((0.015, 0.0, 0.0))
        anchor.matrix_world = world
        bpy.context.view_layer.update()
        return anchor.name
    if kind == "volume_scale":
        muscle = bpy.data.objects[muscle_manifest[0]]
        muscle.scale *= 1.15
        bpy.context.view_layer.update()
        return muscle.name
    if kind == "manifest_extra":
        source = bpy.data.objects[muscle_manifest[0]]
        duplicate = source.copy()
        duplicate.data = source.data
        duplicate.name = "MUSCLE__NEGATIVE_CONTROL_EXTRA"
        duplicate["source_muscle"] = "NEGATIVE_CONTROL_EXTRA"
        source.users_collection[0].objects.link(duplicate)
        bpy.context.view_layer.update()
        return duplicate.name
    raise AssertionError(kind)


def nearest_geometry_vertex_distance(
    anchor: bpy.types.Object, geometry: list[bpy.types.Object]
) -> float:
    anchor_position = anchor.matrix_world.translation
    nearest = math.inf
    for obj in geometry:
        matrix = obj.matrix_world
        for vertex in obj.data.vertices:
            nearest = min(nearest, (matrix @ vertex.co - anchor_position).length)
    return nearest


def main() -> None:
    args = parse_args()
    source_blend = Path(bpy.data.filepath).resolve()
    paths_file = args.paths.resolve()
    atlas_file = args.atlas.resolve()
    rejected_file = args.rejected.resolve()
    if not source_blend.is_file():
        raise RuntimeError("Inspector must run from a saved V2 .blend")
    if not paths_file.is_file():
        raise FileNotFoundError(paths_file)

    scene = bpy.context.scene
    required_scene_properties = {
        "v2_schema_version": 1,
        "v2_stage": "static_rest_milestone_1",
        "exercise_id": "ex_001",
        "protected_geometry_imported": False,
        "atlas_or_rejected_libraries_linked": 0,
    }
    scene_property_failures = {
        key: {"expected": expected, "actual": scene.get(key)}
        for key, expected in required_scene_properties.items()
        if scene.get(key) != expected
    }

    muscle_manifest = json.loads(str(scene["muscle_manifest_json"]))
    tendon_manifest = json.loads(str(scene["tendon_manifest_json"]))
    anchor_manifest = json.loads(str(scene["anchor_manifest_json"]))
    negative_target = apply_negative_control(
        args.negative_control, muscle_manifest, anchor_manifest
    )

    muscles = [
        obj
        for obj in bpy.data.objects
        if obj.type == "MESH" and obj.get("geometry_role") == "muscle"
    ]
    tendons = [
        obj
        for obj in bpy.data.objects
        if obj.type == "MESH" and obj.get("geometry_role") == "tendon"
    ]
    anchors = [obj for obj in bpy.data.objects if obj.get("geometry_role") == "anchor"]
    actual_muscle_names = sorted(obj.name for obj in muscles)
    actual_tendon_names = sorted(obj.name for obj in tendons)
    actual_anchor_names = sorted(obj.name for obj in anchors)

    manifest_exact = (
        actual_muscle_names == sorted(muscle_manifest)
        and actual_tendon_names == sorted(tendon_manifest)
        and actual_anchor_names == sorted(anchor_manifest)
    )

    topology: dict[str, dict[str, int]] = {}
    volume_metrics: dict[str, dict[str, float]] = {}
    max_volume_delta = 0.0
    for obj in muscles + tendons:
        topology[obj.name] = manifold_metrics(obj)
        expected = float(obj.get("authored_world_volume_m3", 0.0))
        actual = world_volume_m3(obj)
        delta = (
            math.inf
            if expected <= 0.0
            else abs(actual - expected) / expected * 100.0
        )
        max_volume_delta = max(max_volume_delta, delta)
        volume_metrics[obj.name] = {
            "authored_world_volume_m3": expected,
            "measured_world_volume_m3": actual,
            "delta_percent": delta,
        }

    all_closed = all(
        metrics["nonmanifold_edges"] == 0 for metrics in topology.values()
    )
    all_nonzero_volume = all(
        metrics["measured_world_volume_m3"] > 1e-10
        for metrics in volume_metrics.values()
    )

    reference = json.loads(paths_file.read_text(encoding="utf-8"))
    rest_muscles = {entry["name"]: entry for entry in reference["poses"][0]["muscles"]}
    offset = Vector(json.loads(str(scene["thorax_world_offset_json"])))
    geometry_by_source: dict[str, list[bpy.types.Object]] = {}
    for obj in muscles + tendons:
        geometry_by_source.setdefault(str(obj["source_muscle"]), []).append(obj)

    attachment_metrics: dict[str, dict[str, float]] = {}
    max_reference_anchor_drift = 0.0
    max_anchor_to_geometry = 0.0
    for anchor in anchors:
        source_name = str(anchor["source_muscle"])
        role = str(anchor["anchor_role"])
        expected_point = (
            rest_muscles[source_name]["points"][0]
            if role == "origin"
            else rest_muscles[source_name]["points"][-1]
        )
        expected_world = offset + Vector(expected_point["blender_thorax_m"])
        reference_drift = (anchor.matrix_world.translation - expected_world).length
        surface_distance = nearest_geometry_vertex_distance(
            anchor, geometry_by_source[source_name]
        )
        max_reference_anchor_drift = max(max_reference_anchor_drift, reference_drift)
        max_anchor_to_geometry = max(max_anchor_to_geometry, surface_distance)
        attachment_metrics[anchor.name] = {
            "reference_drift_m": reference_drift,
            "nearest_authored_geometry_vertex_m": surface_distance,
        }

    controls: dict[str, str | None] = {}
    for name in EXPECTED_CONTROL_PARENTS:
        obj = bpy.data.objects.get(name)
        controls[name] = None if obj is None or obj.parent is None else obj.parent.name
    control_hierarchy_exact = controls == EXPECTED_CONTROL_PARENTS
    radius = bpy.data.objects.get("QA_BONE_Radius")
    ulna = bpy.data.objects.get("QA_BONE_Ulna")
    palm = bpy.data.objects.get("SUPPORT_Right_Palm")
    distal_parenting_exact = (
        radius is not None
        and ulna is not None
        and palm is not None
        and radius.parent is not None
        and ulna.parent is not None
        and palm.parent is not None
        and radius.parent.name == "CTRL_ForearmPronation"
        and ulna.parent.name == "CTRL_ForearmPronation"
        and palm.parent.name == "CTRL_HandPalm"
    )

    initial_action_count = len(bpy.data.actions)
    atlas_fingerprints, atlas_mesh_count = load_library_fingerprints(atlas_file)
    rejected_fingerprints, rejected_mesh_count = load_library_fingerprints(rejected_file)
    protected_fingerprints = set(atlas_fingerprints) | set(rejected_fingerprints)
    provenance_matches: list[dict[str, Any]] = []
    for obj in muscles + tendons:
        fingerprint = mesh_fingerprint(obj.data)
        if fingerprint in protected_fingerprints:
            provenance_matches.append(
                {
                    "v2_object": obj.name,
                    "fingerprint": fingerprint,
                    "atlas_meshes": atlas_fingerprints.get(fingerprint, []),
                    "rejected_meshes": rejected_fingerprints.get(fingerprint, []),
                }
            )

    linked_objects = [obj.name for obj in bpy.data.objects if obj.library is not None]
    linked_meshes = [mesh.name for mesh in bpy.data.meshes if mesh.library is not None]
    banned_tokens = (
        "anguli oris",
        "labii superioris",
        "nasolabialis",
        "palpebrae",
        "biceps femoris",
        "levator ani",
    )
    irrelevant_names = [
        obj.name
        for obj in muscles
        if any(token in obj.name.lower() for token in banned_tokens)
    ]

    builder_path = Path(str(scene.get("builder", "")))
    builder_hash_matches = (
        builder_path.is_file()
        and sha256(builder_path) == str(scene.get("builder_sha256", ""))
    )
    path_hash_matches = (
        sha256(paths_file) == str(scene.get("reference_paths_sha256", ""))
    )
    source_tags_valid = all(
        obj.get("v2_original_geometry") is True
        and obj.get("geometry_source") == "procedural-authored-v2"
        and str(obj.get("source_muscle", "")) in rest_muscles
        for obj in muscles + tendons
    )
    checks = {
        "scene_properties_exact": not scene_property_failures,
        "static_frame_contract": scene.frame_start == 1 and scene.frame_end == 1 and scene.render.fps == 30,
        "manifest_exact": manifest_exact,
        "muscle_count_33": len(muscles) == 33,
        "two_anchors_per_source_muscle": len(anchors) == 66,
        "all_authored_meshes_closed_manifold": all_closed,
        "all_authored_meshes_have_nonzero_volume": all_nonzero_volume,
        "volume_matches_authored": max_volume_delta <= VOLUME_TOLERANCE_PERCENT,
        "anchors_match_reference": max_reference_anchor_drift <= ATTACHMENT_TOLERANCE_M,
        "anchors_touch_authored_geometry": max_anchor_to_geometry <= ATTACHMENT_TOLERANCE_M,
        "control_hierarchy_exact": control_hierarchy_exact,
        "coherent_radius_ulna_hand_parenting": distal_parenting_exact,
        "no_protected_mesh_fingerprint_matches": not provenance_matches,
        "no_linked_external_objects_or_meshes": not linked_objects and not linked_meshes,
        "no_irrelevant_anatomy_names": not irrelevant_names,
        "source_tags_valid": source_tags_valid,
        "reference_path_hash_matches": path_hash_matches,
        "builder_hash_matches_saved_scene": builder_hash_matches,
        "no_animation_actions_in_static_milestone": initial_action_count == 0,
        "continuous_upper_torso_present": bpy.data.objects.get("SUPPORT_Continuous_Upper_Torso") is not None,
    }
    failures = [name for name, passed in checks.items() if not passed]
    status = "PASS" if not failures else "FAIL"

    expected_negative_failure = {
        "attachment_shift": {"anchors_match_reference", "anchors_touch_authored_geometry"},
        "volume_scale": {"volume_matches_authored"},
        "manifest_extra": {"manifest_exact", "muscle_count_33", "source_tags_valid"},
    }.get(args.negative_control, set())
    negative_control_triggered = (
        args.negative_control != "none"
        and bool(expected_negative_failure.intersection(failures))
    )

    report = {
        "schema_version": 1,
        "artifact": "ex_001 ecorche V2 static Milestone 1",
        "status": status,
        "negative_control": args.negative_control,
        "negative_control_target": negative_target,
        "negative_control_triggered": negative_control_triggered,
        "source_blend": str(source_blend),
        "source_blend_sha256": sha256(source_blend),
        "reference_paths": str(paths_file),
        "reference_paths_sha256": sha256(paths_file),
        "protected_sources": {
            "atlas": {
                "path": str(atlas_file),
                "sha256": sha256(atlas_file),
                "mesh_count": atlas_mesh_count,
            },
            "rejected": {
                "path": str(rejected_file),
                "sha256": sha256(rejected_file),
                "mesh_count": rejected_mesh_count,
            },
        },
        "counts": {
            "muscles": len(muscles),
            "tendons": len(tendons),
            "anchors": len(anchors),
            "actions_before_protected_fingerprint_load": initial_action_count,
        },
        "tolerances": {
            "attachment_m": ATTACHMENT_TOLERANCE_M,
            "authored_volume_percent": VOLUME_TOLERANCE_PERCENT,
            "scope": "static visualization engineering only; nonclinical",
        },
        "metrics": {
            "max_reference_anchor_drift_m": max_reference_anchor_drift,
            "max_anchor_to_geometry_vertex_m": max_anchor_to_geometry,
            "max_authored_volume_delta_percent": max_volume_delta,
            "atlas_meshes_fingerprinted": atlas_mesh_count,
            "rejected_meshes_fingerprinted": rejected_mesh_count,
            "protected_mesh_fingerprint_matches": provenance_matches,
            "linked_objects": linked_objects,
            "linked_meshes": linked_meshes,
            "irrelevant_anatomy_names": irrelevant_names,
            "control_parents": controls,
        },
        "checks": checks,
        "failures": failures,
        "topology": topology,
        "volumes": volume_metrics,
        "attachments": attachment_metrics,
        "interpretation_boundaries": [
            "This report evaluates the saved static scene; it does not validate animation or clinical anatomy.",
            "A PASS is derived from measured checks and never substitutes for the required user visual review.",
            "Negative controls are in-memory mutations and the source blend is never saved by this inspector.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(
        "EX001_ECORCHE_V2_INSPECTION="
        + json.dumps(
            {
                "status": status,
                "failures": failures,
                "negative_control": args.negative_control,
                "negative_control_triggered": negative_control_triggered,
                "output": str(args.output.resolve()),
                "max_reference_anchor_drift_m": max_reference_anchor_drift,
                "max_anchor_to_geometry_vertex_m": max_anchor_to_geometry,
                "max_authored_volume_delta_percent": max_volume_delta,
                "protected_mesh_fingerprint_matches": len(provenance_matches),
            },
            sort_keys=True,
        )
    )
    if args.negative_control == "none" and failures:
        raise SystemExit(1)
    if args.negative_control != "none" and not negative_control_triggered:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
