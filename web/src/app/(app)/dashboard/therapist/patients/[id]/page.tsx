"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { isPatientImageMimeType } from "@/lib/patientAttachments";
import { prescriptionTargetText } from "@/lib/exercises/prescriptionDisplay";
import { getExerciseDefinition } from "@/lib/exercises/registry";
import type { DynamicRepQuality } from "@/lib/pose/repQuality";
import {
  formatPreSessionPain,
  formatResistanceContext,
  preSessionPainFromContext,
  type PainReportStatus,
  type PainTiming,
  type PrescribedSide,
  type ResistanceContext,
  type SessionContextSnapshot,
  type SessionEndReason,
  type TherapistReviewLabel,
} from "@/lib/prescriptionContext";
import {
  ANGLE_ESTIMATE_LABEL,
  fullRomOutcomeText,
  prescribedOutcomeSides,
  shouldShowOutcomeAsymmetry,
  sideLabel,
} from "@/lib/sessionOutcomePresentation";
import { groupSessionsByExercise, ExerciseTrendCard } from "../../../_components/ExerciseTrends";
import { SkeletonBar, SkeletonCard } from "../../../_components/Skeleton";
import ReportButton from "../../../_components/ReportButton";
import PatientReports from "../../../_components/PatientReports";
import type { OccurrenceStatus } from "@/lib/exercises/occurrences";
import SessionVideo from "../../../_components/SessionVideo";
import { UNSTEADY_TRACKING_NOTE_PCT, unsteadyTrackingPct } from "@/lib/sessionReadModels";

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

interface PatientAttachment {
  id: number;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

interface PatientExercise {
  id: number;
  exercise_id: string;
  name: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "pain_stopped";
  sets: number;
  reps: number;
  rest_seconds: number;
  hold_seconds: number;
  assigned_date: string;
  start_date: string | null;
  end_date: string | null;
  archived_at: string | null;
  monitoring_mode: "camera" | "manual";
  prescribed_side: PrescribedSide;
  resistance_type: ResistanceContext["type"];
  resistance_value: number | string | null;
  resistance_unit: ResistanceContext["unit"];
  resistance_label: string | null;
  prescription_state: "upcoming" | "active" | "ended" | "archived";
  adherence_state:
    | "not_assessed"
    | "not_started"
    | "in_progress"
    | "partially_completed"
    | "completed";
  occurrence_summary: {
    scheduled: number;
    completed: number;
    missed: number;
    inProgress: number;
    remaining: number;
    cancelled: number;
    painStopped: number;
  };
}

// Per-session summary row from GET /api/sessions.
interface SessionSummary {
  id: number;
  exerciseId: string;
  exerciseName: string;
  exerciseKind: "dynamic" | "isometric" | null;
  startedAt: string;
  endedAt: string | null;
  endReason: SessionEndReason | null;
  durationMs: number | null;
  setCount: number;
  totalReps: number;
  completeReps: number;
  leftReps: number;
  rightReps: number;
  completeLeftReps: number;
  completeRightReps: number;
  avgPeakValue: number | null;
  avgLeftPeakValue: number | null;
  avgRightPeakValue: number | null;
  totalPairedHoldMs: number | null;
  totalTargetHoldMs: number | null;
  totalLeftHoldMs: number | null;
  totalRightHoldMs: number | null;
  avgAsymmetryIndex: number | null;
  // Rule-based compensation score (0–100), only present for isometric sessions.
  avgCompensationScore: number | null;
  prescribedSide: PrescribedSide;
  resistance: ResistanceContext;
  comparableContextKey: string;
  exerciseConfigVersion: string | null;
  context: SessionContextSnapshot | null;
  hasRecording?: boolean;
  painReport: {
    status: PainReportStatus;
    score: number | null;
    timing: PainTiming | null;
    bodyArea: string | null;
    reportedAt: string | null;
  };
  reviewScore: number | null;
  reviewScoreSource: "raw_rule_v1" | "hold_rule_v1" | null;
  latestReview: SessionReview | null;
}

interface SessionReview {
  id?: number;
  label: TherapistReviewLabel;
  scoreSource: "raw_rule_v1" | "hold_rule_v1";
  scoreValue: number;
  createdAt: string;
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
  compensations: DynamicRepQuality | null;
}
interface SessionDetail {
  id: number;
  exerciseId: string;
  exerciseName: string;
  startedAt: string;
  endedAt: string | null;
  endReason: SessionEndReason | null;
  context: SessionContextSnapshot | null;
  registryVersion: string | null;
  exerciseConfigVersion: string | null;
  appRevision: string | null;
  painReport: {
    status: PainReportStatus;
    score: number | null;
    timing: PainTiming | null;
    bodyArea: string | null;
    reportedAt: string | null;
  };
  captureQuality: {
    framesTotal: number;
    framesOk: number;
    pctOk: number;
    unsteadyFrames?: number;
    checkedFrames?: number;
  } | null;
  deviceContext: { browser: string; platform: string } | null;
  sets: SessionSetDetail[];
  reps: SessionRepDetail[];
  reviews: SessionReview[];
}

function formatDateKey(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function patientExerciseResistance(exercise: PatientExercise): ResistanceContext {
  const parsedValue =
    exercise.resistance_value == null ? null : Number(exercise.resistance_value);
  return {
    type: exercise.resistance_type ?? "unknown",
    value:
      parsedValue !== null && Number.isFinite(parsedValue) ? parsedValue : null,
    unit: exercise.resistance_unit ?? null,
    label: exercise.resistance_label ?? null,
  };
}

function prescribedSideText(side: PrescribedSide): string {
  if (side === "both") return "Both sides";
  return `${side[0].toUpperCase()}${side.slice(1)} side`;
}

function adherenceSummaryText(exercise: PatientExercise): string {
  const summary = exercise.occurrence_summary;
  if (summary.scheduled === 0) return "No scheduled occurrences";
  const assessed = Math.max(0, summary.scheduled - summary.painStopped);
  const parts =
    assessed > 0
      ? [`${summary.completed} of ${assessed} assessed occurrence${assessed === 1 ? "" : "s"} completed`]
      : ["No occurrence outcome assessed"];
  if (summary.missed > 0) parts.push(`${summary.missed} missed`);
  if (summary.remaining > 0) parts.push(`${summary.remaining} remaining`);
  if (summary.painStopped > 0) {
    parts.push(`${summary.painStopped} stopped for pain`);
  }
  if (summary.cancelled > 0) parts.push(`${summary.cancelled} cancelled when ended`);
  return parts.join(" · ");
}

type PatientTab = "overview" | "program" | "reports" | "sessions";

const PATIENT_TABS: Array<{ key: PatientTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "program", label: "PT Program" },
  { key: "reports", label: "Reports" },
  { key: "sessions", label: "Sessions" },
];

interface ReportOccurrence {
  due_date: string;
  makeup_until: string;
  status: OccurrenceStatus;
}

// A tab's panel; every panel stays visible when the page is printed.
function TabPanel({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <div className={active ? "" : "hidden print:block"}>{children}</div>;
}

export default function PatientDetailPage() {
  const params = useParams();
  const patientId = params?.id as string;

  const [patient, setPatient] = useState<Patient | null>(null);
  const [patientImages, setPatientImages] = useState<PatientAttachment[]>([]);
  const [patientImagesError, setPatientImagesError] = useState(false);
  const [imageToView, setImageToView] = useState<PatientAttachment | null>(null);
  const [imagePassword, setImagePassword] = useState("");
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imagePasswordError, setImagePasswordError] = useState("");
  const [verifyingImagePassword, setVerifyingImagePassword] = useState(false);
  const [exercises, setExercises] = useState<PatientExercise[]>([]);
  const [occurrences, setOccurrences] = useState<ReportOccurrence[]>([]);
  const [tab, setTab] = useState<PatientTab>("overview");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsError, setSessionsError] = useState(false);
  const [loading, setLoading] = useState(true);

  // Session drill-down: which row is expanded, fetched detail cache, in-flight id.
  const [expandedSessionId, setExpandedSessionId] = useState<number | null>(null);
  const [sessionDetails, setSessionDetails] = useState<Record<number, SessionDetail>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<number | null>(null);
  const sessionsCardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!imagePreviewUrl) return;
    return () => URL.revokeObjectURL(imagePreviewUrl);
  }, [imagePreviewUrl]);

  useEffect(() => {
    if (!patientId) return;

    const loadData = async () => {
      try {
        const [patientRes, exercisesRes, sessionsRes, imagesRes] = await Promise.all([
          fetch(`/api/users/${patientId}`),
          fetch(`/api/patient-exercises?patientId=${patientId}&includeArchived=true`),
          fetch(`/api/sessions?patientId=${patientId}`),
          fetch(`/api/users/${patientId}/attachments`),
        ]);

        if (patientRes.ok) {
          const d = await patientRes.json();
          setPatient(d.user);
        }
        if (exercisesRes.ok) {
          const d = await exercisesRes.json();
          setExercises(d.exercises ?? []);
          setOccurrences(d.occurrences ?? []);
        }
        if (sessionsRes.ok) {
          const d = await sessionsRes.json();
          setSessions(d.sessions ?? []);
          setSessionsError(false);
        } else {
          setSessionsError(true);
        }
        if (imagesRes.ok) {
          const d = await imagesRes.json();
          setPatientImages(d.attachments ?? []);
          setPatientImagesError(false);
        } else {
          setPatientImagesError(true);
        }
      } catch (err) {
        console.error("Error loading patient data:", err);
        setSessionsError(true);
        setPatientImagesError(true);
      } finally {
        setLoading(false);
      }
    };

    void loadData();
  }, [patientId]);

  const refreshSessionDetail = async (id: number) => {
    setLoadingDetailId(id);
    try {
      const res = await fetch(`/api/sessions/${id}`);
      if (res.ok) {
        const d = await res.json();
        if (d.session) {
          setSessionDetails((prev) => ({ ...prev, [id]: d.session }));
        }
      }
    } catch (err) {
      console.error("Error loading session detail:", err);
    } finally {
      setLoadingDetailId(null);
    }
  };

  // Toggle a session row open; lazily fetch its detail on first expand.
  const toggleSession = async (id: number) => {
    if (expandedSessionId === id) {
      setExpandedSessionId(null);
      return;
    }
    setExpandedSessionId(id);
    if (!sessionDetails[id]) await refreshSessionDetail(id);
  };

  const scrollToSessions = () => {
    setTab("reports");
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  };

  const closeImageViewer = () => {
    setImageToView(null);
    setImagePassword("");
    setImagePreviewUrl(null);
    setImagePasswordError("");
    setVerifyingImagePassword(false);
  };

  const verifyPasswordAndViewImage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!imageToView || !imagePassword) return;
    setVerifyingImagePassword(true);
    setImagePasswordError("");
    try {
      const response = await fetch(
        `/api/users/${encodeURIComponent(patientId)}/attachments/${imageToView.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: imagePassword }),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setImagePasswordError(data.error || "Unable to open this file.");
        return;
      }
      setImagePreviewUrl(URL.createObjectURL(await response.blob()));
      setImagePassword("");
    } catch {
      setImagePasswordError("Unable to open this image. Please try again.");
    } finally {
      setVerifyingImagePassword(false);
    }
  };

  const currentPrescriptions = exercises.filter(
    (exercise) => exercise.prescription_state === "active" || exercise.prescription_state === "upcoming",
  );
  const endedPrescriptions = exercises.filter(
    (exercise) => exercise.prescription_state === "ended" || exercise.prescription_state === "archived",
  );
  const completedExercises = exercises.filter(
    (exercise) => exercise.occurrence_summary.completed > 0,
  );

  // Per-exercise session groups (oldest→newest) backing the Progress Trends
  // charts (the shared helper keeps only outcome-bearing sessions).
  const trendGroups = groupSessionsByExercise(sessions);

  // Rule-based form-quality heuristic — averaged across the sessions that carry
  // a compensation score (currently only the isometric hold exercise persists
  // one). Null when the patient has no scored sessions yet.
  const compScoredSessions = sessions.filter((s) => s.avgCompensationScore != null);
  const compScoreCount = compScoredSessions.length;
  const compScoreAvg =
    compScoreCount > 0
      ? compScoredSessions.reduce((sum, s) => sum + (s.avgCompensationScore as number), 0) /
        compScoreCount
      : null;

  const progressStatus = () => {
    if (exercises.length === 0) return "not started";
    if (currentPrescriptions.some((exercise) => exercise.adherence_state === "in_progress")) {
      return "in progress";
    }
    if (currentPrescriptions.length > 0) return "scheduled";
    if (completedExercises.length > 0) return "history recorded";
    return "not started";
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-8 py-8">
        <SkeletonBar className="h-4 w-40 mb-6" />
        <SkeletonBar className="h-9 w-64" />
        <SkeletonBar className="h-4 w-40 mt-2 mb-8" />
        <div className="space-y-6">
          <SkeletonCard className="h-40" />
          <SkeletonCard className="h-32" />
          <SkeletonCard className="h-48" />
        </div>
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
    <div className="max-w-6xl mx-auto print:px-0 print:py-0 print:max-w-none">

      {/* Print-only report header */}
      <div className="hidden print:block mb-6 border-b border-gray-300 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Patient Progress Report</h1>
        <p className="text-sm text-gray-700 mt-1">{patient.name}</p>
        <p className="text-xs text-gray-500">Generated {fmtDateTime(new Date().toISOString())}</p>
      </div>

      {/* Header */}
      <div className="print:hidden">
        <Link
          href="/dashboard/therapist/patients"
          className="inline-flex items-center gap-1 text-sm text-green-700 hover:text-green-800 mb-3"
        >
          ‹ Back
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Patient Profile</h1>
            <p className="text-gray-500 mt-1">{patient.name}</p>
          </div>
          <div id="tour-detail-actions" className="shrink-0 flex flex-wrap items-start justify-end gap-2">
            <Link
              href={`/dashboard/therapist/assign?patientId=${encodeURIComponent(patientId)}`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-700 text-white text-sm font-medium rounded-lg hover:bg-green-800 transition"
            >
              Assign Exercise
            </Link>
            <ReportButton
              label="Progress report (PDF)"
              onDownload={async () => {
                const { downloadProgressReport } = await import("../../../_components/progressReport");
                await downloadProgressReport({ patientId }, patient.name);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-700 text-white text-sm font-medium rounded-lg hover:bg-green-800 transition disabled:opacity-60"
            />
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-4 py-2 border border-green-700 text-green-700 text-sm font-medium rounded-lg hover:bg-green-50 transition"
            >
              <PrinterIcon />
              Print / Save as PDF
            </button>
          </div>
        </div>

        <div id="tour-detail-tabs" role="tablist" className="mt-5 mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-green-100">
          {PATIENT_TABS.map(({ key, label }) => (
            <button
              key={key}
              id={`tour-detail-tab-${key}`}
              role="tab"
              aria-selected={tab === key}
              type="button"
              onClick={() => setTab(key)}
              className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                tab === key
                  ? "border-green-600 text-green-700"
                  : "border-transparent text-gray-500 hover:text-green-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <TabPanel active={tab === "overview"}>
      {/* Personal Information */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-gray-900 font-semibold text-lg mb-6">Personal Information</h2>
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
                progressStatus() === "history recorded"
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

      {/* Clinical information */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-gray-900 font-semibold text-lg mb-5">Clinical Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <p className="text-xs text-gray-500 mb-1">Diagnosis</p>
            <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">
              {patient.diagnosis?.trim() || "Not recorded"}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Condition</p>
            <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">
              {patient.condition?.trim() || "Not recorded"}
            </p>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs text-gray-500 mb-1">Prescription</p>
            <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">
              {patient.prescription?.trim() || "Not recorded"}
            </p>
          </div>
        </div>
      </div>

      {/* Patient attachments */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <div className="flex items-center justify-between gap-3 mb-5">
          <h2 className="text-gray-900 font-semibold text-lg">Attached Files</h2>
          {patientImages.length > 0 && (
            <span className="text-xs text-gray-500">{patientImages.length} file{patientImages.length === 1 ? "" : "s"}</span>
          )}
        </div>
        {patientImagesError ? (
          <p className="text-sm text-red-600">Unable to load attached files.</p>
        ) : patientImages.length === 0 ? (
          <p className="text-sm text-gray-400">No files attached to this patient.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {patientImages.map((attachment) => {
              return (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => {
                    setImageToView(attachment);
                    setImagePassword("");
                    setImagePasswordError("");
                    setImagePreviewUrl(null);
                  }}
                  className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50 text-left transition hover:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-600"
                >
                  <div className="grid aspect-[4/3] place-items-center bg-green-50 p-3 text-center text-sm font-medium text-green-800">
                    <span>
                      <span className="mb-2 block text-xs uppercase text-green-700">
                        {attachment.mimeType.split("/").at(-1)?.replace("vnd.", "") ?? "file"}
                      </span>
                      Verify password to open
                    </span>
                  </div>
                  <span className="block truncate px-2 py-2 text-xs text-gray-600" title={attachment.fileName}>
                    {attachment.fileName}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {imageToView && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="patient-image-dialog-title"
            className="w-full max-w-3xl rounded-xl bg-white p-5 shadow-2xl sm:p-6"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id="patient-image-dialog-title" className="text-lg font-semibold text-gray-900">
                  Confidential patient file
                </h2>
                <p className="mt-1 truncate text-sm text-gray-500">{imageToView.fileName}</p>
              </div>
              <button
                type="button"
                onClick={closeImageViewer}
                className="shrink-0 rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                Close
              </button>
            </div>
            {imagePreviewUrl ? (
              <div className="space-y-4">
                {isPatientImageMimeType(imageToView.mimeType) ? (
                  <Image
                    src={imagePreviewUrl}
                    alt={imageToView.fileName}
                    width={1200}
                    height={900}
                    unoptimized
                    className="mx-auto max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
                  />
                ) : imageToView.mimeType === "application/pdf" ? (
                  <iframe
                    src={imagePreviewUrl}
                    title={imageToView.fileName}
                    className="h-[70vh] w-full rounded-lg border border-gray-200"
                  />
                ) : (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center">
                    <p className="mb-4 text-sm text-gray-700">This document is ready to download.</p>
                    <a
                      href={imagePreviewUrl}
                      download={imageToView.fileName}
                      className="inline-flex rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
                    >
                      Download file
                    </a>
                  </div>
                )}
                <p className="text-center text-xs text-gray-500">Close this window to lock the file again.</p>
              </div>
            ) : (
              <form onSubmit={verifyPasswordAndViewImage} className="space-y-4">
                <p className="text-sm text-gray-600">
                  Enter your account password to open this file.
                </p>
                <label className="block text-sm font-medium text-gray-700" htmlFor="patient-image-password">
                  Password
                  <input
                    id="patient-image-password"
                    type="password"
                    autoComplete="current-password"
                    autoFocus
                    required
                    value={imagePassword}
                    onChange={(event) => setImagePassword(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-200"
                  />
                </label>
                {imagePasswordError && (
                  <p role="alert" className="text-sm text-red-700">{imagePasswordError}</p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeImageViewer}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={verifyingImagePassword || !imagePassword}
                    className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-wait disabled:opacity-60"
                  >
                    {verifyingImagePassword ? "Verifying…" : "Verify & View"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}

      </TabPanel>

      <TabPanel active={tab === "program"}>
      {/* Current prescription lifecycle */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-gray-900 font-semibold text-xl">Current Prescriptions</h2>
          <button
            onClick={scrollToSessions}
            className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white text-base font-medium rounded-lg transition print:hidden"
          >
            View Patient Progress
          </button>
        </div>

        {currentPrescriptions.length === 0 ? (
          <p className="text-gray-400 text-base text-center py-6">No active or upcoming prescriptions.</p>
        ) : (
          <div className="space-y-4">
            {currentPrescriptions.map((ex) => (
              <div
                key={ex.id}
                className="rounded-xl border border-gray-100 p-4 flex justify-between items-center"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-green-700">{ex.name}</h3>
                    {ex.monitoring_mode === "manual" && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                        Manual · no Machine Learning
                      </span>
                    )}
                  </div>
                  <p className="text-base text-gray-500 mt-1">
                    {ex.sets} sets ×{" "}
                    {prescriptionTargetText({
                      exerciseId: ex.exercise_id,
                      reps: ex.reps,
                      holdSeconds: ex.hold_seconds,
                    })} · {ex.rest_seconds}s rest
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    {prescribedSideText(ex.prescribed_side ?? "both")} ·{" "}
                    {formatResistanceContext(patientExerciseResistance(ex))}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    {formatDateKey(ex.start_date ?? ex.assigned_date)} to {formatDateKey(ex.end_date ?? ex.assigned_date)}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">{adherenceSummaryText(ex)}</p>
                </div>
                <span className={`px-3 py-1 text-base rounded-full font-medium shrink-0 ${
                  ex.prescription_state === "upcoming"
                    ? "bg-gray-100 text-gray-700"
                    : "bg-blue-100 text-blue-700"
                }`}>
                  {ex.prescription_state === "upcoming" ? "Upcoming" : "Active"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ended prescription lifecycle */}
      {endedPrescriptions.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-gray-800 font-semibold text-xl mb-2">Ended Prescriptions</h2>
          <p className="mb-5 text-sm text-gray-500">
            Prescription state is shown separately from the completed and missed occurrence outcomes below.
          </p>
          <div className="space-y-4">
            {endedPrescriptions.map((ex) => (
              <div
                key={ex.id}
                className="rounded-xl border border-gray-100 p-4 flex justify-between items-center gap-4"
              >
                <div>
                  <h3 className="font-semibold text-gray-800">{ex.name}</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {prescribedSideText(ex.prescribed_side ?? "both")} ·{" "}
                    {formatResistanceContext(patientExerciseResistance(ex))}
                  </p>
                  <p className="mt-1 text-base text-gray-500">{adherenceSummaryText(ex)}</p>
                  <p className="mt-1 text-sm text-gray-400">
                    Scheduled through {formatDateKey(ex.end_date ?? ex.assigned_date)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-gray-100 px-3 py-1 text-base font-medium text-gray-700">
                  {ex.prescription_state === "archived" ? "Ended early" : "Ended"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed occurrence outcomes */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-gray-900 font-semibold text-xl mb-2">Completed Exercise Outcomes</h2>
        <p className="mb-5 text-sm text-gray-500">
          Populated from completed scheduled occurrences, even when the overall prescription later ended with missed work.
        </p>

        {completedExercises.length === 0 ? (
          <p className="text-gray-400 text-base text-center py-6">No completed occurrences yet.</p>
        ) : (
          <div className="space-y-4">
            {completedExercises.map((ex) => (
              <div
                key={ex.id}
                className="rounded-xl border border-gray-100 p-4 flex justify-between items-center"
              >
                <div>
                  <h3 className="font-semibold text-gray-800">{ex.name}</h3>
                  <p className="text-base text-gray-500 mt-1">
                    {adherenceSummaryText(ex)}
                  </p>
                </div>
                <span className="px-3 py-1 bg-green-100 text-green-700 text-base rounded-full font-medium">
                  {ex.occurrence_summary.completed} completed
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      </TabPanel>

      <TabPanel active={tab === "reports"}>
      <div id="tour-detail-reports" className="mb-6 print:hidden">
        <PatientReports sessions={sessions} occurrences={occurrences} />
      </div>

      {/* Form Quality */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-gray-900 font-semibold text-xl">Form Quality</h2>
        <p className="text-sm text-gray-400 mt-1 mb-5">
          How cleanly the movement was performed (compensation patterns). Supplementary — not a diagnosis.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Rule-based heuristic (currently isometric holds only) */}
          <div className="rounded-xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-base font-medium text-gray-700">Rule-based score</p>
              <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-500 font-medium">
                heuristic
              </span>
            </div>
            {compScoreAvg !== null ? (
              <>
                <p className="text-4xl font-bold text-green-700">
                  {Math.round(compScoreAvg)}
                  <span className="text-lg font-medium text-gray-400">/100</span>
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Average over {compScoreCount} isometric hold session
                  {compScoreCount === 1 ? "" : "s"}. Higher is cleaner form.
                </p>
              </>
            ) : (
              <>
                <p className="text-3xl font-semibold text-gray-300">—</p>
                <p className="text-sm text-gray-400 mt-1">
                  Available for the isometric hold exercise (Arm Abduction at 90°). No scored
                  sessions yet.
                </p>
              </>
            )}
          </div>

          {/* Machine-learning trend analytics: the Progress Trends below. */}
          <div className="rounded-xl border border-gray-100 p-4">
            <p className="text-base font-medium text-gray-700 mb-1">Trend model</p>
            <p className="text-sm text-gray-500">
              The Rising / No clear change / Falling labels and shaded bands in Progress Trends come from a
              machine-learning trend model. Rising or Falling appears only when a side&apos;s change is larger than
              normal session-to-session variation; otherwise the label is No clear change. Supplementary
              information, not a diagnosis.
            </p>
          </div>
        </div>
      </div>

      {/* Progress Trends */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h2 className="text-gray-900 font-semibold text-xl">Progress Trends</h2>
        <p className="text-sm text-gray-400 mt-1 mb-6">
          Session-over-session trends per exercise. Descriptive statistics — not a diagnosis.
        </p>

        {sessionsError ? (
          <p className="text-red-600 text-base text-center py-6">
            Couldn&apos;t load session history.
          </p>
        ) : trendGroups.length === 0 ? (
          <p className="text-gray-400 text-base text-center py-6">No sessions recorded yet.</p>
        ) : (
          <div className="space-y-5">
            {trendGroups.map((g) => (
              <ExerciseTrendCard key={g.contextKey} group={g} />
            ))}
          </div>
        )}
      </div>

      </TabPanel>

      <TabPanel active={tab === "sessions"}>
      {/* Sessions Record */}
      <div ref={sessionsCardRef} className="bg-white rounded-xl shadow-sm p-6 scroll-mt-6">
        <h2 className="text-gray-900 font-semibold text-xl mb-6">Sessions Record</h2>

        {sessionsError ? (
          <p className="text-red-600 text-base text-center py-6">
            Couldn&apos;t load session history. Check that the session tables exist and try again.
          </p>
        ) : sessions.length === 0 ? (
          <p className="text-gray-400 text-base text-center py-6">No sessions recorded</p>
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
                onDetailChanged={() => refreshSessionDetail(s.id)}
                patientName={patient.name}
              />
            ))}
          </div>
        )}
      </div>

      </TabPanel>

      {/* Print-only disclaimer footer */}
      <p className="hidden print:block text-xs text-gray-500 mt-6 pt-3 border-t border-gray-300">
        Supplementary monitoring output — not a medical device and not clinically validated.
        Figures are estimated from a single front-facing camera and require professional interpretation.
      </p>

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

function SessionCard({
  session,
  expanded,
  detail,
  loadingDetail,
  onToggle,
  onDetailChanged,
  patientName,
}: {
  session: SessionSummary;
  expanded: boolean;
  detail: SessionDetail | null;
  loadingDetail: boolean;
  onToggle: () => void;
  onDetailChanged: () => Promise<void>;
  patientName: string;
}) {
  const isIsometric = session.exerciseKind === "isometric";
  const outcomeSides = prescribedOutcomeSides(session.prescribedSide);
  const repCountBySide = {
    left: session.leftReps,
    right: session.rightReps,
  };
  const completeBySide = {
    left: session.completeLeftReps,
    right: session.completeRightReps,
  };
  const peakBySide = {
    left: session.avgLeftPeakValue,
    right: session.avgRightPeakValue,
  };
  const holdMsBySide = {
    left: session.totalLeftHoldMs ?? session.totalPairedHoldMs ?? 0,
    right: session.totalRightHoldMs ?? session.totalPairedHoldMs ?? 0,
  };
  const angleUnit = isAngleUnit(session.exerciseId);

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
              <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 font-medium">
                incomplete
              </span>
            )}
            {session.hasRecording && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700 font-medium">
                video
              </span>
            )}
            {session.endReason === "pain" && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700 font-semibold">
                stopped for pain
              </span>
            )}
            {session.latestReview && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700 font-medium">
                clinician reviewed
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">{fmtDateTime(session.startedAt)}</p>
          <p className="text-sm text-gray-500 mt-0.5">
            {prescribedSideText(session.prescribedSide)} ·{" "}
            {formatResistanceContext(session.resistance)}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-base text-gray-600">
            <span>{fmtDuration(session.durationMs)}</span>
            <span>{session.setCount} set{session.setCount === 1 ? "" : "s"}</span>
            {isIsometric ? (
              outcomeSides.map((side) => (
                <span key={side}>
                  {sideLabel(side)} held {Math.round(holdMsBySide[side] / 1000)}s
                  {session.totalTargetHoldMs
                    ? ` / ${Math.round(session.totalTargetHoldMs / 1000)}s`
                    : ""}
                </span>
              ))
            ) : (
              <>
                {outcomeSides.map((side) => (
                  <span key={side}>
                    {sideLabel(side)}{" "}
                    {fullRomOutcomeText(
                      completeBySide[side],
                      repCountBySide[side],
                    )}
                    {peakBySide[side] !== null
                      ? ` · avg peak${angleUnit ? ` ${ANGLE_ESTIMATE_LABEL}` : ""} ${peakBySide[side]!.toFixed(angleUnit ? 1 : 2)}`
                      : ""}
                  </span>
                ))}
              </>
            )}
          </div>
        </div>
        <span className="text-gray-400 text-base shrink-0 mt-1">{expanded ? "▲" : "▼"}</span>
      </button>

      {/* Drill-down */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50/60 p-4">
          {loadingDetail && !detail ? (
            <p className="text-base text-gray-400">Loading session detail…</p>
          ) : detail ? (
            <SessionDetailBody
              detail={detail}
              reviewScore={session.reviewScore}
              reviewScoreSource={session.reviewScoreSource}
              onDetailChanged={onDetailChanged}
              patientName={patientName}
            />
          ) : (
            <p className="text-base text-gray-400">Could not load session detail.</p>
          )}
        </div>
      )}
    </div>
  );
}

function SessionDetailBody({
  detail,
  reviewScore,
  reviewScoreSource,
  onDetailChanged,
  patientName,
}: {
  detail: SessionDetail;
  reviewScore: number | null;
  reviewScoreSource: "raw_rule_v1" | "hold_rule_v1" | null;
  onDetailChanged: () => Promise<void>;
  patientName: string;
}) {
  const prescribedSide =
    detail.context?.prescription.prescribedSide ?? "both";
  const outcomeRows = detail.sets.length > 0 ? (
    detail.sets.map((set) => (
      <SetRow
        key={set.setIndex}
        set={set}
        reps={detail.reps.filter((rep) => rep.setIndex === set.setIndex)}
        prescribedSide={prescribedSide}
      />
    ))
  ) : detail.reps.length > 0 ? (
    // Legacy/edge sessions may have rep records but no set records.
    <RepFallbackList reps={detail.reps} prescribedSide={prescribedSide} />
  ) : (
    <p className="text-base text-gray-400">No set or rep records for this session.</p>
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ReportButton
          label="Session report (PDF)"
          onDownload={async () => {
            const { downloadSessionReport } = await import("@/lib/reports/sessionReport");
            await downloadSessionReport(detail.id, patientName);
          }}
          className="px-3 py-1.5 border border-green-700 text-green-700 text-sm font-medium rounded-lg hover:bg-green-50 transition disabled:opacity-60"
        />
      </div>
      <SessionVideo sessionId={detail.id} />
      <SessionPrescriptionContext detail={detail} />
      <SessionPainReport detail={detail} />
      <SessionCaptureContext detail={detail} />
      {outcomeRows}
      <SessionReviewPanel
        sessionId={detail.id}
        reviews={detail.reviews}
        score={reviewScore}
        scoreSource={reviewScoreSource}
        onReviewed={onDetailChanged}
      />
    </div>
  );
}

function SessionPrescriptionContext({ detail }: { detail: SessionDetail }) {
  const context = detail.context;
  if (!context) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-500">
        Prescription and scoring context is unavailable for this legacy session.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
      <p className="font-semibold text-gray-800">Recorded session context</p>
      <p className="mt-1">
        {prescribedSideText(context.prescription.prescribedSide)} ·{" "}
        {formatResistanceContext(context.prescription.resistance)} ·{" "}
        {context.prescription.sets} set
        {context.prescription.sets === 1 ? "" : "s"} · registry{" "}
        {detail.registryVersion?.slice(0, 12) ?? "unversioned"}
      </p>
      <p className="mt-1 text-gray-400">
        This snapshot is fixed to the session; later prescription or threshold
        edits do not rewrite it.
      </p>
    </div>
  );
}

/**
 * The before-session survey beside the after-session report. Only a pain stop
 * needs follow-up; otherwise the reports are shown as plain context.
 */
function SessionPainReport({ detail }: { detail: SessionDetail }) {
  const report = detail.painReport;
  const before = preSessionPainFromContext(detail.context);
  const painStop = detail.endReason === "pain";
  if (!painStop && report.status !== "reported" && before === null) return null;
  return (
    <div className={painStop
      ? "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
      : "rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600"}>
      <p className={painStop ? "font-semibold" : "font-semibold text-gray-800"}>
        {painStop ? "Pain follow-up required before rescheduling" : "Pain reports"}
      </p>
      {before !== null && (
        <p className="mt-1">Before the session: {formatPreSessionPain(before)}</p>
      )}
      {report.status === "reported" ? (
        <p className="mt-1">
          After the attempt: {report.score}/10
          {report.timing ? ` · ${report.timing === "both" ? "during and after" : report.timing}` : ""}
          {report.bodyArea ? ` · ${report.bodyArea}` : ""}
        </p>
      ) : painStop ? (
        <p className="mt-1">
          The patient stopped the attempt for pain but did not submit the optional
          detail form.
        </p>
      ) : report.status === "declined" ? (
        <p className="mt-1">After the attempt: declined</p>
      ) : null}
    </div>
  );
}

const REVIEW_OPTIONS: Array<{
  label: TherapistReviewLabel;
  text: string;
}> = [
  { label: "agree", text: "Agree" },
  { label: "worse_than_score", text: "Form was worse" },
  { label: "better_than_score", text: "Form was better" },
];

function SessionReviewPanel({
  sessionId,
  reviews,
  score,
  scoreSource,
  onReviewed,
}: {
  sessionId: number;
  reviews: SessionReview[];
  score: number | null;
  scoreSource: "raw_rule_v1" | "hold_rule_v1" | null;
  onReviewed: () => Promise<void>;
}) {
  const [saving, setSaving] = useState<TherapistReviewLabel | null>(null);
  const [error, setError] = useState("");
  const latest = reviews.at(-1) ?? null;

  const submit = async (label: TherapistReviewLabel) => {
    setSaving(label);
    setError("");
    try {
      const response = await fetch(`/api/sessions/${sessionId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Could not save the clinician review.");
      }
      await onReviewed();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : "Could not save the clinician review.",
      );
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="rounded-lg border border-blue-100 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-800">Clinician score review</p>
          <p className="mt-1 text-gray-500">
            {score !== null
              ? `Rule score ${Math.round(score)}/100 (${scoreSource === "raw_rule_v1" ? "raw rep coverage" : "hold rule"}).`
              : "No sufficiently covered rule score is available."}
          </p>
        </div>
        {latest && (
          <span className="rounded-full bg-blue-100 px-2 py-1 font-medium text-blue-700">
            Latest: {REVIEW_OPTIONS.find((option) => option.label === latest.label)?.text}
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {REVIEW_OPTIONS.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={score === null || saving !== null}
            onClick={() => submit(option.label)}
            className="rounded-md border border-blue-200 px-2.5 py-1.5 font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving === option.label ? "Saving…" : option.text}
          </button>
        ))}
      </div>
      {reviews.length > 1 && (
        <p className="mt-2 text-gray-400">
          {reviews.length} append-only reviews retained for audit.
        </p>
      )}
      {error && <p className="mt-2 text-red-600">{error}</p>}
    </div>
  );
}

function SessionCaptureContext({ detail }: { detail: SessionDetail }) {
  const quality = detail.captureQuality;
  const device = detail.deviceContext;
  if (!quality && !device) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-500">
        Capture context is unavailable for this legacy session.
      </div>
    );
  }
  const captureClass =
    quality && quality.pctOk < 80 ? "text-amber-700" : "text-gray-700";
  // The tracking check's unsteady share, shown only when the points jumped.
  const unsteadyPct = unsteadyTrackingPct(quality);
  const unsteadyHigh = unsteadyPct !== null && unsteadyPct >= UNSTEADY_TRACKING_NOTE_PCT;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
      <span className="font-semibold text-gray-800">Capture context</span>
      {quality && (
        <span className={`ml-3 ${captureClass}`}>
          {quality.pctOk}% ready frames ({quality.framesOk}/{quality.framesTotal})
        </span>
      )}
      {unsteadyPct !== null && unsteadyPct > 0 && (
        <span className={`ml-3 ${unsteadyHigh ? "text-amber-700" : "text-gray-700"}`}>
          points unsteady on {unsteadyPct}% of tracked frames
        </span>
      )}
      {device && (
        <span className="ml-3 text-gray-500">
          {device.browser} · {device.platform}
        </span>
      )}
      {quality && quality.pctOk < 80 && (
        <p className="mt-1 text-amber-700">
          Reduced capture coverage may limit interpretation of this session.
        </p>
      )}
      {unsteadyHigh && (
        <p className="mt-1 text-amber-700">
          The camera kept losing track of points the exercise depends on, so readings from those moments, such as an
          arm&apos;s hold time, may be unreliable.
        </p>
      )}
    </div>
  );
}

// Fallback for sessions that have rep_events but no set_events: group reps by
// their set index and show a compact per-set summary.
function RepFallbackList({
  reps,
  prescribedSide,
}: {
  reps: SessionRepDetail[];
  prescribedSide: PrescribedSide;
}) {
  const bySet = new Map<number, SessionRepDetail[]>();
  for (const rep of reps) {
    const arr = bySet.get(rep.setIndex) ?? [];
    arr.push(rep);
    bySet.set(rep.setIndex, arr);
  }
  const setIndexes = Array.from(bySet.keys()).sort((a, b) => a - b);
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-400">No set records — reconstructed from reps.</p>
      {setIndexes.map((idx) => {
        const group = bySet.get(idx)!;
        const outcomeSides = prescribedOutcomeSides(prescribedSide);
        const outcomeReps = group.filter(
          (rep) =>
            rep.side !== "left" ||
            outcomeSides.includes("left"),
        ).filter(
          (rep) =>
            rep.side !== "right" ||
            outcomeSides.includes("right"),
        );
        const formScore = meanRawRuleScore(outcomeReps);
        return (
          <div key={idx} className="rounded-lg border border-gray-200 bg-white p-3 text-base">
            <span className="font-semibold text-gray-800">Set {idx}</span>{" "}
            <span className="text-gray-600">
              {outcomeSides.map((side) => {
                const sideReps = group.filter((rep) => rep.side === side);
                const complete = sideReps.filter(
                  (rep) => rep.classification === "complete",
                ).length;
                return `${sideLabel(side)} ${fullRomOutcomeText(
                  complete,
                  sideReps.length,
                )}`;
              }).join(" · ")}
              {formScore !== null ? ` · avg form ${formScore}/100` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function meanRawRuleScore(reps: SessionRepDetail[]): number | null {
  const scores = reps
    .map((rep) => {
      const rawRule = rep.compensations?.rawRule;
      return rawRule && rawRule.coveragePct >= 80 ? rawRule.meanScore : null;
    })
    .filter((score): score is number => typeof score === "number");
  if (scores.length === 0) return null;
  return Math.round(
    scores.reduce((sum, score) => sum + score, 0) / scores.length,
  );
}

function SetRow({
  set,
  reps,
  prescribedSide,
}: {
  set: SessionSetDetail;
  reps: SessionRepDetail[];
  prescribedSide: PrescribedSide;
}) {
  const isIso = set.exerciseKind === "isometric";
  const outcomeSides = prescribedOutcomeSides(prescribedSide);
  const outcomeReps = reps.filter(
    (rep) =>
      (rep.side !== "left" && rep.side !== "right") ||
      outcomeSides.includes(rep.side),
  );
  const formScore = isIso ? null : meanRawRuleScore(outcomeReps);
  const setRepsBySide = {
    left: set.leftReps,
    right: set.rightReps,
  };
  const holdMsBySide = {
    left:
      typeof set.holdQuality?.leftInBandMs === "number"
        ? set.holdQuality.leftInBandMs
        : set.pairedHoldMs,
    right:
      typeof set.holdQuality?.rightInBandMs === "number"
        ? set.holdQuality.rightInBandMs
        : set.pairedHoldMs,
  };
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-base">
        <span className="font-semibold text-gray-800">Set {set.setIndex}</span>
        {isIso ? (
          outcomeSides.map((side) => (
            <span key={side} className="text-gray-600">
              {sideLabel(side)} held {Math.round(holdMsBySide[side] / 1000)}s
              {set.targetHoldMs ? ` / ${Math.round(set.targetHoldMs / 1000)}s` : ""}
            </span>
          ))
        ) : (
          <>
            {outcomeSides.map((side) => {
              const complete = reps.filter(
                (rep) =>
                  rep.side === side && rep.classification === "complete",
              ).length;
              return (
                <span key={side} className="text-gray-600">
                  {sideLabel(side)}{" "}
                  {fullRomOutcomeText(complete, setRepsBySide[side])}
                </span>
              );
            })}
            {shouldShowOutcomeAsymmetry(prescribedSide) &&
              set.asymmetryIndex !== null && (
              <span className="text-gray-500">
                asymmetry {Math.round(set.asymmetryIndex * 100)}%
              </span>
            )}
            {formScore !== null && (
              <span className="text-gray-500">avg form {formScore}/100</span>
            )}
          </>
        )}
        <span className="text-gray-400 text-sm">ended: {set.terminatedBy}</span>
      </div>

      {/* Isometric hold-quality grid */}
      {isIso && set.holdQuality && (
        <HoldQualityGrid hq={set.holdQuality} prescribedSide={prescribedSide} />
      )}
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

function HoldQualityGrid({
  hq,
  prescribedSide,
}: {
  hq: HoldQuality;
  prescribedSide: PrescribedSide;
}) {
  const sideText = (s: HoldSideQuality | null) => {
    if (!s || typeof s !== "object") return "—";
    return `mean ${unit(s.meanDeg, 0, "")} · err ${unit(s.meanErrorDeg, 0, "")} · steadiness ${unit(s.sdDeg, 1, "")} · droop ${unit(s.droopSlopeDegPerSec, 2, "/s")}`;
  };
  const dropCount =
    typeof hq.dropCount === "number" && Number.isFinite(hq.dropCount) ? hq.dropCount : null;
  return (
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-600">
      {prescribedOutcomeSides(prescribedSide).map((side) => (
        <div key={side}>
          <span className="text-gray-400">{sideLabel(side)} arm:</span>{" "}
          {sideText(hq[side])}
        </div>
      ))}
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
      <div className="sm:col-span-2 text-gray-400">
        Arm angles are camera estimates, not degrees.
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

function PrinterIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v3h12V3z"/>
    </svg>
  );
}
