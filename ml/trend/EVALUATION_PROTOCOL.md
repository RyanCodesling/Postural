# Trend model: evaluation protocol v1

This protocol was frozen before any evaluation run. Its SHA-256 is recorded when it is frozen, and any change made after that is reported as a deviation.

## 1. Question

Does a Gaussian-process trend model separate real change from normal session-to-session variation better than the dashboard's current trend label (`trendStatus`)? It is tested here before it is built into the app.

## 2. Data used for learning

- **Source.** All sessions with an outcome that were recorded through the app on the local deployment, exported read-only. They come from two test accounts and are tuning recordings.
- **Use.** These sessions only set model parameters. They are never reported as held-out evidence.
- **Series.** A series is one patient × exercise × comparable context × side × measure. The comparable context is the exercise, prescribed side, resistance and measurement-configuration version. Sessions within a series are in time order.
- **Which series are learned from.** Only series with at least 3 sessions that have a valid value.
- **Sensitivity check.** Learning is repeated without session 199, a deliberate posture test. This is reported only; the primary result uses all sessions.

## 3. Model

- **Inputs.**
  - x: the session index within the series (0, 1, 2 …).
  - yᵢ: the session's mean value of the measure over its valid units (repetitions, or sets for holds).
  - nᵢ: the number of valid units in session i.
- **Within-session noise.** wᵢ = σ_u² / nᵢ, where σ_u is the pooled within-session SD of single units for that exercise × measure.
- **Observation model.** yᵢ = f(xᵢ) + dᵢ + eᵢ, where eᵢ ~ N(0, wᵢ) and dᵢ ~ N(0, τ²) is day-to-day variation.
- **Trend prior.** f is a Gaussian process on the mean-centred series with kernel
  k(i, j) = V² + V²(i − c)(j − c) + a²·exp(−(i − j)² / (2·3²)),
  where c is the mean index and V = 10·τ̂ (vague level and drift).
  - The smooth-term amplitude is a = 0.5·τ.
  - Variant V4 drops the smooth term (a = 0).
- **Handling uncertainty about τ.** τ has a log-normal prior with median τ̂ and log-SD s. It is integrated over 25 log-spaced points on [τ̂·e^(−3s), τ̂·e^(3s)], with weights proportional to prior × marginal likelihood.
- **Change estimate.** Δ = f(x_last) − f(x_first). Its posterior is the mixture over the τ grid.
- **Label.**
  - *Rising* if P(Δ > 0) ≥ p* and E[Δ] ≥ δ_min.
  - *Falling* if P(Δ < 0) ≥ p* and E[Δ] ≤ −δ_min.
  - *No clear change* otherwise.
  - *Collecting data* when there are fewer than m_min sessions.
- **Minimum change.** δ_min = 3 for peak angles (camera-estimate units) and 0 for every other measure.

## 4. Learning τ̂ and σ_u

- **σ_u** is pooled over all sessions with at least 2 valid units: σ_u = sqrt(Σ(nᵢ − 1)sᵢ² / Σ(nᵢ − 1)).
- **τ̂** is found by maximum marginal likelihood across all learning series of that exercise × measure, with left and right sides pooled.
  - The search runs over 400 log-spaced values in [0.001·σ_u, 10·σ_u].
  - During learning, the kernel uses V = 10 × the pooled SD of session means and a smooth amplitude of 0.5·τ.
- **Floor.** The value used is τ̂ = max(the maximum-marginal-likelihood estimate, 0.5·σ_u / √n_typ), where n_typ is the configuration's typical number of units per session.

## 5. Configurations tested

| ID | Exercise | Measure | Units per session (base; stress) | Angle floor in B0 |
|---|---|---|---|---|
| A | ex_001 | Mean repetition peak, per side | 10; 4 and 20 | yes |
| B | ex_001 | Mean repetition form score (raw rule, coverage ≥ 80 %), per side | 10; 4 and 20 | no |
| C | ex_005 | Mean repetition peak, per side | 10; 4 and 20 | yes |
| D | ex_006 | Time in target band as % of the prescribed hold, per side, mean over sets | 2; 1 and 4 | no |

For each configuration, the level (mean of the learning data), σ_u and τ̂ come from §4 and are reported.

## 6. Simulated series with a known truth

- **How a series is built.** yᵢ = L + g(i) + dᵢ + ēᵢ, where ēᵢ ~ N(0, σ_u²/n_units) and the model receives w = σ_u²/n_units.
- **Truths g.** Each true change is expressed as a multiple of τ̂.

  | Truth | Definition |
  |---|---|
  | Flat | g = 0 |
  | Linear | Total change over the series ∈ {±1, ±2, ±3, ±4}·τ̂ |
  | Step | −3·τ̂ on the last two sessions |
  | Rise then plateau | +4·τ̂ reached at the middle session, flat afterwards |
  | Outlier | Flat, plus +4·τ̂ on one random session |

- **Base case.** Gaussian day effects, τ_true = τ̂, base units per session, n ∈ {3, 4, 5, 6, 8, 10, 15}.
- **Stress conditions.**
  - τ_true ∈ {0.5, 1.5, 2}·τ̂, Gaussian day effects.
  - Student-t day effects with 3 degrees of freedom, scaled to SD τ̂.
  - AR(1) day effects with φ = 0.5 and stationary SD τ̂.
  - Units per session at the stress values in §5.
- **Size and seeds.** 2,000 series per cell. Seed set A (selection) is 1,000 + cell index. Seed set B (confirmation) is 500,000 + cell index.

## 7. Model variants and label thresholds

| Variant | Description | s | m_min |
|---|---|---|---|
| V1 | Primary | 0.5 | 3 |
| V2 | Wider prior on τ | 0.75 | 3 |
| V3 | Four sessions before any label | 0.5 | 4 |
| V4 | Linear only (no smooth term) | 0.5 | 3 |

The label threshold p* is chosen from {0.975, 0.99, 0.995}.

## 8. Baselines

- **B0.** The current rule. It fits a least-squares slope over the session index and computes the projected change = slope × (n − 1). It calls a trend if |projected| > max(3 for angle measures, 0.05·|mean|), and needs at least 3 sessions.
- **B1.** A least-squares slope t-test, two-sided at α = 2(1 − p*) with n − 2 degrees of freedom, plus the δ_min rule.
- **B2.** The projected change against a fixed cutoff. The cutoff is tuned on separate seeds so that its base-case false-call rate at n = 5 equals 2(1 − p*). The δ_min rule also applies.

## 9. Metrics

- **False-call rate.** The share of flat or outlier series labelled Rising or Falling.
- **Detection rate.** The share of changing series labelled in the correct direction. The wrong-direction rate is reported alongside it.
- **Card-level false-call rate.** 1 − (1 − r)⁴, where r is the per-series false-call rate. This models four independent labelled series on a card with no change.
- **Intervals.** 95 % Wilson intervals throughout.

## 10. Decision rules

1. **p\* for each variant.** The smallest p* whose base-case card-level false-call rate is ≤ 10 % at every n ≥ m_min in all four configurations (seed set A).
2. **G1, must pass: calibration at p\* = 0.975.**
   - Base-case flat false-call rate ≤ 7.5 % at every n ≥ m_min.
   - Flat false-call rate ≤ 12.5 % when τ_true ∈ {0.5, 1.5, 2}·τ̂ with Gaussian day effects.
3. **G2, must pass: better than today.** At the variant's p*, its false-call rate is below B0's in every flat or outlier cell (base and stress) where B0's rate exceeds 10 %.
4. **G3, should pass: useful detection.** At the variant's p*, base-case detection of linear changes with |change| ≥ 2·τ̂ at n ≤ 5 is at least B1's. Across all n, it is at least B2's minus 5 percentage points.
5. **Choosing the variant.** Among variants that pass G1 and G2 in all four configurations (seed set A), choose the one with the highest mean base-case detection over linear changes with |change| ≥ 2·τ̂ and n ≤ 6. Ties go to the variant with fewer assumptions, in the order V4, V1, V3, V2.
6. **Result.** GO if at least one variant passes G1 and G2 in all configurations; otherwise NO-GO. The chosen variant's reported numbers come from seed set B. Every variant's seed-set-A results are reported too.

## 11. Real-data illustration (not evidence)

The chosen variant and the current rule are both applied to each real series with at least 3 sessions. The report gives each method's label and the model's estimated change with its 95 % interval. These sessions are tuning data, so this is a description, not a test.

## Deviation 1 (recorded 2026-09-29, before the first run's decision was read)

The first run's learned inputs showed two data problems. Neither is a model problem.

1. **An aborted attempt.** Session 219 contains a single right-side lateral-raise repetition, with peak 50.9 and form score 51.6. Used as a session mean, that one repetition inflated the learned day-to-day variation: the maximum-likelihood τ came out at 9.2 for peak and 10.2 for form score.
2. **The unexercised arm.** Hold sessions prescribed for one arm also exported the other arm, whose time in band is 0 %. That value is not a measurement.

**Change (data rules v1.1).** Only the prescribed side counts. For repetition measures, a session counts only if it has at least 3 valid repetitions on that side; holds keep a minimum of 1 set. The rules apply to learning and to the real-data illustration. The simulated tests are unchanged.

**Reporting.** Both runs are reported: data rules v1 (as first registered) and data rules v1.1. The go/no-go decision uses v1.1, because v1's learned values rest on the two problems above. The same rules are proposed for the app: a side with fewer than 3 valid repetitions in a session is not plotted as a trend point.
## Amendment v2 (recorded 2026-09-29, before any v2 run)

The user approved three changes after the v1.1 run. Everything not listed here is unchanged: the model, variants, simulation grid, seeds, baselines, G1, G2 and G3.

1. **Labels only on the main measure.**
   - Rising / Falling labels go only on the main measure of each side: mean repetition peak for repetition exercises, and time in target band for holds.
   - The form score is shown with its band and estimated change, but without a label.
   - The p\* rule in §10.1 therefore uses two labelled series per card, 1 − (1 − r)², over configurations A, C and D.
   - p\* is chosen from {0.975, 0.98, 0.985, 0.99, 0.995}.
   - Variant choice (§10.5) uses mean detection over A, C and D.
   - G1 and G2 still cover all four configurations, because the form-score band is displayed.
2. **Known fault-test sessions are excluded from learning.** These are sessions 193, 194, 197, 199, 208, 212, 213 and 214. The project's records, written before this amendment, show that each was recorded with deliberately performed faults (lean, slouch, head tilt, shoulder lift, bent endpoint and similar), so none shows normal session-to-session variation.
3. **Data rules v1.1 stay.** Only the prescribed side counts, repetition measures need at least 3 repetitions on a side, and holds need at least 1 set. The same rules apply in the app.

**Values for exercises and measures without enough learning data.** These rules were fixed before the v2 run:

- **τ̂.** For a measure with no series of at least 3 sessions after the rules above, τ̂ = r × σ_u.
  - r is the median τ̂/σ_u of the learned configurations of the same measure type: peaks {A, C}, form score {B}, time in band {D}.
  - σ_u is the exercise's own pooled within-session SD when it has at least 2 sessions with 2 or more units. Otherwise it comes from a donor: ex_004 uses ex_005 (both lateral flexion measured from a signed angle), any form score uses ex_001, and holds use ex_006.
- **Floor.** Every τ̂ keeps the floor 0.5 · σ_u / √n_typ.
- **Minimum change.** δ_min = 3 for angle peaks. It is 0 for ex_007's normalized reach, for form scores and for time in band.

**Output.** The run writes the app's frozen configuration and parity fixtures. The configuration's SHA-256 is recorded at the system freeze.
## Amendment v2.1 (recorded 2026-09-29, after the v2 run returned NO-GO and before any seed-set-B run under v2)

**Why.** Under v2, the p\* rule chose 0.975 from the card-level cap alone, and variant V2 then failed G2 in three cells with AR(1) day effects (runs of good or bad days). For example, ex_001 peak at 8 sessions had 12.3 % false calls against the current rule's 11.2 %. The rule fixed the threshold before checking the must-pass gates, so it could choose a threshold that fails them.

**Change.** This change was made after seeing the v2 result and is disclosed as such. For each variant, p\* is the smallest candidate that meets the card-level cap and also passes G1 and G2 on seed set A. Everything else is as in v2.

**Reporting.** The confirmation numbers come from seed set B, which the v2 run never used. The v2 result (NO-GO) is reported alongside v2.1.
## Deviation 2 (recorded 2026-09-29; app configuration only)

**What was found.** Writing the v2.1 app configuration stopped at ex_007's peak.
- ex_007's peak is a normalized reach, not an angle, so no other exercise can serve as a donor for σ_u.
- Once fault-test session 214 is excluded, ex_007 has only one session with at least 2 units (40 repetitions), and the v2 rule asks for two.

**Change.** When an exercise has fewer than 2 qualifying sessions and no donor in the same units, σ_u comes from its own qualifying sessions, provided there is at least one. The configuration marks such a σ_u as coming from a single session.

**Scope.** Only the app configuration is affected; no evaluation result changes. In practice this applies only to ex_007's peak.
## Amendment v3 (recorded 2026-09-30, before any v3 run): more measures, as bands only

The user asked for descent control and other movement qualities. The measures below are charted with the model's band and change estimate, but are **never labelled**, so the labels and their false-call budget from v2.1 stay exactly as they are.

**New measures.** The data rules are those of v2.1: prescribed side only, at least 3 valid repetitions per side for repetition measures, at least 1 set for hold measures, and fault-test sessions excluded from learning.

| Measure | Applies to | Session value | Unit of the session value |
|---|---|---|---|
| `loweringS` | Repetition exercises, per side | Mean lowering time (descent) | Repetitions |
| `raisingS` | Repetition exercises, per side | Mean raising time (time to peak) | Repetitions |
| `completionPct` | Repetition exercises, per side | Share of repetitions classified complete × 100 | Repetitions |
| `peakSpread` | Repetition exercises, per side | SD of repetition peaks within the session | Session level: σ_u = 0; needs ≥ 3 repetitions |
| `exposure:<metric>` | Repetition exercises, per side, each scored compensation metric | Mean `overThresholdFrac` × 100 | Repetitions with a numeric value |
| `holdSteadiness` | Holds, per side | Mean `sdDeg` | Sets |
| `holdError` | Holds, per side | Mean \|`meanErrorDeg`\| | Sets |
| `holdDroop` | Holds, per side | Mean `droopSlopeDegPerSec` | Sets |

**Learning.**
- τ̂ and σ_u are estimated as in v2.1.
- Measure types:
  - timing: `loweringS`, `raisingS`;
  - completion: `completionPct`;
  - spread: `peakSpread`;
  - exposure: `exposure:*`;
  - hold quality: `holdSteadiness`, `holdError`, `holdDroop`.
- **A measure with no learnable series borrows its values:**
  - Its τ̂ = r × σ_u, where r is the median τ̂/σ_u of the learned measures of the same type. For spread, it is the median learned τ̂.
  - σ_u comes from the exercise's own data when at least 2 sessions have 2 or more units. Otherwise it comes from the same measure of ex_001 (for repetitions) or ex_006 (for holds), and failing that, from the exercise's own single session.
  - A measure whose type has no learned member gets no band.

**Check before display.** For each measure learned from its own series, the check is G1 at p* = 0.975, using V2 and flat series:
- ≤ 7.5 % in the base case;
- ≤ 12.5 % when τ_true is 0.5, 1.5 or 2 × τ̂;
- at every n in {3, 4, 5, 6, 8, 10, 15};
- 2,000 series per cell, with seeds 700,000 + cell index.

This checks that the displayed 95 % range is honest. A measure that fails is charted without a band, and a borrowed measure gets a band only if every learned measure of its type passes.

**Output.** An updated app configuration: the v2.1 main measures unchanged, plus the new measures marked `labelled: false`. Its new hash is recorded at the freeze.
## Deviation 3 (recorded 2026-09-30, after the first v3 run)

**What was found.** ex_008's completion percentage has no observed variation: every recorded repetition was complete. Its unit SD resolved to 0, which made the borrowed τ̂ 0 as well, and the model cannot run with τ̂ = 0.

**Change.** A non-session-level measure whose resolved σ_u or τ̂ is 0 is charted without a band, as having no observed variation.

**Scope.** No check result and no other value changes.
## Amendment v4 (recorded 2026-10-21, before any v4 run): the aspect-corrected unit, and the neck sessions

**Why.** Since 2026-10-21 the app measures every angle in the aspect-corrected image plane (D-48): coordinates normalised separately by frame width and height are put back on one scale before an angle is taken. The values learned under v2.1 and v3 are in the earlier pipeline units, and a model in one unit cannot be applied to readings in another. The user approved one re-learning run (2026-10-21) that also brings in the neck sessions recorded since the freeze. Everything not listed here is unchanged: the model, variants, simulation grid, seeds, baselines, G1, G2, G3, the v2.1 p\* rule and the v3 band check.

1. **Unit.** Angle measures are in the corrected unit. The export converts the sessions measured before the change, each angle on its own geometry at the session's frame shape (its recorded frame sizes, else the 1280 × 720 every pilot session used):
   - neck peaks and their rest offsets: atan(tan r / k);
   - side-bend peaks (head lean from neutral): atan(k tan r);
   - arm peaks (abduction): atan2(k sin r, cos r);
   - hold spread and drift scale by the arm conversion's slope at the hold's mean, and the distance from the target is taken after converting the mean.

   Unit-free measures (completion, form scores, times, time over threshold, time in band) are exported as recorded, because every threshold was converted to keep its decisions. On the 48 traced pilot repetitions, converting a stored peak lands within 0.05 ± 1.07 (largest 2.4) of recomputing it from the landmarks (`Review_Artifacts/2026-10-21_aspect_lift/conversion_error.txt`).
2. **Minimum change.** δ_min stays 3 for angle peaks, now in the corrected unit.
3. **Neck sessions.** ex_004's sessions recorded since the freeze are included under trend rules v2, which take each peak from the resting head (D-45): 227, 228 and 229, with 225 from before. Session 226 is excluded because the same-day redo 227, recorded with trace and video, replaced it (decided 2026-10-17, by cause, before any v4 result). With these sessions ex_004 may meet the own-σ_u rule instead of borrowing from ex_005.
4. **Run.** `trend.evaluate --rules v4` (the v2.1 settings with session 226 added to the excluded sessions), then `trend.extra --rules v4` on its output.

**Output.** A new app configuration and fixtures, whose hash is recorded in D-35. A measure that fails its check is charted as measured values only (the v3 rule). In the app, histories measured before the change show their angle measures as measured values only (D-48).
## Deviation 4 (recorded 2026-10-21, after the v4 run)

**What was found.** Item 3 of amendment v4 names trend rules v2 for the neck sessions. In fact the export applies the app's trend data rules v2 to every session: D-39's rules 1–3 (each set's first repetition out of the timing measures, poorly tracked repetitions and sessions out) and D-45's rule 4 (neck peaks from the resting head). These are the rules the app's charts have used since 2026-10-09; the v3 configuration was learned before them. They change the timing measures:
- the side bend's lowering and raising times no longer have enough qualifying series and are borrowed;
- the lateral raise's lowering time again narrowly fails its band check (12.7 % against 12.5 % at twice the learned variation), so every borrowed timing measure is charted without a band, as v3's rule requires;
- the neck's lowering and raising times are now learned from its own sessions and pass;
- the neck's completion share shows no variation and has no band (deviation 3).

**Scope.** No gate, setting or model choice changed. The run returned GO with V2 at p\* = 0.985, as v2.1 did.
