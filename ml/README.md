# Form-quality ML layer

Offline/batch machine-learning code for the postural monitoring system. This layer
trains a single **form-quality model**: a calibrated good-vs-compensated classifier
whose probability is surfaced as a **0–100 quality score** for the clinician dashboard.
It runs offline in Python (scikit-learn / XGBoost) on engineered features — it is **not**
part of the live browser pipeline.

The model is proven end-to-end on one exercise (Lateral Arm Raises, `ex_001`) first, then
the same framework is replicated to the other active exercises.

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

## Layout

```
config/        exercise parameters exported from the app registry (registry.json)
generators/    synthetic feature-trajectory generator (registry-parameterized)
features/      raw trajectory -> engineered feature vector (reusable on real captures)
training/      model training, calibration, evaluation, and result artifacts
notebooks/     exploratory data analysis and result plots
tests/         unit tests for the feature extraction module
data/          generated synthetic data (git-ignored)
```

## Data

Training data is **synthetic**: realistic feature/joint-angle trajectories for correct vs
compensated form, generated per exercise from registry parameters. The "compensated" class
uses graded, correlated deviations (not a single threshold), so the model must learn more
than the rule-based score it is compared against. A small researcher-recorded real set is
*planned* as a held-out feasibility check (never for training), but is not part of this
version yet: there is no real-data loader or evaluator here, so the current results are
synthetic-only.

## Baselines

Every result is reported against two baselines the model must beat or match:

1. a majority-class predictor, and
2. the rule-based compensation score reimplemented from the app's metric logic.

Results are framed as **feasibility on synthetic data**, not clinical validation.
