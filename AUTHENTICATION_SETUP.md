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
Definition tab → Password: nasa sprint updates gdocs yung pass (copy paste mo nalang)
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
DATABASE_URL=postgresql://postural:nasasprintupdatesgdocsyungpass@localhost:5432/postural
NODE_ENV=development
```
> `.env.local` is gitignored — it will not be pushed to the GitHub repository. You only need to create this once; it persists across all branches.

### Step 7 — Install dependencies
```bash
cd web
npm install
npm audit fix
```

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
- **Email:** `admin@postural.com`
- **Password:** `admin123`
- **Role:** Admin
- **User ID:** `admin_001`
- **Access:** Content Management System (CMS) to manage users and exercises

## Features Implemented

### 1. API Routes
- **POST `/api/auth/login`** - Accepts email, password, and role. Queries database and returns user data with auth cookie.
- **POST `/api/auth/logout`** - Clears the auth cookie.

### 2. Authentication Flow
- Login credentials are displayed on the login page for easy testing
- Role is selected via URL parameter (`?role=patient`, `?role=therapist`, `?role=admin`)
- User data is stored in browser localStorage after login
- Auth token is stored in an HTTP-only cookie
- Database queries validate credentials

### 3. Protected Routes
The following routes are protected and require authentication:
- `/dashboard` - Patient dashboard (requires patient login)
- `/dashboard/therapist` - Therapist dashboard (requires therapist login)
- `/dashboard/admin` - Admin CMS Interface (requires admin login)
- `/profile` (requires login)
- `/camera` (requires login)

### 4. Utilities
- `@/lib/auth.ts` - Helper functions for login, logout, and localStorage management
- `@/lib/AuthContext.tsx` - React Context for managing user state across the app
- `@/lib/db.ts` - Database connection pool and query functions
- `@/middleware.ts` - Route protection middleware

## How to Use

1. Set `DATABASE_URL` in `web/.env.local` with your PostgreSQL connection string
2. Run `npm install` in the `web/` directory to install dependencies
3. Import `scripts/user_credentials_pg.sql` into your PostgreSQL database
4. Navigate to `http://localhost:3000/login`
5. Choose between Patient, Therapist, or Admin using URL parameters:
   - Patient: `http://localhost:3000/login?role=patient`
   - Therapist: `http://localhost:3000/login?role=therapist`
   - Admin: `http://localhost:3000/login?role=admin`
6. Use the provided credentials to login
7. After login, you'll be redirected to the appropriate dashboard

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
│   └── lib/
│       ├── auth.ts
│       ├── AuthContext.tsx
│       ├── db.ts (PostgreSQL connection pool)
│       └── pose/
├── middleware.ts
├── .env.local
└── package.json (uses pg)

scripts/
└── user_credentials_pg.sql   (PostgreSQL - use this)
```

## Database Schema

The `users` table includes:
- `id` - Primary key
- `email` - User email (unique)
- `password` - User password
- `name` - User full name
- `role` - User role (`patient`, `therapist`, `admin`)
- `clinicId` - Clinic identifier (therapists only)
- `created_at` - Timestamp
- `updated_at` - Timestamp
