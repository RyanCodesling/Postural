"""
Anatomical-name <-> keypoint-index maps for each pose backend.

The comparison only needs six points — both ears, both shoulders, both hips —
because the two evaluated metrics (neck lateral flexion, scapular elevation)
depend on nothing else. Every supported backend provides all six.

Names follow MediaPipe's subject-left/right convention (the same one
web/src/lib/pose/poseMetrics.ts uses), so the ported metric math is identical
regardless of which backend produced the points. Front-camera mirroring is a
display concern handled downstream, exactly as in the live system.
"""
from __future__ import annotations

# The six anatomical points every backend must supply.
NEEDED = (
    "left_ear", "right_ear",
    "left_shoulder", "right_shoulder",
    "left_hip", "right_hip",
)

# MediaPipe Pose (33-landmark BlazePose).
MEDIAPIPE_33 = {
    "left_ear": 7, "right_ear": 8,
    "left_shoulder": 11, "right_shoulder": 12,
    "left_hip": 23, "right_hip": 24,
}

# COCO-17 (MoveNet, RTMPose body, YOLO-pose):
#   0 nose, 1 L-eye, 2 R-eye, 3 L-ear, 4 R-ear, 5 L-sh, 6 R-sh, 7 L-el, 8 R-el,
#   9 L-wr, 10 R-wr, 11 L-hip, 12 R-hip, 13 L-kn, 14 R-kn, 15 L-an, 16 R-an
COCO_17 = {
    "left_ear": 3, "right_ear": 4,
    "left_shoulder": 5, "right_shoulder": 6,
    "left_hip": 11, "right_hip": 12,
}

# COCO-WholeBody-133 (RTMW): the first 17 keypoints are the COCO body in the
# same order, so the body indices match COCO_17. Finer face/ear points exist at
# higher indices, but the comparison deliberately uses the SAME semantic ear
# keypoints across every backend — so any difference is precision on the same
# point, not a different definition of "ear". A face-point ear refinement is a
# possible follow-up, noted in record_guide / results, not done here.
RTMW_133 = dict(COCO_17)

LAYOUTS = {
    "mediapipe": MEDIAPIPE_33,
    "coco17": COCO_17,
    "rtmw133": RTMW_133,
}
