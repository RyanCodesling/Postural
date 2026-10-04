# Timestamped real-trace preparation

This is an offline input-preparation gate for **dynamic repetitions and ex_006
arm holds**, not a per-rep learned assessment. It reads existing
tuning-trace exports, never the playback overlay or patient video. It does not
train, tune, load executable model objects, or write to the product database.

## Export and prepare

The existing web exporter now includes the session's saved measurement context
(exercise definition, effective bands, versions and prescription summary),
`session_<id>_sets.ndjson` (saved set windows, targets and outcomes), and row counts.
It never substitutes the current registry for absent historical context. Older
export files can be re-exported when the original database session has that
context; missing original provenance cannot be repaired by editing a label.

From `web/`, use the existing trace export command for an authorised recording:

```powershell
npx tsx scripts/export-tuning-traces.ts --exercise ex_001 --session SESSION_ID
```

From `ml/`, prepare into a **new** output folder:

```powershell
.venv/Scripts/python.exe -m analysis.prepare_real --exercise ex_001 --session SESSION_ID --data-dir data/real --model-dir training/out/features-v2/subject_calibration_v2 --participant PARTICIPANT_ID --out data/prepared/NEW_RUN
```

Participant ID must be supplied explicitly. `--label 0` (intended good) or
`--label 1` (intended compensated) is optional; omission remains unknown. These
are externally supplied conditions, not clinician ground truth, and must never
be generated from the displayed cue or rule score. Use study pseudonyms.

The model directory must contain the matching model binary, metadata and audit
JSON. Its binary and registry hashes, feature/evaluation versions and exercise
identity are checked. Recorded measurement definitions and effective bands must
match that registry; cue wording is excluded from the definition comparison.
Only v3/v4 traces carrying `pose_metrics_v2_frozen_neutral_tilt` are supported.
All source frames must agree. Unsupported/missing context is a refusal, never
an automatic migration. In particular, current active neck repetitions cannot
be treated as the old offline isometric protocol.

## Timing and exclusions

- Preserve capture timestamps, elapsed time, source frame index, trace kind and
  calibration provenance in the raw mapper. Its `frame` is elapsed position in
  30 Hz units, not a consecutive observation number. Raw timestamped tables
  cannot go directly through the ML feature extractor.
- Assign repetition windows by **set and side**, avoiding joins between reused
  repetition indices in different sets. Refuse overlapping windows on one side.
- Generate a 30 Hz grid anchored to each repetition's original start/end.
  Interpolate linearly only between finite observations at most 200 ms apart,
  consistent with the browser's existing engineering interpolation bound.
  Never extrapolate missing edges, shorten the window, or pack around gaps.
- Exclude a repetition if any scored channel has unfilled targets, calibration
  changes/is unavailable, or primary motion is constant/too short. Duplicate or
  nonmonotonic capture times refuse the session.
- For `ex_006`, use saved set start/end times and both arms on the same timeline.
  A constant primary signal is valid for a hold. Use complete 1/30-second bins
  within `[start, end)` so `hold-v1` occupancy (`samples / 30`) never credits an
  extra endpoint; a fractional final bin is conservatively omitted (under 34 ms).
  Both arms need every scored channel, without dropping an inactive or sagging
  arm. Per-side credited achievement and simultaneous in-band time stay separate.
- Save source cadence statistics and channel coverage. Resampling a 15 Hz trace
  to 30 Hz does **not** recover unobserved movement or establish equivalence to
  the synthetic training distribution, especially for derivative features.

Outputs: `frames.parquet`, `rep_features.parquet`, and `report.json`. The report
lists every retained/excluded repetition, reasons, channel coverage, original
cadence, and input/model/preprocessor hashes. `allRecordedRepsEligible` only
describes the supplied repetition/hold windows. **Standalone preparation leaves
`sessionInferenceReady` false**. The [offline evaluator](OFFLINE_EVALUATION.md)
now checks the closed session, prescription and saved outcomes before setting
it true, aggregating all windows, and running the frozen model. A session with
any excluded window receives no prediction.

Only the simultaneous arm hold is supported for isometric ML input. `ex_004`
remains explicitly refused while the active neck protocol's counting gate is
pending; the old offline registry is preserved. Existing descriptive legacy
trace reading remains available. No new recording is needed merely to exercise
this software path with fixtures; independent real-person evaluation is separate.
