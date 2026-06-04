"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { prescriptionTargetText } from "@/lib/exercises/prescriptionDisplay";
import { getExerciseDefinition } from "@/lib/exercises/registry";
import TrendChart from "./TrendChart";

interface Patient {
  id: string;
  name: string;
  email?: string;
  age?: number;
  gender?: string;
  diagnosis?: string;
  prescription?: string;
  condition?: string;
  therapistId?: string;
  therapistName?: string;
}

interface PatientExercise {
  exercise_id: string;
  name: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  sets: number;
  reps: number;
  rest_seconds: number;
  hold_seconds: number;
  assigned_date: string;
}

// Per-session summary row from GET /api/sessions.
interface SessionSummary {
  id: number;
  exerciseId: string;
  exerciseName: string;
  exerciseKind: "dynamic" | "isometric" | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  setCount: number;
  totalReps: number;
  completeReps: number;
  leftReps: number;
  rightReps: number;
  completeLeftReps: number;
  completeRightReps: number;
  avgPeakValue: number | null;
  totalPairedHoldMs: number | null;
  totalTargetHoldMs: number | null;
  avgAsymmetryIndex: number | null;
}

// Per-arm hold-quality summary stored on isometric set rows.
interface HoldSideQuality {
  meanDeg: number;
  sdDeg: number;
  meanErrorDeg: number;
  droopSlopeDegPerSec: number;
}
interface HoldQuality {
  sampleCount: number;
  leftInBandMs: number;
  rightInBandMs: number;
  outOfPositionMs: number;
  dropCount: number;
  longestPairedStreakMs: number;
  settleMs: number | null;
  left: HoldSideQuality | null;
  right: HoldSideQuality | null;
  meanCompensationScore: number | null;
  minCompensationScore: number | null;
}

interface SessionSetDetail {
  setIndex: number;
  exerciseKind: "dynamic" | "isometric";
  targetReps: number;
  leftReps: number;
  rightReps: number;
  pairedReps: number;
  targetHoldMs: number;
  pairedHoldMs: number;
  durationMs: number;
  terminatedBy: string;
  asymmetryIndex: number | null;
  holdQuality: HoldQuality | null;
}
interface SessionRepDetail {
  repIndex: number;
  setIndex: number;
  side: string;
  peakValue: number | null;
  targetRom: number | null;
  classification: "complete" | "partial";
}
interface SessionDetail {
  id: number;
  exerciseId: string;
  exerciseName: string;
  startedAt: string;
  endedAt: string | null;
  sets: SessionSetDetail[];
  reps: SessionRepDetail[];
}

export default function PatientDetailPage() {
  const params = useParams();
  const patientId = params?.id as string;

  const [patient, setPatient] = useState<Patient | null>(null);
  const [exercises, setExercises] = useState<PatientExercise[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsError, setSessionsError] = useState(false);
  const [loading, setLoading] = useState(true);

  // Session drill-down: which row is expanded, fetched detail cache, in-flight id.
  const [expandedSessionId, setExpandedSessionId] = useState<number | null>(null);
  const [sessionDetails, setSessionDetails] = useState<Record<number, SessionDetail>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<number | null>(null);
  const sessionsCardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!patientId) return;

    const loadData = async () => {
      try {
        const [patientRes, exercisesRes, sessionsRes] = await Promise.all([
          fetch(`/api/users/${patientId}`),
          fetch(`/api/patient-exercises?patientId=${patientId}`),
          fetch(`/api/sessions?patientId=${patientId}`),
        ]);

        if (patientRes.ok) {
          const d = await patientRes.json();
          setPatient(d.user);
        }
        if (exercisesRes.ok) {
          const d = await exercisesRes.json();
          setExercises(d.exercises ?? []);
        }
        if (sessionsRes.ok) {
          const d = await sessionsRes.json();
          setSessions(d.sessions ?? []);
          setSessionsError(false);
        } else {
          setSessionsError(true);
        }
      } catch (err) {
        console.error("Error loading patient data:", err);
        setSessionsError(true);
      } finally {
        setLoading(false);
      }
    };

    void loadData();
  }, [patientId]);

  // Toggle a session row open; lazily fetch its detail on first expand.
  const toggleSession = async (id: number) => {
    if (expandedSessionId === id) {
      setExpandedSessionId(null);
      return;
    }
    setExpandedSessionId(id);
    if (!sessionDetails[id]) {
      setLoadingDetailId(id);
      try {
        const res = await fetch(`/api/sessions/${id}`);
        if (res.ok) {
          const d = await res.json();
          if (d.session) setSessionDetails((prev) => ({ ...prev, [id]: d.session }));
        }
      } catch (err) {
        console.error("Error loading session detail:", err);
      } finally {
        setLoadingDetailId(null);
      }
    }
  };

  const scrollToSessions = () => {
    sessionsCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const assignedExercises = exercises.filter(
    (e) => e.status === "pending" || e.status === "in_progress"
  );
const completedExercises = exercises.filter((e) => e.status === "completed");

  // Per-exercise session groups (oldest→newest) backing the Progress Trends
  // charts. Outcome-bearing sessions only — a started-then-abandoned session has
  // no reps/sets and would add spurious zero points (mirrors the patient
  // consistency calendar).
  const trendGroups = groupSessionsByExercise(
    sessions.filter((s) => s.setCount > 0 || s.totalReps > 0),
  );

  const progressStatus = () => {
    if (exercises.length === 0) return "not started";
    if (completedExercises.length === exercises.length) return "completed";
    if (exercises.some((e) => e.status === "in_progress")) return "in progress";
    if (completedExercises.length > 0) return "progressing";
    return "not started";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-gray-500">
        Loading patient profile...
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Patient not found.</p>
          <Link href="/dashboard/therapist/patients" className="text-green-700 hover:underline">
            ← Back to Patients
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-8 py-8">

      {/* Back link */}
      <Link
        href="/dashboard/therapist/patients"
        className="inline-flex items-center gap-1 text-sm text-green-700 hover:text-green-800 mb-6"
      >
        ← Back to Manage Patients
      </Link>

      {/* Header */}
      <h1 className="text-4xl font-bold text-green-800">Patient Profile</h1>
      <p className="text-gray-500 mt-1 mb-8">{patient.name}</p>

      {/* Personal Information */}
      <div className="bg-white rounded-2xl border border-green-100 p-6 mb-6">
        <h2 className="text-green-700 font-semibold text-lg mb-6">Personal Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0 text-green-600"><PersonIcon /></div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Full Name</p>
              <p className="text-sm font-semibold text-gray-900">{patient.name}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0 text-green-600"><PersonIcon /></div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Age</p>
              <p className="text-sm font-semibold text-gray-900">
                {patient.age ? `${patient.age} years old` : "—"}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0 text-green-600"><EmailIcon /></div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Email</p>
              <p className="text-sm font-semibold text-gray-900">{patient.email || "—"}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0 text-green-600"><TrendingIcon /></div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Progress Status</p>
              <span className={`inline-block mt-1 px-3 py-1 text-xs rounded-full font-medium ${
                progressStatus() === "completed"
                  ? "bg-green-100 text-green-700"
                  : progressStatus() === "not started"
                  ? "bg-red-100 text-red-700"
                  : "bg-blue-100 text-blue-700"
              }`}>
                {progressStatus()}
              </span>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0 text-green-600"><PulseIcon /></div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Assigned Specialist</p>
              <p className="text-sm font-semibold text-gray-900">
                {patient.therapistName || "—"}
              </p>
            </div>
          </div>

        </div>
      </div>

      {/* Assigned Exercises */}
      <div className="bg-white rounded-2xl border border-green-100 p-6 mb-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-green-700 font-semibold text-lg">Assigned Exercises</h2>
          <button
            onClick={scrollToSessions}
            className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded-lg transition"
          >
            View Patient Progress
          </button>
        </div>

        {assignedExercises.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">No assigned exercises.</p>
        ) : (
          <div className="space-y-4">
            {assignedExercises.map((ex) => (
              <div
                key={ex.exercise_id}
                className="rounded-xl border border-gray-100 p-4 flex justify-between items-center"
              >
                <div>
                  <h3 className="font-semibold text-green-700">{ex.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {ex.sets} sets ×{" "}
                    {prescriptionTargetText({
                      exerciseId: ex.exercise_id,
                      reps: ex.reps,
                      holdSeconds: ex.hold_seconds,
                    })} · {ex.rest_seconds}s rest
                  </p>
                  <span className={`inline-block mt-2 px-3 py-1 text-xs rounded-full font-medium ${
                    ex.status === "in_progress"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-red-100 text-red-700"
                  }`}>
                    {ex.status === "in_progress" ? "In Progress" : "Not Started"}
                  </span>
                </div>
                <button className="px-4 py-2 border border-green-700 text-green-700 text-sm rounded-lg hover:bg-green-50 transition">
                  View Exercise
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Completed Exercises */}
      <div className="bg-white rounded-2xl border border-green-100 p-6 mb-6">
        <h2 className="text-green-700 font-semibold text-lg mb-6">Completed Exercises</h2>

        {completedExercises.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">No completed exercises yet.</p>
        ) : (
          <div className="space-y-4">
            {completedExercises.map((ex) => (
              <div
                key={ex.exercise_id}
                className="rounded-xl border border-gray-100 p-4 flex justify-between items-center"
              >
                <div>
                  <h3 className="font-semibold text-gray-800">{ex.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {ex.sets} sets ×{" "}
                    {prescriptionTargetText({
                      exerciseId: ex.exercise_id,
                      reps: ex.reps,
                      holdSeconds: ex.hold_seconds,
                    })} · {ex.rest_seconds}s rest
                  </p>
                </div>
                <span className="px-3 py-1 bg-green-100 text-green-700 text-sm rounded-full font-medium">
                  Completed
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Progress Trends */}
      <div className="bg-white rounded-2xl border border-green-100 p-6 mb-6">
        <h2 className="text-green-700 font-semibold text-lg">Progress Trends</h2>
        <p className="text-xs text-gray-400 mt-1 mb-6">
          Session-over-session trends per exercise. Descriptive statistics — not a diagnosis.
        </p>

        {sessionsError ? (
          <p className="text-red-600 text-sm text-center py-6">
            Couldn&apos;t load session history.
          </p>
        ) : trendGroups.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">No sessions recorded yet.</p>
        ) : (
          <div className="space-y-5">
            {trendGroups.map((g) => (
              <ExerciseTrendCard key={g.exerciseId} group={g} />
            ))}
          </div>
        )}
      </div>

      {/* Sessions Record */}
      <div ref={sessionsCardRef} className="bg-white rounded-2xl border border-green-100 p-6 scroll-mt-6">
        <h2 className="text-green-700 font-semibold text-lg mb-6">Sessions Record</h2>

        {sessionsError ? (
          <p className="text-red-600 text-sm text-center py-6">
            Couldn&apos;t load session history. Check that the session tables exist and try again.
          </p>
        ) : sessions.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">No sessions recorded</p>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                expanded={expandedSessionId === s.id}
                detail={sessionDetails[s.id] ?? null}
                loadingDetail={loadingDetailId === s.id}
                onToggle={() => toggleSession(s.id)}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

// ── Sessions Record ──────────────────────────────────────────────────────────

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function fmtDuration(ms: number | null): string {
  if (ms == null || ms < 0) return "—";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// peak_value is in degrees for every exercise except ex_007 (Overhead Shoulder
// Press), whose primary metric is trunk-length-normalized. Avoid printing a "°"
// on normalized values.
function isAngleUnit(exerciseId: string): boolean {
  const def = getExerciseDefinition(exerciseId);
  if (def && def.kind === "dynamic") {
    return def.primaryMetric.name !== "wristShoulderVertical";
  }
  return true; // isometric / unknown → degrees
}

// ── Progress Trends ──────────────────────────────────────────────────────────

type TrendStatus = "improving" | "plateau" | "regressing";

interface TrendGroup {
  exerciseId: string;
  exerciseName: string;
  exerciseKind: SessionSummary["exerciseKind"];
  sessions: SessionSummary[]; // oldest → newest
}

const STATUS_STYLE: Record<TrendStatus, { label: string; classes: string }> = {
  improving:  { label: "Improving",  classes: "bg-green-100 text-green-700" },
  plateau:    { label: "Plateau",    classes: "bg-gray-100 text-gray-600" },
  regressing: { label: "Regressing", classes: "bg-amber-100 text-amber-700" },
};

// Group sessions by exercise. Input is newest-first (the API orders started_at
// DESC), so each group is reversed to oldest→newest for the time axis; groups
// are ordered by most-recent activity.
function groupSessionsByExercise(sessions: SessionSummary[]): TrendGroup[] {
  const map = new Map<string, SessionSummary[]>();
  for (const s of sessions) {
    const arr = map.get(s.exerciseId) ?? [];
    arr.push(s);
    map.set(s.exerciseId, arr);
  }
  return Array.from(map.values())
    .map((list) => ({
      exerciseId:   list[0].exerciseId,
      exerciseName: list[0].exerciseName,
      // Authoritative from the registry — NOT list[0].exerciseKind, which is
      // derived from set_events and is null for an abandoned/legacy newest
      // session (would mislabel e.g. an isometric card as dynamic). Fall back to
      // the first session that does carry a kind, then null.
      exerciseKind:
        getExerciseDefinition(list[0].exerciseId)?.kind ??
        list.find((s) => s.exerciseKind != null)?.exerciseKind ??
        null,
      sessions:     [...list].reverse(),
    }))
    .sort((a, b) =>
      b.sessions[b.sessions.length - 1].startedAt.localeCompare(
        a.sessions[a.sessions.length - 1].startedAt,
      ),
    );
}

// The session's primary trend value: ROM (avgPeakValue) for dynamic exercises,
// hold seconds for isometric. Null when the session didn't record it.
function sessionPrimaryValue(s: SessionSummary): number | null {
  if (s.exerciseKind === "isometric") {
    return s.totalPairedHoldMs != null ? s.totalPairedHoldMs / 1000 : null;
  }
  return s.avgPeakValue;
}

// Label / unit / whether the metric is an angle (the latter drives the badge
// deadband — hold seconds and ex_007's normalized units are not angles).
function primaryMetricMeta(
  exerciseId: string,
  kind: SessionSummary["exerciseKind"],
): { label: string; unit: string; isAngle: boolean } {
  if (kind === "isometric") return { label: "Hold time", unit: "s", isAngle: false };
  const angle = isAngleUnit(exerciseId);
  return { label: angle ? "Peak ROM" : "Peak", unit: angle ? "°" : "", isAngle: angle };
}

// Trend direction from a least-squares slope over the session values (oldest→
// newest). Needs ≥3 points (per the set/session-level-only rule). A deadband
// rejects inter-session noise: the projected change across the window must clear
// max(3° noise floor for angle metrics, 5% of the mean). Higher = better for both
// ROM and hold time. DESCRIPTIVE STATISTICS — not the ML model, not a diagnosis.
// The deadband is a tunable heuristic.
function trendStatus(values: number[], isAngle: boolean): TrendStatus | null {
  const n = values.length;
  if (n < 3) return null;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  if (den === 0) return "plateau";
  const projected = (num / den) * (n - 1); // change across the whole window
  const deadband = Math.max(isAngle ? 3 : 0, 0.05 * Math.abs(meanY));
  if (projected > deadband) return "improving";
  if (projected < -deadband) return "regressing";
  return "plateau";
}

function ExerciseTrendCard({ group }: { group: TrendGroup }) {
  const { exerciseId, exerciseName, exerciseKind, sessions } = group;
  const meta = primaryMetricMeta(exerciseId, exerciseKind);
  const isIso = exerciseKind === "isometric";

  const primaryValues = sessions
    .map(sessionPrimaryValue)
    .filter((v): v is number => v != null);
  const status = trendStatus(primaryValues, meta.isAngle);

  const first = sessions[0];
  const last = sessions[sessions.length - 1];

  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-green-700">{exerciseName}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {sessions.length} session{sessions.length === 1 ? "" : "s"}
            {sessions.length > 1 && (
              <>
                {" · "}
                {fmtDateTime(first.startedAt)} → {fmtDateTime(last.startedAt)}
              </>
            )}
          </p>
        </div>
        {status ? (
          <span className={`shrink-0 text-xs px-3 py-1 rounded-full font-medium ${STATUS_STYLE[status].classes}`}>
            {STATUS_STYLE[status].label}
          </span>
        ) : (
          <span className="shrink-0 text-xs px-3 py-1 rounded-full font-medium bg-gray-50 text-gray-400">
            Collecting data
          </span>
        )}
      </div>

      {sessions.length < 2 ? (
        <p className="text-xs text-gray-400 py-4 text-center">Needs ≥2 sessions to chart.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">{meta.label} over time</p>
            {primaryValues.length >= 2 ? (
              <TrendChart
                series={[{ label: meta.label, color: "#15803d", values: primaryValues }]}
                unitSuffix={meta.unit}
              />
            ) : (
              <p className="text-xs text-gray-400 py-4 text-center">
                No {meta.label.toLowerCase()} recorded.
              </p>
            )}
          </div>

          {!isIso && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Completed reps — left vs right</p>
              <TrendChart
                series={[
                  { label: "Left",  color: "#2563eb", values: sessions.map((s) => s.completeLeftReps) },
                  { label: "Right", color: "#ea580c", values: sessions.map((s) => s.completeRightReps) },
                ]}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionCard({
  session,
  expanded,
  detail,
  loadingDetail,
  onToggle,
}: {
  session: SessionSummary;
  expanded: boolean;
  detail: SessionDetail | null;
  loadingDetail: boolean;
  onToggle: () => void;
}) {
  const isIsometric = session.exerciseKind === "isometric";

  return (
    <div className="rounded-xl border border-gray-100 overflow-hidden">
      {/* Summary row (click to expand) */}
      <button
        onClick={onToggle}
        className="w-full text-left p-4 hover:bg-green-50/50 transition flex justify-between items-start gap-4"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-green-700">{session.exerciseName}</h3>
            {session.endedAt === null && (
              <span className="px-2 py-0.5 text-[10px] rounded-full bg-amber-100 text-amber-700 font-medium">
                incomplete
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{fmtDateTime(session.startedAt)}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-gray-600">
            <span>{fmtDuration(session.durationMs)}</span>
            <span>{session.setCount} set{session.setCount === 1 ? "" : "s"}</span>
            {isIsometric ? (
              <span>
                held {Math.round((session.totalPairedHoldMs ?? 0) / 1000)}s
                {session.totalTargetHoldMs
                  ? ` / ${Math.round(session.totalTargetHoldMs / 1000)}s`
                  : ""}
              </span>
            ) : (
              <>
                {/* Per-side complete/total — never a summed bilateral counter
                    (preserves the L/R asymmetry signal). */}
                <span>
                  L {session.completeLeftReps}/{session.leftReps} complete
                </span>
                <span>
                  R {session.completeRightReps}/{session.rightReps} complete
                </span>
                {session.avgPeakValue !== null && (
                  <span>
                    avg peak {session.avgPeakValue.toFixed(1)}
                    {isAngleUnit(session.exerciseId) ? "°" : ""}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <span className="text-gray-400 text-sm shrink-0 mt-1">{expanded ? "▲" : "▼"}</span>
      </button>

      {/* Drill-down */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50/60 p-4">
          {loadingDetail && !detail ? (
            <p className="text-sm text-gray-400">Loading session detail…</p>
          ) : detail ? (
            <SessionDetailBody detail={detail} />
          ) : (
            <p className="text-sm text-gray-400">Could not load session detail.</p>
          )}
        </div>
      )}
    </div>
  );
}

function SessionDetailBody({ detail }: { detail: SessionDetail }) {
  if (detail.sets.length === 0) {
    // Legacy/edge sessions (e.g. rows persisted before set_events existed) may
    // have rep records but no set records — reconstruct a grouping from reps.
    if (detail.reps.length > 0) return <RepFallbackList reps={detail.reps} />;
    return <p className="text-sm text-gray-400">No set or rep records for this session.</p>;
  }
  return (
    <div className="space-y-3">
      {detail.sets.map((set) => <SetRow key={set.setIndex} set={set} />)}
    </div>
  );
}

// Fallback for sessions that have rep_events but no set_events: group reps by
// their set index and show a compact per-set summary.
function RepFallbackList({ reps }: { reps: SessionRepDetail[] }) {
  const bySet = new Map<number, SessionRepDetail[]>();
  for (const rep of reps) {
    const arr = bySet.get(rep.setIndex) ?? [];
    arr.push(rep);
    bySet.set(rep.setIndex, arr);
  }
  const setIndexes = Array.from(bySet.keys()).sort((a, b) => a - b);
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">No set records — reconstructed from reps.</p>
      {setIndexes.map((idx) => {
        const group = bySet.get(idx)!;
        const left = group.filter((r) => r.side === "left").length;
        const right = group.filter((r) => r.side === "right").length;
        const complete = group.filter((r) => r.classification === "complete").length;
        return (
          <div key={idx} className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
            <span className="font-semibold text-gray-800">Set {idx}</span>{" "}
            <span className="text-gray-600">
              {group.length} rep{group.length === 1 ? "" : "s"} · L {left} / R {right} · {complete} complete
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SetRow({ set }: { set: SessionSetDetail }) {
  const isIso = set.exerciseKind === "isometric";
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold text-gray-800">Set {set.setIndex}</span>
        {isIso ? (
          <span className="text-gray-600">
            held {Math.round(set.pairedHoldMs / 1000)}s
            {set.targetHoldMs ? ` / ${Math.round(set.targetHoldMs / 1000)}s` : ""}
          </span>
        ) : (
          <>
            <span className="text-gray-600">L {set.leftReps} / R {set.rightReps} reps</span>
            {set.asymmetryIndex !== null && (
              <span className="text-gray-500">
                asymmetry {Math.round(set.asymmetryIndex * 100)}%
              </span>
            )}
          </>
        )}
        <span className="text-gray-400 text-xs">ended: {set.terminatedBy}</span>
      </div>

      {/* Isometric hold-quality grid */}
      {isIso && set.holdQuality && <HoldQualityGrid hq={set.holdQuality} />}
    </div>
  );
}

// Defensive formatters — hold_quality is persisted as an unvalidated JSONB blob
// (legacy / hand-inserted rows may have missing or non-numeric fields), so never
// call .toFixed on a value without confirming it's a finite number first.
function unit(v: unknown, digits: number, suffix: string): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(digits)}${suffix}` : "—";
}
function secs(v: unknown, digits = 0): string {
  return typeof v === "number" && Number.isFinite(v) ? `${(v / 1000).toFixed(digits)}s` : "—";
}

function HoldQualityGrid({ hq }: { hq: HoldQuality }) {
  const sideText = (s: HoldSideQuality | null) => {
    if (!s || typeof s !== "object") return "—";
    return `mean ${unit(s.meanDeg, 0, "°")} · err ${unit(s.meanErrorDeg, 0, "°")} · steadiness ${unit(s.sdDeg, 1, "°")} · droop ${unit(s.droopSlopeDegPerSec, 2, "°/s")}`;
  };
  const dropCount =
    typeof hq.dropCount === "number" && Number.isFinite(hq.dropCount) ? hq.dropCount : null;
  return (
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-600">
      <div><span className="text-gray-400">Left arm:</span> {sideText(hq.left)}</div>
      <div><span className="text-gray-400">Right arm:</span> {sideText(hq.right)}</div>
      <div>
        <span className="text-gray-400">Out of position:</span>{" "}
        {secs(hq.outOfPositionMs)}
        {dropCount !== null ? ` · ${dropCount} drop${dropCount === 1 ? "" : "s"}` : ""}
        {hq.settleMs != null ? ` · settle ${secs(hq.settleMs, 1)}` : ""}
      </div>
      <div>
        <span className="text-gray-400">Compensation:</span>{" "}
        {typeof hq.meanCompensationScore === "number" ? `avg ${hq.meanCompensationScore}` : "—"}
        {typeof hq.minCompensationScore === "number" ? ` · worst ${hq.minCompensationScore}` : ""}
      </div>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function PersonIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z"/>
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/>
    </svg>
  );
}

function TrendingIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/>
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99l1.5 1.5z"/>
    </svg>
  );
}
