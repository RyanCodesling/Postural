"""
RTMPose-m (COCO-17 body) and RTMW (COCO-WholeBody-133) adapters via rtmlib.

rtmlib's Body/Wholebody run a heavy YOLOX person-detector on EVERY frame, which
dominates CPU cost and is wasted here — the subject stands in place. We instead
wrap the same models in rtmlib's PoseTracker with a low detection frequency: it
runs the detector once every `det_frequency` frames and re-derives the person box
from the previous frame's keypoints in between. PoseTracker applies NO temporal
smoothing to the keypoints (verified in its source), so the measured noise floor
is unchanged — only the redundant per-frame detection is removed.

Returns keypoints as PIXEL coordinates + per-keypoint scores; we normalize by
frame width/height to match the shared convention. For RTMW the first 17
keypoints are the COCO body in the same order, so the body ear/shoulder/hip
indices match COCO-17 (see landmark_map.RTMW_133).
"""
from __future__ import annotations

from comparison.backends.base import empty_frame
from comparison.metrics import Point


class RTMLibBackend:
    def __init__(self, kind: str, name: str, layout: dict, det_frequency: int = 30):
        from rtmlib import Body, PoseTracker, Wholebody

        Solution = Body if kind == "body" else Wholebody
        # mode "balanced" selects RTMPose-m (body) / RTMW (wholebody).
        self._model = PoseTracker(
            Solution, det_frequency=det_frequency, tracking=True,
            mode="balanced", backend="onnxruntime", device="cpu")
        self.name = name
        self._layout = layout

    def infer(self, frame_bgr) -> dict:
        h, w = frame_bgr.shape[:2]
        keypoints, scores = self._model(frame_bgr)
        if keypoints is None or len(keypoints) == 0:
            return empty_frame()
        kp = keypoints[0]   # (K, 2) pixel coords
        sc = scores[0]      # (K,)
        out = {}
        for name, idx in self._layout.items():
            x, y = kp[idx]
            out[name] = Point(float(x) / w, float(y) / h, float(sc[idx]))
        return out
