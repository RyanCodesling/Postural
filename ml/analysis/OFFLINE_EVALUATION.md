# Frozen offline session evaluation

This evaluator estimates **P(compensated) for an entire exercise session**, using
the existing synthetic-trained model and its feature definitions. It also saves
`100 * (1 - p)` as a model probability score, not a percentage of correct reps,
an angle, a clinical grade or a deployment-validated probability.

It reads authorised tuning-trace exports, never patient video or playback overlays.
It performs no fitting, tuning, database writeback or patient-facing inference.
Neck exercise `ex_004` remains refused pending its protocol/counting gate.

## 1. Prepare trusted local models and freeze before collection

From `ml/`, rebuild each needed model with the current synthetic-only training
command (`python -m training.train --exercise ex_001`). Artifacts must include
`model.joblib`, `model.metadata.json`, and `audit.json` under
`training/out/features-v2/subject_calibration_v2/`. The current local artifacts
cover `ex_001` and `ex_006`; rebuild `ex_005`, `ex_007`, or `ex_008` before adding
them. Do not re-export the registry over the deliberately preserved neck protocol.

For held-out visits, save a JSON mapping of exercise IDs to the exact coaching
version strings approved for that collection, for example:

```json
{"ex_001": ["EXACT_COACHING_VERSION"], "ex_006": ["EXACT_COACHING_VERSION"]}
```

Use the recorded `measurementContext.versions.coachingConfig` value and the study's
frozen configuration, not the exercise measurement hash. An allow-list declaration
is not independent evidence that deployment stayed unchanged; retain the study
freeze record and software version separately.

```powershell
.venv/Scripts/python.exe -m analysis.evaluate_real freeze --model-dir training/out/features-v2/subject_calibration_v2 --exercises ex_001 ex_006 --coaching-configs coaching-versions.json --out data/frozen/STUDY_RUN
```

The new output directory contains copies of the trained artifacts and `bundle.json`
with freeze time, model/audit hashes, evaluator/measurement-code hashes, coaching
versions and the synthetic training class priors. Freeze never fits a model.
Subsequent code, registry or artifact drift refuses scoring; a new collection
freeze is required. These are local integrity checks, not signed immutable evidence.
Only load trusted locally produced joblib files. Match the recorded NumPy,
scikit-learn and joblib versions; incompatible runtime versions refuse inference.
For fixture/researcher plumbing only, the coaching allow-list may be omitted.

## 2. Export and declare the evaluation records

Use the [trace preparation/export guide](TRACE_PREPARATION.md) for the four input
files. Historical exports without set outcomes or measurement context need
re-exporting from their original saved data; provenance cannot be invented.

Create a UTF-8 JSON manifest (paths are relative to the manifest location):

```json
{
  "version": "offline_session_evaluator_v1",
  "purpose": "held_out_visit",
  "bundle": "frozen/STUDY_RUN",
  "dataDir": "real",
  "sessions": [
    {
      "sessionId": 12345,
      "exercise": "ex_001",
      "participantId": "study-p01",
      "cohort": "baseline_no_feedback",
      "label": 0,
      "labelSource": "scripted_condition",
      "untouchedParticipant": true,
      "usedForTuning": false
    }
  ]
}
```

Replace example values with actual records. `label` is intended good (0) or
compensated (1), supplied from the script, never derived from model/rule scores or
coaching cues. It is not a clinician-verified account of actual execution.
`cohort` must be `baseline_no_feedback` or `feedback_assisted`; this is a researcher
declaration that must agree with how the session was conducted.

Purposes:

- `fixture`: artificial input plumbing; no empirical performance table.
- `researcher_dry_run`: authorised existing researcher recordings; no empirical
  performance table. Missing labels remain unknown, never default to good.
- `held_out_visit`: requires explicit scripted labels, untouched-participant and
  no-tuning declarations, post-freeze session start, frozen coaching version and
  consistent patient-ID-to-pseudonym mapping across records. Known tuning sessions
  168–174, 192–196 and 199 are refused. The explicit list is not exhaustive:
  researchers must truthfully identify all other tuning participants too.

Duplicate sessions or conflicting participant aliases refuse the run. Raw patient
IDs are checked locally and are not copied into the report. Keep one pseudonym
for a person across exercises/conditions; do not inflate independent sample counts.

## 3. Score once into a new folder

```powershell
.venv/Scripts/python.exe -m analysis.evaluate_real score --manifest data/evaluation-manifest.json --out data/evaluated/STUDY_RUN
```

The session gate requires:

- A closed session (`completed`, `user` or `pain`), matching session/exercise IDs,
  exact exported row counts, original measurement protocol/bands/versions, and
  a supported bilateral prescription.
- Exactly one saved outcome per prescribed set, ordered windows within the
  session and matching prescribed targets. Under-target counts are allowed;
  missing/unattempted set records are conservatively excluded in this version.
- For dynamic exercises, saved per-side counts must match rep events, each side
  must have measured reps in every set, windows must lie inside their set without
  same-side overlap, and recorded target ROM must match the model protocol.
- For `ex_006`, saved isometric set windows, no dynamic rep events, and full
  simultaneous measurements for both arms. Constant holds are valid. Independently
  credited per-side time and paired in-band fraction retain their training meanings;
  they do not replace the app's simultaneous hold-completion gate.
- Every repetition/hold must pass the timestamp, gap, calibration and channel
  checks. One excluded window excludes the whole session. Features must be finite
  and match the frozen model's exact names/order and binary class order.

This is intentionally conservative. Recorded rep boundaries come from the live
counter, not independently annotated video. Interpolating 15 Hz measurements to
30 Hz does not restore missing movement, establish clean segmentation, or remove
the synthetic-to-real distribution difference.

Outputs are `report.json`, `predictions.csv` and `session_features.csv`. The report
retains each exclusion reason, hashes of available inputs (including exclusions),
manifest/bundle hashes, and scored sessions' timing/coverage/provenance. Existing
output folders are never overwritten. A run can finish with every session excluded;
inspect `included`/`excluded` rather than interpreting command success as scoring.

Only `held_out_visit` produces performance tables, separated by exercise, feedback
cohort and coaching version. They compare classifier probabilities with the rule
ranking score and the frozen synthetic class-prior baseline. Classifier threshold
metrics use 0.5; rule scores are not treated as calibrated probabilities. AUC/AP
are unavailable for one-class groups. Groups with multiple participants and both
classes receive paired participant-bootstrap AUC/difference intervals with fixed
predictions, not model refitting or clinical uncertainty.

## Status and remaining evidence

The software path has automated positive/negative tests and CLI fixture runs using
the actual synthetic-trained arm-raise and arm-hold models. These establish plumbing,
not human performance. Real-person evaluation still needs an agreed frozen study
protocol, untouched participants, truthful condition/cohort records, compatible
authorised trace captures and inspection of exclusions. Feature ablation/noise
stress experiments and any separately designed per-rep learning task remain future
work. There is no patient-visible ML deployment in this block.
