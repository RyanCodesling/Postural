"""Pose-backend adapters.

Each adapter maps one backend's raw keypoints onto the six anatomical points the
metrics need, in MediaPipe's normalized convention (see base.py). Heavy
libraries are imported lazily inside each adapter so a missing/optional backend
never blocks the others.
"""
