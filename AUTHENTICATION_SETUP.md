# Temporary Authentication Credentials

## Overview
Temporary login credentials have been created for testing purposes. No database is required. Credentials are hardcoded in the API route `/api/auth/login`.

## Login Credentials

### Patient Account
- **Email:** `patient@example.com`
- **Password:** `patient123`
- **Role:** Patient
- **User ID:** `patient_001`

### Doctor Account
- **Email:** `doctor@clinic.com`
- **Password:** `doctor123`
- **Role:** Doctor
- **User ID:** `doctor_001`
- **Clinic ID:** `CLINIC_001`

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
- `/dashboard` (requires login)
- `/profile` (requires login)
- `/camera` (requires login)

### 4. Utilities
- `@/lib/auth.ts` - Helper functions for login, logout, and localStorage management
- `@/lib/AuthContext.tsx` - React Context for managing user state across the app
- `@/middleware.ts` - Route protection middleware

## How to Use

1. Navigate to `http://localhost:3000/login`
2. Choose between Patient or Doctor using the role switcher
3. Use the provided credentials:
   - Patient: `patient@example.com` / `patient123`
   - Doctor: `doctor@clinic.com` / `doctor123`
4. After login, you'll be redirected to `/dashboard`

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
