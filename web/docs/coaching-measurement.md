# Coaching measurement foundation

This contract records existing behavior. It does not enable new coaching text,
phase gating, thresholds, aspect correction, or model inference.

## Storage and compatibility

- New sessions use context V3. `versions.coachingConfig` is a SHA-256 fingerprint
  of effective cue IDs, wording, priorities, timing defaults/overrides, rendered
  labels, and an explicit coaching algorithm version. The snapshot travels with
  it. Bump `COACHING_ALGORITHM_VERSION` for selector/latch/suppression/drawing
  semantic changes. Thresholds and metric geometry remain in the independent
  exercise measurement snapshot/version.
- The browser sends its executing configuration at Start. Legacy clients are
  accepted, with `source: server-default-unverified`. Each set stores the actual
  runtime snapshot, including when Resume uses a newer bundle than session creation.
- Context V1/V2, dynamic repetition quality V1/V2 and unversioned hold readers
  remain supported. Cue changes never enter `exerciseConfigVersion` or the
  therapist's comparable-session key.
- Isometric writers use `hold_quality_v2`. Existing fields remain at the root
  for SQL/UI compatibility. `primaryUnits: pipeline-units` disambiguates legacy
  `*Deg` names; `compensationScoreSource: smoothed-live-rule` describes the
  existing score aggregation honestly. Per-side angle statistics remain raw.
  `streakMode` distinguishes simultaneous-arm from either-side hold bookkeeping.
- Dynamic sets use `{version: "coaching_set_v1", coaching: ...}` in the same
  `set_events.hold_quality` JSONB. They have no hold-statistic fields. This avoids
  another table/migration/delivery channel for a set-scoped audit. Session detail
  returns outcome envelopes unchanged. A zero-credit audit attempt carries
  `auditOnly: true`; it is returned in `auditAttempts`, not `sets`. Session
  aggregates, calendar/trend eligibility, therapist roster activity and review
  scores exclude these attempts. Legacy unmarked sets and genuine one-sided
  partial holds still count as outcomes.
- The API validates finite numbers, ranges, tags, timing/order, movement and
  render context, and snapshot fingerprints. An otherwise valid set with an
  invalid envelope retains that exact envelope inside
  `quarantined_measurement_v1`, with its validation reason and audit-only marker.
  Its invalid quality fields are not available to quality aggregates. The API
  reports `quarantined` row indices; successful durable insertion lets the
  outbox acknowledge that evidence and continue delivering later sets. Invalid
  core set fields still use the existing row-rejection policy. No table,
  migration or new delivery channel is added.
  Provenance validates `messageRendered` as a boolean; the current configuration
  remains false. Accepting a future snapshot does not enable message rendering.

## Cue display policy (coaching_v9_cue_review_fixes)

- **v9: fixes from a review of each cue against published exercise
  instructions and measurement practice (2026-10-03).** Each cue's sources are
  in its registry comment.
  - Neck side bends (`ex_004`) judge trunk lean and LOWER once per bend, as the
    arm-raise shrug is judged (`evaluation: rep-ascent`, with `upTo` 90 so the
    whole rise counts, and no wait or cooldown). A bend lasts about 1 s, and a
    continuous cue needs about 0.9 s past its line (0.3 s to switch on, then
    0.6 s before it is shown), so a fault inside one bend could not show.
  - The LOWER arrow moves to the other shoulder once the tilt-corrected reading
    puts that shoulder higher by more than the cue's switch-off level
    (`lowerArrowShoulder`, `cueClearLevel`); smaller changes keep it in place.
    In alternating neck bends the tilt can reverse while the warning stays on,
    and the arrow stayed on the lower shoulder.
  - The trunk-lean arrow points away from the lean on two-arm exercises. A
    per-limb warning's arm side, "left" whenever both limbs read the same, had
    replaced the lean direction, so a lean to the image's right was drawn with
    its arrow pointing along the lean (`limbSideIsOverlayDirection`). A shown
    cue with no direction this frame, such as a trunk lean momentarily centred,
    keeps the direction it was last drawn with.
  - Hidden: `ex_001.shoulder-symmetry`, because in a two-arm raise the shoulder
    of the higher arm rises with it and the per-arm shrug check already covers
    one-sided shrugging; and `ex_008.elbow-flexion`, because wall-angel
    instructions ask for the arms to stay on the wall, not for straight elbows.
  - Pilot replay: the only summary change is that the arm-raise LOWER no longer
    draws during the slouch control. The arm-hold lean is now drawn with the
    lean's own direction. No measurement version changed.

- **v8: four fixes from an independent review (2026-10-02).**
  - The warning reset also clears the per-repetition shrug state, the hip
    check's state, the LOWER lock and the last drawn cue. That reset runs on
    a sustained capture dropout, Start, Resume, recalibration, a completed set
    and an exercise change, and every repetition-counter reset is paired with
    it. Before, a
    shrug flag held when tracking dropped came back when the patient
    re-entered with the arms raised. The dirty-state check also covers these.
  - A cue kept for its minimum visible time is drawn with the reading and
    direction it was last drawn with once its own reading has gone. The
    per-repetition, hip and at-rest coupled readings are absent at rest, and
    before this the renderer skipped them, so a late cue could vanish after
    0.2 s. The display gates (session, capture, baseline, near-peak,
    prescribed side) still apply.
  - The saved video's overlay track records the cue as drawn, including the
    shoulder the LOWER arrow is locked to (`cue.shoulder`, 11 or 12). Playback
    uses it; tracks saved without it redraw on the higher shoulder each frame,
    as the live drawing did when they were saved.
  - In the hip check, a frame that is not judged (no reading, a lean below
    10 degrees, or no direction) ends a pending run, so only an unbroken
    100 ms run flags a bend.
  - The pilot replay is unchanged by these fixes: its cue episodes already
    lasted over 0.7 s, and none involved a dropout, a saved video or a hip
    push.

v7 keeps everything below and adds display-only checks.

- **v7: display-only coaching checks, and a side-bend hip check.**
  - An exercise may declare `coachingChecks`: cues driven by a signal that is
    not a compensation measurement. A check goes through the same warning
    latch, cue selector, overlay and coaching audit as a compensation cue
    (`coachingWarningSpecs`). It is never scored, never written to set or
    repetition measurements, and is removed from the measurement version. Its
    threshold and settings are in the coaching configuration's `checks`.
  - `ex_005` has one check, `hipShift` (`hipShiftWarning.ts`), labelled
    "Hips shifted" and drawn as a box around the hips.
    - It measures the hip midpoint's sideways movement away from the bend
      side, in hip widths, against the stance just before the bend. The
      stance is the median of the upright frames since the previous bend,
      within the last 1.5 s.
    - The bend's direction on screen comes from the ears' offset from the
      hips, and only image x is used, so mirroring and the camera's aspect
      ratio do not matter.
    - A bend is judged from a head lean of 10 degrees. A shift of at least
      0.45 hip widths for 100 ms flags it, and the largest value is held until
      the patient is upright. The cue has no wait and no cooldown.
  - Why: exercise and range-of-motion sources name the hips or pelvis shifting
    as a side-bend compensation. It is in the camera's plane, and it inflates
    the head-lean reading, which runs from the hip midpoint to the ears.
  - The 0.45 line comes from the pilot recordings (one subject). On 118
    ordinary repetitions the largest single-frame push was 0.42. Run through
    the check's own code, every traced side-bend session gave 135 bends, none
    flagged, with a largest value of 0.418.
  - Pilot replay: never drawn, so the summary is unchanged from v6. With both
    hips moved 0.6 hip widths away from each bend in software, it was drawn on
    all 8 bends of C2. That tests the wiring only: no recording contains a
    real hip push, so detection is first tested on the groupmates'
    recordings, with the line fixed beforehand and nothing tuned on them.
  - Knee bending was not added. A front camera sees it only through the hips,
    and ordinary pilot bends already drop the hip midpoint up to 0.24 hip
    widths and tilt the hip line up to 22 degrees. Only a deep knee bend would
    stand out. The traces also store no knee points, so nothing could be
    checked before the groupmates record.

v6 keeps everything below and adds the per-repetition shrug check.

- **v6: the arm-raise shrug is judged once per repetition, while the arm
  rises.**
  - A registry cue may declare `evaluation: { mode: "rep-ascent", upTo,
    persistMs }`, on per-limb dynamic exercises only. `repWindowWarning.ts`
    then supplies that cue's warning value. For each limb, while its counter
    is rising and its primary is between the repetition start and `upTo`, the
    coupled deviation is tested against the cue's switch-on level.
  - Once the deviation has stayed at or above that level for `persistMs`, the
    repetition is flagged. Its largest deviation is held as the warning value
    until the repetition ends. Before a flag the live in-window value passes
    through; outside the window and between repetitions there is none. The
    warning latch and the cue selector then work as before.
  - The camera updates the repetition counter after the warnings, so on a
    repetition's first frame the counter still reads "waiting". A primary
    already at the start threshold on that frame counts as rising.
  - `ex_001.scapular-elevation` uses `upTo: 60` and `persistMs: 0`, with
    `minActiveMs: 0` and `cooldownMs: 0`.
    - At the pilot trace rate (about 7 frames a second) a shrug stays over the
      line for only one or two rising frames.
    - A 100 ms persistence never flagged one, and the 3 s cooldown hid the
      next repetition's shrug.
    - Live frame rates are about 20 a second, so one frame over the line now
      flags a repetition. The groupmates' recordings must show whether that
      raises false cues (no tuning on them).
  - Why the window: published sources place this shrug early in the rise. In
    the pilot data the coupled excess appeared near 30 degrees and was masked
    at the top, where the expected shoulder rise is large.
  - Pilot replay: 0% on correct form, and 70.4% of the shrug fault's frames.
    Scores, stored measurements and thresholds are unchanged.
- **Hidden on 2026-10-02:** `ex_005.scapular-elevation`. No source names
  shoulder elevation as a side-bend compensation, and the ear-to-shoulder
  reading follows the head during the bend.

v5 keeps everything below and switches coupled cues off at rest.

- **v5: coupled cues are off at rest.**
  - `compensationSignals` takes `restBelow`, the exercise's repetition start
    threshold. A `primary-coupled` warning value is absent while the primary is
    below it, because the coupled expectation comes from in-repetition frames
    and its intercept is not a resting value.
  - With two limbs, the worse side of a one-sided warning is now the larger
    signed excess, so a limb that moves less than expected cannot mask a shrug
    on the other limb.
  - Isometric exercises are unaffected.
  - Pilot replay result: the between-repetition `ex_005` shoulder/head cues
    stopped. So did every shoulder/head appearance on `ex_001` and `ex_005`:
    within a repetition the shrug residual exceeds its line only near the start
    and end (low primary), never for the 300 ms debounce, and at the top the
    expectation masks it.

v4 keeps everything below from v3 and adds three display rules.

- **Cue trigger levels.** A registry cue may declare `trigger: { on, off }`
  where its metric's `warningThreshold` sits inside the range of correct form.
  The warning latch then switches the cue on at `on` and off at `off`. Only
  display changes: the measurement threshold, the stored time over it and the
  score are unchanged.
  - Shoulder symmetry ("LOWER") on `ex_001`, `ex_004` and `ex_006` is on at 7
    and off at 5. Correct posture read 3 to 4.9, with blips to 5.9, against
    the old on level of 5 and off level of 2.5. 7 is these exercises'
    no-deduction floor.
  - Trunk lean on `ex_004` is on at 6 and off at 5, against a warning line of
    3. It has not been checked on a recording.
- **Minimum visible time.** A shown cue stays on screen for at least
  `minVisibleMs`, 700 ms by default (first 1 s; shortened at the user's
  request), even if its warning clears sooner. The
  decision reason is then `held-min-visible`, which the audit validator accepts,
  and the camera keeps drawing it. Before this rule, cues on repetitions often
  showed for only 0.2 to 0.6 s. After the minimum visible time a corrected cue
  is released at once.
- **Locked LOWER side.** The LOWER arrow stays on the shoulder (landmark 11 or
  12) it was first drawn on until the cue leaves the slot. The side is still
  picked by raw image height, which keeps it independent of mirroring. Before
  this rule it was re-picked every frame and could jump sides. Since v9 it
  moves once the other shoulder reads higher than the cue's switch-off level.

- **One-sided coupled residuals.** A `primary-coupled` warning value is the
  measured value minus the pilot fit's expectation at the current primary. The
  warning latch now triggers only on an excess (`residual >= threshold`) and
  clears at `residual <= threshold - margin`. A deficit, meaning less movement
  than the fit expects, no longer raises the cue. Static metrics keep the
  two-sided `|value|` test, and `below` metrics are unchanged. The compensation
  score still deducts on `|residual|`, so scores, thresholds, stored
  measurements and `exerciseConfigVersion` are unchanged.
- **Hidden cues.** A registry cue with `hidden: { reason, since }` failed the
  pilot replay check, or a review found it unsupported or confounded; its
  reason says which. Its warning is still evaluated and latched, and the
  coaching audit still records it in `activeLatches` and the smoothed warning
  inputs. The selector never gives it the cue slot, so it is never drawn, never
  highlights its metric card and never blocks a visible lower-priority cue.
- **The replay check.**
  - Data: the pilot replay recordings, at every tick offset.
  - A cue fails if it is drawn on more than 10% of the frames of any
    correct-form segment.
  - It also fails if it is drawn on less than 10% of the frames of its own
    intended fault, where one was recorded (mean over the offsets).
  - This is an engineering acceptance check on tuning data, not accuracy
    evidence.
- **Hidden as of 2026-10-01:**
  - `ex_005.neck-tilt`: drawn on correct side bends. The head-lean primary also
    moves with a head tilt, so the residual cannot isolate one.
  - `ex_006.scapular-elevation`: drawn on every correct hold. The fit's
    expectation at 90 degrees did not transfer between sessions.
  - `ex_006.shoulder-symmetry`: once latched by a brief spike, it stayed on
    through correct holds. The latch cleared below 2.5, under the correct-hold
    asymmetry. Shown again in v4 with its 7/5 trigger, which passes the check.
  - `ex_007.elbow-flexion`: never drawn, even on bent-arm presses. A bent press
    tops out below the near-peak gate.
- **Hidden as of 2026-10-03 (cue review):** `ex_001.shoulder-symmetry` and
  `ex_008.elbow-flexion` (see v9 above). `ex_007.elbow-flexion` stays hidden: a
  bent-arm press is a short press, which the repetition result already reports
  as partial.
- **Not evaluated.** Cues with no replay recording, including every `ex_004`
  cue and the `ex_008` trunk-lean cue, have not been checked on a recorded
  fault.

## What an observation establishes

`getMovementSnapshot()` reads current counter state, start/running maximum and
rest evidence without modifying counters. A plateau remains `ASCENDING`; there
is no invented peak phase. Bidirectional snapshots retain peak-sign attribution
and settle state. Isometric observations expose independent per-side eligibility.
The 300 ms counter continuity rule and 250 ms hold-time cap are unchanged.

The bounded `coaching_audit_v1` timeline records capture availability, movement,
suppression, selector time/reason/side, smoothed warning inputs and active latches,
and the labels returned **after actual canvas draw calls**. `declaredMessage` is
separate and remains unrendered. Raw analytical/ML inputs remain in the existing
raw trace and repetition-quality branches; warning inputs are not ML features.

Times use the browser performance clock plus a wall-clock origin. Equal adjacent
observations are coalesced, but intervals over 300 ms are explicit unknown gaps.
No absent cue is called a correction. Canvas-cleared capture loss, suppression,
no selection and inability to draw are distinct. A stopped camera is
`renderEvidence: unobserved`: a stale canvas may remain on screen, so a stop is
not evidence that a label disappeared. Draw calls alone do not prove that a
patient attended to or acted on a cue.

Coverage is explicitly `observed-portion-of-set`. At most 600 records are retained
per set; `droppedRecords` reports overflow. First/last sample timestamps and
`closedAtMs` expose unobserved head/tail intervals, including the final completion
frame (set finalization precedes that frame's draw). This is not a frame archive
or a complete-exposure/correction-latency estimator. In-flight observations are
memory-only until a set closes; reload can lose that portion. Once enqueued, the
existing durable outbox applies. End also saves an audit-only zero-credit attempt
without changing live counters or persisted outcome counts. Resume begins a new
observed portion and does not fabricate the pre-reload history.

## Automated verification and replay

From `web`:

```sh
npm run verify:coaching
npx tsc --noEmit --incremental false
npm run lint
npm run build
npm run replay:coaching -- --manifest pilot-manifest.json --out new-replay-directory
```

The verification command runs all existing TypeScript suites and the camera/API/
outbox/SQL writer-reader integration fixtures. It does not use a real camera or
database. Signed-in Start/Resume/End, permission/device behavior, trace export
and database readback still need a separate disposable occurrence.

`npm run verify:coaching:db` is a separate opt-in PostgreSQL check using the
configured `DATABASE_URL`. It executes production set writes/routes, aggregate,
detail, review and roster queries against connection-private temporary tables,
then checks trend grouping and the rendered consistency calendar. No public
rows or sequences are changed; temporary fixtures disappear on disconnect.
Authentication is a fixture here, so this is not signed-in browser acceptance.

The replay manifest declares `evidenceUse: "pilot-tuning"`, `tickOffsetsMs` and
`recordings`. Each recording supplies `id`, `sessionId`, `exerciseId`, `snapshot`
and `labels` paths relative to the manifest. Snapshots contain `sessions`, `rows`
(raw-frame database field names), and optional `reps`/`sets`. Label formats are
`source-windows` (analysis-frame/elapsed windows or core hold windows), `rep-events`
(intent joined to stored event windows, not exact physical boundaries), or
`windows` (explicit `startMs`, `endMs`, `intent`, with the original label source).
Optional `expectedRepCounts` pins independent side counts. Optional `baselineCamera`
compares against a preserved prior CameraClient source.

Replay executes the current camera loop and actual metric, filter, counter,
warning, selector, quality writer and overlay modules. Browser delivery, UI sinks,
prescription completion and persistence transport are fixtures. Historical traces
omit readiness-rejected frames and nose/knees: readiness cannot be independently
recomputed. Timing, missing indices, rejected rows, known baseline boundaries,
unknown pre-trace filter history and tick-phase sensitivity are reported explicitly.
All source/input hashes and verbatim labels are saved. Output requires a new
directory. The adapter never changes source recordings or fits a model/threshold.
These are tuning regressions and reconstructed draw calls, not held-out clinical
ground truth or measured historical cue exposure.
