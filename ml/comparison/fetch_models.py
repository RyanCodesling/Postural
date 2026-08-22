"""
Download MediaPipe task bundles into comparison/models/.

The historical pose comparison uses ``ensure_models()`` for the full and heavy
Pose Landmarker bundles. The targeted ex_004 face-roll probe separately calls
``ensure_face_landmarker_model()`` so reproducing the archived pose benchmark
does not acquire an unrelated model.
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

FACE_LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/latest/face_landmarker.task"
)


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


def ensure_face_landmarker_model() -> pathlib.Path:
    """Return the official Face Landmarker task bundle, downloading if absent."""
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    dest = MODELS_DIR / "face_landmarker.task"
    if dest.exists():
        print(f"  have {dest.name} ({dest.stat().st_size // 1024} KB)")
        return dest

    partial = dest.with_suffix(".task.part")
    print(f"  downloading {dest.name} ...")
    try:
        urllib.request.urlretrieve(FACE_LANDMARKER_URL, partial)
        partial.replace(dest)
    finally:
        if partial.exists():
            partial.unlink()
    print(f"  saved {dest.name} ({dest.stat().st_size // 1024} KB)")
    return dest


if __name__ == "__main__":
    ensure_models()
