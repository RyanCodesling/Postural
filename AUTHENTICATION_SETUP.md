# Temporary Authentication Credentials

## Overview
Temporary login credentials have been moved to a MySQL database. The authentication system now queries the database instead of using hardcoded credentials.

## Database Setup

### 1. Create Database
Run the SQL file provided in `scripts/user_credentials.sql` using phpMyAdmin:
1. Open phpMyAdmin
2. Click "Import" tab
3. Upload or paste the contents of `scripts/user_credentials.sql`
4. Execute the SQL

The SQL file will automatically create the `postural` database and users table with sample data.

### 2. Environment Variables
The `.env.local` file already exists in the `web/` directory with the following database configuration:
```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=postural
NODE_ENV=development
```
Update these values if your database credentials are different.

### 3. Install Dependencies
After updating `.env.local`, install the MySQL dependency:
```bash
npm install
```

## How mysql2/promise and phpMyAdmin Work Together

- **`mysql2/promise`** — Node.js package for your backend to connect and query MySQL. Used in `@/lib/db.ts` to connect from your Next.js API routes.
- **phpMyAdmin** — Web interface for managing the MySQL database. Use it to create/view databases and import SQL files.

**Workflow:**
- ✅ Use **phpMyAdmin** to import `scripts/user_credentials.sql` and create the `users` table
- ✅ Run **`npm install`** to install `mysql2/promise` dependency
- ✅ Your **backend code** (using `mysql2/promise`) will query the database that phpMyAdmin manages

They work together — phpMyAdmin manages the database, and `mysql2/promise` lets your app connect to it.

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

1. Configure `.env.local` in the `web/` directory with your database credentials
2. Run `npm install` in the `web/` directory to install dependencies
3. Import `scripts/user_credentials.sql` into phpMyAdmin (it will create the database and users table automatically)
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
- **Manage Exercises**: Create, edit, and delete exercise routines with difficulty levels and duration

Access at `/dashboard/admin` after logging in as admin.

## File Structure
```
web/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── auth/
│   │   │       ├── login/
│   │   │       │   └── route.ts (updated - now uses database)
│   │   │       └── logout/
│   │   │           └── route.ts
│   │   ├── (app)/
│   │   │   └── dashboard/
│   │   │       ├── patient/
│   │   │       │   └── page.tsx (Patient)
│   │   │       ├── therapist/
│   │   │       │   └── page.tsx (Therapist)
│   │   │       └── admin/
│   │   │           └── page.tsx (Admin CMS)
│   │   ├── (auth)/
│   │   │   └── login/
│   │   │       └── page.tsx (updated)
│   │   └── layout.tsx (updated)
│   └── lib/
│       ├── auth.ts
│       ├── AuthContext.tsx
│       ├── db.ts (new - database connection)
│       └── pose/
├── middleware.ts
├── .env.local.example (new - environment template)
└── package.json (updated - added mysql2)

scripts/
└── user_credentials.sql (new - database setup and mock data)
```

## Database Schema

The `users` table includes:
- `id` - Primary key
- `email` - User email (unique)
- `password` - User password
- `name` - User full name
- `role` - User role (patient, therapist, admin)
- `clinicId` - Clinic identifier (therapists only)
- `created_at` - Timestamp
- `updated_at` - Timestamp

## Future Enhancements
When ready for production:
1. Implement password hashing (e.g., bcryptjs)
2. Add JWT tokens instead of simple auth cookies
3. Add refresh token mechanism
4. Migrate to a more robust ORM (e.g., Prisma, TypeORM)
5. Add user registration and invitation system
6. Implement role-based access control (RBAC) at the database level
