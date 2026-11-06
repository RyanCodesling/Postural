# Pose-backend comparison

> **Status: archived exploratory benchmark (June 9, 2026), not an active
> backend-migration or exercise-revival plan.** `ex_003` is deprecated, and the
> recorded `ex_004` protocol predates its conversion to an assisted side-split
> isometric hold. Existing outputs may be reproduced as historical engineering
> evidence, but these clips/protocols must not be cited as validation of the
> current active exercise definitions. Re-scope the exercise configuration and
> recording protocol before collecting any new comparison data.

A self-contained harness that measures the **clinical-metric noise floor** and
**processing speed** of several 2D pose backends on identical recorded clips,
for two historically precision-sensitive exercise definitions. It measures
metric noise/precision and offline CPU throughput, not ground-truth landmark or
clinical accuracy. It does **not** modify the form-quality model or live pipeline.

## Why

The original June 9 experiment asked whether landmark precision explained the
then-observed limitations:

- **ex_003 Shoulder Shrugs** — the signal sat near the landmark-jitter floor and
  the exercise is now deprecated. The harness does not reopen that decision.
- **ex_004 Neck Lateral Flexion** — the historical dynamic movement relied on
  the ear line. The active exercise is now an assisted isometric hold with a
  placeholder clinical band, so the old dynamic clips are not current evidence.

The historical run measured whether a different backend lowered those noise
floors enough to matter, and at what offline runtime cost. The variance-decomposition verdict
(`< 20%` / `20–50%` / `> 50%` landmark fraction) says whether the backend is
even the bottleneck before any swap is considered.

## Backends

| Key | Model | Keypoints |
|-----|-------|-----------|
| `mediapipe_full` | MediaPipe Pose Landmarker (full) | 33 |
| `mediapipe_heavy` | MediaPipe Pose Landmarker (heavy) | 33 |
| `movenet_thunder` | MoveNet Thunder (TF-Hub) | 17 (COCO) |
| `rtmpose_m` | RTMPose-m via rtmlib | 17 (COCO) |
| `rtmw` | RTMW whole-body via rtmlib | 133 |

Only six anatomical points are used (both ears, shoulders, hips); all backends
provide them. Every backend reports points in MediaPipe's normalized convention
(x/width, y/height), and angles are computed in that same space, so the numbers
match what the live system would compute from the same landmarks.

## Pipeline

```
clip.mp4 -> backend.infer(frame) -> metrics.py (+ tilt correction)
         -> per-frame primary -> static-hold SD (noise floor) + find_peaks rep peaks
         -> noise_report variance decomposition + inference latency
         -> out/<exercise>__<backend>.json and out/comparison.md
```

`metrics.py` is a 1:1 Python port of the relevant functions in
`web/src/lib/pose/poseMetrics.ts`, pinned to the TypeScript test vectors by
`tests/test_metrics_parity.py`.

## How to run

The commands below reproduce the archived experiment only. Do not record a new
current-study dataset from `record_guide.md` without first replacing its deprecated
exercise definitions and obtaining the current clinical protocol.

1. **Record clips** — follow [record_guide.md](record_guide.md). Put them in
   `clips/ex_003/` and `clips/ex_004/` (static_hold / slow_reps / normal_reps,
   plus an optional compensated take). Clips stay local (gitignored).
2. **Install** (one time, isolated venv so the main `ml/.venv` is untouched):
   ```
   py -3.12 -m venv comparison/.venv
   comparison/.venv/Scripts/python -m pip install -r comparison/requirements-comparison.lock.txt
   ```
   Saved virtual environments are not portable. Recreate this environment if its
   interpreter path no longer exists. `requirements-comparison.txt` remains the
   human-maintained dependency list; refresh the lock only after deliberately
   resolving and testing a new environment.
3. **Run** from `ml/` with the comparison venv:
   ```
   python -m comparison.process_clips                 # both exercises, all backends
   python -m comparison.process_clips --exercise ex_003
   python -m comparison.process_clips --backends mediapipe_full,rtmw
   ```
   Results land in `out/comparison.md` (+ per-backend JSON). Model weights
   download on first use.

## Tests

```
python -m pytest comparison/tests        # metric parity + segmentation/decomposition
```

## Caveats

- **Inference FPS is CPU offline throughput** — a relative cross-backend speed
  comparison, not the live in-browser GPU rate.
- There is no motion-capture or manually annotated landmark ground truth, so the
  harness cannot claim pose-estimation accuracy. It compares output stability and
  metric noise on identical clips.
- The comparison runs **Python** MediaPipe; the live app runs the browser build.
  They are close but not identical; the cross-backend ranking is what matters.
- COCO/RTMW backends use the **same semantic ear keypoints** as everyone else, so
  any ear-line difference is precision on the same point, not a different
  definition. A face-point ear refinement for RTMW is possible future work.
- The archived results do not justify replacing MediaPipe full: it remained the
  practical speed/noise choice for the historical `ex_004` clip, and the variance
  decomposition did not identify the backend as the dominant bottleneck.

## Targeted Face Landmarker screening

`face_landmarker_ex004.py` is a separate, narrower experiment that reuses the
local `ex_004` recordings to screen a face-derived head-roll signal. It compares
the facial transformation-matrix roll with the existing pose ear-line signal in
three conditions: the unchanged full-body frame, a fixed Pose-initialized head
crop with MediaPipe's single-face smoothing, and that crop with `num_faces=2`
so the documented single-face smoothing is disabled. Version 2 also extracts
neutral-centered yaw and pitch and reports their descriptive association with
the Face-minus-Pose roll residual. Those old, unmarked clips cannot establish a
yaw/pitch rejection threshold; that requires dedicated phase-labeled controls.
Run it from `ml/` with:

```
python -m comparison.face_landmarker_ex004
```

It writes numerical JSON/Markdown results and a signal plot under the gitignored
`comparison/out/` directory. This can establish detection coverage, neutral
jitter, motion concordance, and offline CPU cost. It cannot establish clinical
angle accuracy: the old clips have no independent ground truth and predate the
current assisted isometric protocol, with no assisting-hand occlusion or isolated
yaw/pitch controls. The opt-in staff browser shadow diagnostic can record all
three Face matrix components, named trial-phase markers, and timestamped optional
reference-angle marks while Pose stays authoritative. Clinical thresholds,
patient feedback, persistence, and ML remain unchanged.

### Known-angle roll calibration

`face_landmarker_roll_calibration.py` follows the recording screen with a
controlled calibration. It rotates several fixed crops from the neutral clip by
known image-plane angles, measures independent IMAGE-mode scale/bias/error, and
runs smoothed and unsmoothed VIDEO-mode sweeps to quantify tracking lag:

```
python -m comparison.face_landmarker_roll_calibration
```

The resulting JSON, Markdown, and plot remain under `comparison/out/`. This is
exact ground truth for the digitally injected 2D roll only. It does not prove
anatomical cervical-angle accuracy or replace the required assisted-hold,
yaw/pitch, occlusion, mirroring, and live-browser tests.

## Files

| File | Role |
|------|------|
| `metrics.py` | ported angle math (parity-pinned) |
| `landmark_map.py` | anatomical-name ↔ index maps per backend |
| `backends/` | one adapter per backend |
| `segment.py` | offline rep-peak extraction |
| `noise_report.py` | variance decomposition + verdict |
| `process_clips.py` | driver |
| `fetch_models.py` | MediaPipe model download |
| `smoke_backends.py` | plumbing check (loads + runs each backend) |
| `record_guide.md` | recording protocol |
| `face_landmarker_ex004.py` | targeted Face roll/yaw/pitch screening on local ex_004 clips |
| `face_landmarker_roll_calibration.py` | known-angle 2D roll scale/bias and tracking calibration |
