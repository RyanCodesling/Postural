# Code map

Where each feature of Postural lives, so a reader can go from a feature to its
code. File paths are relative to the repository root. Line numbers for the
camera page are as of 2026-11-04 and drift as the file changes; search for the
named functions instead.

## Repository layout

| Folder | What it holds |
|---|---|
| `web/` | The app (Next.js 16, React 19, TypeScript). Everything patients, therapists and admins use. |
| `web/src/app/` | Pages and API routes (Next.js app router). `(app)/camera` is the camera session, `(app)/dashboard` the dashboards, `(auth)` the sign-in pages, `api/` the server routes. |
| `web/src/lib/` | Shared logic. `pose/` measures the body and coaches; `exercises/` defines the exercises and schedules; `analytics/` builds the progress trends; `recording/` handles session videos; `reports/` writes the PDFs; `db.ts` holds all database queries. |
| `web/scripts/` | Command-line tools: the offline coaching replay, exports for `ml/`, opt-in database tests, local backup. |
| `web/public/` | Static files: MediaPipe model files (`models/`), the trend worker bundle (`workers/`), demonstration clips (`demos/`), tour pictures (`tour/`). |
| `web/docs/` | The demo clock guide. |
| `scripts/` | PostgreSQL schema and migration files (`*_pg.sql`), run by hand on a server. |
| `deploy/server/` | Server setup and deploy scripts, with their runbook. |
| `ml/` | Offline Python, never run on the server. `ml/trend/` learns and evaluates the trend model whose settings the app reads; `ml/comparison/` is an archived pose-model benchmark; the rest (`generators/`, `features/`, `training/`, `analysis/`, `run.py`) is the synthetic form-quality classifier, which the app does not use. |
| `tools/blender/`, `assets/blender/` | Blender scripts and notes that render the demonstration clips. |

## How a camera session works

1. The patient opens `/camera`. `CameraClient.tsx` loads their assigned
   exercises and the MediaPipe Pose Landmarker, which runs in the browser.
2. Start asks about pain and whether to record video, then calibrates: a 5 s
   countdown to get into place and 3 s of standing still
   (`lib/pose/neutralCalibration.ts`). Calibration fixes the camera tilt and the
   resting lines of the head, shoulders and trunk.
3. Every camera frame (`predictWebcam`): find the body points, check the person
   is fully and clearly in view (`captureReadiness.ts`), measure the angles the
   exercise needs (`poseMetrics.ts`, as `registry.ts` defines them), count
   repetitions (`repCounter.ts`, `bidirectionalRepCounter.ts`) or time a hold,
   run the display-only checks, choose at most one coaching cue
   (`coachingCue.ts`) and draw it (`drawCompensationOverlay.ts`).
4. Each counted repetition and finished set is queued in `eventOutbox.ts`,
   sent to `api/sessions/[id]/rep-events` and `.../set-events`, and stored in
   the `rep_events` and `set_events` tables (`db.ts`).
5. End asks about pain again. A copy of the session kept in the browser
   (the Resume snapshot) lets a reloaded page continue the session.
6. The dashboards read the saved sessions: summaries, trends, PDF reports and
   the session video.

## Features and their code

Paths below are under `web/src/` unless they start with another top-level folder.

| Feature | Code |
|---|---|
| Sign-in and roles | `app/(auth)/login`, `app/api/auth/*`, `lib/session-token.ts` (signed session cookie), `lib/auth-server.ts`, `proxy.ts` (route guard), `lib/AuthContext.tsx`, `lib/auth.ts`, `lib/crypto.ts` (password hashing) |
| Password reset and change | `app/(auth)/forgot-password`, `change-password`, `first-time-password`; `api/auth/forgot-password`, `verify-otp`, `reset-password`, `change-password`; `dashboard/_components/ChangePasswordModal.tsx` |
| Accounts (admin) | `app/(app)/dashboard/admin/page.tsx`, `app/api/users/*`, `lib/adminUserEdit.ts`; who is online: `admin/UserStatusPanel.tsx`, `lib/presence.ts`, `lib/usePresenceHeartbeat.ts`, `api/presence` |
| Patient clinical fields and files | `api/users/[id]/clinical`, `api/users/[id]/attachments/*`, `lib/patientAttachments.ts`, `dashboard/_components/PatientFileViewer.tsx` |
| Exercise definitions (camera exercises) | `lib/exercises/registry.ts`: each exercise's measured angle, counting thresholds, coaching checks and their provenance |
| Custom exercises and guide videos | `api/exercises/*`, `dashboard/therapist/exercises/page.tsx`, `lib/exercises/customVideo.ts`, `customVideoStorage.ts`, `dashboard/_components/ExerciseVideoField.tsx`, `VideoGuide.tsx` |
| Prescriptions and programs | `dashboard/therapist/assign/page.tsx`, `programs/page.tsx`, `api/patient-exercises`, `api/programs/*`, `lib/prescriptionContext.ts`, `prescriptionLimits.ts`, `programExerciseInput.ts`, `lib/exercises/prescriptionStatus.ts`, `prescriptionDisplay.ts`, `scheduleDates.ts` |
| Schedules, adherence and calendar | `lib/exercises/occurrences.ts`, `scheduleSessionSummary.ts`, `dashboard/patient/ConsistencyCalendar.tsx`, `PatientProgramView.tsx`, `api/exercise-occurrences` |
| Camera session | `app/(app)/camera/CameraClient.tsx` (outline below) with `lib/pose/*` |
| Angle measurement | `lib/pose/poseMetrics.ts` (camera-tilt reference, aspect correction, one function per measured angle), `oneEuroFilter.ts` (smoothing), `metricPrecision.ts`, `metricVersion.ts` |
| Calibration and resting references | `lib/pose/neutralCalibration.ts`, `neckCalibrationReference.ts` (D-49), `shoulderRestReference.ts` (D-47), `trunkRestReference.ts` (D-65) |
| Repetition counting | `lib/pose/repCounter.ts` (one direction of motion), `bidirectionalRepCounter.ts` (side bends to both sides), `velocityBidirectionalRepCounter.ts` (alternative strategy no exercise selects) |
| Holds | Hold timers in `CameraClient.tsx`; `lib/holdDisplay.ts`, `lib/pose/holdHint.ts`, `holdQuality.ts` |
| Coaching cues | `lib/pose/compensationSignals.ts`, `compensationWarningState.ts`, `repWindowWarning.ts`, `coachingCue.ts` (chooses one cue), `coachingConfig.ts` (coaching version), `drawCompensationOverlay.ts` |
| Display-only checks and messages | `lib/pose/elbowBendWarning.ts`, `hipShiftWarning.ts`, `overRaiseWarning.ts`, `otherArmDownWarning.ts`, `bodyTurn.ts`, `pictureBrightness.ts`, `trackingSteadiness.ts`, `captureReadiness.ts`, `drawFramingOverlay.ts` |
| Saving session data | `lib/pose/eventOutbox.ts`, `api/sessions/*` (start, rep events, set events, pain report, review), `lib/db.ts`, `lib/sessionReadModels.ts`, `lib/pose/repQuality.ts` (stored repetition quality, all versions) |
| Manual (non-camera) custom exercises | `CustomGuidedSession` in `CameraClient.tsx`, `api/sessions/manual`, `api/exercise-occurrences` |
| Session video | `lib/recording/*` (`sessionRecorder.ts`, `storage.ts`, `overlayTrack.ts`, `timeline.ts`, `access.ts`, `consent.ts`, `videoChoice.ts`), `api/sessions/[id]/recording/*`, `dashboard/_components/SessionVideo.tsx` |
| Progress trends (trend model) | `lib/analytics/trendModel.ts` (the model, a port of `ml/trend/model.py`), `trendModelConfig.json` (its learned settings), `trendRules.ts` (which data counts), `trendSeries.ts`, `trendFitRunner.ts`, `trendFit.worker.ts`, `useTrendFits.ts`, `trendBreakdown.ts`; charts: `dashboard/_components/ExerciseTrends.tsx`, `TrendChart.tsx`, `SessionBreakdown.tsx`; learning: `ml/trend/` |
| PDF reports | `lib/reports/pdfWriter.ts`, `sessionReport.ts`, `reportPatient.ts`, `homeProgram.ts`, `download.ts`; `dashboard/_components/progressReport.ts`, `ReportButton.tsx`, `PatientReports.tsx` |
| Dashboards | `dashboard/patient/page.tsx`, `dashboard/therapist/page.tsx`, `therapist/patients/[id]/page.tsx`, `dashboard/admin/page.tsx`; shared: `AppShell.tsx`, `DashboardKit.tsx`, `rosterStatus.tsx`, `Skeleton.tsx` |
| Notifications and emails | `dashboard/_components/NotificationBell.tsx`, `api/notifications`, `lib/notificationText.ts`, `lib/email.ts`, `lib/exercises/prescriptionEmail.ts`, `instrumentation.ts` (hourly check for due summaries and reminders) |
| Recently Deleted | `lib/deletedItems.ts`, `dashboard/admin/RecentlyDeletedPanel.tsx`, `api/admin/deleted-items/*` |
| Demo clock and session dates | `lib/demoClock.ts`, `DemoClockContext.tsx`, `api/demo-clock/*`, `lib/sessionDateCorrection.ts`, `sessionDateCorrectionApi.ts`, `dashboard/admin/SessionDateCorrectionPanel.tsx`, `web/docs/demo-clock.md` |
| Guided tours | `dashboard/_components/tours.ts`, `SpotlightTour.tsx`, `TourFlow.tsx`; `CameraTour` in `CameraClient.tsx` |
| Demonstration clips | `lib/exercises/demoClips.ts`, `app/(app)/camera/DemoClipPlayer.tsx`, `web/public/demos`, `tools/blender/` |
| Versions recorded with each session | `lib/exercises/versioning.ts`, `versionPayload.ts`, `lib/pose/metricVersion.ts`, `coachingConfig.ts`, `measurementExportContext.ts` |
| Staff tuning tools | Coaching shadow log (`CameraClient.tsx`, `lib/pose/coachingShadowPlan.ts`, `coachingAudit.ts`); tuning traces (`api/sessions/[id]/raw-frames`, `traceSyncClock.ts`, `traceUploadLoss.ts`, `web/scripts/export-tuning-traces.ts`); Face Landmarker comparison for `ex_004` (`faceLandmarkerShadow.ts`); `ex_005` head-lean console log; `app/(app)/debug/pose-simulator` (threshold simulator for `ex_005` and `ex_006`, not linked from any page) |
| Session report prototype (demo only) | `dashboard/therapist/session-report`, `web/public/pt_session_summary_printable_report.html` |

### Common questions

| Question | Where to look |
|---|---|
| How is a shoulder angle measured? | `computeShoulderAbduction` in `lib/pose/poseMetrics.ts` |
| Where are the counting thresholds, and where did they come from? | `lib/exercises/registry.ts`; each value's comment gives its provenance |
| How is a repetition counted? | `RepCounter.update` in `lib/pose/repCounter.ts` |
| How is one coaching cue chosen among several? | `selectCoachingCue` in `lib/pose/coachingCue.ts` |
| Where is machine learning used? | The trend model only: learned offline in `ml/trend/`, evaluated in the browser by `lib/analytics/trendModel.ts` |
| How are passwords stored? | Hashed with bcrypt in `lib/crypto.ts` |
| Who may see a session video? | `lib/recording/access.ts` |

## Camera page outline

`web/src/app/(app)/camera/CameraClient.tsx` holds the whole camera page.

| Lines | What it does | Main names |
|---|---|---|
| 1-340 | Imports and shared types | |
| 344-620 | Resume snapshot: reading, checking and clearing the browser copy that lets a session continue after a reload | `readResumeSnapshot`, `restoredSessionProgress`, `sessionRepOutcomes`, `clearResumeSnapshot` |
| 620-960 | Session and set record types; the default prescription | `CompletedSetRecord`, `DEFAULT_PRESCRIPTION` |
| 961-1070 | Rep counters for an exercise | `createRepCountersForDefinition`, `isSideSplitIsometric` |
| 1071-1510 | Staff coaching-shadow log types and capture plan; Face Landmarker comparison phases | `COACHING_SESSION_PLAN` |
| 1514-1730 | What a tuning-trace frame holds | `upperBodyTraceMetrics`, `emptyFrameMetrics` |
| 1731-1940 | Display constants and score tiers | `scoreTier` |
| 1943 | Start of the `CameraClient` component | |
| 1943-2276 | State and refs: camera, model, rep counters, calibration baselines, cue state, the per-repetition log | `resetCompensationWarnings`, `repLogRef` |
| 2277-2400 | Hold timers and hold quality | `pairedHoldMsRef`, `newHoldQualityAccum` |
| 2401-2902 | Staff controls: Face Landmarker comparison, coaching shadow segments and download | `markCoachingShadowSegment`, `downloadCoachingShadow` |
| 2904-3360 | Calibration phase, session state, exercise version hashing, outbox recovery after a reload, tuning-trace switches | `setBaselinePhase`, `setSessionState` |
| 3361-3951 | Saving the session: start and end, tuning frames, repetition and set events | `startSessionPersistence`, `bufferRepEvent`, `bufferSetEvent`, `finalizeHoldQuality`, `endSessionPersistence` |
| 3952-4190 | Pain report after a session, completion recap, writing the Resume snapshot | `finishPostAttemptReport`, `savePainReport`, `writeResumeSnapshot` |
| 4191-4321 | Session clock, rest countdown, calibration and start countdowns | |
| 4322-4606 | Set targets; manual (non-camera) exercise sessions | `prescribedTargetReached`, `beginCustomSession`, `completeCustomOccurrence` |
| 4607-4772 | Set completion and rest | `checkAndHandleSetCompletion` |
| 4773-5165 | Start, Resume and End: pain question, video choice, recording, Skip rest | `handleSessionStart`, `resumeSession`, `handleSessionEnd` |
| 5166-5671 | Browser-console diagnostics for staff (`ex_005`, neck repetitions, Face Landmarker) | `enableEx005Debug`, `recordEx004FaceShadow` |
| 5672-6000 | Neutral calibration, capture dropouts, recalibration | `resetNeutralCalibration`, `finalizeNeutralCalibration`, `resetAfterSustainedCaptureDropout` |
| 6001-6155 | `ex_005` diagnostic helpers | `pushEx005DebugRecord` |
| 6156-6324 | Values shown on screen: progress bar, time | `progressPct` |
| 6325-6868 | Loading the pose model and exercises; resets on exercise change | `initLandmarker` |
| 6869-8757 | `predictWebcam`, the per-frame loop: find the body points, picture brightness, capture readiness and body turn, framing overlay, calibration samples, angles, tuning trace, shoulder baseline and form score, display-only checks, repetition counting and hold timing, cue choice, drawing | `predictWebcam` |
| 8758-9203 | Stopping the camera; page mount and unmount; starting a session with the camera | `stopCamera`, `startSessionWithCamera` |
| 9204-11885 | The page layout: camera view, set display, recap, prompts, staff panels | |
| 11886-12910 | The camera page tour | `CameraTour`, `TourGraphic` |
| 12911-14215 | Small display components and the manual-exercise guided session | `CameraSetHud`, `RestOverlay`, `CustomGuidedSession`, `metricLabel` |

## Decision numbers in code comments

Some comments end with a decision number such as "(D-48)". The numbers come
from the project's decision register, which is kept with the thesis records
rather than in this repository. Each number used in the code is summarised
here, so a comment can be read without the register.

| Number | What was decided | Where it shows in the code |
|---|---|---|
| D-08 | Sessions 168-174 are one person's tuning recordings. They set the thresholds and must never be reused as held-out evaluation data. | Threshold provenance comments in `registry.ts` |
| D-23 | Before 2026-10-21, angles were measured on the picture's normalized coordinates without correcting for its width-to-height ratio ("pipeline units"). Lifted by D-48. | Comments about older stored data and the trend export |
| D-30 | `ex_004` became active neck side bends counted to each side (2026-09-24), replacing an assisted neck stretch held for time. The hold's code path stays as a fallback until the neck counting check on more people passes. | Neck counting tests; the side-split hold path in the camera page |
| D-35 | The trend model's protocol: it learns session-to-session variation from sessions recorded in the app and is tested on simulated histories with known trends (`ml/trend/EVALUATION_PROTOCOL.md`). Its settings are frozen in `trendModelConfig.json`. | `trendSeries.ts`, `trendModel.ts`, `ml/trend/` |
| D-39 | Trend data rules v1: a repetition or session is left out of the trends only for a known cause (each set's first repetition out of the timing measures; poorly tracked repetitions and sessions out), never because its value looks unusual. Also the display-only unsteady-tracking message. | `trendRules.ts`, `sessionReadModels.ts`, `trackingSteadiness.ts` |
| D-41 | The lateral arm raise's (`ex_001`) full-range line is 85, down from 90. | `registry.ts` |
| D-45 | Neck side bend peaks are measured from the head's resting position between sets (trend data rules v2, rule 4), and every calibration starts with a 5 s positioning countdown before its 3 s baseline. | `trendRules.ts`, the calibration in the camera page |
| D-47 | The "Level your shoulders." cue judges the shoulders against their own resting line from the calibration. Display only: scores and stored values are unchanged. | `shoulderRestReference.ts`, the camera page |
| D-48 | Every angle is measured in true picture proportions ("aspect-corrected") since 2026-10-21, and every affected threshold was converted. Measurement version `pose_metrics_v3_aspect_corrected`. | `poseMetrics.ts`, `metricVersion.ts`, `registry.ts`, the trend export |
| D-49 | The neck side bend (`ex_004`) is counted from the ear line frozen in the calibration instead of the camera tilt. | `neckCalibrationReference.ts`, the camera page |
| D-50 | The repetition counter keeps its "limb was at rest" evidence across a camera-loop stall of up to 1 s. | `repCounter.ts`, `bidirectionalRepCounter.ts` |
| D-51 | Wall angels (`ex_008`): full-range line 125 (from 134.3) and minimum peak 98.8 (from 101.6). | `registry.ts` |
| D-65 | The "Keep your torso upright." cue judges the trunk against its own resting line from the calibration. Display only, as in D-47. | `trunkRestReference.ts`, the camera page |

## Checks

Run from `web/` unless noted.

| Check | Command |
|---|---|
| Typecheck | `npx tsc --noEmit` |
| Lint | `npm run lint` |
| Build | `npm run build` |
| All web tests (each `*.test.ts(x)` file is a standalone script) | `npm run verify:coaching` |
| One test file | `npx tsx src/lib/pose/repCounter.test.ts` |
| Database tests on private temporary tables (need a local `DATABASE_URL`) | `npm run verify:coaching:db`, `npm run verify:exercises:db`, `npm run verify:manual:db`, `npm run verify:session-dates` |
| Offline coaching replay (the pilot recordings are kept outside the repository) | `npm run replay:coaching -- --manifest <manifest.json> --out <new folder>` |
| ML tests, from `ml/` | `python -m pytest tests -q` |

`npm run seed:demo` deletes and recreates the demo accounts' sessions; do not
run it on a database whose sessions matter.
