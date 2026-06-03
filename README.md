# Sprint Updates 

## 📌 New sprint update here (●'◡'●) | *author_name*
-

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

### *(app)/layout.tsx*
- Logout functionality fixed
