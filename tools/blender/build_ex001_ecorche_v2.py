"""Author the original static Milestone 1 geometry for ex_001 ecorche V2.

This builder deliberately starts from a factory-empty Blender scene.  It does
not append, link, import, or copy any mesh from the protected Maya, anatomy
atlas, or rejected ecorche files.  The pinned OpenSim geometry-path JSON is used
only for rest-pose line-of-action and attachment coordinates.  Every visible
surface is generated here from explicit, anatomy-group-specific loft profiles.

Run from the Postural repository root:

    blender --background --factory-startup \
      --python tools/blender/build_ex001_ecorche_v2.py -- \
      --paths assets/blender/reference/ex_001_ecorche_v2_paths.json \
      --output assets/blender/ex_001_lateral_arm_raise_ecorche_v2.blend
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any, Iterable

import bmesh
import bpy
from mathutils import Vector


SCHEMA_VERSION = 1
SOURCE_COMMIT = "d40ebd8ba658633993e531e408c0d96df30ff367"
THORAX_WORLD_OFFSET = Vector((0.0, 0.0, 1.45))
RING_SEGMENTS = 12


def blender_args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parents[2]
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
        "--output",
        type=Path,
        default=(
            root
            / "assets"
            / "blender"
            / "ex_001_lateral_arm_raise_ecorche_v2.blend"
        ),
    )
    return parser.parse_args(blender_args())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in tuple(bpy.data.collections):
        bpy.data.collections.remove(collection)
    for mesh in tuple(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for material_data in tuple(bpy.data.materials):
        if material_data.users == 0:
            bpy.data.materials.remove(material_data)


def new_collection(name: str, parent: bpy.types.Collection | None = None) -> bpy.types.Collection:
    collection = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(collection)
    return collection


def link_only(obj: bpy.types.Object, collection: bpy.types.Collection) -> None:
    for existing in tuple(obj.users_collection):
        existing.objects.unlink(obj)
    collection.objects.link(obj)


def material(
    name: str,
    color: tuple[float, float, float, float],
    roughness: float,
    metallic: float = 0.0,
) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.diffuse_color = color
    result.use_nodes = True
    principled = result.node_tree.nodes.get("Principled BSDF")
    if principled is not None:
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Roughness"].default_value = roughness
        principled.inputs["Metallic"].default_value = metallic
        if "Specular IOR Level" in principled.inputs:
            principled.inputs["Specular IOR Level"].default_value = 0.28
    return result


def create_materials() -> dict[str, bpy.types.Material]:
    return {
        "support": material("V2_Support_Charcoal", (0.035, 0.048, 0.06, 1.0), 0.76),
        "bone": material("V2_QA_Bone_Ivory", (0.82, 0.72, 0.53, 1.0), 0.48),
        "tendon": material("V2_Tendon_Aponeurosis", (0.89, 0.74, 0.49, 1.0), 0.52),
        "deltoid": material("V2_Muscle_Deltoid", (0.78, 0.085, 0.045, 1.0), 0.5),
        "chest": material("V2_Muscle_Chest", (0.61, 0.035, 0.025, 1.0), 0.55),
        "back": material("V2_Muscle_Back", (0.49, 0.025, 0.02, 1.0), 0.58),
        "serratus": material("V2_Muscle_Serratus", (0.82, 0.16, 0.075, 1.0), 0.5),
        "cuff": material("V2_Muscle_Rotator_Cuff", (0.9, 0.24, 0.055, 1.0), 0.48),
        "arm": material("V2_Muscle_Arm", (0.68, 0.055, 0.032, 1.0), 0.52),
        "anchor_origin": material("V2_QA_Origin", (0.12, 0.85, 0.35, 1.0), 0.35),
        "anchor_insertion": material("V2_QA_Insertion", (0.1, 0.48, 1.0, 1.0), 0.35),
        "stage": material("V2_Stage", (0.035, 0.045, 0.055, 1.0), 0.78),
    }


def tag_object(obj: bpy.types.Object, role: str, **metadata: Any) -> None:
    obj["v2_schema_version"] = SCHEMA_VERSION
    obj["geometry_role"] = role
    obj["geometry_source"] = "procedural-authored-v2"
    obj["v2_original_geometry"] = True
    for key, value in metadata.items():
        obj[key] = value


def create_mesh_object(
    name: str,
    vertices: list[Vector],
    faces: list[tuple[int, ...]],
    collection: bpy.types.Collection,
    material_data: bpy.types.Material,
    role: str,
    **metadata: Any,
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata([tuple(vertex) for vertex in vertices], [], faces)
    mesh.validate(verbose=True, clean_customdata=False)
    mesh.update(calc_edges=True)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    mesh.materials.append(material_data)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    tag_object(obj, role, **metadata)
    return obj


def world_volume_m3(obj: bpy.types.Object) -> float:
    if obj.type != "MESH":
        return 0.0
    mesh = bmesh.new()
    try:
        mesh.from_mesh(obj.data)
        mesh.transform(obj.matrix_world)
        return abs(float(mesh.calc_volume(signed=True)))
    finally:
        mesh.free()


def polyline_sample(points: list[Vector], amount: float) -> Vector:
    if not points:
        raise ValueError("Cannot sample an empty path")
    if len(points) == 1:
        return points[0].copy()
    amount = min(1.0, max(0.0, amount))
    lengths = [0.0]
    for first, second in zip(points, points[1:]):
        lengths.append(lengths[-1] + (second - first).length)
    total = lengths[-1]
    if total <= 1e-12:
        return points[0].copy()
    target = amount * total
    for index in range(len(points) - 1):
        if target <= lengths[index + 1] or index == len(points) - 2:
            segment = lengths[index + 1] - lengths[index]
            local = 0.0 if segment <= 1e-12 else (target - lengths[index]) / segment
            return points[index].lerp(points[index + 1], local)
    return points[-1].copy()


def local_frame(points: list[Vector], amount: float, width_hint: Vector) -> tuple[Vector, Vector, Vector]:
    epsilon = 0.006
    first = polyline_sample(points, max(0.0, amount - epsilon))
    second = polyline_sample(points, min(1.0, amount + epsilon))
    tangent = (second - first).normalized()
    width = width_hint - tangent * width_hint.dot(tangent)
    if width.length < 1e-7:
        fallback = Vector((0.0, 0.0, 1.0))
        width = fallback - tangent * fallback.dot(tangent)
    if width.length < 1e-7:
        fallback = Vector((1.0, 0.0, 0.0))
        width = fallback - tangent * fallback.dot(tangent)
    width.normalize()
    depth = tangent.cross(width).normalized()
    return tangent, width, depth


def create_loft(
    name: str,
    path: list[Vector],
    profile: list[tuple[float, float, float]],
    width_hint: Vector,
    belly_offset: Vector,
    collection: bpy.types.Collection,
    material_data: bpy.types.Material,
    role: str,
    **metadata: Any,
) -> bpy.types.Object:
    """Create a closed asymmetric muscle-specific loft.

    The supplied profile is explicit for each anatomy group.  The path controls
    attachment and wrap placement; it is not imported surface geometry.
    Endpoint cap-centre vertices sit exactly on the evaluated path endpoints so
    the independent inspector can measure attachment registration directly.
    """

    if len(profile) < 3:
        raise ValueError(f"{name} needs at least three authored sections")
    if profile[0][0] < -1e-12 or profile[-1][0] > 1.0 + 1e-12:
        raise ValueError(f"{name} profile leaves the normalized path")
    vertices: list[Vector] = []
    for section_index, (amount, width_radius, depth_radius) in enumerate(profile):
        _, width_axis, depth_axis = local_frame(path, amount, width_hint)
        centre = polyline_sample(path, amount)
        centre += belly_offset * math.sin(math.pi * amount)
        for ring_index in range(RING_SEGMENTS):
            angle = 2.0 * math.pi * ring_index / RING_SEGMENTS
            asymmetry = 1.0 + 0.08 * math.sin(angle + section_index * 0.63)
            vertex = (
                centre
                + width_axis * (width_radius * asymmetry * math.cos(angle))
                + depth_axis * (depth_radius * math.sin(angle))
            )
            vertices.append(vertex)

    faces: list[tuple[int, ...]] = []
    for section_index in range(len(profile) - 1):
        first_ring = section_index * RING_SEGMENTS
        second_ring = (section_index + 1) * RING_SEGMENTS
        for ring_index in range(RING_SEGMENTS):
            following = (ring_index + 1) % RING_SEGMENTS
            faces.append(
                (
                    first_ring + ring_index,
                    first_ring + following,
                    second_ring + following,
                    second_ring + ring_index,
                )
            )

    start_centre = len(vertices)
    vertices.append(polyline_sample(path, profile[0][0]))
    end_centre = len(vertices)
    vertices.append(polyline_sample(path, profile[-1][0]))
    first_ring = 0
    last_ring = (len(profile) - 1) * RING_SEGMENTS
    for ring_index in range(RING_SEGMENTS):
        following = (ring_index + 1) % RING_SEGMENTS
        faces.append((start_centre, first_ring + following, first_ring + ring_index))
        faces.append((end_centre, last_ring + ring_index, last_ring + following))

    return create_mesh_object(
        name,
        vertices,
        faces,
        collection,
        material_data,
        role,
        authored_section_count=len(profile),
        ring_segments=RING_SEGMENTS,
        **metadata,
    )


def create_torso(
    collection: bpy.types.Collection,
    material_data: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    profiles = (
        (0.72, 0.085, 0.035),
        (0.88, 0.125, 0.045),
        (1.08, 0.15, 0.052),
        (1.30, 0.158, 0.058),
        (1.48, 0.132, 0.048),
        (1.57, 0.075, 0.034),
    )
    segments = 24
    vertices: list[Vector] = []
    for ring_index, (height, radius_x, radius_y) in enumerate(profiles):
        for index in range(segments):
            angle = 2.0 * math.pi * index / segments
            posterior_gain = 1.0 + 0.18 * max(0.0, math.sin(angle))
            vertices.append(
                Vector(
                    (
                        radius_x * math.cos(angle),
                        radius_y * posterior_gain * math.sin(angle),
                        height,
                    )
                )
            )
    faces: list[tuple[int, ...]] = []
    for ring_index in range(len(profiles) - 1):
        for index in range(segments):
            following = (index + 1) % segments
            faces.append(
                (
                    ring_index * segments + index,
                    ring_index * segments + following,
                    (ring_index + 1) * segments + following,
                    (ring_index + 1) * segments + index,
                )
            )
    lower = len(vertices)
    vertices.append(Vector((0.0, 0.0, profiles[0][0])))
    upper = len(vertices)
    vertices.append(Vector((0.0, 0.0, profiles[-1][0])))
    last_ring = (len(profiles) - 1) * segments
    for index in range(segments):
        following = (index + 1) % segments
        faces.append((lower, following, index))
        faces.append((upper, last_ring + index, last_ring + following))
    obj = create_mesh_object(
        "SUPPORT_Continuous_Upper_Torso",
        vertices,
        faces,
        collection,
        material_data,
        "support",
        support_region="continuous_upper_torso",
    )
    parent_keep_world(obj, parent)
    return obj


def create_control(
    name: str,
    location: Vector,
    collection: bpy.types.Collection,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    collection.objects.link(obj)
    obj.empty_display_type = "CUBE"
    obj.empty_display_size = 0.045
    obj.location = location
    obj.hide_render = True
    tag_object(obj, "control", control_name=name)
    if parent is not None:
        parent_keep_world(obj, parent)
    return obj


def parent_keep_world(obj: bpy.types.Object, parent: bpy.types.Object) -> None:
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_parent_inverse = parent.matrix_world.inverted()
    obj.matrix_world = world
    bpy.context.view_layer.update()


def create_support_limb(
    name: str,
    path: list[Vector],
    radii: tuple[float, float, float],
    collection: bpy.types.Collection,
    material_data: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    profile = [
        (0.0, radii[0], radii[0] * 0.88),
        (0.5, radii[1], radii[1] * 0.88),
        (1.0, radii[2], radii[2] * 0.88),
    ]
    obj = create_loft(
        name,
        path,
        profile,
        Vector((0.0, 1.0, 0.0)),
        Vector((0.0, 0.0, 0.0)),
        collection,
        material_data,
        "support",
        support_region=name,
    )
    parent_keep_world(obj, parent)
    return obj


def create_bone_segment(
    name: str,
    start: Vector,
    end: Vector,
    radius: float,
    collection: bpy.types.Collection,
    material_data: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    obj = create_loft(
        name,
        [start, end],
        [(0.0, radius, radius), (0.5, radius * 0.82, radius * 0.82), (1.0, radius, radius)],
        Vector((0.0, 1.0, 0.0)),
        Vector((0.0, 0.0, 0.0)),
        collection,
        material_data,
        "qa_bone",
        qa_structure=name,
    )
    obj.hide_render = True
    parent_keep_world(obj, parent)
    return obj


def create_scapula(
    collection: bpy.types.Collection,
    material_data: bpy.types.Material,
    parent: bpy.types.Object,
) -> bpy.types.Object:
    front = [
        Vector((-0.055, 0.112, 1.50)),
        Vector((-0.185, 0.12, 1.45)),
        Vector((-0.135, 0.132, 1.25)),
        Vector((-0.065, 0.125, 1.31)),
    ]
    depth = Vector((0.0, 0.008, 0.0))
    vertices = front + [point + depth for point in front]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4)]
    for index in range(4):
        following = (index + 1) % 4
        faces.append((index, following, 4 + following, 4 + index))
    obj = create_mesh_object(
        "QA_BONE_Scapula",
        vertices,
        faces,
        collection,
        material_data,
        "qa_bone",
        qa_structure="scapula",
    )
    obj.hide_render = True
    parent_keep_world(obj, parent)
    return obj


def group_for(name: str) -> str:
    if name.startswith("Deltoideus"):
        return "deltoid"
    if name.startswith("PectoralisMajor") or name == "PectoralisMinor":
        return "chest"
    if name.startswith("SerratusAnterior"):
        return "serratus"
    if name.startswith(("Supraspinatus", "Infraspinatus", "Subscapularis")) or name == "TeresMinor":
        return "cuff"
    if name.startswith(("BIC_", "TRI")) or name == "Coracobrachialis":
        return "arm"
    return "back"


def profile_for(group: str, name: str) -> list[tuple[float, float, float]]:
    profiles: dict[str, list[tuple[float, float, float]]] = {
        "deltoid": [
            (0.0, 0.017, 0.005),
            (0.12, 0.036, 0.013),
            (0.34, 0.046, 0.019),
            (0.58, 0.039, 0.017),
            (0.82, 0.022, 0.011),
            (1.0, 0.004, 0.0025),
        ],
        "chest": [
            (0.0, 0.018, 0.003),
            (0.16, 0.030, 0.005),
            (0.45, 0.038, 0.008),
            (0.72, 0.027, 0.0065),
            (0.9, 0.012, 0.004),
            (1.0, 0.004, 0.0025),
        ],
        "back": [
            (0.0, 0.018, 0.003),
            (0.2, 0.029, 0.0055),
            (0.5, 0.036, 0.0075),
            (0.78, 0.023, 0.005),
            (1.0, 0.0045, 0.0025),
        ],
        "serratus": [
            (0.0, 0.014, 0.0045),
            (0.28, 0.022, 0.007),
            (0.58, 0.019, 0.006),
            (0.82, 0.011, 0.004),
            (1.0, 0.0035, 0.002),
        ],
        "cuff": [
            (0.0, 0.017, 0.0035),
            (0.22, 0.024, 0.005),
            (0.52, 0.027, 0.006),
            (0.78, 0.014, 0.004),
            (1.0, 0.0035, 0.002),
        ],
        "arm": [
            (0.0, 0.006, 0.004),
            (0.16, 0.020, 0.014),
            (0.44, 0.030, 0.021),
            (0.72, 0.027, 0.018),
            (0.9, 0.013, 0.008),
            (1.0, 0.004, 0.0025),
        ],
    }
    result = [tuple(section) for section in profiles[group]]
    if name.startswith("Trapezius"):
        result = [(t, w * 0.86, d * 0.62) for t, w, d in result]
    if name.startswith("Latissimus"):
        result = [(t, w * 0.94, d * 0.66) for t, w, d in result]
    if name.startswith("Rhomboideus"):
        result = [(t, w * 0.74, d * 0.65) for t, w, d in result]
    if name == "LevatorScapulae":
        result = [(t, w * 0.48, d * 0.72) for t, w, d in result]
    if name == "PectoralisMinor":
        result = [(t, w * 0.55, d * 0.72) for t, w, d in result]
    if name == "Coracobrachialis":
        result = [(t, w * 0.62, d * 0.8) for t, w, d in result]
    return result


def width_hint_for(group: str) -> Vector:
    if group in {"chest", "back", "serratus", "cuff"}:
        return Vector((0.0, 0.0, 1.0))
    return Vector((0.0, 1.0, 0.0))


def belly_offset_for(name: str, group: str) -> Vector:
    if name.endswith("_A") or name.endswith("_S"):
        signed = -1.0
    elif name.endswith("_P") or name.endswith("_I"):
        signed = 1.0
    else:
        signed = 0.0
    if group == "deltoid":
        return Vector((-0.042, signed * 0.012, 0.0))
    if group == "chest":
        return Vector((-0.022, -0.062, signed * 0.006))
    if group == "back":
        return Vector((-0.028, 0.052, signed * 0.006))
    if group == "cuff":
        return Vector((-0.024, 0.038, signed * 0.005))
    if group == "serratus":
        return Vector((-0.046, 0.014, signed * 0.007))
    return Vector((-0.015, signed * 0.006, 0.0))


def create_anchor(
    muscle_name: str,
    point: dict[str, Any],
    collection: bpy.types.Collection,
    controls_by_frame: dict[str, bpy.types.Object],
) -> bpy.types.Object:
    role = str(point["role"])
    obj = bpy.data.objects.new(f"ANCHOR__{muscle_name}__{role}", None)
    collection.objects.link(obj)
    obj.location = THORAX_WORLD_OFFSET + Vector(point["blender_thorax_m"])
    obj.empty_display_type = "SPHERE"
    obj.empty_display_size = 0.008
    obj.color = (0.1, 0.9, 0.3, 1.0) if role == "origin" else (0.1, 0.45, 1.0, 1.0)
    obj.hide_render = True
    tag_object(
        obj,
        "anchor",
        source_muscle=muscle_name,
        anchor_role=role,
        parent_frame=str(point["parent_frame"]),
        parent_frame_path=str(point["parent_frame_path"]),
        parent_local_json=json.dumps(point["parent_local_m"], separators=(",", ":")),
        reference_blender_thorax_json=json.dumps(
            point["blender_thorax_m"], separators=(",", ":")
        ),
    )
    parent = controls_by_frame.get(str(point["parent_frame"]), controls_by_frame["thorax"])
    parent_keep_world(obj, parent)
    return obj


def create_stage(
    stage_collection: bpy.types.Collection,
    lights_collection: bpy.types.Collection,
    materials: dict[str, bpy.types.Material],
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_plane_add(size=6.0, location=(0.0, 0.0, 0.34))
    floor = bpy.context.object
    floor.name = "V2_Stage_Floor"
    link_only(floor, stage_collection)
    floor.data.materials.append(materials["stage"])
    tag_object(floor, "stage")

    camera_data = bpy.data.cameras.new("V2_Camera_Data")
    camera = bpy.data.objects.new("V2_Camera", camera_data)
    lights_collection.objects.link(camera)
    camera.data.lens = 58.0
    camera.data.sensor_width = 36.0
    camera.location = (-2.8, -4.5, 2.05)
    bpy.context.scene.camera = camera
    tag_object(camera, "camera")

    for name, location, energy, size in (
        ("V2_Key", (-2.2, -3.0, 3.4), 360.0, 3.0),
        ("V2_Fill", (2.4, -1.6, 2.5), 190.0, 2.5),
        ("V2_Rim", (-1.3, 2.8, 2.8), 280.0, 2.2),
        ("V2_Top", (0.0, 0.0, 4.2), 170.0, 2.0),
    ):
        light_data = bpy.data.lights.new(name + "_Data", "AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        lights_collection.objects.link(light)
        light.location = location
        look_at(light, Vector((0.0, 0.0, 1.18)))
        tag_object(light, "light")
    return camera


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def load_path_reference(path: Path) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1:
        raise RuntimeError("Unsupported V2 path schema")
    if payload.get("exercise_id") != "ex_001":
        raise RuntimeError("Geometry paths do not belong to ex_001")
    if payload.get("source", {}).get("commit") != SOURCE_COMMIT:
        raise RuntimeError("Geometry paths are not pinned to the approved RMR commit")
    if payload.get("pose_order") != [
        "rest",
        "raise_30",
        "raise_45",
        "raise_60",
        "raise_75",
        "shoulder_height",
    ]:
        raise RuntimeError("Geometry path pose order changed")
    rest_pose = payload["poses"][0]
    muscles = {entry["name"]: entry for entry in rest_pose["muscles"]}
    if set(muscles) != set(payload["muscle_names"]):
        raise RuntimeError("Rest-pose muscle set is incomplete")
    return payload, muscles


def main() -> None:
    args = parse_args()
    paths_file = args.paths.resolve()
    output = args.output.resolve()
    if not paths_file.is_file():
        raise FileNotFoundError(paths_file)
    reference, path_muscles = load_path_reference(paths_file)

    clear_scene()
    scene = bpy.context.scene
    scene.name = "EX001_Ecorche_V2_Static_Milestone_1"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.unit_settings.scale_length = 1.0
    scene.frame_start = 1
    scene.frame_end = 1
    scene.frame_set(1)
    scene.render.fps = 30
    scene.render.fps_base = 1.0
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 800
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.color = (0.018, 0.025, 0.035)

    root = new_collection("EX001_ECORCHE_V2")
    controls_collection = new_collection("V2_Controls", root)
    support_collection = new_collection("V2_Support", root)
    muscles_collection = new_collection("V2_Muscles", root)
    tendons_collection = new_collection("V2_Tendons", root)
    skeleton_collection = new_collection("V2_Skeleton_QA", root)
    anchors_collection = new_collection("V2_Anchors_QA", root)
    stage_collection = new_collection("V2_Stage", root)
    lights_collection = new_collection("V2_Lights_Camera", root)
    materials = create_materials()

    thorax_control = create_control(
        "CTRL_Thorax", THORAX_WORLD_OFFSET, controls_collection
    )
    shoulder_control = create_control(
        "CTRL_ShoulderGirdle",
        Vector((-0.13, 0.07, 1.47)),
        controls_collection,
        thorax_control,
    )
    humerus_control = create_control(
        "CTRL_Humerus",
        Vector((-0.175, 0.055, 1.43)),
        controls_collection,
        shoulder_control,
    )
    forearm_control = create_control(
        "CTRL_ForearmGross",
        Vector((-0.235, 0.04, 1.10)),
        controls_collection,
        humerus_control,
    )
    pronation_control = create_control(
        "CTRL_ForearmPronation",
        Vector((-0.245, 0.025, 0.73)),
        controls_collection,
        forearm_control,
    )
    hand_control = create_control(
        "CTRL_HandPalm",
        Vector((-0.245, 0.005, 0.52)),
        controls_collection,
        pronation_control,
    )
    controls_by_frame = {
        "ground": thorax_control,
        "thorax": thorax_control,
        "clavicle": shoulder_control,
        "scapula": shoulder_control,
        "humerus": humerus_control,
        "ulna": pronation_control,
        "radius": pronation_control,
        "hand": hand_control,
    }

    create_torso(support_collection, materials["support"], thorax_control)
    create_support_limb(
        "SUPPORT_Neck",
        [Vector((0.0, 0.0, 1.54)), Vector((0.0, 0.0, 1.70))],
        (0.075, 0.068, 0.062),
        support_collection,
        materials["support"],
        thorax_control,
    )
    create_support_limb(
        "SUPPORT_Right_Upper_Arm",
        [Vector((-0.17, 0.055, 1.43)), Vector((-0.21, 0.045, 1.27)), Vector((-0.238, 0.038, 1.10))],
        (0.024, 0.021, 0.018),
        support_collection,
        materials["support"],
        humerus_control,
    )
    create_support_limb(
        "SUPPORT_Right_Forearm",
        [Vector((-0.238, 0.038, 1.10)), Vector((-0.25, 0.025, 0.91)), Vector((-0.245, 0.01, 0.70))],
        (0.018, 0.016, 0.013),
        support_collection,
        materials["support"],
        pronation_control,
    )
    create_support_limb(
        "SUPPORT_Right_Palm",
        [Vector((-0.245, 0.01, 0.70)), Vector((-0.245, -0.005, 0.55))],
        (0.024, 0.026, 0.021),
        support_collection,
        materials["support"],
        hand_control,
    )
    finger_offsets = (-0.026, -0.013, 0.0, 0.013, 0.026)
    finger_lengths = (0.075, 0.095, 0.105, 0.098, 0.08)
    for index, (offset, length) in enumerate(zip(finger_offsets, finger_lengths), start=1):
        create_support_limb(
            f"SUPPORT_Right_Finger_{index}",
            [
                Vector((-0.245 + offset, -0.007, 0.55)),
                Vector((-0.245 + offset, -0.01, 0.55 - length)),
            ],
            (0.008, 0.007, 0.006),
            support_collection,
            materials["support"],
            hand_control,
        )

    create_scapula(skeleton_collection, materials["bone"], shoulder_control)
    create_bone_segment(
        "QA_BONE_Clavicle",
        Vector((-0.015, -0.005, 1.49)),
        Vector((-0.165, 0.05, 1.47)),
        0.009,
        skeleton_collection,
        materials["bone"],
        shoulder_control,
    )
    create_bone_segment(
        "QA_BONE_Humerus",
        Vector((-0.175, 0.055, 1.43)),
        Vector((-0.238, 0.038, 1.10)),
        0.012,
        skeleton_collection,
        materials["bone"],
        humerus_control,
    )
    create_bone_segment(
        "QA_BONE_Radius",
        Vector((-0.229, 0.025, 1.10)),
        Vector((-0.232, -0.002, 0.70)),
        0.007,
        skeleton_collection,
        materials["bone"],
        pronation_control,
    )
    create_bone_segment(
        "QA_BONE_Ulna",
        Vector((-0.248, 0.05, 1.10)),
        Vector((-0.258, 0.022, 0.70)),
        0.0075,
        skeleton_collection,
        materials["bone"],
        pronation_control,
    )

    muscle_manifest: list[str] = []
    tendon_manifest: list[str] = []
    anchor_manifest: list[str] = []
    tendon_sources = {
        name
        for name in path_muscles
        if group_for(name) in {"deltoid", "chest", "cuff", "arm"}
        or name.startswith("Latissimus")
        or name == "TeresMajor"
    }
    for source_name in reference["muscle_names"]:
        source_entry = path_muscles[source_name]
        points = [
            THORAX_WORLD_OFFSET + Vector(point["blender_thorax_m"])
            for point in source_entry["points"]
        ]
        group = group_for(source_name)
        muscle_name = f"MUSCLE__{source_name}"
        muscle_obj = create_loft(
            muscle_name,
            points,
            profile_for(group, source_name),
            width_hint_for(group),
            belly_offset_for(source_name, group),
            muscles_collection,
            materials[group],
            "muscle",
            source_muscle=source_name,
            anatomy_group=group,
            reference_path_point_count=int(source_entry["path_point_count"]),
            reference_path_length_m=float(source_entry["path_length_m"]),
        )
        muscle_obj["authored_world_volume_m3"] = world_volume_m3(muscle_obj)
        muscle_manifest.append(muscle_name)

        if source_name in tendon_sources:
            tendon_name = f"TENDON__{source_name}"
            tendon_obj = create_loft(
                tendon_name,
                points,
                [
                    (0.76, 0.008, 0.0026),
                    (0.86, 0.0065, 0.0022),
                    (0.94, 0.0045, 0.0018),
                    (1.0, 0.0022, 0.0012),
                ],
                width_hint_for(group),
                belly_offset_for(source_name, group) * 0.25,
                tendons_collection,
                materials["tendon"],
                "tendon",
                source_muscle=source_name,
                anatomy_group=group,
                tendon_kind="insertion_or_aponeurosis",
            )
            tendon_obj["authored_world_volume_m3"] = world_volume_m3(tendon_obj)
            tendon_manifest.append(tendon_name)

        for endpoint in (source_entry["points"][0], source_entry["points"][-1]):
            anchor = create_anchor(
                source_name, endpoint, anchors_collection, controls_by_frame
            )
            anchor_manifest.append(anchor.name)

    create_stage(stage_collection, lights_collection, materials)

    scene["v2_schema_version"] = SCHEMA_VERSION
    scene["v2_stage"] = "static_rest_milestone_1"
    scene["exercise_id"] = "ex_001"
    scene["authorization"] = (
        "User lifted the 2026-08-22 hold on further 3D build work for "
        "ex_001 V2 and approved Stage 1 on 2026-08-23"
    )
    scene["protected_geometry_imported"] = False
    scene["atlas_or_rejected_libraries_linked"] = 0
    scene["reference_paths"] = str(paths_file)
    scene["reference_paths_sha256"] = sha256(paths_file)
    scene["reference_source_commit"] = SOURCE_COMMIT
    scene["builder"] = str(Path(__file__).resolve())
    scene["builder_sha256"] = sha256(Path(__file__).resolve())
    scene["thorax_world_offset_json"] = json.dumps(
        list(THORAX_WORLD_OFFSET), separators=(",", ":")
    )
    scene["muscle_manifest_json"] = json.dumps(muscle_manifest, separators=(",", ":"))
    scene["tendon_manifest_json"] = json.dumps(tendon_manifest, separators=(",", ":"))
    scene["anchor_manifest_json"] = json.dumps(anchor_manifest, separators=(",", ":"))
    scene["interpretation_boundary"] = (
        "OpenSim paths constrain rest attachments and line of action only; all visible surfaces are newly authored instructional geometry"
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    summary = {
        "output": str(output),
        "muscle_objects": len(muscle_manifest),
        "tendon_objects": len(tendon_manifest),
        "anchors": len(anchor_manifest),
        "controls": 6,
        "frame_range": [scene.frame_start, scene.frame_end],
        "protected_geometry_imported": False,
        "reference_paths_sha256": scene["reference_paths_sha256"],
        "builder_sha256": scene["builder_sha256"],
    }
    print("EX001_ECORCHE_V2_BUILD=" + json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
