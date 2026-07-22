# Temporary Authentication Credentials

## Overview
Temporary login credentials are stored in a PostgreSQL database. The authentication system queries the database instead of using hardcoded credentials.

## Database Setup

### Step 1 — — Install PostgreSQL
Download and install from **https://www.enterprisedb.com/downloads/postgres-postgresql-downloads**
PostgreSQL Version 18.3

### Step 2 — Register a Server in pgAdmin 4
Open pgAdmin 4
Click Add New Server from the Dashboard
General tab → Name: postural
Connection tab → fill in:
Host name: localhost
Port: 5432
Username: postgres
Password: (the password you set during PostgreSQL installation)
Click Save

### Step 3 — Create the database
Expand Servers → **`postural`** → Databases
Right-click Databases → Create → Database
Name the Database **`postural`** → Click Save

### Step 4 — Create the user
Expand Login/Group Roles
Right-click → Create → Login/Group Role
General tab → Name: postural
Definition tab → Password: choose a unique local password and keep it out of Git
Privileges tab → Enable Can login?
Click Save

### ‼️ Step 5 — Run the SQL file
Right-click postural database → Query Tool
Open File and go to scripts/
Select the sql file
Now run the sql by clicking Execute script or F5

### Step 6 — Create `.env.local` (ONE-TIME SETUP ONLY)
If you don't have a `.env.local` file inside the `web/` folder, create one and add:
```
DATABASE_URL=postgresql://postural:replace-with-your-local-password@localhost:5432/postural
SESSION_SECRET=replace-with-a-generated-secret-of-at-least-32-random-bytes
NODE_ENV=development
```
Generate `SESSION_SECRET` with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.

> `.env.local` is gitignored and must never be committed. Rotate the previously documented shared database password if it is still active because removing it here does not remove it from Git history.

### Step 7 — Install dependencies
```bash
cd web
npm install
npm audit
```
Review audit findings before applying dependency upgrades.

### Step 8 — Run the app
```bash
npm run dev
```
Then go to `http://localhost:3000`.

---

## How `pg` Works

- **`pg`** — Node.js package for your backend to connect and query PostgreSQL. Used in `@/lib/db.ts` to connect from your Next.js API routes.

**Workflow:**
- ✅ Set `DATABASE_URL` in `.env.local` (local) or hosting dashboard (deployment)
- ✅ Run **`npm install`** to install `pg` dependency
- ✅ Import `scripts/user_credentials_pg.sql` into your PostgreSQL database
- ✅ Your **backend code** (using `pg`) will query the database

## Login Credentials

### Patient Account
- **Email:** `patient@example.com`
- **Password:** `patient123`
- **Role:** Patient
- **User ID:** `patient_001`

### Therapist Account
- **Email:** `therapist@clinic.com`
- **Password:** `therapist123`
- **Role:** Therapist
- **User ID:** `therapist_001`
- **Clinic ID:** `CLINIC_001`

### Admin Account
- **Email:** `accbpostural.noreply@gmail.com`
- **Password:** `admin123`
- **Role:** Admin
- **User ID:** `admin_001`
- **Access:** Content Management System (CMS) to manage users and exercises

## Features Implemented

### 1. API Routes
- **POST `/api/auth/login`** - Accepts email and password, verifies the current database user, and issues the signed session cookie.
- **GET `/api/auth/me`** - Verifies the signed cookie, reloads the current non-archived database user, and returns a safe user DTO with `Cache-Control: no-store`.
- **POST `/api/auth/logout`** - Clears the auth cookie.

### 2. Authentication Flow
- User identity is recovered from `/api/auth/me`; authentication does not trust localStorage
- The HTTP-only `auth_token` cookie contains a signed, expiring session token
- Protected API routes reload the current user from PostgreSQL and enforce role or ownership checks
- Database queries validate credentials

Old unsigned JSON cookies are rejected after deployment, so existing users must log in again.

### 3. Protected Routes
The following routes are protected and require authentication:
- `/dashboard` and all dashboard subpaths
- `/change-password` (requires a valid session)
- `/camera` (requires login)

### 4. Utilities
- `@/lib/auth.ts` - Client helpers for login and logout requests
- `@/lib/AuthContext.tsx` - React Context for managing user state across the app
- `@/lib/session-token.ts` - Session signing, verification, expiry, and cookie options
- `@/lib/auth-server.ts` - Database-backed server authentication and current-user loading
- `@/lib/db.ts` - Database connection pool and query functions
- `@/proxy.ts` - Page-route session check and first-login redirect

## How to Use

1. Set `DATABASE_URL` in `web/.env.local` with your PostgreSQL connection string
2. Set a generated `SESSION_SECRET` in `web/.env.local`
3. Run `npm install` in the `web/` directory to install dependencies
4. Run the required SQL scripts in the order listed below
5. Navigate to `http://localhost:3000/login`
6. Enter the email and password for a seeded or administrator-created account
7. After login, the server redirects the user to the dashboard for the role stored in PostgreSQL

## Admin Dashboard (CMS)
The Admin panel allows system administrators to:
- **Manage Users**: Add, view, and delete users (patients, therapists)
- **Manage Exercises**: Create, edit, and delete exercise routines with duration

Access at `/dashboard/admin` after logging in as admin.

## File Structure
```
web/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── auth/
│   │   │       ├── login/
│   │   │       │   └── route.ts
│   │   │       └── logout/
│   │   │           └── route.ts
│   │   ├── (app)/
│   │   │   └── dashboard/
│   │   │       ├── patient/
│   │   │       │   └── page.tsx
│   │   │       ├── therapist/
│   │   │       │   └── page.tsx
│   │   │       └── admin/
│   │   │           └── page.tsx (Admin CMS)
│   │   ├── (auth)/
│   │   │   └── login/
│   │   │       └── page.tsx
│   │   └── layout.tsx
│   ├── lib/
│   │   ├── auth.ts
│   │   ├── AuthContext.tsx
│   │   ├── db.ts (PostgreSQL connection pool)
│   │   └── pose/
│   └── proxy.ts
├── .env.local
└── package.json (uses pg)

scripts/
└── user_credentials_pg.sql   (PostgreSQL - use this)
```

## Database Schema

The `users` table includes:
- `id` - Primary key
- `email` - User email (unique)
- `password` - bcrypt hash for created/updated accounts; the three local demo seeds retain a temporary plaintext compatibility fallback
- `name` - User full name
- `role` - User role (`patient`, `therapist`, `admin`)
- `clinicId` - Clinic identifier (therapists only)
- `must_change_password` - Boolean flag (forces password change on first login)
- `created_at` - Timestamp
- `updated_at` - Timestamp

The `password_reset_otps` table includes:
- `id` - Primary key (auto-increment)
- `user_id` - Foreign key to users(id)
- `email` - Email the OTP was sent to
- `otp` - 6-digit OTP code
- `expires_at` - When the OTP expires (5 minutes)
- `used` - Whether the OTP has been consumed
- `reset_token` - One-time token issued only after successful OTP verification
- `reset_token_expires_at` - Reset-token expiry timestamp
- `created_at` - Timestamp

## Required SQL order

To bring an existing PostgreSQL database up to the current application schema, run these scripts as the database owner/superuser (for example, `postgres`):

1. `scripts/user_credentials_pg.sql`
2. `scripts/exercises_pg.sql`
3. `scripts/patient_exercises_pg.sql`
4. `scripts/sessions_pg.sql`
5. `scripts/exercise_occurrences_pg.sql`
6. `scripts/email_features.sql`
7. `scripts/reset_token_migration.sql`
8. `scripts/notifications_pg.sql`

Keep the exercise-preservation scripts in the order shown. Exercises must exist before prescriptions, sessions depend on prescriptions, and the occurrence script adds the occurrence link to the existing sessions table. Run notifications last because its optional occurrence foreign key depends on `exercise_occurrences`.

---

## Email Notification Features

### Overview
The system sends emails for three scenarios:
1. **Account Creation** — When admin adds a user, the user receives a welcome email with login credentials
2. **Password Changed** — Confirmation email sent when a user changes their password
3. **Forgot Password OTP** — 6-digit verification code sent for password reset

### Default Password Format
When admin creates a new user, the password is auto-generated as:
`LastName + YearOfBirth` (e.g., `DelaCruz2004`)
- Spaces in last names are removed
- The user is forced to change this password on first login

### Gmail App Password Setup

1. Log into the Gmail account: `accbpostural.noreply@gmail.com`
2. Go to [Google Account Security](https://myaccount.google.com/security)
3. Enable **2-Step Verification** (required for App Passwords)
4. Go to [App Passwords](https://myaccount.google.com/apppasswords)
5. Enter app name: `Postural System` → Click **Create**
6. Copy the **16-character password** (format: `xxxx xxxx xxxx xxxx`)
7. Paste it as `SMTP_PASS` in `web/.env.local` (remove the spaces)

### Environment Variables for Email
Add these to `web/.env.local`:
```
SMTP_USER=accbpostural.noreply@gmail.com
SMTP_PASS=your-16-char-app-password-here
SMTP_FROM=accbpostural.noreply@gmail.com
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### ‼️ Run the Email and Reset-Token Migrations
After the user, exercise, prescription, session, and occurrence schemas above are current, run `scripts/email_features.sql`, then `scripts/reset_token_migration.sql`, followed by `scripts/notifications_pg.sql`. The reset-token migration is required because password reset accepts only a token issued after successful OTP verification.

### New API Routes
- **POST `/api/auth/change-password`** — Changes the authenticated user's password (requires currentPassword and newPassword; a mismatched userId is rejected)
- **POST `/api/auth/forgot-password`** — Sends OTP to user email (requires email)
- **POST `/api/auth/verify-otp`** — Verifies OTP code and returns a one-time reset token (requires email and otp)
- **POST `/api/auth/reset-password`** — Resets password after OTP verification (requires email, newPassword, and resetToken)

### New Pages
- **`/change-password`** — Force password change page (shown after first-time login)
- **`/forgot-password`** — 3-step forgot password flow (Email → OTP → New Password)

### Modified Pages
- **`/login`** — Added "Forgot Password?" link, password reset success message, and first-time login redirect
- **`/dashboard/admin`** — Success message now mentions activation email sent to user
