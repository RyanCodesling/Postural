"""Render the Stage 1 static visual checkpoint for ex_001 ecorche V2.

Primary renders hide the skeleton, controls, and anchors.  A separate technical
view adds a line skeleton and named attachment markers without changing or
saving the source blend.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import bpy
from mathutils import Vector


PRIMARY_VIEWS = {
    "front_oblique": {
        "location": (-2.65, -4.35, 2.05),
        "target": (-0.13, 0.0, 1.39),
        "ortho_scale": 0.78,
    },
    "true_lateral": {
        "location": (-4.6, 0.0, 1.35),
        "target": (-0.13, 0.0, 1.38),
        "ortho_scale": 0.78,
    },
    "rear_oblique": {
        "location": (-2.75, 4.3, 2.0),
        "target": (-0.13, 0.015, 1.38),
        "ortho_scale": 0.78,
    },
    "inferior_axillary": {
        "location": (-2.55, -1.9, 0.58),
        "target": (-0.16, 0.02, 1.43),
        "ortho_scale": 0.72,
    },
    "full_chain_front_oblique": {
        "location": (-2.65, -4.35, 2.05),
        "target": (-0.12, 0.0, 1.13),
        "ortho_scale": 1.58,
    },
}


def blender_args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parents[2]
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=(
            root
            / "assets"
            / "blender"
            / "previews"
            / "ex_001_ecorche_v2"
            / "static_rest"
        ),
    )
    parser.add_argument("--resolution", type=int, default=900)
    parser.add_argument(
        "--only-view",
        choices=tuple(PRIMARY_VIEWS),
        default=None,
        help="Render one named primary view for local iteration.",
    )
    return parser.parse_args(blender_args())


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def set_role_visibility(role: str, visible: bool) -> None:
    for obj in bpy.data.objects:
        if obj.get("geometry_role") == role:
            obj.hide_render = not visible


def configure_primary_visibility() -> None:
    for role in ("qa_bone", "anchor", "control"):
        set_role_visibility(role, False)
    for role in ("support", "muscle", "tendon"):
        set_role_visibility(role, True)
    set_role_visibility("stage", False)


def render_view(
    scene: bpy.types.Scene,
    camera: bpy.types.Object,
    output: Path,
    specification: dict[str, Any],
) -> None:
    camera.location = Vector(specification["location"])
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = float(specification["ortho_scale"])
    look_at(camera, Vector(specification["target"]))
    scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)


def qa_material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.diffuse_color = color
    result.use_nodes = True
    principled = result.node_tree.nodes.get("Principled BSDF")
    if principled is not None:
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Roughness"].default_value = 0.34
        if "Emission Color" in principled.inputs:
            principled.inputs["Emission Color"].default_value = color
            principled.inputs["Emission Strength"].default_value = 0.18
    return result


def create_qa_markers() -> bpy.types.Collection:
    collection = bpy.data.collections.new("V2_Temporary_QA_Markers")
    bpy.context.scene.collection.children.link(collection)
    origin_material = qa_material("V2_QA_Origin_Render", (0.05, 0.9, 0.25, 1.0))
    insertion_material = qa_material("V2_QA_Insertion_Render", (0.05, 0.42, 1.0, 1.0))
    line_material = qa_material("V2_QA_Path_Render", (0.95, 0.78, 0.15, 1.0))

    anchors_by_muscle: dict[str, dict[str, bpy.types.Object]] = {}
    for anchor in bpy.data.objects:
        if anchor.get("geometry_role") != "anchor":
            continue
        source = str(anchor["source_muscle"])
        role = str(anchor["anchor_role"])
        anchors_by_muscle.setdefault(source, {})[role] = anchor
        bpy.ops.mesh.primitive_ico_sphere_add(
            subdivisions=2,
            radius=0.0075,
            location=anchor.matrix_world.translation,
        )
        marker = bpy.context.object
        marker.name = f"QA_RENDER__{source}__{role}"
        for existing in tuple(marker.users_collection):
            existing.objects.unlink(marker)
        collection.objects.link(marker)
        marker.data.materials.append(
            origin_material if role == "origin" else insertion_material
        )

    for source, endpoints in anchors_by_muscle.items():
        if set(endpoints) != {"origin", "insertion"}:
            continue
        curve_data = bpy.data.curves.new(f"QA_PATH__{source}_Data", "CURVE")
        curve_data.dimensions = "3D"
        curve_data.bevel_depth = 0.0014
        curve_data.bevel_resolution = 2
        spline = curve_data.splines.new("POLY")
        spline.points.add(1)
        for index, role in enumerate(("origin", "insertion")):
            point = endpoints[role].matrix_world.translation
            spline.points[index].co = (*point, 1.0)
        curve = bpy.data.objects.new(f"QA_PATH__{source}", curve_data)
        collection.objects.link(curve)
        curve.data.materials.append(line_material)
    return collection


def main() -> None:
    args = parse_args()
    if not bpy.data.filepath:
        raise RuntimeError("Renderer must run from the saved V2 blend")
    scene = bpy.context.scene
    if scene.get("v2_stage") != "static_rest_milestone_1":
        raise RuntimeError("Source is not the approved V2 static milestone")
    camera = bpy.data.objects.get("V2_Camera")
    if camera is None or camera.type != "CAMERA":
        raise RuntimeError("V2 camera is missing")

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = args.resolution
    scene.render.resolution_y = args.resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.render.use_file_extension = True
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False

    configure_primary_visibility()
    outputs: list[str] = []
    selected_views = (
        {args.only_view: PRIMARY_VIEWS[args.only_view]}
        if args.only_view is not None
        else PRIMARY_VIEWS
    )
    for name, specification in selected_views.items():
        path = output_dir / f"rest_{name}.png"
        render_view(scene, camera, path, specification)
        outputs.append(str(path))

    qa_markers = None
    qa_path = output_dir / "qa_anchors_front_oblique.png"
    if args.only_view is None:
        set_role_visibility("qa_bone", True)
        qa_markers = create_qa_markers()
        render_view(scene, camera, qa_path, PRIMARY_VIEWS["front_oblique"])
        outputs.append(str(qa_path))

    summary = {
        "source": str(Path(bpy.data.filepath).resolve()),
        "output_dir": str(output_dir),
        "primary_views": list(selected_views),
        "qa_view": qa_path.name if qa_markers is not None else None,
        "render_count": len(outputs),
        "resolution": [args.resolution, args.resolution],
        "skeleton_hidden_in_primary": True,
        "anchors_hidden_in_primary": True,
        "temporary_qa_collection": qa_markers.name if qa_markers is not None else None,
    }
    print("EX001_ECORCHE_V2_RENDER=" + json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
