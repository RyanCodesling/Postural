"""Render a saved exercise draft at a chosen review resolution.

Only bit-identical rig matrices with identical visible text are reused. The
manifest distinguishes rendered frames from copies of static/duplicate poses.
The source scene is never saved. Use a fresh output directory for every run.
"""
import argparse
import hashlib
import json
import shutil
import struct
import sys
from pathlib import Path

import bpy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--frames", nargs="+", type=int)
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--scale", type=float, default=.6)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    if not 0 < args.scale <= 1 or args.samples < 1:
        parser.error("Scale must be in (0,1], and samples must be positive")
    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(args.source.resolve()))
    scene = bpy.context.scene
    frames = args.frames or list(range(scene.frame_start, scene.frame_end + 1))
    if len(set(frames)) != len(frames) or any(f < scene.frame_start or f > scene.frame_end for f in frames):
        parser.error("Requested frames must be unique and within the saved timeline")
    if args.output_dir.exists():
        parser.error("Use a fresh output directory")
    args.output_dir.mkdir(parents=True)
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = args.samples
    # Preserve the exact saved camera aspect, including when rounding to even
    # dimensions. The default .6 gives exactly 522 x 588 pixels.
    saved_ratio = scene.render.resolution_x / scene.render.resolution_y
    scene.render.resolution_x = int(scene.render.resolution_x * args.scale) // 2 * 2
    scene.render.resolution_y = int(scene.render.resolution_y * args.scale) // 2 * 2
    if min(scene.render.resolution_x, scene.render.resolution_y) < 2:
        parser.error("Output dimensions are too small")
    scene.render.pixel_aspect_x = saved_ratio / (scene.render.resolution_x / scene.render.resolution_y)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.use_border = scene.render.use_crop_to_border = False
    cache, reused, rendered = {}, {}, []
    rig = scene.objects["Figure_Rig"]
    for frame in frames:
        scene.frame_set(frame)
        signature = hashlib.sha256()
        # Timeline markers can switch cameras (wall angels alternate views),
        # so the active camera is part of what makes two frames identical.
        signature.update(scene.camera.name.encode() + b"\0")
        for pb in rig.pose.bones:
            signature.update(struct.pack("16f", *(v for row in pb.matrix for v in row)))
        for obj in sorted((o for o in scene.objects if o.type == "FONT"), key=lambda o: o.name):
            if not obj.hide_render:
                signature.update(obj.name.encode() + b"\0" + obj.data.body.encode() + b"\0")
        key = signature.hexdigest()
        path = args.output_dir / f"frame_{frame:04d}.png"
        if key in cache:
            shutil.copyfile(args.output_dir / f"frame_{cache[key]:04d}.png", path)
            reused[str(frame)] = cache[key]
        else:
            scene.render.filepath = str(path.resolve())
            bpy.ops.render.render(write_still=True)
            cache[key] = frame
            rendered.append(frame)
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"Missing frame {frame}")
        print(f"DRAFT_RENDER_FRAME={frame}/{scene.frame_end}", flush=True)
    if hashlib.sha256(args.source.read_bytes()).hexdigest() != source_hash:
        raise RuntimeError("Source changed during rendering")
    manifest = {"source_file": args.source.name, "source_sha256": source_hash,
                "frames": frames, "fps": scene.render.fps / scene.render.fps_base,
                "resolution": [scene.render.resolution_x, scene.render.resolution_y],
                "samples": args.samples, "view_transform": scene.view_settings.view_transform,
                "rendered_frames": rendered, "reused_frames": reused,
                "reuse_method": "Bit-identical rig pose matrices and visible text; no simulation or temporal effects."}
    (args.output_dir / "render_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("DRAFT_RENDER_COMPLETE=" + json.dumps({k: v for k, v in manifest.items()
                                               if k not in ["frames", "rendered_frames", "reused_frames"]}), flush=True)


if __name__ == "__main__":
    main()
