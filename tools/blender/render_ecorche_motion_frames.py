"""Render 16-sample motion progression frames for the ex_001 shoulder écorché variant."""

from pathlib import Path
import bpy
from mathutils import Vector


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    blend_path = root / "assets" / "blender" / "ex_001_lateral_arm_raise_ecorche.blend"
    out_dir = root / "assets" / "blender" / "previews" / "ex_001_ecorche"
    out_dir.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.open_mainfile(filepath=str(blend_path))
    scene = bpy.context.scene
    camera = bpy.data.objects.get("EX001_Ecorche_Camera")
    if camera is None:
        raise RuntimeError("Camera EX001_Ecorche_Camera not found")

    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 480
    scene.render.resolution_y = 360

    # 3/4 front view of right shoulder
    camera.location = Vector((0.45, -2.4, 1.40))
    camera.data.lens = 55
    dir_vec = Vector((0.15, 0.0, 1.38)) - camera.location
    camera.rotation_euler = dir_vec.to_track_quat("-Z", "Y").to_euler()

    frames = [1, 15, 30, 45, 60, 75, 90, 108, 120, 135, 150, 165, 180, 195, 205, 210]

    for frame in frames:
        scene.frame_set(frame)
        filepath = out_dir / f"motion_frame_{frame:04d}.png"
        scene.render.filepath = str(filepath)
        bpy.ops.render.render(write_still=True)
        print(f"Rendered motion sample: {filepath}")

    print("Rendered all 16 motion sample frames successfully.", flush=True)


if __name__ == "__main__":
    main()
