# Form-quality ML layer

Offline/batch machine-learning code for the postural monitoring system. This layer
trains a single **form-quality model**: a calibrated good-vs-compensated classifier
whose probability is expressed as a **0–100 quality score** within the synthetic
evaluation distribution. It runs offline in Python (scikit-learn / XGBoost) on
engineered features. A [frozen offline evaluator](analysis/OFFLINE_EVALUATION.md)
can now score compatible recorded sessions and save local reports with provenance.
There is no live browser inference, product prediction persistence or
clinician-dashboard ML score, and no real-person performance has been established.

The model was proven end-to-end on one exercise (Lateral Arm Raises, `ex_001`) first, then
replicated across the other active exercises. All six active exercises and all
three structural framings are implemented and software-evaluated on their synthetic
distributions: dynamic per-limb (`ex_001`, `ex_007`, `ex_008`), bidirectional
alternating (`ex_005`), and isometric holds (`ex_004` side-split, `ex_006` per-limb
with a paired both-sides-in-band feature). This is not real-data or clinical
validation. Isometric "reps" are
holds: one feature row per (set, side) with time-in-band, settle, drift, exit, and
steadiness features instead of peak/tempo, and `target_reps` in the sets output
carries the prescribed hold seconds.

## Environment

### Feature contract update (2026-09-27)

Dynamic features now use `ml.features.extract.rep-v2`. Position jerk is normalized
with duration to the fifth power and peak-to-peak amplitude; duration is the
time between the first and last sample. Constant or too-short trajectories have
unavailable smoothness, and the offline extractor rejects missing/nonfinite
primary samples rather than compressing their time axis. The browser records
gapped temporal features as null with `mlEligible: false`, retaining coverage and
observed compensation summaries in repetition-quality V3. V1/V2 history remains
readable. Isometric feature definitions are unchanged.

`python -m features.extract --exercise ex_001` rebuilds features from the existing
synthetic frames into `data/features-v2/`; repeat for other exercises. Training
reads that directory, rejects legacy/mixed dynamic feature definitions, and writes
new models/reports to `training/out/features-v2/` with a feature-definition sidecar.
The previous feature tables and model artifacts are preserved. Do not feed new
features into an old model or present old dynamic model results as rep-v2 results.
The offline neck registry still describes the isometric protocol; it does not
validate the current app's neck-repetition protocol.

Built and tested on **Python 3.10** (broad, mature wheel support for the scientific
stack). Create the environment and install dependencies:

```bash
py -3.10 -m venv .venv          # Windows; or: python3.10 -m venv .venv
.venv/Scripts/activate          # Windows; or: source .venv/bin/activate
pip install -r requirements.txt
```

Verify:

```bash
python -c "import sklearn, xgboost, pandas, numpy, scipy; print('ok')"
```

Virtual environments are machine-local and are not portable after their base
interpreter moves or is removed. If `.venv/Scripts/python.exe` reports a missing
Python 3.10 path, delete/recreate the environment and reinstall from
`requirements.txt` before running pytest or reproducing figures.

## Layout

```
config/        exercise parameters exported from the app registry (registry.json)
generators/    synthetic feature-trajectory generator (registry-parameterized)
features/      raw trajectory -> engineered feature vector (reusable on real captures)
training/      model training, calibration, evaluation, and result artifacts
analysis/      real-capture trace mapping and deduction/coupling reports
notebooks/     exploratory data analysis and result plots
tests/         unit tests for feature extraction, framings, and trace mapping
data/          generated synthetic data (git-ignored)
```

## Data

Training data is **synthetic**: realistic feature/joint-angle trajectories for correct vs
compensated form, generated per exercise from registry parameters. The "compensated" class
uses graded, correlated deviations (not a single threshold), so the model must learn more
than the rule-based score it is compared against.

`analysis/real_frames.py` loads the opt-in researcher tuning traces used to inspect noise,
fit threshold/coupling candidates, and tune normalized generator parameters. Sessions
168–174 were used for those purposes and therefore are **not** an untouched held-out test.
The offline evaluator is implemented; there is no reported real-data performance
figure. An empirical evaluation must freeze the protocol first, collect a new
untouched subject-independent set, and keep it separate from all threshold, generator, and
scoring decisions. The current reported model results are synthetic-only.

Before that collection, the application measurement contract must also be frozen and
versioned. Raw/unsmoothed analytical features must remain separate from smoothed live
coaching. Effective compensation exposure, movement phase, capture confidence/missingness,
and whether a cue was shown or resolved are study context; they must not be silently folded
into the current feature definition or treated as automatic labels. Baseline and
feedback-assisted sessions must remain explicitly separable. Any later feature expansion or
clinical interpretation requires clinician-defined reference labels. The current evaluator
uses externally declared scripted conditions, not clinical ground truth, and participant-level
separation. More recorded fields can strengthen a future model, but they can also increase
overfitting, rule/label circularity, and feedback leakage when the real sample is small.

## Baselines

The [timestamped trace preparation guide](analysis/TRACE_PREPARATION.md) describes
the repetition/arm-hold input gate, export provenance, CLI and exclusions. The
[offline evaluation guide](analysis/OFFLINE_EVALUATION.md) covers closed-session
completeness, manifests, pre-collection freezes, local inference and reporting.
Raw real frames can no longer bypass timestamp resampling
by presenting consecutive observation numbers as a 30 Hz time axis.

### Subject-separated evaluation update (2026-09-27)

`python -m training.train --exercise ex_001` now writes to
`training/out/features-v2/subject_calibration_v2/`, preserving the preceding
evaluation artifacts. It still evaluates whole exercise sessions, with a fixed
Random Forest specification and the optional XGBoost comparison.

- Outer evaluation leaves one subject out. Both inner probability calibration
  and the final model use three subject-disjoint folds. A fold without both
  classes fails explicitly; it never falls back to mixing subjects.
- The majority baseline uses only the outer training fold's class prior.
  Pooled ranking metrics are omitted for that baseline because varying fold
  priors do not constitute a useful ranking predictor.
- Rule scores retain ROC-AUC and average precision (the field named `pr_auc`).
  They are not probabilities, so Brier, accuracy, sensitivity and specificity
  are omitted rather than interpreting a deduction of 50 as a validated cutoff.
- Classifier sensitivity and specificity use the fixed research threshold 0.5.
  This is not a deployment-approved operating point.
- The audit JSON contains 1,000 paired subject-bootstrap draws' 95% ROC-AUC
  intervals and an RF-minus-rule difference interval. The report's comparison
  uses that difference interval instead of an arbitrary 0.01 AUC margin.
  These intervals resample subjects with all their rows together and hold OOF
  predictions fixed; they do not include model-refitting, generator-design, or
  synthetic-to-real uncertainty. An interval containing zero is inconclusive,
  not evidence of equivalence.
- Each run saves an OOF CSV (IDs, labels, held-out predictions), an audit JSON
  (outer and inner row memberships, final calibration splits, input/source
  hashes and package versions), metrics, and a model sidecar with its hash,
  exercise, feature definition, class order and probability interpretation.

This improves the synthetic evaluation contract. The subsequent offline evaluator
enforces participant/condition metadata, timestamp-aware resampling/gap rejection,
session completeness and protocol compatibility before inference. Neither block
implements per-rep learning, patient-facing predictions or database writeback.
Synthetic classification remains a feasibility result.

As of 2026-09-28, compatible `subject_calibration_v2` artifacts have been rebuilt
for `ex_001` and `ex_006`. Other supported dynamic exercises need their own rebuild
with the current training command before freezing; earlier evaluation artifacts
are intentionally refused. The new arm-hold RF synthetic ROC-AUC is 0.777 versus
0.728 for the rule baseline; the paired difference interval [-0.014, 0.118]
includes zero, so superiority is inconclusive. No real-data claim follows.

Every result is reported against two baselines the model must beat or match:

1. a majority-class predictor, and
2. the rule-based compensation score reimplemented from the app's metric logic.

Results are framed as **feasibility on synthetic data**, not clinical validation.
