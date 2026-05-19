"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ScheduledExercise {
  id: number;
  exercise_id: string;
  name: string;
  description: string;
  sets: number;
  reps: number;
  status: "pending" | "completed" | "skipped";
  assigned_date: string;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function getWeekDates(): string[] {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });
}

const getStatusColor = (status: string) => {
  switch (status) {
    case "completed": return "bg-green-50 border-green-200";
    case "skipped":   return "bg-red-50 border-red-200";
    default:          return "bg-white border-gray-200";
  }
};

const getStatusBadgeColor = (status: string) => {
  switch (status) {
    case "completed": return "bg-green-100 text-green-800";
    case "skipped":   return "bg-red-100 text-red-800";
    default:          return "bg-green-100 text-green-700";
  }
};

const getStatusText = (status: string) => {
  switch (status) {
    case "completed": return "Completed";
    case "skipped":   return "Skipped";
    default:          return "Pending";
  }
};

export default function SessionPage() {
  const [schedule, setSchedule] = useState<ScheduledExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const weekDates = getWeekDates();

  useEffect(() => {
    fetch("/api/patient-exercises")
      .then((r) => r.json())
      .then((data) => setSchedule(data.exercises ?? []))
      .catch((err) => console.error("Failed to load exercises:", err))
      .finally(() => setLoading(false));
  }, []);

  const completedCount = schedule.filter((e) => e.status === "completed").length;
  const totalCount = schedule.length;
  const progressPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="min-h-screen bg-green-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <Link
            href="/dashboard"
            className="text-green-700 hover:text-green-900 text-sm mb-4 inline-block"
          >
            ← Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-green-900">Weekly Exercise Schedule</h1>
          <p className="text-green-700 mt-2">Track your exercises for the upcoming week</p>
        </div>

        {/* Progress Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-green-900">Weekly Progress</h2>
            <span className="text-2xl font-bold text-green-700">
              {completedCount}/{totalCount}
            </span>
          </div>
          <div className="w-full bg-green-100 rounded-full h-4 overflow-hidden">
            <div
              className="bg-green-700 h-full rounded-full transition-all"
              style={{ width: `${progressPercentage}%` }}
            ></div>
          </div>
          <p className="text-sm text-green-700 mt-2">{progressPercentage}% complete</p>
        </div>

        {/* Exercise Schedule */}
        {loading ? (
          <div className="text-center py-12 text-green-700">Loading your exercises...</div>
        ) : schedule.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">
            No exercises assigned yet. Your therapist will assign exercises to you.
          </div>
        ) : (
          <div className="space-y-4">
            {schedule.map((exercise, index) => (
              <div
                key={exercise.id}
                className={`rounded-lg border p-4 transition-all ${getStatusColor(exercise.status)}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{exercise.name}</h3>
                    <p className="text-sm text-gray-600">
                      {DAYS[index % 7]}, {weekDates[index % 7]}
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusBadgeColor(exercise.status)}`}>
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
                    <button className="ml-auto px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 text-sm font-medium">
                      Start Exercise
                    </button>
                  )}
                  {exercise.status === "completed" && (
                    <div className="ml-auto flex items-center gap-2">
                      <svg className="w-5 h-5 text-green-700" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span className="text-green-700 text-sm font-medium">Done</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Summary Card */}
        {!loading && schedule.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mt-6">
            <h3 className="text-lg font-semibold text-green-900 mb-4">Summary</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-green-700">{completedCount}</p>
                <p className="text-sm text-gray-600">Completed</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-900">{totalCount - completedCount}</p>
                <p className="text-sm text-gray-600">Remaining</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-800">{totalCount}</p>
                <p className="text-sm text-gray-600">Total</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
