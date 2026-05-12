# Sprint Updates 

## 📌 New sprint update here (●'◡'●) | *author_name*
-

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
