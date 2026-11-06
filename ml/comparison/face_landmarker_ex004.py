"""Targeted offline Face Landmarker screening for ex_004 recordings.

This is deliberately separate from the archived multi-backend pose comparison.
It asks a narrower engineering question: can Face Landmarker provide a stable,
signed head-roll signal under the full-body camera framing used by Postural,
and do its yaw/pitch components expose out-of-plane contamination?

Two inputs are measured:

* ``face_full_frame`` runs Face Landmarker on the unchanged video frame.
* ``face_pose_crop_smoothed`` runs it on one fixed square head crop initialized
  from the already-required Pose Landmarker ear points, with MediaPipe's
  documented single-face smoothing.
* ``face_pose_crop_unsmoothed`` uses the same frozen crop with ``num_faces=2``;
  MediaPipe documents that smoothing is only applied when ``num_faces=1``.

The existing pose ear-line metric is a concordance reference, not ground truth.
Generated reports stay in the gitignored comparison/out directory. No live app,
exercise threshold, persistence, or ML path is touched.

Run from ``Postural/ml`` with the isolated comparison environment::

    comparison/.venv/Scripts/python -m comparison.face_landmarker_ex004
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import pathlib
import platform
from dataclasses import dataclass
from time import perf_counter
from typing import Optional

import numpy as np

from comparison.backends.mediapipe_backend import MediaPipeBackend
from comparison.fetch_models import (FACE_LANDMARKER_URL,
                                     ensure_face_landmarker_model,
                                     ensure_models)
from comparison.metrics import Point, body_pair_angle_deg, pair_visible

HERE = pathlib.Path(__file__).resolve().parent
CLIPS_DIR = HERE / "clips" / "ex_004"
OUT_DIR = HERE / "out"
CLIP_NAMES = ("static_hold", "slow_reps", "normal_reps")
SIGNALS = (
    "pose_ear_line",
    "face_full_frame",
    "face_pose_crop_smoothed",
    "face_pose_crop_unsmoothed",
)
FACE_SIGNALS = SIGNALS[1:]
FACE_AXES = ("roll", "yaw", "pitch")
_WARMUP_FRAMES = 5
_MOTION_GATE_DEG = 10.0  # analysis-only neutral exclusion, not an exercise threshold


@dataclass(frozen=True)
class ClipResult:
    name: str
    path: pathlib.Path
    fps: float
    width: int
    height: int
    frame_count: int
    crop_xyxy: Optional[tuple[int, int, int, int]]
    series: dict[str, np.ndarray]
    face_axes: dict[str, dict[str, np.ndarray]]
    latencies: dict[str, np.ndarray]


@dataclass(frozen=True)
class FaceOrientation:
    roll_image_deg: float
    yaw_deg: float
    pitch_deg: float


def matrix_orientation_deg(matrix) -> Optional[FaceOrientation]:
    """Return roll/yaw/pitch components from a face transform.

    MediaPipe's top-left 3x3 block maps its canonical face into a metric,
    y-up camera space. SVD removes any small scale/shear component before the
    proper rotation is decomposed as Rz(roll) * Ry(yaw) * Rx(pitch). Negating
    only roll converts y-up rotation into Postural's y-down image convention.

    Yaw and pitch remain diagnostic matrix components, not anatomical cervical
    angles. The decomposition is rejected near the yaw gimbal singularity.
    """
    arr = np.asarray(matrix, dtype=float)
    if arr.shape != (4, 4) or not np.all(np.isfinite(arr)):
        return None
    block = arr[:3, :3]
    try:
        u, singular_values, vt = np.linalg.svd(block)
    except np.linalg.LinAlgError:
        return None
    if singular_values[-1] < 1e-9:
        return None
    rotation = u @ vt
    if np.linalg.det(rotation) < 0:
        u[:, -1] *= -1
        rotation = u @ vt
    cos_yaw = math.hypot(rotation[0, 0], rotation[1, 0])
    if cos_yaw < 1e-7:
        return None
    metric_roll_deg = math.degrees(math.atan2(rotation[1, 0], rotation[0, 0]))
    return FaceOrientation(
        roll_image_deg=-metric_roll_deg,
        yaw_deg=math.degrees(math.atan2(-rotation[2, 0], cos_yaw)),
        pitch_deg=math.degrees(math.atan2(rotation[2, 1], rotation[2, 2])),
    )


def matrix_roll_image_deg(matrix) -> Optional[float]:
    """Backward-compatible roll-only accessor used by the calibration tool."""
    orientation = matrix_orientation_deg(matrix)
    return orientation.roll_image_deg if orientation is not None else None


class FaceRollLandmarker:
    """Small IMAGE/VIDEO wrapper around the facial transformation matrix."""

    def __init__(
        self,
        model_path: pathlib.Path,
        *,
        num_faces: int = 1,
        running_mode: str = "VIDEO",
    ):
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python import vision

        self._mp = mp
        modes = {
            "IMAGE": vision.RunningMode.IMAGE,
            "VIDEO": vision.RunningMode.VIDEO,
        }
        normalized_mode = running_mode.upper()
        if normalized_mode not in modes:
            raise ValueError(f"unsupported running mode: {running_mode}")
        self._running_mode = normalized_mode
        options = vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(model_path)),
            running_mode=modes[normalized_mode],
            num_faces=num_faces,
            output_face_blendshapes=False,
            output_facial_transformation_matrixes=True,
        )
        self._landmarker = vision.FaceLandmarker.create_from_options(options)

    def infer_orientation(
        self,
        frame_bgr,
        timestamp_ms: Optional[int] = None,
    ) -> Optional[FaceOrientation]:
        import cv2

        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        rgb = np.ascontiguousarray(rgb)
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        if self._running_mode == "IMAGE":
            result = self._landmarker.detect(image)
        else:
            if timestamp_ms is None:
                raise ValueError("timestamp_ms is required in VIDEO mode")
            result = self._landmarker.detect_for_video(image, timestamp_ms)
        matrices = result.facial_transformation_matrixes
        # ``num_faces=2`` disables the documented single-face smoothing. Keep
        # the application's one-subject assumption explicit instead of
        # silently choosing an arbitrary face if another person enters frame.
        if len(matrices) != 1:
            return None
        return matrix_orientation_deg(matrices[0])

    def infer(self, frame_bgr, timestamp_ms: Optional[int] = None) -> Optional[float]:
        """Return roll only for compatibility with known-angle calibration."""
        orientation = self.infer_orientation(frame_bgr, timestamp_ms)
        return orientation.roll_image_deg if orientation is not None else None

    def close(self) -> None:
        self._landmarker.close()


def fixed_head_crop(
    left_ear: Optional[Point],
    right_ear: Optional[Point],
    frame_width: int,
    frame_height: int,
) -> Optional[tuple[int, int, int, int]]:
    """Build one generous square face crop from visible pose ear landmarks."""
    if not pair_visible(left_ear, right_ear):
        return None
    assert left_ear is not None and right_ear is not None
    lx, ly = left_ear.x * frame_width, left_ear.y * frame_height
    rx, ry = right_ear.x * frame_width, right_ear.y * frame_height
    ear_span = math.hypot(lx - rx, ly - ry)
    if ear_span < 2.0:
        return None

    min_dim = min(frame_width, frame_height)
    side = max(5.5 * ear_span, 0.22 * min_dim)
    side = min(side, 0.55 * min_dim)
    side_i = max(2, int(round(side)))
    center_x = (lx + rx) / 2.0
    center_y = (ly + ry) / 2.0 - 0.05 * side_i

    x0 = int(round(center_x - side_i / 2.0))
    y0 = int(round(center_y - side_i / 2.0))
    x0 = min(max(x0, 0), max(frame_width - side_i, 0))
    y0 = min(max(y0, 0), max(frame_height - side_i, 0))
    x1 = min(x0 + side_i, frame_width)
    y1 = min(y0 + side_i, frame_height)
    return x0, y0, x1, y1


def pose_ear_line_deg(landmarks: dict) -> Optional[float]:
    """Return the live metric's ear-line component before frozen correction.

    The current browser subtracts one neutral-calibration camera-tilt constant
    from every frame. This experiment later subtracts the static-clip median,
    which is equivalent for stability, shape, and concordance analysis while
    avoiding the archived harness's obsolete per-frame tilt switching.
    """
    left_ear = landmarks.get("left_ear")
    right_ear = landmarks.get("right_ear")
    if not pair_visible(left_ear, right_ear):
        return None
    assert left_ear is not None and right_ear is not None
    return body_pair_angle_deg(left_ear, right_ear)


def _finite(values: np.ndarray) -> np.ndarray:
    return values[np.isfinite(values)]


def _baseline(values: np.ndarray) -> Optional[float]:
    finite = _finite(values)
    return float(np.median(finite)) if finite.size else None


def _center(values: np.ndarray, baseline: Optional[float]) -> np.ndarray:
    return values - baseline if baseline is not None else values.copy()


def _series_summary(values: np.ndarray) -> dict:
    finite = _finite(values)
    total = int(values.size)
    if not finite.size:
        return {
            "frames": total,
            "detected_frames": 0,
            "coverage": 0.0,
            "mean_deg": None,
            "median_deg": None,
            "sd_deg": None,
            "robust_p2p_deg": None,
            "p95_abs_deg": None,
        }
    return {
        "frames": total,
        "detected_frames": int(finite.size),
        "coverage": float(finite.size / total) if total else 0.0,
        "mean_deg": float(np.mean(finite)),
        "median_deg": float(np.median(finite)),
        "sd_deg": float(np.std(finite, ddof=1)) if finite.size > 1 else 0.0,
        "robust_p2p_deg": float(np.percentile(finite, 95) - np.percentile(finite, 5)),
        "p95_abs_deg": float(np.percentile(np.abs(finite), 95)),
    }


def _latency_summary(values: np.ndarray) -> dict:
    finite = _finite(values)
    if finite.size > _WARMUP_FRAMES:
        finite = finite[_WARMUP_FRAMES:]
    if not finite.size:
        return {"n": 0, "mean_ms": None, "median_ms": None, "p95_ms": None,
                "fps_from_mean": None}
    mean_ms = float(np.mean(finite))
    return {
        "n": int(finite.size),
        "mean_ms": mean_ms,
        "median_ms": float(np.median(finite)),
        "p95_ms": float(np.percentile(finite, 95)),
        "fps_from_mean": 1000.0 / mean_ms if mean_ms > 0 else None,
    }


def _agreement(reference: np.ndarray, candidate: np.ndarray) -> dict:
    mask = np.isfinite(reference) & np.isfinite(candidate)
    x = reference[mask]
    y = candidate[mask]
    if x.size < 2:
        return {
            "overlap_frames": int(x.size),
            "pearson_r": None,
            "mae_deg": None,
            "median_delta_deg": None,
            "slope_candidate_per_pose": None,
            "motion_frames": 0,
            "motion_sign_agreement": None,
        }

    corr = None
    slope = None
    if float(np.std(x)) > 1e-9 and float(np.std(y)) > 1e-9:
        corr = float(np.corrcoef(x, y)[0, 1])
        slope = float(np.polyfit(x, y, 1)[0])
    motion = np.abs(x) >= _MOTION_GATE_DEG
    sign_agreement = None
    if np.any(motion):
        sign_agreement = float(np.mean(np.sign(x[motion]) == np.sign(y[motion])))
    return {
        "overlap_frames": int(x.size),
        "pearson_r": corr,
        "mae_deg": float(np.mean(np.abs(y - x))),
        "median_delta_deg": float(np.median(y - x)),
        "slope_candidate_per_pose": slope,
        "motion_frames": int(np.sum(motion)),
        "motion_sign_agreement": sign_agreement,
    }


def _roll_residual_axis_diagnostics(
    pose_roll: np.ndarray,
    face_roll: np.ndarray,
    face_yaw: np.ndarray,
    face_pitch: np.ndarray,
) -> dict:
    """Describe, but do not threshold, cross-axis association in saved clips."""
    mask = (
        np.isfinite(pose_roll)
        & np.isfinite(face_roll)
        & np.isfinite(face_yaw)
        & np.isfinite(face_pitch)
    )
    residual = face_roll[mask] - pose_roll[mask]
    yaw = face_yaw[mask]
    pitch = face_pitch[mask]
    if residual.size < 3:
        return {
            "overlap_frames": int(residual.size),
            "residual_vs_yaw_r": None,
            "residual_vs_pitch_r": None,
            "yaw_pitch_linear_r2": None,
        }

    def correlation(left: np.ndarray, right: np.ndarray) -> Optional[float]:
        if float(np.std(left)) <= 1e-9 or float(np.std(right)) <= 1e-9:
            return None
        return float(np.corrcoef(left, right)[0, 1])

    design = np.column_stack((np.ones(residual.size), yaw, pitch))
    try:
        fitted = design @ np.linalg.lstsq(design, residual, rcond=None)[0]
        total = float(np.sum((residual - np.mean(residual)) ** 2))
        unexplained = float(np.sum((residual - fitted) ** 2))
        linear_r2 = 1.0 - unexplained / total if total > 1e-12 else None
    except np.linalg.LinAlgError:
        linear_r2 = None
    return {
        "overlap_frames": int(residual.size),
        "residual_vs_yaw_r": correlation(residual, yaw),
        "residual_vs_pitch_r": correlation(residual, pitch),
        "yaw_pitch_linear_r2": linear_r2,
    }


def _timestamp_ms(frame_index: int, fps: float, previous: int) -> int:
    candidate = int(round(frame_index * 1000.0 / fps)) if fps > 0 else frame_index * 33
    return max(candidate, previous + 1)


def _append_orientation(
    values: dict[str, list],
    face_axes: dict[str, dict[str, list]],
    key: str,
    orientation: Optional[FaceOrientation],
) -> None:
    values[key].append(
        orientation.roll_image_deg if orientation is not None else None)
    face_axes[key]["roll"].append(
        orientation.roll_image_deg if orientation is not None else None)
    face_axes[key]["yaw"].append(
        orientation.yaw_deg if orientation is not None else None)
    face_axes[key]["pitch"].append(
        orientation.pitch_deg if orientation is not None else None)


def process_clip(
    name: str,
    model_path: pathlib.Path,
    pose_model_path: pathlib.Path,
    max_frames: Optional[int],
) -> ClipResult:
    import cv2

    path = CLIPS_DIR / f"{name}.mp4"
    if not path.exists():
        raise FileNotFoundError(path)
    cap = cv2.VideoCapture(str(path))
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    declared_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    pose = MediaPipeBackend(str(pose_model_path), "mediapipe_full")
    face_full = FaceRollLandmarker(model_path, num_faces=1)
    face_crop_smoothed = FaceRollLandmarker(model_path, num_faces=1)
    face_crop_unsmoothed = FaceRollLandmarker(model_path, num_faces=2)
    values = {key: [] for key in SIGNALS}
    face_axes = {
        key: {axis: [] for axis in FACE_AXES}
        for key in FACE_SIGNALS
    }
    latencies = {key: [] for key in SIGNALS}
    crop_xyxy = None
    previous_timestamp = -1
    frame_index = 0

    print(f"[{name}] {width}x{height} @ {fps:.3f} fps", flush=True)
    try:
        while True:
            if max_frames is not None and frame_index >= max_frames:
                break
            ok, frame = cap.read()
            if not ok:
                break
            timestamp_ms = _timestamp_ms(frame_index, fps, previous_timestamp)
            previous_timestamp = timestamp_ms

            started = perf_counter()
            landmarks = pose.infer(frame)
            latencies["pose_ear_line"].append((perf_counter() - started) * 1000.0)
            pose_value = pose_ear_line_deg(landmarks)
            values["pose_ear_line"].append(pose_value)

            if crop_xyxy is None:
                crop_xyxy = fixed_head_crop(
                    landmarks.get("left_ear"), landmarks.get("right_ear"), width, height)

            started = perf_counter()
            full_value = face_full.infer_orientation(frame, timestamp_ms)
            latencies["face_full_frame"].append((perf_counter() - started) * 1000.0)
            _append_orientation(values, face_axes, "face_full_frame", full_value)

            crop_smoothed_value = None
            crop_unsmoothed_value = None
            if crop_xyxy is not None:
                x0, y0, x1, y1 = crop_xyxy
                cropped = np.ascontiguousarray(frame[y0:y1, x0:x1])
                started = perf_counter()
                crop_smoothed_value = face_crop_smoothed.infer_orientation(
                    cropped, timestamp_ms)
                latencies["face_pose_crop_smoothed"].append(
                    (perf_counter() - started) * 1000.0)
                started = perf_counter()
                crop_unsmoothed_value = face_crop_unsmoothed.infer_orientation(
                    cropped, timestamp_ms)
                latencies["face_pose_crop_unsmoothed"].append(
                    (perf_counter() - started) * 1000.0)
            else:
                latencies["face_pose_crop_smoothed"].append(float("nan"))
                latencies["face_pose_crop_unsmoothed"].append(float("nan"))
            _append_orientation(
                values, face_axes, "face_pose_crop_smoothed", crop_smoothed_value)
            _append_orientation(
                values, face_axes, "face_pose_crop_unsmoothed", crop_unsmoothed_value)

            frame_index += 1
            if frame_index % 200 == 0:
                full_n = sum(v is not None for v in values["face_full_frame"])
                smooth_n = sum(v is not None for v in values["face_pose_crop_smoothed"])
                raw_n = sum(v is not None for v in values["face_pose_crop_unsmoothed"])
                print(
                    f"  {frame_index} frames: full {full_n / frame_index:.1%}, "
                    f"crop smooth {smooth_n / frame_index:.1%}, "
                    f"crop unsmoothed {raw_n / frame_index:.1%}", flush=True)
    finally:
        cap.release()
        face_full.close()
        face_crop_smoothed.close()
        face_crop_unsmoothed.close()

    frame_count = frame_index
    if max_frames is None and declared_frames and frame_count != declared_frames:
        print(f"  warning: decoded {frame_count}/{declared_frames} frames", flush=True)
    return ClipResult(
        name=name,
        path=path,
        fps=fps,
        width=width,
        height=height,
        frame_count=frame_count,
        crop_xyxy=crop_xyxy,
        series={key: np.asarray(values[key], dtype=float) for key in SIGNALS},
        face_axes={
            key: {
                axis: np.asarray(face_axes[key][axis], dtype=float)
                for axis in FACE_AXES
            }
            for key in FACE_SIGNALS
        },
        latencies={key: np.asarray(latencies[key], dtype=float) for key in SIGNALS},
    )


def _sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def analyze(clips: dict[str, ClipResult], model_path: pathlib.Path) -> tuple[dict, dict]:
    static = clips["static_hold"]
    baselines = {key: _baseline(static.series[key]) for key in SIGNALS}
    face_axis_baselines = {
        key: {
            axis: _baseline(static.face_axes[key][axis])
            for axis in FACE_AXES
        }
        for key in FACE_SIGNALS
    }
    centered = {
        clip_name: {
            key: _center(clip.series[key], baselines[key])
            for key in SIGNALS
        }
        for clip_name, clip in clips.items()
    }
    centered_face_axes = {
        clip_name: {
            key: {
                axis: _center(
                    clip.face_axes[key][axis],
                    face_axis_baselines[key][axis],
                )
                for axis in FACE_AXES
            }
            for key in FACE_SIGNALS
        }
        for clip_name, clip in clips.items()
    }

    clip_summaries = {}
    for clip_name, clip in clips.items():
        series = centered[clip_name]
        clip_summaries[clip_name] = {
            "path": str(clip.path),
            "fps": clip.fps,
            "resolution": [clip.width, clip.height],
            "frames": clip.frame_count,
            "duration_s": clip.frame_count / clip.fps if clip.fps else None,
            "pose_guided_crop_xyxy": list(clip.crop_xyxy) if clip.crop_xyxy else None,
            "signals": {key: _series_summary(series[key]) for key in SIGNALS},
            "face_axes": {
                key: {
                    axis: _series_summary(centered_face_axes[clip_name][key][axis])
                    for axis in FACE_AXES
                }
                for key in FACE_SIGNALS
            },
            "agreement_to_pose": {
                key: _agreement(series["pose_ear_line"], series[key])
                for key in FACE_SIGNALS
            },
            "roll_residual_axis_diagnostics": {
                key: _roll_residual_axis_diagnostics(
                    series["pose_ear_line"],
                    centered_face_axes[clip_name][key]["roll"],
                    centered_face_axes[clip_name][key]["yaw"],
                    centered_face_axes[clip_name][key]["pitch"],
                )
                for key in FACE_SIGNALS
            },
            "latency": {key: _latency_summary(clip.latencies[key]) for key in SIGNALS},
        }

    try:
        import mediapipe as mp
        mediapipe_version = mp.__version__
    except Exception:  # pragma: no cover - report metadata only
        mediapipe_version = None

    report = {
        "experiment": "face_landmarker_ex004_screening_v2",
        "scope": {
            "reference": (
                "neutral-centered Pose Landmarker full ear-line metric, equivalent to the current "
                "frozen-tilt path up to a constant; concordance reference, not ground truth"
            ),
            "face_signal": (
                "neutral-centered roll/yaw/pitch components from the Face Landmarker "
                "facial transformation matrix"
            ),
            "face_inputs": [
                "unchanged full frame with num_faces=1",
                "fixed pose-initialized square head crop with num_faces=1 smoothing",
                "same fixed crop with num_faces=2 so documented single-face smoothing is disabled",
            ],
            "motion_gate_deg": _MOTION_GATE_DEG,
            "limitations": [
                "historical unassisted ex_004 recordings, not the current assisted isometric protocol",
                "one subject and one camera setup",
                "no motion-capture or manual angle ground truth",
                "no dedicated yaw-only, pitch-only, hand-occlusion, or mirror test",
                "offline Python CPU throughput, not live browser GPU performance",
            ],
        },
        "provenance": {
            "python": platform.python_version(),
            "mediapipe": mediapipe_version,
            "face_model_path": str(model_path),
            "face_model_url": FACE_LANDMARKER_URL,
            "face_model_sha256": _sha256(model_path),
        },
        "neutral_baselines_deg": baselines,
        "neutral_face_axis_baselines_deg": face_axis_baselines,
        "clips": clip_summaries,
    }
    return report, centered


def _fmt(value, digits: int = 3, percent: bool = False) -> str:
    if value is None or not np.isfinite(value):
        return "n/a"
    if percent:
        return f"{value * 100:.1f}%"
    return f"{value:.{digits}f}"


def build_markdown(report: dict) -> str:
    clips = report["clips"]
    static = clips["static_hold"]
    lines = [
        "# Face Landmarker ex_004 screening",
        "",
        "This is a local, single-subject engineering screen. The Pose Landmarker "
        "ear-line signal is a concordance reference, not angle ground truth.",
        "",
        "## Neutral stability and coverage",
        "",
        "| Signal | Static coverage | Static SD | Static robust p2p | Mean CPU latency |",
        "|---|---:|---:|---:|---:|",
    ]
    for key in SIGNALS:
        signal = static["signals"][key]
        latency = static["latency"][key]
        lines.append(
            f"| `{key}` | {_fmt(signal['coverage'], percent=True)} | "
            f"{_fmt(signal['sd_deg'])} deg | {_fmt(signal['robust_p2p_deg'])} deg | "
            f"{_fmt(latency['mean_ms'], 1)} ms |"
        )

    lines.extend([
        "",
        "## Motion concordance with the pose ear line",
        "",
        f"Sign agreement excludes near-neutral pose frames below {_MOTION_GATE_DEG:.0f} degrees.",
        "",
        "| Clip | Face input | Coverage | Pearson r | MAE | Scale slope | Sign agreement |",
        "|---|---|---:|---:|---:|---:|---:|",
    ])
    for clip_name in ("slow_reps", "normal_reps"):
        clip = clips[clip_name]
        for key in FACE_SIGNALS:
            signal = clip["signals"][key]
            agreement = clip["agreement_to_pose"][key]
            lines.append(
                f"| `{clip_name}` | `{key}` | {_fmt(signal['coverage'], percent=True)} | "
                f"{_fmt(agreement['pearson_r'])} | {_fmt(agreement['mae_deg'])} deg | "
                f"{_fmt(agreement['slope_candidate_per_pose'])} | "
                f"{_fmt(agreement['motion_sign_agreement'], percent=True)} |"
            )

    lines.extend([
        "",
        "## Out-of-plane diagnostic components",
        "",
        "The live-equivalent unsmoothed crop now reports neutral-centered yaw and "
        "pitch. These historical clips were not phase-labeled yaw/pitch controls, so "
        "the associations below cannot define a validity threshold.",
        "",
        "| Clip | Yaw p95 abs | Pitch p95 abs | Roll residual vs yaw r | Roll residual vs pitch r | Linear R2 |",
        "|---|---:|---:|---:|---:|---:|",
    ])
    live_key = "face_pose_crop_unsmoothed"
    for clip_name in CLIP_NAMES:
        clip = clips[clip_name]
        axes = clip["face_axes"][live_key]
        diagnostic = clip["roll_residual_axis_diagnostics"][live_key]
        lines.append(
            f"| `{clip_name}` | {_fmt(axes['yaw']['p95_abs_deg'])} deg | "
            f"{_fmt(axes['pitch']['p95_abs_deg'])} deg | "
            f"{_fmt(diagnostic['residual_vs_yaw_r'])} | "
            f"{_fmt(diagnostic['residual_vs_pitch_r'])} | "
            f"{_fmt(diagnostic['yaw_pitch_linear_r2'])} |"
        )

    lines.extend([
        "",
        "## Interpretation boundary",
        "",
        "A candidate can pass this screen by detecting consistently, remaining stable at "
        "neutral, and tracking the direction and timing of the existing signal. It still "
        "cannot be called clinically accurate from these clips because neither signal has "
        "an independent angle reference.",
        "",
        "The pose-guided crop is fixed after its first valid pose frame. It tests whether "
        "the full-body framing makes the face too small without introducing per-frame crop jitter.",
        "",
        "## Provenance",
        "",
        f"- Experiment: `{report['experiment']}`",
        f"- MediaPipe: `{report['provenance']['mediapipe']}`",
        f"- Face model SHA-256: `{report['provenance']['face_model_sha256']}`",
        "- Generated outputs contain numerical metrics only; no video frames are copied.",
        "",
        "## Known limits",
        "",
    ])
    lines.extend(f"- {item}" for item in report["scope"]["limitations"])
    return "\n".join(lines) + "\n"


def write_plot(clips: dict[str, ClipResult], centered: dict[str, dict[str, np.ndarray]]) -> pathlib.Path:
    os.environ.setdefault("MPLCONFIGDIR", str(OUT_DIR / ".matplotlib"))
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(3, 1, figsize=(13, 9), constrained_layout=True)
    for axis, clip_name in zip(axes, CLIP_NAMES):
        clip = clips[clip_name]
        time_s = np.arange(clip.frame_count) / clip.fps
        for key in SIGNALS:
            axis.plot(time_s, centered[clip_name][key], label=key, linewidth=1.0)
        axis.axhline(0.0, color="black", linewidth=0.5)
        axis.set_title(clip_name)
        axis.set_ylabel("neutral-centered roll (deg)")
        axis.grid(alpha=0.25)
    axes[-1].set_xlabel("time (s)")
    axes[0].legend(loc="upper right", ncol=3)
    target = OUT_DIR / "face_landmarker_ex004.png"
    fig.savefig(target, dpi=150)
    plt.close(fig)
    return target


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Screen Face Landmarker roll/yaw/pitch on ex_004 clips.")
    parser.add_argument("--max-frames", type=int, default=None,
                        help="optional per-clip frame cap for a quick probe")
    parser.add_argument("--no-plot", action="store_true", help="skip the PNG signal plot")
    args = parser.parse_args()

    missing = [name for name in CLIP_NAMES if not (CLIPS_DIR / f"{name}.mp4").exists()]
    if missing:
        raise FileNotFoundError(f"missing ex_004 clips: {', '.join(missing)}")

    model_path = ensure_face_landmarker_model()
    pose_models = ensure_models()
    pose_model_path = pose_models / "pose_landmarker_full.task"
    clips = {
        name: process_clip(name, model_path, pose_model_path, args.max_frames)
        for name in CLIP_NAMES
    }
    report, centered = analyze(clips, model_path)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    json_path = OUT_DIR / "face_landmarker_ex004.json"
    md_path = OUT_DIR / "face_landmarker_ex004.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    md_path.write_text(build_markdown(report), encoding="utf-8")
    print(f"Wrote {json_path}")
    print(f"Wrote {md_path}")
    if not args.no_plot:
        print(f"Wrote {write_plot(clips, centered)}")
    print("\n" + build_markdown(report))


if __name__ == "__main__":
    main()
