"""Render the saved MPFB presentation to fresh PNG frames, without saving it.

Use --frames for a visual checkpoint. Omit --frames for the complete loop.
The output directory must not already contain any requested frame; this avoids
mistaking stale images for a successful render after a Blender Python error.
Always launch Blender with --python-exit-code 1.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", required=True, type=Path)
    p.add_argument("--output-dir", required=True, type=Path)
    p.add_argument("--frames", nargs="+", type=int)
    p.add_argument("--samples", type=int, default=64)
    args = p.parse_args(sys.argv[sys.argv.index("--") + 1:])
    bpy.ops.wm.open_mainfile(filepath=str(args.source.resolve()))
    scene = bpy.context.scene
    frames = args.frames or list(range(scene.frame_start, scene.frame_end + 1))
    if len(set(frames)) != len(frames) or any(f < scene.frame_start or f > scene.frame_end for f in frames):
        p.error("Frames must be unique and within the saved scene's range")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    targets = [args.output_dir / f"frame_{f:04d}.png" for f in frames]
    if any(path.exists() for path in targets):
        raise RuntimeError("Output frames already exist; use a fresh output directory")
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = args.samples
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.use_border = scene.render.use_crop_to_border = False
    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    for frame, path in zip(frames, targets):
        scene.frame_set(frame)
        scene.render.filepath = str(path.resolve())
        bpy.ops.render.render(write_still=True)
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"Missing rendered frame: {frame}")
        print(f"MPFB_FRAME={frame}/{scene.frame_end}", flush=True)
    if hashlib.sha256(args.source.read_bytes()).hexdigest() != source_hash:
        raise RuntimeError("Source blend changed while rendering")
    report = {"source_file": args.source.name, "source_sha256": source_hash,
              "figure_revision": scene.get("figure_revision"),
              "frames": frames, "fps": scene.render.fps / scene.render.fps_base,
              "resolution": [scene.render.resolution_x, scene.render.resolution_y],
              "view_transform": scene.view_settings.view_transform,
              "samples": args.samples}
    (args.output_dir / "render_manifest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("MPFB_RENDER=" + json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
