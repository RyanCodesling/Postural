import { navTourId } from "./AppShell";
import type { TourStep } from "./SpotlightTour";

const bell: TourStep = {
  targetId: "tour-bell",
  title: "Notifications",
  placement: "below",
  lines: [
    "The bell shows what needs your attention, for example missed exercises or newly assigned exercises.",
    "Open a notification to read it, mark everything as read, or delete the ones you no longer need.",
  ],
};

const logout: TourStep = {
  targetId: "tour-logout",
  title: "Log Out",
  placement: "right",
  lines: ["Use Log Out when you are finished, especially on a shared computer."],
};

const profileCard: TourStep[] = [
  {
    targetId: "tour-profile-card",
    title: "Your account",
    placement: "below",
    lines: ["This card shows who you are signed in as: your name, email and role."],
  },
  {
    targetId: "tour-profile-password",
    title: "Change your password",
    placement: "below",
    lines: [
      "Press Change Password to set a new password.",
      "We first confirm your email with a 6-digit code, which is valid for a few minutes, and then you choose the new password.",
      "A confirmation email is sent once it has been changed.",
    ],
  },
];

// ── Patient ──────────────────────────────────────────────────────────────────

export const PATIENT_TOURS: Record<string, TourStep[]> = {
  dashboard: [
    {
      targetId: navTourId("dashboard"),
      title: "Your dashboard",
      placement: "right",
      lines: [
        "This is your home page: today's exercises, your whole program and how you are doing, all on one screen.",
        "Use the menu on the left to move between pages. Every page has its own How to Use button.",
      ],
    },
    {
      targetId: "tour-tiles",
      title: "Your summary",
      placement: "below",
      lines: [
        "Program completed — the share of all your scheduled exercises that you have finished.",
        "Today — how many of today's exercises are done.",
        "Next scheduled day — the next date that has exercises.",
        "Missed — exercises whose last make-up day has passed.",
      ],
    },
    {
      targetId: "tour-program",
      title: "Your exercise program",
      placement: "right",
      lines: [
        "Each card is one scheduled day. The icon shows whether it is completed, today, open for a make-up, missed or upcoming.",
        "Click a day to open it and see each exercise with its sets and repetitions.",
        "Press Start to open the camera for that exercise. Exercises your therapist set up without the camera show Mark done instead.",
        "If you miss a day you may still have a make-up period. It stays open until its last day.",
        "Press Show the full schedule to see every day of your program.",
      ],
    },
    {
      targetId: "tour-calendar",
      title: "Your consistency",
      placement: "left",
      lines: [
        "The line at the top shows your current streak, your active days this month and your total sessions.",
        "Green is a day completed, amber is partly done, an outlined amber day still has a make-up open, red is missed and an outlined green day is coming up.",
        "Use the arrows to look at earlier months.",
      ],
    },
    {
      targetId: "tour-rom",
      title: "Range of motion",
      placement: "above",
      lines: [
        "The gauge compares your latest session with your first and your best session of the same exercise.",
        "These numbers are camera estimates, not clinical measurements.",
        "It appears after you have finished a session of an exercise measured in angles.",
      ],
    },
    {
      targetId: "tour-reminders",
      title: "Reminders",
      placement: "above",
      lines: ["A short list based on your own schedule: what is left today, open make-ups and your next scheduled day."],
    },
    bell,
    {
      targetId: navTourId("camera"),
      title: "The camera page",
      placement: "right",
      lines: [
        "Camera is where you do your exercises. You can also reach it with Start from your program.",
        "It has its own How to Use button that walks you through setting up the camera and starting a session.",
      ],
    },
    logout,
  ],

  "my-progress": [
    {
      targetId: navTourId("my-progress"),
      title: "My Progress",
      placement: "right",
      lines: ["This page shows how your exercises are going over time, one exercise at a time."],
    },
    {
      targetId: "tour-progress-header",
      title: "Download a report",
      placement: "below",
      lines: [
        "After you have some sessions, press Download progress report (PDF) to save your results.",
        "The trends are descriptive only. They are not a diagnosis.",
      ],
    },
    {
      targetId: "tour-progress-tiles",
      title: "At a glance",
      placement: "below",
      lines: [
        "How many exercises are tracked, how many sessions you have recorded, the date of your last session and how many session videos are saved.",
      ],
    },
    {
      targetId: "tour-progress-trends",
      title: "Your trends",
      placement: "above",
      optional: true,
      lines: [
        "Each card follows one exercise set up the same way (same side and resistance), so like is compared with like.",
        "The chart shows one point per session. Select a point to see that session's repetitions.",
        "A label such as Rising, No clear change or Falling only appears when the change is larger than your normal session-to-session variation.",
        "Finish a few sessions if you do not see any cards yet.",
      ],
    },
    bell,
  ],

  session: [
    {
      targetId: navTourId("session"),
      title: "Session schedule",
      placement: "right",
      lines: ["This page lists every scheduled session, so you can see what is due and what is coming."],
    },
    {
      targetId: "tour-session-tiles",
      title: "Today, next and the end date",
      placement: "below",
      optional: true,
      lines: [
        "Today shows how many exercises are ready, or that you are all done.",
        "Next session is the next date that has exercises.",
        "The last tile shows when your prescription ends and how much you have completed so far.",
      ],
    },
    {
      targetId: "tour-session-current",
      title: "Today and make-ups",
      placement: "right",
      optional: true,
      lines: [
        "Open a date to see its exercises with their sets and repetitions.",
        "Press Start to begin an exercise. If you missed an earlier day and its make-up period is still open, it is listed here too.",
        "Finished exercises show a summary of what you did.",
      ],
    },
    {
      targetId: "tour-session-upcoming",
      title: "Upcoming and past",
      placement: "left",
      optional: true,
      lines: [
        "Next scheduled date shows what you will do next.",
        "Later schedule and Past schedule open to show the rest of your program and your history.",
      ],
    },
    bell,
  ],

  "view-profile": [
    {
      targetId: navTourId("view-profile"),
      title: "View profile",
      placement: "right",
      lines: ["Your personal and account information."],
    },
    ...profileCard,
    {
      targetId: "tour-profile-left",
      title: "Personal information",
      placement: "right",
      lines: ["Your name, age, email and the specialist who looks after you. If something is wrong, ask your therapist or the clinic to correct it."],
    },
    {
      targetId: "tour-profile-bottom",
      title: "Assigned exercises",
      placement: "above",
      optional: true,
      lines: ["Every exercise your therapist has assigned, with its sets and repetitions and whether it is completed, in progress or not started."],
    },
  ],
};

// ── Therapist ────────────────────────────────────────────────────────────────

const therapistNav = (href: string, title: string, text: string): TourStep => ({
  targetId: navTourId(href),
  title,
  placement: "right",
  lines: [text],
});

export const THERAPIST_TOURS: Record<string, TourStep[]> = {
  dashboard: [
    therapistNav("/dashboard/therapist", "Your dashboard", "A one-screen overview of your patients. Use the menu on the left to open the other pages; each has its own How to Use button."),
    {
      targetId: "tour-tiles",
      title: "Your numbers",
      placement: "below",
      lines: [
        "Patients assigned to you, sessions completed this week, how many programs you have saved, patients with no exercises yet, and patients who need attention.",
      ],
    },
    {
      targetId: "tour-roster",
      title: "Patient roster",
      placement: "right",
      lines: [
        "Click a patient's name to open their profile.",
        "Progress shows completed over due exercises, with any missed exercises or pain stops next to it.",
        "Status is Active, Needs attention, Pain follow-up or No exercises.",
      ],
    },
    {
      targetId: "tour-attention",
      title: "Needs attention",
      placement: "left",
      lines: [
        "Patients with a pain stop to review, missed exercises, or no session this week, with the reason shown under each name.",
        "Click one to open their profile.",
      ],
    },
    {
      targetId: "tour-actions",
      title: "Quick actions",
      placement: "left",
      lines: ["Shortcuts to assign exercises, manage exercises and manage your programs."],
    },
    bell,
    logout,
  ],

  profile: [
    therapistNav("/dashboard/therapist/profile", "View profile", "Your account information and the patients assigned to you."),
    ...profileCard,
    {
      targetId: "tour-profile-left",
      title: "Personal information",
      placement: "right",
      lines: ["Your name, email, specialization and therapist ID. Ask the administrator if any of it needs correcting."],
    },
    {
      targetId: "tour-profile-bottom",
      title: "Assigned patients",
      placement: "above",
      lines: ["Every patient the administrator has assigned to you. Press View to open a patient's profile."],
    },
  ],

  patients: [
    therapistNav("/dashboard/therapist/patients", "Manage patients", "Your patients and the exercises each one has been given."),
    {
      targetId: "tour-tiles",
      title: "Summary",
      placement: "below",
      lines: ["How many patients you have, how many already have exercises, how many do not yet, and the total number of prescriptions."],
    },
    {
      targetId: "tour-search",
      title: "Search",
      placement: "below",
      lines: ["Type a name to filter the list."],
    },
    {
      targetId: "tour-table",
      title: "Your patients",
      placement: "above",
      lines: [
        "Each row shows the patient's name and email and the exercises assigned to them with sets and repetitions.",
        "Press View to open the patient's profile, where you can see their program, reports and sessions.",
        "Patients are assigned to you by the administrator.",
      ],
    },
  ],

  exercises: [
    therapistNav("/dashboard/therapist/exercises", "Manage exercises", "The exercise library you can prescribe from."),
    {
      targetId: "tour-tiles",
      title: "Summary",
      placement: "below",
      lines: ["How many built-in and custom exercises exist."],
    },
    {
      targetId: "tour-search",
      title: "Search",
      placement: "below",
      lines: ["Search by name or description."],
    },
    {
      targetId: "tour-system",
      title: "System exercises",
      placement: "right",
      lines: [
        "The built-in, camera-monitored exercises. They are view only.",
        "Press View to read the description of an exercise.",
      ],
    },
    {
      targetId: "tour-custom",
      title: "Custom exercises",
      placement: "left",
      lines: [
        "Manual tasks you created. The camera does not monitor them, and the patient marks them done.",
        "You can edit a custom exercise's description or delete it. A deleted exercise is archived, not erased.",
        "Create new custom exercises on the Exercise Program page.",
      ],
    },
  ],

  assign: [
    therapistNav("/dashboard/therapist/assign", "Assign exercise", "Give exercises or a whole program to one or more of your patients."),
    {
      targetId: "tour-assign-patients",
      title: "1. Select patients",
      placement: "right",
      lines: [
        "Tick the patients who should receive the exercises. The panel on the right then shows their details.",
        "With exactly one patient selected, their current exercises appear so you can end or change them.",
      ],
    },
    {
      targetId: "tour-assign-program",
      title: "2. Load from a program",
      placement: "right",
      lines: [
        "Optional. Pick one of your saved programs to fill in its exercises and settings at once.",
        "It merges with anything you have already chosen.",
      ],
    },
    {
      targetId: "tour-assign-exercises",
      title: "3. Select and configure exercises",
      placement: "right",
      lines: [
        "Tick each exercise to prescribe, then set its order, sets, repetitions, rest, side, resistance and schedule.",
        "A schedule needs a start date, an end date and how often it repeats. A new or changed date cannot be in the past.",
      ],
    },
    {
      targetId: "tour-assign-submit",
      title: "Save",
      placement: "above",
      optional: true,
      lines: [
        "Press Assign Exercises, or Update Changes when editing. A preview lists what will be saved before you confirm.",
        "The patient and you both receive an email describing the exercises.",
      ],
    },
    {
      targetId: "tour-assign-aside",
      title: "Selected patients",
      placement: "left",
      optional: true,
      lines: ["Details of the patients you selected: last session, progress, active prescriptions and diagnosis."],
    },
  ],

  programs: [
    therapistNav("/dashboard/therapist/programs", "Exercise program", "Reusable programs and your own custom exercises."),
    {
      targetId: "tour-tiles",
      title: "Summary",
      placement: "below",
      lines: ["How many programs and custom exercises you have, and how many exercises are inside your programs."],
    },
    {
      targetId: "tour-actions",
      title: "Create",
      placement: "below",
      optional: true,
      lines: [
        "Create New Program bundles exercises with their sets, repetitions, side and resistance so you can assign them in one step.",
        "Add New Custom Exercise creates a manual exercise that you describe yourself.",
      ],
    },
    {
      targetId: "tour-programs",
      title: "Your programs",
      placement: "right",
      lines: [
        "Each program lists its exercises in order.",
        "Edit changes a program. Delete removes it from your list.",
      ],
    },
    {
      targetId: "tour-custom",
      title: "Your custom exercises",
      placement: "left",
      lines: ["Edit a description or delete a custom exercise. Deleting archives it, and history is kept."],
    },
  ],

  "patient-detail": [
    {
      targetId: "tour-detail-actions",
      title: "Patient actions",
      placement: "below",
      lines: [
        "Assign Exercise opens the assign page for this patient.",
        "Progress report (PDF) downloads a report. Print / Save as PDF prints this profile with every tab included.",
      ],
    },
    {
      targetId: "tour-detail-tabs",
      title: "Four tabs",
      placement: "below",
      lines: [
        "Overview — personal and clinical information and attached files. Opening an attached file asks for your password.",
        "PT Program — current and ended prescriptions, and the exercises the patient has completed.",
        "Reports — charts of range of motion, repetitions and adherence for one exercise over a date range, plus form quality and trends.",
        "Sessions — every session with its repetitions, so you can review the details and mark a review.",
      ],
    },
    {
      targetId: "tour-detail-tab-reports",
      title: "Reports",
      placement: "below",
      lines: [
        "Pick an exercise, then Prior Week, Prior Month or All to change the date range.",
        "Range of motion values are camera estimates, not clinical measurements.",
      ],
    },
    {
      targetId: "tour-detail-tab-sessions",
      title: "Sessions",
      placement: "below",
      lines: ["Open a session to see its sets and repetitions, any pain the patient reported, and to record your review."],
    },
  ],
};

// ── Administrator ───────────────────────────────────────────────────────────

const adminNav = (key: string, title: string, text: string): TourStep => ({
  targetId: navTourId(key),
  title,
  placement: "right",
  lines: [text],
});

export const ADMIN_TOURS: Record<string, TourStep[]> = {
  dashboard: [
    adminNav("dashboard", "Your dashboard", "A one-screen overview of the whole system. Use the menu on the left to open the other pages; each has its own How to Use button."),
    {
      targetId: "tour-tiles",
      title: "System numbers",
      placement: "below",
      lines: [
        "Active patients and therapists, current patient-to-therapist assignments, total sessions recorded, archived users and the total number of exercises.",
      ],
    },
    {
      targetId: "tour-feed",
      title: "System activity feed",
      placement: "right",
      lines: [
        "Recent sign-ins, sign-outs and system events, newest first. The list scrolls.",
        "Press Clear Feed to empty it.",
      ],
    },
    {
      targetId: "tour-sessions",
      title: "Recent patient sessions",
      placement: "left",
      lines: ["The latest sessions patients have recorded, with the patient, the exercise and when it was done."],
    },
    {
      targetId: "tour-actions",
      title: "Quick actions",
      placement: "above",
      optional: true,
      lines: [
        "Add New User opens the user form, Add Custom Exercise opens the exercise form, and Assign Patients opens the assignment page.",
      ],
    },
    bell,
    logout,
  ],

  users: [
    adminNav("users", "Manage users", "Create and look after patient and therapist accounts."),
    {
      targetId: "tour-tiles",
      title: "Summary",
      placement: "below",
      lines: ["Active users, how many are patients and how many are therapists, and how many accounts are archived."],
    },
    {
      targetId: "tour-add-user",
      title: "Add a user",
      placement: "below",
      lines: [
        "Press + Add User, choose Patient or Therapist, then fill in the details. The email address must not already belong to another account.",
        "A confirmation step appears before the account is created.",
        "The new user receives a welcome email with their sign-in details and is asked to change the password at first sign-in. You get a confirmation email too.",
      ],
    },
    {
      targetId: "tour-active-users",
      title: "Active users",
      placement: "above",
      lines: [
        "Edit changes an account's details. If you change the email address, the old and new addresses and you are notified by email.",
        "Archive suspends the account without deleting anything: its records stay and the user is emailed. Use it instead of deleting.",
      ],
    },
    {
      targetId: "tour-archived-users",
      title: "Archived users",
      placement: "above",
      lines: [
        "Restore brings an account back with all its records, and the user is emailed.",
        "Delete is permanent and is only allowed for an archived account that has no history, meaning no prescriptions, sessions, assigned patients, owned exercises or programs, or reviews. You are asked to confirm twice.",
      ],
    },
    bell,
  ],

  exercises: [
    adminNav("exercises", "Manage exercises", "The exercise library that therapists prescribe from."),
    {
      targetId: "tour-tiles",
      title: "Summary",
      placement: "below",
      lines: ["How many system, custom and total exercises there are."],
    },
    {
      targetId: "tour-add-exercise",
      title: "Add an exercise",
      placement: "below",
      lines: ["Press + Add Exercise, enter a name and a description, and press Add Exercise to create a custom exercise."],
    },
    {
      targetId: "tour-search",
      title: "Search",
      placement: "below",
      lines: ["Search exercises by name or description."],
    },
    {
      targetId: "tour-system",
      title: "System exercises",
      placement: "right",
      optional: true,
      lines: ["The built-in exercises. Press View to read one, or Edit to change its description."],
    },
    {
      targetId: "tour-custom",
      title: "Custom exercises",
      placement: "left",
      optional: true,
      lines: ["Exercises added by you or by therapists. View or edit the description, or delete one. A deleted exercise is archived, not erased."],
    },
    bell,
  ],

  assignments: [
    adminNav("assignments", "Assign patients", "Link each patient to the therapist who will monitor them."),
    {
      targetId: "tour-tiles",
      title: "Summary",
      placement: "below",
      lines: ["Patients, therapists, how many patients still have no therapist and how many are assigned."],
    },
    {
      targetId: "tour-unassigned",
      title: "1. Pick a patient",
      placement: "right",
      lines: ["Click a patient without a therapist to select them."],
    },
    {
      targetId: "tour-pick-therapist",
      title: "2. Pick a therapist",
      placement: "left",
      lines: [
        "Choose a therapist from the list and press Assign Patient.",
        "Both the patient and the therapist get a notification and an email about the assignment.",
      ],
    },
    {
      targetId: "tour-assigned",
      title: "Currently assigned patients",
      placement: "above",
      lines: ["Every patient who has a therapist. Press Unassign to remove the link."],
    },
    {
      targetId: "tour-history",
      title: "Assignment history",
      placement: "above",
      lines: ["The assignments and unassignments you have made during this visit."],
    },
    bell,
  ],

  "demo-clock": [
    adminNav("demo-clock", "Demo clock", "Only for demonstrations. It lets the app pretend it is another date."),
    {
      targetId: "tour-demo-clock",
      title: "Set a demo date",
      placement: "right",
      lines: [
        "Choose a date and time and press Set demo time to simulate it for scheduling and dashboards. The computer's own clock does not change.",
        "Sessions recorded while a demo date is set are saved with that date, so use a demo account.",
        "Press the reset button to return to the real time.",
      ],
    },
  ],
};

/** The tour for a therapist page, chosen by its address. */
export function therapistTourFor(pathname: string): TourStep[] | undefined {
  if (/^\/dashboard\/therapist\/patients\/[^/]+/.test(pathname)) return THERAPIST_TOURS["patient-detail"];
  if (pathname.startsWith("/dashboard/therapist/profile")) return THERAPIST_TOURS.profile;
  if (pathname.startsWith("/dashboard/therapist/patients")) return THERAPIST_TOURS.patients;
  if (pathname.startsWith("/dashboard/therapist/exercises")) return THERAPIST_TOURS.exercises;
  if (pathname.startsWith("/dashboard/therapist/assign")) return THERAPIST_TOURS.assign;
  if (pathname.startsWith("/dashboard/therapist/programs")) return THERAPIST_TOURS.programs;
  if (pathname === "/dashboard/therapist") return THERAPIST_TOURS.dashboard;
  return undefined;
}
