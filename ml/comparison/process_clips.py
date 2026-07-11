"""
process_clips.py — run every pose backend over the recorded clips for an
exercise, compute the clinical primary metric per frame via the ported math,
and emit a noise-floor + processing-speed comparison.

Data flow (identical across backends, only the backend varies):
  clip.mp4 -> backend.infer(frame) -> metrics -> per-frame primary
           -> static-hold SD (noise floor) + find_peaks rep peaks
           -> variance decomposition (noise_report) + inference latency
           -> out/<exercise>__<backend>.json and out/comparison.md

Run from ml/ with the comparison venv, e.g.:
  python -m comparison.process_clips --exercise ex_003
  python -m comparison.process_clips                      # both exercises, all backends
"""
from __future__ import annotations

import argparse
import json
import pathlib
from time import perf_counter

import numpy as np

from comparison.landmark_map import COCO_17, RTMW_133
from comparison.metrics import (compute_neck_lateral_flexion_signed,
                                 compute_scapular_elevation,
                                 compute_tilt_reference)
from comparison.noise_report import variance_decomposition
from comparison.segment import extract_peaks

HERE = pathlib.Path(__file__).resolve().parent
CLIPS_DIR = HERE / "clips"
OUT_DIR = HERE / "out"

ALL_BACKENDS = ["mediapipe_full", "mediapipe_heavy", "movenet_thunder",
                "rtmpose_m", "rtmw"]
CLIP_NAMES = ["static_hold", "slow_reps", "normal_reps", "compensated"]

# Per-exercise framing.
EXERCISES = {
    "ex_003": {"sides": ["left", "right"], "units": "trunk-len", "baseline": True},
    "ex_004": {"sides": ["bidirectional"], "units": "deg", "baseline": False},
}

_WARMUP_FRAMES = 5  # discarded from latency stats (model graph warm-up)


def make_backend(key: str):
    """Construct one backend adapter (lazy imports keep optional backends from
    blocking the rest)."""
    if key in ("mediapipe_full", "mediapipe_heavy"):
        from comparison.backends.mediapipe_backend import MediaPipeBackend
        from comparison.fetch_models import ensure_models
        models = ensure_models()
        fname = "pose_landmarker_full.task" if key == "mediapipe_full" else "pose_landmarker_heavy.task"
        return MediaPipeBackend(str(models / fname), key)
    if key == "movenet_thunder":
        from comparison.backends.movenet_backend import MoveNetBackend
        return MoveNetBackend()
    if key == "rtmpose_m":
        from comparison.backends.rtmpose_backend import RTMLibBackend
        return RTMLibBackend("body", "rtmpose_m", COCO_17)
    if key == "rtmw":
        from comparison.backends.rtmpose_backend import RTMLibBackend
        return RTMLibBackend("wholebody", "rtmw", RTMW_133)
    raise ValueError(f"unknown backend: {key}")


def _iter_frames(path: pathlib.Path):
    import cv2

    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            yield frame
    finally:
        cap.release()
    _iter_frames.last_fps = fps  # type: ignore[attr-defined]


def _primary_per_frame(exercise: str, lms: dict, side: str):
    if exercise == "ex_004":
        return compute_neck_lateral_flexion_signed(lms, compute_tilt_reference(lms))
    return compute_scapular_elevation(lms, side)


def _process_clip(backend, exercise: str, path: pathlib.Path, max_frames=None):
    """Return ({side: np.array primary}, [latency_s], fps)."""
    sides = EXERCISES[exercise]["sides"]
    series = {s: [] for s in sides}
    latencies = []
    import cv2

    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    i = 0
    while True:
        if max_frames is not None and i >= max_frames:
            break
        ok, frame = cap.read()
        if not ok:
            break
        t0 = perf_counter()
        lms = backend.infer(frame)
        latencies.append(perf_counter() - t0)
        for s in sides:
            # ex_004 ignores side ("bidirectional"); ex_003 uses left/right.
            v = _primary_per_frame(exercise, lms, s if s in ("left", "right") else "left")
            series[s].append(v if v is not None else np.nan)
        i += 1
    cap.release()
    series = {s: np.asarray(v, dtype=float) for s, v in series.items()}
    return series, latencies, float(fps)


def _rep_peaks(exercise: str, rep_series: np.ndarray, fps: float) -> list[float]:
    """Orient the signal so a rep is a positive hump, then pick peaks."""
    if exercise == "ex_004":
        return extract_peaks(np.abs(rep_series), fps=int(round(fps)))
    # ex_003: baseline = rest at the START of this clip; shrug reduces the raw
    # projection, so (baseline - raw) makes a shrug a positive hump.
    head = rep_series[:max(int(round(fps)), 1)]
    head = head[np.isfinite(head)]
    baseline = float(np.mean(head)) if head.size else float(np.nanmean(rep_series))
    adjusted = baseline - rep_series
    return extract_peaks(adjusted, fps=int(round(fps)))


def run_one(exercise: str, backend_key: str, max_frames=None, skip_slow: bool = False) -> dict:
    clips = {n: CLIPS_DIR / exercise / f"{n}.mp4" for n in CLIP_NAMES}
    have = {n: p for n, p in clips.items() if p.exists()}
    if "static_hold" not in have or "normal_reps" not in have:
        raise FileNotFoundError(
            f"{exercise}/{backend_key}: need at least static_hold.mp4 and "
            f"normal_reps.mp4 (found: {sorted(have)})")

    print(f"  [{backend_key}] loading ...", flush=True)
    backend = make_backend(backend_key)

    static_series, static_lat, fps = _process_clip(backend, exercise, have["static_hold"], max_frames)
    normal_series, normal_lat, _ = _process_clip(backend, exercise, have["normal_reps"], max_frames)
    slow_series = None
    if "slow_reps" in have and not skip_slow:
        slow_series, _, _ = _process_clip(backend, exercise, have["slow_reps"], max_frames)

    per_side = {}
    for s in EXERCISES[exercise]["sides"]:
        static_arr = static_series[s]
        normal_peaks = _rep_peaks(exercise, normal_series[s], fps)
        slow_peaks = _rep_peaks(exercise, slow_series[s], fps) if slow_series is not None else normal_peaks
        per_side[s] = variance_decomposition(
            static_arr, slow_peaks, normal_peaks, units=EXERCISES[exercise]["units"])

    lat = np.asarray(static_lat + normal_lat, dtype=float)
    lat = lat[_WARMUP_FRAMES:] if lat.size > _WARMUP_FRAMES else lat
    mean_ms = float(np.mean(lat) * 1000.0) if lat.size else float("nan")

    result = {
        "exercise": exercise,
        "backend": backend_key,
        "clip_fps": fps,
        "infer_ms_mean": mean_ms,
        "infer_fps_cpu": (1000.0 / mean_ms) if mean_ms and mean_ms > 0 else None,
        "clips_used": sorted(have),
        "per_side": per_side,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / f"{exercise}__{backend_key}.json").write_text(json.dumps(result, indent=2))
    return result


def _fmt_side(decomp: dict) -> str:
    st = decomp.get("static")
    frac = decomp.get("landmark_fraction")
    sd = f"{st['sd']:.3f}" if st else "n/a"
    p2p = f"{st['robust_p2p']:.2f}" if st else "n/a"
    fr = f"{frac * 100:.0f}%" if frac is not None else "n/a"
    return f"sd {sd}, p2p {p2p}, landmark {fr} ({decomp.get('verdict', '?')})"


def build_comparison_md(results: list[dict]) -> str:
    lines = ["# Pose-backend comparison results", "",
             "Inference FPS is CPU offline throughput (relative cross-backend "
             "speed), not the live in-browser GPU rate.", ""]
    by_ex: dict[str, list[dict]] = {}
    for r in results:
        by_ex.setdefault(r["exercise"], []).append(r)

    for ex, rs in sorted(by_ex.items()):
        units = EXERCISES[ex]["units"]
        lines.append(f"## {ex}  (primary units: {units})")
        lines.append("")
        lines.append("| Backend | Infer FPS (CPU) | Noise floor / landmark fraction |")
        lines.append("|---|---|---|")
        for r in sorted(rs, key=lambda x: x["backend"]):
            fps = r.get("infer_fps_cpu")
            fps_s = f"{fps:.1f}" if fps else "n/a"
            detail = " ; ".join(f"**{s}**: {_fmt_side(d)}" for s, d in r["per_side"].items())
            lines.append(f"| {r['backend']} | {fps_s} | {detail} |")
        lines.append("")
    return "\n".join(lines)


def _load_all_results() -> list[dict]:
    """All per-backend results currently on disk, so repeated/partial runs
    accumulate into one comparison table (and a long run is resumable)."""
    out = []
    for p in sorted(OUT_DIR.glob("*__*.json")):
        try:
            out.append(json.loads(p.read_text()))
        except Exception:  # noqa: BLE001
            pass
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Pose-backend comparison over recorded clips.")
    ap.add_argument("--exercise", choices=sorted(EXERCISES), default=None,
                    help="default: both exercises")
    ap.add_argument("--backends", default=",".join(ALL_BACKENDS),
                    help="comma-separated subset of: " + ",".join(ALL_BACKENDS))
    ap.add_argument("--max-frames", type=int, default=None,
                    help="cap frames per clip (quick probe / timing); default all")
    ap.add_argument("--no-slow", action="store_true",
                    help="skip the long slow_reps clips (keeps static_hold + normal_reps)")
    args = ap.parse_args()

    exercises = [args.exercise] if args.exercise else sorted(EXERCISES)
    backend_keys = [b.strip() for b in args.backends.split(",") if b.strip()]

    for ex in exercises:
        print(f"[{ex}]")
        for bk in backend_keys:
            try:
                r = run_one(ex, bk, max_frames=args.max_frames, skip_slow=args.no_slow)
                fps = r.get("infer_fps_cpu")
                print(f"  done [{bk}] infer {fps:.1f} fps (CPU)" if fps else f"  done [{bk}]")
            except FileNotFoundError as e:
                print(f"  SKIP {e}")
            except Exception as e:  # noqa: BLE001 — one backend failing must not kill the run
                print(f"  ERROR [{bk}] {type(e).__name__}: {e}")

    all_results = _load_all_results()
    if all_results:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        md = build_comparison_md(all_results)
        (OUT_DIR / "comparison.md").write_text(md)
        print("\n" + md)
        print(f"\nWrote {OUT_DIR / 'comparison.md'} ({len(all_results)} backend-runs on disk).")
    else:
        print("\nNo results — record clips into comparison/clips/ first "
              "(see record_guide.md).")


if __name__ == "__main__":
    main()
