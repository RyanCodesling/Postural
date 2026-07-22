"""
MediaPipe Pose Landmarker adapter (full and heavy variants).

Same 33-landmark BlazePose model the live app runs, so its output needs no
remapping beyond index -> anatomical name. Loaded in VIDEO running mode with a
monotonic timestamp, matching the app's `runningMode: "VIDEO"`. Instantiate once
per model path to compare full vs heavy.
"""
from __future__ import annotations

from comparison.backends.base import empty_frame
from comparison.landmark_map import MEDIAPIPE_33
from comparison.metrics import Point

_FRAME_DT_MS = 33  # ~30 fps monotonic clock for VIDEO mode


class MediaPipeBackend:
    def __init__(self, model_path: str, name: str):
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python import vision

        self._mp = mp
        options = vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model_path),
            running_mode=vision.RunningMode.VIDEO,
            num_poses=1,
        )
        self._landmarker = vision.PoseLandmarker.create_from_options(options)
        self.name = name
        self._t_ms = 0

    def infer(self, frame_bgr) -> dict:
        import cv2

        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        mp_image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        self._t_ms += _FRAME_DT_MS
        result = self._landmarker.detect_for_video(mp_image, self._t_ms)

        if not result.pose_landmarks:
            return empty_frame()
        lms = result.pose_landmarks[0]  # 33 NormalizedLandmark (x, y already in [0,1])
        out = {}
        for name, idx in MEDIAPIPE_33.items():
            lm = lms[idx]
            out[name] = Point(float(lm.x), float(lm.y), float(getattr(lm, "visibility", 1.0)))
        return out
