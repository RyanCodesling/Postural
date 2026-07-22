# Form-quality ML layer

Offline/batch machine-learning code for the postural monitoring system. This layer
trains a single **form-quality model**: a calibrated good-vs-compensated classifier
whose probability is surfaced as a **0–100 quality score** for the clinician dashboard.
It runs offline in Python (scikit-learn / XGBoost) on engineered features — it is **not**
part of the live browser pipeline.

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
There is currently no real-session model evaluator and no reported real-data performance
figure. A future empirical evaluation must freeze the protocol first, collect a new
untouched subject-independent set, and keep it separate from all threshold, generator, and
scoring decisions. The current reported model results are synthetic-only.

## Baselines

Every result is reported against two baselines the model must beat or match:

1. a majority-class predictor, and
2. the rule-based compensation score reimplemented from the app's metric logic.

Results are framed as **feasibility on synthetic data**, not clinical validation.
