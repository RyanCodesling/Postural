# Temporary Authentication Credentials

## Overview
Temporary login credentials have been created for testing purposes. No database is required. Credentials are hardcoded in the API route `/api/auth/login`.

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
- **POST `/api/auth/login`** - Accepts email, password, and role. Returns user data and sets auth cookie.
- **POST `/api/auth/logout`** - Clears the auth cookie.

### 2. Authentication Flow
- Login credentials are displayed on the login page for easy testing
- User data is stored in browser localStorage after login
- Auth token is stored in an HTTP-only cookie
- Role switcher allows toggling between patient and doctor login pages

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
- `@/middleware.ts` - Route protection middleware

## How to Use

1. Navigate to `http://localhost:3000/login`
2. Choose between Patient, Therapist, or Admin using the role switcher
3. Use the provided credentials:
   - Patient: `patient@example.com` / `patient123`
   - Therapist: `therapist@clinic.com` / `therapist123`
   - Admin: `admin@postural.com` / `admin123`
4. After login, you'll be redirected to the appropriate dashboard

## Admin Dashboard (CMS)
The Admin panel allows system administrators to:
- **Manage Users**: Add, view, and delete users (patients, therapists)
- **Manage Exercises**: Create, edit, and delete exercise routines with difficulty levels and duration

Access at `/dashboard/admin` after logging in as admin.

## File Structure
```
src/
├── app/
│   ├── api/
│   │   └── auth/
│   │       ├── login/
│   │       │   └── route.ts
│   │       └── logout/
│   │           └── route.ts
│   ├── (app)/
│   │   └── dashboard/
│   │       ├── page.tsx (Patient)
│   │       ├── therapist/
│   │       │   └── page.tsx (Therapist)
│   │       └── admin/
│   │           └── page.tsx (Admin CMS)
│   ├── (auth)/
│   │   └── login/
│   │       └── page.tsx (updated)
│   └── layout.tsx (updated)
├── lib/
│   ├── auth.ts (new)
│   └── AuthContext.tsx (new)
└── middleware.ts (new)
```

## Future Implementation
When ready to implement a real database:
1. Replace mock credentials in `/api/auth/login` with database queries
2. Add password hashing (e.g., bcryptjs)
3. Implement JWT tokens instead of cookies
4. Add refresh token mechanism
5. Create user registration endpoint
