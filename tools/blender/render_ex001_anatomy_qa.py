"""Render fast multi-angle registration QA from the editable anatomy source."""

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
    parser.add_argument("--rest-frame", type=int, default=1)
    parser.add_argument("--peak-frame", type=int)
    parser.add_argument(
        "--views",
        nargs="+",
        choices=(
            "front",
            "rear",
            "left",
            "shoulder_front",
            "shoulder_rear",
            "hands_front",
            "hands_rear",
            "hands_top",
        ),
        default=(
            "front",
            "rear",
            "left",
            "shoulder_front",
            "shoulder_rear",
            "hands_front",
            "hands_rear",
            "hands_top",
        ),
        help=(
            "Limit QA to selected views; full-body and hand-front/rear views render "
            "rest and peak, while shoulder and hand-top views render peak."
        ),
    )
    return parser.parse_args(blender_args)


def look_at(obj: bpy.types.Object, point: Vector) -> None:
    obj.rotation_euler = (point - obj.location).to_track_quat("-Z", "Y").to_euler()


def configure_workbench(scene: bpy.types.Scene) -> None:
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 720
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
    scene.display.shading.curvature_ridge_factor = 1.5
    scene.display.shading.curvature_valley_factor = 1.2
    scene.display.shading.show_specular_highlight = True
    scene.view_settings.exposure = 0.0


def render_view(
    scene: bpy.types.Scene,
    camera: bpy.types.Object,
    output_dir: Path,
    label: str,
    frame: int,
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
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    peak_frame = (
        int(args.peak_frame)
        if args.peak_frame is not None
        else int(scene.get("ex001_peak_frame", 0))
    )
    if peak_frame <= 0:
        raise RuntimeError(
            "Editable anatomy source does not declare ex001_peak_frame; pass --peak-frame"
        )
    camera = bpy.data.objects.get("EX001_Anatomy_Camera")
    if camera is None or camera.type != "CAMERA":
        raise RuntimeError("Editable anatomy source has no EX001_Anatomy_Camera")
    scene.camera = camera
    configure_workbench(scene)
    output_dir.mkdir(parents=True, exist_ok=True)

    stage = bpy.data.collections.get("EX001_Anatomy_Stage")
    if stage is not None:
        for obj in stage.all_objects:
            if obj is not camera:
                obj.hide_render = True

    full_views = {
        "front": ((0.0, -5.7, 0.95), (0.0, 0.0, 0.87)),
        "rear": ((0.0, 5.7, 0.95), (0.0, 0.0, 0.87)),
        "left": ((-5.7, 0.0, 0.95), (0.0, 0.0, 0.87)),
    }
    for frame in (args.rest_frame, peak_frame):
        for label, (location, target) in full_views.items():
            if label not in args.views:
                continue
            render_view(
                scene,
                camera,
                output_dir,
                label,
                frame,
                location,
                target,
                58.0,
            )

        hand_target_z = 0.92 if frame == args.rest_frame else 1.43
        hand_camera_y = 3.2 if frame == args.rest_frame else 4.2
        hand_lens = 80.0 if frame == args.rest_frame else 72.0
        for label, camera_y in {
            "hands_front": -hand_camera_y,
            "hands_rear": hand_camera_y,
        }.items():
            if label not in args.views:
                continue
            render_view(
                scene,
                camera,
                output_dir,
                label,
                frame,
                (0.0, camera_y, hand_target_z),
                (0.0, 0.0, hand_target_z),
                hand_lens,
            )

    for label, location in {
        "shoulder_front": (0.0, -2.6, 1.44),
        "shoulder_rear": (0.0, 2.6, 1.44),
    }.items():
        if label not in args.views:
            continue
        render_view(
            scene,
            camera,
            output_dir,
            label,
            peak_frame,
            location,
            (0.0, 0.0, 1.42),
            58.0,
        )

    if "hands_top" in args.views:
        render_view(
            scene,
            camera,
            output_dir,
            "hands_top",
            peak_frame,
            (0.0, 0.0, 5.0),
            (0.0, 0.0, 1.43),
            65.0,
        )


if __name__ == "__main__":
    main()
