# Learning Plan — Understanding the Form-Quality ML Layer

A study guide for the machine-learning side of this project. Every topic is
anchored to a concrete place in this `ml/` codebase, so you are learning the
~10 concepts that explain *one working pipeline you can run and poke* — not ML in
the abstract.

## How to use this

- Read the **mental model** first; every bold term below hangs off it.
- For each topic: understand *what it is*, find it *in the code*, then read the
  *resource*. Then run the matching **experiment** — breaking a thing is the
  fastest way to understand it.
- This is active study: budget a few focused hours/day against the running code,
  not passive video-watching.

## What "understanding" means here (realistic target)

The goal is to **explain and defend every decision in this pipeline** — not to
master ML or to be able to invent new methods. This is a proof-of-concept, so
"I can justify why we did X and what the numbers mean" is the bar. That bar is
reachable in about a week of focused study. Deep fluency in the subtle parts
(calibration theory, the generator's probability distributions, synthetic-data
validity) takes longer and is not required to defend the work.

## The one-paragraph mental model

> We built a **binary classifier** (good vs compensated form) that runs on
> **engineered features** summarizing each exercise session. Its **calibrated
> probability** is presented as a **0–100 quality score**. We judge it with
> **leave-one-subject-out** cross-validation against **baselines** (a
> majority-class predictor and the existing rule-based score), using
> **ROC-AUC / PR-AUC / Brier**. Training data is **synthetic**, produced by
> sampling per-subject and per-severity **probability distributions**. Almost
> every bold word is a topic below.

## Prerequisites check (where to start)

- **Comfortable with intro stats + a little ML already?** Skip to Section B
  (Evaluation & Methodology) — that is where the project's credibility lives.
- **First time seeing most of this?** Start at Section A and go in order; budget
  extra time on the probability distributions in Section C.
- **Just need to defend it next week?** Do the "Defense-critical priorities" and
  the 7-day plan; treat the rest as reference.

---

## The topic map

### A. Foundations (the core loop)

- **Supervised learning & binary classification** — features → label; train vs
  test split. *In code:* the `label` column (0 = good, 1 = compensated) is the
  target everywhere. *Learn:* ISL ch. 2 & 4; StatQuest "Machine Learning
  Fundamentals: Bias and Variance."
- **Decision trees → Random Forest** — the primary model. Bagging; why a forest
  beats one tree. *In code:* `RandomForestClassifier` in `training/train.py`.
  *Learn:* StatQuest "Decision Trees" + "Random Forests Part 1"; ISL ch. 8.
- **Gradient boosting / XGBoost** — the secondary model; boosting vs bagging.
  *In code:* `XGBClassifier` in `training/train.py`. *Learn:* StatQuest "Gradient
  Boost Part 1."
- **Why classical ML on engineered features (not deep learning)** — small data,
  interpretability, runs offline/batch. Be ready to defend this choice.

### B. Evaluation & methodology — the credibility layer (most important)

- **Evaluation metrics** — ROC curve & **AUC**, Precision–Recall & **PR-AUC**,
  **Brier score**, confusion matrix; why **accuracy misleads** under class
  imbalance. *In code:* the results table printed by `training/train.py`; the ROC
  curve in `training/out/<exercise>_eval.png`. *Learn:* StatQuest "ROC and AUC
  clearly explained"; scikit-learn `modules/model_evaluation.html`.
- **Probability calibration** — *the* most important topic, because **the 0–100
  score IS a calibrated probability**. A raw classifier score is not a real
  probability; calibration (Platt scaling = `method="sigmoid"`, or isotonic
  regression) fixes that. Reliability/calibration curves; Brier measures it.
  *In code:* `CalibratedClassifierCV(method="sigmoid")` in `training/train.py`;
  the calibration curve in `<exercise>_eval.png`. *Learn:* scikit-learn
  `modules/calibration.html` (read this page closely).
- **Cross-validation, and specifically Leave-One-Subject-Out (grouped CV)** — why
  we split by *subject*, not by row. *In code:* `LeaveOneGroupOut` grouped on
  `subject_id` in `training/train.py`. *Learn:* scikit-learn
  `modules/cross_validation.html` (see GroupKFold / LeaveOneGroupOut); ISL ch. 5.
- **Data leakage** — train-time information that won't exist at prediction time.
  *In code:* feature columns are computed *before* merging the rule score, so the
  baseline can never become a model feature; imputation lives inside the
  `Pipeline` so it is fit on train folds only. *Learn:* Kaggle Learn "Data
  Leakage."
- **Baselines** — a result only means something *relative to a baseline*. We beat
  a majority-class floor and the existing rule-based score. *In code:*
  `baselines.py`; the bottom two rows of the results table.
- **Overfitting, generalization & the separability check** — why a single-feature
  AUC near 1.0 would be a red flag (the task would be a disguised threshold).
  *In code:* the "Top single-feature AUCs" block in `training/train.py`. *Learn:*
  ISL ch. 2 (bias–variance); StatQuest "Bias and Variance."
- **Class imbalance** — `class_weight="balanced"`; lead with AUC, not accuracy.
  *Learn:* Google ML Crash Course "Classification."

### C. The data layer (what goes in, and is it real?)

- **Feature engineering** — Tier 1 (range of motion, timing, tempo) vs Tier 2
  (the value-add). Discipline: prioritize features the rule does *not* already
  use, or the model just relearns the rule. *In code:* `features/extract.py`.
- **Movement-smoothness features** — jerk, **dimensionless jerk**, **SPARC**,
  submovement count. A real motor-control subfield. *In code:* `_smoothness()` in
  `features/extract.py`. *Learn:* Balasubramanian et al., "On the analysis of
  movement smoothness," J. NeuroEng. Rehabil. (2015).
- **Synthetic data & the sim-to-real gap** — the biggest limitation and the #1
  thing a panel will probe. "The model is only as good as the generator"; why
  results are framed as *feasibility*; domain randomization; why a real held-out
  set matters. *In code:* the generator under `generators/`. *Learn:* search
  "sim-to-real gap," "domain randomization (Tobin et al. 2017)," and "synthetic
  data fidelity vs utility."
- **The probability distributions actually used** — **Beta** (overall severity)
  and **Dirichlet** (how severity splits across deviation channels). If these are
  unfamiliar, this is a genuine gap. *In code:* `sample_session_severity()` and
  `sample_subject()` in `generators/base.py`. *Learn:* Wikipedia "Beta
  distribution" / "Dirichlet distribution"; 3Blue1Brown "Binomial / Bayes" for
  Beta intuition.

### D. Framing & domain

- **Action Quality Assessment (AQA)** — the academic framing for "score how well
  a movement was performed." *In code:* the 0–100 score is an AQA-style output.
  *Learn:* search "Action Quality Assessment survey" and skim one.
- **Pose-based rehab exercise assessment** — read 1–2 papers that classify correct
  vs incorrect rehabilitation reps to situate the contribution.

### E. Tooling (practical)

- **scikit-learn API** — `Pipeline`, `SimpleImputer` (fit on train only),
  `fit` / `predict_proba`. *In code:* `_rf_pipeline()` in `training/train.py`.
  *Learn:* scikit-learn "Getting Started" + the Pipeline page.
- **pandas / NumPy** — groupby, vectorized ops. *In code:* `features/extract.py`.
  *Learn:* "10 minutes to pandas."

---

## Defense-critical priorities (nail these three)

1. **Probability calibration** — why the score is a *calibrated probability*, and
   what sigmoid calibration does. (The code does something non-obvious here.)
2. **Synthetic-data validity / sim-to-real** — why the results are *feasibility*,
   not clinical proof, and why the real held-out test set is the credibility step.
3. **Leave-one-subject-out + data leakage** — why subject-grouped evaluation is
   the honest way to estimate generalization.

These are where examiners push hardest.

---

## Learn-by-experiment (against this code)

Run the pipeline, change one thing, watch the numbers. (Outputs land in
`training/out/`.)

- **Baseline run:** `python run.py --exercise ex_001` — read every printed number
  and match it to a concept above.
- **Calibration (clear effect):** in `training/train.py`, run the RandomForest
  through `loso_oof` with `calibrate=False`, compare the Brier score and the
  calibration curve to the calibrated run. Uncalibrated forest probabilities are
  usually visibly worse-calibrated.
- **Make the task "too easy" (synthetic-validity lesson):** increase a deviation
  coefficient in `generators/base.py` (e.g. the ROM-loss or a compensation gain),
  re-run, and watch the single-feature AUCs climb toward 1.0 and the model toward
  a meaningless "perfect." This re-creates the trap the generator is tuned to
  avoid — a vivid lesson in why clean synthetic data is dangerous.
- **Feature importance / ablation:** drop the top feature from the model and
  re-run; see how much AUC moves. Confirms the model isn't riding one feature.
- **Grouping:** switch `LeaveOneGroupOut` to a row-wise `KFold` (ignoring
  `subject_id`) and compare. Here the gap is small *by design* (labels are drawn
  per session, independent of subject) — which is itself the lesson: grouping
  matters when samples from the same subject are correlated, as real patient data
  would be.

---

## A 7-day shape (focused study)

- **D1 — Foundations.** Supervised learning, train/test, Random Forest intuition.
  Run `run.py` and map each output number to a concept.
- **D2 — Metrics.** ROC/AUC, PR-AUC, Brier, confusion matrix, why-not-accuracy.
  Study against `<exercise>_eval.png`.
- **D3 — Cross-validation + LOSO + leakage.** Do the grouping experiment.
- **D4 — Calibration.** scikit-learn calibration page; toggle calibration off/on;
  read the calibration curve.
- **D5 — Data layer.** Feature engineering, the smoothness features (skim the
  SPARC paper), Beta/Dirichlet basics.
- **D6 — Synthetic validity + AQA framing.** The limitation you must defend; do
  the "make it too easy" experiment.
- **D7 — Consolidate.** Write each concept in your own words *as it appears in
  this code*, and draft answers to the self-test questions below.

If a section clicks fast, move on; if probability is new, spend more of D5–D6
there and accept "operationally correct" over "deeply fluent."

---

## Resources (verify links before citing — they move)

- **An Introduction to Statistical Learning** — `statlearning.com` (free PDF;
  use the Python edition, ISLP). The foundation: regression, classification,
  trees/forests, cross-validation, ROC.
- **StatQuest with Josh Starmer** (YouTube `@statquest`) — best intuition-builder
  for every model and metric above.
- **scikit-learn User Guide** — these pages *are* this code's documentation:
  - `scikit-learn.org/stable/modules/calibration.html`
  - `scikit-learn.org/stable/modules/cross_validation.html`
  - `scikit-learn.org/stable/modules/ensemble.html`
  - `scikit-learn.org/stable/modules/model_evaluation.html`
- **Google Machine Learning Crash Course** —
  `developers.google.com/machine-learning/crash-course`.
- **Kaggle Learn** — the "Data Leakage" lesson (in Intermediate Machine Learning).
- **Movement smoothness** — Balasubramanian et al. (2015), "On the analysis of
  movement smoothness."
- **Probability distributions** — Wikipedia "Beta distribution" / "Dirichlet
  distribution"; 3Blue1Brown probability videos.

---

## Self-test — be able to answer these

1. What does the 0–100 score actually represent, and why is it a *calibrated*
   probability rather than a raw classifier output?
2. Why evaluate with leave-one-subject-out instead of a normal random split?
3. Why report ROC-AUC and Brier instead of just accuracy?
4. What are the two baselines, and why does beating them matter?
5. Which features can the rule-based score *not* see, and why does that let the
   model add value instead of relearning the rule?
6. How is the synthetic "compensated" class generated, and why is overlap with
   the good class deliberate?
7. What is the single biggest threat to validity, and how is it mitigated /
   honestly framed?
8. What would a single-feature AUC near 1.0 have told you?

---

## Glossary (quick reference)

- **AUC** — area under the ROC curve; probability the model ranks a random
  positive above a random negative. 0.5 = chance, 1.0 = perfect.
- **PR-AUC** — area under the precision–recall curve; more informative than ROC
  under class imbalance.
- **Brier score** — mean squared error of predicted probabilities; lower = better
  calibrated. 
- **Calibration** — making predicted probabilities match observed frequencies.
- **LOSO** — leave-one-subject-out cross-validation; each fold holds out all of
  one subject's sessions.
- **Data leakage** — using information at training time that won't be available
  at prediction time, inflating measured performance.
- **Bagging** — training many models on bootstrap samples and averaging (Random
  Forest).
- **Boosting** — training models sequentially, each correcting the last (XGBoost).
- **SPARC / dimensionless jerk** — measures of movement smoothness.
- **Beta / Dirichlet** — probability distributions over a value in [0,1] / over a
  set of proportions that sum to 1; used to sample synthetic severity.
