"use client";

import Link from "next/link";

interface ScheduledExercise {
  id: string;
  name: string;
  day: string;
  date: string;
  sets: number;
  reps: number;
  status: "pending" | "completed" | "skipped";
}

const WEEK_SCHEDULE: ScheduledExercise[] = [
  {
    id: "1",
    name: "Lateral Arm Raises",
    day: "Monday",
    date: "Feb 10",
    sets: 3,
    reps: 12,
    status: "completed",
  },
  {
    id: "2",
    name: "Overhead Arm Raises",
    day: "Tuesday",
    date: "Feb 11",
    sets: 3,
    reps: 12,
    status: "pending",
  },
  {
    id: "3",
    name: "Shoulder Shrugs",
    day: "Wednesday",
    date: "Feb 12",
    sets: 3,
    reps: 15,
    status: "pending",
  },
  {
    id: "4",
    name: "Neck Lateral Flexion",
    day: "Thursday",
    date: "Feb 13",
    sets: 2,
    reps: 10,
    status: "pending",
  },
  {
    id: "5",
    name: "Standing Side Bends",
    day: "Friday",
    date: "Feb 14",
    sets: 3,
    reps: 12,
    status: "pending",
  },
  {
    id: "6",
    name: "Arm Abduction at 90°",
    day: "Saturday",
    date: "Feb 15",
    sets: 3,
    reps: 12,
    status: "pending",
  },
  {
    id: "7",
    name: "Lateral Arm Raises",
    day: "Sunday",
    date: "Feb 16",
    sets: 3,
    reps: 12,
    status: "pending",
  },
];

const getStatusColor = (status: string) => {
  switch (status) {
    case "completed":
      return "bg-green-50 border-green-200";
    case "skipped":
      return "bg-red-50 border-red-200";
    default:
      return "bg-blue-50 border-blue-200";
  }
};

const getStatusBadgeColor = (status: string) => {
  switch (status) {
    case "completed":
      return "bg-green-100 text-green-800";
    case "skipped":
      return "bg-red-100 text-red-800";
    default:
      return "bg-blue-100 text-blue-800";
  }
};

const getStatusText = (status: string) => {
  switch (status) {
    case "completed":
      return "Completed";
    case "skipped":
      return "Skipped";
    default:
      return "Pending";
  }
};

export default function SessionPage() {
  const completedCount = WEEK_SCHEDULE.filter(
    (e) => e.status === "completed"
  ).length;
  const totalCount = WEEK_SCHEDULE.length;
  const progressPercentage = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <Link
            href="/dashboard"
            className="text-blue-600 hover:text-blue-800 text-sm mb-4 inline-block"
          >
            ← Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">Weekly Exercise Schedule</h1>
          <p className="text-gray-600 mt-2">
            Track your exercises for the upcoming week
          </p>
        </div>

        {/* Progress Card */}
        <div className="bg-white rounded-2xl shadow-sm border p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Weekly Progress</h2>
            <span className="text-2xl font-bold text-blue-600">
              {completedCount}/{totalCount}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
            <div
              className="bg-gradient-to-r from-green-500 to-blue-600 h-full rounded-full transition-all"
              style={{ width: `${progressPercentage}%` }}
            ></div>
          </div>
          <p className="text-sm text-gray-600 mt-2">{progressPercentage}% complete</p>
        </div>

        {/* Exercise Schedule */}
        <div className="space-y-4">
          {WEEK_SCHEDULE.map((exercise) => (
            <div
              key={exercise.id}
              className={`rounded-lg border p-4 transition-all ${getStatusColor(
                exercise.status
              )}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {exercise.name}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {exercise.day}, {exercise.date}
                  </p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusBadgeColor(
                    exercise.status
                  )}`}
                >
                  {getStatusText(exercise.status)}
                </span>
              </div>

              <div className="flex items-center gap-6">
                <div>
                  <p className="text-xs text-gray-600 mb-1">Sets</p>
                  <p className="text-xl font-bold text-gray-900">{exercise.sets}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 mb-1">Reps</p>
                  <p className="text-xl font-bold text-gray-900">{exercise.reps}</p>
                </div>
                {exercise.status === "pending" && (
                  <button className="ml-auto px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
                    Start Exercise
                  </button>
                )}
                {exercise.status === "completed" && (
                  <div className="ml-auto flex items-center gap-2">
                    <svg
                      className="w-5 h-5 text-green-600"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="text-green-600 text-sm font-medium">Done</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Summary Card */}
        <div className="bg-white rounded-2xl shadow-sm border p-6 mt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Summary</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">{completedCount}</p>
              <p className="text-sm text-gray-600">Completed</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">
                {totalCount - completedCount}
              </p>
              <p className="text-sm text-gray-600">Remaining</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-purple-600">{totalCount}</p>
              <p className="text-sm text-gray-600">Total</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
