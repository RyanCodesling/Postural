# Sprint Updates

## 📌 New sprint update here (●'◡'●) | *author_name*
-

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

