# Sprint Updates 

## 📌 New sprint update here (●'◡'●) | *author_name*
-

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

### *dashboard\patient\page.tsx* 
- Created subfolder for Patient Side
- Logout button redirects back to app\page.tsx

### *dashboard\page.tsx* 
- Now works as role-based router that redirects based on user’s role

### *login\page.tsx*
- Removed Role Switcher
- Now have Admin Login
- Cancel Button on Role Login
- Eye Icon on Password Field

### *dashboard\admin\page.tsx* 
- Logout button redirects back to app\page.tsx
- Removed extra logout button

### *dashboard\therapist\page.tsx* 
- Logout button redirects back to app\page.tsx
- Removed extra logout button

### *(app)\layout.tsx*
- Logout functionality fixed
