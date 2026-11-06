"""Encode and validate any complete exercise-draft PNG sequence.

Requires ordinary Python with Pillow, FFmpeg and FFprobe. Timeline length and
resolution come from the renderer's manifest, rather than one exercise's timing.
"""
import argparse
import hashlib
import json
import subprocess
from fractions import Fraction
from pathlib import Path

from PIL import Image, ImageChops, ImageStat


def run(command):
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--frames-dir", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--qa-dir", type=Path, required=True)
    p.add_argument("--ffmpeg", default="ffmpeg")
    p.add_argument("--ffprobe", default="ffprobe")
    args = p.parse_args()
    manifest = json.loads((args.frames_dir / "render_manifest.json").read_text())
    frames, fps = manifest["frames"], manifest["fps"]
    count = len(frames)
    if count < 2 or frames != list(range(1, count + 1)) or not fps > 0:
        raise RuntimeError("A complete contiguous timeline with positive fps is required")
    if not all((args.frames_dir / f"frame_{i:04d}.png").is_file() for i in frames):
        raise RuntimeError("A source frame is missing")
    if args.output.exists() or args.qa_dir.exists():
        raise RuntimeError("Use fresh output and QA destinations")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.qa_dir.mkdir(parents=True)
    pending = args.output.with_name(args.output.stem + ".pending.mp4")
    if pending.exists():
        raise RuntimeError("A pending encode already exists")
    run([args.ffmpeg, "-v", "error", "-n", "-framerate", str(fps), "-start_number", "1",
         "-i", str(args.frames_dir / "frame_%04d.png"), "-frames:v", str(count),
         "-vf", "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p",
         "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-colorspace", "bt709",
         "-color_primaries", "bt709", "-color_trc", "iec61966-2-1", "-movflags", "+faststart", str(pending)])
    info = json.loads(run([args.ffprobe, "-v", "error", "-count_frames", "-show_streams",
                           "-show_format", "-of", "json", str(pending)]))
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    if (int(video["nb_read_frames"]) != count or float(Fraction(video["r_frame_rate"])) != fps
            or abs(float(video["duration"]) - count/fps) > .0001
            or [video["width"], video["height"]] != manifest["resolution"]):
        raise RuntimeError("Encoded timeline or dimensions do not match the render")
    run([args.ffmpeg, "-v", "error", "-xerror", "-i", str(pending), "-f", "null", "-"])
    selected = sorted({1, count, *(1 + round((count-1)*i/6) for i in range(1, 6))})
    expression = "+".join(f"eq(n\\,{f-1})" for f in selected)
    readback_filter = ("select=" + expression + ",scale=in_color_matrix=bt709:in_range=tv:out_range=pc:"
                       "flags=accurate_rnd+full_chroma_int,format=rgb24")
    run([args.ffmpeg, "-v", "error", "-n", "-i", str(pending), "-vf", readback_filter,
         "-fps_mode", "vfr", str(args.qa_dir / "decoded_%02d.png")])
    comparisons = []
    for index, frame in enumerate(selected, 1):
        source = Image.open(args.frames_dir / f"frame_{frame:04d}.png").convert("RGB")
        decoded = Image.open(args.qa_dir / f"decoded_{index:02d}.png").convert("RGB")
        drift = [b-a for a, b in zip(ImageStat.Stat(source).mean, ImageStat.Stat(decoded).mean)]
        error = ImageStat.Stat(ImageChops.difference(source, decoded)).mean
        if max(abs(v) for v in drift) > 1 or max(error) > 3:
            raise RuntimeError(f"Unexpected image/colour change at frame {frame}: {drift}, {error}")
        comparisons.append({"frame": frame, "signed_rgb_drift": drift, "mean_absolute_rgb_error": error})
    content = pending.read_bytes()
    offset, atoms = 0, []
    while offset + 8 <= len(content):
        size = int.from_bytes(content[offset:offset+4], "big")
        kind = content[offset+4:offset+8].decode("ascii")
        if size == 1:
            size = int.from_bytes(content[offset+8:offset+16], "big")
        if size == 0:
            size = len(content)-offset
        if size < 8 or offset + size > len(content):
            raise RuntimeError("Invalid MP4 atom")
        atoms.append(kind)
        offset += size
    if atoms.index("moov") > atoms.index("mdat"):
        raise RuntimeError("Video does not contain faststart metadata")
    report = {"video_file": args.output.name, "sha256": hashlib.sha256(content).hexdigest(),
              "source_blend_sha256": manifest["source_sha256"], "frames_decoded": count,
              "fps": fps, "seconds": count/fps, "resolution": manifest["resolution"],
              "atom_order": atoms, "pixel_comparisons": comparisons,
              "colour_conversion": "BT.709 matrix, sRGB transfer, accurate rounding"}
    pending.replace(args.output)
    (args.qa_dir / "video_validation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
