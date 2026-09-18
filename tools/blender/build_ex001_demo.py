r"""Render and export the editable ex_001 Blender demonstration.

The packed Blender file is the source of truth for the detailed character.
This script reapplies the exercise animation, validates the key poses, renders
the preview/video assets, and exports the animated GLB without requiring the
character-authoring add-on.

Run from the Postural repository root:

    blender --background --python tools/blender/build_ex001_demo.py

Use -- --skip-video while checking the model and key poses.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


EXERCISE_ID = "ex_001"
EXERCISE_NAME = "Lateral Arm Raises"
ACTION_NAME = "ex_001_lateral_arm_raise"
CHARACTER_COLLECTION = "EX001_Character"
RIG_NAME = "Maya_Exercise_Rig"
BODY_NAME = "Maya_Body"

FPS = 30
FRAME_START = 1
FRAME_REST_END = 25
FRAME_PEAK = 85
FRAME_HOLD_END = 115
FRAME_RETURN = 175
FRAME_END = 210
POSTER_FRAME = 100

RENDER_WIDTH = 720
RENDER_HEIGHT = 405
PREVIEW_FRAMES = (FRAME_START, 55, POSTER_FRAME, 145, FRAME_RETURN)
ANIMATED_BONES = (
    "upperarm_l",
    "lowerarm_l",
    "hand_l",
    "upperarm_r",
    "lowerarm_r",
    "hand_r",
)


def parse_args() -> argparse.Namespace:
    blender_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skip-video",
        action="store_true",
        help="Render key poses and export the GLB without encoding WebM/MP4.",
    )
    parser.add_argument(
        "--video-only",
        action="store_true",
        help="Render and encode only the WebM/MP4 after a verified still build.",
    )
    parser.add_argument(
        "--export-only",
        action="store_true",
        help="Regenerate only the web GLB from the verified editable source.",
    )
    parser.add_argument(
        "--ffmpeg",
        type=Path,
        help="Explicit ffmpeg executable. Otherwise common locations are checked.",
    )
    args = parser.parse_args(blender_args)
    modes = sum(bool(value) for value in (args.skip_video, args.video_only, args.export_only))
    if modes > 1:
        parser.error("--skip-video, --video-only, and --export-only are mutually exclusive")
    return args


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def source_blend_path(root: Path) -> Path:
    return root / "assets" / "blender" / "ex_001_lateral_arm_raise.blend"


def open_source_blend(path: Path) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"Editable Blender source not found: {path}")
    current = Path(bpy.data.filepath).resolve() if bpy.data.filepath else None
    if current != path.resolve():
        print(f"Opening editable source: {path}", flush=True)
        bpy.ops.wm.open_mainfile(filepath=str(path))


def require_object(name: str, object_type: str | None = None) -> bpy.types.Object:
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise RuntimeError(f"Required Blender object is missing: {name}")
    if object_type is not None and obj.type != object_type:
        raise RuntimeError(
            f"{name} must be a {object_type} object, found {obj.type}"
        )
    return obj


def look_at(obj: bpy.types.Object, point: Vector) -> None:
    obj.rotation_euler = (point - obj.location).to_track_quat("-Z", "Y").to_euler()


def configure_scene(scene: bpy.types.Scene) -> None:
    camera = bpy.data.objects.get("EX001_Camera") or bpy.data.objects.get("Camera")
    if camera is None or camera.type != "CAMERA":
        raise RuntimeError("The source scene is missing its preview camera")
    camera.name = "EX001_Camera"
    camera.location = (0.0, -5.2, 0.93)
    camera.data.type = "PERSP"
    camera.data.lens = 52
    camera.data.sensor_width = 36
    look_at(camera, Vector((0.0, 0.0, 0.91)))

    scene.name = ACTION_NAME
    scene.camera = camera
    scene.frame_start = FRAME_START
    scene.frame_end = FRAME_END
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = RENDER_WIDTH
    scene.render.resolution_y = RENDER_HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.render.use_file_extension = True
    scene.view_settings.exposure = -0.34
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass

    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"

    scene.timeline_markers.clear()
    for label, frame in (
        ("Neutral", FRAME_START),
        ("Raise", FRAME_REST_END),
        ("Shoulder height", FRAME_PEAK),
        ("Controlled return", FRAME_HOLD_END),
        ("Neutral complete", FRAME_RETURN),
    ):
        scene.timeline_markers.new(label, frame=frame)


def clear_pose(rig: bpy.types.Object) -> None:
    for pose_bone in rig.pose.bones:
        pose_bone.matrix_basis.identity()
    bpy.context.view_layer.update()


def aim_bone(
    rig: bpy.types.Object,
    bone_name: str,
    target_direction: tuple[float, float, float],
) -> None:
    pose_bone = rig.pose.bones.get(bone_name)
    if pose_bone is None:
        raise RuntimeError(f"Animation bone is missing: {bone_name}")
    pose_bone.rotation_mode = "QUATERNION"
    current_direction = (pose_bone.tail - pose_bone.head).normalized()
    desired_direction = Vector(target_direction).normalized()
    delta = current_direction.rotation_difference(desired_direction)
    pivot = Matrix.Translation(pose_bone.head)
    pose_bone.matrix = (
        pivot
        @ delta.to_matrix().to_4x4()
        @ pivot.inverted()
        @ pose_bone.matrix
    )
    bpy.context.view_layer.update()


def pose_rest(rig: bpy.types.Object) -> None:
    clear_pose(rig)
    for suffix, side_sign in (("l", 1.0), ("r", -1.0)):
        aim_bone(
            rig,
            f"upperarm_{suffix}",
            (0.070 * side_sign, -0.020, -1.0),
        )
        aim_bone(
            rig,
            f"lowerarm_{suffix}",
            (0.050 * side_sign, -0.070, -1.0),
        )
        aim_bone(
            rig,
            f"hand_{suffix}",
            (0.045 * side_sign, -0.050, -1.0),
        )


def pose_peak(rig: bpy.types.Object) -> None:
    clear_pose(rig)
    for suffix, side_sign in (("l", 1.0), ("r", -1.0)):
        aim_bone(
            rig,
            f"upperarm_{suffix}",
            (side_sign, -0.018, 0.010),
        )
        aim_bone(
            rig,
            f"lowerarm_{suffix}",
            (side_sign, -0.026, -0.030),
        )
        aim_bone(
            rig,
            f"hand_{suffix}",
            (side_sign, -0.018, -0.025),
        )


def key_pose(rig: bpy.types.Object, frame: int, peak: bool) -> None:
    bpy.context.scene.frame_set(frame)
    if peak:
        pose_peak(rig)
    else:
        pose_rest(rig)
    for bone_name in ANIMATED_BONES:
        pose_bone = rig.pose.bones[bone_name]
        pose_bone.keyframe_insert(
            data_path="rotation_quaternion",
            frame=frame,
            group="Bilateral arm raise",
        )


def animate_character(scene: bpy.types.Scene, rig: bpy.types.Object) -> None:
    old_action = rig.animation_data.action if rig.animation_data else None
    rig.animation_data_clear()
    if old_action is not None and old_action.users == 0:
        bpy.data.actions.remove(old_action)

    action = bpy.data.actions.get(ACTION_NAME)
    if action is not None and action.users == 0:
        bpy.data.actions.remove(action)
    action = bpy.data.actions.new(ACTION_NAME)
    rig.animation_data_create()
    rig.animation_data.action = action

    for frame, peak in (
        (FRAME_START, False),
        (FRAME_REST_END, False),
        (FRAME_PEAK, True),
        (FRAME_HOLD_END, True),
        (FRAME_RETURN, False),
        (FRAME_END, False),
    ):
        key_pose(rig, frame, peak)

    for fcurve in getattr(action, "fcurves", ()):
        for keyframe in fcurve.keyframe_points:
            keyframe.interpolation = "BEZIER"
            keyframe.handle_left_type = "AUTO_CLAMPED"
            keyframe.handle_right_type = "AUTO_CLAMPED"

    action["exercise_id"] = EXERCISE_ID
    action["movement"] = "bilateral shoulder abduction"
    action["target_abduction_degrees"] = 90.0
    scene.frame_set(FRAME_START)


def bone_direction(rig: bpy.types.Object, bone_name: str) -> Vector:
    pose_bone = rig.pose.bones[bone_name]
    return (pose_bone.tail - pose_bone.head).normalized()


def abduction_degrees(rig: bpy.types.Object, bone_name: str) -> float:
    down = Vector((0.0, 0.0, -1.0))
    dot = max(-1.0, min(1.0, bone_direction(rig, bone_name).dot(down)))
    return math.degrees(math.acos(dot))


def visible_character_bounds(
    collection: bpy.types.Collection,
) -> tuple[Vector, Vector]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points: list[Vector] = []
    for obj in collection.all_objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        evaluated = obj.evaluated_get(depsgraph)
        points.extend(evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box)
    if not points:
        raise RuntimeError("The character collection has no renderable meshes")
    minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
    return minimum, maximum


def validate_character(
    scene: bpy.types.Scene,
    collection: bpy.types.Collection,
    rig: bpy.types.Object,
) -> dict[str, float | int | str]:
    body = require_object(BODY_NAME, "MESH")
    required_assets = (
        "Maya_high_poly",
        "Maya_eyebrow001",
        "Maya_eyelashes01",
        "Maya_short03",
        "Maya_female_casualsuit01",
        "Maya_shoes05",
    )
    for name in required_assets:
        require_object(name, "MESH")
    for bone_name in ANIMATED_BONES:
        if rig.pose.bones.get(bone_name) is None:
            raise RuntimeError(f"Rig is missing required pose bone: {bone_name}")

    unpacked = [
        image.name
        for image in bpy.data.images
        if image.source == "FILE" and image.packed_file is None
    ]
    if unpacked:
        raise RuntimeError(
            "The editable source must keep all textures packed: "
            + ", ".join(unpacked)
        )

    scene.frame_set(FRAME_START)
    rest_left = abduction_degrees(rig, "upperarm_l")
    rest_right = abduction_degrees(rig, "upperarm_r")
    minimum, maximum = visible_character_bounds(collection)
    stature = maximum.z - minimum.z

    scene.frame_set(POSTER_FRAME)
    peak_left = abduction_degrees(rig, "upperarm_l")
    peak_right = abduction_degrees(rig, "upperarm_r")
    peak_minimum, peak_maximum = visible_character_bounds(collection)
    arm_span = peak_maximum.x - peak_minimum.x
    left_hand_vertical = abs(bone_direction(rig, "hand_l").z)
    right_hand_vertical = abs(bone_direction(rig, "hand_r").z)

    if not 1.68 <= stature <= 1.90:
        raise RuntimeError(f"Character stature left the adult range: {stature:.3f} m")
    if max(rest_left, rest_right) > 8.0:
        raise RuntimeError(
            f"Rest pose arms are too abducted: {rest_left:.2f}°, {rest_right:.2f}°"
        )
    if not 88.0 <= peak_left <= 92.0 or not 88.0 <= peak_right <= 92.0:
        raise RuntimeError(
            f"Peak pose is not at shoulder height: {peak_left:.2f}°, {peak_right:.2f}°"
        )
    if abs(peak_left - peak_right) > 0.5:
        raise RuntimeError("Peak pose is not bilaterally symmetric")
    if max(left_hand_vertical, right_hand_vertical) > 0.06:
        raise RuntimeError("Peak wrists are not aligned with the raised arms")
    if not 0.88 <= arm_span / stature <= 1.12:
        raise RuntimeError(
            f"Peak arm span is implausible for stature: {arm_span / stature:.3f}"
        )
    if len(rig.data.bones) < 50 or len(body.data.vertices) < 19000:
        raise RuntimeError("The detailed body or exercise rig was unexpectedly simplified")

    metrics: dict[str, float | int | str] = {
        "action": ACTION_NAME,
        "arm_span_m": round(arm_span, 3),
        "arm_span_to_stature": round(arm_span / stature, 3),
        "body_vertices": len(body.data.vertices),
        "character_meshes": sum(
            1 for obj in collection.all_objects if obj.type == "MESH"
        ),
        "peak_left_deg": round(peak_left, 2),
        "peak_right_deg": round(peak_right, 2),
        "rest_left_deg": round(rest_left, 2),
        "rest_right_deg": round(rest_right, 2),
        "rig_bones": len(rig.data.bones),
        "stature_m": round(stature, 3),
    }
    print("EX001_CHARACTER_VALIDATION=" + json.dumps(metrics, sort_keys=True), flush=True)
    scene.frame_set(FRAME_START)
    return metrics


def save_editable_source(path: Path) -> None:
    bpy.ops.file.pack_all()
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(path))


def downscale_images_for_web() -> None:
    """Keep the browser GLB compact without reducing the packed source quality."""
    detail_names = ("eye", "eyebrow", "eyelash", "teeth", "tongue")
    for image in bpy.data.images:
        if image.source != "FILE":
            continue
        maximum_dimension = 512 if any(
            token in image.name.lower() for token in detail_names
        ) else 1024
        width, height = image.size
        longest = max(width, height)
        if longest <= maximum_dimension:
            continue
        scale = maximum_dimension / longest
        target_width = max(1, round(width * scale))
        target_height = max(1, round(height * scale))
        print(
            f"Downscaling {image.name}: {width}x{height} -> "
            f"{target_width}x{target_height}",
            flush=True,
        )
        # Packed images load lazily in background mode. Reading one pixel makes
        # the in-memory buffer available without unpacking the source file.
        _ = image.pixels[0]
        image.scale(target_width, target_height)


def export_glb(
    scene: bpy.types.Scene,
    collection: bpy.types.Collection,
    rig: bpy.types.Object,
    output_path: Path,
) -> None:
    print(f"Exporting animated GLB: {output_path}", flush=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    downscale_images_for_web()
    bpy.ops.object.select_all(action="DESELECT")
    for obj in collection.all_objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    scene.frame_set(FRAME_START)
    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="SCENE",
        export_anim_scene_split_object=False,
        export_frame_range=True,
        export_force_sampling=False,
        export_optimize_animation_size=True,
        export_apply=True,
        export_materials="EXPORT",
        export_morph=False,
        export_yup=True,
    )


def render_still(scene: bpy.types.Scene, frame: int, output_path: Path) -> None:
    started = time.perf_counter()
    print(f"Rendering still frame {frame}: {output_path}", flush=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    scene.frame_set(frame)
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output_path)
    bpy.ops.render.render(write_still=True)
    print(
        f"Rendered frame {frame} in {time.perf_counter() - started:.1f}s",
        flush=True,
    )


def resolve_ffmpeg(explicit_path: Path | None) -> Path:
    candidates: list[Path] = []
    if explicit_path is not None:
        candidates.append(explicit_path.expanduser())
    path_match = shutil.which("ffmpeg")
    if path_match:
        candidates.append(Path(path_match))
    if sys.platform == "win32":
        candidates.extend(
            (
                Path(r"C:\Program Files\Jellyfin\Server\ffmpeg.exe"),
                Path(r"C:\Program Files\ffmpeg\bin\ffmpeg.exe"),
            )
        )
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.is_file():
            return resolved
    raise FileNotFoundError(
        "FFmpeg was not found. Install it or pass --ffmpeg after Blender's -- separator."
    )


def render_frame_sequence(scene: bpy.types.Scene, output_dir: Path) -> Path:
    print(f"Rendering {FRAME_END - FRAME_START + 1} animation frames", flush=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    scene.frame_set(FRAME_START)
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output_dir / "frame_")
    bpy.ops.render.render(animation=True)
    return output_dir / "frame_%04d.png"


def encode_video(
    ffmpeg_path: Path,
    input_pattern: Path,
    output_path: Path,
    codec_args: tuple[str, ...],
) -> None:
    print(f"Encoding video: {output_path}", flush=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = (
        str(ffmpeg_path),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-framerate",
        str(FPS),
        "-start_number",
        str(FRAME_START),
        "-i",
        str(input_pattern),
        "-frames:v",
        str(FRAME_END - FRAME_START + 1),
        "-an",
        *codec_args,
        str(output_path),
    )
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        error = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"FFmpeg failed while creating {output_path.name}:\n{error}")


def render_and_encode_videos(
    scene: bpy.types.Scene,
    ffmpeg_path: Path,
    public_dir: Path,
) -> tuple[Path, Path]:
    webm_path = public_dir / "ex_001-lateral-arm-raise.webm"
    mp4_path = public_dir / "ex_001-lateral-arm-raise.mp4"
    with tempfile.TemporaryDirectory(prefix="postural_ex001_frames_") as temp_dir:
        input_pattern = render_frame_sequence(scene, Path(temp_dir))
        encode_video(
            ffmpeg_path,
            input_pattern,
            webm_path,
            (
                "-c:v",
                "libvpx-vp9",
                "-crf",
                "31",
                "-b:v",
                "0",
                "-pix_fmt",
                "yuv420p",
                "-row-mt",
                "1",
            ),
        )
        encode_video(
            ffmpeg_path,
            input_pattern,
            mp4_path,
            (
                "-vf",
                "pad=ceil(iw/2)*2:ceil(ih/2)*2:color=0x0B1116",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "22",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
            ),
        )
    return webm_path, mp4_path


def main() -> None:
    args = parse_args()
    root = repo_root()
    blend_path = source_blend_path(root)
    preview_dir = root / "assets" / "blender" / "previews" / EXERCISE_ID
    public_dir = root / "web" / "public" / "demos"
    glb_path = public_dir / "ex_001-lateral-arm-raise.glb"
    poster_path = public_dir / "ex_001-lateral-arm-raise-poster.png"

    open_source_blend(blend_path)
    scene = bpy.context.scene
    collection = bpy.data.collections.get(CHARACTER_COLLECTION)
    if collection is None:
        raise RuntimeError(f"Required collection is missing: {CHARACTER_COLLECTION}")
    rig = require_object(RIG_NAME, "ARMATURE")

    configure_scene(scene)
    animate_character(scene, rig)
    validate_character(scene, collection, rig)

    outputs: list[Path] = []
    if not args.video_only and not args.export_only:
        save_editable_source(blend_path)
        export_glb(scene, collection, rig, glb_path)
        outputs.extend((blend_path, glb_path))
        for frame in PREVIEW_FRAMES:
            render_still(
                scene,
                frame,
                preview_dir / f"ex_001_frame_{frame:04d}.png",
            )
        shutil.copyfile(
            preview_dir / f"ex_001_frame_{POSTER_FRAME:04d}.png",
            poster_path,
        )
        outputs.append(poster_path)

    if args.export_only:
        export_glb(scene, collection, rig, glb_path)
        outputs.append(glb_path)

    if not args.skip_video and not args.export_only:
        ffmpeg_path = resolve_ffmpeg(args.ffmpeg)
        outputs.extend(render_and_encode_videos(scene, ffmpeg_path, public_dir))

    scene.frame_set(FRAME_START)
    print("EX001_DEMO_OUTPUTS", flush=True)
    for output in outputs:
        print(output, flush=True)
    print(
        f"EX001_DEMO_DURATION_SECONDS={(FRAME_END - FRAME_START + 1) / FPS:.2f}",
        flush=True,
    )


if __name__ == "__main__":
    main()
