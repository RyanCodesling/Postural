r"""Render multi-angle contact sheets, QA overlays, and comparison proofs for the ex_001 shoulder écorché variant."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    blender_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("assets/blender/ex_001_lateral_arm_raise_ecorche.blend"))
    parser.add_argument("--output-dir", type=Path, default=Path("assets/blender/previews/ex_001_ecorche"))
    return parser.parse_args(blender_args)


def configure_workbench(scene: bpy.types.Scene) -> None:
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.curvature_ridge_factor = 1.6
    scene.display.shading.curvature_valley_factor = 1.4
    scene.display.shading.show_specular_highlight = True


def render_view(
    scene: bpy.types.Scene,
    camera: bpy.types.Object,
    output_path: Path,
    frame: int,
    cam_pos: tuple[float, float, float],
    target: tuple[float, float, float],
    lens: float = 60.0,
) -> None:
    scene.frame_set(frame)
    camera.location = Vector(cam_pos)
    camera.data.lens = lens
    dir_vec = Vector(target) - camera.location
    camera.rotation_euler = dir_vec.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(output_path)
    bpy.ops.render.render(write_still=True)
    print(f"Rendered: {output_path}", flush=True)


def main() -> None:
    args = parse_args()
    source = args.source.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if not source.is_file():
        raise FileNotFoundError(f"Source blend file not found: {source}")

    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    camera = bpy.data.objects.get("EX001_Ecorche_Camera")
    if camera is None:
        raise RuntimeError("Camera EX001_Ecorche_Camera not found in source")

    configure_workbench(scene)
    shoulder_target = (0.18, 0.0, 1.42)

    # 1. Multi-angle QA Renders (Rest, Mid 45, Peak 90)
    poses = [("rest", 1), ("mid_45", 60), ("peak_90", 108)]
    views = {
        "front": (0.18, -2.6, 1.42),
        "rear": (0.18, 2.6, 1.42),
        "lateral": (2.8, 0.0, 1.42),
        "axillary": (1.8, -1.2, 0.95),
    }

    for pose_name, frame in poses:
        for view_name, pos in views.items():
            out_file = output_dir / f"proof_{view_name}_{pose_name}.png"
            render_view(scene, camera, out_file, frame, pos, shoulder_target)

    # 2. QA Overlay with Bones Visible
    skel_col = bpy.data.collections.get("EX001_Ecorche_Skeleton")
    if skel_col:
        for obj in skel_col.all_objects:
            obj.show_in_front = True

    out_overlay = output_dir / "proof_qa_bone_overlay_peak.png"
    render_view(scene, camera, out_overlay, 108, views["front"], shoulder_target)

    if skel_col:
        for obj in skel_col.all_objects:
            obj.show_in_front = False

    print("Rendered all QA proof views successfully.", flush=True)


if __name__ == "__main__":
    main()
