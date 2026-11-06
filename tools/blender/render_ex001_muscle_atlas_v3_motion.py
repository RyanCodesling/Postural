"""Render the saved 210-frame atlas V3 proof to lossless PNG frames."""

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
    parser.add_argument("--resolution", type=int, default=512)
    return parser.parse_args(blender_args)


def look_at(obj: bpy.types.Object, point: Vector) -> None:
    obj.rotation_euler = (point - obj.location).to_track_quat("-Z", "Y").to_euler()


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
    camera.location = (2.35, -4.7, 1.25)
    camera.data.lens = 62.0
    look_at(camera, Vector((0.0, 0.0, 0.94)))

    stage = bpy.data.collections.get("EX001_MuscleAtlasV3_Stage")
    if stage is not None:
        for obj in stage.all_objects:
            if obj is not None and obj is not camera:
                obj.hide_render = True

    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = args.resolution
    scene.render.resolution_y = args.resolution
    scene.render.resolution_percentage = 100
    scene.render.fps = 30
    scene.render.fps_base = 1.0
    scene.frame_start = 1
    scene.frame_end = 210
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

    output_dir.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(output_dir / "frame_")
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.use_file_extension = True
    bpy.ops.render.render(animation=True)
    print(f"Rendered V3 motion frames: {output_dir}", flush=True)


if __name__ == "__main__":
    main()
