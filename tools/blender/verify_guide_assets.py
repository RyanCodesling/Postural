"""Verify the published guide sources, hashes, tool imports and optional video decoding.

Run from any directory with ordinary Python. FFmpeg and FFprobe are optional;
when supplied together, every accepted clip is probed and fully decoded.
"""
from __future__ import annotations

import argparse
import ast
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ffmpeg")
    parser.add_argument("--ffprobe")
    args = parser.parse_args()
    if bool(args.ffmpeg) != bool(args.ffprobe):
        parser.error("Supply both --ffmpeg and --ffprobe, or neither")
    root = Path(__file__).resolve().parents[2]
    manifest = json.loads((root / "assets/blender/reference/guide_assets.json").read_text(encoding="utf-8"))
    assert manifest["schema_version"] == 1
    expected_ids = {"ex_001", "ex_004", "ex_005", "ex_006", "ex_007", "ex_008"}
    assert set(manifest["clips"]) == expected_ids, "Unexpected exercise guide set"
    files = {}
    for record in manifest["files"]:
        relative = Path(record["path"])
        path = root / relative
        assert not relative.is_absolute() and path.resolve().is_relative_to(root), "Nonportable manifest path"
        assert record["path"] not in files, "Duplicate manifest entry"
        assert path.is_file(), f"Missing asset: {record['path']}"
        data = path.read_bytes()
        assert len(data) == record["bytes"], f"Wrong length: {record['path']}"
        assert hashlib.sha256(data).hexdigest() == record["sha256"], f"Wrong SHA-256: {record['path']}"
        files[record["path"]] = record
    tools = Path(__file__).resolve().parent
    modules = {path.stem for path in tools.glob("*.py")}
    for path in tools.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
        for node in ast.walk(tree):
            names = ([node.module] if isinstance(node, ast.ImportFrom) else
                     [alias.name for alias in node.names] if isinstance(node, ast.Import) else [])
            for name in names:
                if name and name.startswith(("build_ex001_", "build_mpfb_", "inspect_ex001_", "mpfb_",
                                             "polish_mpfb_", "upgrade_mpfb_", "refine_mpfb_")):
                    assert name.split(".")[0] in modules, f"Missing local import {name} in {path.name}"
    player = (root / "web/src/lib/exercises/demoClips.ts").read_text(encoding="utf-8")
    videos = []
    for exercise, clip in manifest["clips"].items():
        assert clip["scene"] in files and files[clip["scene"]]["role"] == "editable-scene"
        assert clip["video"] in files and files[clip["video"]]["role"] == "accepted-guide-video"
        url = "/" + Path(clip["video"]).relative_to("web/public").as_posix()
        assert f'src: "{url}"' in player, f"Player does not use {url}"
        if args.ffprobe:
            video = root / clip["video"]
            probe = json.loads(subprocess.check_output([args.ffprobe, "-v", "error", "-count_frames",
                "-show_streams", "-show_format", "-of", "json", str(video)], text=True))
            streams = probe["streams"]
            assert len(streams) == 1 and streams[0]["codec_type"] == "video", exercise
            stream = streams[0]
            assert stream["codec_name"] == "h264" and stream["pix_fmt"] == "yuv420p", exercise
            assert [stream["width"], stream["height"]] == clip["resolution"], exercise
            assert Fraction(stream["avg_frame_rate"]) == clip["fps"], exercise
            assert int(stream["nb_read_frames"]) == clip["frames"], exercise
            assert abs(float(probe["format"]["duration"]) - clip["frames"] / clip["fps"]) < .04, exercise
            subprocess.run([args.ffmpeg, "-v", "error", "-xerror", "-i", str(video), "-f", "null", "-"], check=True)
            videos.append({"exercise": exercise, "frames": int(stream["nb_read_frames"]), "fully_decoded": True})
    print(json.dumps({"verified_files": len(files), "verified_bytes": sum(r["bytes"] for r in files.values()),
                      "python_modules_parsed": len(modules), "guide_count": len(manifest["clips"]),
                      "video_decoding": videos if args.ffmpeg else "Not requested; hashes verified only"}, indent=2))


if __name__ == "__main__":
    main()
