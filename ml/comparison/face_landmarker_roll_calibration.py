"""Known-angle image-roll calibration for the ex_004 Face candidate.

The saved neutral ex_004 clip has no physical angle reference. This script adds
an exact *image-plane* reference without asking the participant to repeat the
exercise: it freezes the same Pose-initialized square head crop used by
``face_landmarker_ex004.py``, rotates that crop by known angles, and measures
the resulting Face Landmarker transformation-matrix roll.

Two complementary checks are emitted:

* Independent IMAGE-mode samples across several neutral frames estimate scale,
  bias, error, and detection coverage without temporal tracking.
* A smooth VIDEO-mode sweep from 0 -> +50 -> -50 -> 0 degrees measures tracking
  behavior and lag with single-face smoothing enabled and disabled.

This calibrates the roll extraction and model response to controlled 2D image
rotation. It does not establish anatomical cervical-angle accuracy, yaw/pitch
cross-axis rejection, or assisted-hand occlusion performance.

Run from ``Postural/ml``::

    comparison/.venv/Scripts/python -m comparison.face_landmarker_roll_calibration
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import pathlib
import platform
from typing import Optional

import numpy as np

from comparison.backends.mediapipe_backend import MediaPipeBackend
from comparison.face_landmarker_ex004 import (CLIPS_DIR, OUT_DIR,
                                               FaceRollLandmarker,
                                               fixed_head_crop)
from comparison.fetch_models import (FACE_LANDMARKER_URL,
                                     ensure_face_landmarker_model,
                                     ensure_models)

DEFAULT_ANGLES_DEG = (-50.0, -40.0, -30.0, -20.0, -10.0, -5.0,
                      0.0, 5.0, 10.0, 20.0, 30.0, 40.0, 50.0)
VIDEO_STEP_MS = 50  # 20 fps, close to the recorded clips


def angle_diff_deg(value: float, reference: float) -> float:
    """Signed ``value - reference`` normalized to [-180, 180]."""
    delta = value - reference
    while delta > 180.0:
        delta -= 360.0
    while delta < -180.0:
        delta += 360.0
    return delta


def rotation_matrix_for_image_roll(
    width: int,
    height: int,
    image_roll_deg: float,
) -> np.ndarray:
    """OpenCV affine matrix that injects Postural y-down image roll.

    OpenCV's positive argument is counter-clockwise in its documented
    convention, while Postural reads line angle with y increasing downward.
    Negating the requested image roll makes the transformed x-axis carry the
    requested signed y-down angle.
    """
    import cv2

    center = ((width - 1) / 2.0, (height - 1) / 2.0)
    return cv2.getRotationMatrix2D(center, -image_roll_deg, 1.0)


def rotate_crop_for_image_roll(image_bgr, image_roll_deg: float):
    import cv2

    height, width = image_bgr.shape[:2]
    matrix = rotation_matrix_for_image_roll(width, height, image_roll_deg)
    return cv2.warpAffine(
        image_bgr,
        matrix,
        (width, height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT_101,
    )


def summarize_records(records: list[dict]) -> dict:
    """Summarize detected calibration records; angle zero is excluded."""
    nonzero = [row for row in records if abs(row["injected_deg"]) > 1e-9]
    detected = [row for row in nonzero if row["predicted_delta_deg"] is not None]
    total = len(nonzero)
    if not detected:
        return {
            "samples": total,
            "detected_samples": 0,
            "coverage": 0.0,
            "mean_error_deg": None,
            "mae_deg": None,
            "rmse_deg": None,
            "p95_abs_error_deg": None,
            "slope": None,
            "intercept_deg": None,
            "pearson_r": None,
        }

    expected = np.asarray([row["injected_deg"] for row in detected], dtype=float)
    predicted = np.asarray([row["predicted_delta_deg"] for row in detected], dtype=float)
    errors = predicted - expected
    slope = intercept = corr = None
    if expected.size >= 2 and np.std(expected) > 1e-12 and np.std(predicted) > 1e-12:
        slope_value, intercept_value = np.polyfit(expected, predicted, 1)
        slope = float(slope_value)
        intercept = float(intercept_value)
        corr = float(np.corrcoef(expected, predicted)[0, 1])
    return {
        "samples": total,
        "detected_samples": len(detected),
        "coverage": len(detected) / total if total else 0.0,
        "mean_error_deg": float(np.mean(errors)),
        "mae_deg": float(np.mean(np.abs(errors))),
        "rmse_deg": float(np.sqrt(np.mean(errors ** 2))),
        "p95_abs_error_deg": float(np.percentile(np.abs(errors), 95)),
        "slope": slope,
        "intercept_deg": intercept,
        "pearson_r": corr,
    }


def summarize_by_angle(records: list[dict], angles: tuple[float, ...]) -> list[dict]:
    rows = []
    for angle in angles:
        matches = [row for row in records if row["injected_deg"] == angle]
        detected = [row for row in matches if row["predicted_delta_deg"] is not None]
        if not detected:
            rows.append({
                "injected_deg": angle,
                "samples": len(matches),
                "detected_samples": 0,
                "coverage": 0.0,
                "mean_predicted_deg": None,
                "sd_predicted_deg": None,
                "mean_error_deg": None,
                "mae_deg": None,
                "p95_abs_error_deg": None,
            })
            continue
        predicted = np.asarray(
            [row["predicted_delta_deg"] for row in detected], dtype=float)
        errors = predicted - angle
        rows.append({
            "injected_deg": angle,
            "samples": len(matches),
            "detected_samples": len(detected),
            "coverage": len(detected) / len(matches) if matches else 0.0,
            "mean_predicted_deg": float(np.mean(predicted)),
            "sd_predicted_deg": (
                float(np.std(predicted, ddof=1)) if predicted.size > 1 else 0.0),
            "mean_error_deg": float(np.mean(errors)),
            "mae_deg": float(np.mean(np.abs(errors))),
            "p95_abs_error_deg": float(np.percentile(np.abs(errors), 95)),
        })
    return rows


def _lagged_pairs(
    expected: np.ndarray,
    predicted: np.ndarray,
    lag_frames: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Align arrays where positive lag means the prediction follows input."""
    if lag_frames > 0:
        return expected[:-lag_frames], predicted[lag_frames:]
    if lag_frames < 0:
        return expected[-lag_frames:], predicted[:lag_frames]
    return expected, predicted


def best_lag_summary(
    expected: np.ndarray,
    predicted: np.ndarray,
    max_lag_frames: int = 10,
) -> dict:
    best = None
    for lag in range(-max_lag_frames, max_lag_frames + 1):
        x, y = _lagged_pairs(expected, predicted, lag)
        mask = np.isfinite(x) & np.isfinite(y)
        x, y = x[mask], y[mask]
        if x.size < 3 or np.std(x) <= 1e-12 or np.std(y) <= 1e-12:
            continue
        corr = float(np.corrcoef(x, y)[0, 1])
        candidate = {
            "lag_frames": lag,
            "pearson_r": corr,
            "aligned_samples": int(x.size),
            "aligned_mae_deg": float(np.mean(np.abs(y - x))),
        }
        if best is None or candidate["pearson_r"] > best["pearson_r"]:
            best = candidate
    return best or {
        "lag_frames": None,
        "pearson_r": None,
        "aligned_samples": 0,
        "aligned_mae_deg": None,
    }


def _load_neutral_crops(sample_count: int) -> tuple[list[dict], dict]:
    import cv2

    clip_path = CLIPS_DIR / "static_hold.mp4"
    if not clip_path.exists():
        raise FileNotFoundError(clip_path)
    cap = cv2.VideoCapture(str(clip_path))
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    indices = np.rint(np.linspace(0.05, 0.95, sample_count) * (frame_count - 1)).astype(int)

    pose_models = ensure_models()
    pose = MediaPipeBackend(
        str(pose_models / "pose_landmarker_full.task"), "mediapipe_full")
    crop_xyxy = None
    samples = []
    try:
        for sample_index, frame_index in enumerate(indices.tolist()):
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ok, frame = cap.read()
            if not ok:
                continue
            landmarks = pose.infer(frame)
            if crop_xyxy is None:
                crop_xyxy = fixed_head_crop(
                    landmarks.get("left_ear"), landmarks.get("right_ear"), width, height)
            if crop_xyxy is None:
                continue
            x0, y0, x1, y1 = crop_xyxy
            crop = np.ascontiguousarray(frame[y0:y1, x0:x1])
            samples.append({
                "sample_index": sample_index,
                "frame_index": frame_index,
                "crop": crop,
            })
    finally:
        cap.release()

    if not samples or crop_xyxy is None:
        raise RuntimeError("could not initialize a face crop from the neutral clip")
    return samples, {
        "path": str(clip_path),
        "fps": fps,
        "resolution": [width, height],
        "frame_count": frame_count,
        "sampled_frame_indices": [sample["frame_index"] for sample in samples],
        "fixed_crop_xyxy": list(crop_xyxy),
    }


def run_independent_calibration(
    samples: list[dict],
    model_path: pathlib.Path,
    angles: tuple[float, ...],
) -> tuple[list[dict], dict]:
    landmarker = FaceRollLandmarker(model_path, num_faces=1, running_mode="IMAGE")
    records = []
    try:
        for sample in samples:
            baseline = landmarker.infer(sample["crop"])
            for angle in angles:
                measured = None
                predicted_delta = None
                if baseline is not None:
                    if abs(angle) <= 1e-9:
                        measured = baseline
                    else:
                        rotated = rotate_crop_for_image_roll(sample["crop"], angle)
                        measured = landmarker.infer(rotated)
                    if measured is not None:
                        predicted_delta = angle_diff_deg(measured, baseline)
                records.append({
                    "sample_index": sample["sample_index"],
                    "frame_index": sample["frame_index"],
                    "injected_deg": angle,
                    "baseline_roll_deg": baseline,
                    "measured_roll_deg": measured,
                    "predicted_delta_deg": predicted_delta,
                    "error_deg": (
                        predicted_delta - angle if predicted_delta is not None else None),
                })
            print(f"  calibrated neutral frame {sample['frame_index']}", flush=True)
    finally:
        landmarker.close()

    return records, {
        "overall": summarize_records(records),
        "by_angle": summarize_by_angle(records, angles),
    }


def _video_sweep_angles(max_angle: int = 50) -> np.ndarray:
    return np.concatenate([
        np.arange(0, max_angle + 1, dtype=float),
        np.arange(max_angle - 1, -max_angle - 1, -1, dtype=float),
        np.arange(-max_angle + 1, 1, 1, dtype=float),
    ])


def run_video_sweep(
    crop,
    model_path: pathlib.Path,
    *,
    num_faces: int,
) -> tuple[list[dict], dict]:
    landmarker = FaceRollLandmarker(
        model_path, num_faces=num_faces, running_mode="VIDEO")
    angles = _video_sweep_angles()
    records = []
    baseline = None
    try:
        for frame_index, angle in enumerate(angles.tolist()):
            rotated = rotate_crop_for_image_roll(crop, angle)
            measured = landmarker.infer(rotated, frame_index * VIDEO_STEP_MS)
            if frame_index == 0:
                baseline = measured
            predicted_delta = None
            if baseline is not None and measured is not None:
                predicted_delta = angle_diff_deg(measured, baseline)
            records.append({
                "frame_index": frame_index,
                "injected_deg": angle,
                "measured_roll_deg": measured,
                "predicted_delta_deg": predicted_delta,
                "error_deg": (
                    predicted_delta - angle if predicted_delta is not None else None),
            })
    finally:
        landmarker.close()

    expected = np.asarray([row["injected_deg"] for row in records], dtype=float)
    predicted = np.asarray([
        row["predicted_delta_deg"]
        if row["predicted_delta_deg"] is not None else np.nan
        for row in records
    ], dtype=float)
    summary = summarize_records(records)
    lag = best_lag_summary(expected, predicted)
    lag["lag_ms"] = (
        lag["lag_frames"] * VIDEO_STEP_MS if lag["lag_frames"] is not None else None)
    summary["best_lag"] = lag
    return records, summary


def _sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def build_report(
    source: dict,
    model_path: pathlib.Path,
    angles: tuple[float, ...],
    independent_records: list[dict],
    independent_summary: dict,
    sweeps: dict,
) -> dict:
    try:
        import mediapipe as mp
        mediapipe_version = mp.__version__
    except Exception:  # pragma: no cover - metadata only
        mediapipe_version = None
    return {
        "experiment": "face_landmarker_roll_calibration_v1",
        "question": (
            "Does transformation-matrix roll reproduce known 2D image-plane rotations?"),
        "scope_boundary": [
            "exact ground truth applies to injected image-plane roll only",
            "does not prove anatomical cervical lateral-flexion accuracy",
            "does not exercise real yaw, pitch, assisting-hand occlusion, or browser performance",
            "the fixed crop uses recorded participant imagery locally; no frames are written to output",
        ],
        "source": source,
        "injected_angles_deg": list(angles),
        "independent_image_mode": {
            "records": independent_records,
            "summary": independent_summary,
        },
        "video_sweeps": sweeps,
        "provenance": {
            "python": platform.python_version(),
            "mediapipe": mediapipe_version,
            "face_model_path": str(model_path),
            "face_model_url": FACE_LANDMARKER_URL,
            "face_model_sha256": _sha256(model_path),
        },
    }


def _fmt(value, digits: int = 3, percent: bool = False) -> str:
    if value is None or not np.isfinite(value):
        return "n/a"
    if percent:
        return f"{value * 100:.1f}%"
    return f"{value:.{digits}f}"


def build_markdown(report: dict) -> str:
    independent = report["independent_image_mode"]["summary"]
    overall = independent["overall"]
    lines = [
        "# Face Landmarker known-angle roll calibration",
        "",
        "The ground truth in this report is digitally injected 2D image-plane roll. "
        "It calibrates Face Landmarker roll extraction, not anatomical cervical motion.",
        "",
        "## Independent IMAGE-mode calibration",
        "",
        f"- Coverage: {_fmt(overall['coverage'], percent=True)} "
        f"({overall['detected_samples']}/{overall['samples']} nonzero-angle samples)",
        f"- Scale slope: {_fmt(overall['slope'], 4)}",
        f"- Intercept: {_fmt(overall['intercept_deg'])} deg",
        f"- Mean error: {_fmt(overall['mean_error_deg'])} deg",
        f"- MAE / RMSE: {_fmt(overall['mae_deg'])} / {_fmt(overall['rmse_deg'])} deg",
        f"- 95th-percentile absolute error: {_fmt(overall['p95_abs_error_deg'])} deg",
        "",
        "| Injected | Detected | Mean reported | Mean error | MAE | 95th abs error |",
        "|---:|---:|---:|---:|---:|---:|",
    ]
    for row in independent["by_angle"]:
        lines.append(
            f"| {row['injected_deg']:.0f} deg | "
            f"{row['detected_samples']}/{row['samples']} | "
            f"{_fmt(row['mean_predicted_deg'])} deg | "
            f"{_fmt(row['mean_error_deg'])} deg | "
            f"{_fmt(row['mae_deg'])} deg | "
            f"{_fmt(row['p95_abs_error_deg'])} deg |"
        )

    lines.extend([
        "",
        "## VIDEO-mode sweep",
        "",
        "| Mode | Coverage | Scale slope | MAE | Mean error | Best lag | Lag-aligned MAE |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ])
    for key, label in (
        ("smoothed_num_faces_1", "num_faces=1 smoothed"),
        ("unsmoothed_num_faces_2", "num_faces=2 unsmoothed"),
    ):
        summary = report["video_sweeps"][key]["summary"]
        lag = summary["best_lag"]
        lines.append(
            f"| {label} | {_fmt(summary['coverage'], percent=True)} | "
            f"{_fmt(summary['slope'], 4)} | {_fmt(summary['mae_deg'])} deg | "
            f"{_fmt(summary['mean_error_deg'])} deg | {_fmt(lag['lag_ms'], 0)} ms | "
            f"{_fmt(lag['aligned_mae_deg'])} deg |"
        )

    lines.extend([
        "",
        "## Interpretation boundary",
        "",
        "A near-unity slope and small injected-roll error show whether the Face "
        "transformation matrix is calibrated for in-plane head orientation. They do "
        "not determine whether a real assisted neck pose equals the same anatomical "
        "angle, because yaw, pitch, perspective, soft tissue, and cervical-versus-trunk "
        "motion are absent from a digitally rotated crop.",
        "",
        "## Provenance",
        "",
        f"- Experiment: `{report['experiment']}`",
        f"- MediaPipe: `{report['provenance']['mediapipe']}`",
        f"- Face model SHA-256: `{report['provenance']['face_model_sha256']}`",
        "- Output files contain numerical measurements and plots only, not video frames.",
    ])
    return "\n".join(lines) + "\n"


def write_plot(report: dict) -> pathlib.Path:
    os.environ.setdefault("MPLCONFIGDIR", str(OUT_DIR / ".matplotlib"))
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    by_angle = report["independent_image_mode"]["summary"]["by_angle"]
    injected = np.asarray([row["injected_deg"] for row in by_angle], dtype=float)
    predicted = np.asarray([
        row["mean_predicted_deg"] if row["mean_predicted_deg"] is not None else np.nan
        for row in by_angle
    ], dtype=float)
    predicted_sd = np.asarray([
        row["sd_predicted_deg"] if row["sd_predicted_deg"] is not None else np.nan
        for row in by_angle
    ], dtype=float)
    errors = predicted - injected

    fig, axes = plt.subplots(3, 1, figsize=(12, 11), constrained_layout=True)
    axes[0].plot(injected, injected, "k--", label="identity")
    axes[0].errorbar(
        injected, predicted, yerr=predicted_sd, marker="o", capsize=3,
        label="IMAGE-mode mean +/- SD")
    axes[0].set_ylabel("reported delta (deg)")
    axes[0].set_title("Known-angle calibration")
    axes[0].grid(alpha=0.25)
    axes[0].legend()

    axes[1].axhline(0.0, color="black", linewidth=0.8)
    axes[1].plot(injected, errors, marker="o")
    axes[1].set_ylabel("mean error (deg)")
    axes[1].set_xlabel("injected image roll (deg)")
    axes[1].grid(alpha=0.25)

    for key, label in (
        ("smoothed_num_faces_1", "VIDEO smoothed"),
        ("unsmoothed_num_faces_2", "VIDEO unsmoothed"),
    ):
        records = report["video_sweeps"][key]["records"]
        values = np.asarray([
            row["predicted_delta_deg"]
            if row["predicted_delta_deg"] is not None else np.nan
            for row in records
        ], dtype=float)
        axes[2].plot(values, label=label, linewidth=1.0)
    expected = np.asarray([
        row["injected_deg"]
        for row in report["video_sweeps"]["smoothed_num_faces_1"]["records"]
    ], dtype=float)
    axes[2].plot(expected, "k--", label="injected", linewidth=1.0)
    axes[2].set_ylabel("roll delta (deg)")
    axes[2].set_xlabel("synthetic video frame (50 ms)")
    axes[2].set_title("VIDEO-mode tracking sweep")
    axes[2].grid(alpha=0.25)
    axes[2].legend()

    target = OUT_DIR / "face_landmarker_roll_calibration.png"
    fig.savefig(target, dpi=150)
    plt.close(fig)
    return target


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Calibrate Face Landmarker roll against known image rotations.")
    parser.add_argument("--samples", type=int, default=12,
                        help="number of neutral source frames (default: 12)")
    parser.add_argument("--no-plot", action="store_true", help="skip the PNG plot")
    args = parser.parse_args()
    if args.samples < 2:
        raise ValueError("--samples must be at least 2")

    angles = DEFAULT_ANGLES_DEG
    model_path = ensure_face_landmarker_model()
    samples, source = _load_neutral_crops(args.samples)
    print(f"Using fixed crop {source['fixed_crop_xyxy']} from {len(samples)} frames")

    independent_records, independent_summary = run_independent_calibration(
        samples, model_path, angles)
    representative = samples[len(samples) // 2]["crop"]
    smoothed_records, smoothed_summary = run_video_sweep(
        representative, model_path, num_faces=1)
    unsmoothed_records, unsmoothed_summary = run_video_sweep(
        representative, model_path, num_faces=2)
    sweeps = {
        "smoothed_num_faces_1": {
            "records": smoothed_records,
            "summary": smoothed_summary,
        },
        "unsmoothed_num_faces_2": {
            "records": unsmoothed_records,
            "summary": unsmoothed_summary,
        },
    }
    report = build_report(
        source, model_path, angles, independent_records, independent_summary, sweeps)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    json_path = OUT_DIR / "face_landmarker_roll_calibration.json"
    md_path = OUT_DIR / "face_landmarker_roll_calibration.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    markdown = build_markdown(report)
    md_path.write_text(markdown, encoding="utf-8")
    print(f"Wrote {json_path}")
    print(f"Wrote {md_path}")
    if not args.no_plot:
        print(f"Wrote {write_plot(report)}")
    print("\n" + markdown)


if __name__ == "__main__":
    main()
