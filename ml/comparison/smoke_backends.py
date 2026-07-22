"""
Plumbing check: instantiate every backend, run infer() on a blank frame, and
report load/inference status. Triggers and validates the first-run model
downloads (MediaPipe .task, MoveNet from TF-Hub, RTMPose/RTMW ONNX via rtmlib).

This is NOT a unit test — it needs network access and a real person in frame for
meaningful landmarks. It only confirms each backend loads and infer() runs
without error and returns the six expected keys. Run from ml/ with the
comparison venv:

  python -m comparison.smoke_backends
"""
from __future__ import annotations

import numpy as np

from comparison.landmark_map import NEEDED
from comparison.process_clips import ALL_BACKENDS, make_backend


def main() -> None:
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)  # blank; plumbing only
    for key in ALL_BACKENDS:
        try:
            backend = make_backend(key)
            lms = backend.infer(frame)
            n_points = sum(1 for v in lms.values() if v is not None)
            keys_ok = set(lms.keys()) == set(NEEDED)
            print(f"{key}: loaded OK, infer OK, keys_ok={keys_ok}, "
                  f"{n_points}/6 points on blank frame")
        except Exception as e:  # noqa: BLE001
            print(f"{key}: FAILED {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
