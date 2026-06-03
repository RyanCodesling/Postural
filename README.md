# Sprint Updates 

## 📌 New sprint update here (●'◡'●) | *author_name*
-

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

## 📌 Update-5-22-26 | RyanCodesling

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

## 📌 Update-4-09-26 | *RyanCodesling*

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
