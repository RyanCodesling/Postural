# Sprint Updates 

## 📌 Update-7-31-26 | *RyanCodesling*

- Consolidated the complete post–July 22 clinical-context and patient-workflow batch: typed prescription side/load, immutable runtime context, pain reporting, therapist review labels, occurrence-driven session starts, therapist-controlled order, and explicit completion acknowledgement
- Preserved completed, started, missed, cancelled, pain-stopped, and otherwise historical occurrences without rewriting their durable prescription/session context; active camera work now locks and navigates by one exact actionable occurrence
- Replaced moving per-frame tilt correction with capture-ready frozen neutral calibration shared by display, coaching, raw rule aggregation, and raw feature traces, while keeping the unprescribed limb observation-only
- Made patient and therapist outcomes follow the immutable prescription context: unilateral results show only the treated side, bilateral sides remain separate, and unlike side/load/configuration contexts are not presented as one continuous trend
- Added durable idempotent repetition/set delivery, duplicate-safe database writes, and archive-first permanent-deletion safeguards so retry or account administration cannot silently remove recorded clinical history
- Kept live rule-based coaching separate from the offline ML scorer; no model training, inference, prediction writeback, or `ml.features.extract.rep-v1` feature definition changed

### *AUTHENTICATION_SETUP.md*, *scripts\patient_exercises_pg.sql*, *scripts\exercise_programs_pg.sql*, *scripts\sessions_pg.sql*, and *scripts\exercise_occurrences_pg.sql*

- Corrected the existing-database migration order to include exercise programs between prescriptions and sessions, and documented the dependency-safe owner-script sequence
- Added constrained `prescribed_side` and typed resistance fields for prescriptions and programs; `unknown` remains migration-only for legacy rows
- Added immutable versioned prescription snapshots and session context containing the exact dose, side, resistance, exercise definition, effective compensation bands, registry/configuration hashes, application revision, and repetition-quality version used at session start
- Added terminal `pain_stopped` occurrences, structured 0–10 post-attempt pain reports, explicit terminal session reasons, and append-only `session_reviews`
- Added positive therapist-controlled `sequence_index` fields with deterministic idempotent backfill and supporting indexes for program exercises and patient prescriptions
- Upgraded only still-actionable version-1 occurrence snapshots to version 2 with their captured sequence; started and terminal history remains unchanged, and Manila calendar dates govern migration-time actionability

### *scripts\exercises_pg.sql*, *scripts\patient_therapist_pg.sql*, *scripts\patient_exercises_pg.sql*, *scripts\exercise_programs_pg.sql*, and *scripts\sessions_pg.sql*

- Changed durable user relationships to `ON DELETE RESTRICT` while keeping audit-actor references nullable and ephemeral account data independently removable
- Added duplicate preflight checks and unique `(session_id, set_index)` and `(session_id, rep_index)` indexes so deployment stops for manual review instead of deleting or merging existing outcomes
- Kept the schema scripts rerunnable and history-preserving for owner deployment

### *web\src\lib\prescriptionContext.ts*, *web\src\lib\exercises\versioning.ts*, *web\src\lib\db.ts*, and the patient-exercise, program, occurrence, and session APIs

- Centralized typed side/resistance parsing and validation, including positive-load/unit pairing and migration-only legacy values
- Made session creation the authoritative transaction: it locks the exact actionable occurrence selected by the patient, adopts that occurrence's snapshot, hashes the live registry/configuration, closes an orphaned open attempt as superseded, and returns the runtime prescription used by the camera
- Made terminal transitions first-write-wins; pain reports and identical clinician-review retries are idempotent, while changed clinician judgments append a new audit record
- Derived therapist review scores only from sufficiently covered raw rule data or isometric hold-rule data; smoothed coaching scores remain audit-only
- Kept the exact occurrence in dashboard and camera URLs. Explicit stale or non-actionable identifiers now fail closed to the schedule instead of silently selecting different work
- Ordered actionable work by state, due date, therapist sequence, exercise name, exercise identifier, and occurrence identifier without introducing a global exercise order

### *web\src\lib\pose\eventOutbox.ts*, *web\src\app\api\sessions\[id]\rep-events\route.ts*, *web\src\app\api\sessions\[id]\set-events\route.ts*, and *web\src\app\(app)\camera\CameraClient.tsx*

- Added a durable repetition/set outbox that removes items only after an acknowledged OK response, retains failed batches, prevents concurrent duplicate sends, and retries with bounded exponential backoff
- Persisted undelivered clinical outcome events in local storage for same-session recovery; tuning traces use bounded in-memory retries and report dropped batches without risking browser storage quotas
- Validated event rows independently so one malformed repetition cannot discard the rest of a valid batch, and made session completion report partial persistence when outcome events remain queued
- Replaced retry-sensitive event inserts with `ON CONFLICT DO NOTHING` backed by the unique set/repetition indexes

### *web\src\app\(app)\camera\CameraClient.tsx*, *web\src\lib\pose\captureReadiness.ts*, *web\src\lib\pose\neutralCalibration.ts*, *web\src\lib\pose\compensationSignals.ts*, and *web\src\lib\pose\poseMetrics.ts*

- Added prescribed-side-aware dynamic progress and independent isometric per-arm timing; the unprescribed side remains visible as observation and cannot satisfy the treatment target
- Applied the front-camera anatomical-side swap to unilateral wrist readiness, selected the prescribed limb for primary cards, used the matching-side residual for primary-coupled warnings, and suppressed form warnings outside an active capture-ready calibrated set
- Added a three-second neutral setup with at least 15 valid samples, a 250 ms maximum credited gap, median tilt/baseline estimates, readiness-loss pauses, and recalibration after sustained capture loss or camera restart
- Applied frozen neutral tilt to every derived metric path while retaining live hip/ear agreement as confidence metadata; `upper_body_v3`, pose-metric versioning, session-context V2, and repetition-quality V2 prevent unlike algorithms from being silently compared
- Preserved legacy `upper_body_v1`/`upper_body_v2`, session-context V1, and repetition-quality V1 readback
- Added the post-attempt pain-report step and one-click pain stop, prevented pain-stopped work from resuming before therapist follow-up, and kept that state separate from completed, missed, or adherence outcomes
- Retained the just-completed side-aware recap after reporting or decline, removed Redo from terminal patient recaps, and delayed queue removal/navigation until explicit Next or Finish acknowledgement
- Reset displayed metrics, warning labels, near-peak state, and the metric clock before paint whenever the selected occurrence changes

### *web\src\app\(app)\dashboard\patient\page.tsx*, *web\src\lib\exercises\scheduleSessionSummary.ts*, and patient schedule/session presentation

- Limited `Start Session` to actionable camera occurrences while leaving therapist-owned manual exercises in their acknowledgement workflow
- Added side-specific peak and hold aggregates. Unilateral live and persisted recaps show only the prescribed side; bilateral outcomes retain separate left/right values and asymmetry
- Reworded dynamic quality as “met full-ROM target” so counted partial repetitions are not presented as missing data
- Replaced schedule-only `paired hold` and unconditional left/right repetition wording with shared prescribed-side helpers and legacy-safe aggregate fallbacks

### *web\src\app\(app)\dashboard\therapist\assign\page.tsx*, *web\src\app\(app)\dashboard\therapist\programs\page.tsx*, *web\src\app\(app)\dashboard\therapist\patients\[id]\page.tsx*, and *web\src\app\(app)\dashboard\_components\ExerciseTrends.tsx*

- Added reusable prescribed-side and resistance controls to direct assignments and reusable programs, including before/after review text
- Added editable positive unique order fields with program-to-prescription copying; new selections use the highest retained order plus one so later additions cannot collide with preserved history
- Added pain-follow-up indicators and notifications, recorded context/version readback, and append-only review labels for agreement, form worse than score, or form better than score
- Segmented descriptive trends by exercise, prescribed side, resistance, and exercise-configuration hash, with the comparison context shown on each card

### *web\src\lib\sessionOutcomePresentation.ts*, administrative/user APIs and surfaces, and *web\src\lib\email.ts*

- Applied prescribed-side outcome wording to patient recaps, therapist summaries, set drill-downs, and trend charts while preserving bilateral asymmetry
- Made permanent user deletion transactional, archive-first, self-protected, and history-free only; prescriptions, sessions, assigned patients, owned programs/exercises, and therapist reviews block deletion and remain available through archival
- Returned the server's eligibility reason to the admin UI and corrected deletion confirmation/email wording so it no longer claims durable history is removed

### *web\scripts\export-registry.ts*, *web\scripts\export-tuning-traces.ts*, *ml\analysis\real_frames.py*, and *ml\tests\test_real_frames.py*

- Added registry and per-exercise configuration hashes to registry export output
- Added `upper_body_v3` export/readback with frozen-neutral provenance while retaining V1/V2 trace compatibility and the existing raw feature field mapping
- Added focused mapper coverage confirming V3 calibration/tilt metadata does not change offline feature values

### *Validation and deployment*

- All **34** framework-free TypeScript regression files pass, including clinical-context, typed-load, pain-state, event-outbox, frozen-calibration, legacy-version, prescribed-side presentation, deletion, ordering, exact-occurrence, actionable-queue, snapshot-version, and reset contracts
- `npx tsc --noEmit`, full `npm run lint`, and `npm run build` pass; the production build generated all **34** pages/routes and retains only the existing multiple-lockfile workspace-root warning
- The real-trace mapper passes **5** focused Python tests, including V1 compatibility and V3 frozen-tilt metadata
- Applied the five clinical-context scripts twice in a rolled-back temporary PostgreSQL schema, then deployed them through pgAdmin as `postgres`; restricted-role readback confirmed the expected columns, constraints, tables, and grants without changing the deployment baseline
- Deployed the history-protection/event DDL in one owner transaction; restricted-role readback confirmed six restrictive relationships, both unique event indexes, zero duplicate keys, and duplicate retries returning `inserted: 0, skipped: 1`
- Applied the three occurrence-workflow scripts twice against legacy-shaped temporary tables, then individually to the live database; readback confirmed sequence checks/indexes, deterministic backfill, pending-only V1-to-V2 upgrade, preservation of in-progress context, and unambiguous legacy-session links
- Authenticated HTTP verification covered typed left-only band assignment, immutable session context, pain stopping/reporting, append-only therapist review, role boundaries, ordered programs/prescriptions, and 400/409 rejection of invalid or expired exact session starts
- Real-person occurrences 262/263 verified the right-only isometric hold, left-only dynamic wrong-side negative control, readiness pauses, and prescribed-side persisted summaries
- Fresh occurrence 264 completed the retained-recap gate: after the right-only five-second hold and declined report, the camera remained on `Session complete` with `Right hold 5s / 5s`, `Sets 1 / 1`, and no Redo action until explicit Finish acknowledgement
- `git diff --check` passes with line-ending normalization warnings only

### *Remaining follow-up*

- Obtain clinician-approved `ex_004` assisted-hold parameters and retain the deferred `ex_005` threshold decision until its required live-protocol input exists
- Before new evaluation recordings, version richer in-session measurement: effective compensation exposure and movement phase, capture confidence/missingness, coaching exposure/response, and a validated isometric hold-quality contract. Preserve legacy readers and the raw-analytics-versus-smoothed-live-display boundary
- Surface those measurements first as cautious set/session therapist summaries, then evaluate one phase-aware prioritized cue in non-visible shadow mode on `ex_001` and `ex_006`. Patient-visible rollout requires replay tests, live-webcam evidence, clinician-reviewed wording/priority, and no incidental threshold changes
- Decide whether the calibrated Random Forest remains an offline thesis-feasibility artifact or becomes an application feature; real-session feature ingestion, prediction provenance/persistence, and dashboard ML scoring are not implemented
- Resolve the remaining prescription/result contracts before claiming a complete rehabilitation product: patient-specific ROM/counter intent is not prescribable, `pairedReps` is a minimum-of-sides aggregate rather than time-window pairing, and prescribed rest still exposes a skip override
- Collect a new untouched multi-subject evaluation set only after the exercise and measurement protocols are frozen; keep baseline and feedback-assisted recordings explicitly separable, and do not treat cue response as a clinical label. Researcher sessions 168–174 remain calibration evidence

## 📌 Update-7-22-26 | *RyanCodesling*

- Preserved prescription, occurrence, session, set, repetition, and raw-trace history by replacing exercise and assignment hard deletion with archival and cancellation workflows
- Reworked patient and therapist read models so prescription lifecycle, adherence, schedule status, completed outcomes, capture quality, and form quality remain separate and auditable
- Added therapist-owned manual custom exercises and a patient acknowledgement path without treating unregistered movements as camera-monitored exercises
- Completed versioned dynamic per-repetition quality persistence while keeping raw analytics separate from smoothed live coaching
- Hardened protected-page rendering, custom-exercise authorization, notification polling, and reference-media fallbacks
- Applied the data-preservation migrations to PostgreSQL and verified the complete web change set through automated, authenticated, and live-camera checks

### *scripts\exercises_pg.sql*, *scripts\patient_exercises_pg.sql*, *scripts\sessions_pg.sql*, and *scripts\exercise_occurrences_pg.sql*
- Added therapist ownership, `camera`/`manual` monitoring mode, and archive metadata for exercises; custom exercises default to manual monitoring until a validated registry definition exists
- Added prescription archive metadata plus occurrence completion/cancellation metadata so ended work remains distinguishable from deleted or still-actionable work
- Replaced the table-wide patient/exercise uniqueness constraint with an active-row partial unique index, allowing later reassignment without overwriting an archived prescription snapshot
- Changed the four history-bearing exercise, prescription, occurrence, and session foreign keys from cascading deletion to `ON DELETE RESTRICT`
- Kept the scripts idempotent, applied them as the PostgreSQL table owner, and verified the new columns, constraints, and partial index on the live schema

### *web\src\lib\db.ts*, *web\src\lib\exercises\prescriptionStatus.ts*, *web\src\lib\exercises\prescriptionStatus.test.ts*, and *web\src\lib\dataPreservation.test.ts*
- Replaced assignment removal with archival and cancellation of only future/open pending occurrences; completed occurrences and all recorded session evidence remain intact
- Replaced custom-exercise deletion with archival, ended active prescriptions safely, and retained copied program history after the catalog link is removed
- Enforced custom-exercise therapist ownership across catalog, update, archive, assignment, and program writes; camera sessions accept only active, uncancelled, registry-supported prescriptions
- Separated prescription lifecycle (`Upcoming`, `Active`, `Ended`, and `Ended early`) from adherence (`Not started`, `In progress`, `Partially completed`, and `Completed`)

### *web\src\app\(app)\dashboard\patient\page.tsx*, *web\src\lib\exercises\occurrences.ts*, *web\src\lib\exercises\scheduleSessionSummary.ts*, and *web\src\app\api\exercise-occurrences\[id]\route.ts*
- Limited the patient dashboard's primary exercise action to work that is due today or still inside its make-up window, instead of presenting expired mixed history as currently in progress
- Replaced the long schedule list with `Today`, `Next session`, and schedule-end summaries; current work remains visible while later and past dates use independently collapsible date groups
- Added compact completed-session outcomes linked by the exact occurrence ID, selecting the latest completed outcome-bearing attempt without summing retries or guessing links for legacy sessions
- Added a patient-only `Mark Complete` action for manual custom tasks; camera-monitored occurrences still complete only through recorded sessions

### *web\src\app\(app)\dashboard\therapist\patients\[id]\page.tsx*, *web\src\lib\sessionReadModels.ts*, and *web\src\lib\sessionReadModels.test.ts*
- Split current and ended prescription sections from `Completed Exercise Outcomes`, allowing an ended prescription to show its actual completed-versus-scheduled adherence result
- Restored the session-level average compensation projection used by therapist form-quality summaries
- Added capture-ready frame coverage and coarse browser/platform context to session drill-downs without exposing the stored full user-agent string
- Added set-level dynamic form quality using only authoritative raw repetition scores with sufficient coverage; smoothed live scores remain audit-only

### *web\src\app\(app)\dashboard\therapist\exercises\page.tsx*, *web\src\app\(app)\dashboard\therapist\assign\page.tsx*, *web\src\app\api\exercises\route.ts*, *web\src\app\api\exercises\[id]\route.ts*, and the patient-exercise/program API routes
- Kept built-in exercises read-only for therapists while allowing them to edit or archive only their own manual custom tasks
- Surfaced assignment, save, and archive API failures instead of treating rejected writes as successful UI updates
- Enforced ownership and monitoring-mode rules when custom exercises are listed, changed, assigned, or added to programs

### *web\src\lib\pose\repQuality.ts*, *web\src\lib\pose\poseMetrics.ts*, *web\src\app\(app)\camera\CameraClient.tsx*, and *web\src\app\api\sessions\[id]\rep-events\route.ts*
- Added independent per-side raw-sample buffers finalized by the existing smoothed repetition boundaries, without feeding smoothed display values into analytics or future ML features
- Persisted a strict version-1 payload with `rawRule`, `liveRule`, and `rawFeatures` branches plus coverage and `mlEligible`; low-coverage repetitions remain visible but are excluded from model-ready data
- Added payload size, structure, range, and version validation at the API boundary and wired the existing `rep_events.compensations` JSONB field through database insert and therapist readback
- Removed the placeholder exercise video and replaced it with an explicit written-guidance fallback; no camera frames or video are stored or transmitted

### *web\src\app\(app)\layout.tsx*, *web\src\app\(app)\dashboard\_components\NotificationBell.tsx*, *web\src\app\(app)\dashboard\admin\page.tsx*, and *web\src\app\(app)\dashboard\therapist\patients\page.tsx*
- Added a protected application layout that waits for the database-backed current-user check before rendering camera or role-specific dashboard content
- Redirected signed-out or archived users to login and redirected authenticated users away from dashboards for the wrong role
- Reworked notification audio compatibility, callbacks, and initial polling so the component remains typed and does not synchronously update state from its mounting effect
- Removed the hardcoded sample-video player from administrative and therapist surfaces and cleared the remaining full-project ESLint warnings

### *Validation*
- `npx tsc --noEmit --pretty false` passed from `web`
- Full `npm run lint` passed with **0 errors and 0 warnings**
- All **24** framework-free TypeScript regression suites passed with **0 failures**, including data-preservation, prescription-status, session-read-model, schedule-summary, occurrence, and dynamic repetition-quality coverage
- `npm run build` passed under Next.js 16.2.6 and generated all **34** routes; the existing multiple-lockfile workspace-root warning remains non-blocking
- Applied and read back the four live PostgreSQL migrations, confirming all archival/ownership/monitoring/cancellation/completion fields, four restrictive history foreign keys, and the active-prescription partial unique index
- Authenticated patient and therapist checks confirmed ended-prescription adherence, exact occurrence-linked outcomes, compensation averages, capture coverage, sanitized device context, manual-task behavior, and archive authorization
- A live 1280 × 720 camera session persisted six repetition events (three per side) and one L3/R3 set at 98% capture readiness; every repetition contained the three versioned quality branches, and therapist drill-down reported 0% count asymmetry and a 98/100 raw-rule form score
- `git diff --check` passed with line-ending normalization warnings only; source scans found no exercise/prescription hard-delete SQL, placeholder sample-video reference, ML model change, or temporary verification artifact

### *Remaining follow-up*
- Keep calibrated ML inference and dashboard writeback deferred until a frozen real-data collection protocol and untouched evaluation cohort exist
- Complete a real-person webcam pass for prescribed-side repetition/timing behavior; automated mirrored-wrist gating coverage already passes, but pose-dependent behavior cannot be claimed from an API-only session
- Obtain clinician-approved decisions for the `ex_004` assisted-hold target and the deferred `ex_005` threshold retune

## 📌 Update-7-11-26 | *RyanCodesling*

- Converted `ex_004` to an assisted side-split isometric hold and propagated the latest single-subject scoring and threshold retunes through the live registry, tuning tools, and synthetic ML pipeline
- Extended the offline synthetic-feasibility pipeline across all six active exercises while keeping the browser's rule-based feedback as the live coaching layer
- Corrected recurring-assignment status rollups so future pending dates no longer hide completed current or due work
- Replaced editable JSON authentication cookies with signed sessions and database-backed role, ownership, and therapist-assignment authorization
- Retained the pose-backend comparison harness as an exploratory archive rather than evidence for a live backend replacement

### *web\src\lib\exercises\registry.ts*, *web\src\lib\pose\poseMetrics.ts*, and *web\src\app\(app)\camera\CameraClient.tsx*
- Converted `ex_004` Neck Lateral Flexion from the historical velocity-counter configuration to an assisted, side-split isometric hold; the sign determines the held side and the slower side gates set completion
- Kept the current `ex_004` target band at 50° ± 38° (`[12°, 88°]`) as an engineering placeholder pending a clinician-approved hold angle and duration
- Propagated the pilot retunes: `ex_007 targetROM` 0.60→0.85 and `ex_008` start/complete/minimum-peak 20/10/100→85/70/110; researcher session 174 recorded 20/20 repetitions per side for `ex_008` without phantom repetitions
- Added movement-coupled compensation scoring for scapular elevation (`ex_001`/`ex_006`) and neck/scapular motion (`ex_005`), per-exercise band overrides, and per-side worst-score aggregation for per-limb exercises
- Kept the known `ex_005` candidates deferred: `targetROM` 25→~21 and `minimumPeakThreshold` 15→12; the current pilot recording reached 24.2° maximum and classified 0/40 repetitions complete under the 25° boundary

### *web\scripts\export-tuning-traces.ts*, *ml\analysis\real_frames.py*, *ml\analysis\deduction_report.py*, and *scripts\sessions_pg.sql*
- Added an opt-in `upper_body_v2` tuning-trace path across active exercises while keeping raw unsmoothed metrics separate from smoothed display and rep-boundary signals
- Added mapping, threshold-fitting, and coupled-scoring diagnostics for the researcher recordings; these are calibration and realism tools, not a real held-out model evaluator
- Documented trace-kind versioning so existing `ex_007_upper_body_v1` rows can coexist with the cross-exercise `upper_body_v2` payload
- Kept sessions 168–174 classified as researcher tuning evidence because they influenced thresholds, coupling constants, and generator realism; they cannot be reused as an untouched evaluation set

### *ml\generators\base.py*, *ml\generators\framings.py*, *ml\generators\registry.py*, and *ml\generators\ex_generator.py*
- Extended synthetic generation across all six active exercises and all three structural framings: dynamic per-limb, bidirectional alternating, and isometric holds
- Added isometric hold synthesis for time in band, settling, longest streak, exits, deviation, steadiness, drift, and side asymmetry
- Added normalized-unit generator support for `ex_007` without changing the deterministic degree-based exercise outputs
- Excluded warning-only `scoring:off` metrics from generated compensation channels and downstream model features

### *ml\features\extract.py*, *ml\baselines.py*, *ml\run.py*, and *ml\tests\test_extract.py*
- Added isometric session features and expanded rule/model evaluation across the complete active-exercise registry
- Preserved the thesis boundary: the Random Forest remains an offline session-level synthetic-feasibility scorer, not a live browser model, real-data result, medical device, or clinical validation
- Recorded the canonical synthetic ROC-AUC comparisons after the scoring retune: `ex_001` 0.841 vs rule 0.735; `ex_004` 0.780 vs 0.583; `ex_005` 0.764 vs 0.722; `ex_006` 0.782 vs 0.728; `ex_007` 0.826 vs 0.745; and `ex_008` 0.844 vs 0.744, with the majority baseline at 0.50
- Kept `ml\data\`, `ml\training\out\`, and `ml\analysis\out\` gitignored; reproduction of generated results requires recorded metrics or artifact hashes rather than Git status alone

### *web\src\lib\exercises\occurrences.ts*, *web\src\lib\exercises\occurrences.test.ts*, and *web\src\lib\db.ts*
- Added `deriveAssignmentStatus()` so a completed current or due occurrence is not reported as `In Progress` solely because the recurrence contains future pending dates
- Updated `getPatientExercises()` to derive each assignment badge from the current make-up window and due-to-date occurrence history, with the stored legacy status used only as a fallback
- Added six regression cases covering completed current occurrences, in-progress work, future-only assignments, completed due history, mixed due history, and the legacy fallback

### *web\src\lib\session-token.ts*, *web\src\lib\session-token.test.ts*, *web\src\lib\auth-server.ts*, and *web\src\proxy.ts*
- Replaced editable JSON `auth_token` cookies with HS256 `jose` tokens that pin the algorithm, issuer, audience, issued-at time, and seven-day expiry
- Added centralized server authentication that verifies the token, reloads the current PostgreSQL user, and rejects archived, missing, or invalid users before authorization decisions
- Enforced the first-login password-change requirement in the Next.js page proxy and protected API access; invalid legacy cookies are cleared and require one new login after deployment
- Replaced the deprecated `web\src\middleware.ts` convention with the Next.js 16 `web\src\proxy.ts` entrypoint
- Added regression coverage for signing, tampering, expiry, issuer/audience/algorithm checks, secret strength, cookie flags, proxy redirects, and protected-route use of the centralized helper

### *web\src\app\api\auth\login\route.ts*, *web\src\app\api\auth\logout\route.ts*, *web\src\app\api\auth\me\route.ts*, and *web\src\app\api\auth\change-password\route.ts*
- Issued and verified signed sessions from the current database user instead of trusting editable cookie data
- Made password changes authenticated-self only and refreshed the signed session after a successful change
- Kept logout stateless by clearing the browser cookie; central early revocation of a copied token remains future work

### *web\src\app\api\users\route.ts*, *web\src\app\api\users\[id]\route.ts*, *web\src\app\api\exercises\route.ts*, and *web\src\app\api\exercises\[id]\route.ts*
- Made user mutations admin-only and scoped therapist user lists to patients assigned to the verified therapist
- Required authentication for exercise reads and restricted therapists to modifying or deleting custom exercises
- Removed trust in caller-supplied role or user identity when the current database-backed session already provides the authoritative identity

### *web\src\app\api\sessions\*, *web\src\app\api\programs\*, *web\src\app\api\notifications\route.ts*, and *web\src\app\api\therapist\overview\route.ts*
- Added current-user authorization to session, raw-frame, rep-event, set-event, program, notification, patient-exercise, therapist-overview, and admin-dashboard access
- Enforced patient ownership and current therapist-assignment relationships for sensitive reads and writes
- Kept API authorization authoritative even when page-level redirects also protect the user experience

### *web\.env.example*, *web\package.json*, *web\.gitignore*, and *AUTHENTICATION_SETUP.md*
- Added the `jose` dependency and a tracked environment template while keeping real `.env` files ignored
- Required `SESSION_SECRET` to contain at least 32 random bytes and documented separate local and deployment secrets
- Removed the concrete database password from the current setup guide and documented password rotation because the old value remains in Git history
- Replaced blind `npm audit fix` guidance with an audit-and-review step that requires regression testing before breaking upgrades

### *ml\comparison\README.md*, *ml\comparison\requirements-comparison.txt*, *ml\comparison\requirements-comparison.lock.txt*, and *ml\comparison\tests\*
- Retained the June 9 pose-backend comparison as an archived exploratory harness, not an active backend migration plan
- Marked its `ex_003` clip as deprecated and its `ex_004` protocol as predating the assisted-isometric conversion, so neither can serve as current validation evidence
- Clarified that the harness measures metric noise and offline Python CPU throughput, not ground-truth pose accuracy or live browser frame rate
- Added the missing `pytest` dependency and a Python 3.12 lock file so the archived harness can be reproduced without a machine-specific saved environment

### *ml\README.md*, *ml\LEARNING.md*, and *web\README.md*
- Updated the project documentation for six-exercise synthetic coverage, the separation between live rules and offline ML, and the calibration-only use of sessions 168–174
- Documented the project-specific web setup, validation commands, registry export, privacy boundary, and proxy-versus-API authorization responsibilities
- Kept all fitted thresholds and coupling constants framed as single-subject pilot values pending multi-subject confirmation

### *Validation*
- `npx tsc --noEmit --pretty false` passed from `web`
- ESLint passed across all **33** changed and new TypeScript/TSX files
- All 19 framework-free TypeScript regression suites passed: **192 assertions, 0 failures**
- `npm run build` passed under Next.js 16.2.6; the remaining non-blocking warning is workspace-root inference because both the repository root and `web\` contain lockfiles
- `npx tsx scripts\export-registry.ts` wrote all 8 registry definitions; `ml\config\registry.json` matched the exported registry at SHA-256 `FCB4B4B597B57580197A377FEC739EE3F3F59E6D139931B4B7D2CB884D654C50`
- Both Python 3.12 environments passed `pip check`; the main ML suite passed **22/22** and the archived comparison suite passed **16/16**
- Applied the four documented authentication migrations in order and verified through the restricted application role that the archive fields, reset-token fields, `notifications` table, and required DML privileges are present
- `npm audit` reports 6 advisories (2 low, 3 moderate, 1 high, 0 critical); no unreviewed breaking fix was applied
- `git diff --check` and the committed-file self-containment scan passed with line-ending normalization warnings only

### *Remaining follow-up*
- Run the live HTTP login/logout, forced-password-change, role-authorization, archive-invalidation, and representative patient-session matrix before an exposed release
- Decide the clinical `ex_004` hold angle and duration; keep the current band labeled as a placeholder until then
- Collect future model evaluation data only after the protocol is frozen; do not reuse sessions 168–174 as held-out evidence
- Review and disposition the dependency-audit findings before deployment rather than applying a blind breaking upgrade

## 📌 Update-6-8-26 | *RyanCodesling*
- Added the first offline form-quality ML layer for thesis feasibility work: synthetic data generation, raw-frame feature extraction, rule/majority baselines, leave-one-subject-out model evaluation, and learning documentation
- Kept the ML scope explicit: this is an offline/batch, synthetic-data proof-of-concept for a calibrated good-vs-compensated quality score, not a live browser model and not clinical validation
- Added a registry export path so the Python ML generator reads exercise definitions, thresholds, target ROM, and compensation metrics from the same exercise registry used by the web app
- Added velocity-aware bidirectional rep segmentation for `ex_004` Neck Lateral Flexion to reduce passive return-stroke overshoot and near-neutral ghost counts while preserving deliberate reduced-ROM partial reps
- Updated the live camera loop to pass smoothed metric velocity into bidirectional counters and to use smoothed camera tilt for display/warning compensation metrics while preserving raw metrics for logging and ML data discipline
- Added n=1 at-rest noise measurement snapshots that explain why raw camera-tilt jitter can trigger false compensation warnings during still posture
- Activated the live camera footer telemetry so the resolution and processing frame-rate readouts report real values from the camera loop instead of fixed placeholders

### *ml\README.md*
- Documents the offline ML layer, environment setup, layout, synthetic-only data scope, baselines, and feasibility framing
- States that the current pipeline is proven end-to-end on `ex_001` first and can be replicated to other active exercises later
- Separates the offline 0-100 calibrated quality score from the live rule-based browser feedback

### *ml\LEARNING.md*
- Adds a project-specific study guide for defending the ML pipeline: binary classification, calibrated probability, leave-one-subject-out evaluation, baselines, data leakage, feature engineering, smoothness metrics, and synthetic-data validity
- Grounds each concept in concrete local files instead of generic ML theory
- Includes a one-week learning plan, experiments to run against the code, and self-test questions for thesis defense preparation

### *ml\generators\base.py*, *ml\generators\framings.py*, *ml\generators\ex_generator.py*, *ml\generators\registry.py*
- Added registry-driven synthetic session generation for dynamic per-limb and bidirectional exercise framings
- Samples subject latent factors such as strength, asymmetry, steadiness, fatigue susceptibility, and tempo so sessions are subject-correlated
- Generates good-vs-compensated labels with overlapping severity distributions so the task is not a single obvious threshold
- Emits long-format per-frame Parquet datasets plus set/session metadata under `ml\data\` for downstream feature extraction
- Leaves isometric framing as a clear future extension point rather than forcing it into the rep-based generator

### *ml\features\extract.py*
- Added rep-level feature extraction from raw per-frame trajectories: peak value, timing, hold/descent duration, completion class, smoothness, submovement count, shape checkpoints, and compensation aggregates
- Added session-level aggregation for completion rate, count/ROM asymmetry, ROM variability, tempo variability, fatigue drift, smoothness means, shape means, and per-compensation summaries
- Keeps identifiers and labels out of the model feature list to reduce leakage risk
- Maintains the raw-frame analytics path; the only internal smoothing is a short local moving average used for submovement counting

### *ml\baselines.py*
- Added majority-class and rule-based compensation-score baselines for model comparison
- Reimplemented the app's banded compensation deductions for scored metrics such as trunk lean, shoulder symmetry, neck tilt, and scapular elevation
- Aggregates rule scores per rep and then per session so long reps do not dominate the baseline

### *ml\training\train.py* and *ml\run.py*
- Added an end-to-end `generate -> extract -> train/evaluate` driver for one exercise
- Trains a calibrated Random Forest and optional XGBoost secondary model on engineered session features
- Evaluates with leave-one-subject-out cross-validation, ROC-AUC, PR-AUC, Brier score, accuracy, single-feature separability, and feature importances
- Writes trained model and report artifacts under `ml\training\out\`
- Frames the Random Forest result against the rule baseline instead of presenting standalone accuracy as clinical proof

### *ml\config\registry.json* and *web\scripts\export-registry.ts*
- Added a generated JSON copy of the web exercise registry for the Python ML layer
- Added a web-side export script that serializes `EXERCISE_REGISTRY` and runs registry validation during export
- Regenerated the JSON after the `ex_004` rep-strategy and smoothing changes so the offline config matches the current TypeScript registry

### *ml\tests\test_extract.py*, *ml\conftest.py*, *ml\requirements.txt*, *ml\requirements.lock.txt*, *ml\notebooks\ex001_eda.ipynb*
- Added deterministic tests for feature extraction, compensation-score baseline knots, registry-driven compensation columns, and bidirectional session generation
- Added Python dependency manifests for NumPy, pandas, SciPy, scikit-learn, XGBoost, matplotlib, pyarrow, Jupyter, and pytest
- Added an initial `ex_001` exploratory notebook placeholder/artifact for offline ML inspection

### *web\src\lib\exercises\registry.ts*
- Added `BidirectionalRepStrategy` with `"magnitude-settle"` and `"velocity-zero-crossing"` options
- Added optional One Euro derivative cutoff support through `primaryMetric.smoothing.dCutoff`
- Switched `ex_004` to `bidirectionalRepStrategy: "velocity-zero-crossing"`
- Tuned `ex_004` smoothing to `{ minCutoff: 0.45, beta: 0.04, dCutoff: 0.8 }` so near-neutral derivative spikes are reduced without fully muting real reduced-ROM reps
- Extended registry validation to reject bidirectional strategy metadata outside dynamic bidirectional-alternating exercises and to require positive `dCutoff`

### *web\src\lib\pose\velocityBidirectionalRepCounter.ts* and *web\src\lib\pose\velocityBidirectionalRepCounter.test.ts*
- Added a signed velocity-zero-crossing segmenter for small-range bidirectional motions such as neck lateral flexion
- Arms strokes only from a low-angle, low-velocity rest band, then launches on directed velocity away from neutral
- Suppresses passive opposite-side overshoot on return while still allowing deliberate loose-neutral alternation
- Uses a minimum stroke excursion and duration to reject small posture adjustments around the live-observed 3-8° zone
- Restored the live gate to honor the registry's 12° `minimumPeakThreshold` so 13° reduced-ROM partial reps count again
- Added synthetic regression coverage for overshoot suppression, loose-neutral alternation, rapid alternation, slow drift rejection, near-neutral ghost-count rejection, and reduced-ROM partial counting

### *web\src\lib\pose\bidirectionalRepCounter.ts* and *web\src\lib\pose\oneEuroFilter.ts*
- Extended the shared bidirectional debug snapshot with optional strategy, velocity, rest-band, armed-state, and stroke-phase fields
- Kept the existing magnitude-settle counter backward-compatible by accepting and ignoring an optional velocity argument
- Added `filterWithDerivative()` to `OneEuroFilter` so callers can read both the smoothed value and smoothed derivative without duplicating filter state

### *web\src\app\(app)\camera\CameraClient.tsx*
- Dispatches bidirectional-alternating exercises to either the existing magnitude-settle counter or the new velocity-zero-crossing counter based on registry metadata
- Passes optional `dCutoff` into primary and per-metric One Euro filters
- Stores smoothed metric velocities during the metrics pass and provides the primary metric velocity to the bidirectional rep counter
- Recomputes compensation metric inputs against the already-smoothed camera tilt before value-smoothing, warning checks, compensation scoring, and display
- Leaves `raw.metrics` untouched so raw unsmoothed values remain available for logging and the ML/analytics path
- Replaced the placeholder footer readouts with live telemetry: resolution now reflects the active video dimensions, and frame rate reports the number of pose-detection passes per second over a rolling one-second window (the realized pose-loop throughput, capped by the animation-frame/display refresh rate, not the webcam's native capture rate)
- Drives both readouts from the camera loop through refs and commits resolution only when the dimensions change, avoiding per-frame React state updates; clears both when the camera stops so a stopped or switching camera does not show stale values

### *web\src\lib\pose\poseMetrics.ts*
- Added an optional `tiltOverride` argument to `computePoseMetricsForExercise`
- Preserves the original raw per-frame tilt behavior for existing callers while allowing the camera loop to request smoothed-tilt compensation metrics for display
- Cleaned narrow lint-only unused-parameter/exhaustiveness guard warnings without changing metric behavior

### *ml\noise_measurement_inbrowser.json* and *ml\noise_measurement_realapp.json*
- Added at-rest noise snapshots from a browser pipeline and the real app camera pipeline
- Records measured jitter for shoulder symmetry, neck tilt, trunk lean, hip/ear lines, and camera tilt while the subject stands still
- Supports the smoothed-tilt compensation change by showing that tilt correction contributes to false warning flicker and that smoothing helps modestly but does not eliminate all drift

### *.gitignore*
- Added Python ML ignores for virtual environments, generated data, training output folders, `__pycache__`, `.pyc`, and notebook checkpoints

### Validation
- `npx tsx scripts/export-registry.ts` passed from `web` and wrote 8 exercise definitions to `ml\config\registry.json`
- `npx tsx src/lib/pose/velocityBidirectionalRepCounter.test.ts` passed — 7/7 velocity-profile checks
- `npx tsx src/lib/pose/bidirectionalRepCounter.test.ts` passed — 12/12 existing bidirectional-counter checks
- `npx tsc --noEmit --pretty false` passed from `web`
- Targeted ESLint passed for `registry.ts`, `CameraClient.tsx`, `oneEuroFilter.ts`, `bidirectionalRepCounter.ts`, `poseMetrics.ts`, `velocityBidirectionalRepCounter.ts`, and `velocityBidirectionalRepCounter.test.ts`
- `git diff --check` exited clean with only Git CRLF normalization warnings
- Python syntax parsing passed for 14 ML `.py` files with `python -B`
- ML pytest was not run successfully in this local environment: the system Python did not have `pytest`, and the existing ML virtualenv points at a missing Python 3.10 launcher. Recreate the ML venv from `ml\requirements.txt` before treating the Python test suite as validated.
- `npx tsc --noEmit` re-run clean from `web` after the footer telemetry change; on-screen retest of the live resolution and frame-rate readouts is still pending

---

## 📌 Update-6-7-26 | *RyanCodesling*
- Stabilized live compensation warning feedback so borderline landmark noise no longer flashes warning cards and canvas overlays on every metrics refresh
- Added display-only hysteresis and debounce for compensation warnings while leaving One Euro filtering, raw frame capture, compensation scoring, registry thresholds, and rep counting unchanged
- Kept peak-only warnings, such as elbow extension cues near overhead ROM, gated to the relevant movement phase while adding temporal persistence to the final warning display state
- Follow-up live check showed residual warnings can still be triggered near noisy threshold boundaries, but the flicker occurrence is reduced enough for the current proof-of-concept pass

### *web\src\lib\pose\compensationWarningState.ts*
- New display-layer warning latch for compensation metrics
- Added dual-threshold hysteresis so warnings turn on at the configured threshold and turn off only after clearing a small margin
- Added a 300 ms debounce window before warning state appears or disappears, matching the existing low-frequency metrics refresh cadence
- Handles both `"above"` metrics, such as trunk lean and shoulder symmetry, and `"below"` metrics, such as elbow flexion
- Uses unit-scaled margins for normalized metrics like scapular elevation so small-ratio signals are not given degree-sized deadbands
- Removes stale warning state when an exercise changes its compensation metric list or when a metric becomes unavailable

### *web\src\app\(app)\camera\CameraClient.tsx*
- Added per-metric compensation warning state that updates alongside the existing 150 ms frame-metrics cadence
- Clinical metric cards now read from the latched warning state instead of directly comparing the current value to `warningThreshold` on every render
- Resets compensation warning state on exercise changes, session start, session resume, set completion, no-exercise state, and sustained capture-readiness dropout so stale warnings do not carry into a new context
- Preserves the existing `peakRelevant` suppression for warnings that are only meaningful near peak ROM
- Shares the same latched warning decision with the canvas overlay so the left rail and camera overlay do not disagree during jitter

### *web\src\lib\pose\drawCompensationOverlay.ts*
- Added an optional active-warning set that lets the camera pass in the already-debounced warning decision
- Keeps the previous instant-threshold fallback for existing callers and tests that do not pass a latched warning set
- Continues drawing the same shoulder, trunk, neck, and generic compensation cues once a warning is active

### *web\src\lib\pose\compensationWarningState.test.ts*
- New focused no-framework regression tests for warning debounce, hysteresis deadband behavior, `"above"` and `"below"` threshold directions, suppressed or unavailable metrics, normalized margins, and stale-spec cleanup

### Validation
- `npx tsx web/src/lib/pose/compensationWarningState.test.ts` passed — 6/6 checks
- `npx tsx web/src/lib/pose/drawCompensationOverlay.test.ts` passed — 6/6 checks
- `npx tsc --noEmit --pretty false` passed from `web`
- Targeted ESLint passed for `CameraClient.tsx`, `drawCompensationOverlay.ts`, `compensationWarningState.ts`, and `compensationWarningState.test.ts`
- `git diff --check` exited clean with only Git CRLF normalization warnings
- Live follow-up confirmed the warning can still be triggered by residual landmark noise, but flicker occurrence is reduced and accepted for this sprint

---

## 📌 Update-6-7-26 | *Enah*
- Added secure password hashing using `bcryptjs` for all newly registered accounts and password modifications, protecting user data from plaintext storage
- Retained plaintext storage and verification for the three system demo credentials (`patient123`, `therapist123`, and `admin123`) to support non-disruptive testing
- Replaced the "Delete" action in Manage Users with "Archive" — archived users are blocked from logging in, but their historical records are preserved and can be fully restored by the administrator
- Added automated email notifications when user accounts are archived or restored (sent to the user and admin)
- Added a permanent user deletion feature: archived users can be permanently deleted from the database. This triggers a 2-step confirmation modal on the admin page and sends permanent deletion confirmation emails to both user and admin
- Added Email Notification feature using Nodemailer + Gmail SMTP (free, no paid API) — sends emails for account creation, password change confirmation, and forgot password OTP
- Admin adding a user now auto-generates default password as `LastName + YearOfBirth` (e.g., `DelaCruz2004`), automatically stripping common suffixes (e.g., `Sr.`, `Jr.`, `I`, `II`, Roman numerals) and punctuation from last names, and sends a welcome email with login credentials to the user's email
- Added a custom login warning for archived users: trying to log in with an archived account now returns `"Your account has been archived and you no longer have access."` instead of `"No account is registered with this email address."`
- First-time login with default password now forces the user to change password before accessing the dashboard — sends confirmation email after password is changed
- Added Forgot Password feature with 6-digit OTP email verification — user enters email → receives OTP (5-minute expiry) → verifies OTP → sets new password; wrong OTP blocks access
- Added `must_change_password` column to users table and `password_reset_otps` table for OTP storage
- Login page now shows "Forgot Password?" link and displays success message after password reset
- Admin dashboard success modal now mentions activation email sent to user after account creation
- Forgot Password now shows "No account found with this email address" error when email doesn't exist instead of silently succeeding
- Fixed admin dashboard Add User / Edit User form text color — added `text-black` to form containers so all headings, labels, inputs, and buttons are readable on white background
- Replaced emoji icons (👤, 👨‍⚕️) with inline SVG icons in admin Add User and Edit User forms, matching the sidebar navigation style
- Enabled Change Password button under Account Actions on therapist and patient View Profile — opens a frosted-glass floating modal overlay (same glassmorphic green styling as Forgot Password page) with 3-step OTP-verified flow: email auto-filled → OTP input → new password; Cancel closes the modal and returns to profile
- Refined Manage Patients page on therapist dashboard — replaced solid black card outlines with smooth `rounded-xl border-gray-200` borders with hover shadow; updated assigned exercises pills from plain gray/blue to green-themed colors matching the UI; added search icon SVG inside the search patients input with refined `rounded-xl` styling and green focus ring
- Fixed security gap where `/api/auth/reset-password` accepted any email + new password without verifying OTP was actually completed — endpoint now requires a `resetToken` issued only after successful OTP verification; direct API calls without a valid token are rejected with 401
- Added `scripts\reset_token_migration.sql` — adds `reset_token` and `reset_token_expires_at` columns to `password_reset_otps`; must be run after `email_features.sql`
- Updated both SQL migration script headers to state `REQUIRES: PostgreSQL superuser (postural)`, explain why ownership is needed, and show the exact `psql` command so other developers can run them without additional guidance
- When admin edits a user's email address, notifications are sent to the old email (informing it is no longer active), the new email (confirming it is now active for login), and the admin (audit trail) — all fire-and-forget
- Login now shows "No account is registered with this email address." when the email does not exist, distinct from the "Invalid email or password." message shown when the password is wrong
- Added duplicate email validation on the Add User and Edit User email fields — inline red error appears immediately when a typed email already belongs to another account; form submission is blocked until resolved; server-side 409 guard also added
- When admin deletes a user, a deletion notification is sent to the deleted user's email and a confirmation is sent to the admin; both fire-and-forget
- When admin adds a new user, a creation confirmation is sent to the admin listing the new user's name, email, and role
- Removed Diagnosis, Prescription, and Condition fields from Add Patient and Edit Patient forms and from the database — `scripts\user_credentials_pg.sql` now drops those columns via `DROP COLUMN IF EXISTS`
- Updated admin demo credential email from `admin@postural.com` to `accbpostural.noreply@gmail.com` — rerunning `scripts\user_credentials_pg.sql` will sync an existing admin row to the new address; all admin notification emails (email change, account deletion) go to this address since it is read from the admin's session cookie
- "Add User" and "Save Changes" buttons are now visually disabled (gray, `cursor-not-allowed`) and unclickable when the email field has a duplicate-email error, replacing the previous submit-time block-only behavior
- Edit success modal now conditionally appends "Email notifications have been sent to {oldEmail} and {newEmail} about the email address change." when the email was changed; shows plain "successfully updated." otherwise
- Delete success modal now conditionally appends "An email notification has been sent to {email}." when the deleted user had an email address on file
- Both Forgot Password and Change Password flows now block if the new password is identical to the current password — server returns 400 "New password must be different from your current password." and the Change Password page also catches this client-side before the API call
- Fixed Change Password modal (OTP flow from patient/therapist dashboard) — was missing `resetToken` in the reset-password request causing "Email, newPassword, and resetToken are required" error; modal now stores the token returned by verify-OTP and sends it correctly
- Added a real-time, in-app notification system across all dashboards (admin, therapist, patient) with continuous 3-second polling to ensure persistent updates
- Excluded login and logout actions from the notification dropdown list, redirecting them instead to temporary top-floating notification popups (toasts) that are immediately marked as read on the backend
- Built a custom audio chime using the browser Web Audio API to play a clean dual-tone melody (C5 -> E5) when new unread notifications are detected
- Implemented soft-deletion for notifications (`is_deleted` flag) so user deletions (individual or bulk) hide the alerts from their dashboards while preserving records in the database for compliance and auditing
- Added bulk deletion support via dropdown checkboxes and a trash bin icon in the notification bell layout, plus individual deletion within the notification details modal
- Integrated the notification bell component into parent layouts and headers (admin, patient, therapist) to prevent unmounting and ensure uninterrupted audio alerts and polling across pages
- Enabled automated triggers to create notifications for user log-ins/log-outs, therapist password changes on first login, therapist and exercise assignments, patient session start and completion, missed exercises, and upcoming exercises
- Styled the "Create New Program" and "Add New Custom Exercise" action toggle buttons and form submission buttons on Therapist Exercise Program page to use exact fixed widths to prevent shifting/stretching
- Streamlined patient details view under therapist's Manage Patients by removing the "View Exercise" button on Assigned Exercises and moving the status pill to the right side of the card, matching the Completed Exercises layout
- Aligned Admin Dashboard exercises management with Therapist's exercises dashboard, including system/custom categorization, search bar filtering, play-only video details modal, description-only inline editing, and deletion controls restricted to custom exercises
- Configured exercise creation flow from Admin page to automatically mark newly added exercises as Custom Exercises
- Fixed a visual bug in the Admin "Add New Exercise" form heading by adding text-gray-900 to ensure readability on white backgrounds
- Redesigned the previously empty Admin Dashboard page to be feature-rich, adding KPI metrics cards (active patients/therapists, active assignments, custom/system exercises, and total completed sessions), recent patient session logs, and quick action shortcuts to register users, assign patients, or add custom exercises
- Added a 3-second live background polling mechanism to update all admin dashboard statistics, activity logs, and recent patient sessions seamlessly in the background
- Moved login/logout popups out of floating popup toasts into a dedicated dashboard System Activity Feed, allowing admins to monitor therapist/patient login/logout logs in one place, and added a soft-deletion "Clear Feed" action that keeps raw SQL records intact for security compliance and audit logs
- Removed the redundant `runMigration.ts` runner and updated notifications SQL schema comments to align with direct manual execution via `psql` or pgAdmin (consistent with all other 9 schema migrations)

### *web\src\app\(app)\camera\CameraClient.tsx*
- Added `showTutorial` and `tutorialStep` state variables
- Added `id` attributes to 8 key elements: `cam-tour-sidebar` (☰ button), `cam-tour-status` (status dots wrapper), `cam-tour-stop` (Stop button), `cam-tour-start` (Start camera button), `cam-tour-metrics` (left rail `<aside>`), `cam-tour-feed` (center camera `<main>`), `cam-tour-exercise` (exercise stepper div), `cam-tour-session` (session controls div)
- Added **How to Use** button with inline info SVG icon, rendered as an outlined teal button to the right of Start camera
- Added `TOUR_STEPS` constant array (7 entries) outside the component — each entry carries `targetId`, optional `anchorId`, `title`, `lines[]`, `placement`, and optional `cardH` / `aboveGap` overrides
- Added `CameraTour` standalone function component: reads target and anchor bounding rects via `useEffect` + `useState`, computes card position per placement, renders an SVG dim-with-cutout overlay, a pulsing ring div, a backdrop click-to-close div, and the tooltip card with teal header strip, bullet list, animated step dots, and Back / Next / Got it navigation
- Added `ReactNode` to the React named imports

### *scripts\email_features.sql*
- Added `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE`
- Added `CREATE TABLE IF NOT EXISTS password_reset_otps` with user_id FK, email, otp, expires_at, used, created_at
- Added `CREATE INDEX IF NOT EXISTS idx_otp_email ON password_reset_otps(email, used)`
- Added `GRANT CREATE ON SCHEMA public TO postural` and `GRANT ALL ON SCHEMA public TO postural`
- Added `GRANT ALL ON TABLE password_reset_otps TO postural` and sequence grants for the `postural` application user
- Header updated — now explicitly states `REQUIRES: PostgreSQL superuser (postural)` with reason and exact run command: `psql -U postural -d postural -f scripts/email_features.sql`

### *scripts\reset_token_migration.sql*
- New migration script — adds `reset_token VARCHAR(64)` and `reset_token_expires_at TIMESTAMP` columns to `password_reset_otps`
- Added `CREATE INDEX IF NOT EXISTS idx_otp_reset_token ON password_reset_otps(email, reset_token) WHERE reset_token IS NOT NULL`
- Must be run after `email_features.sql`; requires `postural` superuser: `psql -U postural -d postural -f scripts/reset_token_migration.sql`

### *scripts\notifications_pg.sql*
- New SQL schema script — creates `notifications` table structure, defines the `is_deleted` column, applies indexing and role grants, and includes `ALTER TABLE` safeguards for existing databases to support soft-deletion of alerts


### *web\src\lib\email.ts*
- New Nodemailer email utility with Gmail SMTP (smtp.gmail.com:587) using `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` env vars
- `sendAccountCreationEmail()` — welcome email with login credentials (using password hint instead of plaintext), login link, ACC Bacoor green-themed branding
- `sendPasswordChangedEmail()` — confirmation email with security warning
- `sendOTPEmail()` — 6-digit OTP code with 5-minute expiry warning
- Graceful fallback when SMTP is not configured (logs warning, does not crash)
- `sendEmailChangedToOldAddress(oldEmail, name, newEmail)` — notifies old address that it is no longer active for login, shows old/new email side by side
- `sendEmailChangedToNewAddress(newEmail, name, oldEmail)` — notifies new address it is now active, includes Log In button
- `sendEmailChangedAdminNotification(adminEmail, userName, oldEmail, newEmail)` — audit notification to admin with old/new email and user name
- `sendAccountCreatedAdminEmail(adminEmail, newUserName, newUserEmail, newUserRole)` — notifies admin of new account creation with name, email, role, and a note that activation email was sent to the user
- `sendAccountArchivedUserEmail(email, name, role)` — informs archived user their account has been archived
- `sendAccountArchivedAdminEmail(adminEmail, archivedName, archivedEmail, archivedRole)` — archiving confirmation to admin
- `sendAccountRestoredUserEmail(email, name)` — notifies user their account has been restored
- `sendAccountRestoredAdminEmail(adminEmail, restoredName, restoredEmail, restoredRole)` — restoration confirmation to admin
- `sendAccountDeletedUserEmail(email, name, role)` — informs permanently deleted user that their records have been removed
- `sendAccountDeletedAdminEmail(adminEmail, deletedName, deletedEmail, deletedRole)` — permanent deletion confirmation to admin

### *web\src\lib\db.ts*
- Added `mustChangePassword: row.must_change_password ?? false`, `isArchived: row.is_archived ?? false`, and `archivedAt: row.archived_at ?? null` to `mapUser()`
- Updated `createUser()` and `updateUserPassword()` to hash passwords via `hashPassword` before saving
- Added `updateUserPassword(userId, newPassword)` — updates password and clears `must_change_password` flag
- Added `setMustChangePassword(userId, value)` — sets the `must_change_password` flag
- Added `getUserRawById(id)` — returns raw DB row including password for verification
- Added `createOTP(userId, email, otp, expiresAt)` — inserts OTP record
- Updated `verifyOTP(email, otp)` — now returns `string | null` (the reset token) instead of `boolean`; on success generates a 64-char hex `resetToken`, stores it with a 15-minute expiry in `reset_token` / `reset_token_expires_at`, marks OTP as used, and returns the token
- Added `validateAndConsumeResetToken(email, token)` — checks token against DB (not expired), nulls it out on match so it is single-use, returns `boolean`
- Added `invalidateOTPs(email)` — marks all unused OTPs for an email as used
- Added `isEmailTaken(email, excludeId?)` — returns `true` if another account already uses this email; `excludeId` omits the current user during edits
- Added `archiveUser(id)` — archives a user by setting `is_archived = TRUE` and `archived_at = NOW()`
- Added `restoreUser(id)` — restores a user by setting `is_archived = FALSE` and `archived_at = NULL`
- Added `getUserByEmailWithArchived(email)` helper to query users regardless of their archive status
- Updated query filters to prevent archived users from logging in
- Removed `diagnosis`, `prescription`, `condition` from `mapUser()`, `createUser()` signature and INSERT query, and `updateUser()` type and column map
- Added notification helper functions: `createNotification()`, `createAdminNotification()`, `getNotifications()` (gated to ignore soft-deleted ones), `markNotificationAsRead()`, `markAllNotificationsAsRead()`, `deleteNotification()`, and `deleteMultipleNotifications()`
- Added `syncTimeNotifications()` to query, format, and generate notifications for missed exercise occurrences or upcoming exercises starting tomorrow
- Refactored `deleteNotification()` and `deleteMultipleNotifications()` to soft-delete notifications by updating `is_deleted = TRUE` instead of hard-deleting
- Added automatic trigger hooks to `createSession()` (exercise started) and `endSession()` (session / exercise completed) to notify the assigned therapist
- Added `getAdminDashboardData(adminId)` to query stats (KPI metrics), recent login/logout notifications (activity logs), and recent completed patient sessions

### *scripts\user_credentials_pg.sql*
- Added `is_archived` (boolean) and `archived_at` (timestamp) columns with index on `is_archived`
- Removed `ADD COLUMN IF NOT EXISTS` lines for `diagnosis`, `prescription`, and `condition`
- Added `DROP COLUMN IF EXISTS diagnosis`, `DROP COLUMN IF EXISTS prescription`, `DROP COLUMN IF EXISTS condition` — safe to re-run on existing databases
- Changed admin demo credential email from `admin@postural.com` to `accbpostural.noreply@gmail.com` in the INSERT block
- Added `UPDATE users SET email = 'accbpostural.noreply@gmail.com' WHERE id = 'admin_001'` after the INSERT so rerunning the script syncs an existing admin row to the new address

### *web\src\app\api\auth\login\route.ts*
- Added `mustChangePassword: user.must_change_password ?? false` to the login JSON response body
- Separated null-user and wrong-password cases: returns "No account is registered with this email address." (401) when email is not found, and "Invalid email or password." (401) when password is wrong
- Updated password verification to use `comparePassword` to support both hashed and plaintext credentials
- Replaced `getUserByEmail` with `getUserByEmailWithArchived` and added a check for `user.is_archived` to return a custom error message (`"Your account has been archived and you no longer have access."`) with a 403 Forbidden status
- Triggers admin notification (`createAdminNotification`) on successful therapist or patient login

### *web\src\app\api\auth\logout\route.ts*
- Triggers admin notification when user logs out, capturing user's role and full name

### *web\src\app\api\auth\change-password\route.ts*
- New POST endpoint — validates userId, currentPassword, newPassword; verifies current password using `comparePassword`; updates password via `updateUserPassword()`; sends confirmation email; refreshes auth cookie
- Added same-password guard — returns 400 "New password must be different from your current password." if newPassword equals the verified current password
- Triggers admin notification when user changes their default password on first login

### *web\src\app\api\auth\forgot-password\route.ts*
- New POST endpoint — generates 6-digit OTP via `crypto.randomInt()`, stores with 5-minute expiry, sends OTP email
- Returns 404 with "No account found with this email address" when the email doesn't match any account

### *web\src\app\api\auth\verify-otp\route.ts*
- New POST endpoint — verifies OTP against DB, returns 400 with "Invalid or expired OTP" if invalid
- Now returns `{ success: true, resetToken }` on success — `resetToken` is a 64-char hex token with a 15-minute expiry, required to call `/api/auth/reset-password`

### *web\src\app\api\auth\reset-password\route.ts*
- New POST endpoint — requires `resetToken` validated via `validateAndConsumeResetToken()` (returns 401 if missing, invalid, or expired); blocks same-password with 400 "New password must be different from your current password." by checking via `comparePassword`; updates password via `updateUserPassword()` and sends confirmation email

### *web\src\app\api\users\route.ts*
- POST now sets `must_change_password = TRUE` on newly created users via `setMustChangePassword()`
- Sends welcome email fire-and-forget after user creation (does not block response)
- Sends `sendAccountCreatedAdminEmail` to the admin (email read from auth cookie) fire-and-forget after user creation
- Returns `{ user, emailSent }` in response
- POST now checks `isEmailTaken(email)` before creating — returns 409 "This email address is already registered to an account." if duplicate
- Strips name suffixes (`Sr.`, `Jr.`, Roman numerals like `I`, `II`, `III`, `IV`, etc.) and punctuation from last names during default password generation
- Removed `diagnosis`, `prescription`, `condition` from POST body destructuring and `createUser()` call

### *web\src\app\api\users\[id]\route.ts*
- PUT fetches the existing user before updating to detect email changes; if email changed, fires `sendEmailChangedToOldAddress`, `sendEmailChangedToNewAddress`, and `sendEmailChangedAdminNotification` (admin email read from auth cookie) — all fire-and-forget
- PUT checks `isEmailTaken(email, id)` before updating — returns 409 if email already belongs to another account
- Replaced the DELETE handler to archive users (`is_archived` and `archived_at`), OR permanently delete users from the database if `?permanent=true` query param is provided, sending archiving or permanent deletion notification emails to user and admin
- Added PATCH handler supporting `{ action: "restore" }` to restore an archived user and send restoration emails to user and admin
- Triggers therapist assignment change notification: notifies therapist (`Patient Assigned`) and patient (`Therapist Assigned`) if the therapist ID is updated

### *web\src\app\api\notifications\route.ts*
- New API route endpoint — handles GET (retrieving all notifications, filtering out login/logout events for standard bell list), PUT (marking single/all notifications as read), and DELETE (soft-deleting single or multiple notifications)
- Disabled `realtimeLogs` popup triggers by returning an empty array to silence login/logout toast popups

### *web\src\app\api\admin\dashboard\route.ts*
- New API route endpoint — handles GET (retrieving stats counts, recent system activity notifications, and recent completed patient sessions) for authorized admins

### *web\src\app\api\patient-exercises\route.ts*
- Triggers patient notification (`Exercises Assigned`) upon successful POST of exercise assignments

### *web\src\app\(auth)\change-password\page.tsx*
- New force-change-password page — same glassmorphic card design as login page (green theme, background image, floating labels)
- Three password fields (Current, New, Confirm) each with show/hide toggles
- Validates password match, POSTs to `/api/auth/change-password`, redirects to role-based dashboard on success
- No back/skip button — user must change password to proceed
- Added client-side same-password check before API call — shows error immediately if new password equals current password

### *web\src\app\(auth)\forgot-password\page.tsx*
- New 3-step forgot password page with visual step indicator (circles with connecting lines, checkmarks for completed steps)
- Step 1: Email input → POSTs to `/api/auth/forgot-password`
- Step 2: 6 individual OTP digit boxes with auto-focus, backspace navigation, paste support; 5-minute countdown timer; resend OTP link
- Step 3: New Password + Confirm Password fields → POSTs to `/api/auth/reset-password` with `resetToken` stored from Step 2 → redirects to `/login?reset=success`

### *web\src\app\(auth)\login\page.tsx*
- Added "Forgot Password?" link below password field (green underlined text)
- Added `mustChangePassword` check after login — redirects to `/change-password` if true
- Added `?reset=success` query param detection — displays green success banner after password reset
- Wrapped component in `<Suspense>` boundary for `useSearchParams()` Next.js compatibility

### *web\src\app\(app)\dashboard\admin\page.tsx*
- Replaced the "Delete" button/action on active users with an amber "Archive" action, opening a confirmation modal explaining that the user will be blocked from accessing the system but their records remain intact
- Added an "Archived Users" list under an "Archived Users" header, showing the archival date, a green "Restore" action button to reactivate accounts, and a red "Delete" action button to permanently delete the account
- Implemented a 2-step permanent deletion confirmation modal warning flow for archived users to prevent accidental deletion
- Updated `handleConfirmAdd` success message to conditionally include email notification text: "An activation email with login credentials has been sent to {email}"
- Added `text-black` to Add User and Edit User form container divs so all headings, labels, inputs, and buttons are readable on the white modal background
- Replaced emoji icons (👤 Patient, 👨‍⚕️ Therapist) with inline SVG icons — Patient uses a person silhouette (`M12 12c2.21...`), Therapist uses Material Design `medical_services` briefcase with cross icon — in role selection buttons, Add User heading, and Edit User heading
- Removed Diagnosis, Prescription, and Condition from `User` interface, `newUser` initial state, patient validation, Add Patient form, Edit Patient form, Add preview modal, and Edit preview diff table
- Added `emailError` and `editEmailError` states — email inputs in both Add and Edit forms check the already-loaded `users` list on every keystroke; a red inline error appears instantly if the email is already in use; form submission (`handleAddUser`, `handleSaveEditUser`) is blocked while an error is present
- "Add User" button is disabled and grayed (`bg-gray-400 cursor-not-allowed`) when `emailError` is set; "Save Changes" button is disabled and grayed when `editEmailError` is set — both buttons restore green styling automatically once the error clears
- Fixed "Assign to Therapist" dropdown text not readable — added `text-black bg-white` to the select element
- Integrated global `<NotificationBell />` header component to display admin-specific notification chimes, details modal, and delete options

### *web\src\lib\crypto.ts*
- New password hashing and comparison utility using `bcryptjs`
- Implemented smart password comparison fallback: checks if the hash begins with standard bcrypt signatures, falling back to plaintext comparison if not (for demo credentials)

### *web\package.json*
- Added `bcryptjs` and `@types/bcryptjs` dependencies

### *web\src\app\(app)\dashboard\_components\ChangePasswordModal.tsx*
- New frosted-glass modal component (`bg-green-800/55 backdrop-blur-sm border border-green-700/50`) for OTP-verified password change
- 3-step flow: Step 1 email auto-filled (read-only) → Step 2 six OTP digit boxes with auto-focus, paste, backspace, countdown timer, resend → Step 3 new password + confirm with show/hide toggles
- Cancel button on every step closes the modal; success auto-closes after 1.5 seconds
- Shared by therapist profile and patient dashboard
- Fixed missing `resetToken` — now stores the token from verify-OTP response in state and includes it in the reset-password request body

### *web\src\app\(app)\dashboard\_components\NotificationBell.tsx*
- New UI component for in-app notifications — features a bell icon with dynamic unread badge count, C5->E5 dual-tone audio chime alerts on new updates, w-[28rem] width, checkboxes for multi-selection, bulk deletion via a trash icon, and individual details viewing modal overlay with a single "Delete" option

### *web\src\app\(app)\dashboard\therapist\profile\page.tsx*
- Enabled Change Password button — removed `disabled` and `cursor-not-allowed`, added `onClick` to open `ChangePasswordModal`
- Added `showChangePassword` state and `ChangePasswordModal` rendering with therapist email

### *web\src\app\(app)\dashboard\patient\page.tsx*
- Enabled Change Password button — removed `disabled` and `cursor-not-allowed`, added `onClick` to open `ChangePasswordModal`
- Added `showChangePassword` state and `ChangePasswordModal` rendering with patient email
- Integrated global `<NotificationBell />` header component to check and display patient-specific notification alerts

### *web\src\app\(app)\dashboard\therapist\patients\page.tsx*
- Replaced solid black card borders with smooth `border border-gray-200 rounded-xl` and added `hover:shadow-sm` transition
- Updated `statusColor()` from gray/blue pills to green-themed pills (`bg-green-100 text-green-700`, `bg-green-50 text-green-600`) with subtle green borders
- Replaced plain search input with a search icon SVG (`Material Design search`) inside a relative wrapper, `rounded-xl border-gray-200` with `focus:ring-green-400`

### *web\src\app\(app)\dashboard\therapist\layout.tsx*
- Integrated global `<NotificationBell />` header component in the therapist layout wrapper, ensuring uninterrupted continuous polling and audio chime playback across views

### *web\src\app\(app)\dashboard\therapist\exercises\page.tsx*
- Aligned card styles to match the Manage Patients design
- Added a green **View** button that displays a play-only video preview of `/sample-video.mp4` with the description
- Updated the **Edit** action button to red, locking name modifications and allowing updates only to the description
- Removed display of raw exercise IDs
- Added a custom styled confirmation modal overlay for deleting custom exercises

### *web\src\app\(app)\dashboard\therapist\programs\page.tsx*
- Styled "+ Create New Program" and "+ Add New Custom Exercise" buttons with an exact fixed width (`w-60`) and height (`h-10`) with centered alignment, preventing size changes when toggling cancel
- Styled program form save/cancel buttons with exact width `w-40` and height `h-10`, and custom exercise form save/cancel buttons with exact width `w-48` and height `h-10`, ensuring visual alignment

### *web\src\app\(app)\dashboard\therapist\patients\[id]\page.tsx*
- Removed the "View Exercise" button from Assigned Exercises cards
- Relocated the exercise status pill ("In Progress" / "Not Started") to the right side of the card, styled to match the Completed Exercises pill layout

### *web\src\app\(app)\dashboard\admin\page.tsx*
- Copied system/custom exercise lists, search filtering, and description editing logic from therapist's exercises page
- Bound new state variables (`editingId`, `editDesc`, `saving`, `exerciseQuery`, `viewingExercise`, `showDeleteConfirm`, `deleteTargetId`, `deleteTargetName`) to support exercises list features
- Added `isCustom: true` payload to added exercises in `handleAddExercise` so newly added admin exercises are custom by default
- Declared helper subcomponents `AdminExerciseRow` and `VideoPlayer` at the bottom of the file
- Rendered play-only `/sample-video.mp4` preview modal and styled trash-icon deletion confirmation dialog for custom exercises
- Added `text-gray-900` class to the "Add New Exercise" form heading to ensure readability
- Redesigned the previously empty Dashboard tab to include stats KPI cards, quick actions bar, recent sessions table, and recent system activity feed layout, with slide-in entry animations for new logs
- Bound dashboard stats and activity feed data to fetch automatically on mount or tab select, and added background polling every 3 seconds for live dashboard updates
- Linked clearing of system activity logs to calling the notifications DELETE API with a persistent database-wide clear action so they stay cleared across admin sessions
- Handled loading states using the existing therapist/patient `Skeleton` loader components (`SkeletonKpiRow`, `SkeletonTable`) for design consistency

### Validation
- `npm run build` passed — 33/33 pages compiled successfully
- `npx tsc --noEmit` checks passed cleanly
- All new API routes registered: `/api/auth/change-password`, `/api/auth/forgot-password`, `/api/auth/verify-otp`, `/api/auth/reset-password`, `/api/notifications`, `/api/admin/dashboard`
- All new pages registered: `/change-password`, `/forgot-password`
- Existing databases must run `scripts\user_credentials_pg.sql`, `scripts\email_features.sql`, `scripts\reset_token_migration.sql`, and `scripts\notifications_pg.sql` (which includes the `ALTER TABLE` statement for existing tables) as the `postural` superuser (via pgAdmin Query Tool or psql) before using the email, forgot-password, and notification features
- Gmail App Password must be configured in `web\.env.local` (`SMTP_PASS`) before emails will be sent

### How to Use - Camera Module
- Added a **How to Use** button in the camera header, positioned to the right of Start camera (button order: Stop → Start camera → How to Use)
- Clicking How to Use launches a 7-step interactive spotlight tour that highlights and explains each part of the camera UI — no external library, pure inline React
- The tour dims the screen without blurring it; a transparent SVG cutout spotlights the active element, and a pulsing teal ring (via `@keyframes tour-pulse`) draws attention to it
- A floating tooltip card with a CSS triangle arrow appears near each highlighted element; the arrow points toward the target and the card repositions itself per step (below / above / left / right) using live `getBoundingClientRect()` measurements
- Added `anchorId` field so a step can spotlight one element (e.g. the whole camera feed) while anchoring the card to a different element (e.g. the metrics panel) to keep the card on screen and readable
- Added `cardH` and `aboveGap` overrides per step so tall cards and bottom-of-screen targets (session controls) do not overlap the highlighted buttons
- Arrow is suppressed on steps with no spotlight target (step 6 — Clothing & Environment), which falls back to a centered card over the dimmed screen

**Tour steps:**
1. **Start Camera** — highlights the Start camera button; explains the camera permission flow
2. **Status Indicators** — highlights the AI ready / Capture OK dots; explains green vs orange state
3. **Your Assigned Exercise(s)** — highlights the exercise stepper card with left/right arrows; explains how to navigate between assigned exercises
4. **Camera View** — spotlights the full camera feed; card anchors off the left metrics panel so it appears inside the camera area; explains positioning, distance, and lighting
5. **Live Metrics Panel** — highlights the left rail; explains movement angle numbers and colour-coded warnings
6. **Clothing & Environment** — no spotlight (centered card); explains that dark clothing on dark backgrounds, backlighting, busy walls, and low light reduce pose tracking accuracy; advises plain contrasting clothes and a clear well-lit space
7. **Start Session & End** — highlights the Start session / End buttons in the session controls panel; explains the 3-2-1 countdown, early End, auto-save, and how to redo an exercise using Restart if not satisfied

---

## 📌 Update-6-6-26 | *RyanCodesling*

- Added dashboard-wide toast notifications and loading skeletons so patient and therapist pages give lighter-weight feedback during assignment, deletion, session save, and data-load states
- Replaced assignment/delete success modals with non-blocking toasts while preserving the existing error modals and confirmation preview flow
- Hardened camera session-save feedback so "Session saved" appears only after the session-end PATCH succeeds, with separate pending/failure states for in-flight or failed persistence
- Added therapist patient-detail reporting polish: print/PDF layout support, print-only report header/footer, and a visible "Print / Save as PDF" action
- Added a therapist-facing Form Quality card that surfaces the current rule-based isometric compensation score as a labeled heuristic, plus a clearly reserved calibrated score slot for future integration
- Hardened the patient-session query so malformed legacy `hold_quality.meanCompensationScore` JSON cannot crash the dashboard aggregate
- Added therapist assignment cadence controls so prescriptions can repeat every day, every other day, every 3 days, twice weekly, three times weekly, or on custom weekdays across a bounded date range
- Added a per-occurrence schedule model so recurring prescriptions expand into dated exercise occurrences with make-up windows, per-day completion status, and legacy backfill support
- Rebuilt the patient Session tab and consistency calendar around scheduled occurrences, including due today, make-up available, missed, partial, complete, upcoming, and rest-day states
- Enforced a strict scheduled-occurrence lock for patient camera starts so future, missed, or unscheduled exercises cannot create unsaved local-only sessions
- Updated therapist roster progress and attention states to use scheduled occurrence due/completed/missed counts instead of assignment-level status alone
- Deferred untested `ex_008` live-tuning trace expansion from this commit; the durable raw-trace path remains `ex_007`-only until `ex_008` can be tested live
- Existing databases must rerun `scripts\patient_exercises_pg.sql` and `scripts\exercise_occurrences_pg.sql` before using the recurrence schedule, make-up window, or strict occurrence-lock behavior

### *web\src\lib\ToastContext.tsx*, *web\src\app\layout.tsx*, and *web\src\app\globals.css*
- Added a global `ToastProvider` around the authenticated app shell
- Added success, info, and error toast variants with manual dismiss and timed auto-dismiss behavior
- Added the shared toast entrance animation in global CSS

### *scripts\patient_exercises_pg.sql*, *scripts\exercise_occurrences_pg.sql*, and *scripts\sessions_pg.sql*
- Added recurrence fields to `patient_exercises`: recurrence kind, interval length, weekday set, start date, and inclusive end date
- Added the `exercise_occurrences` table for one scheduled row per assigned exercise per due date
- Added `makeup_until` so an overdue occurrence remains startable until the day before the next scheduled occurrence or the end of the assignment window
- Added `sessions.occurrence_id` so persisted sessions link to the specific scheduled day they fulfilled
- Backfilled legacy assignments into one occurrence on their assigned date, filled missing make-up deadlines defensively, and linked legacy sessions when the match is unambiguous

### *web\src\lib\exercises\occurrences.ts*
- Added shared day-key helpers for interval and weekly recurrence generation using pure `YYYY-MM-DD` calendar math
- Added schedule expansion that derives each occurrence's make-up deadline from the next scheduled due date
- Added occurrence and calendar rollup helpers for completed, in-progress, due, overdue, missed, partial, complete, and rest states
- Added cadence display helpers and scheduling caps so a single assignment cannot materialize an unbounded schedule

### *web\src\app\(app)\camera\CameraClient.tsx*
- Changed session-ending persistence to return `saved`, `pending`, `skipped`, or `failed`
- Shows "Session saved" only after the session-end request returns OK
- Shows an info toast when a patient session is still finalizing and an error toast when the save request fails
- Avoids showing a false saved-success toast for staff/debug sessions where no patient assignment is being persisted
- Loads patient occurrences alongside assigned exercises and computes the exercises actionable today
- Disables Start with a "Not scheduled today" state when the selected patient exercise is not due today or inside its make-up window
- Waits for `/api/sessions` to create the persisted session before entering countdown, and stays idle with a visible notice if the server returns the strict-lock 409 or a save failure
- Keeps staff/debug camera sessions outside the patient schedule lock

### *web\src\app\(app)\dashboard\therapist\assign\page.tsx*
- Uses global toasts for successful assignment and delete operations
- Removes the large success modals while keeping the existing preview, delete confirmation, and error modal paths
- Replaced the single scheduled-date input with a Repeat dropdown plus start/end dates
- Added interval presets and weekly weekday selection for recurring exercise assignments
- Validates schedule windows, interval bounds, and weekly weekday selection before POSTing assignments
- Shows recurrence details in the assignment preview and existing-assignment cards
- Restores saved recurrence fields when loading existing assignments or cancelling edit mode, so a recurring assignment does not silently revert to a one-day schedule

### *web\src\app\api\patient-exercises\route.ts*
- Patient GET now returns both assigned exercises and their scheduled occurrences
- Assignment POST validates recurrence kind, interval days, weekday sets, start/end dates, and maximum recurrence span before persistence
- Sends normalized recurrence data to the database helper so each assignment can materialize its occurrence rows consistently

### *web\src\app\(app)\dashboard\_components\Skeleton.tsx*
- Added reusable dashboard skeleton primitives: `SkeletonBar`, `SkeletonCard`, `SkeletonKpiRow`, and `SkeletonTable`
- Replaced centered loading text with layout-matching skeleton states on the patient dashboard, therapist home dashboard, and therapist patient-detail page

### *web\src\app\(app)\dashboard\therapist\layout.tsx*
- Added print-specific layout classes so therapist reports hide navigation chrome and remove screen-only spacing while printing
- Forces the therapist shell into the light color scheme so print/report screens keep the intended contrast even on dark-mode browsers

### *web\src\app\(app)\dashboard\therapist\patients\[id]\page.tsx*
- Added a print-only Patient Progress Report header with generated timestamp and patient name
- Added a "Print / Save as PDF" action for therapist-facing patient reports
- Added a print-only disclaimer footer that keeps the proof-of-concept, non-medical-device scope visible on exported reports
- Added a Form Quality section with a rule-based 0-100 heuristic averaged from scored isometric hold sessions
- Added a separate "Calibrated form-quality score — coming soon" slot so the future calibrated score is visible as planned work without presenting it as live
- Added loading skeletons for the patient-detail view

### *web\src\app\(app)\dashboard\patient\ConsistencyCalendar.tsx*
- Changed the calendar from session-only coloring to scheduled-occurrence adherence coloring
- Shows completed, partial, make-up available, missed, due/upcoming, and rest-day legend states
- Keeps streak, active-day, and total routine counts based on outcome-bearing sessions so accidental starts still do not inflate progress

### *web\src\app\(app)\dashboard\patient\page.tsx*
- Fetches scheduled occurrences from `/api/patient-exercises` alongside the existing exercise and session summaries
- Rebuilds the Session tab as a due-date grouped schedule with progress-to-date counts
- Enables Start only for due-today and make-up-available occurrences, disables future occurrences, and labels closed windows as missed
- Passes occurrences into the consistency calendar so dashboard adherence matches the actionable schedule
- Forces the patient shell into the light color scheme so dashboard contrast stays consistent on dark-mode browsers

### *web\src\app\(app)\dashboard\therapist\page.tsx*
- Changed roster progress to completed scheduled occurrences over due scheduled occurrences
- Shows missed occurrence counts inline in the Progress column
- Flags patients as needing attention when they have missed scheduled occurrences, even if the assignment itself still exists

### *web\src\app\api\sessions\route.ts*
- Maps unscheduled patient start attempts to HTTP 409 when the database helper finds no actionable occurrence for today

### *web\src\lib\db.ts*
- Added an Asia/Manila day-key helper so schedule locking and occurrence rollups match the patient-facing calendar day
- Persists recurrence rules during assignment and materializes matching occurrence rows with make-up deadlines
- Regenerates only future pending occurrences on assignment edits so past adherence and completed days are preserved
- Derives assignment status from occurrence rows instead of relying on one sticky assignment-level status
- Added `getPatientOccurrences()` for the patient schedule tab, consistency calendar, and camera start gate
- Links new patient sessions to the actionable scheduled occurrence for today and marks that occurrence in progress
- Completes the linked occurrence when a session finishes all prescribed work
- Returns therapist roster due, completed, and missed occurrence counts, using a defensive make-up deadline fallback for legacy rows
- Added guarded aggregation for `hold_quality.meanCompensationScore` in `getSessionsForPatient()`
- Casts JSONB compensation scores only when the value is a JSON number, so malformed or legacy rows become `NULL` and are skipped by `AVG()`
- Returns `avgCompensationScore` for dashboard consumers that can render the current rule-based heuristic

### *web\scripts\seedDemo.ts*
- Seeds interval cadence fields on demo assignments
- Seeds matching occurrence rows for completed, in-progress, missed, make-up, due-today, and upcoming schedule states
- Prints an occurrence tally so demo seeding confirms the schedule rows were populated

### Validation
- `npx tsc --noEmit --pretty false` passed from `web`
- Focused `npx eslint` over the modified camera, dashboard, helper, database, and layout files exited with 0 errors; remaining warnings are the existing patient-dashboard `loadData` hook dependency and therapist-assign ternary expression warning
- Targeted schedule-lock validation passed for the camera, patient dashboard/calendar, therapist assignment/dashboard, patient-exercises API, sessions API, `db.ts`, and `occurrences.ts` with 0 errors and the same 2 known warnings
- `git diff --check` exited 0, with only Git CRLF normalization warnings
- DB migration, demo seed, and live browser verification for the recurrence schedule flow still need to be run against a development database

--- 

## 📌 Update-6-4-26 | *RyanCodesling*

- Expanded the patient dashboard from a simple start screen into a useful home view with consistency stats, a monthly activity calendar, and assigned-exercise status cards
- Added outcome-aware calendar counting so accidental or zero-outcome session starts do not inflate streaks, active days, or total completed routine counts
- Added session end-reason tracking so the dashboard can distinguish completed sessions, deliberate early endings, superseded open rows, and still-open in-progress attempts
- Added open-session cleanup when a newer session starts for the same assigned exercise, preventing older abandoned rows from pinning dashboard status labels
- Added a post-session camera recap so patients can review the exercise they just finished before redoing it, moving to the next exercise, or returning to their schedule
- Added cross-session progress trend charts to the therapist patient-detail page and the patient-facing My Progress tab, including exercise-specific primary metrics, separate left/right completion series, and descriptive trend badges
- Moved the trend-card and chart rendering into shared dashboard components so patient and therapist progress views use the same outcome-bearing session grouping and left/right display rules
- Rebuilt the therapist home page into a dashboard with patient activity KPIs, setup/inactivity counts, and a linked patient roster
- Refined the patient Dashboard tab so consistency and assigned-exercise summaries sit side by side on wide screens and stack cleanly on smaller screens
- Added a deterministic demo-data command for populating dashboard KPIs, patient statuses, session history, and trend-chart states
- Preserved the existing date-gated Session tab as the actionable scheduled-exercise surface while using the Dashboard tab as a read-only progress summary
- Added a migration-safe `sessions.end_reason` column; existing local databases must rerun `scripts\sessions_pg.sql` or apply the `end_reason` ALTER before using this branch
- Added a durable patient-only `ex_007` upper-body motion trace for live tuning of shoulder-press starting position and movement path, storing raw unsmoothed metrics plus selected pose landmarks without storing video
- Added a body-relative wrist lateral-path metric so later analysis can distinguish a vertical press above the shoulder from inward or outward wrist drift
- Added a dedicated raw-frame API surface for saving and retrieving motion traces without loading large per-frame payloads into ordinary session-detail reads
- Tuned the `ex_007` partial-rep discard floor from `0.4` to `0.21` after controlled wrist-height traces separated low lifts from deliberate medium partial presses
- Added directional yellow compensation-overlay cues for shoulder asymmetry, trunk lean, and neck tilt, including mirroring-safe helper coverage for the front-camera display
- Clarified overhead capture-readiness feedback so the patient is asked to keep the whole body in frame instead of being told to place the head near the top
- Existing databases must rerun `scripts\sessions_pg.sql` before using the new `ex_007` motion-trace recording path
- Cleared the commit-blocking TypeScript ESLint errors in the camera/session persistence path, database helper typings, and One Euro profiling script while preserving the existing runtime behavior

### *scripts\sessions_pg.sql*
- Added `end_reason` to the `sessions` table definition
- Added a safe `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS end_reason TEXT`
- Documented the supported end reasons: `user`, `completed`, `superseded`, and `NULL` for still-open sessions
- Added the metric-only `raw_frames` table with session/frame/set indexes, elapsed and wall-clock timestamps, a versioned trace kind, raw metrics JSON, and selected pose-landmark JSON
- Added an explicit no-video schema contract, a session/frame uniqueness guard, a session lookup index, and grants for the `postural` database user

### *web\package.json*
- Added `npm run seed:demo` as the dashboard demo-data command

### *web\scripts\seedDemo.ts*
- Added a deterministic, transaction-based demo-data generator for the existing therapist and patient demo accounts plus additional `demo_*` patients
- Resets only the known demo account content and `demo_*` rows before reseeding so repeated runs produce the same populated dashboard state
- Populates patient assignments, therapist programs, sessions, set outcomes, rep outcomes, hold-quality summaries, activity states, and trend-chart examples
- Reads `DATABASE_URL` from the environment or `web\.env.local`

### *web\scripts\profileOneEuroFilter.ts*
- Tightened the synthetic peak-index local from `let` to `const` so the profiling helper no longer blocks full ESLint

### *web\src\lib\db.ts*
- Updated `createSession()` to close older open sessions for the same assigned exercise as `superseded` when a new session starts
- Updated `endSession()` to persist `end_reason`, with completed sessions recorded as `completed`
- Updated `getSessionsForPatient()` to return `endReason`, `setCount`, and `totalReps` for dashboard summaries
- Added `getTherapistRoster()` to return each assigned patient's outcome-bearing session activity, last active date, assigned-exercise count, and completion count
- Counts therapist activity from sessions with at least one set or rep outcome so abandoned starts do not inflate the home dashboard
- Added `RawFrameRow`, `insertRawFrames()`, and `getRawFramesForSession()` for durable metric-only trace batches
- Replaced remaining broad `any` usage in user mapping, query parameters, and profile-update parameter access with safer typed records/unknown arrays

### *web\src\app\api\sessions\[id]\route.ts*
- PATCH now accepts `endReason` and forwards it to the session persistence helper
- Empty PATCH bodies remain supported for stale-session cleanup paths

### *web\src\app\api\sessions\[id]\raw-frames\route.ts*
- Added an explicit raw-motion-trace endpoint kept separate from ordinary session detail responses
- Patient POST writes require session ownership and validate bounded frame batches, indexes, timestamps, trace kind, metrics, and landmark payloads
- GET allows patients to retrieve their own traces and therapists to retrieve traces only for assigned patients

### *web\src\app\api\therapist\overview\route.ts*
- Added a therapist-only overview endpoint for the home dashboard
- Returns the signed-in therapist's patient roster rollups and exercise-program count

### *web\src\app\(app)\camera\CameraClient.tsx*
- Manual End now sends `endReason: "user"` so deliberate early endings can be labeled accurately
- Stashes the End-button reason while session creation is still in flight so fast early endings on slow networks still persist as user-ended
- Completed all-sets sessions continue to close through the completed path
- Non-user exercise switches and stale session cleanup close sessions without marking them as user-ended
- Added a post-session summary overlay for the camera's ended state
- Dynamic exercise recaps show separate left/right completion totals, average peak versus target, an asymmetry label, and completed sets
- Isometric exercise recaps show hold time versus target and completed sets without presenting rep counts
- Added Redo, Next exercise, and patient schedule navigation actions using the existing camera flow handlers
- Patient `ex_007` sessions now record valid active frames before smoothing or rep-state processing, including wrist vertical/lateral path, shoulder abduction, elbow flexion, scapular elevation, upper-arm distance, trunk lean, shoulder symmetry, tilt reference, and the minimal analysis landmarks needed for later recomputation
- Raw-frame batches flush periodically, at set boundaries, and at session end; staff debug sessions remain non-persistent
- Added a patient-facing notice that the motion trace stores raw metrics and pose landmarks only, not video
- Preserves three-decimal precision for the normalized `ex_007` wrist-height signal before rep counting so low and medium partial motions are not collapsed into the same one-decimal bucket
- Removed stale local exercise/patient types, replaced API-response `any` casts with `unknown`-based row parsing, removed MediaPipe landmark `any` casts, and fixed hook-dependency warnings through stable cleanup refs

### *web\src\lib\exercises\registry.ts*
- Updated `ex_007.minimumPeakThreshold` from `0.4` to `0.21`, between the observed smoothed low-lift maximum (`0.18`) and medium-partial minimum (`0.24`)
- Kept the existing `startThreshold`, `repCompleteThreshold`, and `targetROM`; the controlled trace supported the current start/return behavior and the existing complete-versus-medium separation

### *web\src\lib\pose\poseMetrics.ts* and *web\src\lib\pose\wristShoulderLateral.test.ts*
- Added `computeWristShoulderLateral()` as a raw analysis metric for same-side wrist drift relative to the shoulder
- Positive values mean outward drift from the body midline, negative values mean inward drift, and the body-relative axis keeps the metric camera-roll invariant
- Added synthetic coverage for vertical alignment, inward/outward sign behavior on both sides, camera-roll invariance, and off-frame wrist rejection

### *web\src\lib\pose\wristShoulderVertical.test.ts* and *web\src\lib\pose\peakRelevantGating.test.ts*
- Added live-tuned `ex_007` boundary coverage for low wrist lifts, medium partial presses, and full presses after the `minimumPeakThreshold` adjustment
- Updated peak-relevant compensation-gating cases so compensation warnings stay tied to clinically relevant motion ranges instead of low-amplitude setup noise

### *web\src\lib\pose\captureReadiness.ts*
- Updated the overhead-mode `MOVE_CLOSER` readiness copy to ask for whole-body framing
- Kept the non-overhead feedback unchanged, where asking for the head near the top remains the intended framing cue

### *web\src\lib\pose\drawCompensationOverlay.ts* and *web\src\lib\pose\drawCompensationOverlay.test.ts*
- Replaced the generic amber warning treatment with yellow correction cues for active compensation warnings
- Draws paired shoulder boxes plus a downward `LOWER` arrow on the elevated shoulder for shoulder-asymmetry warnings
- Draws `STRAIGHTEN` arrows for trunk lean and neck tilt, with anatomical left/right direction converted safely for the mirrored front-camera canvas
- Added pure helper coverage for anatomical side-to-screen direction and elevated-shoulder selection so mirroring-sensitive overlay logic is regression-tested

### *web\src\app\(app)\dashboard\patient\ConsistencyCalendar.tsx*
- New patient consistency calendar component
- Marks active days only from sessions with at least one set or rep outcome
- Shows current streak, active days this month, total outcome-bearing sessions, month navigation, today highlighting, and per-day session counts
- Uses the same Asia/Manila day-key convention as the patient session schedule

### *web\src\app\(app)\dashboard\patient\page.tsx*
- Fetches `/api/sessions` alongside patient profile and assigned exercises
- Adds the consistency calendar to the Dashboard tab
- Adds a read-only assigned-exercises summary with isometric-aware prescription text
- Adds a My Progress tab that renders per-exercise trend cards from the patient's own outcome-bearing sessions
- Extends the local session summary shape with exercise kind, average peak, left/right completed reps, and paired hold time so the shared trend component can render patient progress without another API surface
- Uses the latest session per exercise to map `in_progress` assignments to either `In Progress` or `Ended Early`
- Places the consistency calendar and assigned-exercises summary side by side on large screens while preserving a stacked mobile layout
- Moves the general Start Session action into the assigned-exercises summary header

### *web\src\app\(app)\dashboard\therapist\page.tsx*
- Replaced the one-line therapist welcome screen with a dashboard home view
- Added KPI cards for Patients, Sessions this week, Programs, No exercises yet, and Needs attention
- Added a patient roster with Last active, This week, Progress, and Status columns
- Links patient names to their therapist patient-detail pages
- Added loading, empty, and error states plus horizontal table scrolling for narrow screens

### *web\src\app\(app)\dashboard\_components\TrendChart.tsx*
- New shared SVG line-chart component for one or two numeric series
- Shows plotted points, connected lines, latest values, and min/max scale context without adding a charting dependency

### *web\src\app\(app)\dashboard\_components\ExerciseTrends.tsx*
- New shared per-exercise trend grouping and card component used by both the therapist patient-detail page and the patient My Progress tab
- Filters out zero-outcome started-then-abandoned sessions before charting so accidental starts do not create false trend points
- Uses the exercise registry to classify dynamic versus isometric cards, keeps left and right completed reps separate, and labels the trend statistics as descriptive rather than diagnostic

### *web\src\app\(app)\dashboard\therapist\patients\[id]\page.tsx*
- Added a Progress Trends section above the existing Sessions Record
- Groups outcome-bearing sessions by exercise and orders each group from oldest to newest
- Uses average peak value for dynamic exercises and paired hold time for isometric exercises
- Keeps completed left and right reps as separate chart series so the asymmetry signal is not hidden
- Adds Improving, Plateau, Regressing, and low-data states using descriptive session-level statistics
- Derives exercise kind from the registry first so legacy or abandoned sessions with no set row cannot mislabel isometric trend cards
- Replaced the page-local trend chart and grouping helpers with the shared dashboard trend components

### *Validation*
- `npx tsc --noEmit --pretty false` passed from `web/`
- `npx tsx src/lib/pose/wristShoulderLateral.test.ts` passed 5/5
- `npx tsx src/lib/pose/wristShoulderVertical.test.ts` passed 13/13, including the live-tuned ex_007 low/partial/complete boundary coverage
- `npx tsx src/lib/pose/drawCompensationOverlay.test.ts` passed 6/6 for the mirroring-sensitive overlay helpers
- `npx tsx src/lib/pose/peakRelevantGating.test.ts` passed 17/17 for the updated compensation-gating ranges
- The full pose test sweep passed 116/116, including the new wrist lateral-path and ex_007 boundary coverage
- Targeted ESLint passed for the new raw-frames API route, wrist lateral-path test, wrist vertical-path test, and exercise registry
- Focused ESLint passed for the therapist dashboard page, therapist overview route, trend chart component, and demo-data script
- Focused ESLint for the patient dashboard files and session id route passed with the existing `loadData` hook-dependency warning only
- `npx eslint` now completes with 0 errors; 9 warning-level items remain in older admin/auth/dashboard/pose files
- Targeted `npx eslint "src/app/(app)/camera/CameraClient.tsx"` is clean with 0 errors and 0 warnings
- The demo-data command completed successfully and produced the same counts on a repeated run
- Browser verification confirmed the patient dashboard, therapist home dashboard, and therapist patient-detail trend charts render with populated demo data
- Responsive checks at desktop and narrow mobile widths showed no page-level horizontal overflow; the therapist roster table remains contained by its horizontal-scroll wrapper
- `git diff --check` passed on the scoped tracked files, with line-ending warnings only
- Live webcam validation is still required for the camera post-session recap, and the `end_reason` database migration is still required before deployment
- Live patient `ex_007` validation recorded a completed 3 x 12 run with 3,722 raw metric frames across all three sets, 72 side-specific complete reps, and 99.6% capture-ready coverage
- Two controlled wrist-height calibration traces separated low lifts (smoothed peak at or below `0.18`), deliberate medium partial presses (at or above `0.24`), and full presses (at or above `0.85`) across both sides
- Offline replay with three-decimal rep-counter input and `minimumPeakThreshold: 0.21` discarded every observed low lift, recorded every observed medium press as partial, and kept every observed full press complete
- Live patient confirmation in reverse order recorded the expected `6/6` result: three full presses per side were complete, three medium presses per side were partial, and three low wrist lifts produced no rep events
- The good-form and controlled-partial traces supported keeping the existing `ex_007` start, completion, and target-ROM thresholds
- The `raw_frames` migration was applied and verified with the restricted application database user able to select and insert trace rows; other existing databases must still rerun `scripts\sessions_pg.sql` with a migration account

---

## 📌 Update-5-31-26 | *RyanCodesling*

- Added durable session persistence for patient camera runs: sessions now create a session row, write dynamic `rep_events`, write set-level `set_events`, and end with optional capture-quality summary data
- Added session API routes for creating sessions, ending sessions, and saving rep/set events with patient ownership checks before accepting writes
- Added `scripts\sessions_pg.sql` for the session persistence schema, including `sessions`, `rep_events`, `set_events`, indexes, permissions, and safe re-run column additions for existing local databases
- Added clinician-facing session history on the therapist patient detail page, showing recent sessions with duration, set count, left/right completion counts, average peak value, and total hold time
- Added expandable session drill-down rows so therapists can inspect per-set hold outcomes for `ex_006` and reconstructed per-set rep summaries for older dynamic sessions that have reps but no set records
- Updated `ex_006` persistence so completed timed holds save set-level results and hold-quality summaries instead of synthetic rep rows
- Added capture-quality tracking during active camera sessions so analytics can distinguish poor tracking coverage from poor exercise performance
- Updated assignment status lifecycle: starting a patient session moves a pending assignment to in-progress, completing all prescribed sets marks it completed, and re-prescribing the same exercise resets the assignment to pending with the refreshed prescription values
- Cleaned up the patient-detail data-loading effect so the therapist session dashboard passes the targeted hook-dependency lint check

### *scripts\sessions_pg.sql*
- New schema file for the session analytics surface
- Added `sessions` table for one row per camera run, including patient, assigned exercise, exercise id, start/end timestamps, optional device info, capture-quality summary, and notes
- Added `set_events` table for completed or partial set outcomes, including dynamic rep counts, isometric hold totals, duration, termination reason, asymmetry index, and optional `hold_quality`
- Added `rep_events` table for counted dynamic reps, including session/set indexes, side, peak value, target ROM, timing fields, classification, and timestamps
- Added indexes for session, set, and rep lookups
- Added safe `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements for optional metadata columns so existing local databases can rerun the script
- Added grants for the `postural` database user and the new table sequences

### *web\src\app\api\sessions\route.ts*
- New `GET /api/sessions` route for session-history summaries
- Patients can fetch their own session history
- Therapists can fetch a patient's session history only when that patient is assigned to them
- New `POST /api/sessions` route for starting a patient camera session
- Session creation verifies the `patientExerciseId` belongs to the signed-in patient and matches the requested exercise before writing a session row

### *web\src\app\api\sessions\[id]\route.ts*
- New `GET /api/sessions/[id]` route for session drill-down details
- Returns set and rep details for patients viewing their own sessions or therapists viewing assigned patients
- New `PATCH /api/sessions/[id]` route for ending a session
- Ending a session stamps `ended_at`, accepts capture-quality summary data, accepts optional notes, and can mark the linked assignment completed when all prescribed sets were finished

### *web\src\app\api\sessions\[id]\rep-events\route.ts*
- New patient-only batch insert route for counted dynamic rep rows
- Validates session ownership before accepting writes
- Validates positive indexes, finite peak and target values, non-negative timing values, allowed side/classification values, and parseable timestamps before insertion

### *web\src\app\api\sessions\[id]\set-events\route.ts*
- New patient-only batch insert route for set-level outcomes
- Validates session ownership before accepting writes
- Validates set indexes, exercise kind, target/count fields, hold totals, duration, termination reason, asymmetry index, and timestamps
- Accepts `holdQuality` only when it is a plain object so malformed optional hold-quality data does not break an otherwise valid set row

### *web\src\lib\db.ts*
- Added session persistence types for `RepEventRow` and `SetEventRow`
- Added `createSession()` for writing session starts and moving pending assignments to in-progress
- Added `endSession()` for ending sessions, saving capture-quality summary data, and marking fully completed assignments completed
- Added `getSessionOwner()` for route-level ownership checks
- Added `insertRepEvents()` and `insertSetEvents()` batch helpers
- Added `getSessionsForPatient()` for therapist/patient session summary cards
- Added `getSessionDetail()` for drill-down set and rep details
- Updated reassignment behavior so re-prescribing the same exercise refreshes prescription fields and resets the assignment status to pending

### *web\src\app\(app)\camera\CameraClient.tsx*
- Added client-side session lifecycle persistence for patient camera sessions
- Sends session-start data with the current `patientExerciseId` and exercise id
- Persists dynamic counted reps to `rep_events`
- Persists set-level outcomes to `set_events`, including isometric `ex_006` hold results
- Sends `hold_quality` summaries for completed timed holds
- Sends session-end data with capture-quality totals and completion status
- Tracks total and acceptable capture frames during active sessions, including no-landmarks frames in the total denominator
- Uses session-token guarding so stale async session-start responses are not adopted by a newer run

### *web\src\app\(app)\dashboard\therapist\patients\[id]\page.tsx*
- Added session summary and session detail types for the therapist patient detail dashboard
- Fetches patient session history from `/api/sessions?patientId=...`
- Added the Sessions Record section with duration, set count, left/right completion counts, average peak value, and isometric hold totals
- Added expandable session rows that lazily fetch `/api/sessions/[id]`
- Shows per-set timed-hold details for `ex_006`
- Reconstructs legacy dynamic session details from `rep_events` when set rows are not available
- Shows a distinct empty state when a legacy session has neither set records nor rep records
- Moved the initial data loader inside its `useEffect` so the page passes the hook-dependency lint check

### *Validation*
- `npx tsc --noEmit --pretty false` passed from `web/`
- Targeted ESLint for the therapist patient detail page and session API routes passed with `--max-warnings=0`
- Full pose test sweep passed 108/108
- Browser verification confirmed `ex_006` set details, reconstructed legacy rep details, and empty-session messaging
- Direct DB-path verification confirmed re-prescribing resets assignment status to pending
- `git diff --check` passed with line-ending warnings only

---

## 📌 Update-5-29-26 | *RyanCodesling*

- Refreshed the patient camera screen into a clinical three-rail workflow: left live metrics, centered camera/pose surface, right session controls and reference video, plus a bottom posture/hold/time strip sized for patients standing away from the screen
- Restored readable patient guidance during capture-readiness pauses and kept the narrowed tilt-confidence behavior from the previous camera warning fix
- Cleaned up countdown/session controls so the guided exercise flow stays locked and consistent during starting, active, rest, ended, and completed states
- Kept `ex_006` isometric display consistent in the refreshed camera surface by showing timed holds instead of rep-only prescription text
- Added tilt-reference regression coverage and updated validation notes for the camera UI refresh branch

### *web\src\app\(app)\camera\CameraClient.tsx*
- Reworked the camera page into a patient-facing clinical layout with a top status bar, left live-metrics rail, centered video/canvas surface, bottom posture/hold/time strip, progress strip, and right-side session/capture controls
- Added responsive stacking so narrow viewports keep the camera, metrics, and controls readable instead of clipping the side rails
- Restored the non-mirrored capture-readiness banner above the camera viewport so framing prompts remain readable when selfie mirroring is enabled
- Moved patient-facing tilt warning logic to the missing-reference helper; visible hip/ear divergence remains low confidence internally without creating a persistent patient warning
- Locked previous/next exercise navigation during countdown, active, and rest states
- Made End cancel countdown directly while keeping active-session End behind the existing confirmation step
- Preserved the final elapsed timer after ended sessions and added progress labels for ready, starting, active, rest, ended, and complete states
- Made the right-rail prescription summary use timed-hold wording for isometric exercises such as `ex_006`
- Fixed compensation row helper text so below-threshold compensation metrics say "Below threshold" instead of always saying "Above threshold"

### *web\src\lib\pose\poseMetrics.ts*
- Added `hasMissingTiltReferenceLine()` to centralize the patient-facing tilt-warning gate
- The helper returns true only when tilt confidence is low because one reference line is missing (`divergenceDeg === null`), not when hips and ears are both visible but diverge

### *web\src\lib\pose\tiltReference.test.ts*
- Added regression coverage for the four tilt-reference display cases: single visible reference, visible hip/ear divergence, matching high-confidence references, and missing both references
- Pins the intended behavior that visible divergence stays available as a low-confidence metric flag without showing the patient framing banner

### *web\src\lib\pose\drawCompensationOverlay.ts*
- Changed compensation overlay boxes and labels from red to amber
- Increased overlay label font size for readability while exercising away from the screen

### *web\src\app\layout.tsx* and *web\src\app\globals.css*
- Added Inter and JetBrains Mono font variables
- Exposed global `--sans` and `--mono` variables used by the refreshed camera UI while leaving the existing app font variables available

### *Validation*
- `npx tsc --noEmit --pretty false` passed from `web/`
- `npx tsx src/lib/pose/tiltReference.test.ts` passed (4 tests)
- `npx tsx src/lib/pose/scapularElevation.test.ts` passed (9 tests)
- `npx tsx src/lib/pose/trunkSideAgreement.test.ts` passed (5 tests)
- `npx tsx src/lib/pose/shoulderAbduction.test.ts` passed (15 tests)
- Browser verification on `/camera?exerciseId=ex_006` confirmed the refreshed layout renders, `ex_006` shows `30s hold`, countdown disables previous/next, and End cancels countdown back to ended state
- `git diff --check` passed with line-ending warnings only

---

## 📌 Update-5-28-26 | *RyanCodesling*

- Added a 3-2-1 session countdown before active camera counting starts; Start now enters `countdown`, then transitions to `active`, and End can cancel during countdown
- Added visible baseline-capture progress for exercises that need calibration; the overlay shows seconds remaining, percent ready, and pause reason when capture readiness drops
- Added compensation warning boxes on the camera canvas — warning metrics now draw red bounding boxes around the affected joint area with readable text badges such as "Trunk lean", "Shoulder elevated", and directional neck-tilt labels
- Added scapular-elevation baseline capture for compensation warnings on `ex_001`, `ex_005`, and `ex_006`; raw shoulder-to-ear distance is suppressed until baseline is ready, then converted to a baseline-relative shrug delta
- Fixed baseline routing so compensation-only calibration cannot alter primary rep-counting inputs; `ex_001` arm-raise reps remain normal shoulder-abduction angles while the separate shoulder-shrug compensation baseline runs
- `ex_005` Standing Side Bends now uses a neutral hip-to-head baseline for its primary metric instead of per-frame hip-line correction, preserving real side-bend signal that was previously cancelled by moving hip tilt
- `ex_005` capture readiness now uses lateral framing mode: wider head x-tolerance, lower accepted head-y range, matching wider overlay target box, and no wrist/hand gate for side bends
- `ex_006` Arm Abduction at 90° now runs as a true isometric time-in-target-band exercise in the camera loop; it accumulates paired hold time only while both arms are inside the 90° ± 10° band and does not run a rep counter
- Added per-side hold-duration prescription support (`holdSeconds` / `hold_seconds`) for isometric exercises, defaulting to 30 seconds when older data does not provide a value
- Patient and therapist read-only views now display `ex_006` as timed holds instead of misleading `1 reps` text
- Therapist assignment and program flows now show a Hold (sec) field for isometric exercises, carry hold durations through previews, existing-assignment edit/cancel logic, program templates, and assignment payloads
- Added `web/src/lib/exercises/prescriptionDisplay.ts` to centralize isometric-aware display text such as `30s hold`, `Hold`, and `30s`
- Added `program_exercises.hold_seconds` and `patient_exercises.hold_seconds` SQL migration-safe columns, plus DB read/write plumbing for program and patient prescriptions
- Added `/debug/pose-simulator` for local threshold visualization of `ex_005` side-bend counting and `ex_006` T-pose hold-band behavior
- Added `trunkSideAgreement.test.ts` to pin `ex_005` side-tag direction, shoulder-tilt rejection, off-frame ear handling, and neutral-baseline preservation
- Updated pose metric plumbing so bilateral isometric exercises compute per-side values, `shoulderHorizAbd` delegates to shoulder-abduction geometry, and `computePoseMetricsForExercise()` exposes per-side isometric metrics for the camera loop
- Corrected shoulder-symmetry side documentation and preserved the existing front-camera left/right conventions used by the metric code
- Added `dumpEx005Debug()` / `enableEx005Debug()` browser-console diagnostics for live side-bend traces, including raw signed angle, smoothed angle, neutral baseline, old per-frame-corrected comparison, capture status, and rep emissions
- Validation completed from `web/`: full pose test suite passed (104 tests, 0 failed), `npx tsc --noEmit --pretty false` passed, and `git diff --check` passed with line-ending warnings only

### *scripts\patient_exercises_pg.sql*
- Added `hold_seconds INT NOT NULL DEFAULT 30` to `patient_exercises`
- Added safe `ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS hold_seconds INT NOT NULL DEFAULT 30`
- Documented that `hold_seconds` is used for isometric targets and ignored by dynamic rep-counted exercises

### *scripts\exercise_programs_pg.sql*
- Added `hold_seconds INT NOT NULL DEFAULT 30` to `program_exercises`
- Added safe `ALTER TABLE program_exercises ADD COLUMN IF NOT EXISTS hold_seconds INT NOT NULL DEFAULT 30`

### *web\src\lib\db.ts*
- Added `DEFAULT_HOLD_SECONDS = 30`
- Added `normalizeHoldSeconds()` with a minimum valid hold of 1 second
- `assignExercisesToPatient()` now inserts and updates `hold_seconds`
- `getPatientExercises()` now returns `hold_seconds`
- Program read/write helpers now include `holdSeconds` in JSON output and `program_exercises` inserts

### *web\src\app\api\patient-exercises\route.ts*
- POST payload accepts `holdSeconds`
- Invalid/missing hold values fall back to `DEFAULT_HOLD_SECONDS`
- Assignment requests pass `holdSeconds` through to `assignExercisesToPatient()`

### *web\src\lib\exercises\registry.ts*
- Added `CompensationMetricSpec.requiresBaselineCapture`
- Added `requiresLateralRoom` support for exercise definitions
- Marked `ex_005` as requiring lateral room and neutral baseline capture
- Marked `scapularElevation` compensation as baseline-required on `ex_001`, `ex_005`, and `ex_006`

### *web\src\lib\pose\captureReadiness.ts*
- Added `FramingMode = "lateral"`
- Lateral mode accepts wider head motion (`x` tolerance around 84% of frame width) and lower head positions during side bends
- Lateral overlay target now matches the widened gate
- Wrist visibility gate is skipped for lateral mode because `ex_005` does not use wrists for primary or compensation metrics

### *web\src\lib\pose\poseMetrics.ts*
- Added head-based `computeTrunkLateralFlexionSigned()` implementation for `ex_005`
- Added `computeTrunkLateralFlexionUncorrectedSigned()`, `computeTrunkLateralFlexionWithCameraTiltSigned()`, and `computeTrunkLateralFlexionFromNeutralSigned()`
- Added per-side isometric metric output for bilateral isometric exercises
- Implemented `computeShoulderHorizAbduction()` by delegating to `computeShoulderAbduction()`
- Refactored trunk-lean signed-angle math into a reusable helper

### *web\src\app\(app)\camera\CameraClient.tsx*
- Added countdown session state and countdown overlay
- Added `holdSeconds` prescription handling and paired hold accumulation for `ex_006`
- Added baseline progress state and baseline countdown overlay
- Added `ex_005` neutral-baseline capture and debug dump support
- Added scapular-elevation compensation baseline capture and fixed baseline gating so primary rep metrics are not transformed unless the primary metric explicitly requires it
- Added compensation overlay rendering with metric direction support for neck tilt
- Rep counting and isometric hold accumulation now wait until required baseline capture completes

### *web\src\lib\pose\drawCompensationOverlay.ts*
- New helper for compensation warning overlays
- Draws red rounded boxes around relevant MediaPipe landmark groups
- Draws mirrored-safe text badges so labels read correctly in selfie view
- Supports `compareDirection: "above" | "below"` and optional directional label suffixes

### *web\src\lib\exercises\prescriptionDisplay.ts*
- New helper for isometric-aware prescription display
- Provides `isIsometricExercise()`, `getDisplayHoldSeconds()`, `prescriptionTargetText()`, `prescriptionMetricLabel()`, and `prescriptionMetricValue()`

### *web\src\app\(app)\dashboard\patient\page.tsx*
- Assigned exercise types now include `hold_seconds`
- Session schedule and profile assigned-exercise cards show isometric targets as holds instead of reps

### *web\src\app\(app)\dashboard\therapist\patients\page.tsx*
- Patient exercise summaries now include `hold_seconds`
- Assigned-exercise chips render isometric prescriptions as timed holds

### *web\src\app\(app)\dashboard\therapist\patients\[id]\page.tsx*
- Patient detail assigned/completed exercise cards now render isometric prescriptions as timed holds

### *web\src\app\(app)\dashboard\therapist\assign\page.tsx*
- Assignment state, previews, existing assignments, edit/cancel handling, and API payloads now include `holdSeconds`
- Isometric rows show `Hold (sec)` instead of required reps
- Preview/delete modals show Hold for isometric exercises and Reps for dynamic exercises
- Program-based assignment carries `holdSeconds` from selected programs into patient assignment parameters

### *web\src\app\(app)\dashboard\therapist\programs\page.tsx*
- Program exercise parameters now support `holdSeconds`
- Isometric program rows show `Hold (sec)` instead of Reps
- Program cards summarize isometric exercises as timed holds and persist hold duration through edit/save

### *web\src\app\(app)\debug\pose-simulator\page.tsx*
- New debug route for visualizing `ex_005` side-bend thresholds, signed side tags, shoulder-cheat rejection, and `ex_006` bilateral T-pose hold-band behavior

### *web\src\lib\pose\trunkSideAgreement.test.ts*
- New regression test covering `ex_005` side direction, shoulder-tilt rejection, off-frame ear nulling, and fixed-neutral baseline preservation

--- 

## 📌 Update-5-24-26 | *Enah*
- Replaced all emoji sidebar nav icons with inline SVG components (w-4 h-4 shrink-0, Material Design paths) across admin, therapist, patient dashboards, and Camera page
- Restyled ☰ Menu hamburger button to green-filled (bg-green-700 hover:bg-green-800 text-white) across all dashboards and Camera page
- Removed role label ("Admin" / "Therapist" / "Patient") from the top of all sidebars — user's full name now sits directly at the top
- Redesigned My Profile pages for therapist and patient — 2-column card layout with Personal Information, Account Information, and Account Actions panels; added color-coded status badges and formatMemberSince() helper sourced from createdAt in db.ts
- Refactored Camera page — added slide-in sidebar with backdrop overlay replacing the "← Back to Dashboard" header link; added ?exerciseId query param support so camera pre-selects the exercise on load; wrapped in <Suspense> for Next.js compatibility
- Overhauled Assign Exercise page — added Scheduled Date field (PH timezone, date-gated), Currently Assigned section, Delete modal, Assign Preview modal with new/updated/unchanged diff, locked-by-default assigned exercises with Edit/Cancel Edit, "Update Changes" vs "Assign Exercises" smart button, and delete success popup
- Replaced all alert() and inline banners with consistent popup modals (rounded-2xl shadow-xl) across Therapist-side and Admin-side
- "Exercise Programs" — separated Add New Custom Exercise into a standalone form, added Your Custom Exercises section, added Rest (sec) field with 60s default
- Patient dashboard — added Session tab (inline, no route change), date-grouped exercise list, date-gated Start Session button, color-coded status badges; renamed "Ongoing Exercises" → "Assigned Exercises", "Weekly Exercise Schedule" → "Session Schedule"
- Deleted /session route — all session content moved into the patient dashboard Session tab
- Manage Patients page — removed Start Session button, restyled View button and Refresh button with SVG icon
- Full Template → Program rename across all TypeScript files (db.ts, assign/page.tsx, programs/page.tsx); new /api/programs and /api/programs/[id] routes; deleted dead api/templates/ folder
- DB: added assigned_date, rest_seconds columns; deletePatientExercises(); ProgramExerciseRow/Input with restSeconds; createdAt in mapUser

### *scripts\patient_exercises_pg.sql*
- Added `ALTER TABLE patient_exercises ADD COLUMN IF NOT EXISTS assigned_date DATE NOT NULL DEFAULT CURRENT_DATE` — safe to re-run on existing tables that pre-date the column

### *scripts\exercise_programs_pg.sql*
- `rest_seconds INT NOT NULL DEFAULT 60` added to the `program_exercises` `CREATE TABLE` definition
- `ALTER TABLE program_exercises ADD COLUMN IF NOT EXISTS rest_seconds INT NOT NULL DEFAULT 60` added — safe to re-run on existing tables that pre-date the column

### *web\src\app\(app)\camera\CameraClient.tsx*
- Added `sidebarOpen` state (`useState(false)`)
- Return refactored from `<main>` root to a fragment (`<>`) — sidebar and backdrop rendered as fixed overlays outside `<main>` so they layer correctly over the full camera view
- Hamburger `<button>` (`☰ Menu`) added to the header left side, always visible, replaces the removed back link; styled `bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded transition flex items-center gap-2` matching the dashboard hamburger buttons
- Header left area restructured: hamburger button + nested `<div>` holding the "Camera" `<h1>` and status badges
- Sidebar `<aside>` — `fixed inset-y-0 left-0 z-40 w-64 bg-green-900`, slides in/out via `translate-x-0` / `-translate-x-full` with `transition-transform duration-200`
- Added `useSearchParams` import from `next/navigation`
- Reads `?exerciseId` query parameter on mount; uses it as the initial `selectedExercise` state value
- Exercise-loading effects prefer the query-param exercise if it exists in the loaded list, falling back to the first exercise otherwise

### *web\src\app\(app)\dashboard\therapist\profile\page.tsx*
- Full rewrite — removed old flat `ProfileField` list and Assigned Patients section
- Layout: `lg:grid-cols-3` grid; Personal Information `col-span-2` left, Account Information + Account Actions stacked on the right `col-span-1`
- Account Actions card: Change Password (green, `disabled`, non-functional), Log Out (red outlined, calls `logout()` → redirects to `/`)
- Added `logout` from `useAuth` and `useRouter` for the Log Out action; added `React` import for `React.ReactNode`
- Added `formatMemberSince()` helper — formats ISO timestamp as `"Month YYYY"` locale string

### *web\src\app\(app)\dashboard\patient\page.tsx*
- Added `createdAt: string | null` to `PatientProfile` interface
- View Profile tab fully redesigned — replaced old `ProfileField` grid and exercise list with the new card layout
- Layout: same `lg:grid-cols-3` grid; left column holds Personal Information + Ongoing Exercises (stacked), right column holds Account Information + Account Actions (stacked)
- Account Information + Account Actions match the therapist layout; Log Out is functional, Change Password is non-functional
- Replaced old `ProfileField` with `PatInfoField`, `PatAccountField`, `formatMemberSince`, and icon components; added `React` import

### *web\src\lib\db.ts*
- Added `createdAt: row.created_at ?? null` to `mapUser` — exposes the `users.created_at` timestamp to all API responses that use `mapUser`, enabling the "Member Since" display on both profile 
- Added `deletePatientExercises(patientId, exerciseIds)` — issues a single `DELETE FROM patient_exercises WHERE patient_id = $1 AND exercise_id = ANY($2::varchar[])` query; no-ops safely when `exerciseIds` is empty
- `TemplateExerciseRow` extended with `restSeconds: number | null`
- `TemplateExerciseInput` extended with `restSeconds?: number`
- `getTemplates` query updated — `json_build_object` now includes `'restSeconds', te.rest_seconds`
- `insertTemplateExercises` INSERT updated to include `rest_seconds` column — defaults to `60` when the input value is null or negative

### *web\src\app\(app)\dashboard\therapist\patients\[id]\page.tsx*
- Progress Status badge is now color-coded: red (`bg-red-100 text-red-700`) for "not started", blue (`bg-blue-100 text-blue-700`) for "in progress" / "progressing", green (`bg-green-100 text-green-700`) for "completed"
- Assigned Exercises status badge is now color-coded: red for "pending" (shown as "Not Started"), blue for "in_progress" (shown as "In Progress")
- `PatientExerciseAssignment` type extended with `scheduledDate?: string`
- `assignExercisesToPatient` INSERT now includes `assigned_date` column, using the provided date (validated `YYYY-MM-DD`) or falling back to today; `ON CONFLICT DO UPDATE` also updates `assigned_date` so re-assigning an exercise can change its schedule

### *web\src\app\(app)\dashboard\patient\page.tsx*
- Renamed "Ongoing Exercises" section to "Assigned Exercises" on the My Profile tab
- Removed the `status !== "completed"` filter — all assigned exercises are now shown regardless of status
- Empty state message updated to "No assigned exercises" / "You currently have no exercises assigned"
- Exercise status badge is now color-coded: red (`bg-red-100 text-red-700`) for "pending" (shown as "Not Started"), blue (`bg-blue-100 text-blue-700`) for "in_progress" (shown as "In Progress"), green (`bg-green-100 text-green-700`) for "completed" (shown as "Completed"); replaces the previous gray "Active" static badge
- Added `"session"` to `ActiveTab` union; "Session" sidebar item converted from `<Link href="/session">` to a tab `<button>` — clicking it now stays within the patient dashboard with the sidebar visible, matching "View Profile" behaviour
- `AssignedExercise` interface extended with `rest_seconds: number` and `assigned_date: string` to support the session tab
- Session tab content added inline: progress card (completed/total count + progress bar), exercise list with scheduled date, color-coded card backgrounds and status badges, date-gated "Start Session" button (green when `assigned_date ≤ today PH`, gray + disabled when future), green → `/camera?exerciseId=xxx` redirect
- Added `sessionTodayPH()` helper (returns `YYYY-MM-DD` in `Asia/Manila` timezone) used for date-gating logic in the session tab

### *web\src\app\(app)\session\page.tsx*
- `getStatusBadgeColor` updated: "completed" → `bg-green-100 text-green-700`, "in_progress" → `bg-blue-100 text-blue-700`, default/pending → `bg-red-100 text-red-700`; replaces the previous green "Pending" badge
- `getStatusColor` (card background) updated to match: green tint for completed, blue tint for in_progress, red tint for pending/not started
- `getStatusText` updated: "pending" → "Not Started", "in_progress" → "In Progress", "completed" → "Completed"; removes "Skipped" label in favour of the unified not-started default
- Each exercise card now shows **Scheduled date** (formatted "Month D, YYYY") sourced from `assigned_date` instead of the computed weekday/date label
- "Start Session" button is **date-gated**: green + clickable when `assigned_date ≤ today` (Philippine time via `en-CA` locale), gray + `disabled` + tooltip showing the available date when the scheduled date is still in the future
- Clicking an active "Start Session" redirects to `/camera?exerciseId=<exercise_id>` so the camera pre-selects that exercise
- Added `todayPH()` helper — returns today's date as `YYYY-MM-DD` using `Asia/Manila` timezone

### *web\src\app\(app)\dashboard\therapist\assign\page.tsx*
- Added **Scheduled Date** field (required) to each exercise row when checked — `<input type="date">` rendered below the Sets/Reps/Rest grid inside `AssignRow`
- `assignParams` state extended to include `scheduledDate?: string` per exercise
- `handleAssign` validates that `scheduledDate` is provided for every selected exercise before submitting
- `AssignRow` receives new `onDate` prop; both system and custom exercise maps wire it to update `scheduledDate` in `assignParams`
- Payload sent to `POST /api/patient-exercises` now includes `scheduledDate` per exercise
- Added **Currently Assigned** section (between Step 1 patient selection and Step 2 exercise picker) — lists all exercises already assigned to the selected patient with checkboxes, exercise name, scheduled date, sets × reps × rest, and an "assigned" blue badge on matching `AssignRow` entries
- **Delete Selected** button opens a Delete Confirmation Modal showing a red preview card of every checked exercise; confirming calls `DELETE /api/patient-exercises` and refreshes the assignment list
- **Assign Preview Modal** added — before saving, `handleAssign` builds a diff (`PreviewItem[]`) classifying each selected exercise as "new" (green), "updated" (blue, shows Before/After sets/reps/rest/date), or "unchanged" (gray); the modal renders all three categories before the user confirms
- `handleConfirmAssign` performs the actual `POST /api/patient-exercises` call after the preview is confirmed
- **Scheduled Date** `<input type="date">` per exercise now has `min={minDate}` (today's date in `Asia/Manila` timezone) — calendar picker is restricted to present date onwards
- `AssignRow` receives `isExisting` prop and renders a blue "assigned" badge when the exercise is already in the patient's current assignments
- Added `todayStr()` helper (returns `YYYY-MM-DD` in `Asia/Manila` timezone) and `fmtDate()` helper (formats `YYYY-MM-DD` as `"Month D, YYYY"`)
- Added `fmtDateFull()` helper — formats `YYYY-MM-DD` as `"Month D, YYYY Weekday"` (e.g. `"May 26, 2026 Tuesday"`) for use in confirmation modals
- **Delete Confirmation Modal** updated — each exercise now renders a stacked full-detail card: exercise name (bold), then `Sets:`, `Reps:`, `Rest:`, `Scheduled Date:` on separate lines using `fmtDateFull`; replaces the previous single-line inline summary
- **Assign Preview Modal — New** section updated — each new exercise renders the same stacked full-detail card (green border) instead of the previous condensed one-liner
- **Assign Preview Modal — Updated** section updated — Before (red border) and After (green border) columns each show the full stacked `Sets` / `Reps` / `Rest` / `Scheduled Date` breakdown side by side instead of the previous abbreviated `sets×reps · Xs` line
- **Assign Preview Modal — Unchanged** section updated — each exercise now shows the full stacked detail card (gray) instead of the previous "No changes" label
- Assigned exercises in Step 3 are **locked by default** — all four fields (Sets, Reps, Rest, Scheduled Date) are disabled (`bg-gray-100 cursor-not-allowed`) until the therapist explicitly unlocks them; a red **Edit** pill button (pencil icon) appears beside the "assigned" badge for each locked exercise
- Clicking **Edit** enters edit mode for that exercise: fields become interactive, an "editing" red badge appears, and a gray **✕ Cancel Edit** button appears beside it
- Clicking **Cancel Edit** exits edit mode and restores all four field values to the original DB values — any mid-edit changes are fully discarded
- **"Assign Exercises" / "Update Changes" button** logic: no existing assignments → always shows "Assign Exercises"; existing assignments present → shows "Update Changes" only when at least one change is detected (new exercise added, or an exercise in edit mode has values differing from the DB); shows nothing if no changes are detected (e.g. only deletions were made)
- **Delete success popup modal** replaces the previous inline success banner — after a delete is confirmed, a green checkmark modal appears stating "Deleted Successfully" with the patient name; dismissed with an OK button
- **`toggleAssign` fix** — unchecking an assigned exercise no longer wipes its `assignParams`; the filled-in values persist in state so re-checking the checkbox immediately restores all fields to their previous values, preventing accidental data loss from an unintended uncheck
- Added `editingExercises: Set<string>` state to track which assigned exercises are currently in edit mode; reset to empty on patient change
- Added `showDeleteSuccess: boolean` state to control the delete success popup
- Added `hasAssignChanges` derived boolean — checks `assignSelected` for any exercise not in `existingAssignments` (new) or any exercise in `editingExercises` whose current params differ from the DB record
- Added `PencilIcon` SVG function (Material Design edit path, `w-3 h-3 shrink-0`)

### *web\src\app\api\patient-exercises\route.ts*
- POST handler accepts `scheduledDate` per exercise — validated as a `YYYY-MM-DD` string; passed through to `assignExercisesToPatient`

### *web\src\app\(app)\camera\page.tsx*
- Wrapped `<CameraClient />` in `<Suspense>` — required by Next.js for components that call `useSearchParams`

### *web\src\app\api\patient-exercises\route.ts*
- Added `DELETE` handler — authenticates therapist, verifies patient ownership, accepts `{ patientId, exerciseIds: string[] }` body, calls `deletePatientExercises`, returns `{ success: true }`

### *web\src\app\(app)\dashboard\patient\page.tsx*
- Session tab heading renamed **"Weekly Exercise Schedule" → "Session Schedule"**; subtitle updated to "Track your exercises by scheduled date"
- Progress card heading renamed "Weekly Progress" → "Overall Progress"
- Exercises are now sorted ascending by `assigned_date` before rendering
- Exercise list is now grouped by date — each unique date renders a `Scheduled: Month D, YYYY` header with a green hairline rule, followed by all exercises assigned on that date as cards below it; the per-card "Scheduled: …" line was removed since the date is now the group header

### *web\src\app\(app)\session\page.tsx* *(deleted)*
- File deleted — the `/session` route is fully redundant; the "Session" sidebar button in `patient/page.tsx` was already converted to a tab button (sets `activeTab("session")`) and all content (progress card, exercise list, date-gating, Start Session) lives inside the patient dashboard session tab; no internal navigation linked to this route

### *web\src\app\(app)\dashboard\therapist\programs\page.tsx*
- Removed `customError` inline banner state — validation errors for the custom exercise form now use the shared error modal instead
- Added `showSuccessModal`, `successMsg`, `showErrorModal`, `errorMsg`, `errorTitle`, `showConfirmDelete`, `confirmDeleteId` states
- `handleAddCustomExercise` validation failures open the error modal with title "Required Fields" instead of setting an inline banner
- `handleSave`: all `alert()` calls replaced with modal; captures `wasEditing = !!editingId` before `resetForm()` so the correct success message is used — "Program updated successfully." vs "Program created successfully."
- Delete flow split into `handleDelete` (sets `confirmDeleteId`, opens confirm modal) and `handleConfirmDeleteProgram` (performs DELETE API call, shows success modal on completion)
- Three modals added at end of return: **Success** (green checkmark circle, dynamic `successMsg`, green OK button), **Error** (red X circle, dynamic `errorTitle` + `errorMsg`, red OK button), **Confirm Delete** (red trash icon circle, Cancel + red Delete buttons)
- All modals use the consistent pattern: `fixed inset-0 z-40 bg-black/50` backdrop + `fixed inset-0 z-50 flex items-center justify-center p-4` + `bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center` + icon circle
- "Add New Custom Exercise" block removed from inside the Create/Edit Program form — custom exercise creation is now a standalone flow separate from program authoring
- `customSets` and `customReps` states removed — sets and reps are program-specific prescriptions, not properties of an exercise itself
- `resetCustomForm()` call removed from `resetForm()` — the two forms are now fully independent
- Added `showCustomForm` state to control the standalone custom exercise form visibility
- Added **"+ Add New Custom Exercise"** button alongside **"+ Create New Program"** — both visible when no program form is open; the custom button toggles to **"✕ Cancel"** when the form is open; clicking **"+ Create New Program"** collapses the custom form if open
- Standalone **Add New Custom Exercise** form — name and description fields only (no sets/reps); on save POSTs to `/api/exercises`, updates the exercises list, collapses the form, and shows the success modal with the new exercise name; validates both fields before submission
- **Your Custom Exercises** section added below **Your Programs** — grid of cards (same 2-col layout) showing exercise name, "custom" green badge, exercise ID, and description; empty state directs to the add button
- Renamed all remaining "Template" → "Program" terminology in TypeScript code (see full rename notes below)
- Added **Rest (sec)** field to each exercise row in the Create/Edit Program form — sits in a 3-column grid alongside Sets and Reps; blank input defaults to 60 seconds when the program is saved; `placeholder="60"` communicates the default; `min={0}` allows 0 (no rest)
- `exerciseParams` type extended with `restSeconds?: number`
- `buildExercisePayload` now includes `restSeconds` — applies `60` default when the field is left blank or negative; the value is passed to the API on both create and update
- `handleEdit` now populates `restSeconds` from the existing program exercise so the field is pre-filled when editing
- Program exercise cards in **Your Programs** now show rest duration alongside sets×reps (e.g. `3×12 · 45s`)

### *web\src\app\(app)\dashboard\admin\page.tsx*
- Replaced `statusMessage` / `statusType` / `statusVisible` states and their timer `useEffect` with `showStatusModal`, `statusModalMsg`, `statusModalType` — status feedback is now a popup modal instead of a fading inline banner
- `handleConfirmAdd`, `handleFinalDelete`, `handleConfirmEdit`: all `setStatusType` / `setStatusMessage` calls replaced with `setStatusModalType` / `setStatusModalMsg` / `setShowStatusModal(true)` for both success and error paths
- Removed inline status banner JSX (`{statusMessage && <div ...>}`)
- **Confirm Delete modal** restyled: `rounded-2xl shadow-xl`, backdrop + centered container pattern, red trash icon circle (`bg-red-100`, Material Design delete path), centered text layout, full-width Cancel + Delete buttons with `rounded-lg` styling
- **Final Confirmation modal** restyled: same pattern, red warning triangle icon (`bg-red-100`, Material Design warning path)
- **Add User preview modal** restyled: `rounded-2xl shadow-xl`, backdrop overlay added, full-width Go Back + Confirm buttons with `rounded-lg`, "Confirm & Add User" button changed from `bg-green-600` to `bg-green-700`
- **Edit User preview modal** restyled: same `rounded-2xl shadow-xl` container, backdrop overlay added, full-width Go Back + Confirm buttons with `rounded-lg`, "Confirm & Save Changes" button changed from `bg-blue-600` to `bg-green-700`
- **Status modal** added after `</main>`: green checkmark for success, red X for error, `"Success"` / `"Something Went Wrong"` heading, dynamic message, color-matched OK button (`bg-green-700` / `bg-red-600`)

### *Full "Template → Program" rename across all TypeScript files*
- **`web\src\lib\db.ts`**: `getTemplates` → `getPrograms`, `createTemplate` → `createProgram`, `updateTemplate` → `updateProgram`, `deleteTemplate` → `deleteProgram`, `insertTemplateExercises` → `insertProgramExercises`, `TemplateExerciseRow` → `ProgramExerciseRow`, `TemplateExerciseInput` → `ProgramExerciseInput`; section comment updated to `// ── Exercise programs`
- **`web\src\app\api\programs\route.ts`** *(new)*: new route at `/api/programs` — GET returns `{ programs }`, POST creates program; imports renamed db functions; all error messages use "program"
- **`web\src\app\api\programs\[id]\route.ts`** *(new)*: new route at `/api/programs/[id]` — PUT updates, DELETE removes; imports renamed db functions
- **`web\src\app\(app)\dashboard\therapist\assign\page.tsx`**: `interface Template` → `interface Program`; `templates`/`setTemplates` → `programs`/`setPrograms`; `assignTemplateId`/`setAssignTemplateId` → `assignProgramId`/`setAssignProgramId`; `handleTemplateSelect` → `handleProgramSelect`; fetch URL `/api/templates` → `/api/programs`; response key `templatesData.templates` → `programsData.programs`
- **`web\src\app\(app)\dashboard\therapist\programs\page.tsx`**: all fetch URLs updated from `/api/templates` and `/api/templates/${id}` → `/api/programs` and `/api/programs/${id}`; response key `d.templates` → `d.programs`

### *web\src\app\api\templates\* (deleted)*
- Entire `api/templates/` folder deleted — `route.ts` and `[id]/route.ts` were dead code after all frontend fetch calls were migrated to `/api/programs`; no route in the app calls `/api/templates` anymore

--- 

## 📌 Update-5-22-26 | *RyanCodesling*

- **`ex_001` reduced-ROM leniency** — `minimumPeakThreshold` 60° → 45° (peaks from 45° to under 90° now count as `partial`; `targetROM` stays 90° so the weakness signal is preserved)
- **Exercise double-swap (landed in code)** — deprecated `ex_002` Overhead Arm Raises (unavoidable front-camera depth ambiguity) + `ex_003` Shoulder Shrugs (sits at MediaPipe's 3° landmark noise floor); added `ex_007` Overhead Shoulder Press + `ex_008` Wall Angels (frontal-plane, MediaPipe-clean). Deprecated entries kept in the registry + DB for audit; filtered out of active catalog/debug/patient-flow surfaces
- **Real session lifecycle** replaced the hardcoded SETS / progress / timer placeholders: idle→active→ended state machine, slower-side-gated set counter (`min(left,right) ≥ targetReps`), live session timer, progress bar, wired sidebar Start/End controls, per-side `reps/target` display with a green ✓ "done" cue
- **Guided exercise flow** replaced the camera exercise dropdown with a Prev / Next stepper hero: current exercise is emphasized, navigation is disabled while a session is active/resting, completed non-final exercises auto-advance to the next exercise idle, and manually ended exercises show a "Next exercise →" prompt
- **Rest periods between sets** were restored as a therapist-configurable prescription field (`rest_seconds`): camera sessions now enter a hard-block `resting` state between sets, show a countdown, pause rep counting, auto-resume the next set, and keep per-set duration separate from rest time
- **End-early safety** added an inline confirmation before ending an active exercise; stale confirmations are cleared on set completion, rest transitions, exercise changes, and session end
- Live-webcam tuning adjusted smoothing/framing and narrowed compensation scope; thresholds remain starting values that still need pilot/live-webcam calibration. Two compensation signals (shrug, elbow-off-wall) were deferred pending baseline-capture / stronger setup constraints

### *web\src\lib\exercises\registry.ts*
- Added `ex_007` (Overhead Shoulder Press, primary `wristShoulderVertical`) and `ex_008` (Wall Angels, primary `shoulderAbduction` reused)
- `@deprecated` JSDoc on `ex_002` / `ex_003` (kept structurally so `scapularElevation.test.ts` still asserts against `ex_003`)
- Extended `MetricName` (+`elbowFlexion`, `wristShoulderVertical`, `shoulderElbowDistance`); added `compareDirection?: "above" | "below"` and `requiresOverheadRoom?: boolean` to the relevant specs

### *web\src\lib\pose\poseMetrics.ts*
- New `computeElbowFlexion` (interior-angle, 180° = straight), `computeWristShoulderVertical` (trunk-up projection, camera-roll invariant — ex_007 primary), `computeShoulderElbowDistance` (foreshortening signal, retained for future use)
- `inFrame01()` guards added to active wrist/elbow-dependent rep metrics (`shoulderAbduction`, `elbowFlexion`, `wristShoulderVertical`) — rejects MediaPipe landmarks extrapolated outside `[0,1]`, preventing phantom rep peaks during overhead reach
- `computeCompensationScore` now skips stub-band (warning-only) metrics so they don't dilute the score; added per-side worst-value aggregation (`pickWorstSide`) for per-limb compensation metrics

### *web\src\lib\pose\captureReadiness.ts*
- Per-exercise framing mode: `requiresOverheadRoom` exercises (ex_007 / ex_008) get a relaxed head-y band (0.10–0.45 vs the default 0.05–0.25) and skip the readiness-level wrist gate; metric-level in-frame guards still reject extrapolated wrist/elbow readings

### *web\src\app\(app)\camera\CameraClient.tsx*
- Session lifecycle state + refs; rep counting gated on `active`; slower-side-gated set completion (resets per-set counts and counter state); true Start/Restart clears current-session logs and rebuilds rep counters so rep indices start fresh; session timer; derived progress; wired sidebar Start/End buttons; per-side target + green ✓ done cues on the stat panels
- Guided-flow exercise stepper: current exercise hero, Prev / Next buttons, no wraparound, active/resting navigation lock, auto-advance after all prescribed sets complete, manual-End "Next exercise →" prompt
- Rest countdown state: `resting` session state, `restEndsAtMsRef`, displayed countdown, hard rep-counting pause while resting, auto-resume to `active`, End support during rest, and temporary Skip Rest testing affordance marked for later removal
- End-early confirmation panel prevents accidental partial-session termination and is reset during lifecycle transitions so it cannot carry into the next set
- Fixed a stale-closure bug — `predictWebcam` now reads `activeDefinition` through a ref, so switching exercises mid-session works without a camera restart
- `metricLabel` extended for the three new metrics

### *web\src\app\api\patient-exercises\route.ts*
- POST assignment payloads now validate `exerciseId`, `sets`, and `reps` server-side
- Optional/missing `restSeconds` defaults to 60 seconds; malformed exercise entries return 400 instead of falling through to a server error

### *web\src\app\api\exercises\route.ts* and *web\src\app\api\patient-exercises\route.ts*
- Filters deprecated `ex_002` / `ex_003` from active catalog and patient-assignment responses by default, with `?includeDeprecated=true` retained for history/audit views

### *web\src\lib\db.ts*
- `assignExercisesToPatient()` writes `rest_seconds` and defensively defaults missing/invalid rest values to 60 seconds for older or direct callers
- `getPatientExercises()` now selects `rest_seconds` so the camera, session page, and therapist patient detail page can display/enforce the prescription

### *web\src\app\(app)\dashboard\therapist\assign\page.tsx*
- Assignment rows now include an optional Rest (sec) input per exercise; blank/negative values default to 60 seconds and `0` means no rest
- Existing assigned exercises prefill their sets, reps, and rest seconds before resubmission

### *web\src\app\(app)\dashboard\therapist\patients\[id]\page.tsx* and *web\src\app\(app)\session\page.tsx*
- Patient exercise displays now include prescribed rest seconds alongside sets/reps
- Patient session summary cards include a Rest value so the patient sees the planned break length before starting

### *web\src\lib\pose\ (new test files)*
- `elbowFlexion.test.ts`, `wristShoulderVertical.test.ts`, `shoulderElbowDistance.test.ts` — synthetic-landmark coverage for the new metrics; elbow/wrist active-metric tests include off-frame-extrapolation rejection

### *scripts\exercises_pg.sql*
- Seeds `ex_007` / `ex_008`; switched the EX_SWAP insert block to `ON CONFLICT (id) DO UPDATE` so re-running the script refreshes stale descriptions on already-seeded rows

### *scripts\patient_exercises_pg.sql*
- Added `rest_seconds INT NOT NULL DEFAULT 60` to patient exercise assignments, with an idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for existing local databases

---

## 📌 Update-5-20-26 | *Enah*
- Renamed `scripts\exercise_templates_pg.sql` → `scripts\exercise_programs_pg.sql` — table `exercise_templates` renamed to `exercise_programs`, `template_exercises` renamed to `program_exercises`
- Updated all SQL queries in `web\src\lib\db.ts` to reference the new table names
- Renamed column `template_id` → `program_id` in `program_exercises` table; updated all references in SQL file and `db.ts`
- Renamed route folder `therapist\templates` → `therapist\programs`; updated all TypeScript identifiers, interfaces, and state variables from Template/template to Program/program
- Updated sidebar nav link in `therapist\page.tsx` from `/dashboard/therapist/templates` → `/dashboard/therapist/programs`
- Removed role selection from login flow — system now determines dashboard from user ID prefix (`admin_` → admin, `therapist_` → therapist, `patient_` → patient); no more Patient/Therapist/Admin buttons or demo credentials
- Redesigned landing page (`web\src\app\page.tsx`) — green-themed UI with ACC Bacoor branding; background image with frosted glass card positioned toward the right
- Restyled login page to match the landing page — same background image, frosted glass card, and green theme

### *scripts\exercise_programs_pg.sql*
- Renamed file from `exercise_templates_pg.sql`
- `exercise_templates` → `exercise_programs`
- `template_exercises` → `program_exercises`
- Column `template_id` → `program_id` in `program_exercises`
- FK reference inside `program_exercises` updated to point to `exercise_programs(id)`
- Indexes renamed: `idx_et_therapist_id` → `idx_ep_therapist_id` on `exercise_programs(therapist_id)`, `idx_te_template_id` → `idx_pe_program_id` on `program_exercises(program_id)`
- GRANT and sequence updated: `template_exercises_id_seq` → `program_exercises_id_seq`

### *web\src\lib\db.ts*
- Updated `FROM exercise_templates` → `FROM exercise_programs` in `getTemplates()` query
- Updated `LEFT JOIN template_exercises ... template_id` → `LEFT JOIN program_exercises ... program_id` in `getTemplates()` query
- Updated `INSERT INTO template_exercises (template_id, ...)` → `INSERT INTO program_exercises (program_id, ...)` in `insertTemplateExercises()`
- Updated `INSERT INTO exercise_templates` → `INSERT INTO exercise_programs` in `createTemplate()`
- Updated `SELECT id FROM exercise_templates` → `SELECT id FROM exercise_programs` in `updateTemplate()`
- Updated `UPDATE exercise_templates` → `UPDATE exercise_programs` in `updateTemplate()`
- Updated `DELETE FROM program_exercises WHERE template_id` → `WHERE program_id` in `updateTemplate()`
- Updated `DELETE FROM exercise_templates` → `DELETE FROM exercise_programs` in `deleteTemplate()`

### *web\src\app\(app)\dashboard\therapist\programs\page.tsx (renamed from templates\page.tsx)* 
- Renamed route folder from `templates` to `programs`
- `interface TemplateExercise` → `interface ProgramExercise`
- `interface ExerciseTemplate` → `interface ExerciseProgram`
- `ExerciseTemplatesPage` → `ExerciseProgramsPage`
- State `templates / setTemplates` → `programs / setPrograms`
- State `templateName / setTemplateName` → `programName / setProgramName`
- `handleEdit` parameter type updated from `ExerciseTemplate` to `ExerciseProgram`
- All JSX comments and inline labels updated from Template to Program

### *web\src\app\(app)\dashboard\therapist\page.tsx*
- Updated sidebar nav `href` from `/dashboard/therapist/templates` → `/dashboard/therapist/programs`

### *web\src\app\page.tsx*
- Removed role-selection modal and `useState`; converted to server component
- "Log In" button replaced with a plain `<Link href="/login">` — navigates directly to the single login page

### *web\src\app\(auth)\login\page.tsx*
- Removed `useSearchParams`, role param, role-based heading/description, and demo credentials block
- Removed `Suspense` wrapper — no longer needed without `useSearchParams`
- After successful login, redirects based on `user.id` prefix: `admin_` → `/dashboard/admin`, `therapist_` → `/dashboard/therapist`, `patient_` → `/dashboard/patient`

### *web\src\app\api\auth\login\route.ts*
- Removed `role` from required request body fields
- Switched from `getUser(email, role)` to `getUserByEmail(email)` — role no longer supplied by the client

### *web\src\lib\auth.ts*
- Removed `role` parameter from `loginUser()` — body now sends only `{ email, password }`

### *web\src\lib\db.ts*
- Added `getUserByEmail(email)` — queries `users` by email only, without a role filter

### *web\src\app\(auth)\first-time-password\page.tsx*
- Updated both `/login?role=patient` references to `/login`

### *web\src\app\page.tsx*
- Background: `acc_bacoor_landing_page.png` fills the screen at full opacity via `next/image` with `fill` + `object-cover`; `unoptimized` added to serve original PNG without WebP conversion or compression
- Replaced SVG human figure with `acc_bacoor_logo.png` — rendered in a `w-32 h-32 rounded-full` container with `bg-green-600` backing to hide white PNG padding; `unoptimized` added to preserve original quality; `priority` to resolve LCP warning
- Frosted glass card: `bg-green-800/55 backdrop-blur-sm` with `max-w-md` width, positioned right-of-center via `justify-end pr-56`
- Typography: all text `text-white`; title `text-4xl`, subtitle `text-lg`, description `text-base`
- Log In button: `bg-green-600 hover:bg-green-500`, `text-base`, `py-3.5`

### *web\src\app\(auth)\login\page.tsx*
- Applied `acc_bacoor_landing_page.png` background (path: `../../../../media/`) with same `fill` + `object-cover` + `unoptimized` setup
- Frosted glass card: `bg-green-800/55 backdrop-blur-sm`, `max-w-md`, `px-14 py-16`, positioned at `justify-end pr-56` to match landing page
- Removed logo from login card; added "Log In to access your dashboard" label above the email field
- Floating label inputs — label sits centered in the input when empty, slides to the top with `text-xs` on focus or when a value is entered; uses Tailwind `peer` + `peer-placeholder-shown` + `peer-focus` pattern; inputs use `pt-6 pb-2` padding to accommodate the floating label
- Form inputs: `bg-white/10 border-green-600/50 text-white placeholder-white/50`, green focus ring
- Error message styled as a banner: `bg-red-500/20 border border-red-400/40 text-red-200` for readability against the green card
- Submit button: `bg-green-600 hover:bg-green-500`, `py-3.5`, `text-base`
- `← Back` replaced with a small black button: `bg-black/70 hover:bg-black`, `px-4 py-1.5`, `text-sm`
- All text set to `text-white`; font sizes bumped — title `text-3xl`, subtitle `text-base`, "Log In" label `text-lg`, inputs `text-base`

### *web\src\app\globals.css*
- Added `-webkit-autofill` override scoped to `.dark-autofill` class — sets inset box-shadow to `rgba(22, 101, 52, 0.55)` to match the card background, `-webkit-text-fill-color: white`, and `transition: background-color 5000s` to prevent the browser autofill white background from flashing; scoped to avoid affecting dashboard and other pages

### *web\media\ (new)* 
- Added `acc_bacoor_landing_page.png` (1640×924) and `acc_bacoor_logo.png` (2000×2000) to version control via `git add web/media/` — both files are now tracked and will be included in commits so the app works correctly on any device that pulls the branch

### *web\src\app\(app)\dashboard\admin\page.tsx*
- Added `computeAgePhilippines(dob)` helper — uses `Intl` with `timeZone: "Asia/Manila"` to get today's date in Philippine time, computes full years elapsed from date of birth, subtracts 1 if the birthday has not yet occurred this year
- Add New User form (Patient & Therapist): `dateOfBirth` onChange now automatically computes and sets `age` via `computeAgePhilippines`; `max` date on the date picker also uses `Asia/Manila` timezone
- Edit User form: same auto-compute wired to `dateOfBirth` onChange
- Age field in both forms set to `readOnly` with `bg-gray-50 cursor-not-allowed` — field is auto-filled and cannot be manually edited
- Replaced `window.confirm` double-confirmation with a second custom modal — delete flow is now: table Delete button → "Confirm Delete" modal → "Final Confirmation" modal → permanent deletion; added `isFinalConfirmOpen` state and `handleFinalDelete` function; both modals share the same styling as the existing delete modal
- Add User preview modal — "Add User" button now shows a confirmation modal listing all filled-in details (role, full name, email, date of birth, age, gender, and role-specific fields) before submitting; admin can go back to edit or confirm to proceed; `handleAddUser` now only validates and opens the preview, `handleConfirmAdd` performs the actual API call
- Edit User preview modal — "Save Changes" button now shows a before/after comparison modal; each field is shown in a three-column row (Field / Before / After); changed fields are highlighted in yellow with the old value struck through in red and the new value in green; unchanged fields are shown normally; `handleSaveEditUser` now only opens the preview, `handleConfirmEdit` performs the actual API call; added success/error status messages to both confirm handlers
- Status messages for add, edit, and delete now include the user's full name (e.g. "Juan dela Cruz successfully added." / "...updated." / "...deleted."); edit toast uses the post-edit name, delete toast uses the name captured when the delete modal was opened
- Role pill in the Manage Users table is now color-coded: blue (`bg-blue-100 text-blue-800`) for patient, green (`bg-green-100 text-green-800`) for therapist

### *web\src\app\(app)\dashboard\admin\page.tsx*, *web\src\app\(app)\dashboard\patient\page.tsx*, *web\src\app\(app)\dashboard\therapist\page.tsx*
- Applied green color palette: page background `bg-green-50`; sidebar `bg-green-900`; role label `text-green-400`; username `text-white`; active nav `bg-green-700 text-white`; inactive nav `text-green-200 hover:bg-green-800`; all primary action buttons `bg-green-700 hover:bg-green-800`; content cards remain white for readability
- Added Log Out button at the bottom of the sidebar (`mt-auto pt-6 mb-4` positions it near the bottom with breathing room); styled as `bg-red-600 hover:bg-red-700 text-white text-sm` with a 🚪 exit door icon; calls `logout()` then redirects to `/`; patient and therapist pages had `logout` added to their `useAuth()` destructuring
- Unified admin sidebar structure to match patient and therapist sidebars: header changed from `h1`/`p` to role label `div` (`text-sm text-green-400`) + name `div` (`text-lg font-semibold text-white`); nav changed from direct `<button>` elements in `<nav className="space-y-2">` to `<ul>`/`<li>` with `space-y-1`; button sizing changed from `px-4 py-3` to `px-3 py-2 text-sm`; active state now includes `font-medium` to match
- Moved Camera link into each dashboard's sidebar (`📷 Camera` → `/camera`); patient's existing `📷 Start Session` renamed to `📷 Camera` for consistency; sidebar hamburger menu (☰) for responsive mobile is preserved and unaffected

### *web\src\app\(app)\layout.tsx (deleted)*
- Removed logout button from the top nav bar — logout is now handled per-dashboard via the sidebar button
- Removed "Dashboard" link from the top nav — redundant now that each dashboard sidebar has its own tab; unused `dashboardHref`, `handleLogout`, `useRouter`, `useAuth` imports also removed
- Fully removed the top nav bar and its hamburger menu — all navigation (Camera, Dashboard, Logout) now lives in each dashboard's sidebar; layout reduced to a plain pass-through wrapper, then deleted entirely as it served no purpose

### *web\src\app\(app)\dashboard\admin\page.tsx*
- Added `"dashboard"` to `Tab` type and set it as the default `activeTab`
- Added 🏠 Dashboard nav item to admin sidebar (first item, matching patient/therapist structure)
- Added Dashboard tab content — welcome heading and user name, matching the patient/therapist dashboard view

### *web\src\app\(app)\camera\CameraClient.tsx*
- Added `Link` import and derived `dashboardHref` from `user?.role` (admin → `/dashboard/admin`, therapist → `/dashboard/therapist`, patient → `/dashboard/patient`)
- Added "← Back to Dashboard" link above the Camera heading so the page is navigable without the top nav
- Admin and therapist now load all exercises from `/api/exercises` and show only `ex_001`–`ex_006` (sorted) for troubleshooting purposes; patient logic is unchanged — only their therapist-assigned exercises appear via `/api/patient-exercises`

### *web\src\app\(app)\session\page.tsx*
- Applied green color palette: page background `bg-green-50`; headings and labels `text-green-900`/`text-green-700`; progress bar track `bg-green-100` with `bg-green-700` fill; "Back to Dashboard" link `text-green-700`; "Start Exercise" button `bg-green-700 hover:bg-green-800`; summary stat colors unified to green shades; pending status badge changed from blue to `bg-green-100 text-green-700`

### *web\src\app\(app)\dashboard\therapist\layout.tsx (new)* 
- Created shared layout for all therapist sub-routes — renders `bg-green-900` sidebar with `usePathname()` active detection, mobile hamburger + overlay, and `{children}` in `<main>`
- NAV array: 🏠 Dashboard (exact match), 👤 View Profile, 👥 Manage Patients, 🏋️ Manage Exercises, 📋 Assign Exercise, 📝 Exercise Program, 📷 Camera
- Active item: `bg-green-700 text-white font-medium`; inactive: `text-green-200 hover:bg-green-800`
- Logout button at bottom: `mt-auto pt-6 mb-4`, `bg-red-600 hover:bg-red-700`

### *web\src\app\(app)\dashboard\therapist\page.tsx*
- Replaced single-page tab-switching component with a minimal dashboard page — only renders a welcome heading and user name
- Auth redirect preserved: redirects non-therapist users to `/dashboard`
- All other tab content moved to dedicated route pages

### *web\src\app\(app)\dashboard\therapist\profile\page.tsx (new)* 
- View Profile page — fetches therapist profile (`/api/users/${user.id}`) and assigned patients (`/api/users?role=patient&therapistId=`) in parallel
- Renders Therapist Information card (full name, email, ID, specialty, clinic, gender, age, DOB) and Assigned Patients list

### *web\src\app\(app)\dashboard\therapist\patients\page.tsx (new)* 
- Manage Patients page — fetches patients for the therapist and loads each patient's exercises in parallel
- Search filter, Refresh button, and View/Start Session action buttons per patient card
- "← Back to Patients" link in patient detail now correctly routes to `/dashboard/therapist/patients`

### *web\src\app\(app)\dashboard\therapist\exercises\page.tsx (new)* 
- Manage Exercises page — fetches all exercises and renders System and Custom exercise sections with inline edit (name + description) via `ExerciseRow` sub-component

### *web\src\app\(app)\dashboard\therapist\assign\page.tsx (new)* 
- Assign Exercise page — loads patients, exercises, and templates; pre-fills existing patient exercises when a patient is selected; template merges into current selection; validates sets/reps before submitting to `/api/patient-exercises`; uses `AssignRow` sub-component

### *web\src\app\(app)\dashboard\therapist\programs\page.tsx*
- Removed `min-h-screen bg-green-50` outer wrapper (layout now provides the page background and full-height container); content div `max-w-5xl mx-auto px-8 py-8` is now the outermost element
- Loading state simplified to `flex items-center justify-center p-12` without a full-screen wrapper

### *web\src\app\(app)\dashboard\therapist\patients\[id]\page.tsx*
- Removed `min-h-screen bg-gray-50` from loading, not-found, and main return wrappers — layout provides the background; main return is now `max-w-5xl mx-auto px-8 py-8`
- Fixed "← Back to Patients" link to point to `/dashboard/therapist/patients` instead of `/dashboard/therapist`

--- 

## 📌 Update-5-19-26 | *RyanCodesling*
Pose / rep-counting sprint (multi-day, LLM-assisted). Net outcome below — `ex_004` bidirectional rep counting was iterated heavily and is now **frozen** as a proof-of-concept-adequate mitigation (see Current Status).

- Implemented shoulder flexion (`ex_002`) and scapular elevation + baseline capture (`ex_003`) — both now code-complete
- Real `holdDurationMs` (was a hardcoded `0` placeholder); per-rep descent timing split into hold vs descent
- Bidirectional rep side tagging now uses sign-at-peak — fixes `ex_004` left/right mislabeling; added `neckSideAgreement` regression test
- Added `BidirectionalRepCounter` wrapper for `ex_004` — suppresses opposite-side return-stroke phantom reps; **frozen at iteration 8**
- Compensation score now computed from the same smoothed values the metric cards show (was using raw)
- Per-exercise smoothing override now applies to the bidirectional/unilateral path too (was silently ignored — only per-limb honored it)
- Fixed a ±180° boundary bug in shoulder abduction (right-side overhead returned `null` mid-rep)
- Added premature-descent-latch recovery to the shared rep-counter state machine
- Capture-readiness now has a 300 ms grace window so brief landmark flickers don't reset an in-progress rep
- Evaluated Heavy vs Full pose model — Heavy rejected (11 fps vs Full's ~20 fps on dev hardware); **decision: accept ~20 fps**
- Three-tier rep classification (`attempted` tier for reduced ROM) was implemented then **reverted** (see Current Status)
- Added profiling scripts and new test suites; full pose suite **69 green**

### *web\src\lib\pose\poseMetrics.ts*
- Implemented `computeShoulderFlexion()` (`ex_002`) — delegates to `computeShoulderAbduction()` (frontal-camera projection collapses both motions to the same measurement)
- Implemented `computeScapularElevation()` (`ex_003`) — trunk-axis projection of the ear-from-shoulder offset, normalized by trunk length; robust to forward lean
- Fixed ±180° boundary in `computeShoulderAbduction()` — right-side straight-overhead previously returned `null` mid-rep
- Corrected sign-convention JSDoc in all three neck-flexion functions to the authoritative **positive → patient's LEFT** (matches `computeLateralNeckTilt` and the registry); added a do-not-flip note

### *web\src\lib\pose\repCounter.ts*
- Implemented real `holdDurationMs` — added `descentStartTimeMs`; a pause at the peak is no longer absorbed into `descentDurationMs`
- Added `DESCENDING → ASCENDING` recovery — a real rep that briefly dips early then climbs higher is no longer frozen at a stale partial peak (shared change — affects all dynamic exercises)
- Reverted the three-tier `attempted` classification — back to two-tier complete/partial; constructor invariant restored to `repCompleteThreshold < startThreshold < minimumPeakThreshold ≤ targetROM`

### *web\src\lib\pose\repCounter.test.ts*
- Added hold-duration tests (explicit hold at peak; snappy one-frame hold) and premature-descent-latch recovery test
- Removed the three-tier classification tests with the revert; net 21 tests

### *web\src\lib\pose\bidirectionalRepCounter.ts (new)* 
- Wrapper around `RepCounter` for signed bidirectional exercises (`ex_004` Neck Lateral Flexion)
- Feeds `|angle|` to the state machine, tags side from sign-at-peak
- Post-rep neutral-settle gate with decoupled `restSettleBand` (default = `startThreshold`) + short refractory — suppresses return-stroke overshoot phantoms while allowing realistic loose-neutral alternation
- Bounded synthetic-neutral completion for missed-neutral cross-frame side changes at low frame rate; internal completion threshold derived from the settle band (registry `repCompleteThreshold` is too strict at webcam frame rate)

### *web\src\lib\pose\bidirectionalRepCounter.test.ts (new)* 
- Synthetic regression coverage: side tagging both directions, overshoot suppression, loose-neutral alternation, refractory release, limited-ROM partials, missed-neutral crossing (12 tests)

### *web\src\lib\pose\neckSideAgreement.test.ts (new)* 
- Pins that the display path and the rep-tag path produce the same side for the same input (2 tests)

### *web\src\lib\pose\scapularElevation.test.ts (new)* 
- Rest sanity, shrug direction, asymmetry preservation, forward-lean rejection, scale invariance, visibility gating (9 tests)

### *web\src\lib\pose\shoulderFlexion.test.ts (new)* 
- Overhead-range (150°–180°) coverage, monotonicity, cross-body `null`, visibility gating (11 tests)

### *web\src\lib\exercises\registry.ts*
- `ex_002`: shoulder flexion wired as primary metric
- `ex_003`: tuned scapular-elevation thresholds (torso-length deltas), `descentEpsilon 0.005`, `requiresBaselineCapture: true`, smoothing override `{ minCutoff: 0.3, beta: 0.01 }`
- `ex_004`: smoothing override `{ minCutoff: 0.5, beta: 0.05 }`; thresholds back to two-tier (`minimumPeakThreshold: 12`) after the three-tier revert; corrected the stale threshold comment

### *web\src\app\(app)\camera\CameraClient.tsx*
- Wired `ex_002` / `ex_003` / `ex_004` through their metrics and counters
- Per-session baseline capture for `ex_003`: per-side sample accumulate → **median** baseline → `baseline − raw` → per-limb smooth → per-limb counter
- Bidirectional exercises route through `BidirectionalRepCounter`
- Compensation score recomputed from `smoothedMetrics` (was `raw.compensationScore`)
- Generic smoothing loop is now primary-metric-aware (honors the registry smoothing override on every path, not just per-limb)
- Capture-readiness reset grace window (`CAPTURE_READINESS_RESET_GRACE_MS = 300`) so short flickers pause rather than reset counters
- `ex_004` debug ring buffer + `dumpNeckRepDebug()` console helper for live diagnosis

### *web\package.json*
- Added `profile:filter` and `profile:sweep` npm scripts

### *web\scripts (new)* 
- `profileOneEuroFilter.ts`, `sweepOneEuroFilter.ts` — OneEuroFilter profiling/sweep tooling; CSV output under `scripts/out/` (gitignored)


--- 

## 📌 Update-5-19-26 | *ralmeyda*
- Completed responsive sidebar layout for all dashboard pages (patient, therapist, admin) — collapsible slide-in sidebar with dark overlay on mobile, static on desktop
- Made the navbar responsive with a hamburger dropdown for mobile
- Renamed "Assign Patient" tab to "Assign Exercise" and "Exercise Templates" to "Exercise Program" on the therapist dashboard
- Renamed all user-visible "Template" labels to "Program" on the Exercise Program page
- Added horizontal scroll to the Manage Users and Currently Assigned Patients tables so action buttons remain accessible when zoomed in
- Added a browser-level `window.confirm` dialog as a second confirmation step before deleting a user
- Added an Assignment History table at the bottom of the Assign Patients tab that logs all assign/unassign actions with date and time (session only)
- Removed the ACC Bacoor logo from all pages

### *web\src\app\(app)\layout.tsx*
- Added `menuOpen` state and a hamburger button visible only on mobile (`sm:hidden`)
- Desktop nav links and logout button hidden on mobile (`hidden sm:flex` / `hidden sm:block`)
- Mobile dropdown renders below the navbar when hamburger is toggled, containing all nav links and logout
- Logo removed from the navbar

### *web\src\app\(app)\dashboard\patient\page.tsx*
- Added `sidebarOpen` state for mobile sidebar toggle
- Changed `<aside>` from static `w-64` to `fixed` slide-in on mobile with `translate-x`; reverts to `md:static` on desktop
- Added dark backdrop overlay (`fixed inset-0 z-30 bg-black/50 md:hidden`) that closes sidebar on tap
- Added `☰ Menu` hamburger button at top of `<main>` visible only on mobile (`md:hidden`)
- Sidebar nav items call `setSidebarOpen(false)` on click to auto-close on mobile
- Changed main padding to `p-4 sm:p-6` and added `min-w-0`

### *web\src\app\(app)\dashboard\therapist\page.tsx*
- Added `sidebarOpen` state; same slide-in sidebar pattern as patient dashboard
- Added mobile backdrop overlay and `☰ Menu` hamburger button in `<main>`
- Changed main padding to `p-4 sm:p-6` and added `min-w-0`
- Renamed "Assign Patient" sidebar tab label → "Assign Exercise"
- Renamed "Exercise Templates" sidebar link → "Exercise Program"
- Updated all visible "template/Template" strings in the Assign Exercise tab to "program/Program"

### *web\src\app\(app)\dashboard\admin\page.tsx*
- Added `sidebarOpen` state; same responsive sidebar pattern as other dashboards
- Added dark backdrop overlay and `☰ Menu` hamburger button in `<main>`
- Changed main padding from `p-8` to `p-4 sm:p-8` and added `min-w-0`
- Added `window.confirm` inside `confirmDeleteUser` — fires after the modal's Delete button is clicked; cancelling aborts deletion without closing the modal
- Wrapped Manage Users table in `overflow-x-auto` with `min-w-[600px]` on the table for horizontal scroll on small screens
- Wrapped Currently Assigned Patients table in `overflow-x-auto` with `min-w-[600px]`
- Added `assignHistory` state and `addHistory` helper to record assign/unassign events
- `handleAssignPatient` calls `addHistory("assigned", ...)` on success
- `handleUnassignPatient` calls `addHistory("unassigned", ...)` on success
- Added Assignment History section at the bottom of the Assign Patients tab — table with Action badge (green/red), Patient, Therapist, Date, and Time columns; newest entries appear first; session-only (clears on refresh)

### *web\src\app\(app)\dashboard\therapist\templates\page.tsx*
- Renamed page title: "Exercise Templates" → "Exercise Program"
- Updated subtitle, loading text, form section heading ("Template Name" → "Program Name"), button labels ("Create New Template" → "Create New Program", "Update Template" → "Update Program", "Create Template" → "Create Program"), list heading ("Your Templates" → "Your Programs"), empty state text, and all alert/confirm dialog strings

---

## 📌 Update-5-12-26 | *Enah*
- Removed **Profile** nav link and deleted the placeholder profile page — profile functionality is now inside each role's dashboard under the View Profile tab
- Fixed `TypeError` in Login page — removed invalid `setUser` destructure from `useAuth()` which is not exposed by `AuthContextType`
- Added **View Profile** tab to Therapist Dashboard — shows therapist info and assigned patients, fully database-driven with empty states directing users to contact the admin
- Added **View Profile** tab to Patient Dashboard — shows patient info and assigned exercises, fully database-driven with empty states directing users to contact the therapist; converted patient dashboard to tab-based layout matching therapist dashboard styling
- Fixed `ReferenceError: setLoading is not defined` crash on the Therapist Dashboard
- Removed Therapist ID field from Edit User Details form for therapist accounts
- Added dedicated SQL file for patient-therapist assignment `patient_therapist_pg.sql`
- Rewrote Patient Profile page — fully database-driven, zero localStorage
- Implemented Exercise Templates fully from the database — per-therapist templates with multi-select system exercises, custom exercises with sets/reps, persisted to PostgreSQL
- Custom exercises now save to the `exercises` table with `is_custom = true` and auto-incremented `ex_XXX` ID format — no more local-only state
- Restructured Therapist Dashboard into four tabs: Dashboard, Manage Patients, Manage Exercises, Assign Patient
- Therapist can now assign exercises (system or custom) or load from a template directly to a patient with sets/reps per exercise

### *web\src\app\(app)\layout.tsx*
- Removed `<Link href="/profile">Profile</Link>` from the top nav — profile is now accessible per role inside the dashboard View Profile tab

### *web\src\middleware.ts*
- Removed `"/profile"` from the `protectedRoutes` array — route no longer exists

### *web\src\app\(app)\profile\page.tsx*
- Deleted placeholder profile page and its folder — was a static stub with no real functionality; superseded by the View Profile tab on each role's dashboard

### *web\src\app\(auth)\login\page.tsx*
- Removed duplicate `useAuth()` call on line 12 that attempted to destructure `setUser` — `setUser` is not part of `AuthContextType` (context only exposes `login`, `logout`, `user`, `loading`, `isAuthenticated`)
- `login` was already correctly destructured from `useAuth()` further down the component; the erroneous line caused a TypeScript error with no runtime fallback

### *web\src\app\(app)\dashboard\therapist\page.tsx*
- Added `"view-profile"` to the `ActiveTab` union type and `NAV_TABS` array
- Added `TherapistProfile` interface for full profile data
- Added `therapistProfile` state; fetched in parallel with patients, exercises, and templates in `loadData()` via `GET /api/users/:id`
- **View Profile tab** — two sections:
  - *Therapist Information*: displays Full Name, First/Middle/Last Name, Email, Therapist ID, Specialty, Clinic ID, Gender, Age, Date of Birth — each field shows "Not set — contact admin" when null
  - *Assigned Patients*: lists all patients assigned to the therapist (name, email, system ID); shows a blue info banner directing to contact the admin when empty
- Added `ProfileField` sub-component for consistent label/value display with null-state fallback

### *web\src\app\(app)\dashboard\patient\page.tsx*
- Converted from a static single-view page to a tab-based layout matching the therapist dashboard styling
- Added `"view-profile"` to `ActiveTab` union; sidebar now uses the same button-based tab navigation with green active highlight
- Added `PatientProfile` and `AssignedExercise` interfaces
- Added `patientProfile` and `exercises` state; both fetched in parallel on mount via `loadData()`
- Profile fetched from `GET /api/users/:id`; exercises fetched from `GET /api/patient-exercises`
- **View Profile tab** — two sections:
  - *Patient Information*: Full Name, First/Middle/Last Name, Email, Gender, Age, Date of Birth, Diagnosis, Prescription, Condition, Assigned Therapist — each null field shows "Not set — contact therapist"
  - *Assigned Exercises*: lists all exercises (name, description, sets × reps, color-coded status badge); shows a blue info banner directing to contact the therapist when empty
- Added `ProfileField` sub-component (identical pattern to therapist dashboard)
- Retained Session and Start Session sidebar links

### *web\src\app\api\users\[id]\route.ts*
- Fixed `GET /api/users/[id]` to allow therapists to fetch their own profile — previously the therapist-role guard only permitted fetching assigned patients, blocking self-lookup needed for the View Profile tab
- Therapists may now access `id === sessionUser.id` (self) or assigned patients; all other combinations remain 403
- Added patient-role guard: patients may only fetch their own profile (`id === sessionUser.id`), preventing cross-patient data access

### *web\src\app\(app)\dashboard\therapist\page.tsx*
- Replaced `setLoading(false)` with `setPageLoading(false)` in the `finally` block of `loadAssignedPatients()` — `setLoading` was never declared in this component
- Removed duplicate `setPageLoading(false)` call that appeared outside the `finally` block
- Removed unused "Settings" navigation tab
- Added `PatientExercise` interface and `exercises` field to `PatientData` — each patient card now fetches and displays their assigned exercises from the database
- Exercises for all assigned patients are fetched in parallel with `Promise.all` after loading the patient list
- Each patient card shows exercise name, sets × reps, and a color-coded status badge (pending / in_progress / completed)
- Refresh button now re-fetches both the patient list and all their exercises from the database
- Fixed `useEffect` dependency to trigger `loadAssignedPatients` only after auth is resolved (`!loading && user?.id`)
- No localStorage usage — all data sourced from PostgreSQL via API

### *web\src\app\api\patient-exercises\route.ts*
- Extended to support therapist access — therapists can now pass `?patientId=xxx` to fetch a patient's exercises
- Added ID validation — verifies the `patientId` belongs to a user with `role = 'patient'` assigned to the requesting therapist before returning data, preventing cross-therapist access and preventing admin/therapist IDs from being passed as `patientId`
- Patients still get only their own exercises (no query param needed)
- Returns 400 if a therapist calls the endpoint without `patientId`
- Returns 403 if the `patientId` is not assigned to the requesting therapist

### *web\src\app\(app)\dashboard\therapist\patients\[id]\page.tsx*
- Fully rewrote Patient Profile page — removed all localStorage (admin_users, admin_exercises, patient_exercises, exercise_templates, patient_sessions keys)
- Fetches patient info from `GET /api/users/[id]` and exercises from `GET /api/patient-exercises?patientId=` in parallel
- Shows Personal Information: Full Name, Age, Email, Progress Status badge, Assigned Specialist name
- Progress Status is derived from exercise statuses (not started / in progress / progressing / completed)
- Assigned Specialist name is joined from the therapist's row in the users table
- Ongoing Exercises section: exercises with status `pending` or `in_progress`, color-coded badge, View Exercise button
- Finished Exercises section: exercises with status `completed`, green Completed badge
- Sessions Record section: empty state (no sessions table yet)

### *web\src\lib\db.ts*
- Added `getUserById(id)` — fetches a single user by id, LEFT JOINs the therapist's name from the users table so the patient profile can display the Assigned Specialist name in one query
- Added `getTemplates(therapistId)` — single query with `json_agg` + `FILTER` to fetch all templates and their exercises for the requesting therapist only; returns empty array for templates with no exercises
- Added `createTemplate()` — inserts into `exercise_templates` then all rows into `template_exercises` inside a single transaction; rolls back on any error
- Added `updateTemplate()` — verifies ownership, updates template name and timestamp, deletes all existing `template_exercises` rows then re-inserts the new set, all inside a transaction
- Added `deleteTemplate()` — deletes only if the record belongs to the requesting therapist; returns `false` if not found or not owned
- Added `PoolClient` import from `pg` to correctly type the `insertTemplateExercises` transaction helper
- Added `getNextExerciseId()` — queries the highest `ex_XXX` formatted ID in the `exercises` table and returns the next zero-padded ID (e.g. `ex_007`); returns `ex_001` if no matching IDs exist
- Updated `createExercise()` to accept `isCustom` parameter and write it to the `is_custom` column

### *web\src\app\api\users\[id]\route.ts*
- Fixed root cause of assign/unassign/edit/delete not persisting to the database — Next.js 15+ changed `params` to a `Promise`, so `params.id` was `undefined` and every `WHERE id = $1` matched nothing
- Updated both `PUT` and `DELETE` handlers to destructure `id` from `await params` instead of accessing `params.id` directly
- Added `GET /api/users/[id]` handler — returns a single user with therapist name included; therapists can only fetch their own assigned patients (403 otherwise)

### *web\src\app\(app)\dashboard\admin\page.tsx*
- Removed Therapist ID input field from the Edit User Details form under the Therapist Information section — `therapistIDNum` is an internal system field and should not be manually editable by admin
- Edit User Details persists all changes to PostgreSQL via `PUT /api/users/[id]` — no localStorage used anywhere in this page
- Assign Patients persists `therapist_id` to the `users` table via `PUT /api/users/[id]` — assign and unassign both go directly to the database
- Fixed "Currently Assigned Patients" table always being hidden — removed `assignedPatients.length > 0` conditional wrapper so the table is always rendered
- Added empty state row ("No patients have been assigned yet.") when there are no assignments
- Added patient count to the "Currently Assigned Patients" section heading

### *scripts\patient_therapist_pg.sql*
- Fixed FK constraint not being applied — `ADD COLUMN IF NOT EXISTS` skips the whole statement when the column already exists (added by `user_credentials_pg.sql`), so the FK was never created
- Separated the column creation and FK constraint into two independent statements
- FK constraint is now added via a `DO $$ ... IF NOT EXISTS ... $$` block that checks `pg_constraint` before applying, making it safe to re-run
- `therapist_id` stores the assigned therapist's user id (e.g. `therapist_001`) with `ON DELETE SET NULL`

### *scripts\patient_exercises_pg.sql*
- Removed all demo seed `INSERT` statements for `patient_001` — Lateral Arm Raises, Shoulder Shrugs, and the other 4 pre-seeded exercises were leftovers from the localStorage era and should not be pre-populated
- Exercises are now assigned exclusively through the therapist dashboard UI, not seeded by the SQL file
- Table schema and `ALTER TABLE` safety statements are unchanged

### *scripts\exercises_pg.sql*
- Added `is_custom BOOLEAN NOT NULL DEFAULT FALSE` column to the `exercises` table
- Added `ALTER TABLE exercises ADD COLUMN IF NOT EXISTS is_custom ...` — safe to re-run on existing tables
- System exercises (`ex_001`–`ex_006`) default to `is_custom = FALSE`; therapist-created custom exercises are saved with `is_custom = TRUE`

### *scripts\exercise_templates_pg.sql*
- Created new SQL file for exercise templates — run in pgAdmin after `exercises_pg.sql`; both `CREATE TABLE IF NOT EXISTS` blocks are safe to re-run
- `exercise_templates` table:
  - `id VARCHAR(50) PRIMARY KEY` — format `tmpl_<timestamp>`, generated at insert time in `createTemplate()`
  - `therapist_id VARCHAR(50) NOT NULL` — FK → `users(id)` with `ON DELETE CASCADE`; each template is owned by exactly one therapist
  - `name VARCHAR(255) NOT NULL` — display name of the template
  - `created_at`, `updated_at TIMESTAMP` — default to `CURRENT_TIMESTAMP`
- `template_exercises` table:
  - `id SERIAL PRIMARY KEY` — auto-incrementing row ID
  - `template_id VARCHAR(50) NOT NULL` — FK → `exercise_templates(id)` with `ON DELETE CASCADE`; deleting a template removes all its exercise rows
  - `exercise_id VARCHAR(50)` — FK → `exercises(id)` with `ON DELETE SET NULL`; always populated now that custom exercises are saved to the `exercises` table before being added to a template
  - `name VARCHAR(255) NOT NULL`, `description TEXT` — denormalized from the referenced exercise
  - `is_custom BOOLEAN NOT NULL DEFAULT FALSE` — mirrors the `exercises.is_custom` flag of the referenced exercise
  - `sets INT`, `reps INT` — per-template prescription for this exercise
- Indexes: `idx_et_therapist_id` on `exercise_templates(therapist_id)`, `idx_te_template_id` on `template_exercises(template_id)`
- GRANT statements: `ALL PRIVILEGES` on both tables and `USAGE, SELECT` on `template_exercises_id_seq` granted to the `postural` user

### *web\src\app\api\exercises\route.ts*
- Updated `POST /api/exercises` to use `getNextExerciseId()` — new exercises follow `ex_001` format instead of timestamp-based IDs
- Updated `POST /api/exercises` to accept `isCustom` boolean and pass it to `createExercise()`
- Both `name` and `description` are now validated as required (trimmed)

### *web\src\app\api\templates\route.ts*
- Created `GET /api/templates` — returns all templates (with exercises) for the logged-in therapist; 401 if unauthenticated, 403 if not a therapist
- Created `POST /api/templates` — creates a new template; validates name and requires at least one exercise

### *web\src\app\api\templates\[id]\route.ts*
- Created `PUT /api/templates/[id]` — updates template name and replaces all exercises; ownership verified before any write
- Created `DELETE /api/templates/[id]` — deletes template; returns 404 if not found or not owned by requesting therapist
- Both handlers use `await params` (Next.js 15+ Promise params pattern)

### *web\src\app\(app)\dashboard\therapist\templates\page.tsx*
- Removed all `localStorage` usage (`admin_exercises`, `exercise_templates` keys)
- Exercises loaded from `GET /api/exercises` on mount — therapist always sees the live system exercise list
- Templates loaded from `GET /api/templates` on mount — therapist sees only their own templates
- System and custom exercises both appear as multi-select checkboxes; selecting any exercise reveals inline sets and reps fields
- "Add New Custom Exercise" section: name (required), description (required), sets (required, min 1), reps (required, min 1) — all fields validated before submission
- Clicking "Add Custom Exercise" POSTs to `POST /api/exercises` with `isCustom: true`; the new exercise is saved with the next `ex_XXX` ID, automatically added to the exercises list, and auto-selected with the provided sets/reps
- Removed local-only `customExercises` state — all exercises now live in the `exercises` table
- Custom exercises display a "custom" badge and show their `ex_XXX` ID in the exercise list
- Save calls `POST /api/templates` (create) or `PUT /api/templates/[id]` (edit); `isCustom` is derived from the exercise's `is_custom` DB field, not local state
- Delete calls `DELETE /api/templates/[id]`
- Template cards preview exercise list with sets×reps and "custom" badge

### *web\src\app\api\exercises\[id]\route.ts*
- Fixed `params` to use `await params` (Next.js 15+ Promise params) — `params.id` was previously accessed directly causing a TypeScript error
- Added `PUT /api/exercises/[id]` — updates `name` and `description` of any exercise; both fields are required and trimmed; returns 404 if ID not found

### *web\src\app\api\patient-exercises\route.ts*
- Added `POST /api/patient-exercises` — therapist-only endpoint to bulk-assign exercises to one of their patients
- Accepts `{ patientId, exercises: [{ exerciseId, sets, reps }] }` in the request body
- Verifies the `patientId` belongs to a patient assigned to the requesting therapist before writing
- Uses `ON CONFLICT (exercise_id, patient_id) DO UPDATE SET sets, reps` — re-assigning an already-assigned exercise updates its sets/reps rather than erroring

### *web\src\lib\db.ts*
- Added `updateExercise(id, data)` — updates `name` and/or `description` of an exercise row; dynamically builds SET clause; returns updated row or `null` if not found
- Added `assignExercisesToPatient(patientId, exercises)` — loops through exercise array inside a transaction, inserting each row with `ON CONFLICT DO UPDATE` so duplicate assignments update sets/reps rather than failing

### *web\src\app\(app)\dashboard\therapist\page.tsx*
- Replaced single-view layout with a four-tab sidebar: **Dashboard** (blank placeholder), **Manage Patients**, **Manage Exercises**, **Assign Patient**; Exercise Templates remains a sidebar link to `/dashboard/therapist/templates`
- Active tab is highlighted in green; tab state is local — no route change
- All data (patients + exercises, all patients' exercises, templates) is loaded in one parallel `loadData()` call on mount and after any mutation
- **Dashboard tab**: blank welcome screen for now
- **Manage Patients tab**: preserves existing patient list (lines 139–218) — search bar, per-patient exercise badge list with status colors, View and Start Session buttons
- **Manage Exercises tab**: shows exercises categorized into System Exercises (`is_custom = false`) and Custom Exercises (`is_custom = true`); each row shows ID, name, description, and an Edit button; inline edit form replaces the row with name and description inputs; Save calls `PUT /api/exercises/[id]` and updates local state without a full reload
- **Assign Patient tab**:
  - Step 1: patient dropdown (only therapist's assigned patients); on patient select, their existing `patient_exercises` rows are fetched and pre-checked with current sets/reps so the therapist can see and adjust what is already assigned
  - Step 2: optional template dropdown — selecting a template **merges** its exercises into the current selection; template sets/reps override existing values for matching exercises; a live preview card shows all exercise names and sets×reps for the selected template before applying
  - Step 3: multi-select exercise list, split into System and Custom sections; each checked exercise reveals required sets and reps fields
  - Submit calls `POST /api/patient-exercises`; on success clears the form and refreshes data
  - Inline success/error banners for submit feedback
  - `useEffect` on `assignPatientId` — clears selection when patient is deselected; fetches and pre-populates exercises when a new patient is chosen
- Extracted two reusable sub-components at the bottom of the file: `ExerciseRow` (Manage Exercises inline edit) and `AssignRow` (Assign Patient multi-select row with sets/reps)

---

## 📌 Update-5-11-26 | *RyanCodesling*
- Implemented the real shoulder abduction metric for Lateral Arm Raises (`ex_001`)
- Added per-side shoulder abduction calculation for left and right arms
- Fixed cross-body arm movement being mistaken as valid lateral arm raise motion
- Updated rep counting so per-limb exercises use separate left and right metric streams
- Added dedicated smoothing filters for left and right primary metrics
- Added per-side metric output from `computePoseMetricsForExercise()`
- Added a continuity gate to the rep counter so reps cannot start from stale or invalid motion data
- Expanded rep counter tests to cover continuity-gate behavior
- Added a new shoulder abduction test suite with synthetic landmark poses
- Preserved null-return behavior for invalid, hidden, or cross-body landmark states

### *web\src\lib\pose\poseMetrics.ts*
- Implemented `computeShoulderAbduction()` for `ex_001` Lateral Arm Raises
- Uses shoulder-to-elbow angle instead of shoulder-to-wrist for a cleaner upper-arm measurement
- Uses the trunk-down vector from shoulder midpoint to hip midpoint as the body-relative reference
- Added left/right side handling so lateral abduction is positive on both sides
- Returns `null` for cross-body adduction instead of using `Math.abs()`
- Prevents cross-body motion from being interpreted as a valid arm raise
- Added visibility checks for shoulders, hips, and the active elbow landmark
- Added `perSideMetrics` to `ExerciseFrameMetrics`
- Updated `computePoseMetricsForExercise()` to compute left and right primary metrics separately for `per-limb` exercises
- Keeps the left-side value in the main metrics map for existing UI compatibility
- Leaves shoulder flexion, scapular elevation, trunk lateral flexion, and shoulder horizontal abduction as future metric implementations

### *web\src\lib\pose\repCounter.ts*
- Added a continuity gate before allowing `WAITING_FOR_REP_START → ASCENDING`
- Requires the limb to be observed below `startThreshold` before a new rep can begin
- Clears rest evidence after long update gaps to avoid counting stale motion
- Uses skipped/null metric frames as a signal that the limb left the valid measurable region
- Prevents invalid cross-body → overhead → lateral-return motion from triggering a false rep
- Reset now clears continuity state in addition to the normal rep state
- Added `REST_GAP_THRESHOLD_MS` for detecting stale tracking gaps
- Strengthened constructor validation for invalid threshold ordering

### *web\src\lib\pose\repCounter.test.ts*
- Added continuity-gate test for refusing reps that start without prior rest evidence
- Added continuity-gate test for refusing reps after a long simulated tracking gap
- Added test confirming back-to-back reps still work after clean rest frames
- Updated test coverage from the original rep counter behavior to include stale-input protection
- Kept coverage for complete reps, partial reps, false starts, jitter handling, reset behavior, and threshold validation

### *web\src\lib\pose\shoulderAbduction.test.ts*
- Added synthetic landmark tests for the new shoulder abduction metric
- Added tests for arms hanging at rest returning near `0°`
- Added tests for left and right horizontal arm raises returning near `90°`
- Added tests for 45° and 20° left arm abduction
- Added cross-body tests to confirm invalid inward arm motion returns `null`
- Added camera-roll invariance test to confirm body-relative measurement stays stable
- Added missing-landmark tests for elbow, hip, and shoulder visibility failure cases

### *web\src\app\(app)\camera\CameraClient.tsx*
- Added separate OneEuroFilter instances for left and right primary metrics
- Updated per-limb rep counting to read from `raw.perSideMetrics`
- Feeds the left rep counter only the left-side metric stream
- Feeds the right rep counter only the right-side metric stream
- Allows each side to independently skip rep-counter updates when its metric is `null`
- Prevents one arm’s smoothing history from bleeding into the other arm’s rep detection
- Keeps bidirectional-alternating and unilateral rep-counting behavior unchanged
- Resets per-side filters when the selected exercise changes or capture readiness fails

---

## 📌 Update-5-10-26 | *ralmeyda*
- Added reusable status banner system for Admin Dashboard actions
- Added success and error feedback messages for user creation
- Added automatic fade-out animation for status banners after 5 seconds
- Added a delete confirmation modal before permanently removing users
- Improved delete workflow with safer confirmation handling
- Added success and error feedback messages for user deletion
- Updated the delete button behavior to open a modal instead of instantly deleting users
- Added validation for Date of Birth fields to prevent future dates
- Added minimum allowed birth date range (1900-01-01)
- Added age input validation to prevent entering more than 3 digits
- Replaced ineffective maxLength handling on type="number" inputs with JavaScript validation logic
- Preserved native number input spinner functionality using max="150"
  
### *web\src\app(app)\dashboard\admin\page.tsx*
- Added new state handlers for status notifications:
  - statusMessage
  - statusType
  - statusVisible
- Added useEffect() for automatic status banner fade-in and fade-out transitions
- Added error handling in handleAddUser():
  - Displays "User successfully added." on successful creation
  - Displays API/server error messages when creation fails
- Added new delete confirmation modal states:
  - isDeleteModalOpen
  - deleteUserId
  - deleteUserName
- Created openDeleteModal(user) helper to initialize delete confirmation data
- Created closeDeleteModal() helper to safely reset modal state
- Added confirmDeleteUser() async handler:
  - Sends DELETE request to /api/users/[id]
  - Removes deleted user from local state
  - Displays success/error banners depending on API response
- Added animated status banner UI above the Users table:
  - Green banner for success states
  - Red banner for error states
  - Uses opacity transition for smooth fade effect
- Added reusable delete confirmation modal UI with:
  - Darkened backdrop overlay
  - Cancel button
  - Confirm Delete button
  - Dynamic selected user name display
- Replaced direct delete action:
  - From handleDeleteUser(u.id)
  - To openDeleteModal(u)
- Improved UX by preventing accidental instant deletion of users
- Added validation to Add User Date of Birth field:
  - max={new Date().toISOString().split('T')[0]}
  - min="1900-01-01"
- Added validation to Edit User Date of Birth field:
  - Prevents selecting future dates
  - Restricts dates below year 1900
- Updated Add User age field validation:
  - Prevents typing more than 3 digits using custom onChange logic
  - Retains min="0" and max="150" constraints
- Updated Edit User age field validation:
  - Prevents typing values longer than 3 digits
  - Maintains native increment/decrement controls
- Removed ineffective maxLength approach for numeric inputs and replaced it with controlled validation logic

---

## 📌 Update-5-8-26 | *Enah*
- Fixed "Dashboard" nav link redirecting all roles to Log In — Patient instead of their own dashboard
- Migrated all localStorage data (users, exercises, patient-exercise assignments) to PostgreSQL — data now persists across browsers and sessions
- Wired patient session page to PostgreSQL — assigned exercises now load per logged-in patient from the database instead of a hardcoded schedule
- Split "Full Name" into First Name, Middle Name, and Last Name in both Add and Edit user forms
- Auto-generated sequential user IDs in `patient_001` / `therapist_001` format based on existing DB count
- Auto-generated temporary password as `LastName + BirthYear` — multi-word last names have spaces removed and each word capitalized (e.g., `Delos Santos 2000` → `DelosSantos2000`)

### *web\src\lib\AuthContext.tsx*
- Added `setUser` to the context type and exported value so other components can update auth state directly
- Added `/api/auth/me` fallback in the initialization effect — if localStorage is empty, the context now recovers the session from the server-side cookie instead of treating the user as logged out

### *web\src\app\(auth)\login\page.tsx*
- Imported `useAuth` and called `setUser(result.user)` immediately after a successful login so the auth context is live for the rest of the session without requiring a page reload

### *web\src\app\api\auth\me\route.ts*
- Created new `GET /api/auth/me` endpoint that reads the `auth_token` httpOnly cookie and returns the current user, used by `AuthContext` as a session fallback

### *web\src\app\(app)\dashboard\patient\page.tsx*
- Added `"use client"` directive and wired to `useAuth()` so the sidebar shows the real authenticated user's name instead of the hardcoded "Placeholder User"

### *scripts\exercises_pg.sql*
- Created new `exercises` table with `id`, `name`, `description`, `created_at`
- Seeded all 6 thesis exercises (`ex_001` to `ex_006`)

### *scripts\patient_exercises_pg.sql*
- Created new `patient_exercises` table with foreign keys to both `users` and `exercises`, a unique constraint on `(exercise_id, patient_id)`, a status check (`pending`, `in_progress`, `completed`), and `sets`/`reps` columns
- Seeded all 6 exercises assigned to `patient_001` with sets and reps values

### *scripts\user_credentials_pg.sql*
- Added `ALTER TABLE` columns to the existing `users` table

### *web\src\lib\db.ts*
- Added `mapUser()` helper to convert snake_case DB columns to camelCase
- Added `getUsers(filters?)` — fetches patients and therapists, filterable by role and therapistId
- Added `createUser()`, `updateUser()`, `deleteUser()` for full user CRUD
- Added `getExercises()`, `createExercise()`, `deleteExercise()` for exercise CRUD
- Added `getPatientExercises(patientId)` to fetch a patient's assigned exercises with exercise details
- Updated `getPatientExercises(patientId)` query to include `sets`, `reps`, and exercise `name` and `description` from the joined `exercises` table
- Updated `mapUser()` to include `firstName`, `middleName`, `lastName` from new DB columns
- Added `getNextUserId(role)` — queries the highest existing ID for a role, parses the numeric suffix, and returns the next zero-padded ID (e.g., `patient_002`)
- Updated `createUser()` to accept and store `firstName`, `middleName`, `lastName`
- Updated `updateUser()` to accept and update `firstName`, `middleName`, `lastName` columns
- Added `types.setTypeParser(1082)` to return PostgreSQL `DATE` columns as plain `YYYY-MM-DD` strings, fixing date of birth not pre-filling in the Edit User form

### *web\src\app\api\users\route.ts*
- Created `GET /api/users` — returns all patients and therapists, supports `?role=` and `?therapistId=` query filters
- Created `POST /api/users` — creates a new user in PostgreSQL with a default password of `changeme123`

### *web\src\app\api\users\[id]\route.ts*
- Created `PUT /api/users/[id]` — updates any user field including `therapistId` for patient-therapist assignment and unassignment
- Created `DELETE /api/users/[id]` — deletes a user from the database
- Updated `PUT /api/users/[id]` to reconstruct the `name` field from `firstName`, `middleName`, `lastName` when they are provided, so the display name stays in sync

### *web\src\app\api\exercises\route.ts*
- Created `GET /api/exercises` — returns all exercises from the database
- Created `POST /api/exercises` — adds a new exercise to the database

### *web\src\app\api\exercises\[id]\route.ts*
- Created `DELETE /api/exercises/[id]` — removes an exercise from the database

### *web\src\app\(app)\dashboard\admin\page.tsx*
- Removed all 4 `localStorage` `useEffect` blocks (`admin_users`, `admin_exercises`, `patient_exercises` keys)
- Removed hardcoded `useState` seed data for users and exercises
- Added single `useEffect` on mount that fetches `/api/users` and `/api/exercises`
- Converted all 7 mutation handlers to `async` — `handleAddUser`, `handleDeleteUser`, `handleSaveEditUser`, `handleAssignPatient`, `handleUnassignPatient`, `handleAddExercise`, `handleDeleteExercise` now call the corresponding API routes

### *web\src\app\(app)\dashboard\therapist\page.tsx*
- Replaced `localStorage.getItem("admin_users")` in `loadAssignedPatients` with a fetch to `GET /api/users?role=patient&therapistId=...`

### *web\src\app\api\patient-exercises\route.ts*
- Created `GET /api/patient-exercises` endpoint — reads the `auth_token` cookie to identify the logged-in patient, returns only their assigned exercises with sets, reps, name, and status

### *web\src\app\(app)\session\page.tsx*
- Removed hardcoded `WEEK_SCHEDULE` array and all predefined exercise data
- Added `useEffect` that fetches `/api/patient-exercises` on mount
- Exercises are distributed across weekdays dynamically using the current week's actual dates
- Added loading state and empty state when no exercises are assigned yet
- All styling, progress bar, status badges, and summary card kept identical

### *web\src\app\api\users\route.ts*
- Updated `POST /api/users` to call `getNextUserId(role)` for sequential ID generation
- Password is now auto-set to `LastName + BirthYear` instead of hardcoded `changeme123`
- Constructs `name` from the three name-part fields before saving

### *web\src\app\(app)\dashboard\admin\page.tsx*
- Added `firstName`, `middleName`, `lastName` to the `User` interface
- Updated `newUser` initial state and all reset calls to use the three name fields instead of `name`
- Updated `handleAddUser` to validate `firstName` + `lastName` instead of `name`
- Replaced single "Full Name" input with a 3-column grid (First Name, Middle Name, Last Name) in the Add New User form and Edit User Details form
- Removed Therapist ID field and replaced with Email in the Add New User Therapist form
- Updated therapist validation in `handleAddUser` to require `email` instead of `therapistIDNum`
- Fixed Edit User Details form — all saved fields now pre-fill correctly when clicking Edit
- Gender dropdown restricted to Male and Female only in both Add and Edit forms

---

## 📌 Update-5-4-26 | *RyanCodesling*

### *web\src\lib\exercises\registry.ts*
- Added exercise registry as the source of truth for the six thesis exercises (`ex_001` to `ex_006`)
- Added per-exercise configuration for primary metrics, compensation metrics, thresholds, bilateral mode, and isometric target bands
- Added support for both `per-limb` and `bidirectional-alternating` exercise handling
- Added validation for threshold ordering to prevent invalid rep-counting configurations
- Defined dynamic exercises separately from isometric hold exercises

### *web\src\lib\pose\repCounter.ts*
- Added hysteresis-based rep counting state machine
- Added `WAITING_FOR_REP_START`, `ASCENDING`, and `DESCENDING` states for cleaner rep detection
- Added threshold-based filtering for false starts, partial reps, and complete reps
- Added per-rep event output with peak value, ascent duration, descent duration, total duration, and classification
- Added reset support for exercise changes and pose detection dropouts

### *web\src\lib\pose\repCounter.test.ts*
- Added synthetic-data unit tests for the rep counter state machine
- Added no-framework test runner using inline assertion helpers
- Added reusable sample feeders for hand-crafted angle sequences
- Added smooth arc sample generator to simulate exercise repetitions
- Added tests for complete reps, partial reps, false starts, and multiple-rep indexing
- Added hysteresis and jitter tests to confirm the counter does not double-count unstable movement
- Added boundary tests for `targetROM`, `minimumPeakThreshold`, and below-minimum movements
- Added timing consistency tests for ascent duration, descent duration, hold duration, and total duration
- Added reset tests to confirm in-progress reps are discarded when capture drops
- Added constructor validation tests for invalid threshold configurations

### *web\src\lib\pose\poseMetrics.ts*
- Reworked posture scoring into exercise-specific compensation scoring
- Added `computeCompensationScore()` using only the compensation metrics declared in the exercise registry
- Added registry-aware metric computation through `computePoseMetricsForExercise()`
- Added metric resolver for primary and compensation metrics
- Added signed neck lateral flexion metric for Neck Lateral Flexion rep counting
- Added stub functions for shoulder abduction, shoulder flexion, scapular elevation, trunk lateral flexion, and shoulder horizontal abduction for future exercise support

### *web\src\app\(app)\camera\CameraClient.tsx*
- Integrated exercise registry into the camera page
- Added active exercise definition loading based on selected exercise
- Added dynamic metric cards that change depending on the selected exercise
- Added per-metric smoothing using `OneEuroFilter`
- Added rep counter initialization when switching exercises
- Added live rep counting for dynamic exercises
- Added support for bidirectional alternating exercises like Neck Lateral Flexion
- Added left/right rep tracking and console rep logs for debugging
- Replaced fixed posture metric UI with registry-driven primary and compensation metric display
- Added bidirectional stat panel showing LEFT, RIGHT, and TIME for alternating exercises
- Reset filters and rep counters when capture readiness fails or the selected exercise changes

### *web\src\app\(app)\camera\page.tsx*
- Kept camera route connected to the updated `CameraClient`

### *Current Status*
- Neck Lateral Flexion (`ex_004`) rep counting is working with live webcam input
- Other exercises are wired through the registry but still need their metric math implemented
- Isometric hold tracking for Arm Abduction at 90° is planned but not yet implemented

---

## 📌 Update-4-30-26 | *RyanCodesling*
### *web\src\lib\pose\poseMetrics.ts*
- Added trunkLean as a third metric
- Added a wrapper to handle the left-right convention, instead of having to swap out every left-right to right-left

### *web\src\app\(app)\camera\CameraClient.tsx*
- Added a trunk MetricCard

---

## 📌 Update-4-25-26 | *Enah*
### *web\src\app\page.tsx*
- Redesigned landing page UI with a blue color theme
- Replaced location pin icon with a standing human figure appropriate for physical therapy
- Updated button styles to rounded-full pill design with hover transitions
- Improved role selection modal with blue-tinted backdrop blur and rounded card

### *web\src\lib\db.ts*
- Fully migrated database connection from MySQL (`mysql2`) to PostgreSQL (`pg`)
- Now uses `DATABASE_URL` environment variable and `$1/$2` parameterized queries

### *web\package.json*
- Removed `mysql2` dependency
- Added `pg` and `@types/pg` dependencies

### *web\.env.local*
- Replaced MySQL env vars (`DB_HOST`, `DB_USER`, etc.) with single `DATABASE_URL` PostgreSQL connection string

### *scripts\user_credentials_pg.sql*
- Added PostgreSQL-compatible schema (replaces MySQL `user_credentials.sql` for deployment)
- Uses `CHECK` constraint instead of `ENUM`, and `ON CONFLICT DO NOTHING` for safe re-runs

### *AUTHENTICATION_SETUP.md*
- Rewrote all MySQL/phpMyAdmin instructions to PostgreSQL (`psql`, `pg`, `DATABASE_URL`)

### *scripts\user_credentials_pg.sql*
- Deleted old sql file with mysql queries — replaced as `user_credentials_pg.sql` for PostgreSQL

### *web\package-lock.json*
- Auto-updated by `npm install` after switching from `mysql2` to `pg`

---

## 📌 Update-4-24-26 | *RyanCodesling*
### *web\src\lib\pose*
- Added oneEuroFilter.ts for landmarker smoothing

### *web\src\app\(app)\camera\CameraClient.tsx*
- Added oneEuroFilter.ts implementations

---

## 📌 Update-4-17-26 | *ralmeyda*
- Removed exercise difficulty and timer/duration.

---

## 📌 Update-4-15-26 | *Enah*
- Fixed patient and therapist dashboard auth handling so `/dashboard` stays on the correct role dashboard rather than redirecting to login as patient
- Fixed logout redirect race condition by removing auth checks from patient/therapist pages to prevent conflicts with layout's redirect to main page

### *web/src/lib/auth.ts*
- Added `credentials: "same-origin"` to login and logout API requests to ensure auth cookies are persisted.

### *web/src/lib/AuthContext.tsx*
- Switched auth session resolution to `/api/auth/me` and removed localStorage-based auth state for login/logout.

### *web/src/app/(auth)/login/page.tsx*
- Updated login flow to call `login(result.user)` and avoid localStorage auth persistence.

### *web/src/app/api/auth/login/route.ts*
- Stored sanitized session user in `auth_token` instead of full DB row, and kept login logic on the database-backed route.

### *web/src/app/api/auth/me/route.ts*
- Added a new route to read the auth cookie and return the current user session.

### *web/src/app/api/auth/logout/route.ts*
- Fixed logout cookie deletion to clear the auth token path and allow redirect back to `/`.

### *web/src/app/(app)/layout.tsx*
- Updated dashboard nav link to route users directly to their own role-specific dashboard.

### *web/src/app/(app)/dashboard/page.tsx*
- Updated role redirect to use `router.replace(...)` for cleaner navigation from `/dashboard`.

### *web/src/app/(app)/dashboard/patient/page.tsx*
- Added role validation so patients stay on the patient dashboard and users with wrong roles are redirected to `/dashboard`.
- Fixed Placeholder Name in "Signed in as" display showing the authenticated user's name from the database.

### *web/src/app/(app)/dashboard/therapist/page.tsx*
- Added role validation so therapists stay on the therapist dashboard and users with wrong roles are redirected to `/dashboard`.
- Fixed Placeholder Name in "Signed in as" display showing the authenticated user's name from the database.

### *web/src/app/(app)/dashboard/admin/page.tsx*
- Fixed Placeholder Name in "Signed in as" display showing the authenticated user's name from the database.

---

## 📌 Update-4-13-26 | *ralmeyda*

Added 2 new database tables: therapist, patients

### *dashboard/admin/page.tsx* 
- Admin can now add a user and update to the database.
- Added Database function for Add User in admin side.
- Fix Patient-therapist assignment
- Added "Signed in as" display showing the authenticated user's name from the database.

### *dashboard/therapist/page.tsx* 
- The therapist can now view assigned patients
- Added "Signed in as" display showing the authenticated user's name from the database.

### *This is for the next sprint update* ❕
- **Fix Assign Patient** (Admin can still assign the patient to the therapist even though they're already assigned. Will add the re-assign feature.)

---

## 📌 Update-4-09-26  | *RyanCodesling*

### *web/source/lib/pose*
- Added poseMetrics.tsx for math engine

### *web/public/models*
- Upgraded pose_landmarker_lite.task to pose_landmarker_full.task

### *web/src/app/(app)/camera/CameraClient.tsx*
- Changed references of pose_landmarker_lite.task to pose_landmarker_full.task
- Removed placeholder metrics, now uses and shows live metrics referenced from poseMetrics.ts
- Added neck and shoulder metrics, as well as scoring
- UI/UX changes for better visibility
- Added color coded visualizers for metric deviation

### *web/src/lib/pose/captureReadiness.ts*
- Added knee(25,26) visibility requirement
- Adjusted centering of head(0) to the top quarter of the frame
- Replaced hint messages to natural language

---

## 📌 Update-4-08-26 | *Enah*

### *web/package.json*
- Added `mysql2` dependency for database connection

### *web/src/lib/db.ts*
- Created new database connection module with connection pool
- Added `getUser()` function to query users from database by email and role
- Configured environment variables for database host, user, password, and name

### *web/src/app/api/auth/login/route.ts*
- Migrated from hardcoded mock credentials to database queries
- Now validates user credentials against MySQL database
- Removed MOCK_USERS object and replaced with database lookup

### *web/.env.local*
- Created environment variables template for database configuration
- Includes DB_HOST, DB_USER, DB_PASSWORD, DB_NAME

### *scripts/user_credentials.sql*
- Created SQL file with users table schema including id, email, password, name, role, clinicId
- Added indexes on email and role for better performance
- Inserted 3 mock user records (patient, therapist, admin)

### *AUTHENTICATION_SETUP.md*
- Updated documentation to reflect database implementation
- Added database setup instructions for phpMyAdmin
- Added explanation of how `mysql2/promise` and phpMyAdmin work together
- Updated environment variables section
- Modified authentication flow description

---

## 📌 Update-3-31-26 | *ralmeyda*

### *dashboard/admin/page.tsx* 
- Added Age, Gender, Diagnosis, Prescription, and Condition when adding a new user
- When adding a new user ( Therapist ), the Therapist ID and Specialty were added.

### *dashboard/therapist/page.tsx* 
- Added Reps, Sets, weights, and notes when assigning exercise to the patient.
- The therapist can now view/edit the medical information about the patient.
- The therapist can now create a templated exercise, and can also add a custom exercise if the exercise is not part of the list ( Non-Machine Learning Exercises )
- When the template is already assigned to the patient, it cannot be selected again.
- The therapist can edit the exercises if they’re already assigned to the patient.
- The system will show the time, date, and notes when the exercise is edited.

---

## 📌 Update-3-25-26 | *Enah*

### *dashboard/patient/page.tsx* 
- Created subfolder for Patient Side
- Logout button redirects back to app\page.tsx

### *dashboard/page.tsx* 
- Now works as role-based router that redirects based on user’s role

### *dashboard/patient/page.tsx* 
- Created subfolder for Patient Side
- Logout button redirects back to app\page.tsx

### *dashboard/page.tsx* 
- Now works as role-based router that redirects based on user’s role

### *login/page.tsx*
- Removed Role Switcher
- Now have Admin Login
- Cancel Button on Role Login
- Eye Icon on Password Field

### *dashboard/admin/page.tsx* 
- Logout button redirects back to app\page.tsx
- Removed extra logout button

### *dashboard/therapist/page.tsx* 
- Logout button redirects back to app\page.tsx
- Removed extra logout button

### *(app)/layout.tsx*
- Logout functionality fixed
