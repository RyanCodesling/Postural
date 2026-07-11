"""
Download the MediaPipe Pose Landmarker model files (full + heavy) into
comparison/models/. RTMPose/RTMW (rtmlib) and MoveNet (TF-Hub) fetch their own
weights on first use, so they are not handled here.
"""
from __future__ import annotations

import pathlib
import urllib.request

MODELS_DIR = pathlib.Path(__file__).resolve().parent / "models"

_BASE = "https://storage.googleapis.com/mediapipe-models/pose_landmarker"
URLS = {
    "pose_landmarker_full.task": f"{_BASE}/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
    "pose_landmarker_heavy.task": f"{_BASE}/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task",
}


def ensure_models() -> pathlib.Path:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for filename, url in URLS.items():
        dest = MODELS_DIR / filename
        if dest.exists():
            print(f"  have {filename} ({dest.stat().st_size // 1024} KB)")
            continue
        print(f"  downloading {filename} ...")
        urllib.request.urlretrieve(url, dest)
        print(f"  saved {filename} ({dest.stat().st_size // 1024} KB)")
    return MODELS_DIR


if __name__ == "__main__":
    ensure_models()
