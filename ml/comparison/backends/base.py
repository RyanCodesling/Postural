"""
Backend protocol + shared helpers for the pose-comparison adapters.

Every adapter takes a BGR frame (OpenCV) and returns a name-keyed Landmarks dict
in MediaPipe's NORMALIZED convention: x divided by frame width, y by frame
height, both in [0, 1], y increasing downward. Angles are then computed in that
same anisotropic normalized space, exactly as the live system does
(web/src/lib/pose/poseMetrics.ts does NOT aspect-correct), so the comparison
matches what the app would compute from the same landmarks.

Confidence handling: MediaPipe exposes per-landmark `visibility`; MoveNet and
the RTM models expose a per-keypoint score. All are passed through as `vis` in
[0, 1] and gated downstream by metrics.MIN_VIS. On the clean, fully-visible
frontal clips used here, scores sit well above the gate; the threshold mainly
guards dropped/occluded frames.
"""
from __future__ import annotations

from typing import Protocol

from comparison.landmark_map import NEEDED


class Backend(Protocol):
    name: str

    def infer(self, frame_bgr) -> dict:
        """Return {anatomical_name: Point | None}, normalized to [0, 1]."""
        ...


def empty_frame() -> dict:
    """A frame with no usable detection — every point missing."""
    return {n: None for n in NEEDED}
