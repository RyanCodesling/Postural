"""Render atlas V3 full-body and shoulder QA stills without editing the source."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    blender_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--frames", type=int, nargs="+", default=(1, 45, 58, 71, 84, 108))
    parser.add_argument("--resolution", type=int, default=720)
    return parser.parse_args(blender_args)


def look_at(obj: bpy.types.Object, point: Vector) -> None:
    obj.rotation_euler = (point - obj.location).to_track_quat("-Z", "Y").to_euler()


def configure_workbench(scene: bpy.types.Scene, resolution: int) -> None:
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.curvature_ridge_factor = 1.35
    scene.display.shading.curvature_valley_factor = 1.1
    scene.display.shading.show_specular_highlight = True
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.018, 0.024, 0.032)
    scene.view_settings.exposure = 0.0


def render_view(
    scene: bpy.types.Scene,
    camera: bpy.types.Object,
    output_dir: Path,
    frame: int,
    label: str,
    location: tuple[float, float, float],
    target: tuple[float, float, float],
    lens: float,
) -> None:
    scene.frame_set(frame)
    camera.location = location
    camera.data.lens = lens
    look_at(camera, Vector(target))
    scene.render.filepath = str(output_dir / f"{label}_f{frame:04d}.png")
    bpy.ops.render.render(write_still=True)
    print(f"Rendered {scene.render.filepath}", flush=True)


def main() -> None:
    args = parse_args()
    source = args.source.resolve()
    output_dir = args.output_dir.resolve()
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False)
    scene = bpy.context.scene
    camera = bpy.data.objects.get("V3_Camera")
    if camera is None or camera.type != "CAMERA":
        raise RuntimeError("V3 source has no V3_Camera")
    scene.camera = camera
    configure_workbench(scene, args.resolution)
    output_dir.mkdir(parents=True, exist_ok=True)

    stage = bpy.data.collections.get("EX001_MuscleAtlasV3_Stage")
    if stage is not None:
        for obj in stage.all_objects:
            if obj is not None and obj is not camera:
                obj.hide_render = True

    full_views = {
        "front": ((0.0, -5.2, 0.98), (0.0, 0.0, 0.92), 62.0),
        "rear": ((0.0, 5.2, 0.98), (0.0, 0.0, 0.92), 62.0),
        "three_quarter": ((2.35, -4.7, 1.25), (0.0, 0.0, 0.94), 62.0),
    }
    for frame in args.frames:
        for label, (location, target, lens) in full_views.items():
            render_view(scene, camera, output_dir, frame, label, location, target, lens)
        render_view(
            scene,
            camera,
            output_dir,
            frame,
            "shoulder_front",
            (1.55, -3.0, 1.72),
            (0.0, 0.0, 1.43),
            72.0,
        )
        render_view(
            scene,
            camera,
            output_dir,
            frame,
            "shoulder_rear",
            (-1.55, 3.0, 1.72),
            (0.0, 0.0, 1.43),
            72.0,
        )


if __name__ == "__main__":
    main()
