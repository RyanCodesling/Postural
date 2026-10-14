"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useDemoClock } from "@/lib/DemoClockContext";
import { useToast } from "@/lib/ToastContext";
import {
  FaceLandmarker,
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
  type Landmark,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

import { evaluateCaptureReadiness, type FramingMode } from "@/lib/pose/captureReadiness";
import { buildCaptureQualitySummary } from "@/lib/sessionReadModels";
import { drawCutoutOverlay } from "@/lib/pose/drawFramingOverlay";
import { drawCompensationOverlay, limbSideIsOverlayDirection, lowerArrowShoulder } from "@/lib/pose/drawCompensationOverlay";
import { captureCoachingProvenance, COACHING_TICK_MS, type CoachingProvenance } from "@/lib/pose/coachingConfig";
import { CoachingAuditBuffer, observeMovement, type CoachingObservation } from "@/lib/pose/coachingAudit";
import type { HoldQualityV2, HoldSideQuality, SetMeasurement } from "@/lib/pose/holdQuality";
import { roundFilteredMetric } from "@/lib/pose/metricPrecision";
import {
  computePoseMetricsForExercise,
  computeCompensationScore,
  computeTiltReference,
  isNearPeak,
  computeElbowFlexion,
  computeLateralNeckTilt,
  computeScapularElevation,
  computeShoulderAbduction,
  computeShoulderElbowDistance,
  computeShoulderSymmetry,
  computeTrunkLateralLean,
  hasMissingTiltReferenceLine,
  computeTrunkLateralFlexionFromNeutralSigned,
  computeTrunkLateralFlexionUncorrectedSigned,
  computeNeckLateralFlexionSigned,
  computeShoulderHorizAbduction,
  computeWristShoulderLateral,
  computeWristShoulderVertical,
  type ExerciseFrameMetrics,
  type TiltReference,
} from "@/lib/pose/poseMetrics";
import {
  cueClearLevel,
  cueTriggerLevel,
  updateCompensationWarningMap,
  type CompensationWarningLatch,
} from "@/lib/pose/compensationWarningState";
import {
  COACHING_SHADOW_SCHEMA,
  newCoachingCueState,
  resolveCoachingCue,
  resolveCoachingCueTiming,
  selectCoachingCue,
  type CoachingCueCandidate,
  type CoachingCueReason,
  type CoachingCueState,
} from "@/lib/pose/coachingCue";
import {
  shouldBlockCoachingShadowPlanAdvance,
  shouldBlockCoachingShadowPlanTransition,
} from "@/lib/pose/coachingShadowPlan";
import {
  coachingWarningSpecs,
  getCompensationScoring,
  getExerciseDefinition,
  type ExerciseDefinition,
  type MetricName,
} from "@/lib/exercises/registry";
import { DEPRECATED_EXERCISE_IDS } from "@/lib/exercises/deprecated";
import { demoClipFor } from "@/lib/exercises/demoClips";
import DemoClipPlayer from "./DemoClipPlayer";
import {
  compareActionableOccurrences,
  isOccurrenceActionable,
  removeActionableOccurrence,
  type OccurrenceStatus,
} from "@/lib/exercises/occurrences";
import { OneEuroFilter } from "@/lib/pose/oneEuroFilter";
import { RepCounter, type RepCounterOptions, type RepEvent } from "@/lib/pose/repCounter";
import {
  BidirectionalRepCounter,
  type BidirectionalRepCounterDebugSnapshot,
  type BidirectionalSide,
} from "@/lib/pose/bidirectionalRepCounter";
import { VelocityBidirectionalRepCounter } from "@/lib/pose/velocityBidirectionalRepCounter";
import {
  DynamicRepQualityBuffer,
  type DynamicRepQuality,
  type RepQualityChannel,
} from "@/lib/pose/repQuality";
import { POSE_METRIC_ALGORITHM_VERSION } from "@/lib/pose/metricVersion";
import {
  applyTraceSyncReadout,
  formatTraceSyncReadout,
  TRACE_SYNC_PAUSED,
  TRACE_SYNC_PLACEHOLDER,
} from "@/lib/pose/traceSyncClock";
import {
  recordTraceBatchLoss,
  traceUploadLossLabel,
  traceUploadLossToast,
  type TraceUploadLoss,
} from "@/lib/pose/traceUploadLoss";
import {
  NEUTRAL_CALIBRATION_DURATION_MS,
  NEUTRAL_CALIBRATION_MIN_SAMPLES,
  advanceNeutralCalibrationClock,
  frozenNeutralTiltReference,
  medianFinite,
  neutralCalibrationProgressPct,
  neutralCalibrationReady,
  newNeutralCalibrationClock,
  pauseNeutralCalibrationClock,
  type NeutralCalibrationClock,
} from "@/lib/pose/neutralCalibration";
import {
  perLimbCompensationWarningSignal,
  singleCompensationWarningSignal,
  type CompensationWarningSignal,
} from "@/lib/pose/compensationSignals";
import {
  newRepWindowState,
  repWindowCompensationWarningSignal,
  type RepWindowState,
} from "@/lib/pose/repWindowWarning";
import {
  hipShiftGeometry,
  newHipShiftState,
  updateHipShift,
  type HipShiftState,
} from "@/lib/pose/hipShiftWarning";
import {
  newElbowBendState,
  updateElbowBend,
  type ElbowBendState,
} from "@/lib/pose/elbowBendWarning";
import {
  NO_TRACKING_MESSAGE,
  addTrackingMark,
  newSteadinessState,
  repTracking,
  trackingMessage,
  trackingParts,
  trackingRegion,
  updateSteadiness,
  updateTrackingMessage,
  type SteadinessState,
  type TrackingFrameMark,
  type TrackingMessageState,
  type TrackingPart,
} from "@/lib/pose/trackingSteadiness";
import {
  EventOutbox,
  persistedOutboxSessionIds,
  recoverPersistedOutboxes,
} from "@/lib/pose/eventOutbox";
import {
  angleDeltaDegrees,
  faceOrientationDegrees,
  fixedFaceRoiFromPose,
  type FaceOrientationDegrees,
  type FixedFaceRoi,
} from "@/lib/pose/faceLandmarkerShadow";
import ReportButton from "../dashboard/_components/ReportButton";
import { SESSION_VIDEO_NOTICE, SESSION_VIDEO_NOTICE_VERSION } from "@/lib/recording/consent";
import { forgetVideoChoice, readVideoChoice, rememberVideoChoice } from "@/lib/recording/videoChoice";
import { SessionRecorder, type RecordingState } from "@/lib/recording/sessionRecorder";
import {
  formatResistanceContext,
  PRE_SESSION_PAIN_CAUTION_SCORE,
  type PainTiming,
  type PreSessionPain,
  type PrescribedSide,
  type ResistanceContext,
  type RuntimePrescription,
} from "@/lib/prescriptionContext";
import {
  ANGLE_ESTIMATE_LABEL,
  fullRomOutcomeText,
  prescribedOutcomeSides,
  shouldShowOutcomeAsymmetry,
  sideLabel,
} from "@/lib/sessionOutcomePresentation";

type CamDevice = MediaDeviceInfo;

type AssignmentStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "pain_stopped";
type EndSessionPersistenceResult =
  | "saved"
  | "partial"   // session row closed, but outcome events are still undelivered
  | "pending"
  | "skipped"
  | "failed";

interface Exercise {
  id: string;
  name: string;
  description: string;
  /**
   * Per-side rep target. Added 2026-05-22. For patient
   * assignments this comes from `patient_exercises.reps` via
   * `/api/patient-exercises`. For staff debug catalog (`/api/exercises`)
   * no prescription is attached, so a fallback of 12 is used.
   */
  reps: number;
  /**
   * Target number of sets. Same provenance pattern as `reps`. Fallback 3.
   */
  sets: number;
  /**
   * Rest between sets, in seconds. From `patient_exercises.rest_seconds`
   * for patient assignments; falls back to the default for the staff debug
   * catalog. Drives the hard-block rest countdown between sets.
   */
  restSeconds: number;
  /**
   * Per-side target hold duration, in seconds, for isometric exercises (e.g.
   * ex_006 T-pose). From `patient_exercises.hold_seconds`; falls back to the
   * default for the staff debug catalog. Dynamic exercises ignore it.
   */
  holdSeconds: number;
  /**
   * The `patient_exercises.id` this assignment came from. Present only for
   * patient assignments (from `/api/patient-exercises`); undefined for the
   * staff debug catalog. Used as the FK target when persisting a session — the
   * staff debug path has no row, so it skips session persistence entirely.
   */
  patientExerciseId?: number;
  /** Exact actionable schedule row represented by this queue item. */
  occurrenceId?: number;
  dueDate?: string;
  makeupUntil?: string;
  sequenceIndex?: number;
  /**
   * Assignment status from `patient_exercises.status` via
   * `/api/patient-exercises` (patient assignments only). Drives the
   * "already completed" recap overlay + stepper pill when the patient returns
   * to a finished exercise. Undefined for the staff debug catalog.
   */
  status?: AssignmentStatus;
  prescribedSide: PrescribedSide;
  resistance: ResistanceContext;
}

/**
 * The latest FINISHED session for an exercise, sourced from `/api/sessions`
 * (`getSessionsForPatient`). Used to populate the "already completed" recap
 * overlay when a patient returns to a finished exercise — the live in-memory
 * session summary is gone after the camera route unmounts, but this persisted
 * outcome survives. Per-side rep counts are kept separate (never summed —
 * preserves the asymmetry signal).
 */
type ExerciseSessionRecap = {
  sessionId: number | null;
  exerciseKind: "dynamic" | "isometric" | null;
  prescribedSide: PrescribedSide;
  endedAt: string | null;
  durationMs: number | null;
  setCount: number;
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
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function recordsField(data: unknown, field: string): JsonRecord[] {
  if (!isRecord(data) || !Array.isArray(data[field])) return [];
  return data[field].filter(isRecord);
}

function stringField(record: JsonRecord, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}

function numberField(record: JsonRecord, field: string): number | undefined {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integerField(record: JsonRecord, field: string): number | undefined {
  const value = numberField(record, field);
  return value !== undefined && Number.isInteger(value) ? value : undefined;
}

function assignmentStatus(value: unknown): AssignmentStatus | undefined {
  return value === "pending" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "pain_stopped"
    ? value
    : undefined;
}

function exerciseKind(value: unknown): ExerciseSessionRecap["exerciseKind"] {
  return value === "dynamic" || value === "isometric" ? value : null;
}

function getErrorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  if (isRecord(error) && typeof error.name === "string") return error.name;
  return "Error";
}

/**
 * Device-local snapshot of a live session's resumable state, written to
 * localStorage while a patient session runs. A disruption (tab close,
 * navigation, refresh, crash) never reaches the End button, so the current
 * partial set's reps and the live timer are otherwise lost — the DB keeps only
 * the open session row + completed-set rows. On return this snapshot restores
 * the counter, completed sets, and elapsed time so the SAME session can be
 * resumed. Counts/timings only — no video. Cleared on a deliberate End/finish.
 */
type ResumeSnapshot = {
  v: 1;
  sessionId: number;
  exerciseId: string;
  patientExerciseId: number;
  kind: "dynamic" | "isometric";
  completedSets: number;
  currentSetReps: { left: number; right: number };
  pairedHoldMs: number;
  /**
   * Per-side hold totals for the current set of a side-split isometric
   * (ex_004). Optional so snapshots written before the field existed still
   * parse; absent/zero for per-limb isometrics (which use pairedHoldMs).
   */
  sideHoldMs?: { left: number; right: number };
  // Session elapsed (ms) at write time — excludes any away-time, so the timer
  // resumes from where it stopped rather than from wall-clock-since-start.
  elapsedMs: number;
  // Session-wide rep index so reused sessions keep rep_events numbering contiguous.
  globalRepIndex: number;
  // Last raw-frame index (ex_007 traces) so a reused session does not restart
  // frame_index at 1 and collide with raw_frames' UNIQUE(session_id, frame_index).
  rawFrameIndex: number;
  updatedAtWallMs: number;
  /**
   * Outcomes counted before a disruption, so the end-of-session card and the
   * capture summary cover the whole attempt after Resume, not only the resumed
   * portion. Optional: snapshots written before these fields existed parse.
   */
  completedSetsLog?: CompletedSetRecord[];
  repOutcomes?: { left: RepOutcome[]; right: RepOutcome[] };
  captureFrames?: { total: number; ok: number; rejectedByStatus?: Record<string, number>; dropoutResets?: number; unsteady?: number; checked?: number };
  /** The patient opted in to video for this session and has not stopped it. */
  recordVideo?: boolean;
};

/** What the end-of-session card needs from each counted repetition. */
type RepOutcome = Pick<RepEvent, "peakValue" | "classification">;

// A resumable session older than this (by last snapshot write) is not offered —
// avoids resuming a days-old still-open session.
const RESUME_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

const RESUME_KEY_PREFIX = "postural.resume.v1.";

const resumeKey = (patientExerciseId: number) =>
  `${RESUME_KEY_PREFIX}${patientExerciseId}`;

/** Read + validate the resume snapshot for an assignment. Null if absent/invalid. */
function readResumeSnapshot(
  patientExerciseId: number | undefined,
): ResumeSnapshot | null {
  if (typeof patientExerciseId !== "number") return null;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(resumeKey(patientExerciseId));
    if (!raw) return null;
    const snap = JSON.parse(raw) as ResumeSnapshot;
    if (snap?.v !== 1 || typeof snap.sessionId !== "number") return null;
    return snap;
  } catch {
    return null;
  }
}

/**
 * The progress a snapshot carries from before a disruption. Validated so an
 * older or malformed snapshot restores nothing rather than wrong numbers.
 */
function restoredSessionProgress(snap: ResumeSnapshot): {
  setsLog: CompletedSetRecord[];
  repOutcomes: { left: RepOutcome[]; right: RepOutcome[] };
  captureFrames: { total: number; ok: number; rejectedByStatus: Record<string, number>; dropoutResets: number; unsteady: number; checked: number };
} {
  const count = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;
  const setsLog = Array.isArray(snap.completedSetsLog)
    ? snap.completedSetsLog.filter(
        (s) =>
          !!s &&
          count(s.setIndex) &&
          count(s.leftReps) &&
          count(s.rightReps) &&
          count(s.asymmetryIndex),
      )
    : [];
  const outcomes = (list: unknown): RepOutcome[] =>
    Array.isArray(list)
      ? list.flatMap((o: { peakValue?: unknown; classification?: unknown } | null) =>
          o &&
          typeof o.peakValue === "number" &&
          Number.isFinite(o.peakValue) &&
          (o.classification === "complete" || o.classification === "partial")
            ? [{ peakValue: o.peakValue, classification: o.classification }]
            : [],
        )
      : [];
  const frames = snap.captureFrames;
  // The rejection reasons and dropout resets came later; a snapshot without
  // them restores none.
  const rejected = frames?.rejectedByStatus;
  const rejectedByStatus =
    rejected && typeof rejected === "object" && !Array.isArray(rejected) &&
    Object.values(rejected).every(count)
      ? { ...rejected }
      : {};
  const captureFrames =
    frames && count(frames.total) && count(frames.ok) && frames.ok <= frames.total
      ? {
          total: frames.total,
          ok: frames.ok,
          rejectedByStatus,
          dropoutResets: count(frames.dropoutResets) ? frames.dropoutResets : 0,
          unsteady: count(frames.unsteady) && frames.unsteady <= frames.ok ? frames.unsteady : 0,
          checked: count(frames.checked) && frames.checked <= frames.ok ? frames.checked : 0,
        }
      : { total: 0, ok: 0, rejectedByStatus: {}, dropoutResets: 0, unsteady: 0, checked: 0 };
  return {
    setsLog,
    repOutcomes: {
      left: outcomes(snap.repOutcomes?.left),
      right: outcomes(snap.repOutcomes?.right),
    },
    captureFrames,
  };
}

/** Repetition outcomes for the whole attempt: restored ones, then this page's. */
function sessionRepOutcomes(
  prior: { left: RepOutcome[]; right: RepOutcome[] },
  log: { left: RepEvent[]; right: RepEvent[] },
): { left: RepOutcome[]; right: RepOutcome[] } {
  const pick = (e: RepEvent): RepOutcome => ({
    peakValue: e.peakValue,
    classification: e.classification,
  });
  return {
    left: [...prior.left, ...log.left.map(pick)],
    right: [...prior.right, ...log.right.map(pick)],
  };
}

function clearResumeSnapshot(patientExerciseId: number | undefined): void {
  if (typeof patientExerciseId !== "number") return;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(resumeKey(patientExerciseId));
  } catch {
    /* ignore */
  }
}

/**
 * Sessions a stored resume snapshot can still offer to resume, by the same age
 * rule as the resume prompt. Resuming re-adopts their queued outcome events, so
 * outbox recovery leaves them alone.
 */
function resumableSessionIds(storageKeys: string[]): Set<number> {
  const ids = new Set<number>();
  for (const key of storageKeys) {
    if (!key.startsWith(RESUME_KEY_PREFIX)) continue;
    const snap = readResumeSnapshot(Number(key.slice(RESUME_KEY_PREFIX.length)));
    if (snap && Date.now() - snap.updatedAtWallMs < RESUME_MAX_AGE_MS) {
      ids.add(snap.sessionId);
    }
  }
  return ids;
}

/**
 * Session lifecycle (added 2026-05-22). Drives whether the
 * rep counter ticks, whether the timer runs, and which Start/End controls
 * are enabled. Transitions:
 *   idle    → active : sidebar Start button (manual).
 *   active  → ended  : sidebar End button (manual) OR auto on
 *                      `completedSets >= targetSets`.
 *   ended   → idle   : exercise change OR sidebar Start again (restart).
 *
 * Distinct from the camera hardware Start/Stop in the header — the camera
 * can be running with the session in any state. Rep counting only happens
 * when the session is `active`.
 */
// "resting" = hard-block rest between sets: rep counting is suspended and a
// countdown is shown. Auto-entered after a completed set when sets remain and
// restSeconds > 0; auto-resumes to "active" when the countdown elapses.
type SessionState =
  | "idle"
  | "countdown"
  | "active"
  | "resting"
  | "reporting"
  | "ended";

/**
 * Session set summary. The live UI keeps a local log, and patient sessions also
 * persist this shape to `set_events` so timed isometric holds have a durable
 * clinical outcome. `pairedReps` / `asymmetryIndex` are tracked as placeholders
 * for now (paired-rep matching is not implemented yet).
 */
type CompletedSetRecord = {
  setIndex: number;
  targetReps: number;
  leftReps: number;
  rightReps: number;
  pairedReps: number;
  durationMs: number;
  terminatedBy:
    | "min_reached"
    | "user"
    | "pain"
    | "capture_lost"
    | "stall";
  asymmetryIndex: number;
  /**
   * Isometric-only: milliseconds of credited hold for this set, plus the
   * target. For a per-limb isometric (ex_006 T-pose) this is the time BOTH
   * arms were in the target band simultaneously. For a side-split isometric
   * (ex_004 — per-side holds attributed from the sign of one bidirectional
   * signal) this is min(leftHoldMs, rightHoldMs): the slower side gates
   * completion, so the min is the per-side hold credited toward the target.
   * Absent for dynamic (rep-counted) sets, where reps/pairedReps carry the
   * equivalent information.
   */
  pairedHoldMs?: number;
  targetHoldMs?: number;
  /**
   * Side-split isometric only (ex_004): the per-side hold totals behind the
   * `pairedHoldMs` min. Kept separate — NEVER summed — so the live recap can
   * surface the left/right asymmetry the min alone would hide. (The persisted
   * set event carries the same per-side detail via holdQuality left/right
   * inBandMs.)
   */
  leftHoldMs?: number;
  rightHoldMs?: number;
};

type Prescription = {
  sets: number;
  reps: number;
  restSeconds: number;
  holdSeconds: number;
  // patient_exercises.id for the current assignment; undefined for staff debug.
  patientExerciseId?: number;
  occurrenceId?: number;
  prescribedSide: PrescribedSide;
  resistance: ResistanceContext;
};

const DEFAULT_PRESCRIPTION: Prescription = {
  sets: 3,
  reps: 12,
  restSeconds: 60,
  holdSeconds: 30,
  prescribedSide: "both",
  resistance: { type: "none", value: null, unit: null, label: null },
};

/**
 * A counted rep shaped for the `rep_events` write API. Kept local (not imported
 * from the server-only db module) so this client bundle never pulls in `pg`.
 */
type RepEventPayload = {
  repIndex: number;
  setIndex: number;
  side: "left" | "right" | "both" | "bidirectional";
  peakValue: number;
  targetRom: number;
  timeToPeakMs: number;
  holdMs: number;
  descentMs: number;
  totalMs: number;
  classification: RepEvent["classification"];
  compensations: DynamicRepQuality;
  startTs: string;
  endTs: string;
};

type RawTraceLandmark = {
  x: number;
  y: number;
  z: number | null;
  visibility: number | null;
};

/**
 * One landmark from MediaPipe's SECOND output, `worldLandmarks`.
 *
 * The pose task emits two coordinate sets per frame. `landmarks` is normalized
 * to the image (x/width, y/height) with a depth estimate on roughly the same
 * scale; `worldLandmarks` is hip-centred in approximate metres and is the
 * better-conditioned of the two for FORWARD-BACKWARD position specifically.
 *
 * Neither is used by any metric — every scored value in this system is computed
 * in the image plane. This is recorded so that one question can be answered
 * offline from a session rather than by recording a second one: can either
 * depth signal separate sagittal faults (leaning back, slouching, an elbow
 * drifting off a wall) that the image plane cannot see at all?
 *
 * No `visibility` field: it carries the same value as the normalized landmark
 * at the same key, which is already stored, and duplicating it would grow every
 * row for nothing.
 */
type RawTraceWorldLandmark = {
  x: number;
  y: number;
  z: number;
};

/**
 * One retained neutral-calibration sample, as V4 persists it.
 *
 * The live baseline is a MEDIAN over these, so recomputing a baseline under any
 * changed measurement needs the samples themselves — a stored median cannot be
 * re-derived into a different coordinate convention.
 */
type CalibrationSample = {
  landmarks: Record<string, RawTraceLandmark | null>;
  observedCameraTiltDeg: number | null;
  confidence: TiltReference["confidence"];
};

/**
 * Raw per-frame metric payload for the tuning trace (`upper_body_v4`).
 * V3 kept the cross-exercise fields introduced by V2 and recorded both the
 * observed per-frame tilt diagnostic and the frozen effective correction.
 * The offline analysis can reproduce the values the live score sees:
 *   - scapularElevation as scored = baseline − raw (per side)
 *   - ex_005 primary as counted   = |uncorrected signed − bidirectional baseline|
 * All metric values are RAW/unsmoothed (pre One Euro), captured only on
 * capture-ready frames. No image/video data, ever.
 *
 * ── WHAT V4 ADDS, AND WHY ────────────────────────────────────────────────────
 *
 * Two things the app already knew and then discarded, each of which blocked a
 * later reanalysis of sessions that had already been recorded:
 *
 * 1. `frame` — the SOURCE FRAME SIZE. MediaPipe normalizes landmarks as
 *    `x / frameWidth` and `y / frameHeight`, so without the divisors a stored
 *    landmark cannot be returned to an isotropic space and no angle in the
 *    trace can be reinterpreted. Recovering it for the 2026-06 sessions meant
 *    reading the number off a screen recording of the app's own footer, which
 *    is not a repeatable analysis path. It is recorded PER FRAME rather than
 *    per session because the device picker can change resolution mid-session.
 *
 * 2. `calibration.samples` — the RETAINED NEUTRAL-CALIBRATION SAMPLES. The
 *    frozen tilt and every per-side baseline are medians over a ring of up to
 *    300 of these; V3 persisted only the resulting scalars and the sample
 *    COUNT. A median cannot be recomputed under a changed measurement, so the
 *    2026-06 sessions cannot have their baselines re-derived at all — the
 *    calibration frames mostly predate the first exported frame, and one set
 *    retained none. That is the blocker on re-fitting the four primary-coupled
 *    scoring constants. Emitted ONCE PER SET, on the first captured frame after
 *    calibration finalizes, rather than repeated on every frame.
 */
type UpperBodyTraceMetrics = {
  metricAlgorithmVersion: typeof POSE_METRIC_ALGORITHM_VERSION;
  exerciseId: string;
  wristShoulderVertical: { left: number | null; right: number | null };
  wristShoulderLateral: { left: number | null; right: number | null };
  shoulderAbductionDeg: { left: number | null; right: number | null };
  elbowFlexionDeg: { left: number | null; right: number | null };
  scapularElevationRaw: { left: number | null; right: number | null };
  shoulderElbowDistance: { left: number | null; right: number | null };
  shoulderHorizAbdDeg: { left: number | null; right: number | null };
  trunkLeanDeg: number | null;
  trunkLeanDirection: "left" | "right" | "center" | null;
  shoulderSymmetryDeg: number | null;
  elevatedShoulder: "left" | "right" | "level" | null;
  /** Abs ear-line tilt (deg) + side, as the neckTilt compensation reads it. */
  neckTiltDeg: number | null;
  neckTiltDirection: "left" | "right" | "center" | null;
  /** Signed ear-line angle (positive = patient's LEFT), pre-abs. */
  neckLateralFlexionSignedDeg: number | null;
  /** ex_005 signed head-lean, NOT camera-roll corrected (baseline domain). */
  trunkLateralFlexionUncorrectedSignedDeg: number | null;
  /** ex_005 signed head-lean relative to the captured neutral; null until captured. */
  trunkLateralFlexionFromNeutralSignedDeg: number | null;
  /**
   * In-session baseline snapshot (null until captured). `scap*` are the raw
   * resting projections (scored value = baseline − raw); `bidirectionalPrimary`
   * is ex_005's neutral hip-to-head lean in the uncorrected-signed domain.
   */
  baselines: {
    scapLeft: number | null;
    scapRight: number | null;
    bidirectionalPrimary: number | null;
  };
  baselinePhase: "not-needed" | "capturing" | "captured";
  tiltReference: {
    /** Frozen neutral correction used to derive every metric in this frame. */
    cameraTiltDeg: number;
    /** Per-frame hip/ear observation retained only for confidence analysis. */
    observedCameraTiltDeg: number;
    confidence: ExerciseFrameMetrics["tiltReference"]["confidence"];
    divergenceDeg: number | null;
  };
  calibration: {
    sampleCount: number;
    validElapsedMs: number;
    frozenCameraTiltDeg: number;
    /**
     * V4. Present on exactly ONE frame per set — the first captured frame after
     * calibration finalizes — and absent on every other frame. Consumers must
     * therefore scan a set for the frame that carries it rather than expecting
     * it per frame.
     */
    samples?: CalibrationSample[];
  };
  /**
   * V4. Source frame size the landmarks in THIS frame were normalized against.
   * Null when the video element has not reported a size yet.
   */
  frame: { width: number; height: number } | null;
  /**
   * V4. The same ten points from MediaPipe's `worldLandmarks` output, or null
   * when the pose task did not emit them for this frame.
   *
   * It lives in the METRICS envelope rather than beside `landmarks` on the
   * payload for a mechanical reason: the write route allowlists the columns it
   * persists, so an unrecognised top-level key is dropped without an error.
   * `metrics` is stored whole, and V4 already carries landmark data inside it
   * (`calibration.samples`), so this is consistent rather than a special case.
   *
   * Non-optional: an absent depth channel must be an explicit null, not a
   * missing key, or a reprocessing months later cannot tell "not recorded"
   * from "not detected".
   */
  worldLandmarks: Record<string, RawTraceWorldLandmark | null> | null;
};

/**
 * One raw metric-only frame shaped for the `/raw-frames` write API. The
 * landmark payload is deliberately limited to upper-body analysis points plus
 * hips (needed for the trunk-relative coordinate frame); no image/video data.
 * Existing V1/V2/V3 rows remain in the table; this client writes V4.
 */
type RawFramePayload = {
  frameIndex: number;
  setIndex: number;
  elapsedMs: number;
  capturedAt: string;
  traceKind: "upper_body_v4";
  metrics: UpperBodyTraceMetrics;
  landmarks: Record<string, RawTraceLandmark | null>;
};

/**
 * Per-arm hold-quality stats for one isometric set, all derived from the RAW
 * per-side angle sampled each frame (time-weighted by frame dt):
 *  - `meanDeg`             — average held angle
 *  - `sdDeg`               — steadiness (higher = shakier); RELATIVE — includes
 *                            MediaPipe's ~3° landmark noise floor, not pure tremor
 *  - `meanErrorDeg`        — mean − target band center (negative = below target / sag)
 *  - `droopSlopeDegPerSec` — slope of angle vs time (negative = progressive sag / fatigue)
 */
// Contract types and validation live in holdQuality.ts; legacy field names
// remain readable. Their angle values are pipeline units, not anatomical ROM.

/**
 * A set-level outcome shaped for the `set_events` write API. This is what makes
 * ex_006 hold completions queryable even though no counted reps are emitted.
 */
type SetEventPayload = {
  setIndex: number;
  exerciseKind: ExerciseDefinition["kind"];
  targetReps: number;
  leftReps: number;
  rightReps: number;
  pairedReps: number;
  targetHoldMs: number;
  pairedHoldMs: number;
  durationMs: number;
  terminatedBy: CompletedSetRecord["terminatedBy"];
  asymmetryIndex: number;
  // Existing JSONB envelope: hold statistics or a dynamic-set coaching audit.
  holdQuality?: SetMeasurement;
  startTs: string;
  endTs: string;
};

// Max dt (ms) credited to an isometric hold in a single accumulation frame.
// Caps the time added after a brief not-ready flicker so a gap can't dump a
// large chunk into the accumulator; normal frames (~33–50 ms at 20–30 fps) are
// well under it.
const MAX_ISO_TICK_MS = 250;

type RepCounterSet = {
  left: RepCounter | null;
  right: RepCounter | null;
  bidirectional: BidirectionalCounter | null;
};

type BidirectionalCounter =
  | BidirectionalRepCounter
  | VelocityBidirectionalRepCounter;

/**
 * An isometric exercise whose hold is split by the SIGN of one bidirectional
 * primary signal (ex_004 neck lateral flexion: positive = patient's LEFT per
 * the pinned sign convention) rather than by per-limb landmarks (ex_006).
 * Hold time accrues per side — left while the signed angle sits inside
 * [center−tol, center+tol], right while inside [−center−tol, −center+tol] —
 * and a set completes only when BOTH sides reach the prescribed hold (the
 * slower side gates, preserving the asymmetry signal).
 */
function isSideSplitIsometric(def: ExerciseDefinition | null): boolean {
  return (
    def !== null &&
    def.kind === "isometric" &&
    def.bilateral &&
    def.bilateralMode === "bidirectional-alternating"
  );
}

function createRepCountersForDefinition(
  def: ExerciseDefinition | null,
): RepCounterSet {
  const empty: RepCounterSet = {
    left: null,
    right: null,
    bidirectional: null,
  };
  if (!def || def.kind !== "dynamic") return empty;

  const thresholds = def.primaryMetric.thresholds;
  const options: RepCounterOptions =
    def.primaryMetric.descentEpsilon !== undefined
      ? { descentEpsilon: def.primaryMetric.descentEpsilon }
      : {};

  if (def.bilateral && def.bilateralMode === "per-limb") {
    return {
      left: new RepCounter(thresholds, options),
      right: new RepCounter(thresholds, options),
      bidirectional: null,
    };
  }

  if (def.bilateral && def.bilateralMode === "bidirectional-alternating") {
    const bidirectional =
      def.bidirectionalRepStrategy === "velocity-zero-crossing"
        ? new VelocityBidirectionalRepCounter(thresholds, options)
        : new BidirectionalRepCounter(thresholds, options);
    return {
      left: null,
      right: null,
      bidirectional,
    };
  }

  return {
    left: new RepCounter(thresholds, options),
    right: null,
    bidirectional: null,
  };
}

type NeckRepDebugRecord = {
  seq: number;
  tMs: number;
  elapsedMs: number;
  exerciseId: string;
  signedDeg: number;
  absDeg: number;
  before: BidirectionalRepCounterDebugSnapshot;
  after: BidirectionalRepCounterDebugSnapshot;
  blockedBySettleGate: boolean;
  gateReleasedThisFrame: boolean;
  emitted: {
    side: BidirectionalSide;
    index: number;
    peakValue: number;
    classification: RepEvent["classification"];
    endTimeMs: number;
  } | null;
  counts: { left: number; right: number };
};

type NeckRepDebugDump = {
  generatedAt: string;
  recordCount: number;
  records: NeckRepDebugRecord[];
};

/**
 * One logged coaching-cue arbitration decision.
 *
 * Written only while the staff-only coaching shadow mode is on. The selector
 * itself runs regardless — shadow mode adds the recording, it does not change
 * which cue the patient sees. Nothing here is persisted or transmitted; the
 * ring lives in memory until it is exported to a local file or dropped.
 */
/**
 * What the operator was TRYING to do during a labelled segment.
 *
 * This is the one thing the selector cannot infer and the log cannot recover
 * afterwards: a quiet tick looks identical whether the movement was clean, the
 * patient was resting, or a cue was suppressed. Recording intent at capture
 * time is what makes a false-positive rate computable instead of guessed.
 */
type CoachingShadowIntent = "clean" | "faulty" | "transition";

type CoachingShadowRecord = {
  seq: number;
  /** `performance.now()` at the decision, matching every other camera clock. */
  tMs: number;
  /** Milliseconds since shadow recording was switched on. */
  tShadowMs: number;
  /** Wall clock, for lining a session up against an external observation log. */
  wallIso: string;
  exerciseId: string;
  prescribedSide: PrescribedSide;
  // ── Readiness / calibration context. A decision is only interpretable
  // alongside the gates that were open when it was made.
  sessionState: SessionState;
  captureOk: boolean;
  captureMessage: string;
  baselinePhase: "not-needed" | "capturing" | "captured";
  frozenTiltDeg: number | null;
  tiltConfidence: TiltReference["confidence"];
  nearPeak: boolean;
  // ── Selector input and output.
  activeLatches: MetricName[];
  suppressedMetrics: MetricName[];
  // ── Operator-declared ground truth. Free-text label (a capture or segment
  // id) plus what the movement was meant to be. Both are whatever was set when
  // the record was written, so a mid-capture segment change splits cleanly.
  segmentLabel: string | null;
  segmentIntent: CoachingShadowIntent;
  selectedCueId: string | null;
  selectedMetric: MetricName | null;
  /**
   * The cue's registry wording at the moment of the decision. Recorded even
   * though it is not rendered. This legacy diagnostic export stays readable;
   * session/set audit envelopes separately fingerprint the executing config.
   */
  selectedMessage: string | null;
  reason: CoachingCueReason;
  displayedForMs: number | null;
  clearedCueId: string | null;
  /** Every latched warning the selector ranked, plus its anatomical side. */
  candidates: (CoachingCueCandidate & { side: "left" | "right" | null })[];
};

/**
 * Export envelope for the coaching shadow log.
 *
 * `droppedRecords` is why this is a file download rather than a clipboard copy:
 * the ring is finite, and an export that silently omitted its overflow would
 * repeat the failure recorded against the Face diagnostic export. `records`
 * always contains the ENTIRE retained ring — it is never truncated further at
 * export time — and `droppedRecords` states exactly how many older decisions
 * the ring discarded.
 */
type CoachingShadowExport = {
  schema: typeof COACHING_SHADOW_SCHEMA;
  generatedAt: string;
  /**
   * Every exercise represented in `records`, in first-seen order. The ring is
   * not cleared on an exercise change, so one export can legitimately span
   * several exercises; a single `exerciseId` here would have labelled such a
   * file as whichever exercise happened to be last.
   */
  exerciseIds: string[];
  mixedExercises: boolean;
  /**
   * The cue configuration in force at export time, for every exercise in
   * `exerciseIds`: ids, wording, priority, and the EFFECTIVE timing after the
   * module defaults are applied. Read from the registry when the file is
   * written, so it describes the configuration that produced these decisions
   * only while the registry is unchanged — this is a diagnostic snapshot, not
   * a persisted configuration version. Session/set coaching provenance is
   * recorded separately from this legacy diagnostic export.
   */
  cueConfiguration: {
    exerciseId: string;
    metric: MetricName;
    cueId: string;
    message: string;
    priority: number;
    minActiveMs: number;
    minDisplayMs: number;
    cooldownMs: number;
  }[];
  /**
   * Derived index of the operator-declared segments in `records`, in the order
   * they occurred, so analysis does not have to re-group by hand. A segment
   * breaks whenever the label or the intent changes.
   */
  segments: {
    label: string | null;
    intent: CoachingShadowIntent;
    firstSeq: number;
    lastSeq: number;
    startMs: number;
    endMs: number;
    durationMs: number;
    recordCount: number;
    cueActiveRecords: number;
  }[];
  ringCapacity: number;
  recordCount: number;
  droppedRecords: number;
  notes: string[];
  records: CoachingShadowRecord[];
};

/**
 * One planned step of the live-verification session.
 *
 * The protocol asks the operator to declare a label and an intent before every
 * segment. Typing those by hand mid-session is the step most likely to be
 * skipped or mistyped, and a mislabelled segment is only discovered during
 * analysis when it is too late to redo. This table pre-writes them.
 *
 * It deliberately does NOT drive the session lifecycle. Stop/Start stays manual
 * so the proven session state machine is untouched by anything added here —
 * `startsCapture` only tells the panel to remind the operator to do it.
 */
type CoachingSessionStep = {
  captureId: string;
  exerciseId: string;
  label: string;
  intent: CoachingShadowIntent;
  hint: string;
  /** First step of a capture: Stop/Start, confirm the reset, clear the buffer. */
  startsCapture?: boolean;
};

/**
 * The twelve captures of protocol v2.3, expanded into labelled segments.
 *
 * Every capture opens with a `transition` step so the interval between baseline
 * capture and the first deliberate movement is excluded from both the clean and
 * the faulty counts instead of polluting one of them.
 */
const COACHING_SESSION_PLAN: readonly CoachingSessionStep[] = [
  { captureId: "A1", exerciseId: "ex_001", label: "A1-setup", intent: "transition", hint: "Settle into position. Nothing recorded as clean or faulty yet.", startsCapture: true },
  { captureId: "A1", exerciseId: "ex_001", label: "A1-clean", intent: "clean", hint: "8 deliberately clean lateral raises. Expect no cue at all." },

  { captureId: "A2", exerciseId: "ex_001", label: "A2-setup", intent: "transition", hint: "New capture. Stop/Start, confirm set 1 / 0 reps / baseline captured, clear the buffer.", startsCapture: true },
  { captureId: "A2", exerciseId: "ex_001", label: "A2-trunk", intent: "faulty", hint: "3 reps: SHIFT the torso sideways, do not tip. Keep the shoulder line level with the floor and let your head travel with the torso." },
  { captureId: "A2", exerciseId: "ex_001", label: "A2-shrug", intent: "faulty", hint: "3 reps: shrug BOTH shoulders equally. A one-sided shrug also trips shoulderSymmetry." },
  { captureId: "A2", exerciseId: "ex_001", label: "A2-asymmetry", intent: "faulty", hint: "3 reps RAISING one shoulder. Scapular will almost certainly co-fire and outranks symmetry here — symmetry appearing as a ranked candidate is enough." },

  { captureId: "A3", exerciseId: "ex_001", label: "A3-setup", intent: "transition", hint: "New capture. Stop/Start, confirm reset, clear.", startsCapture: true },
  { captureId: "A3", exerciseId: "ex_001", label: "A3-shrug", intent: "faulty", hint: "Reps 1-2 of 8: establish a shrug, hold until its cue appears." },
  { captureId: "A3", exerciseId: "ex_001", label: "A3-both", intent: "faulty", hint: "Reps 3-5 of 8: add trunk lean, keep the shrug. Watch the switch." },
  { captureId: "A3", exerciseId: "ex_001", label: "A3-trunk-corrected", intent: "faulty", hint: "Reps 6-8 of 8: correct the trunk lean only. Shrug should return on the same tick." },

  { captureId: "B1", exerciseId: "ex_006", label: "B1-setup", intent: "transition", hint: "New capture on ex_006. Stop/Start, confirm reset, clear.", startsCapture: true },
  { captureId: "B1", exerciseId: "ex_006", label: "B1-clean", intent: "clean", hint: "One clean T-pose hold, about 20 s. Expect silence." },

  { captureId: "B2", exerciseId: "ex_006", label: "B2-setup", intent: "transition", hint: "New capture. Stop/Start, confirm reset, clear.", startsCapture: true },
  { captureId: "B2", exerciseId: "ex_006", label: "B2-shrug", intent: "faulty", hint: "Hold, then shrug ONE shoulder upward. Not dropping the other." },
  // `transition`, not `clean`: this window opens the instant the fault is
  // corrected, so it necessarily contains the cue's legitimate clear latency.
  // Counting that as clean-window cue activity would inflate the false-positive
  // figure with correct behaviour.
  { captureId: "B2", exerciseId: "ex_006", label: "B2-corrected", intent: "transition", hint: "Correct it and hold on for the rest of the 25 s. Recovery window, counted as neither clean nor faulty." },

  { captureId: "C1", exerciseId: "ex_008", label: "C1-setup", intent: "transition", hint: "New capture on ex_008. Stop/Start, confirm reset, clear.", startsCapture: true },
  { captureId: "C1", exerciseId: "ex_008", label: "C1-normal-tempo", intent: "faulty", hint: "5 bent-elbow reps at normal tempo. Silence here is a result, not a failure." },
  { captureId: "C1", exerciseId: "ex_008", label: "C1-slow-tempo", intent: "faulty", hint: "5 slow reps, pausing at the top." },

  { captureId: "C2", exerciseId: "ex_008", label: "C2-setup", intent: "transition", hint: "New capture. Stop/Start, confirm reset, clear.", startsCapture: true },
  { captureId: "C2", exerciseId: "ex_008", label: "C2-asymmetric", intent: "faulty", hint: "6 reps: one arm straight and high, the other bent and lower." },

  { captureId: "C3", exerciseId: "ex_007", label: "C3-setup", intent: "transition", hint: "New capture on ex_007. Stop/Start, confirm reset, clear.", startsCapture: true },
  { captureId: "C3", exerciseId: "ex_007", label: "C3-slow", intent: "faulty", hint: "5 slow bent-elbow presses." },
  { captureId: "C3", exerciseId: "ex_007", label: "C3-asymmetric", intent: "faulty", hint: "5 asymmetric presses." },

  { captureId: "D1", exerciseId: "ex_005", label: "D1-setup", intent: "transition", hint: "New capture on ex_005. Stop/Start, confirm reset, clear.", startsCapture: true },
  // Split by direction: side attribution is the observation under test here, so
  // one combined label would make it unrecoverable from the JSON.
  { captureId: "D1", exerciseId: "ex_005", label: "D1-clean-left", intent: "clean", hint: "2 clean bends to the LEFT." },
  { captureId: "D1", exerciseId: "ex_005", label: "D1-clean-right", intent: "clean", hint: "2 clean bends to the RIGHT." },
  { captureId: "D1", exerciseId: "ex_005", label: "D1-head-led-left", intent: "faulty", hint: "2 head-led bends to the LEFT." },
  { captureId: "D1", exerciseId: "ex_005", label: "D1-head-led-right", intent: "faulty", hint: "2 head-led bends to the RIGHT." },

  { captureId: "E1", exerciseId: "ex_001", label: "E1-setup", intent: "transition", hint: "New capture on ex_001. Stop/Start, confirm reset, clear.", startsCapture: true },
  { captureId: "E1", exerciseId: "ex_001", label: "E1-ex001", intent: "faulty", hint: "3 reps with a fault. Then switch to ex_006 and press Start again — do NOT clear the buffer." },
  { captureId: "E1", exerciseId: "ex_006", label: "E1-ex006", intent: "faulty", hint: "After Start and recalibration: 15 s hold with a fault. Then export WITHOUT clearing." },

  { captureId: "E2", exerciseId: "ex_001", label: "E2-setup", intent: "transition", hint: "New capture. Select ex_001, Stop/Start, confirm reset, clear.", startsCapture: true },
  { captureId: "E2", exerciseId: "ex_001", label: "E2-pre-reset", intent: "faulty", hint: "Short A3-style sequence as the pre-reset reference. Note what happened." },
  { captureId: "E2", exerciseId: "ex_001", label: "E2-post-reset", intent: "faulty", hint: "After recalibrating: the SAME sequence again. Compare against pre-reset." },
  // Separate label: recalibration evidence and dropout evidence answer different
  // questions and must be separable in the export.
  { captureId: "E2", exerciseId: "ex_001", label: "E2-dropout", intent: "faulty", hint: "Get a cue active, step out of frame until capture drops, step back. Then export." },
];

/**
 * Ring capacity for the shadow log. The selector runs on the 150 ms metrics
 * tick, so this retains roughly 12 minutes of continuous decisions. Overflow is
 * counted and reported in the export rather than hidden.
 */
const COACHING_SHADOW_RING_LIMIT = 5000;

/**
 * How many automated checks the export runs: ring overflow, unlabelled records,
 * all-transition capture, wrong-exercise segments, mixed captures, missing
 * planned segments, and implausibly thin segments.
 *
 * Reported to the operator so a clean result never reads as a blanket "valid".
 * These checks do NOT confirm that a session was reset, that the movement was
 * performed correctly, or that the segments were declared at the right moment.
 * The protocol's manual checks remain required, not optional.
 */
const COACHING_SHADOW_CHECKS_RUN = 7;

type Ex004FaceShadowModelState =
  | "disabled"
  | "waiting"
  | "loading"
  | "ready"
  | "error";

type Ex004FaceShadowFrameStatus =
  | "model-not-ready"
  | "roi-unavailable"
  | "detected"
  | "no-face"
  | "multiple-faces"
  | "invalid-matrix"
  | "inference-error";

type Ex004FaceShadowPhase =
  | "neutral"
  | "yaw-left"
  | "yaw-right"
  | "pitch-up"
  | "pitch-down"
  | "lateral-left"
  | "lateral-right"
  | "mixed"
  | "assisted-left"
  | "assisted-right"
  | "other";

type Ex004FaceShadowMark = {
  version: "ex004_face_shadow_mark_v2";
  seq: number;
  tMs: number;
  elapsedMs: number;
  kind: "phase" | "reference";
  phase: Ex004FaceShadowPhase;
  referenceAngleDeg: number | null;
  note: string | null;
};

type Ex004FaceShadowRecord = {
  version: "ex004_face_shadow_v2";
  seq: number;
  tMs: number;
  elapsedMs: number;
  trialPhase: Ex004FaceShadowPhase;
  sessionState: SessionState;
  baselinePhase: "not-needed" | "capturing" | "captured";
  modelState: Ex004FaceShadowModelState;
  status: Ex004FaceShadowFrameStatus;
  faceCount: number | null;
  matrixCount: number | null;
  roi: FixedFaceRoi | null;
  poseSignedDeg: number | null;
  faceRawRollDeg: number | null;
  faceRawYawDeg: number | null;
  faceRawPitchDeg: number | null;
  faceBaselineRollDeg: number | null;
  faceBaselineYawDeg: number | null;
  faceBaselinePitchDeg: number | null;
  faceSignedDeg: number | null;
  faceYawDeltaDeg: number | null;
  facePitchDeltaDeg: number | null;
  faceMinusPoseDeg: number | null;
  inferenceMs: number | null;
  authoritativeSource: "pose";
};

type Ex004FaceShadowDump = {
  version: "ex004_face_shadow_dump_v2";
  generatedAt: string;
  enabled: boolean;
  modelState: Ex004FaceShadowModelState;
  modelAssetPath: "/models/face_landmarker.task";
  authoritativeSource: "pose";
  attemptedFrames: number;
  detectedFrames: number;
  coverage: number | null;
  currentPhase: Ex004FaceShadowPhase;
  faceBaselineRollDeg: number | null;
  faceBaselineYawDeg: number | null;
  faceBaselinePitchDeg: number | null;
  roi: FixedFaceRoi | null;
  markCount: number;
  marks: Ex004FaceShadowMark[];
  recordCount: number;
  records: Ex004FaceShadowRecord[];
};

type Ex004FaceShadowInference = {
  status: Ex004FaceShadowFrameStatus;
  faceCount: number | null;
  matrixCount: number | null;
  rawOrientation: FaceOrientationDegrees | null;
  inferenceMs: number | null;
};

type Ex004FaceShadowLive = {
  status: Ex004FaceShadowFrameStatus | null;
  poseSignedDeg: number | null;
  faceSignedDeg: number | null;
  faceYawDeltaDeg: number | null;
  facePitchDeltaDeg: number | null;
  faceMinusPoseDeg: number | null;
  inferenceMs: number | null;
  attemptedFrames: number;
  detectedFrames: number;
};

type Ex005DebugLandmark = {
  x: number | null;
  y: number | null;
  visibility: number | null;
  inFrame: boolean;
};

type Ex005DebugPoint = {
  x: number | null;
  y: number | null;
};

type Ex005DebugRecord = {
  seq: number;
  kind: "frame" | "not-ready" | "rep";
  tMs: number;
  elapsedMs: number;
  exerciseId: "ex_005";
  sessionState: SessionState;
  capture: {
    ok: boolean;
    message: string | null;
    framingMode: FramingMode;
  };
  metric: {
    rawSignedDeg: number | null;
    smoothedSignedDeg: number | null;
    uncorrectedHeadLeanDeg: number | null;
    neutralBaselineDeg: number | null;
    perFrameCorrectedSignedDeg: number | null;
    absDeg: number | null;
    screenDirection: "image-left" | "image-right" | "center" | "unknown";
    counterSide: BidirectionalSide | "neutral" | "unknown";
    signConvention: "positive signed angle -> counter left";
  };
  tilt: {
    cameraTiltDeg: number | null;
    confidence: "high" | "low" | "insufficient" | null;
    divergenceDeg: number | null;
    hipLineDeg: number | null;
    earLineDeg: number | null;
  };
  landmarks: {
    leftEar: Ex005DebugLandmark;
    rightEar: Ex005DebugLandmark;
    leftHip: Ex005DebugLandmark;
    rightHip: Ex005DebugLandmark;
    earMid: Ex005DebugPoint;
    hipMid: Ex005DebugPoint;
    headOffsetX: number | null;
  };
  counter: {
    before: BidirectionalRepCounterDebugSnapshot | null;
    after: BidirectionalRepCounterDebugSnapshot | null;
  };
  emitted: {
    side: BidirectionalSide;
    index: number;
    peakValue: number;
    classification: RepEvent["classification"];
  } | null;
  counts: { left: number; right: number };
};

type Ex005DebugDump = {
  generatedAt: string;
  enabled: boolean;
  recordCount: number;
  records: Ex005DebugRecord[];
};

declare global {
  interface Window {
    __neckRepDebug?: NeckRepDebugRecord[];
    dumpNeckRepDebug?: (limit?: number) => string;
    clearNeckRepDebug?: () => void;
    __ex005Debug?: Ex005DebugRecord[];
    enableEx005Debug?: () => void;
    disableEx005Debug?: () => void;
    clearEx005Debug?: () => void;
    dumpEx005Debug?: (limit?: number) => string;
    __ex004FaceShadow?: Ex004FaceShadowRecord[];
    enableEx004FaceShadow?: () => void;
    disableEx004FaceShadow?: () => void;
    clearEx004FaceShadow?: () => void;
    dumpEx004FaceShadow?: (limit?: number) => string;
    setEx004FaceShadowPhase?: (phase: Ex004FaceShadowPhase) => boolean;
    markEx004FaceShadowReference?: (
      angleDeg: number,
      note?: string,
    ) => boolean;
  }
}

const MAX_NECK_REP_DEBUG_RECORDS = 3000;
const MAX_EX005_DEBUG_RECORDS = 2000;
const MAX_EX004_FACE_SHADOW_RECORDS = 3000;
const MAX_EX004_FACE_SHADOW_MARKS = 300;
const EX005_DEBUG_THROTTLE_MS = 250;
const EX004_FACE_SHADOW_UI_THROTTLE_MS = 250;
const EX004_FACE_SHADOW_INFERENCE_INTERVAL_MS = 200;
const EX004_FACE_SHADOW_MODEL_PATH = "/models/face_landmarker.task" as const;
const EX004_FACE_SHADOW_MIN_BASELINE_SAMPLES = 10;
const EX004_FACE_SHADOW_PHASE_OPTIONS: readonly {
  value: Ex004FaceShadowPhase;
  label: string;
}[] = [
  { value: "neutral", label: "Neutral" },
  { value: "yaw-left", label: "Yaw left" },
  { value: "yaw-right", label: "Yaw right" },
  { value: "pitch-up", label: "Pitch up" },
  { value: "pitch-down", label: "Pitch down" },
  { value: "lateral-left", label: "Lateral left" },
  { value: "lateral-right", label: "Lateral right" },
  { value: "mixed", label: "Mixed axes" },
  { value: "assisted-left", label: "Assisted left" },
  { value: "assisted-right", label: "Assisted right" },
  { value: "other", label: "Other" },
];

function isEx004FaceShadowPhase(value: string): value is Ex004FaceShadowPhase {
  return EX004_FACE_SHADOW_PHASE_OPTIONS.some((option) => option.value === value);
}

function isEx004FaceShadowAttempt(
  status: Ex004FaceShadowFrameStatus,
): boolean {
  return (
    status === "detected" ||
    status === "no-face" ||
    status === "multiple-faces" ||
    status === "invalid-matrix" ||
    status === "inference-error"
  );
}
const RAW_FRAME_UPLOAD_BATCH_SIZE = 120;
// Tuning traces are retried a few times and then given up on — see flushRawFrames.
const RAW_FRAME_UPLOAD_ATTEMPTS = 3;
const RAW_FRAME_RETRY_BASE_MS = 500;
// How long session end waits for queued reps/sets before reporting "partial".
const SESSION_END_DRAIN_TIMEOUT_MS = 6000;
const CAPTURE_READINESS_RESET_GRACE_MS = 300;

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function traceLandmark(
  landmark: NormalizedLandmark | undefined,
): RawTraceLandmark | null {
  const x = finiteNumberOrNull(landmark?.x);
  const y = finiteNumberOrNull(landmark?.y);
  if (x === null || y === null) return null;
  return {
    x,
    y,
    z: finiteNumberOrNull(landmark?.z),
    visibility: finiteNumberOrNull(landmark?.visibility),
  };
}

/**
 * Serialize one `worldLandmarks` entry. Unlike `traceLandmark` this requires a
 * finite z: a world landmark whose depth is unusable carries no information for
 * the only question this channel exists to answer, so it is stored as null
 * rather than as a point with a hole in it.
 */
function traceWorldLandmark(
  landmark: Landmark | undefined,
): RawTraceWorldLandmark | null {
  const x = finiteNumberOrNull(landmark?.x);
  const y = finiteNumberOrNull(landmark?.y);
  const z = finiteNumberOrNull(landmark?.z);
  if (x === null || y === null || z === null) return null;
  return { x, y, z };
}

/**
 * The same ten indices as `upperBodyTraceLandmarks`, from the world-coordinate
 * output. Kept deliberately in lockstep with that function: a depth channel for
 * a point whose image-plane position was not retained could not be compared
 * against anything.
 */
function upperBodyTraceWorldLandmarks(
  worldLandmarks: Landmark[] | undefined,
): Record<string, RawTraceWorldLandmark | null> | null {
  if (!worldLandmarks || worldLandmarks.length === 0) return null;
  return {
    leftEar:       traceWorldLandmark(worldLandmarks[7]),
    rightEar:      traceWorldLandmark(worldLandmarks[8]),
    leftShoulder:  traceWorldLandmark(worldLandmarks[11]),
    rightShoulder: traceWorldLandmark(worldLandmarks[12]),
    leftElbow:     traceWorldLandmark(worldLandmarks[13]),
    rightElbow:    traceWorldLandmark(worldLandmarks[14]),
    leftWrist:     traceWorldLandmark(worldLandmarks[15]),
    rightWrist:    traceWorldLandmark(worldLandmarks[16]),
    leftHip:       traceWorldLandmark(worldLandmarks[23]),
    rightHip:      traceWorldLandmark(worldLandmarks[24]),
  };
}

function upperBodyTraceLandmarks(landmarks: NormalizedLandmark[]) {
  return {
    leftEar:       traceLandmark(landmarks[7]),
    rightEar:      traceLandmark(landmarks[8]),
    leftShoulder:  traceLandmark(landmarks[11]),
    rightShoulder: traceLandmark(landmarks[12]),
    leftElbow:     traceLandmark(landmarks[13]),
    rightElbow:    traceLandmark(landmarks[14]),
    leftWrist:     traceLandmark(landmarks[15]),
    rightWrist:    traceLandmark(landmarks[16]),
    leftHip:       traceLandmark(landmarks[23]),
    rightHip:      traceLandmark(landmarks[24]),
  };
}

function upperBodyTraceMetrics(
  landmarks: NormalizedLandmark[],
  raw: ExerciseFrameMetrics,
  observedTilt: TiltReference,
  exerciseId: string,
  baselines: UpperBodyTraceMetrics["baselines"],
  baselinePhase: UpperBodyTraceMetrics["baselinePhase"],
  calibrationClock: NeutralCalibrationClock,
  frame: UpperBodyTraceMetrics["frame"],
  calibrationSamples: CalibrationSample[] | undefined,
  worldLandmarks: UpperBodyTraceMetrics["worldLandmarks"],
): UpperBodyTraceMetrics {
  const tilt = raw.tiltReference;
  const trunkLean = computeTrunkLateralLean(landmarks, tilt);
  const shoulderSymmetry = computeShoulderSymmetry(landmarks, tilt);
  const neckTilt = computeLateralNeckTilt(landmarks, tilt);
  return {
    metricAlgorithmVersion: POSE_METRIC_ALGORITHM_VERSION,
    exerciseId,
    wristShoulderVertical: {
      left: finiteNumberOrNull(
        raw.perSideMetrics?.left ??
          computeWristShoulderVertical(landmarks, tilt, "left"),
      ),
      right: finiteNumberOrNull(
        raw.perSideMetrics?.right ??
          computeWristShoulderVertical(landmarks, tilt, "right"),
      ),
    },
    wristShoulderLateral: {
      left: finiteNumberOrNull(
        computeWristShoulderLateral(landmarks, tilt, "left"),
      ),
      right: finiteNumberOrNull(
        computeWristShoulderLateral(landmarks, tilt, "right"),
      ),
    },
    shoulderAbductionDeg: {
      left: finiteNumberOrNull(
        computeShoulderAbduction(landmarks, tilt, "left"),
      ),
      right: finiteNumberOrNull(
        computeShoulderAbduction(landmarks, tilt, "right"),
      ),
    },
    elbowFlexionDeg: {
      left: finiteNumberOrNull(
        computeElbowFlexion(landmarks, tilt, "left"),
      ),
      right: finiteNumberOrNull(
        computeElbowFlexion(landmarks, tilt, "right"),
      ),
    },
    scapularElevationRaw: {
      left: finiteNumberOrNull(
        computeScapularElevation(landmarks, tilt, "left"),
      ),
      right: finiteNumberOrNull(
        computeScapularElevation(landmarks, tilt, "right"),
      ),
    },
    shoulderElbowDistance: {
      left: finiteNumberOrNull(
        computeShoulderElbowDistance(landmarks, tilt, "left"),
      ),
      right: finiteNumberOrNull(
        computeShoulderElbowDistance(landmarks, tilt, "right"),
      ),
    },
    shoulderHorizAbdDeg: {
      left: finiteNumberOrNull(
        computeShoulderHorizAbduction(landmarks, tilt, "left"),
      ),
      right: finiteNumberOrNull(
        computeShoulderHorizAbduction(landmarks, tilt, "right"),
      ),
    },
    trunkLeanDeg: finiteNumberOrNull(trunkLean?.angleDeg),
    trunkLeanDirection: trunkLean?.direction ?? null,
    shoulderSymmetryDeg: finiteNumberOrNull(shoulderSymmetry?.angleDeg),
    elevatedShoulder: shoulderSymmetry?.elevatedSide ?? null,
    neckTiltDeg: finiteNumberOrNull(neckTilt?.angleDeg),
    neckTiltDirection: neckTilt?.direction ?? null,
    // Side parameter is ignored by the signed neck metric (single
    // bidirectional signal); "left" is passed for signature compatibility.
    neckLateralFlexionSignedDeg: finiteNumberOrNull(
      computeNeckLateralFlexionSigned(landmarks, tilt, "left"),
    ),
    trunkLateralFlexionUncorrectedSignedDeg: finiteNumberOrNull(
      computeTrunkLateralFlexionUncorrectedSigned(landmarks),
    ),
    trunkLateralFlexionFromNeutralSignedDeg:
      baselines.bidirectionalPrimary !== null
        ? finiteNumberOrNull(
            computeTrunkLateralFlexionFromNeutralSigned(
              landmarks,
              baselines.bidirectionalPrimary,
            ),
          )
        : null,
    baselines,
    baselinePhase,
    tiltReference: {
      cameraTiltDeg: tilt.cameraTiltDeg,
      observedCameraTiltDeg: observedTilt.cameraTiltDeg,
      confidence: observedTilt.confidence,
      divergenceDeg: finiteNumberOrNull(observedTilt.divergenceDeg),
    },
    calibration: {
      sampleCount: calibrationClock.sampleCount,
      validElapsedMs: Math.round(calibrationClock.validElapsedMs),
      frozenCameraTiltDeg: tilt.cameraTiltDeg,
      ...(calibrationSamples ? { samples: calibrationSamples } : {}),
    },
    frame,
    worldLandmarks,
  };
}

function emptyFrameMetrics(): ExerciseFrameMetrics {
  return {
    tiltReference: {
      cameraTiltDeg: 0,
      confidence: "insufficient",
      divergenceDeg: null,
    },
    metrics: {},
    compensationScore: null,
  };
}

// ── Clinical design constants ────────────────────────────────────────────────

const ACCENT = {
  hex:  "oklch(0.55 0.07 200)",
  soft: "oklch(0.95 0.02 200)",
  text: "oklch(0.35 0.06 200)",
};

// Bright "glowing neon" palette for completion: the session progress strip
// (set pips + overall progress bar) and counts that reach their target. Kept
// separate from ACCENT so the rest of the clinical UI stays restrained.
const NEON = {
  hex:  "oklch(0.82 0.20 195)",        // bright neon cyan fill
  glow: "oklch(0.82 0.20 195 / 0.7)",  // box-shadow glow color
  dim:  "oklch(0.90 0.08 195)",        // current/upcoming set tint
};

// Layout tokens for the camera screen. The type ramp is sized for the 2-3 m the
// patient stands at, so it runs larger than the dashboard's.

const CARD_STYLE: CSSProperties = {
  background: "white",
  border: "1px solid oklch(0.93 0.003 240)",
  borderRadius: 12,
};

const EYEBROW_STYLE: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: "oklch(0.42 0.01 240)",
};

const STAFF_HEADING_STYLE: CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 10,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  color: "oklch(0.30 0.01 240)",
  fontWeight: 600,
};

const PRIMARY_BUTTON_STYLE: CSSProperties = {
  padding: "14px 18px",
  borderRadius: 10,
  border: `1px solid ${ACCENT.hex}`,
  background: ACCENT.hex,
  color: "white",
  fontFamily: "var(--sans)",
  fontSize: 18,
  fontWeight: 600,
  textAlign: "center",
  cursor: "pointer",
};

const SECONDARY_BUTTON_STYLE: CSSProperties = {
  padding: "14px 18px",
  borderRadius: 10,
  border: "1px solid oklch(0.90 0.003 240)",
  background: "white",
  color: "oklch(0.30 0.01 240)",
  fontFamily: "var(--sans)",
  fontSize: 18,
  fontWeight: 500,
  textAlign: "center",
  textDecoration: "none",
  cursor: "pointer",
};

const DANGER_BUTTON_STYLE: CSSProperties = {
  padding: "11px 12px",
  borderRadius: 10,
  border: "1px solid oklch(0.55 0.17 25)",
  background: "oklch(0.55 0.17 25)",
  color: "white",
  fontFamily: "var(--sans)",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};

const FIELD_STYLE: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 10px",
  border: "1px solid oklch(0.88 0.01 240)",
  borderRadius: 8,
  background: "white",
  color: "oklch(0.25 0.01 240)",
  fontFamily: "var(--sans)",
  fontSize: 14,
};

const CHIP_STYLE: CSSProperties = {
  padding: "7px 12px",
  borderRadius: 6,
  background: "oklch(0.96 0.003 240)",
  fontSize: 15,
  fontWeight: 600,
};

const ICON_BUTTON_STYLE: CSSProperties = {
  width: 36,
  height: 36,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid oklch(0.90 0.003 240)",
  borderRadius: 8,
  background: "white",
  color: "oklch(0.35 0.01 240)",
  cursor: "pointer",
};

const MODAL_BACKDROP_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 35,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  background: "oklch(0.18 0.01 240 / 0.62)",
};

const MODAL_CARD_STYLE: CSSProperties = {
  position: "relative",
  width: "min(600px, 100%)",
  maxHeight: "100%",
  overflowY: "auto",
  padding: "30px 32px",
  borderRadius: 16,
  background: "white",
  boxShadow: "0 12px 40px oklch(0 0 0 / 0.3)",
};

const MODAL_DISMISS_STYLE: CSSProperties = {
  ...ICON_BUTTON_STYLE,
  position: "absolute",
  top: 14,
  right: 14,
  width: 32,
  height: 32,
  fontSize: 15,
  lineHeight: 1,
  color: "oklch(0.40 0.01 240)",
};

const MODAL_ROW_STYLE: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: 16,
  fontSize: 20,
};

const FEED_CHIP_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 36,
  padding: "0 12px",
  borderRadius: 999,
  background: "oklch(0.16 0.01 240 / 0.72)",
  border: "1px solid oklch(1 0 0 / 0.14)",
  color: "white",
  fontFamily: "var(--mono)",
  fontSize: 13,
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const MODAL_LABEL_STYLE: CSSProperties = { color: "oklch(0.45 0.01 240)" };

const MODAL_VALUE_STYLE: CSSProperties = {
  fontWeight: 700,
  color: "oklch(0.18 0.01 240)",
  fontVariantNumeric: "tabular-nums",
  textAlign: "right",
};

type ScoreTier = { hex: string; soft: string; text: string; label: string };

function scoreTier(score: number | null): ScoreTier {
  if (score == null) return { hex: "oklch(0.75 0.01 240)", soft: "oklch(0.95 0.005 240)", text: "oklch(0.55 0.01 240)", label: "calibrating" };
  if (score >= 80)   return { hex: "oklch(0.62 0.11 145)", soft: "oklch(0.96 0.04 145)", text: "oklch(0.40 0.07 145)", label: "in range" };
  if (score >= 60)   return { hex: "oklch(0.70 0.12 80)",  soft: "oklch(0.96 0.04 80)",  text: "oklch(0.42 0.09 75)",  label: "borderline" };
  if (score >= 40)   return { hex: "oklch(0.65 0.15 50)",  soft: "oklch(0.96 0.05 50)",  text: "oklch(0.43 0.12 45)",  label: "compensating" };
  return             { hex: "oklch(0.58 0.17 25)",  soft: "oklch(0.96 0.04 25)",  text: "oklch(0.45 0.14 25)",  label: "poor form" };
}

type CardSpec = {
  id: string;
  metric: MetricName;
  label: string;
  value: number | null;
  kind: "primary" | "compensation";
  /** Angles are camera estimates in pipeline units and show no degree sign. */
  isAngle: boolean;
  warningThreshold?: number;
  compareDirection?: "above" | "below";
  warningActive?: boolean;
  /**
   * True when this is a `peakRelevant` compensation whose warning is gated
   * off this frame because the movement isn't near peak ROM (see isNearPeak).
   * The card still shows its value; only the warning highlight is suppressed.
   */
  suppressWarning?: boolean;
};

export default function CameraClient() {
  const { user } = useAuth();
  // The day by the demo clock (the real day outside demo mode). It changes once
  // a day, so the camera page does not redraw for the clock.
  const { todayKey: effectiveTodayPH } = useDemoClock();
  const { showToast } = useToast();
  const dashboardHref =
    user?.role === "admin" ? "/dashboard/admin"
    : user?.role === "therapist" ? "/dashboard/therapist"
    : "/dashboard/patient";

  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const requestRef = useRef<number | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const visionFilesetRef = useRef<
    Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null
  >(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const faceCropCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Footer telemetry (resolution + processing FPS). Both are driven from the
  // rAF loop via refs to avoid per-frame setState: resolution commits only when
  // the dimensions actually change, and FPS is the count of processed frames
  // over a rolling ~1 s window, committed once per second.
  const [videoResolution, setVideoResolution] = useState<{ width: number; height: number } | null>(
    null,
  );
  const videoResolutionRef = useRef<{ width: number; height: number } | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const fpsFrameCountRef = useRef(0);
  const fpsWindowStartMsRef = useRef(0);
  // Diagnostic timing split, averaged over the same ~1 s window as FPS:
  // `infer` is time spent in detectForVideo, `frame` is the whole per-frame
  // pipeline (detect + readiness + metrics + drawing). The gap is JS/draw
  // overhead — if infer ≈ frame the loop is inference-bound. Sums are tallied
  // per frame and flushed to state when the FPS window closes.
  const [perfMs, setPerfMs] = useState<{ infer: number; frame: number } | null>(null);
  const inferMsSumRef = useRef(0);
  const frameMsSumRef = useRef(0);
  const perfSampleCountRef = useRef(0);

  const metricFiltersRef = useRef<Map<MetricName, OneEuroFilter>>(new Map());
  const leftCompensationFiltersRef = useRef<Map<MetricName, OneEuroFilter>>(
    new Map(),
  );
  const rightCompensationFiltersRef = useRef<Map<MetricName, OneEuroFilter>>(
    new Map(),
  );
  // Dedicated smoothing filters for per-limb primary metrics. Separate from
  // the metricFiltersRef map because per-limb exercises need TWO filters for
  // the same MetricName — one per side. Cleared on exercise change, reset on
  // capture dropout, same lifecycle as metricFiltersRef.
  const leftPrimaryFilterRef = useRef(new OneEuroFilter(1.0, 0.1));
  const rightPrimaryFilterRef = useRef(new OneEuroFilter(1.0, 0.1));
  // Resting baselines for metrics that need a neutral reference before their
  // rep signal is meaningful. ex_003 uses the per-side refs; ex_005 uses the
  // bidirectional ref for neutral hip-to-head lean. The scap refs hold the
  // per-side resting baseline for scapularElevation when used as a
  // compensation metric. Reset on exercise change and capture-readiness dropout.
  type BaselineState = { samples: number[]; value: number | null };
  const leftBaselineRef = useRef<BaselineState>({ samples: [], value: null });
  const rightBaselineRef = useRef<BaselineState>({ samples: [], value: null });
  const bidirectionalBaselineRef = useRef<BaselineState>({
    samples: [],
    value: null,
  });
  const leftScapBaselineRef  = useRef<BaselineState>({ samples: [], value: null });
  const rightScapBaselineRef = useRef<BaselineState>({ samples: [], value: null });
  type NeutralCalibrationSample = {
    landmarks: NormalizedLandmark[];
    observedTilt: TiltReference;
  };
  const neutralCalibrationClockRef = useRef<NeutralCalibrationClock>(
    newNeutralCalibrationClock(),
  );
  const neutralCalibrationSamplesRef = useRef<NeutralCalibrationSample[]>([]);
  const frozenTiltDegRef = useRef<number | null>(null);
  const lastMetricsUpdateRef = useRef(0);
  const compensationWarningLatchesRef = useRef<Map<MetricName, CompensationWarningLatch>>(
    new Map(),
  );
  const [activeCompensationWarnings, setActiveCompensationWarnings] = useState<Set<MetricName>>(
    new Set(),
  );
  // Single-cue arbitration state. Lives beside the warning latches and is
  // cleared with them: a cue's minimum-active clock, display clock and
  // cooldown all describe one continuous stretch of coaching, so carrying any
  // of it across an exercise change, a calibration restart or a capture
  // dropout would suppress or promote a cue on evidence from a different run.
  const coachingCueStateRef = useRef<CoachingCueState>(newCoachingCueState());
  // Read by the per-frame overlay path, which runs faster than the 150 ms
  // metrics tick that produces the decision.
  const selectedCoachingCueMetricRef = useRef<MetricName | null>(null);
  // Landmark (11 or 12) the LOWER arrow was drawn on when the shoulder cue
  // appeared; kept until that cue leaves the slot so the arrow cannot jump.
  const lockedShoulderIndexRef = useRef<11 | 12 | null>(null);
  // Per-metric state of rep-window warnings (cues judged once per repetition).
  const repWindowStatesRef = useRef(new Map<MetricName, RepWindowState>());
  // Per-check state of display-only coaching checks (hipShiftWarning.ts).
  const hipShiftStatesRef = useRef(new Map<MetricName, HipShiftState>());
  // Per-check state of the display-only elbow check (elbowBendWarning.ts).
  const elbowBendStatesRef = useRef(new Map<MetricName, ElbowBendState>());
  // The cue last drawn, with the reading and direction it was drawn with. A cue
  // kept for its minimum visible time is drawn with these once its own reading
  // has gone, as the per-repetition, hip and at-rest coupled readings do.
  const lastDrawnCueRef = useRef<{ metric: MetricName; value: number; direction: string | null } | null>(null);
  const coachingProvenanceRef = useRef<CoachingProvenance | null>(null);
  const coachingAuditRef = useRef(new CoachingAuditBuffer());
  const coachingDecisionRef = useRef<CoachingObservation["selected"]>(null);
  const sessionStartPendingRef = useRef(false);
  const cameraStartEpochRef = useRef(0);
  const cameraReadyRef = useRef(false);
  const [selectedCoachingCueMetric, setSelectedCoachingCueMetric] =
    useState<MetricName | null>(null);
  const resetCompensationWarnings = useCallback(() => {
    compensationWarningLatchesRef.current.clear();
    setActiveCompensationWarnings(new Set());
    coachingCueStateRef.current = newCoachingCueState();
    selectedCoachingCueMetricRef.current = null;
    coachingDecisionRef.current = null;
    // Per-repetition and hip-check state, the LOWER lock and the last drawn
    // cue belong to the run being reset, like the latches above.
    repWindowStatesRef.current.clear();
    hipShiftStatesRef.current.clear();
    elbowBendStatesRef.current.clear();
    lockedShoulderIndexRef.current = null;
    lastDrawnCueRef.current = null;
    setSelectedCoachingCueMetric(null);
  }, []);
  /**
   * Whether anything in the warning/cue layer still carries state from an
   * earlier run. The render loop's "clear stale state" paths test this rather
   * than the latch map alone: a cue can hold a live cooldown after every latch
   * has dropped, and carrying that across a calibration restart would suppress
   * a cue on evidence from before the restart.
   */
  const compensationWarningStateIsDirty = useCallback(() => {
    const cue = coachingCueStateRef.current;
    return (
      compensationWarningLatchesRef.current.size > 0 ||
      cue.currentCueId !== null ||
      cue.activeSinceMs.size > 0 ||
      cue.clearedAtMs.size > 0 ||
      repWindowStatesRef.current.size > 0 ||
      hipShiftStatesRef.current.size > 0 ||
      elbowBendStatesRef.current.size > 0 ||
      lockedShoulderIndexRef.current !== null ||
      lastDrawnCueRef.current !== null
    );
  }, []);

  const [repCounts, setRepCounts] = useState<{ left: number; right: number }>({
  left: 0,
  right: 0,
  });

  // Rep counters. Per-limb exercises use both refs (one per side). Bidirectional
  // exercises use only the left counter (it's just "the counter," but reusing
  // the slot keeps allocation simple). When the active exercise changes, both
  // refs are recreated based on the new definition.
  const leftRepCounterRef = useRef<RepCounter | null>(null);
  const rightRepCounterRef = useRef<RepCounter | null>(null);

  // Bidirectional exercises use one signed metric. The selected strategy tags
  // the side from the sign at peak while suppressing immediate opposite-side
  // return-stroke overshoot.
  const bidirectionalRepCounterRef = useRef<BidirectionalCounter | null>(null);
  // Raw/unsmoothed metric samples are buffered independently from the
  // smoothed RepCounter streams. A completed RepEvent supplies the boundaries
  // used to finalize and persist one versioned quality summary.
  const dynamicRepQualityBufferRef = useRef(new DynamicRepQualityBuffer());
  const neckRepDebugRef = useRef<NeckRepDebugRecord[]>([]);
  const neckRepDebugStartMsRef = useRef<number | null>(null);
  const neckRepDebugSeqRef = useRef(0);
  // ── Staff-only coaching shadow log ────────────────────────────────────────
  // Records what the cue selector decided and why. Unlike the Face diagnostic,
  // the runtime gate is the staff role itself, not just the panel: both refs
  // below are checked inside the render loop before a record is written, and
  // no console helper is registered, so a patient cannot start recording from
  // developer tools on their own device.
  const coachingShadowEnabledRef = useRef(false);
  const coachingShadowStaffAllowedRef = useRef(false);
  const coachingShadowRecordsRef = useRef<CoachingShadowRecord[]>([]);
  const coachingShadowSeqRef = useRef(0);
  const coachingShadowDroppedRef = useRef(0);
  const coachingShadowStartMsRef = useRef<number | null>(null);
  const coachingShadowSegmentLabelRef = useRef<string | null>(null);
  const coachingShadowSegmentIntentRef = useRef<CoachingShadowIntent>("transition");
  const [coachingShadowSegmentLabel, setCoachingShadowSegmentLabel] = useState("");
  const [coachingShadowSegmentIntent, setCoachingShadowSegmentIntent] =
    useState<CoachingShadowIntent>("transition");
  const [coachingShadowActiveSegment, setCoachingShadowActiveSegment] =
    useState<{ label: string; intent: CoachingShadowIntent } | null>(null);
  const [coachingPlanIndex, setCoachingPlanIndex] = useState(0);
  /**
   * Set index whose neutral-calibration samples have already been written to
   * the trace. V4 emits them once per set; this is what makes it once.
   */
  const calibrationSamplesEmittedSetRef = useRef<number | null>(null);
  /**
   * Neutral-calibration samples SERIALIZED FOR THE TRACE, snapshotted at
   * finalize time.
   *
   * `finalizeNeutralCalibration` deliberately frees the raw sample ring once
   * the medians are computed, and it does so BEFORE flipping the phase to
   * "captured". The trace writer runs after that flip, so reading the raw ring
   * there yields an empty array — the v4 trace shipped writing `samples: []`
   * for exactly this reason. Snapshotting into the compact trace shape keeps
   * the memory saving (10 landmarks per sample rather than the full set) while
   * preserving what a later reprocessing actually needs.
   */
  const calibrationTraceSamplesRef = useRef<CalibrationSample[] | null>(null);
  /**
   * True when a capture dropout interrupted a session that had ALREADY captured
   * its neutral baseline.
   *
   * Until 2026-09-07 a sustained dropout re-ran calibration automatically. That
   * is worse than it sounds: calibration captures "neutral" from whatever
   * posture the patient happens to hold at that moment, so an interruption
   * while they are slouched adopts the slouch as their reference, and every
   * later deduction is measured against a compensated posture. A recorded
   * session did exactly this twice, silently.
   *
   * The baseline is now KEPT and this flag is raised instead, so the choice to
   * re-anchor is explicit. That trades one risk for a visible one: if the
   * CAMERA moved rather than the patient, the frozen tilt is now stale until
   * somebody recalibrates — which is why the prompt says so rather than just
   * offering a button.
   */
  const calibrationStaleRef = useRef(false);
  const [calibrationStale, setCalibrationStale] = useState(false);
  /**
   * The on-screen trace sync readout. Held as a DOM node rather than state on
   * purpose: the camera loop deliberately avoids per-frame `setState` (fps and
   * the timing split commit once a second, resolution only on change), and
   * reconciling a readout every frame would add render cost to the exact frame
   * budget this recording is trying to protect.
   */
  const traceSyncElRef = useRef<HTMLDivElement | null>(null);
  /**
   * Whether THIS processed frame produced a trace row. Cleared at the top of
   * each frame's work and read at the bottom, which is what lets the readout
   * be blanked on a frame that was not traced.
   *
   * It has to be per-frame rather than per-rAF-tick: the loop is scheduled on
   * every animation frame but only does this work when the video has advanced,
   * so a tick-level flag would blank the readout between video frames and
   * strobe it at display rate.
   */
  const traceSyncWroteThisFrameRef = useRef(false);
  const [coachingRemoteCollapsed, setCoachingRemoteCollapsed] = useState(false);
  // True once the current ring contents have been written to a file. Cleared by
  // the next recorded decision, so "exported" always describes what is in the
  // ring right now rather than something that was exported two captures ago.
  const coachingShadowExportedRef = useRef(false);
  const [coachingShadowExported, setCoachingShadowExported] = useState(false);
  const [coachingShadowEnabled, setCoachingShadowEnabledState] = useState(false);
  const [coachingShadowCount, setCoachingShadowCount] = useState(0);
  const coachingShadowLastUiUpdateMsRef = useRef(0);

  const ex004FaceShadowEnabledRef = useRef(false);
  const ex004FaceShadowModelStateRef = useRef<Ex004FaceShadowModelState>("disabled");
  const ex004FaceShadowRoiRef = useRef<FixedFaceRoi | null>(null);
  const ex004FaceShadowBaselineSamplesRef = useRef<number[]>([]);
  const ex004FaceShadowBaselineYawSamplesRef = useRef<number[]>([]);
  const ex004FaceShadowBaselinePitchSamplesRef = useRef<number[]>([]);
  const ex004FaceShadowBaselineRollRef = useRef<number | null>(null);
  const ex004FaceShadowBaselineYawRef = useRef<number | null>(null);
  const ex004FaceShadowBaselinePitchRef = useRef<number | null>(null);
  const ex004FaceShadowRecordsRef = useRef<Ex004FaceShadowRecord[]>([]);
  const ex004FaceShadowMarksRef = useRef<Ex004FaceShadowMark[]>([]);
  const ex004FaceShadowPhaseRef = useRef<Ex004FaceShadowPhase>("neutral");
  const ex004FaceShadowSeqRef = useRef(0);
  const ex004FaceShadowMarkSeqRef = useRef(0);
  const ex004FaceShadowStartMsRef = useRef<number | null>(null);
  const ex004FaceShadowAttemptedFramesRef = useRef(0);
  const ex004FaceShadowDetectedFramesRef = useRef(0);
  const ex004FaceShadowLastUiUpdateMsRef = useRef(0);
  const ex004FaceShadowLastInferenceMsRef = useRef<number | null>(null);
  const ex005DebugRef = useRef<Ex005DebugRecord[]>([]);
  const ex005DebugStartMsRef = useRef<number | null>(null);
  const ex005DebugSeqRef = useRef(0);
  const ex005DebugEnabledRef = useRef(false);
  // TEMPORARY (2026-05-26): throttle anchor for the ex_005 head-lean console
  // diagnostic below. Remove once ex_005 thresholds/framing are tuned.
  const lastEx005DebugMsRef = useRef(0);

  // In-memory per-rep event log, keyed by side. Cleared when the exercise
  // changes. This is the buffer that will eventually feed Postgres in a later
  // step — for now, console.log on each rep is the only output beyond the
  // live counter.
  const repLogRef = useRef<{ left: RepEvent[]; right: RepEvent[] }>({
    left: [],
    right: [],
  });
  // Outcomes counted before a Resume (from the snapshot). Kept apart from
  // repLogRef, which only ever holds this page's live RepEvents.
  const priorRepOutcomesRef = useRef<{ left: RepOutcome[]; right: RepOutcome[] }>({
    left: [],
    right: [],
  });

  // ── Isometric time-in-band accumulation ──────────────────────────────────
  // Two isometric modes share this machinery:
  //  - per-limb (ex_006 T-pose): time accrues only while BOTH arms are in the
  //    target band simultaneously (a real T-pose) → ONE paired accumulator
  //    (`pairedHoldMsRef`); the per-side hold refs stay 0.
  //  - side-split (ex_004 neck hold): one signed signal, side attributed from
  //    its sign → per-side accumulators (`left/rightHoldMsRef`); the paired
  //    accumulator stays 0. Sides are surfaced separately (never merged).
  // `left/rightInBandRef` carry the current per-side in-band status for the
  // live panel. Reset on set completion, exercise change, session start, and
  // sustained capture dropout. `holdState` mirrors these for the UI at the
  // throttled metrics cadence.
  const pairedHoldMsRef = useRef(0);
  const leftHoldMsRef = useRef(0);
  const rightHoldMsRef = useRef(0);
  const leftInBandRef = useRef(false);
  const rightInBandRef = useRef(false);
  // Timestamp of the previous accumulation tick, or null to (re)start the dt
  // clock fresh (after a gate close / dropout) so an elapsed gap is not dumped
  // into the accumulator on resume.
  const lastIsometricTickMsRef = useRef<number | null>(null);
  const [holdState, setHoldState] = useState<{
    pairedSec: number;
    leftSec: number;
    rightSec: number;
    leftInBand: boolean;
    rightInBand: boolean;
  }>({ pairedSec: 0, leftSec: 0, rightSec: 0, leftInBand: false, rightInBand: false });

  // ── Isometric hold-quality accumulators ──────────────────────────────────────
  // Running, time-weighted (by frame dt) sums per side over the CURRENT set, plus
  // in-band bookkeeping and a compensation-score aggregate. Folded into a
  // HoldQuality summary at set boundary (finalizeHoldQuality) and reset alongside
  // the hold accumulators. All inputs are RAW angles (smoothing would erase the
  // steadiness signal): per-arm angles for ex_006; for the side-split ex_004 each
  // side's stream is the |signed angle| while the sign points at that side (so
  // left-tilt frames feed only the left stats). The "paired" fields read as
  // "holding either side" for side-split sets. `t` is ms since the set started.
  type HoldSideAccum = {
    w: number;   // Σ dt
    wa: number;  // Σ dt·a
    wa2: number; // Σ dt·a²
    wt: number;  // Σ dt·t
    wt2: number; // Σ dt·t²
    wta: number; // Σ dt·t·a
    inBandMs: number;
  };
  const newHoldSideAccum = (): HoldSideAccum => ({
    w: 0, wa: 0, wa2: 0, wt: 0, wt2: 0, wta: 0, inBandMs: 0,
  });
  type HoldQualityAccum = {
    setStartMs: number | null;     // perf clock anchor for `t`
    left: HoldSideAccum;
    right: HoldSideAccum;
    outOfPositionMs: number;
    dropCount: number;
    prevPairedInBand: boolean;
    curStreakMs: number;
    longestStreakMs: number;
    settleMs: number | null;
    scoreWSum: number;   // Σ compensationScore·dt (time-weighted)
    scoreWeight: number; // Σ dt over frames with a numeric score
    scoreMin: number | null;
    sampleCount: number;
  };
  const newHoldQualityAccum = (): HoldQualityAccum => ({
    setStartMs: null,
    left: newHoldSideAccum(),
    right: newHoldSideAccum(),
    outOfPositionMs: 0,
    dropCount: 0,
    prevPairedInBand: false,
    curStreakMs: 0,
    longestStreakMs: 0,
    settleMs: null,
    scoreWSum: 0,
    scoreWeight: 0,
    scoreMin: null,
    sampleCount: 0,
  });
  const holdQualityAccumRef = useRef<HoldQualityAccum>(newHoldQualityAccum());
  const resetHoldQualityAccumRef = useRef<() => void>(() => undefined);
  const resetHoldQualityAccum = () => {
    holdQualityAccumRef.current = newHoldQualityAccum();
  };
  resetHoldQualityAccumRef.current = resetHoldQualityAccum;

  const [mounted, setMounted] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [cameraStreamActive, setCameraStreamActive] = useState(false);
  const [staffDrawerOpen, setStaffDrawerOpen] = useState(false);
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [ex004FaceShadowEnabled, setEx004FaceShadowEnabledState] = useState(false);
  const [ex004FaceShadowModelState, setEx004FaceShadowModelState] =
    useState<Ex004FaceShadowModelState>("disabled");
  const [ex004FaceShadowModelError, setEx004FaceShadowModelError] =
    useState<string | null>(null);
  const [ex004FaceShadowPhase, setEx004FaceShadowPhaseState] =
    useState<Ex004FaceShadowPhase>("neutral");
  const [ex004FaceShadowReferenceInput, setEx004FaceShadowReferenceInput] =
    useState("");
  const [ex004FaceShadowLive, setEx004FaceShadowLive] =
    useState<Ex004FaceShadowLive>({
      status: null,
      poseSignedDeg: null,
      faceSignedDeg: null,
      faceYawDeltaDeg: null,
      facePitchDeltaDeg: null,
      faceMinusPoseDeg: null,
      inferenceMs: null,
      attemptedFrames: 0,
      detectedFrames: 0,
    });

  const appendEx004FaceShadowMark = useCallback((
    kind: Ex004FaceShadowMark["kind"],
    phase: Ex004FaceShadowPhase,
    referenceAngleDeg: number | null = null,
    note: string | null = null,
  ): Ex004FaceShadowMark => {
    const tNow = performance.now();
    if (ex004FaceShadowStartMsRef.current === null) {
      ex004FaceShadowStartMsRef.current = tNow;
    }
    const mark: Ex004FaceShadowMark = {
      version: "ex004_face_shadow_mark_v2",
      seq: ++ex004FaceShadowMarkSeqRef.current,
      tMs: Math.round(tNow),
      elapsedMs: Math.round(tNow - ex004FaceShadowStartMsRef.current),
      kind,
      phase,
      referenceAngleDeg,
      note,
    };
    ex004FaceShadowMarksRef.current.push(mark);
    if (ex004FaceShadowMarksRef.current.length > MAX_EX004_FACE_SHADOW_MARKS) {
      ex004FaceShadowMarksRef.current.shift();
    }
    return mark;
  }, []);

  const setEx004FaceShadowPhase = useCallback((phase: Ex004FaceShadowPhase) => {
    ex004FaceShadowPhaseRef.current = phase;
    setEx004FaceShadowPhaseState(phase);
    appendEx004FaceShadowMark("phase", phase);
  }, [appendEx004FaceShadowMark]);

  const markEx004FaceShadowReference = useCallback((
    angleDeg: number,
    note: string | null = null,
  ): boolean => {
    if (!Number.isFinite(angleDeg)) return false;
    appendEx004FaceShadowMark(
      "reference",
      ex004FaceShadowPhaseRef.current,
      angleDeg,
      note,
    );
    return true;
  }, [appendEx004FaceShadowMark]);

  const setEx004FaceShadowEnabled = useCallback((enabled: boolean) => {
    ex004FaceShadowEnabledRef.current = enabled;
    setEx004FaceShadowEnabledState(enabled);
  }, []);

  const clearCoachingShadow = useCallback(() => {
    coachingShadowRecordsRef.current = [];
    coachingShadowSeqRef.current = 0;
    coachingShadowDroppedRef.current = 0;
    coachingShadowStartMsRef.current = null;
    coachingShadowLastUiUpdateMsRef.current = 0;
    coachingShadowSegmentLabelRef.current = null;
    coachingShadowSegmentIntentRef.current = "transition";
    coachingShadowExportedRef.current = false;
    setCoachingShadowCount(0);
    setCoachingShadowActiveSegment(null);
    setCoachingShadowExported(false);
  }, []);

  /**
   * Starts a labelled segment. Every record written from now until the next
   * call carries this label and intent, so the export is self-describing and
   * no separate written timestamp sheet has to be kept in sync with it.
   */
  const markCoachingShadowSegment = useCallback(
    (label: string, intent: CoachingShadowIntent): boolean => {
      const trimmed = label.trim();
      if (trimmed === "") return false;
      coachingShadowSegmentLabelRef.current = trimmed;
      coachingShadowSegmentIntentRef.current = intent;
      setCoachingShadowActiveSegment({ label: trimmed, intent });
      return true;
    },
    [],
  );

  /**
   * Closes the current segment by dropping back to an unlabelled `transition`.
   *
   * A label with a start but no end runs until the next one begins, so it
   * absorbs the rest after the last repetition and the time spent reaching for
   * the export button. Those ticks are not movement, and there is no rep
   * boundary or primary value in the record to trim them afterwards. Ending the
   * segment explicitly is the only way to bound the window.
   */
  const endCoachingShadowSegment = useCallback(() => {
    // Keep a LABEL — `after:<segment>` — rather than dropping to null. Recording
    // continues while the operator reaches for Download, and nulling the label
    // would have made those ordinary between-segment ticks trip the
    // unlabelled-record warning on every single capture. A warning that fires
    // when the workflow is being followed correctly trains people to ignore
    // warnings. The intent still drops to `transition`, so these ticks stay out
    // of both the clean and the faulty counts.
    const previous = coachingShadowSegmentLabelRef.current;
    // Idempotent: `Next` also ends any open segment, so pressing End then Next
    // would otherwise produce `after:after:<segment>`.
    const label =
      previous === null
        ? "idle"
        : previous === "idle" || previous.startsWith("after:")
          ? previous
          : `after:${previous}`;
    coachingShadowSegmentLabelRef.current = label;
    coachingShadowSegmentIntentRef.current = "transition";
    setCoachingShadowActiveSegment({ label, intent: "transition" });
  }, []);

  const coachingShadowAdvanceBlocked = shouldBlockCoachingShadowPlanAdvance(
    COACHING_SESSION_PLAN,
    coachingPlanIndex,
    coachingShadowCount,
    coachingShadowExported,
  );

  /**
   * The floating remote and the main panel must share this path. Re-check the
   * refs here because the visible count/export state is updated asynchronously;
   * a click inside that brief lag must still preserve the retained capture.
   */
  const moveCoachingShadowPlanTo = useCallback((targetIndex: number): boolean => {
    const retainedRecordCount = coachingShadowRecordsRef.current.length;
    const blocked = shouldBlockCoachingShadowPlanTransition(
      COACHING_SESSION_PLAN,
      coachingPlanIndex,
      targetIndex,
      retainedRecordCount,
      coachingShadowExportedRef.current,
    );
    if (blocked) {
      showToast({
        variant: "error",
        message: `This capture has ${retainedRecordCount} unexported decisions. Download the log before moving on.`,
      });
      return false;
    }
    if (coachingShadowActiveSegment) endCoachingShadowSegment();
    setCoachingPlanIndex(Math.max(0, Math.min(targetIndex, COACHING_SESSION_PLAN.length)));
    return true;
  }, [
    coachingPlanIndex,
    coachingShadowActiveSegment,
    endCoachingShadowSegment,
    showToast,
  ]);

  const advanceCoachingShadowPlan = useCallback(
    (): boolean => moveCoachingShadowPlanTo(coachingPlanIndex + 1),
    [coachingPlanIndex, moveCoachingShadowPlanTo],
  );

  /**
   * Back and restart go through the SAME guard as advance. Both previously set
   * the index directly, so either could cross a capture boundary while the ring
   * held unexported decisions, and both skipped `endCoachingShadowSegment()` so
   * an open segment kept recording under its old label after the step moved.
   */
  const stepBackCoachingShadowPlan = useCallback(
    (): boolean => moveCoachingShadowPlanTo(coachingPlanIndex - 1),
    [coachingPlanIndex, moveCoachingShadowPlanTo],
  );

  const restartCoachingShadowPlan = useCallback(
    (): boolean => moveCoachingShadowPlanTo(0),
    [moveCoachingShadowPlanTo],
  );

  const setCoachingShadowEnabled = useCallback((enabled: boolean) => {
    coachingShadowEnabledRef.current = enabled;
    setCoachingShadowEnabledState(enabled);
  }, []);

  /**
   * Writes the whole retained shadow ring to a local JSON file.
   *
   * A FILE DOWNLOAD, deliberately, not a clipboard copy: the Face diagnostic's
   * clipboard export lost a session's raw dump and silently truncated the ring
   * it did copy. Everything the ring still holds is written, and any overflow
   * the ring already discarded is stated as a count in the envelope rather than
   * being papered over.
   *
   * Nothing leaves the device. The blob is created, saved, and revoked locally.
   */
  const downloadCoachingShadow = useCallback((): {
    warnings: string[];
    checksRun: number;
  } | null => {
    if (typeof window === "undefined") return null;
    const records = coachingShadowRecordsRef.current;
    if (records.length === 0) return null;

    const exerciseIds = [...new Set(records.map((record) => record.exerciseId))];
    const cueConfiguration: CoachingShadowExport["cueConfiguration"] = [];
    for (const exerciseId of exerciseIds) {
      const definition = getExerciseDefinition(exerciseId);
      if (!definition) continue;
      for (const comp of definition.compensationMetrics) {
        const cue = resolveCoachingCue(comp);
        const timing = resolveCoachingCueTiming(cue);
        cueConfiguration.push({
          exerciseId,
          metric: comp.name,
          cueId: cue.id,
          message: cue.message,
          priority: cue.priority,
          ...timing,
        });
      }
    }

    const segments: CoachingShadowExport["segments"] = [];
    for (const record of records) {
      const open = segments[segments.length - 1];
      if (
        open &&
        open.label === record.segmentLabel &&
        open.intent === record.segmentIntent
      ) {
        open.lastSeq = record.seq;
        open.endMs = record.tMs;
        open.durationMs = open.endMs - open.startMs;
        open.recordCount += 1;
        if (record.selectedCueId !== null) open.cueActiveRecords += 1;
        continue;
      }
      segments.push({
        label: record.segmentLabel,
        intent: record.segmentIntent,
        firstSeq: record.seq,
        lastSeq: record.seq,
        startMs: record.tMs,
        endMs: record.tMs,
        durationMs: 0,
        recordCount: 1,
        cueActiveRecords: record.selectedCueId !== null ? 1 : 0,
      });
    }

    const payload: CoachingShadowExport = {
      schema: COACHING_SHADOW_SCHEMA,
      generatedAt: new Date().toISOString(),
      exerciseIds,
      mixedExercises: exerciseIds.length > 1,
      cueConfiguration,
      segments,
      ringCapacity: COACHING_SHADOW_RING_LIMIT,
      recordCount: records.length,
      droppedRecords: coachingShadowDroppedRef.current,
      notes: [
        "Coaching cue arbitration decisions. Diagnostic record of which cue was selected and why.",
        "Records the selector's own decisions, not clinical outcomes. Cue wording and priority ordering are engineering defaults and are not clinician-approved.",
        "Every record the in-memory ring still held is included. droppedRecords counts decisions the ring discarded before this export.",
        "tMs is performance.now() milliseconds since page load; tShadowMs is milliseconds since recording started.",
        "The ring is not cleared on an exercise change, so one export can span several exercises. Every record carries its own exerciseId; exerciseIds lists them all.",
        "cueConfiguration is read from the registry at export time, not at decision time. It describes these decisions only if the registry has not changed since they were made.",
        "segmentLabel and segmentIntent are operator-declared ground truth, set in the panel before each segment. intent=clean marks movement that was MEANT to be clean; intent=transition marks setup, recovery, and between-segment time and belongs in neither count.",
        "cueActiveRecords/recordCount on a clean segment is a DESCRIPTIVE TICK SHARE, not a false-positive rate and not a bound on one. A segment still contains the pauses between repetitions, and a pause can push the share either way depending on whether a cue was active across it. The record carries no rep boundary or primary value, so those ticks cannot be removed afterwards.",
      ],
      records: [...records],
    };

    const exerciseLabel = exerciseIds.length === 1 ? exerciseIds[0] : "mixed";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `coaching-shadow-${exerciseLabel}-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      URL.revokeObjectURL(url);
    }

    // Self-validation. The protocol asks the operator to open every file and
    // check these before clearing; doing it here means a bad capture is caught
    // in the room rather than during analysis, when it cannot be redone.
    const warnings: string[] = [];

    // Cross-check the capture against the plan. Without this the validator can
    // only see the envelope's own consistency, and a single record recorded on
    // the wrong exercise would pass.
    const planByLabel = new Map(
      COACHING_SESSION_PLAN.map((step) => [step.label, step] as const),
    );
    const misplaced = payload.segments.filter((segment) => {
      const step = segment.label === null ? undefined : planByLabel.get(segment.label);
      if (!step) return false;
      return records.some(
        (record) =>
          record.segmentLabel === segment.label &&
          record.exerciseId !== step.exerciseId,
      );
    });
    if (misplaced.length > 0) {
      warnings.push(
        `${misplaced.length} segment(s) were recorded on the wrong exercise: ${misplaced
          .map((segment) => segment.label)
          .join(", ")}.`,
      );
    }
    const capturesPresent = new Set(
      payload.segments
        .map((segment) => planByLabel.get(segment.label ?? "")?.captureId)
        .filter((id): id is string => id !== undefined),
    );
    // A valid E1 file holds ONE capture id spanning two EXERCISES. Nothing is
    // meant to hold two capture ids, so there is no exception here — the earlier
    // `!capturesPresent.has("E1")` guard confused exercises with captures and
    // let an E1 + A1 contamination through unreported.
    if (capturesPresent.size > 1) {
      warnings.push(
        `This file holds ${capturesPresent.size} captures (${[...capturesPresent].join(", ")}). Each capture belongs in its own file; only E1 spans two exercises, and it is still one capture.`,
      );
    }
    for (const captureId of capturesPresent) {
      // Exclude only the auto-generated capture-boundary setup steps. Filtering
      // on `intent !== "transition"` also dropped genuinely required segments
      // that happen to be transition-classified — `B2-corrected` is the
      // recovery window and its absence must be reported.
      const expected = COACHING_SESSION_PLAN.filter(
        (step) => step.captureId === captureId && step.startsCapture !== true,
      ).map((step) => step.label);
      const missing = expected.filter(
        (label) => !payload.segments.some((segment) => segment.label === label),
      );
      if (missing.length > 0) {
        warnings.push(`${captureId} is missing segment(s): ${missing.join(", ")}.`);
      }
    }
    const thin = payload.segments.filter(
      (segment) => segment.intent !== "transition" && segment.recordCount < 10,
    );
    if (thin.length > 0) {
      warnings.push(
        `${thin.length} segment(s) hold fewer than 10 records (under ~1.5 s): ${thin
          .map((segment) => segment.label)
          .join(", ")}.`,
      );
    }

    if (payload.droppedRecords > 0) {
      warnings.push(
        `${payload.droppedRecords} decisions were evicted from the ring before this export — the capture ran past about 12 minutes.`,
      );
    }
    // Only records written BEFORE anything was ever declared land here — ending
    // a segment keeps an `after:` label, so the normal gap between segments does
    // not trip this.
    const undeclared = records.filter((record) => record.segmentLabel === null).length;
    if (undeclared > 0) {
      warnings.push(
        `${undeclared} of ${records.length} records were written before any segment was declared — press "Start this step" before moving.`,
      );
    }
    const transitionOnly =
      payload.segments.length > 0 &&
      payload.segments.every((segment) => segment.intent === "transition");
    if (transitionOnly) {
      warnings.push(
        "Every segment is still 'transition' — no clean or faulty intent was declared, so this capture cannot contribute to the clean-window measure.",
      );
    }
    return { warnings, checksRun: COACHING_SHADOW_CHECKS_RUN };
  }, []);

  // Runtime staff gate for the shadow log, kept in a ref so the render loop can
  // check it without re-subscribing. Losing the staff role stops recording and
  // discards what was captured, so the panel disappearing and the recording
  // stopping are the same event.
  const coachingShadowStaffAllowed =
    user?.role === "admin" || user?.role === "therapist";
  useEffect(() => {
    coachingShadowStaffAllowedRef.current = coachingShadowStaffAllowed;
    if (!coachingShadowStaffAllowed) {
      coachingShadowEnabledRef.current = false;
      setCoachingShadowEnabledState(false);
      clearCoachingShadow();
    }
  }, [coachingShadowStaffAllowed, clearCoachingShadow]);

  /**
   * Remote segment control for an operator standing away from the keyboard.
   *
   * WHY THIS EXISTS
   * `End step` is what flips the recorded label to `transition`. Every tick
   * between the movement stopping and that click is still labelled clean or
   * faulty, and at the ~150 ms tick a few seconds of walking back to the desk
   * writes tens of mislabelled records that cannot be repaired afterwards. The
   * boundary has to be markable from where the exercise is performed.
   *
   * MOUSE THUMB BUTTONS DO NOT WORK AND ARE NOT BOUND. Tested 2026-08-23 on the
   * operator's hardware: the browser services Back/Forward at the chrome layer
   * and never dispatches `mousedown` to the page, so a handler cannot see them
   * and `preventDefault()` never runs. Binding them is worse than useless — the
   * navigation still happens, and navigating away from a live capture destroys
   * the only copy of it. Do not re-add this without retesting.
   *
   * What works instead: the large on-screen remote below (park the cursor on it
   * and left-click from anywhere in the room), and the F8/F9 keys for anything
   * that can send a real keystroke.
   */
  useEffect(() => {
    if (!coachingShadowEnabled || !coachingShadowStaffAllowed) return;

    const typingInAField = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      const tag = el?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable === true;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (typingInAField(event.target)) return;
      if (event.key === "F8") {
        event.preventDefault();
        const step = COACHING_SESSION_PLAN[coachingPlanIndex];
        if (!step) return;
        if (!markCoachingShadowSegment(step.label, step.intent)) return;
        setCoachingShadowSegmentLabel(step.label);
        setCoachingShadowSegmentIntent(step.intent);
        showToast({ variant: "success", message: `Recording ${step.label} (${step.intent}).` });
      } else if (event.key === "F9") {
        event.preventDefault();
        endCoachingShadowSegment();
        showToast({ variant: "success", message: "Segment ended." });
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [
    coachingShadowEnabled,
    coachingShadowStaffAllowed,
    coachingPlanIndex,
    markCoachingShadowSegment,
    endCoachingShadowSegment,
    showToast,
  ]);

  const commitEx004FaceShadowModelState = useCallback((
    state: Ex004FaceShadowModelState,
    message: string | null = null,
  ) => {
    ex004FaceShadowModelStateRef.current = state;
    setEx004FaceShadowModelState(state);
    setEx004FaceShadowModelError(message);
  }, []);

  const clearEx004FaceShadow = useCallback(() => {
    ex004FaceShadowRecordsRef.current = [];
    ex004FaceShadowMarksRef.current = [];
    ex004FaceShadowSeqRef.current = 0;
    ex004FaceShadowMarkSeqRef.current = 0;
    ex004FaceShadowStartMsRef.current = null;
    ex004FaceShadowPhaseRef.current = "neutral";
    setEx004FaceShadowPhaseState("neutral");
    setEx004FaceShadowReferenceInput("");
    ex004FaceShadowAttemptedFramesRef.current = 0;
    ex004FaceShadowDetectedFramesRef.current = 0;
    ex004FaceShadowLastUiUpdateMsRef.current = 0;
    ex004FaceShadowLastInferenceMsRef.current = null;
    setEx004FaceShadowLive({
      status: null,
      poseSignedDeg: null,
      faceSignedDeg: null,
      faceYawDeltaDeg: null,
      facePitchDeltaDeg: null,
      faceMinusPoseDeg: null,
      inferenceMs: null,
      attemptedFrames: 0,
      detectedFrames: 0,
    });
    if (typeof window !== "undefined") {
      window.__ex004FaceShadow = ex004FaceShadowRecordsRef.current;
    }
  }, []);

  // Capture readiness (HTML overlay, never mirrored)
  const [captureOk, setCaptureOk] = useState(true);
  const [captureMessage, setCaptureMessage] = useState("Captured");

  // Neutral calibration phase. Every monitored attempt freezes a camera-tilt
  // reference before clinical metrics, rep counting, or hold timing starts.
  //
  // The ref is what predictWebcam reads — the rAF chain holds a stale
  // closure on the React state, mirroring the lastCaptureOkRef pattern
  // used for captureOk. The state is only for re-rendering the JSX banner.
  type BaselinePhase = "not-needed" | "capturing" | "captured";
  const baselinePhaseRef = useRef<BaselinePhase>("not-needed");
  const [baselinePhase, setBaselinePhaseState] = useState<BaselinePhase>("not-needed");
  const [baselineProgress, setBaselineProgress] = useState({
    samples: 0,
    validElapsedMs: 0,
  });
  const setBaselinePhase = useCallback((phase: BaselinePhase) => {
    baselinePhaseRef.current = phase;
    setBaselinePhaseState(phase);
  }, []);
  const [displayPerSidePrimary, setDisplayPerSidePrimary] = useState<{
    left: number | null;
    right: number | null;
  } | null>(null);
  const compensationWarningSignalsRef = useRef<
    Map<MetricName, CompensationWarningSignal>
  >(new Map());

  const lastBadCaptureAtRef = useRef<number>(0);
  const stableOkSinceRef = useRef<number>(0);
  const captureDropoutStartedAtRef = useRef<number | null>(null);
  const captureDropoutResetDoneRef = useRef(false);

  const lastCaptureOkRef = useRef<boolean>(true);
  const lastCaptureMsgRef = useRef<string>("Captured");

  const [devices, setDevices] = useState<CamDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

  const [useFrontCameraHint, setUseFrontCameraHint] = useState(true);
  const [mirror, setMirror] = useState(true);

  const [viewportWidth, setViewportWidth] = useState(1280);
  const [viewportHeight, setViewportHeight] = useState(900);

  const searchParams = useSearchParams();
  const router = useRouter();
  const initialExerciseId = searchParams.get("exerciseId") ?? "";
  const initialOccurrenceIdParam = searchParams.get("occurrenceId");
  const initialOccurrenceIdRaw =
    initialOccurrenceIdParam === null ? Number.NaN : Number(initialOccurrenceIdParam);
  const initialOccurrenceId = Number.isInteger(initialOccurrenceIdRaw)
    ? initialOccurrenceIdRaw
    : null;

  const [assignedExercises, setAssignedExercises] = useState<Exercise[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<string>(initialExerciseId);

  // Latest finished session per exercise id (patient only), for the
  // "already completed" recap overlay. Populated once on mount from
  // `/api/sessions`. Empty for staff debug (no persisted sessions).
  const [sessionRecaps, setSessionRecaps] = useState<Map<string, ExerciseSessionRecap>>(
    new Map(),
  );
  // When true, the recap overlay for the current exercise is hidden (the
  // patient dismissed it). Reset on every exercise change so stepping to
  // another completed exercise re-shows its recap.
  const [recapDismissed, setRecapDismissed] = useState(false);

  // Strict schedule lock (patients): exercise ids that have an occurrence
  // actionable today — due today or still inside its make-up window. A patient
  // may only start one of these; the server enforces the same rule. Empty for
  // staff debug (which bypasses the lock entirely).
  const [actionableOccurrenceIds, setActionableOccurrenceIds] = useState<Set<number>>(new Set());
  // Set when a start is blocked because nothing is scheduled today for the
  // selected exercise (or the server rejects with 409).
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);

  // Open (un-ended) session per exercise id (patient only), from the same
  // on-mount `/api/sessions` fetch. The authoritative gate for offering a
  // resume: a disrupted session leaves its row open, whereas End / finish /
  // exercise-switch all stamp ended_at.
  const [openSessions, setOpenSessions] = useState<
    Map<string, { sessionId: number; startedAt: string }>
  >(new Map());
  // When true, the resume overlay for the current exercise is hidden.
  const [resumeDismissed, setResumeDismissed] = useState(false);

  // Reset both dismiss flags on every exercise change so stepping to another
  // exercise re-shows its recap / resume prompt.
  useEffect(() => {
    setRecapDismissed(false);
    setResumeDismissed(false);
    setScheduleNotice(null);
  }, [selectedExercise]);

  const [activeDefinition, setActiveDefinition] =
    useState<ExerciseDefinition | null>(null);

  /**
   * Ref mirror of `activeDefinition` state, read by `predictWebcam` to avoid
   * the stale-closure issue: the rAF loop kicked off in `startCamera` keeps
   * scheduling the same function instance, whose closure captured whatever
   * `activeDefinition` was at definition time. Without this ref, switching
   * exercises mid-session leaves the loop running with the previous
   * exercise's definition — wrong primary metric, wrong framing mode,
   * wrong rep counter state. The ref is sync'd via a dedicated useEffect
   * below so the rAF callback always reads the latest value.
   *
   * Added 2026-05-22. Replaces the pre-existing pattern where
   * `predictWebcam` read `activeDefinition` directly from the
   * closure and required a Stop → Start to pick up exercise changes.
   */
  const activeDefinitionRef = useRef<ExerciseDefinition | null>(null);
  useEffect(() => {
    activeDefinitionRef.current = activeDefinition;
  }, [activeDefinition]);

  /**
   * Ref mirrors of the selected exercise id and the ordered assigned-exercise
   * list, used by the guided-flow navigation. Auto-advance (all prescribed
   * sets complete) is triggered from inside the rAF loop via the
   * set-completion check, so it cannot read the closure-captured state — it
   * must read the current id and list from refs, same rationale as
   * `activeDefinitionRef`. `goToAdjacentExercise` also writes
   * `selectedExerciseRef.current` synchronously so rapid stepper clicks in the
   * same tick compute from a fresh base instead of a not-yet-synced ref.
   */
  const selectedExerciseRef = useRef<string>("");
  useEffect(() => {
    selectedExerciseRef.current = selectedExercise;
  }, [selectedExercise]);
  const assignedExercisesRef = useRef<Exercise[]>([]);
  useEffect(() => {
    assignedExercisesRef.current = assignedExercises;
  }, [assignedExercises]);

  // ─────────────────────────────────────────────────────────────────────────
  // Session lifecycle state (added 2026-05-22)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Session state machine. `sessionStateRef` mirrors the React state for
   * rAF-callback access (same pattern as `baselinePhaseRef`,
   * `activeDefinitionRef`, etc.). Rep counting in `predictWebcam` is
   * gated on `sessionStateRef.current === "active"`.
   */
  const sessionStateRef = useRef<SessionState>("idle");
  const [sessionState, setSessionStateRaw] = useState<SessionState>("idle");
  const setSessionState = (s: SessionState) => {
    sessionStateRef.current = s;
    setSessionStateRaw(s);
  };

  /**
   * Session start timestamp (performance.now() at the sidebar Start click).
   * Drives the elapsed-time display, refreshed once per second by the
   * timer useEffect when `sessionState === "active"`.
   */
  const sessionStartMsRef = useRef<number | null>(null);
  const countdownResumeElapsedMsRef = useRef<number | null>(null);
  const [sessionElapsedSec, setSessionElapsedSec] = useState(0);
  const [countdownSec, setCountdownSec] = useState(3);

  /**
   * Completed sets count for the current session. State + ref pair so
   * `predictWebcam` can both read it (set-completion check) and write
   * it (auto-end when target reached). Resets to 0 on session start or
   * exercise change.
   */
  const completedSetsRef = useRef(0);
  const [completedSets, setCompletedSetsRaw] = useState(0);
  const setCompletedSets = (n: number) => {
    completedSetsRef.current = n;
    setCompletedSetsRaw(n);
  };

  /**
   * Active prescription (target sets × per-side reps) for the currently
   * selected exercise. Comes from `assignedExercises[selectedExercise]`
   * (which is sourced from `patient_exercises` via API for patients, or
   * a fallback 3 × 12 for staff debug catalog). Drives the set-completion
   * threshold and the progress-bar denominator.
   */
  const prescriptionRef = useRef<Prescription>(DEFAULT_PRESCRIPTION);
  const [prescription, setPrescriptionRaw] = useState<Prescription>(DEFAULT_PRESCRIPTION);
  const reportSessionIdRef = useRef<number | null>(null);
  const showCompletionRecapAfterReportRef = useRef(false);
  const terminalOccurrenceAfterReportRef = useRef<
    "completed" | "pain_stopped" | null
  >(null);
  const [pendingCompletionNavigation, setPendingCompletionNavigation] = useState<{
    remaining: Exercise[];
    next: Exercise | null;
  } | null>(null);
  const [painScore, setPainScore] = useState(0);
  const [painTiming, setPainTiming] = useState<PainTiming | "">("");
  const [painBodyArea, setPainBodyArea] = useState("");
  const [painReportSaving, setPainReportSaving] = useState(false);
  const [painReportError, setPainReportError] = useState<string | null>(null);
  // Before-session pain survey. A new patient session waits for its answer,
  // and null (Back) cancels the start.
  const [preSessionSurvey, setPreSessionSurvey] = useState<{ score: number; bodyArea: string } | null>(null);
  const preSessionSurveyResolveRef = useRef<((answer: PreSessionPain | null) => void) | null>(null);
  const preSessionPainRef = useRef<PreSessionPain | null>(null);
  // Optional session video: a question after the pain survey, answered each
  // time unless the patient asked this device to remember the answer.
  const [videoQuestion, setVideoQuestion] = useState<{ remember: boolean } | null>(null);
  const videoQuestionResolveRef = useRef<((answer: { record: boolean; remember: boolean } | null) => void) | null>(null);
  const [, setVideoChoiceVersion] = useState(0);
  const videoConsentRef = useRef(false);
  const videoConsentRememberedRef = useRef(false);
  // The notice version the patient agreed to, sent so the server can check it.
  const videoConsentNoticeRef = useRef<string | null>(null);
  const recorderRef = useRef<SessionRecorder | null>(null);
  // Whether a Resume should keep recording: true once recording starts, false
  // after the patient stops it.
  const recordingWantedRef = useRef(false);
  const [recordingState, setRecordingState] = useState<RecordingState | "off">("off");
  // The session the end card describes, for its PDF report.
  const [lastSessionId, setLastSessionId] = useState<number | null>(null);

  /**
   * When true, the sidebar shows an inline confirm step instead of ending the
   * session immediately — guards against an accidental End click discarding an
   * in-progress exercise. Only meaningful while `active`; reset on session
   * start and on exercise change.
   */
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  /**
   * Ref mirror of `repCounts` state so the rAF loop's set-completion
   * check reads fresh per-side rep counts after each rep emit (instead
   * of the closure-captured stale value). The state is what the UI
   * renders; the ref is what predictWebcam reads/writes.
   *
   * Semantic note: `repCounts` now means "CURRENT SET reps,"
   * not "session-total reps." It resets to {0,0} on each set completion
   * and on session restart. Current-session rep events still
   * accumulate in `repLogRef.current.{left,right}` (a P4-friendly buffer
   * shape-aligned with the future `rep_events` table).
   */
  const repCountsRef = useRef<{ left: number; right: number }>({ left: 0, right: 0 });

  /**
   * P4-friendly log of completed sets in the current session. Shape-aligned
   * with the future Postgres `sets` table. In-memory
   * only for v1; a future P4 swap reads this and writes to DB. Cleared
   * on session start (Start button) and on exercise change.
   */
  const completedSetsLogRef = useRef<CompletedSetRecord[]>([]);

  /**
   * Session persistence (`set_events` + `rep_events`). A "session" here is one exercise run:
   * Start → all-sets-complete (or manual End). When the guided flow advances to
   * the next exercise the patient presses Start again, opening a new session.
   *
   *  - `sessionIdRef` — the DB id returned by POST /api/sessions, or null when
   *    no session is being persisted (staff debug, create pending/failed).
   *  - `sessionWallStartMsRef` / `sessionPerfStartMsRef` — Date.now() and
   *    performance.now() captured at create, used to convert the rep counter's
   *    monotonic timestamps into wall-clock start_ts/end_ts.
   *  - `globalRepIndexRef` — session-wide 1..N rep index across sides and sets.
   *  - `eventOutboxRef` — durable queue for rep/set outcomes. Items leave it
   *    only on an acknowledged OK response; failures are retried and anything
   *    still pending is reported at session end instead of being discarded.
   *    Enqueueing never blocks rep counting, hold accumulation, or the UI.
   */
  const sessionIdRef = useRef<number | null>(null);
  const sessionWallStartMsRef = useRef<number>(0);
  const sessionPerfStartMsRef = useRef<number>(0);
  const globalRepIndexRef = useRef<number>(0);
  const eventOutboxRef = useRef(
    new EventOutbox<RepEventPayload, SetEventPayload>({
      fetchFn: (url, init) => fetch(url, init),
      storage: typeof window !== "undefined" ? window.localStorage : null,
      onError: (kind, message) =>
        console.warn(`${kind}-events delivery failed (will retry):`, message),
    }),
  );
  // A session that ends before its outcome events are delivered leaves them in
  // localStorage (see endSessionPersistence), and only resuming used to read
  // them back, so an ended session's events never left the device. Send them
  // once per camera page load for the signed-in patient. Resumable sessions are
  // skipped because resuming re-adopts the same queue. The routes refuse other
  // patients' sessions, and anything refused stays stored.
  const outboxRecoveryStartedRef = useRef(false);
  useEffect(() => {
    if (user?.role !== "patient" || outboxRecoveryStartedRef.current) return;
    outboxRecoveryStartedRef.current = true;
    let storageKeys: string[];
    try {
      storageKeys = Object.keys(window.localStorage);
    } catch {
      return; // storage unavailable, so nothing was persisted either
    }
    const resumable = resumableSessionIds(storageKeys);
    const sessionIds = persistedOutboxSessionIds(storageKeys).filter(
      (id) => !resumable.has(id),
    );
    if (sessionIds.length === 0) return;
    void recoverPersistedOutboxes({
      sessionIds,
      fetchFn: (url, init) => fetch(url, init),
      storage: window.localStorage,
      onError: (kind, message) =>
        console.warn(`${kind}-events recovery failed (kept for the next load):`, message),
    })
      .then((recovered) => {
        const delivered = recovered.reduce(
          (sum, session) => sum + session.restored - session.remaining,
          0,
        );
        if (delivered > 0) {
          showToast({
            variant: "success",
            message: `Uploaded ${delivered} saved result${delivered === 1 ? "" : "s"} from an earlier session.`,
          });
        }
      })
      .catch((err) => console.warn("outbox recovery failed:", err));
  }, [user?.role, showToast]);
  const rawFrameIndexRef = useRef<number>(0);
  const pendingRawFramesRef = useRef<RawFramePayload[]>([]);
  /** Trace batches abandoned after exhausting retries, for honest reporting. */
  const rawFrameDroppedBatchesRef = useRef<number>(0);
  // The same losses per session, for the warning under the trace sync readout.
  // The upload chain outlives the render that queued it, so it reads the ref;
  // the state is what draws the warning.
  const traceUploadLossRef = useRef<TraceUploadLoss | null>(null);
  const [traceUploadLoss, setTraceUploadLoss] = useState<TraceUploadLoss | null>(null);
  // Opt-in tuning-trace recording (patient mode only, default OFF). The ref
  // mirrors the state for the rAF loop — same stale-closure pattern as
  // lastCaptureOkRef. Flipping mid-session simply starts/stops buffering;
  // frame_index stays monotonic, and gaps are an expected trace property.
  const [tuningTraceEnabled, setTuningTraceEnabledState] = useState(false);
  const tuningTraceEnabledRef = useRef(false);
  const setTuningTraceEnabled = useCallback((on: boolean) => {
    tuningTraceEnabledRef.current = on;
    setTuningTraceEnabledState(on);
  }, []);
  // Serial upload chain for raw-frame batches. Each queued request captures its
  // session id + rows, so an end/auto-advance reset cannot redirect an in-flight
  // batch into the next session.
  const rawFrameUploadChainRef = useRef<Promise<void>>(Promise.resolve());
  /**
   * Monotonic token identifying the currently-intended session run. Bumped on
   * every start and every end. Because session create is async, the create's
   * response handler compares the token it captured at request time against the
   * current one: if they differ, the run that asked for this session already
   * ended (cancel during countdown, exercise change, restart, ultra-short
   * session), so the just-created row is immediately closed instead of being
   * adopted — preventing orphan open rows and stale-id overwrites.
   */
  const sessionTokenRef = useRef<number>(0);
  const endSessionPersistenceRef = useRef<
    (
      completed?: boolean,
      endReason?: "user" | "pain",
    ) => Promise<EndSessionPersistenceResult>
  >(() => Promise.resolve("skipped"));
  /**
   * If an end (notably the End button) fires before the session create resolves,
   * there's no row yet to PATCH — stash the intended end reason here so the
   * create's stale-close path can record it. Without this, a fast End on a slow
   * create leaves `end_reason` NULL and the dashboard mislabels the attempt as
   * "In Progress" instead of "Ended Early". Reset on each start and after use.
   */
  const pendingStaleEndReasonRef = useRef<"user" | "pain" | undefined>(undefined);

  // Capture-quality tally for the current session (→ sessions.capture_quality_summary).
  // Counts frames processed while the session is active and how many had OK
  // capture readiness, so the dashboard can distinguish a genuinely low-ROM
  // session from one degraded by poor tracking/framing. Reset on session start.
  const captureFramesTotalRef = useRef<number>(0);
  const captureFramesOkRef = useRef<number>(0);
  // Why active frames were rejected (the readiness status, or "NOT_VISIBLE"
  // when no person was found), and how often a rejection lasting the dropout
  // grace discarded the movement in progress. Saved with the summary.
  const captureRejectedByStatusRef = useRef<Record<string, number>>({});
  const captureDropoutResetsRef = useRef<number>(0);
  // Unsteady-tracking check (display only): its state, the part its message
  // names, each processed frame's marks for the repetitions' tracking records,
  // and the session's unsteady frames (→ capture_quality_summary).
  const steadinessRef = useRef<SteadinessState>(newSteadinessState());
  const trackingMessageRef = useRef<TrackingMessageState>(NO_TRACKING_MESSAGE);
  const trackingMarksRef = useRef<TrackingFrameMark[]>([]);
  const captureUnsteadyFramesRef = useRef<number>(0);
  const captureCheckedFramesRef = useRef<number>(0);
  const trackingHintRef = useRef<string | null>(null);
  const [trackingHint, setTrackingHint] = useState<string | null>(null);

  /**
   * Reset all in-memory session-persistence state (no DB call).
   *
   * This discards anything still queued, so callers that end a session must
   * drain the outbox FIRST — see `endSessionPersistence`. Reaching here with a
   * non-empty queue means those outcomes were abandoned deliberately (session
   * never adopted) or already reported to the patient as undelivered.
   */
  const resetSessionPersistence = () => {
    sessionIdRef.current = null;
    globalRepIndexRef.current = 0;
    eventOutboxRef.current.setSession(null);
    rawFrameIndexRef.current = 0;
    pendingRawFramesRef.current = [];
    dynamicRepQualityBufferRef.current.reset();
    // Frame indices restart at 1, so a readout left over from the previous
    // session names a row number that now belongs to a different session.
    writeTraceSyncReadout(TRACE_SYNC_PLACEHOLDER);
  };

  /**
   * Open a persisted session for the active exercise, if it is a patient
   * assignment (has a patient_exercise_id). Staff debug has none → no-op.
   * Returns false when the server refuses the start, so the UI can stay idle
   * instead of running a local-only session that will never persist.
   */
  const startSessionPersistence = async (): Promise<boolean> => {
    resetSessionPersistence();
    // Cleared here, not in resetSessionPersistence: that also runs at End, and
    // a save warning has to stay on screen after the session it describes.
    traceUploadLossRef.current = null;
    setTraceUploadLoss(null);
    reportSessionIdRef.current = null;
    showCompletionRecapAfterReportRef.current = false;
    terminalOccurrenceAfterReportRef.current = null;
    setPendingCompletionNavigation(null);
    pendingStaleEndReasonRef.current = undefined;
    const patientExerciseId = prescriptionRef.current.patientExerciseId;
    const occurrenceId = prescriptionRef.current.occurrenceId;
    const exerciseId = activeDefinitionRef.current?.id;
    if (typeof patientExerciseId !== "number" || !exerciseId) return true;
    if (typeof occurrenceId !== "number") {
      setScheduleNotice("Choose an exercise from today's schedule before starting.");
      return false;
    }
    // Token for THIS run; if it changes before the create resolves, the run is
    // already over and the created row must be closed rather than adopted.
    const token = ++sessionTokenRef.current;
    sessionWallStartMsRef.current = Date.now();
    sessionPerfStartMsRef.current = performance.now();
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientExerciseId,
          occurrenceId,
          exerciseId,
          coaching: coachingProvenanceRef.current ?? undefined,
          preSessionPain: preSessionPainRef.current ?? undefined,
          videoConsent: videoConsentRef.current || undefined,
          videoConsentRemembered: videoConsentRef.current && videoConsentRememberedRef.current ? true : undefined,
          videoNotice: videoConsentRef.current ? videoConsentNoticeRef.current ?? undefined : undefined,
          deviceInfo:
            typeof navigator !== "undefined"
              ? { userAgent: navigator.userAgent }
              : undefined,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const fallback =
          response.status === 409
            ? "This exercise isn't scheduled for today, so the session was not started."
            : "The session could not be saved, so it was not started.";
        setScheduleNotice(
          (body && typeof body.error === "string" && body.error) || fallback,
        );
        resetSessionPersistence();
        return false;
      }

      const data = await response.json();
      const runtime = data?.runtimePrescription as RuntimePrescription | undefined;
      if (
        !data ||
        typeof data.sessionId !== "number" ||
        !runtime ||
        runtime.patientExerciseId !== patientExerciseId ||
        runtime.occurrenceId !== occurrenceId ||
        runtime.exerciseId !== exerciseId ||
        !Number.isInteger(runtime.occurrenceId) ||
        !Number.isFinite(runtime.sets) ||
        !Number.isFinite(runtime.reps) ||
        (runtime.prescribedSide !== "both" &&
          runtime.prescribedSide !== "left" &&
          runtime.prescribedSide !== "right")
      ) {
        setScheduleNotice("The session could not be saved, so it was not started.");
        resetSessionPersistence();
        return false;
      }

      if (sessionTokenRef.current === token) {
        // Still the active run — adopt the session and flush buffered outcomes.
        // Adoption preserves anything queued while the create was in flight.
        sessionIdRef.current = data.sessionId;
        eventOutboxRef.current.setSession(data.sessionId);
        const authoritativePrescription: Prescription = {
          sets: runtime.sets,
          reps: runtime.reps,
          restSeconds: runtime.restSeconds,
          holdSeconds: runtime.holdSeconds,
          patientExerciseId: runtime.patientExerciseId,
          occurrenceId: runtime.occurrenceId,
          prescribedSide: runtime.prescribedSide,
          resistance: runtime.resistance,
        };
        prescriptionRef.current = authoritativePrescription;
        setPrescriptionRaw(authoritativePrescription);
        flushSetEvents();
        flushRepEvents();
        flushRawFrames();
        // This may no-op before the session reaches active/resting, but it is
        // safe to keep for the slow-create disruption case.
        writeResumeSnapshot();
        return true;
      }

      // Stale: the run ended/changed before create resolved. Close the
      // freshly-created row so it isn't left open, and do NOT adopt its id.
      // Carry any end reason captured while the create was in flight (e.g. a
      // fast End-button press) so the row isn't mislabeled "In Progress".
      fetch(`/api/sessions/${data.sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completed: false,
          endReason: pendingStaleEndReasonRef.current ?? "user",
        }),
      }).catch((err) => console.warn("stale session close failed:", err));
      pendingStaleEndReasonRef.current = undefined;
      return false;
    } catch (err) {
      console.warn("session create failed (not persisted):", err);
      setScheduleNotice("The session could not be saved, so it was not started.");
      resetSessionPersistence();
      return false;
    }
  };

  /** Convert a monotonic performance.now() timestamp to an ISO wall-clock string. */
  const perfToIso = (perfMs: number): string =>
    new Date(
      sessionWallStartMsRef.current + (perfMs - sessionPerfStartMsRef.current),
    ).toISOString();

  /**
   * Buffer one valid active frame for patient-session threshold/scoring
   * tuning. Inputs are raw/unsmoothed metric values and selected normalized
   * landmarks only — never image data. Opt-in: gated on the "Record tuning
   * trace" toggle (default OFF), so ordinary patient sessions write nothing.
   * Originally an always-on ex_007-only trace (`ex_007_upper_body_v1`);
   * now covers every active exercise with the versioned V4 payload.
   */
  /**
   * Write the sync readout, skipping the DOM when the text has not changed.
   *
   * The only writer of that node. Routing every update through one function is
   * what makes "a reading on screen belongs to the frame you are looking at"
   * checkable rather than a property spread across the loop's branches.
   */
  const writeTraceSyncReadout = (text: string): void => {
    applyTraceSyncReadout(traceSyncElRef.current, text);
  };

  const bufferTuningRawFrame = (
    landmarks: NormalizedLandmark[],
    worldLandmarks: Landmark[] | undefined,
    raw: ExerciseFrameMetrics,
    observedTilt: TiltReference,
    tNow: number,
  ) => {
    if (!tuningTraceEnabledRef.current) return;
    if (prescriptionRef.current.patientExerciseId === undefined) return;
    const def = activeDefinitionRef.current;
    if (!def || DEPRECATED_EXERCISE_IDS.has(def.id)) return;
    if (sessionStateRef.current !== "active") return;

    const setIndex = completedSetsRef.current + 1;

    // V4: emit the retained calibration samples ONCE per set, on the first
    // captured frame after calibration finalizes. Repeating a ring of up to 300
    // samples on every frame would multiply the trace size for no information,
    // and emitting during "capturing" would persist an incomplete set.
    // The raw ring is NOT readable here. `finalizeNeutralCalibration` frees it
    // as soon as it has taken its medians, and only then flips the phase to
    // "captured" that gates this block — so by the time this runs the ring is
    // always empty. It snapshots the samples into `calibrationTraceSamplesRef`
    // immediately before freeing them, and that snapshot is what this reads.
    // Reading the ring instead wrote `samples: []` and still marked the set
    // emitted, so no later frame retried; that is how the first v4
    // implementation shipped completely inert.
    let calibrationSamples: CalibrationSample[] | undefined;
    if (
      baselinePhaseRef.current === "captured" &&
      calibrationSamplesEmittedSetRef.current !== setIndex
    ) {
      calibrationSamples = calibrationTraceSamplesRef.current ?? undefined;
      if (calibrationSamples) calibrationSamplesEmittedSetRef.current = setIndex;
    }

    const frameIndex = ++rawFrameIndexRef.current;
    const elapsedMs = Math.max(0, Math.round(tNow - sessionPerfStartMsRef.current));

    // Screen-recording sync readout, written from the SAME two locals that go
    // into the payload below rather than from a clock of its own. That is the
    // whole guarantee: a value read off a paused video frame names a row that
    // EXISTS in the export, instead of one that is merely close to it. Any
    // parallel time source here would quietly reintroduce the drift this
    // readout exists to remove.
    //
    // Reaching this line is also what marks the frame as traced. Everything
    // above returns early, and the caller only calls at all once capture is
    // readable and a baseline is frozen, so any frame that does not get here
    // is blanked at the bottom of the loop instead of keeping this value.
    writeTraceSyncReadout(
      formatTraceSyncReadout(frameIndex, elapsedMs) ?? TRACE_SYNC_PLACEHOLDER,
    );
    traceSyncWroteThisFrameRef.current = true;

    pendingRawFramesRef.current.push({
      frameIndex,
      setIndex,
      elapsedMs,
      capturedAt: perfToIso(tNow),
      traceKind: "upper_body_v4",
      metrics: upperBodyTraceMetrics(
        landmarks,
        raw,
        observedTilt,
        def.id,
        {
          scapLeft: leftScapBaselineRef.current.value,
          scapRight: rightScapBaselineRef.current.value,
          bidirectionalPrimary: bidirectionalBaselineRef.current.value,
        },
        baselinePhaseRef.current,
        neutralCalibrationClockRef.current,
        videoResolutionRef.current
          ? {
              width: videoResolutionRef.current.width,
              height: videoResolutionRef.current.height,
            }
          : null,
        calibrationSamples,
        upperBodyTraceWorldLandmarks(worldLandmarks),
      ),
      landmarks: upperBodyTraceLandmarks(landmarks),
    });

    if (pendingRawFramesRef.current.length >= RAW_FRAME_UPLOAD_BATCH_SIZE) {
      flushRawFrames();
    }
  };

  /**
   * Queue pending raw-frame batches for upload, serializing them so a long set
   * cannot fire a burst of concurrent large JSON requests.
   *
   * Unlike rep/set outcomes these are opt-in tuning traces, not clinical
   * outcome data, so they are retried a bounded number of times and then given
   * up on rather than persisted across reloads — a trace batch is large enough
   * that queueing it in localStorage risks the storage quota. Dropped batches
   * are counted and drawn under the trace sync readout, because a console
   * warning alone let whole sessions record while every upload was refused.
   */
  const flushRawFrames = () => {
    const sessionId = sessionIdRef.current;
    if (sessionId === null || pendingRawFramesRef.current.length === 0) return;

    while (pendingRawFramesRef.current.length > 0) {
      const frames = pendingRawFramesRef.current.splice(
        0,
        RAW_FRAME_UPLOAD_BATCH_SIZE,
      );
      rawFrameUploadChainRef.current = rawFrameUploadChainRef.current
        .catch(() => undefined)
        .then(async () => {
          for (let attempt = 1; attempt <= RAW_FRAME_UPLOAD_ATTEMPTS; attempt += 1) {
            // This attempt's HTTP status for the warning; null if no response came.
            let failedStatus: number | null = null;
            try {
              const response = await fetch(
                `/api/sessions/${sessionId}/raw-frames`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ frames }),
                },
              );
              // `fetch` resolves for 4xx/5xx, so the status must be checked.
              if (!response.ok) {
                failedStatus = response.status;
                throw new Error(`raw-frames upload returned ${response.status}`);
              }
              return;
            } catch (err) {
              if (attempt === RAW_FRAME_UPLOAD_ATTEMPTS) {
                rawFrameDroppedBatchesRef.current += 1;
                console.warn(
                  `raw-frames batch dropped after ${attempt} attempts ` +
                    `(${rawFrameDroppedBatchesRef.current} total this session):`,
                  err,
                );
                const loss = recordTraceBatchLoss(
                  traceUploadLossRef.current,
                  sessionId,
                  failedStatus,
                );
                traceUploadLossRef.current = loss;
                setTraceUploadLoss(loss);
                // Toast once per session; the line under the readout keeps count.
                if (loss.droppedBatches === 1) {
                  showToast({ variant: "error", message: traceUploadLossToast(loss) });
                }
                return;
              }
              await new Promise((resolve) =>
                setTimeout(resolve, RAW_FRAME_RETRY_BASE_MS * 2 ** (attempt - 1)),
              );
            }
          }
        });
    }
  };

  /** Buffer a counted rep for persistence. Pure aside from the ref push. */
  const bufferRepEvent = (event: RepEvent, side: RepEventPayload["side"]) => {
    if (prescriptionRef.current.patientExerciseId === undefined) return;
    const definition = activeDefinitionRef.current;
    const targetRom =
      definition?.kind === "dynamic"
        ? definition.primaryMetric.thresholds.targetROM
        : 0;
    const qualityChannel: RepQualityChannel =
      definition?.bilateralMode === "per-limb" &&
      (side === "left" || side === "right")
        ? side
        : "single";
    const scoredCompensations =
      definition?.compensationMetrics.filter(
        (spec) => getCompensationScoring(spec).mode !== "off",
      ) ?? [];
    const quality = dynamicRepQualityBufferRef.current.finalize(
      qualityChannel,
      event,
      scoredCompensations,
    );
    // How well the camera tracked this repetition's parts, from the frames
    // marked between its start and end (display-only tracking check); none
    // when the marks no longer reach back to its start.
    const tracking = repTracking(
      trackingMarksRef.current,
      event.startTimeMs,
      event.endTimeMs,
      trackingParts(definition ? trackingRegion(definition) : "arms", side === "left" || side === "right" ? side : "both"),
    );
    const compensations = tracking ? { ...quality, tracking } : quality;
    eventOutboxRef.current.enqueue("rep", {
      repIndex: ++globalRepIndexRef.current,
      setIndex: completedSetsRef.current + 1,
      side,
      peakValue: event.peakValue,
      targetRom,
      timeToPeakMs: event.ascentDurationMs,
      holdMs: event.holdDurationMs,
      descentMs: event.descentDurationMs,
      totalMs: event.totalDurationMs,
      classification: event.classification,
      compensations,
      startTs: perfToIso(event.startTimeMs),
      endTs: perfToIso(event.endTimeMs),
    });
  };

  /**
   * Close out the per-frame isometric accumulators into a HoldQuality summary.
   * Returns undefined when no hold samples were collected (e.g. dynamic set, or
   * a hold that never produced a usable frame). Pure read of the accumulator
   * ref — call BEFORE the per-set reset runs.
   */
  const finalizeHoldQuality = (centerDeg: number): HoldQualityV2 | undefined => {
    const a = holdQualityAccumRef.current;
    if (a.sampleCount === 0) return undefined;
    const side = (s: HoldSideAccum): HoldSideQuality | null => {
      if (s.w <= 0) return null;
      const mean = s.wa / s.w;
      const variance = Math.max(0, s.wa2 / s.w - mean * mean);
      // Weighted least-squares slope of angle (a) vs time (t), weight = dt.
      const denom = s.w * s.wt2 - s.wt * s.wt;
      const slopeMsPerDeg =
        denom > 0 ? (s.w * s.wta - s.wt * s.wa) / denom : 0; // deg per ms
      const round1 = (n: number) => Math.round(n * 10) / 10;
      return {
        meanDeg: round1(mean),
        sdDeg: round1(Math.sqrt(variance)),
        meanErrorDeg: round1(mean - centerDeg),
        droopSlopeDegPerSec: Math.round(slopeMsPerDeg * 1000 * 100) / 100,
      };
    };
    return {
      version: "hold_quality_v2",
      primaryUnits: "pipeline-units",
      compensationScoreSource: "smoothed-live-rule",
      streakMode: activeDefinitionRef.current?.bilateralMode === "bidirectional-alternating" ? "either-side" : "simultaneous",
      sampleCount: a.sampleCount,
      leftInBandMs: Math.round(a.left.inBandMs),
      rightInBandMs: Math.round(a.right.inBandMs),
      outOfPositionMs: Math.round(a.outOfPositionMs),
      dropCount: a.dropCount,
      longestPairedStreakMs: Math.round(a.longestStreakMs),
      settleMs: a.settleMs === null ? null : Math.round(a.settleMs),
      left: side(a.left),
      right: side(a.right),
      meanCompensationScore:
        a.scoreWeight > 0 ? Math.round(a.scoreWSum / a.scoreWeight) : null,
      minCompensationScore: a.scoreMin,
    };
  };

  /** Buffer a set-level outcome for persistence. */
  const bufferSetEvent = (
    record: CompletedSetRecord,
    exerciseKind: SetEventPayload["exerciseKind"],
    endPerfMs: number,
    auditOnly = false,
  ) => {
    if (prescriptionRef.current.patientExerciseId === undefined) return;
    const durationMs = Math.max(0, record.durationMs);
    const startPerfMs = currentSetStartMsRef.current ?? endPerfMs - durationMs;
    // Read the hold-quality accumulators for isometric sets BEFORE any per-set
    // reset clears them. Uses the active exercise's target-band center.
    const def = activeDefinitionRef.current;
    let holdQuality: SetMeasurement | undefined =
      exerciseKind === "isometric" && def?.kind === "isometric"
        ? finalizeHoldQuality(def.isometric.targetBand.center)
        : undefined;
    const provenance = coachingProvenanceRef.current;
    if (provenance) {
      const coaching = coachingAuditRef.current.snapshot(provenance, endPerfMs, perfToIso(0));
      if (holdQuality) holdQuality = { ...holdQuality, coaching };
      else if (exerciseKind === "dynamic") holdQuality = { version: "coaching_set_v1", coaching };
      else holdQuality = { version: "hold_quality_v2", primaryUnits: "pipeline-units",
        compensationScoreSource: "smoothed-live-rule", streakMode: def?.bilateralMode === "bidirectional-alternating" ? "either-side" : "simultaneous",
        sampleCount: 0, leftInBandMs: 0, rightInBandMs: 0, outOfPositionMs: 0,
        dropCount: 0, longestPairedStreakMs: 0, settleMs: null, left: null, right: null,
        meanCompensationScore: null, minCompensationScore: null, coaching };
    }
    // Without a versioned envelope there is no safe way to classify an audit
    // attempt. Normal Start establishes provenance before persistence opens.
    if (auditOnly && !holdQuality) return;
    if (auditOnly && holdQuality) holdQuality = { ...holdQuality, auditOnly: true };
    eventOutboxRef.current.enqueue("set", {
      setIndex: record.setIndex,
      exerciseKind,
      targetReps: record.targetReps,
      leftReps: record.leftReps,
      rightReps: record.rightReps,
      pairedReps: record.pairedReps,
      targetHoldMs: record.targetHoldMs ?? 0,
      pairedHoldMs: record.pairedHoldMs ?? 0,
      durationMs,
      terminatedBy: record.terminatedBy,
      asymmetryIndex: record.asymmetryIndex,
      holdQuality,
      startTs: perfToIso(startPerfMs),
      endTs: perfToIso(endPerfMs),
    });
    coachingAuditRef.current.reset();
  };

  /**
   * Ask the outbox to deliver queued set outcomes. Kept separate from rep
   * flushing so ex_006 can persist a set even when no rep_events exist.
   *
   * Both flushers are non-blocking: the outbox keeps items until the server
   * acknowledges them and retries on its own, so a failure here delays delivery
   * rather than losing it. No-op while the session id is unresolved.
   */
  const flushSetEvents = () => {
    void eventOutboxRef.current.flush("set");
  };

  const flushRepEvents = () => {
    void eventOutboxRef.current.flush("rep");
  };

  /**
   * Close the persisted session: flush remaining reps, then stamp ended_at.
   * Idempotent — no-op when no session is open. Clears persistence state so a
   * subsequent stray rep can't write to the just-ended session.
   */
  const endSessionPersistence = (
    completed = false,
    endReason?: "user" | "pain",
  ): Promise<EndSessionPersistenceResult> => {
    const sessionId = sessionIdRef.current;
    const hasPatientAssignment =
      typeof prescriptionRef.current.patientExerciseId === "number";
    stopSessionRecording();
    // Invalidate any in-flight create for this run. If the create has not
    // resolved yet (sessionId still null), its handler will see the bumped
    // token and self-close the row it creates, so nothing is left open.
    sessionTokenRef.current++;
    if (sessionId === null) {
      // Create hasn't resolved yet — stash the reason so the create's stale-close
      // can record it on the row it self-closes (e.g. a fast End press).
      pendingStaleEndReasonRef.current = endReason;
      resetSessionPersistence();
      setLastSessionId(null);
      return Promise.resolve(hasPatientAssignment ? "pending" : "skipped");
    }
    reportSessionIdRef.current = sessionId;
    // The end card offers this session's PDF only once every result is saved.
    setLastSessionId(null);
    const endToken = sessionTokenRef.current;
    flushRawFrames();
    // Session-level capture-quality summary: the % of active frames with OK
    // capture, why the others were rejected, how often a sustained
    // rejection discarded the movement in progress, and the camera picture's
    // size (readings depend on its shape; the thresholds were tuned on 16:9).
    const captureQualitySummary = buildCaptureQualitySummary({
      total: captureFramesTotalRef.current,
      ok: captureFramesOkRef.current,
      rejectedByStatus: captureRejectedByStatusRef.current,
      dropoutResets: captureDropoutResetsRef.current,
      unsteady: captureUnsteadyFramesRef.current,
      checked: captureCheckedFramesRef.current,
      frame: videoResolutionRef.current,
    });
    // `completed` is true only when all prescribed sets were finished (not on a
    // manual early End) — it flips the patient_exercise to "completed" server-side.
    const endRequest = fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        completed,
        captureQualitySummary,
        endReason: completed ? "completed" : endReason ?? "user",
      }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`session end returned ${response.status}`);
        }
        return "saved" as const;
      })
      .catch((err) => {
        console.warn("session end failed:", err);
        return "failed" as const;
      });

    // The outcome events decide the reported result alongside the session row.
    // Previously the PATCH alone produced "Session saved.", so a session could
    // be reported as saved with every repetition silently lost.
    return (async (): Promise<EndSessionPersistenceResult> => {
      const outbox = eventOutboxRef.current;
      const [rowResult, drainResult] = await Promise.all([
        endRequest,
        outbox.drain({ timeoutMs: SESSION_END_DRAIN_TIMEOUT_MS }),
      ]);
      if (drainResult.drained) outbox.clearStorage(sessionId);
      // Anything still queued stays persisted for the next load; reset only
      // after the drain has had its chance, never before.
      resetSessionPersistence();
      const result = rowResult === "failed" ? "failed" : drainResult.drained ? "saved" : "partial";
      // A newer run owns the end card if one started while this one drained.
      if (sessionTokenRef.current === endToken) setLastSessionId(result === "saved" ? sessionId : null);
      return result;
    })();
  };
  endSessionPersistenceRef.current = endSessionPersistence;

  const showSessionPersistenceToast = useCallback(
    (result: EndSessionPersistenceResult) => {
      if (result === "saved") {
        showToast({ variant: "success", message: "Session saved." });
      } else if (result === "partial") {
        // The session row closed but some reps/sets were not delivered. Nothing
        // retries them once the session ends; they stay in localStorage, and the
        // next camera page load sends them (outbox recovery).
        showToast({
          variant: "info",
          message:
            "Session saved. Some results haven't uploaded yet — they're kept on this device and will be sent the next time you open the camera.",
        });
      } else if (result === "pending") {
        showToast({
          variant: "info",
          message: "Session is finalizing in the background.",
        });
      } else if (result === "failed") {
        showToast({
          variant: "error",
          message: "Session save failed. Please try again.",
        });
      }
    },
    [showToast],
  );

  const finishPostAttemptReport = () => {
    const shouldShowCompletionRecap = showCompletionRecapAfterReportRef.current;
    showCompletionRecapAfterReportRef.current = false;
    const terminalOutcome = terminalOccurrenceAfterReportRef.current;
    terminalOccurrenceAfterReportRef.current = null;
    reportSessionIdRef.current = null;
    setPainReportError(null);
    setPainScore(0);
    setPainTiming("");
    setPainBodyArea("");
    const currentOccurrenceId = prescriptionRef.current.occurrenceId;
    if (terminalOutcome && currentOccurrenceId !== undefined) {
      const { remaining, next } = removeActionableOccurrence(
        assignedExercisesRef.current,
        currentOccurrenceId,
      );
      setActionableOccurrenceIds((previous) => {
        const next = new Set(previous);
        next.delete(currentOccurrenceId);
        return next;
      });

      if (terminalOutcome === "completed" && shouldShowCompletionRecap) {
        // Keep the just-finished exercise mounted until the patient explicitly
        // acknowledges its side-aware recap. Applying `remaining` here would
        // remove the active definition and make the existing recap unreachable.
        setPendingCompletionNavigation({ remaining, next });
        setSessionState("ended");
        return;
      }

      assignedExercisesRef.current = remaining;
      setAssignedExercises(remaining);
      if (user?.role === "patient") {
        router.push("/dashboard/patient?tab=session");
        return;
      }
    }
    setSessionState("ended");
  };

  const savePainReport = async (declined: boolean) => {
    const sessionId = reportSessionIdRef.current;
    if (sessionId === null) {
      finishPostAttemptReport();
      return;
    }
    setPainReportSaving(true);
    setPainReportError(null);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/pain-report`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          declined
            ? { status: "declined" }
            : {
                status: "reported",
                score: painScore,
                timing: painTiming || null,
                bodyArea: painBodyArea.trim() || null,
              },
        ),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          body && typeof body.error === "string"
            ? body.error
            : "The pain report could not be saved.",
        );
      }
      finishPostAttemptReport();
    } catch (error) {
      setPainReportError(
        error instanceof Error
          ? error.message
          : "The pain report could not be saved.",
      );
    } finally {
      setPainReportSaving(false);
    }
  };

  const continueFromCompletionRecap = (destination: "next" | "schedule") => {
    const pending = pendingCompletionNavigation;
    if (!pending) return;

    if (destination === "next" && pending.next) {
      setPendingCompletionNavigation(null);
      assignedExercisesRef.current = pending.remaining;
      setAssignedExercises(pending.remaining);
      selectedExerciseRef.current = pending.next.id;
      setSelectedExercise(pending.next.id);
      if (user?.role === "patient" && pending.next.occurrenceId !== undefined) {
        router.replace(
          `/camera?occurrenceId=${pending.next.occurrenceId}&exerciseId=${encodeURIComponent(pending.next.id)}`,
          { scroll: false },
        );
      }
      setSessionState("idle");
      return;
    }

    if (user?.role === "patient") {
      router.push("/dashboard/patient?tab=session");
      return;
    }
    setPendingCompletionNavigation(null);
  };

  /**
   * Timestamp when the CURRENT set started (used for `CompletedSetRecord.durationMs`).
   * Reset on session start and on each set completion.
   */
  const currentSetStartMsRef = useRef<number | null>(null);

  /**
   * Persist a resume snapshot of the live session to localStorage so a
   * disruption (tab close / navigation / refresh, anything but the End button)
   * can be resumed on return. Reads everything from refs; no-op unless a real
   * patient session is currently running. Cheap synchronous write — safe to
   * call from the per-second tick, each rep/set boundary, and `pagehide`.
   */
  const writeResumeSnapshot = useCallback(() => {
    const patientExerciseId = prescriptionRef.current.patientExerciseId;
    const sessionId = sessionIdRef.current;
    const def = activeDefinitionRef.current;
    const state = sessionStateRef.current;
    if (
      typeof patientExerciseId !== "number" ||
      sessionId === null ||
      def === null ||
      sessionStartMsRef.current === null ||
      (state !== "active" && state !== "resting")
    ) {
      return;
    }
    const snapshot: ResumeSnapshot = {
      v: 1,
      sessionId,
      exerciseId: def.id,
      patientExerciseId,
      kind: def.kind,
      completedSets: completedSetsRef.current,
      currentSetReps: {
        left: repCountsRef.current.left,
        right: repCountsRef.current.right,
      },
      pairedHoldMs: pairedHoldMsRef.current,
      sideHoldMs: {
        left: leftHoldMsRef.current,
        right: rightHoldMsRef.current,
      },
      elapsedMs: Math.max(0, performance.now() - sessionStartMsRef.current),
      globalRepIndex: globalRepIndexRef.current,
      rawFrameIndex: rawFrameIndexRef.current,
      updatedAtWallMs: Date.now(),
      completedSetsLog: completedSetsLogRef.current,
      repOutcomes: sessionRepOutcomes(priorRepOutcomesRef.current, repLogRef.current),
      recordVideo: recordingWantedRef.current || undefined,
      captureFrames: {
        total: captureFramesTotalRef.current,
        ok: captureFramesOkRef.current,
        rejectedByStatus: { ...captureRejectedByStatusRef.current },
        dropoutResets: captureDropoutResetsRef.current,
        unsteady: captureUnsteadyFramesRef.current,
        checked: captureCheckedFramesRef.current,
      },
    };
    try {
      window.localStorage.setItem(
        resumeKey(patientExerciseId),
        JSON.stringify(snapshot),
      );
    } catch {
      /* localStorage unavailable / quota — resume just won't be offered */
    }
  }, []);

  /**
   * Rest-between-sets countdown. `restEndsAtMsRef` is the performance.now()
   * timestamp at which rest ends (monotonic, same clock as the session timer);
   * `restRemainingSec` is the displayed countdown. Meaningful only while
   * `sessionState === "resting"`.
   */
  const restEndsAtMsRef = useRef<number | null>(null);
  const [restRemainingSec, setRestRemainingSec] = useState(0);

  /**
   * Session timer: ticks `sessionElapsedSec` once per second while the
   * session is active. Driven off `performance.now()` against the start
   * timestamp captured in `sessionStartMsRef` so it's monotonic and
   * doesn't drift when the tab is backgrounded (the cleanup interval is
   * paused by the browser, but on re-tick the next tick computes from the
   * fresh real-time delta, not by incrementing a counter).
   */
  useEffect(() => {
    // Total session time keeps running through rest, so it reflects wall-clock
    // (per-set durationMs excludes rest separately via currentSetStartMsRef).
    if (sessionState !== "active" && sessionState !== "resting") return;
    if (sessionStartMsRef.current === null) return;
    const tick = () => {
      if (sessionStartMsRef.current === null) return;
      const elapsed = Math.floor(
        (performance.now() - sessionStartMsRef.current) / 1000,
      );
      setSessionElapsedSec(elapsed);
      // Keep the resume snapshot fresh (elapsed + current counter/sets) so a
      // disruption loses at most ~1s of progress.
      writeResumeSnapshot();
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [sessionState, writeResumeSnapshot]);

  /**
   * Capture the resume snapshot on disruption paths the timer tick can miss:
   * `pagehide` (tab close / refresh / bfcache), `visibilitychange` → hidden
   * (tab switch / mobile background), and component unmount (SPA navigation
   * away from the camera route). `writeResumeSnapshot` self-guards, so these
   * are no-ops unless a patient session is actively running.
   */
  useEffect(() => {
    const flush = () => writeResumeSnapshot();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [writeResumeSnapshot]);

  /**
   * Rest countdown. While `sessionState === "resting"`, tick down the seconds
   * remaining against `restEndsAtMsRef` (performance.now()-delta, so it
   * survives tab backgrounding). When it elapses, resume the next set: stamp a
   * fresh `currentSetStartMsRef` (so the next set's durationMs excludes the
   * rest) and flip back to "active". Rep counting stays gated off the whole
   * time because the rep gate requires "active".
   */
  useEffect(() => {
    if (sessionState !== "resting") return;
    const tick = () => {
      if (restEndsAtMsRef.current === null) return;
      const remainingMs = restEndsAtMsRef.current - performance.now();
      if (remainingMs <= 0) {
        restEndsAtMsRef.current = null;
        setRestRemainingSec(0);
        currentSetStartMsRef.current = performance.now();
        setSessionState("active");
      } else {
        setRestRemainingSec(Math.ceil(remainingMs / 1000));
      }
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [sessionState]);

  /** Neutral-calibration countdown. It cannot open the outcome gate early. */
  useEffect(() => {
    if (sessionState !== "countdown") return;
    setCountdownSec(3);
    const tick = () => {
      const clock = neutralCalibrationClockRef.current;
      const remaining = Math.max(
        0,
        Math.ceil(
          (NEUTRAL_CALIBRATION_DURATION_MS - clock.validElapsedMs) / 1_000,
        ),
      );
      setCountdownSec(remaining);
      if (
        sessionStateRef.current === "countdown" &&
        baselinePhaseRef.current === "captured"
      ) {
        const now = performance.now();
        const resumedElapsed = countdownResumeElapsedMsRef.current;
        sessionStartMsRef.current =
          resumedElapsed === null ? now : now - resumedElapsed;
        currentSetStartMsRef.current = now;
        countdownResumeElapsedMsRef.current = null;
        setSessionState("active");
      }
    };
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [sessionState]);

  /**
   * Asymmetry index for the future `sets` table shape. `|left − right| / max(left, right)`,
   * clamped to 0 when there are no reps. Pure number; no side effects.
   */
  const computeAsymmetryIndex = (left: number, right: number): number => {
    const max = Math.max(left, right);
    if (max === 0) return 0;
    return Math.abs(left - right) / max;
  };

  const prescribedTargetReached = (
    left: number,
    right: number,
    target: number,
  ): boolean => {
    const side = prescriptionRef.current.prescribedSide;
    if (side === "left") return left >= target;
    if (side === "right") return right >= target;
    return Math.min(left, right) >= target;
  };

  const prescribedCreditedValue = (left: number, right: number): number => {
    const side = prescriptionRef.current.prescribedSide;
    if (side === "left") return left;
    if (side === "right") return right;
    return Math.min(left, right);
  };

  /**
   * Guided-flow navigation: move the selected exercise by `offset` positions
   * within the assigned-exercise list (−1 = previous, +1 = next). Returns true
   * if it navigated, false if the move was out of bounds (already at an end) or
   * the current id was not found.
   *
   * Reads/writes refs so it is safe to call from BOTH the rAF-driven
   * auto-advance path (which only sees stale closure state) and the stepper
   * buttons. The synchronous `selectedExerciseRef` write keeps rapid same-tick
   * clicks consistent — without it, a second click would recompute from the
   * not-yet-synced previous id. Changing `selectedExercise` triggers the
   * exercise-change reset effect, which lands the new exercise idle and
   * rebuilds counters / filters / baseline state.
   */
  const goToAdjacentExercise = (offset: number): boolean => {
    const ids = assignedExercisesRef.current;
    const curIdx = ids.findIndex((e) => e.id === selectedExerciseRef.current);
    if (curIdx === -1) return false;
    const nextIdx = curIdx + offset;
    if (nextIdx < 0 || nextIdx >= ids.length) return false;
    const nextExercise = ids[nextIdx];
    selectedExerciseRef.current = nextExercise.id;
    setSelectedExercise(nextExercise.id);
    if (user?.role === "patient" && nextExercise.occurrenceId !== undefined) {
      router.replace(
        `/camera?occurrenceId=${nextExercise.occurrenceId}&exerciseId=${encodeURIComponent(nextExercise.id)}`,
        { scroll: false },
      );
    }
    return true;
  };

  /**
   * Check whether the current set is complete under Model C
   * (`min(left,right) >= targetReps` for bilateral, `left >= targetReps`
   * for unilateral). If complete:
   *  - Log a `CompletedSetRecord` to `completedSetsLogRef` (P4-friendly).
   *  - Bump `completedSets`.
   *  - Reset `repCounts` / `repCountsRef` to {0,0} for the next set.
   *  - Reset the underlying `RepCounter` instances so each set starts
   *    with a fresh state machine (continuity gate, peak tracking, etc.).
   *  - If `completedSets` now meets `targetSets`, advance to the next
   *    assigned exercise (guided flow), or end the session if this was the
   *    last exercise.
   *
   * Called from each rep-emit site in `predictWebcam` AFTER the per-side
   * count has been incremented. Reads everything from refs so the
   * decision uses fresh values (no stale-closure issue).
   */
  const checkAndHandleSetCompletion = (tNow: number) => {
    const def = activeDefinitionRef.current;
    if (!def) return;

    // "Set complete?" is kind-specific: dynamic counts reps, isometric counts
    // milliseconds held in the target band. Both use Model C for bilateral —
    // the slower side gates completion.
    let setComplete: boolean;
    let setRecord: CompletedSetRecord;
    if (def.kind === "dynamic") {
      const target = prescriptionRef.current.reps;
      const left = repCountsRef.current.left;
      const right = repCountsRef.current.right;
      setComplete = def.bilateral
        ? prescribedTargetReached(left, right, target)
        : left >= target;
      if (!setComplete) return;
      setRecord = {
        setIndex: completedSetsRef.current + 1,
        targetReps: target,
        leftReps: left,
        rightReps: right,
        pairedReps: Math.min(left, right),
        durationMs:
          currentSetStartMsRef.current !== null
            ? tNow - currentSetStartMsRef.current
            : 0,
        terminatedBy: "min_reached",
        asymmetryIndex: computeAsymmetryIndex(left, right),
      };
    } else if (isSideSplitIsometric(def)) {
      // Side-split isometric (ex_004): each side accrues hold time on its own
      // (sign-attributed), so the set completes only when BOTH sides reach the
      // prescribed per-side hold — Model C, the slower side gates. The credited
      // `pairedHoldMs` is the min; the per-side totals ride along so the recap
      // (and holdQuality) keep the asymmetry visible.
      const targetMs = prescriptionRef.current.holdSeconds * 1000;
      const leftMs = leftHoldMsRef.current;
      const rightMs = rightHoldMsRef.current;
      setComplete = prescribedTargetReached(leftMs, rightMs, targetMs);
      if (!setComplete) return;
      setRecord = {
        setIndex: completedSetsRef.current + 1,
        targetReps: 0,
        leftReps: 0,
        rightReps: 0,
        pairedReps: 0,
        durationMs:
          currentSetStartMsRef.current !== null
            ? tNow - currentSetStartMsRef.current
            : 0,
        terminatedBy: "min_reached",
        asymmetryIndex: computeAsymmetryIndex(leftMs, rightMs),
        pairedHoldMs: prescribedCreditedValue(leftMs, rightMs),
        targetHoldMs: targetMs,
        leftHoldMs: leftMs,
        rightHoldMs: rightMs,
      };
    } else {
      // Per-limb isometric (ex_006): each arm accrues independently. "both"
      // uses the slower arm; a unilateral prescription gates only its selected
      // side while the other remains an observation.
      const targetMs = prescriptionRef.current.holdSeconds * 1000;
      const leftMs = leftHoldMsRef.current;
      const rightMs = rightHoldMsRef.current;
      const creditedMs = prescribedCreditedValue(leftMs, rightMs);
      setComplete = prescribedTargetReached(leftMs, rightMs, targetMs);
      if (!setComplete) return;
      setRecord = {
        setIndex: completedSetsRef.current + 1,
        targetReps: 0,
        leftReps: 0,
        rightReps: 0,
        pairedReps: 0,
        durationMs:
          currentSetStartMsRef.current !== null
            ? tNow - currentSetStartMsRef.current
            : 0,
        terminatedBy: "min_reached",
        asymmetryIndex: computeAsymmetryIndex(leftMs, rightMs),
        pairedHoldMs: creditedMs,
        targetHoldMs: targetMs,
        leftHoldMs: leftMs,
        rightHoldMs: rightMs,
      };
    }
    completedSetsLogRef.current.push(setRecord);
    bufferSetEvent(setRecord, def.kind, tNow);
    // Persist this set's boundary and reps now that the set boundary is known.
    flushSetEvents();
    flushRepEvents();
    flushRawFrames();

    setCompletedSets(completedSetsRef.current + 1);
    // Reset the per-set progress trackers for the next set, per kind.
    if (def.kind === "dynamic") {
      repCountsRef.current = { left: 0, right: 0 };
      setRepCounts({ left: 0, right: 0 });
      leftRepCounterRef.current?.reset();
      rightRepCounterRef.current?.reset();
      bidirectionalRepCounterRef.current?.reset();
      dynamicRepQualityBufferRef.current.reset();
    } else {
      pairedHoldMsRef.current = 0;
      leftHoldMsRef.current = 0;
      rightHoldMsRef.current = 0;
      leftInBandRef.current = false;
      rightInBandRef.current = false;
      lastIsometricTickMsRef.current = null;
      resetHoldQualityAccum();
      setHoldState({ pairedSec: 0, leftSec: 0, rightSec: 0, leftInBand: false, rightInBand: false });
    }
    resetCompensationWarnings();
    currentSetStartMsRef.current = tNow;
    setConfirmingEnd(false);

    if (completedSetsRef.current >= prescriptionRef.current.sets) {
      // All prescribed sets done. Close this occurrence, then require the
      // post-attempt pain report/decline before any guided-flow advance.
      // Close the rep gate synchronously FIRST. This runs from the rAF loop,
      // and the exercise-change reset effect that also lands the next exercise
      // idle is async — so without this immediate flip there is a brief window
      // where the gate (sessionStateRef.current === "active") stays open and a
      // rep could still register against the just-finished exercise.
      // `goToAdjacentExercise(1)` returns false when already at the last
      // exercise, in which case the session ends instead.
      // This exercise's session is finished either way — close it (completed:
      // all prescribed sets were reached). Advancing re-selects the next
      // exercise; the patient presses Start to open a new session for it.
      showCompletionRecapAfterReportRef.current = true;
      terminalOccurrenceAfterReportRef.current = "completed";
      void endSessionPersistence(true).then(showSessionPersistenceToast);
      // This exercise is finished — drop its resume snapshot so a later visit
      // shows the "already completed" recap, not a resume prompt.
      clearResumeSnapshot(prescriptionRef.current.patientExerciseId);
      setPainReportError(null);
      setSessionState(
        prescriptionRef.current.patientExerciseId !== undefined
          ? "reporting"
          : "ended",
      );
    } else if (prescriptionRef.current.restSeconds > 0) {
      // More sets remain → hard-block rest between sets. Flip to "resting"
      // synchronously (closes the rep gate this frame), then start the
      // countdown; the rest-timer effect resumes "active" and re-stamps
      // currentSetStartMs when it elapses. restSeconds === 0 means no rest —
      // stay active and the next set begins immediately.
      restEndsAtMsRef.current =
        performance.now() + prescriptionRef.current.restSeconds * 1000;
      setRestRemainingSec(prescriptionRef.current.restSeconds);
      setSessionState("resting");
    }

    if (completedSetsRef.current < prescriptionRef.current.sets) {
      // Non-final set boundary → refresh the resume snapshot with the bumped
      // completed-set count (current-set reps just reset to 0).
      writeResumeSnapshot();
    }
  };

  /**
   * Sidebar Start button handler. Resets the session lifecycle and
   * transitions to `active`. The rep event log is cleared and rep counters
   * are rebuilt so a restarted session does not inherit stale event buffers
   * or lifetime-of-instance rep indices from the previous session.
   */
  const askPreSessionPain = () =>
    new Promise<PreSessionPain | null>((resolve) => {
      preSessionSurveyResolveRef.current = resolve;
      setPreSessionSurvey({ score: 0, bodyArea: "" });
    });
  const answerPreSessionSurvey = (answer: PreSessionPain | null) => {
    const resolve = preSessionSurveyResolveRef.current;
    preSessionSurveyResolveRef.current = null;
    setPreSessionSurvey(null);
    resolve?.(answer);
  };
  const askVideoChoice = () =>
    new Promise<{ record: boolean; remember: boolean } | null>((resolve) => {
      videoQuestionResolveRef.current = resolve;
      setVideoQuestion({ remember: false });
    });
  const answerVideoChoice = (answer: { record: boolean; remember: boolean } | null) => {
    const resolve = videoQuestionResolveRef.current;
    videoQuestionResolveRef.current = null;
    setVideoQuestion(null);
    resolve?.(answer);
  };

  /** Records the camera stream for a session whose patient opted in. Never blocks the session. */
  const startSessionRecording = (sessionId: number) => {
    const stream = streamRef.current;
    if (!stream) return;
    void recorderRef.current?.stop();
    const recorder = new SessionRecorder({
      sessionId,
      stream,
      nowWallMs: () => Date.parse(perfToIso(performance.now())),
      onState: (state) => { if (recorderRef.current === recorder) setRecordingState(state); },
    });
    recorderRef.current = recorder;
    recordingWantedRef.current = true;
    void recorder.start();
  };

  /** Ends the recording; what was uploaded is kept. `byPatient` also stops it for a later Resume. */
  const stopSessionRecording = (byPatient = false) => {
    if (byPatient) recordingWantedRef.current = false;
    const recorder = recorderRef.current;
    if (!recorder) return;
    void recorder.stop().finally(() => {
      if (recorderRef.current === recorder) recorderRef.current = null;
    });
  };

  /** `onConfirmed` runs once the start is no longer cancellable from the survey. */
  const handleSessionStart = async (onConfirmed?: () => void) => {
    if (!activeDefinition) return;
    // Strict schedule lock: a patient may only start an exercise that is
    // actionable today (due, or still within its make-up window). Staff debug
    // bypasses this. The server enforces the same rule on session create.
    if (
      user?.role === "patient" &&
      selectedExercise &&
      !actionableOccurrenceIds.has(prescriptionRef.current.occurrenceId ?? -1)
    ) {
      setScheduleNotice(
        "This exercise isn't scheduled for today. Start it from your schedule on its due day.",
      );
      return;
    }
    setScheduleNotice(null);
    // A patient's new session opens with the pain survey; Back cancels it.
    preSessionPainRef.current = null;
    videoConsentRef.current = false;
    videoConsentRememberedRef.current = false;
    videoConsentNoticeRef.current = null;
    if (typeof prescriptionRef.current.patientExerciseId === "number") {
      const answer = await askPreSessionPain();
      if (answer === null) return;
      preSessionPainRef.current = answer;
      // Then the video question, unless this patient asked this device to
      // remember an answer. Back cancels the start.
      const remembered = readVideoChoice(user?.id);
      if (remembered) {
        videoConsentRef.current = remembered.record;
        videoConsentRememberedRef.current = true;
        videoConsentNoticeRef.current = remembered.notice;
      } else {
        const choice = await askVideoChoice();
        if (choice === null) return;
        videoConsentRef.current = choice.record;
        // The question showed this page's notice.
        videoConsentNoticeRef.current = SESSION_VIDEO_NOTICE_VERSION;
        if (choice.remember) rememberVideoChoice(user?.id, choice.record);
      }
    }
    onConfirmed?.();
    setRecordingState("off");
    recordingWantedRef.current = false;
    coachingProvenanceRef.current = await captureCoachingProvenance(activeDefinition);
    if (!cameraReadyRef.current || !streamRef.current || activeDefinitionRef.current?.id !== activeDefinition.id) return;
    const canPersist = await startSessionPersistence();
    if (!canPersist) return;
    if (videoConsentRef.current && sessionIdRef.current !== null) startSessionRecording(sessionIdRef.current);

    const counters = createRepCountersForDefinition(activeDefinition);
    coachingAuditRef.current.reset();
    captureFramesTotalRef.current = 0;
    captureFramesOkRef.current = 0;
    captureRejectedByStatusRef.current = {};
    captureDropoutResetsRef.current = 0;
    captureUnsteadyFramesRef.current = 0;
    captureCheckedFramesRef.current = 0;
    trackingMarksRef.current = [];
    setSessionElapsedSec(0);
    setCompletedSets(0);
    completedSetsLogRef.current = [];
    repLogRef.current = { left: [], right: [] };
    priorRepOutcomesRef.current = { left: [], right: [] };
    neckRepDebugRef.current = [];
    neckRepDebugStartMsRef.current = null;
    neckRepDebugSeqRef.current = 0;
    if (typeof window !== "undefined") {
      window.__neckRepDebug = neckRepDebugRef.current;
    }
    clearEx004FaceShadow();
    repCountsRef.current = { left: 0, right: 0 };
    setRepCounts({ left: 0, right: 0 });
    leftRepCounterRef.current = counters.left;
    rightRepCounterRef.current = counters.right;
    bidirectionalRepCounterRef.current = counters.bidirectional;
    resetCompensationWarnings();
    resetNeutralCalibration("capturing");
    pairedHoldMsRef.current = 0;
    leftHoldMsRef.current = 0;
    rightHoldMsRef.current = 0;
    leftInBandRef.current = false;
    rightInBandRef.current = false;
    lastIsometricTickMsRef.current = null;
    resetHoldQualityAccum();
    setHoldState({ pairedSec: 0, leftSec: 0, rightSec: 0, leftInBand: false, rightInBand: false });
    setConfirmingEnd(false);
    restEndsAtMsRef.current = null;
    setRestRemainingSec(0);
    countdownResumeElapsedMsRef.current = null;
    setSessionState("countdown");
  };

  /**
   * Resume a disrupted session from its localStorage snapshot: restore the
   * completed-set count, the current set's counter, and the elapsed timer, and
   * continue writing to the SAME open DB session (no new row). Mirrors
   * `handleSessionStart`, but restores state instead of zeroing it. A resumed
   * attempt recalibrates before returning to `active`.
   */
  const resumeSession = async () => {
    // Like Start, Resume must wait for inference readiness before restoring
    // progress or starting a camera whose first frame could arrive too early.
    if (!modelLoaded || !activeDefinition) return;
    const snap = readResumeSnapshot(prescriptionRef.current.patientExerciseId);
    if (!snap || snap.exerciseId !== activeDefinition.id) return;
    if (sessionStartPendingRef.current || isStarting) return;
    sessionStartPendingRef.current = true;
    try {
    if (!cameraReadyRef.current && !(await startCamera(selectedDeviceId || undefined))) return;
    coachingProvenanceRef.current = await captureCoachingProvenance(activeDefinition);
    if (!cameraReadyRef.current || !streamRef.current || activeDefinitionRef.current?.id !== activeDefinition.id) return;
    coachingAuditRef.current.reset();

    const counters = createRepCountersForDefinition(activeDefinition);
    // Restore what the snapshot carried from before the disruption, so the
    // end-of-session card and capture summary cover the whole attempt rather
    // than only the resumed portion. An older snapshot restores nothing here.
    const progress = restoredSessionProgress(snap);
    captureFramesTotalRef.current = progress.captureFrames.total;
    captureFramesOkRef.current = progress.captureFrames.ok;
    captureRejectedByStatusRef.current = { ...progress.captureFrames.rejectedByStatus };
    captureDropoutResetsRef.current = progress.captureFrames.dropoutResets;
    captureUnsteadyFramesRef.current = progress.captureFrames.unsteady;
    captureCheckedFramesRef.current = progress.captureFrames.checked;
    trackingMarksRef.current = [];

    setCompletedSets(snap.completedSets);
    completedSetsLogRef.current = progress.setsLog;
    repLogRef.current = { left: [], right: [] };
    priorRepOutcomesRef.current = progress.repOutcomes;
    neckRepDebugRef.current = [];
    neckRepDebugStartMsRef.current = null;
    neckRepDebugSeqRef.current = 0;
    if (typeof window !== "undefined") {
      window.__neckRepDebug = neckRepDebugRef.current;
    }
    clearEx004FaceShadow();

    leftRepCounterRef.current = counters.left;
    rightRepCounterRef.current = counters.right;
    bidirectionalRepCounterRef.current = counters.bidirectional;
    resetCompensationWarnings();

    // Restore the current set's progress (fresh state machines; the counts live
    // in repCountsRef / the hold accumulators, so detection continues from there).
    pairedHoldMsRef.current = 0;
    leftHoldMsRef.current = 0;
    rightHoldMsRef.current = 0;
    leftInBandRef.current = false;
    rightInBandRef.current = false;
    lastIsometricTickMsRef.current = null;
    resetHoldQualityAccum();
    if (activeDefinition.kind === "dynamic") {
      repCountsRef.current = {
        left: snap.currentSetReps.left,
        right: snap.currentSetReps.right,
      };
      setRepCounts({ ...repCountsRef.current });
      setHoldState({ pairedSec: 0, leftSec: 0, rightSec: 0, leftInBand: false, rightInBand: false });
    } else {
      repCountsRef.current = { left: 0, right: 0 };
      setRepCounts({ left: 0, right: 0 });
      pairedHoldMsRef.current = snap.pairedHoldMs;
      // Per-side holds for a side-split isometric (ex_004). `sideHoldMs` is
      // optional (older snapshots predate it) — missing means 0/0.
      leftHoldMsRef.current = snap.sideHoldMs?.left ?? 0;
      rightHoldMsRef.current = snap.sideHoldMs?.right ?? 0;
      setHoldState({
        pairedSec: snap.pairedHoldMs / 1000,
        leftSec: leftHoldMsRef.current / 1000,
        rightSec: rightHoldMsRef.current / 1000,
        leftInBand: false,
        rightInBand: false,
      });
    }

    resetNeutralCalibration("capturing");

    setConfirmingEnd(false);
    restEndsAtMsRef.current = null;
    setRestRemainingSec(0);

    // Reuse the OPEN persisted session — do NOT POST a new one. Restore the
    // session-wide rep/raw-frame indices so writes stay contiguous and don't
    // collide with rows already persisted under this session id.
    resetSessionPersistence();
    sessionIdRef.current = snap.sessionId;
    // Anchor this page's clock before anything reads it: the recorder takes
    // the resumed part's start time through perfToIso, and after a reload the
    // anchors are still 0 (the part's start was then stored as milliseconds
    // since page load, so playback could not place its overlays or markers).
    sessionWallStartMsRef.current = Date.now();
    sessionPerfStartMsRef.current = performance.now();
    // The consent given at the start covers the rest of the session; the
    // resumed part is recorded as a new part.
    if (snap.recordVideo === true) startSessionRecording(snap.sessionId);
    // Re-adopt any outcome events the interrupted run could not deliver, then
    // let the normal flush path retry them. Inserts are idempotent by
    // (session_id, rep_index) / (session_id, set_index), so re-sending an event
    // that did land is a no-op rather than a duplicate.
    eventOutboxRef.current.setSession(snap.sessionId);
    if (eventOutboxRef.current.restoreFor(snap.sessionId) > 0) {
      flushSetEvents();
      flushRepEvents();
    }
    globalRepIndexRef.current = snap.globalRepIndex;
    rawFrameIndexRef.current = snap.rawFrameIndex;
    sessionTokenRef.current++;
    pendingStaleEndReasonRef.current = undefined;

    // Continue the timer from where it stopped (away-time excluded); start the
    // partial set's duration clock fresh.
    const now = performance.now();
    sessionStartMsRef.current = now - snap.elapsedMs;
    currentSetStartMsRef.current = now;
    countdownResumeElapsedMsRef.current = snap.elapsedMs;
    setSessionElapsedSec(Math.floor(snap.elapsedMs / 1000));

    setSessionState("countdown");
    } finally { sessionStartPendingRef.current = false; }
  };

  /**
   * Sidebar End button handler. Transitions to `ended`. If there are
   * reps in flight in the current set, log a partial set record with
   * `terminatedBy: "user"` so the session timeline reflects the
   * incomplete attempt.
   */
  const handleSessionEnd = (reason: "user" | "pain" = "user") => {
    if (
      sessionStateRef.current !== "active" &&
      sessionStateRef.current !== "resting" &&
      sessionStateRef.current !== "countdown"
    ) {
      // Idempotent: clicking End in idle/ended state has no effect.
      return;
    }
    // Ending during rest: clear the countdown so the rest-timer effect can't
    // resume into "active" after we transition to "ended". (Reps are already
    // {0,0} during rest, so no partial set is logged below.)
    setConfirmingEnd(false);
    restEndsAtMsRef.current = null;
    const def = activeDefinitionRef.current;
    const endedAtMs = performance.now();
    if (def?.kind === "isometric") {
      // Isometric partial: log the hold time accumulated this set. Per-limb
      // (ex_006): the valid-T-pose (both-arms-in-band) paired accumulator.
      // Side-split (ex_004): per-side accumulators; credited pairedHoldMs is
      // the min (slower side gates), which can legitimately be 0 when only
      // one side was held — the per-side fields keep that partial visible.
      const leftMs = leftHoldMsRef.current;
      const rightMs = rightHoldMsRef.current;
      const pairedMs = prescribedCreditedValue(leftMs, rightMs);
      const anyHold = leftMs > 0 || rightMs > 0;
      if (anyHold) {
        const setRecord: CompletedSetRecord = {
          setIndex: completedSetsRef.current + 1,
          targetReps: 0,
          leftReps: 0,
          rightReps: 0,
          pairedReps: 0,
          durationMs:
            currentSetStartMsRef.current !== null
              ? endedAtMs - currentSetStartMsRef.current
              : 0,
          terminatedBy: reason,
          asymmetryIndex: computeAsymmetryIndex(leftMs, rightMs),
          pairedHoldMs: pairedMs,
          targetHoldMs: prescriptionRef.current.holdSeconds * 1000,
          leftHoldMs: leftMs,
          rightHoldMs: rightMs,
        };
        completedSetsLogRef.current.push(setRecord);
        bufferSetEvent(setRecord, def.kind, endedAtMs);
      }
    } else {
      const left = repCountsRef.current.left;
      const right = repCountsRef.current.right;
      if (left > 0 || right > 0) {
        const setRecord: CompletedSetRecord = {
          setIndex: completedSetsRef.current + 1,
          targetReps: prescriptionRef.current.reps,
          leftReps: left,
          rightReps: right,
          pairedReps: Math.min(left, right),
          durationMs:
            currentSetStartMsRef.current !== null
              ? endedAtMs - currentSetStartMsRef.current
              : 0,
          terminatedBy: reason,
          asymmetryIndex: computeAsymmetryIndex(left, right),
        };
        completedSetsLogRef.current.push(setRecord);
        if (def) bufferSetEvent(setRecord, def.kind, endedAtMs);
      }
    }
    // Preserve observations from an attempt with no credited movement. This
    // persistence-only row does not change the live completion/recap counters.
    if (def && coachingAuditRef.current.hasRecords()) {
      bufferSetEvent({ setIndex: completedSetsRef.current + 1,
        targetReps: def.kind === "dynamic" ? prescriptionRef.current.reps : 0,
        leftReps: 0, rightReps: 0, pairedReps: 0,
        targetHoldMs: def.kind === "isometric" ? prescriptionRef.current.holdSeconds * 1000 : 0,
        pairedHoldMs: 0, durationMs: currentSetStartMsRef.current === null ? 0 : endedAtMs - currentSetStartMsRef.current,
        terminatedBy: reason, asymmetryIndex: 0 }, def.kind, endedAtMs, true);
    }
    // Flush any reps from the in-progress (partial) set and stamp ended_at.
    // endReason "user" = the End button was pressed — distinguishes a deliberate
    // early end from a tab-close/exit (which leaves the session open).
    showCompletionRecapAfterReportRef.current = false;
    terminalOccurrenceAfterReportRef.current =
      reason === "pain" ? "pain_stopped" : null;
    void endSessionPersistence(false, reason).then(showSessionPersistenceToast);
    // Deliberate end → drop the resume snapshot so this attempt is not offered
    // for resume on return (the row is also closed, the authoritative guard).
    clearResumeSnapshot(prescriptionRef.current.patientExerciseId);
    setPainReportError(null);
    setSessionState(
      prescriptionRef.current.patientExerciseId !== undefined
        ? "reporting"
        : "ended",
    );
  };

  /**
   * TEMPORARY (2026-05-22): the rest period is specified as a HARD BLOCK with
   * NO skip. This Skip control is a stopgap for proof-of-concept testing and
   * should be REMOVED so rest is non-skippable per the spec. Resumes the next
   * set immediately: stamp a fresh currentSetStartMs and flip back to "active".
   */
  const skipRest = () => {
    if (sessionStateRef.current !== "resting") return;
    restEndsAtMsRef.current = null;
    setRestRemainingSec(0);
    currentSetStartMsRef.current = performance.now();
    setSessionState("active");
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const setEx005DebugEnabled = (enabled: boolean) => {
      ex005DebugEnabledRef.current = enabled;
      window.localStorage.setItem("poseDebug.ex005", enabled ? "1" : "0");
      console.info(`[ex005-debug] ${enabled ? "enabled" : "disabled"}`);
    };
    const clearEx005Debug = () => {
      ex005DebugRef.current = [];
      ex005DebugStartMsRef.current = null;
      ex005DebugSeqRef.current = 0;
      window.__ex005Debug = ex005DebugRef.current;
      console.info("[ex005-debug] cleared");
    };

    ex005DebugEnabledRef.current =
      window.localStorage.getItem("poseDebug.ex005") === "1";
    window.__ex005Debug = ex005DebugRef.current;
    window.enableEx005Debug = () => {
      setEx005DebugEnabled(true);
      clearEx005Debug();
      console.info(
        "[ex005-debug] do a few ex_005 reps, then run: copy(dumpEx005Debug())",
      );
    };
    window.disableEx005Debug = () => setEx005DebugEnabled(false);
    window.clearEx005Debug = clearEx005Debug;
    window.dumpEx005Debug = (limit = 1200) => {
      const records = ex005DebugRef.current.slice(-limit);
      const dump: Ex005DebugDump = {
        generatedAt: new Date().toISOString(),
        enabled: ex005DebugEnabledRef.current,
        recordCount: records.length,
        records,
      };
      const text = JSON.stringify(dump, null, 2);
      console.info(text);
      return text;
    };

    window.__neckRepDebug = neckRepDebugRef.current;
    window.clearNeckRepDebug = () => {
      neckRepDebugRef.current = [];
      neckRepDebugStartMsRef.current = null;
      neckRepDebugSeqRef.current = 0;
      window.__neckRepDebug = neckRepDebugRef.current;
      console.info("[neck-rep-debug] cleared");
    };
    window.dumpNeckRepDebug = (limit = 1200) => {
      const records = neckRepDebugRef.current.slice(-limit);
      const dump: NeckRepDebugDump = {
        generatedAt: new Date().toISOString(),
        recordCount: records.length,
        records,
      };
      const text = JSON.stringify(dump, null, 2);
      console.info(text);
      return text;
    };
    console.info(
      "[neck-rep-debug] available: clearNeckRepDebug(); dumpNeckRepDebug(limit)",
    );
    console.info(
      "[ex005-debug] available: enableEx005Debug(); clearEx005Debug(); dumpEx005Debug(limit); disableEx005Debug()",
    );

    return () => {
      delete window.__neckRepDebug;
      delete window.clearNeckRepDebug;
      delete window.dumpNeckRepDebug;
      delete window.__ex005Debug;
      delete window.enableEx005Debug;
      delete window.disableEx005Debug;
      delete window.clearEx005Debug;
      delete window.dumpEx005Debug;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.__ex004FaceShadow = ex004FaceShadowRecordsRef.current;
    window.enableEx004FaceShadow = () => {
      clearEx004FaceShadow();
      setEx004FaceShadowEnabled(true);
      console.info(
        "[ex004-face-shadow] enabled; select ex_004 and wait for Face ready before starting",
      );
    };
    window.disableEx004FaceShadow = () => {
      setEx004FaceShadowEnabled(false);
      console.info("[ex004-face-shadow] disabled; buffered records retained");
    };
    window.clearEx004FaceShadow = () => {
      clearEx004FaceShadow();
      console.info("[ex004-face-shadow] cleared");
    };
    window.dumpEx004FaceShadow = (limit = 1200) => {
      const records = ex004FaceShadowRecordsRef.current.slice(-limit);
      const attemptedFrames = records.filter((record) =>
        isEx004FaceShadowAttempt(record.status)
      ).length;
      const detectedFrames = records.filter(
        (record) => record.status === "detected",
      ).length;
      const dump: Ex004FaceShadowDump = {
        version: "ex004_face_shadow_dump_v2",
        generatedAt: new Date().toISOString(),
        enabled: ex004FaceShadowEnabledRef.current,
        modelState: ex004FaceShadowModelStateRef.current,
        modelAssetPath: EX004_FACE_SHADOW_MODEL_PATH,
        authoritativeSource: "pose",
        attemptedFrames,
        detectedFrames,
        coverage: attemptedFrames > 0 ? detectedFrames / attemptedFrames : null,
        currentPhase: ex004FaceShadowPhaseRef.current,
        faceBaselineRollDeg: ex004FaceShadowBaselineRollRef.current,
        faceBaselineYawDeg: ex004FaceShadowBaselineYawRef.current,
        faceBaselinePitchDeg: ex004FaceShadowBaselinePitchRef.current,
        roi: ex004FaceShadowRoiRef.current,
        markCount: ex004FaceShadowMarksRef.current.length,
        marks: [...ex004FaceShadowMarksRef.current],
        recordCount: records.length,
        records,
      };
      const text = JSON.stringify(dump, null, 2);
      console.info(text);
      return text;
    };
    window.setEx004FaceShadowPhase = (phase) => {
      if (!isEx004FaceShadowPhase(phase)) return false;
      setEx004FaceShadowPhase(phase);
      return true;
    };
    window.markEx004FaceShadowReference = (angleDeg, note) =>
      markEx004FaceShadowReference(angleDeg, note ?? null);
    console.info(
      "[ex004-face-shadow] available: enableEx004FaceShadow(); setEx004FaceShadowPhase(phase); markEx004FaceShadowReference(angleDeg, note); dumpEx004FaceShadow(limit); disableEx004FaceShadow()",
    );

    return () => {
      delete window.__ex004FaceShadow;
      delete window.enableEx004FaceShadow;
      delete window.disableEx004FaceShadow;
      delete window.clearEx004FaceShadow;
      delete window.dumpEx004FaceShadow;
      delete window.setEx004FaceShadowPhase;
      delete window.markEx004FaceShadowReference;
    };
  }, [
    clearEx004FaceShadow,
    markEx004FaceShadowReference,
    setEx004FaceShadowEnabled,
    setEx004FaceShadowPhase,
  ]);

  function roundDebugNumber(
    value: number | null | undefined,
    digits = 3,
  ): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
  }

  function inferEx004FaceShadow(
    video: HTMLVideoElement,
    landmarks: readonly NormalizedLandmark[],
    tNow: number,
  ): Ex004FaceShadowInference | null {
    if (
      !ex004FaceShadowEnabledRef.current ||
      activeDefinitionRef.current?.id !== "ex_004"
    ) {
      return null;
    }

    const landmarker = faceLandmarkerRef.current;
    if (
      !landmarker ||
      ex004FaceShadowModelStateRef.current !== "ready"
    ) {
      return {
        status: "model-not-ready",
        faceCount: null,
        matrixCount: null,
        rawOrientation: null,
        inferenceMs: null,
      };
    }

    let roi = ex004FaceShadowRoiRef.current;
    if (!roi) {
      roi = fixedFaceRoiFromPose(
        landmarks,
        video.videoWidth,
        video.videoHeight,
      );
      if (roi) ex004FaceShadowRoiRef.current = roi;
    }
    if (!roi) {
      return {
        status: "roi-unavailable",
        faceCount: null,
        matrixCount: null,
        rawOrientation: null,
        inferenceMs: null,
      };
    }

    const lastInferenceMs = ex004FaceShadowLastInferenceMsRef.current;
    if (
      lastInferenceMs !== null &&
      tNow - lastInferenceMs < EX004_FACE_SHADOW_INFERENCE_INTERVAL_MS
    ) {
      return null;
    }
    ex004FaceShadowLastInferenceMsRef.current = tNow;

    const startedAt = performance.now();
    try {
      // FaceLandmarker.detectForVideo does not accept the Tasks ROI option.
      // Materialize the fixed Pose-guided region in a reusable in-memory canvas
      // instead. The canvas is overwritten every frame and is never persisted.
      let cropCanvas = faceCropCanvasRef.current;
      if (!cropCanvas) {
        cropCanvas = document.createElement("canvas");
        faceCropCanvasRef.current = cropCanvas;
      }
      const cropWidth = roi.pixel.x1 - roi.pixel.x0;
      const cropHeight = roi.pixel.y1 - roi.pixel.y0;
      if (cropCanvas.width !== cropWidth) cropCanvas.width = cropWidth;
      if (cropCanvas.height !== cropHeight) cropCanvas.height = cropHeight;
      const cropContext = cropCanvas.getContext("2d", { alpha: false });
      if (!cropContext) {
        throw new Error("Face crop canvas 2D context is unavailable.");
      }
      cropContext.drawImage(
        video,
        roi.pixel.x0,
        roi.pixel.y0,
        cropWidth,
        cropHeight,
        0,
        0,
        cropWidth,
        cropHeight,
      );
      const result = landmarker.detectForVideo(cropCanvas, tNow);
      const inferenceMs = performance.now() - startedAt;
      const faceCount = result.faceLandmarks.length;
      const matrixCount = result.facialTransformationMatrixes.length;

      if (faceCount === 0) {
        return {
          status: "no-face",
          faceCount,
          matrixCount,
          rawOrientation: null,
          inferenceMs,
        };
      }
      if (faceCount !== 1) {
        return {
          status: "multiple-faces",
          faceCount,
          matrixCount,
          rawOrientation: null,
          inferenceMs,
        };
      }
      if (matrixCount !== 1) {
        return {
          status: "invalid-matrix",
          faceCount,
          matrixCount,
          rawOrientation: null,
          inferenceMs,
        };
      }

      const rawOrientation = faceOrientationDegrees(
        result.facialTransformationMatrixes[0],
      );
      if (rawOrientation === null) {
        return {
          status: "invalid-matrix",
          faceCount,
          matrixCount,
          rawOrientation: null,
          inferenceMs,
        };
      }

      if (baselinePhaseRef.current === "capturing") {
        ex004FaceShadowBaselineSamplesRef.current.push(
          rawOrientation.rollImageDeg,
        );
        ex004FaceShadowBaselineYawSamplesRef.current.push(
          rawOrientation.yawDeg,
        );
        ex004FaceShadowBaselinePitchSamplesRef.current.push(
          rawOrientation.pitchDeg,
        );
        if (ex004FaceShadowBaselineSamplesRef.current.length > 300) {
          ex004FaceShadowBaselineSamplesRef.current.shift();
          ex004FaceShadowBaselineYawSamplesRef.current.shift();
          ex004FaceShadowBaselinePitchSamplesRef.current.shift();
        }
      }

      return {
        status: "detected",
        faceCount,
        matrixCount,
        rawOrientation,
        inferenceMs,
      };
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : String(reason);
      console.error("[ex004-face-shadow] inference failed", reason);
      commitEx004FaceShadowModelState("error", message);
      return {
        status: "inference-error",
        faceCount: null,
        matrixCount: null,
        rawOrientation: null,
        inferenceMs: performance.now() - startedAt,
      };
    }
  }

  function recordEx004FaceShadow(
    inference: Ex004FaceShadowInference | null,
    poseSignedDeg: number | null,
    tNow: number,
  ): void {
    if (!inference) return;
    if (ex004FaceShadowStartMsRef.current === null) {
      ex004FaceShadowStartMsRef.current = tNow;
    }

    if (isEx004FaceShadowAttempt(inference.status)) {
      ex004FaceShadowAttemptedFramesRef.current += 1;
      if (inference.status === "detected") {
        ex004FaceShadowDetectedFramesRef.current += 1;
      }
    }

    const rollBaseline = ex004FaceShadowBaselineRollRef.current;
    const yawBaseline = ex004FaceShadowBaselineYawRef.current;
    const pitchBaseline = ex004FaceShadowBaselinePitchRef.current;
    const rawOrientation = inference.rawOrientation;
    const faceSignedDeg =
      rawOrientation !== null && rollBaseline !== null
        ? angleDeltaDegrees(rawOrientation.rollImageDeg, rollBaseline)
        : null;
    const faceYawDeltaDeg =
      rawOrientation !== null && yawBaseline !== null
        ? angleDeltaDegrees(rawOrientation.yawDeg, yawBaseline)
        : null;
    const facePitchDeltaDeg =
      rawOrientation !== null && pitchBaseline !== null
        ? angleDeltaDegrees(rawOrientation.pitchDeg, pitchBaseline)
        : null;
    const faceMinusPoseDeg =
      faceSignedDeg !== null && poseSignedDeg !== null
        ? faceSignedDeg - poseSignedDeg
        : null;
    const record: Ex004FaceShadowRecord = {
      version: "ex004_face_shadow_v2",
      seq: ++ex004FaceShadowSeqRef.current,
      tMs: Math.round(tNow),
      elapsedMs: Math.round(tNow - ex004FaceShadowStartMsRef.current),
      trialPhase: ex004FaceShadowPhaseRef.current,
      sessionState: sessionStateRef.current,
      baselinePhase: baselinePhaseRef.current,
      modelState: ex004FaceShadowModelStateRef.current,
      status: inference.status,
      faceCount: inference.faceCount,
      matrixCount: inference.matrixCount,
      roi: ex004FaceShadowRoiRef.current,
      poseSignedDeg: roundDebugNumber(poseSignedDeg),
      faceRawRollDeg: roundDebugNumber(rawOrientation?.rollImageDeg),
      faceRawYawDeg: roundDebugNumber(rawOrientation?.yawDeg),
      faceRawPitchDeg: roundDebugNumber(rawOrientation?.pitchDeg),
      faceBaselineRollDeg: roundDebugNumber(rollBaseline),
      faceBaselineYawDeg: roundDebugNumber(yawBaseline),
      faceBaselinePitchDeg: roundDebugNumber(pitchBaseline),
      faceSignedDeg: roundDebugNumber(faceSignedDeg),
      faceYawDeltaDeg: roundDebugNumber(faceYawDeltaDeg),
      facePitchDeltaDeg: roundDebugNumber(facePitchDeltaDeg),
      faceMinusPoseDeg: roundDebugNumber(faceMinusPoseDeg),
      inferenceMs: roundDebugNumber(inference.inferenceMs),
      authoritativeSource: "pose",
    };

    ex004FaceShadowRecordsRef.current.push(record);
    if (
      ex004FaceShadowRecordsRef.current.length >
      MAX_EX004_FACE_SHADOW_RECORDS
    ) {
      ex004FaceShadowRecordsRef.current.shift();
    }
    if (typeof window !== "undefined") {
      window.__ex004FaceShadow = ex004FaceShadowRecordsRef.current;
    }

    if (
      tNow - ex004FaceShadowLastUiUpdateMsRef.current >=
        EX004_FACE_SHADOW_UI_THROTTLE_MS ||
      inference.status !== "detected"
    ) {
      ex004FaceShadowLastUiUpdateMsRef.current = tNow;
      setEx004FaceShadowLive({
        status: inference.status,
        poseSignedDeg: record.poseSignedDeg,
        faceSignedDeg: record.faceSignedDeg,
        faceYawDeltaDeg: record.faceYawDeltaDeg,
        facePitchDeltaDeg: record.facePitchDeltaDeg,
        faceMinusPoseDeg: record.faceMinusPoseDeg,
        inferenceMs: record.inferenceMs,
        attemptedFrames: ex004FaceShadowAttemptedFramesRef.current,
        detectedFrames: ex004FaceShadowDetectedFramesRef.current,
      });
    }
  }

  function landmarkDebug(
    landmark: { x: number; y: number; visibility?: number } | undefined,
  ): Ex005DebugLandmark {
    if (!landmark) {
      return { x: null, y: null, visibility: null, inFrame: false };
    }
    return {
      x: roundDebugNumber(landmark.x),
      y: roundDebugNumber(landmark.y),
      visibility: roundDebugNumber(landmark.visibility ?? null, 2),
      inFrame:
        landmark.x >= 0 &&
        landmark.x <= 1 &&
        landmark.y >= 0 &&
        landmark.y <= 1,
    };
  }

  function midpointDebug(
    a: { x: number; y: number } | undefined,
    b: { x: number; y: number } | undefined,
  ): Ex005DebugPoint {
    if (!a || !b) return { x: null, y: null };
    return {
      x: roundDebugNumber((a.x + b.x) / 2),
      y: roundDebugNumber((a.y + b.y) / 2),
    };
  }

  function angleDiffDebug(a: number, b: number): number {
    let d = a - b;
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    return d;
  }

  function lineAngleDebug(
    a: { x: number; y: number } | undefined,
    b: { x: number; y: number } | undefined,
  ): number | null {
    if (!a || !b) return null;
    return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  }

  function bodyPairAngleDebug(
    subjectLeft: { x: number; y: number } | undefined,
    subjectRight: { x: number; y: number } | undefined,
  ): number | null {
    return lineAngleDebug(subjectRight, subjectLeft);
  }

  function headLeanFromVerticalDebug(
    hipMid: Ex005DebugPoint,
    earMid: Ex005DebugPoint,
  ): number | null {
    if (
      hipMid.x === null ||
      hipMid.y === null ||
      earMid.x === null ||
      earMid.y === null
    ) {
      return null;
    }
    const rawLine = lineAngleDebug(
      { x: hipMid.x, y: hipMid.y },
      { x: earMid.x, y: earMid.y },
    );
    return rawLine === null ? null : angleDiffDebug(rawLine, -90);
  }

  const resetNeutralCalibration = useCallback((
    phase: BaselinePhase = "capturing",
  ): void => {
    neutralCalibrationClockRef.current = newNeutralCalibrationClock();
    neutralCalibrationSamplesRef.current = [];
    // Whatever prompted this, the baseline is being taken again, so the stale
    // warning has been answered.
    calibrationStaleRef.current = false;
    setCalibrationStale(false);
    // Recalibrating discards the retained samples, so the next captured
    // frame must write the NEW ones even if this set already emitted a set.
    calibrationSamplesEmittedSetRef.current = null;
    calibrationTraceSamplesRef.current = null;
    frozenTiltDegRef.current = null;
    ex004FaceShadowRoiRef.current = null;
    ex004FaceShadowBaselineSamplesRef.current = [];
    ex004FaceShadowBaselineYawSamplesRef.current = [];
    ex004FaceShadowBaselinePitchSamplesRef.current = [];
    ex004FaceShadowBaselineRollRef.current = null;
    ex004FaceShadowBaselineYawRef.current = null;
    ex004FaceShadowBaselinePitchRef.current = null;
    leftBaselineRef.current = { samples: [], value: null };
    rightBaselineRef.current = { samples: [], value: null };
    bidirectionalBaselineRef.current = { samples: [], value: null };
    leftScapBaselineRef.current = { samples: [], value: null };
    rightScapBaselineRef.current = { samples: [], value: null };
    metricFiltersRef.current.clear();
    leftCompensationFiltersRef.current.clear();
    rightCompensationFiltersRef.current.clear();
    leftPrimaryFilterRef.current.reset();
    rightPrimaryFilterRef.current.reset();
    setDisplayPerSidePrimary(null);
    setEx004FaceShadowLive((previous) => ({
      ...previous,
      poseSignedDeg: null,
      faceSignedDeg: null,
      faceYawDeltaDeg: null,
      facePitchDeltaDeg: null,
      faceMinusPoseDeg: null,
    }));
    setBaselineProgress({ samples: 0, validElapsedMs: 0 });
    setBaselinePhase(phase);
  }, [setBaselinePhase]);

  function updateNeutralCalibrationProgress(
    clock: NeutralCalibrationClock,
  ): void {
    const samples = clock.sampleCount;
    const validElapsedMs = Math.round(clock.validElapsedMs);
    setBaselineProgress((previous) =>
      previous.samples === samples &&
      previous.validElapsedMs === validElapsedMs
        ? previous
        : { samples, validElapsedMs },
    );
  }

  function finalizeNeutralCalibration(
    definition: ExerciseDefinition,
  ): boolean {
    const samples = neutralCalibrationSamplesRef.current;
    const frozenTiltDeg = medianFinite(
      samples
        .filter(
          (sample) => sample.observedTilt.confidence !== "insufficient",
        )
        .map((sample) => sample.observedTilt.cameraTiltDeg),
    );
    if (frozenTiltDeg === null) return false;

    const fixedReference: TiltReference = {
      cameraTiltDeg: frozenTiltDeg,
      confidence: "high",
      divergenceDeg: null,
    };
    const needsPrimaryBaseline =
      definition.kind === "dynamic" &&
      definition.primaryMetric.requiresBaselineCapture === true;
    const needsScapBaseline = definition.compensationMetrics.some(
      (metric) =>
        metric.name === "scapularElevation" &&
        metric.requiresBaselineCapture === true,
    );

    if (needsPrimaryBaseline && definition.kind === "dynamic") {
      if (definition.bilateralMode === "bidirectional-alternating") {
        const values = samples.map((sample) =>
          computeTrunkLateralFlexionUncorrectedSigned(sample.landmarks),
        );
        const baseline = medianFinite(
          values.filter((value): value is number => value !== null),
        );
        if (baseline === null) return false;
        bidirectionalBaselineRef.current = {
          samples: values.filter((value): value is number => value !== null),
          value: baseline,
        };
      } else if (definition.bilateralMode === "per-limb") {
        const perFrame = samples.map((sample) =>
          computePoseMetricsForExercise(
            sample.landmarks,
            definition,
            fixedReference,
          ).perSideMetrics,
        );
        const left = perFrame
          .map((value) => value?.left)
          .filter((value): value is number => typeof value === "number");
        const right = perFrame
          .map((value) => value?.right)
          .filter((value): value is number => typeof value === "number");
        const leftMedian = medianFinite(left);
        const rightMedian = medianFinite(right);
        if (leftMedian === null || rightMedian === null) return false;
        leftBaselineRef.current = { samples: left, value: leftMedian };
        rightBaselineRef.current = { samples: right, value: rightMedian };
      }
    }

    if (needsScapBaseline) {
      const left = samples
        .map((sample) =>
          computeScapularElevation(
            sample.landmarks,
            fixedReference,
            "left",
          ),
        )
        .filter((value): value is number => value !== null);
      const right = samples
        .map((sample) =>
          computeScapularElevation(
            sample.landmarks,
            fixedReference,
            "right",
          ),
        )
        .filter((value): value is number => value !== null);
      const leftMedian = medianFinite(left);
      const rightMedian = medianFinite(right);
      if (leftMedian === null || rightMedian === null) return false;
      leftScapBaselineRef.current = { samples: left, value: leftMedian };
      rightScapBaselineRef.current = { samples: right, value: rightMedian };
    }

    if (
      definition.id === "ex_004" &&
      ex004FaceShadowEnabledRef.current &&
      ex004FaceShadowBaselineSamplesRef.current.length >=
        EX004_FACE_SHADOW_MIN_BASELINE_SAMPLES
    ) {
      ex004FaceShadowBaselineRollRef.current = medianFinite(
        ex004FaceShadowBaselineSamplesRef.current,
      );
      ex004FaceShadowBaselineYawRef.current = medianFinite(
        ex004FaceShadowBaselineYawSamplesRef.current,
      );
      ex004FaceShadowBaselinePitchRef.current = medianFinite(
        ex004FaceShadowBaselinePitchSamplesRef.current,
      );
    } else {
      ex004FaceShadowBaselineRollRef.current = null;
      ex004FaceShadowBaselineYawRef.current = null;
      ex004FaceShadowBaselinePitchRef.current = null;
    }

    frozenTiltDegRef.current = frozenTiltDeg;
    // Snapshot BEFORE the ring is freed on the next line. Order matters: the
    // trace writer only runs once the phase below flips to "captured", by
    // which point the ring is gone.
    calibrationTraceSamplesRef.current = neutralCalibrationSamplesRef.current.map(
      (sample) => ({
        landmarks: upperBodyTraceLandmarks(sample.landmarks),
        observedCameraTiltDeg: finiteNumberOrNull(sample.observedTilt.cameraTiltDeg),
        confidence: sample.observedTilt.confidence,
      }),
    );
    neutralCalibrationSamplesRef.current = [];
    metricFiltersRef.current.clear();
    leftCompensationFiltersRef.current.clear();
    rightCompensationFiltersRef.current.clear();
    leftPrimaryFilterRef.current.reset();
    rightPrimaryFilterRef.current.reset();
    resetCompensationWarnings();
    setBaselinePhase("captured");
    updateNeutralCalibrationProgress(neutralCalibrationClockRef.current);
    return true;
  }

  /**
   * Throw away the movement currently in progress, and nothing else.
   *
   * Every repetition, hold and quality figure here is an accumulator over a
   * stretch of frames. If that stretch is interrupted — by a capture dropout,
   * or by the patient recalibrating mid-movement — the accumulator now spans
   * an interval nobody measured, and finishing it produces a repetition whose
   * duration, peak and quality describe two different things joined together.
   * Discarding is the only honest option: a repetition that was not observed
   * end to end cannot be scored.
   *
   * Deliberately does NOT touch what has already been credited.
   * `RepCounter.reset()` clears in-progress state and leaves `repIndex` alone,
   * and `repCountsRef`/`completedSetsRef` are untouched here, so finished
   * repetitions and closed sets survive. Nor does it touch the neutral
   * baseline: the baseline describes the BODY, and every caller of this
   * function has its own answer to whether the baseline is still good.
   */
  function discardInProgressMovement(): void {
    metricFiltersRef.current.forEach((filter) => filter.reset());
    leftCompensationFiltersRef.current.forEach((filter) => filter.reset());
    rightCompensationFiltersRef.current.forEach((filter) => filter.reset());
    leftPrimaryFilterRef.current.reset();
    rightPrimaryFilterRef.current.reset();
    leftRepCounterRef.current?.reset();
    rightRepCounterRef.current?.reset();
    bidirectionalRepCounterRef.current?.reset();
    dynamicRepQualityBufferRef.current.reset();
    pairedHoldMsRef.current = 0;
    leftHoldMsRef.current = 0;
    rightHoldMsRef.current = 0;
    leftInBandRef.current = false;
    rightInBandRef.current = false;
    lastIsometricTickMsRef.current = null;
    resetHoldQualityAccum();
    setHoldState({
      pairedSec: 0,
      leftSec: 0,
      rightSec: 0,
      leftInBand: false,
      rightInBand: false,
    });
    resetCompensationWarnings();
  }

  function resetAfterSustainedCaptureDropout(
    definition: ExerciseDefinition | null,
  ): void {
    // Counted for the capture summary: each reset discards the movement in
    // progress, so it can explain repetitions that were not counted.
    if (sessionStateRef.current === "active") captureDropoutResetsRef.current += 1;
    discardInProgressMovement();

    if (baselinePhaseRef.current === "captured") {
      // A FINISHED baseline is kept. It describes the body, and re-capturing it
      // here would silently re-anchor "neutral" to whatever posture the
      // interruption happened in — which is exactly the defect a recorded
      // session hit, calibrating three times in eighty seconds and adopting a
      // lean and then a slouch as the reference. Offer recalibration instead.
      if (
        definition &&
        (sessionStateRef.current === "active" ||
          sessionStateRef.current === "countdown")
      ) {
        calibrationStaleRef.current = true;
        setCalibrationStale(true);
      }
    } else {
      // An UNFINISHED baseline is discarded, and this is the opposite case for
      // the same reason. The samples taken before the interruption describe a
      // setup that has now been interrupted; the camera may have been moved,
      // which is a common cause of the dropout in the first place. Keeping them
      // would let one calibration straddle two setups and silently blend them
      // into a median. There is nothing to warn about here, because no baseline
      // was ever presented as good — calibration simply starts over.
      resetNeutralCalibration("capturing");
    }
    captureDropoutResetDoneRef.current = true;
  }

  /**
   * The Recalibrate button. Recalibrating mid-movement is a measurement
   * boundary, not just a new baseline, so the movement in progress is thrown
   * away first.
   *
   * Without the discard, a repetition that began before the button was pressed
   * survives the calibration pause and is completed afterwards. It is then
   * credited toward set progress and can close the set, carrying a duration
   * that spans the unmeasured calibration interval. Worse, it accumulated its
   * peak under the OLD frozen tilt and baselines and has its completion
   * threshold evaluated under the NEW ones — so whenever recalibration actually
   * moves the reference, which is the only reason to press this button, that
   * repetition is adjudicated across two different measurement frames.
   */
  function handleManualRecalibration(): void {
    discardInProgressMovement();
    resetNeutralCalibration("capturing");
  }

  function ex005CounterSide(
    signedDeg: number | null | undefined,
  ): BidirectionalSide | "neutral" | "unknown" {
    if (typeof signedDeg !== "number") return "unknown";
    if (Math.abs(signedDeg) < 2) return "neutral";
    return signedDeg > 0 ? "left" : "right";
  }

  function ex005ScreenDirection(
    headOffsetX: number | null,
  ): "image-left" | "image-right" | "center" | "unknown" {
    if (headOffsetX === null) return "unknown";
    if (Math.abs(headOffsetX) < 0.015) return "center";
    return headOffsetX > 0 ? "image-right" : "image-left";
  }

  function pushEx005DebugRecord({
    kind,
    tNow,
    landmarks,
    framingMode,
    captureOk,
    captureMessage,
    rawSignedDeg,
    smoothedSignedDeg,
    perFrameCorrectedSignedDeg,
    tiltReference,
    before,
    after,
    emitted,
  }: {
    kind: Ex005DebugRecord["kind"];
    tNow: number;
    landmarks: Array<{ x: number; y: number; visibility?: number }>;
    framingMode: FramingMode;
    captureOk: boolean;
    captureMessage: string | null;
    rawSignedDeg: number | null;
    smoothedSignedDeg: number | null;
    perFrameCorrectedSignedDeg?: number | null;
    tiltReference?: ExerciseFrameMetrics["tiltReference"] | null;
    before?: BidirectionalRepCounterDebugSnapshot | null;
    after?: BidirectionalRepCounterDebugSnapshot | null;
    emitted?: Ex005DebugRecord["emitted"];
  }) {
    if (
      !ex005DebugEnabledRef.current ||
      activeDefinitionRef.current?.id !== "ex_005"
    ) {
      return;
    }

    if (ex005DebugStartMsRef.current === null) {
      ex005DebugStartMsRef.current = tNow;
    }

    const leftEar = landmarks[7];
    const rightEar = landmarks[8];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    const earMid = midpointDebug(leftEar, rightEar);
    const hipMid = midpointDebug(leftHip, rightHip);
    const headOffsetX =
      earMid.x !== null && hipMid.x !== null
        ? roundDebugNumber(earMid.x - hipMid.x)
        : null;
    const uncorrectedHeadLeanDeg = headLeanFromVerticalDebug(hipMid, earMid);
    const hipLineDeg = bodyPairAngleDebug(leftHip, rightHip);
    const earLineDeg = bodyPairAngleDebug(leftEar, rightEar);
    const visibleSigned =
      typeof smoothedSignedDeg === "number" ? smoothedSignedDeg : rawSignedDeg;

    const record: Ex005DebugRecord = {
      seq: ++ex005DebugSeqRef.current,
      kind,
      tMs: Math.round(tNow),
      elapsedMs: Math.round(tNow - ex005DebugStartMsRef.current),
      exerciseId: "ex_005",
      sessionState: sessionStateRef.current,
      capture: {
        ok: captureOk,
        message: captureMessage,
        framingMode,
      },
      metric: {
        rawSignedDeg: roundDebugNumber(rawSignedDeg, 1),
        smoothedSignedDeg: roundDebugNumber(smoothedSignedDeg, 1),
        uncorrectedHeadLeanDeg: roundDebugNumber(uncorrectedHeadLeanDeg, 1),
        neutralBaselineDeg: roundDebugNumber(
          bidirectionalBaselineRef.current.value,
          1,
        ),
        perFrameCorrectedSignedDeg: roundDebugNumber(
          perFrameCorrectedSignedDeg,
          1,
        ),
        absDeg:
          typeof visibleSigned === "number"
            ? roundDebugNumber(Math.abs(visibleSigned), 1)
            : null,
        screenDirection: ex005ScreenDirection(headOffsetX),
        counterSide: ex005CounterSide(visibleSigned),
        signConvention: "positive signed angle -> counter left",
      },
      tilt: {
        cameraTiltDeg: roundDebugNumber(tiltReference?.cameraTiltDeg, 1),
        confidence: tiltReference?.confidence ?? null,
        divergenceDeg: roundDebugNumber(tiltReference?.divergenceDeg, 1),
        hipLineDeg: roundDebugNumber(hipLineDeg, 1),
        earLineDeg: roundDebugNumber(earLineDeg, 1),
      },
      landmarks: {
        leftEar: landmarkDebug(leftEar),
        rightEar: landmarkDebug(rightEar),
        leftHip: landmarkDebug(leftHip),
        rightHip: landmarkDebug(rightHip),
        earMid,
        hipMid,
        headOffsetX,
      },
      counter: {
        before: before ?? null,
        after: after ?? null,
      },
      emitted: emitted ?? null,
      counts: {
        left: repCountsRef.current.left,
        right: repCountsRef.current.right,
      },
    };

    ex005DebugRef.current.push(record);
    if (ex005DebugRef.current.length > MAX_EX005_DEBUG_RECORDS) {
      ex005DebugRef.current.splice(
        0,
        ex005DebugRef.current.length - MAX_EX005_DEBUG_RECORDS,
      );
    }
    if (typeof window !== "undefined") {
      window.__ex005Debug = ex005DebugRef.current;
    }
    console.log(`[ex005-debug] ${JSON.stringify(record)}`);
  }

  const [frameMetrics, setFrameMetrics] = useState<ExerciseFrameMetrics>(
    emptyFrameMetrics,
  );
  // Whether the primary movement is near peak ROM this frame. Gates the
  // `peakRelevant` compensation warnings (e.g. elbowFlexion "Straighten arms"
  // on ex_007 / ex_008) so they only surface near full extension. Updated on
  // the same throttled cadence as `frameMetrics`.
  const [nearPeak, setNearPeak] = useState(false);

  // ── Derived display strings ──────────────────────────────────────────────
  // These keep the JSX clean and centralize all null-to-display-string logic.

  // Low tilt confidence has two meanings:
  // 1. One reference line is missing (divergenceDeg === null): actionable
  //    camera/framing issue, so show the patient-facing banner.
  // 2. Hips and ears are both visible but disagree: expected during some
  //    exercises and retained as an internal metric flag, not a persistent
  //    patient warning.
  const showTiltWarning = hasMissingTiltReferenceLine(frameMetrics.tiltReference);

  // `metricCards` is the list of cards to render in the left rail.
  // Built dynamically from the active exercise definition. Primary metric
  // renders first, then each compensation metric.

  const metricCards: CardSpec[] = (() => {
    if (!activeDefinition) return [];
    const cards: CardSpec[] = [];

    const primaryMetric =
      activeDefinition.kind === "dynamic"
        ? activeDefinition.primaryMetric.name
        : activeDefinition.isometric.metric;
    const primaryIsAngle = metricUsesDegrees(primaryMetric);
    const perLimb =
      activeDefinition.bilateral &&
      activeDefinition.bilateralMode === "per-limb";
    if (perLimb && prescription.prescribedSide === "both") {
      for (const side of ["left", "right"] as const) {
        cards.push({
          id: `primary:${side}`,
          metric: primaryMetric,
          label: `${metricLabel(primaryMetric)} · ${side}`,
          value: displayPerSidePrimary?.[side] ?? null,
          kind: "primary",
          isAngle: primaryIsAngle,
        });
      }
    } else if (perLimb) {
      const side: "left" | "right" =
        prescription.prescribedSide === "right" ? "right" : "left";
      cards.push({
        id: `primary:${side}`,
        metric: primaryMetric,
        label: `${metricLabel(primaryMetric)} · ${side}`,
        value: displayPerSidePrimary?.[side] ?? null,
        kind: "primary",
        isAngle: primaryIsAngle,
      });
    } else {
      cards.push({
        id: "primary:single",
        metric: primaryMetric,
        label: metricLabel(primaryMetric),
        value: frameMetrics.metrics[primaryMetric] ?? null,
        kind: "primary",
        isAngle: primaryIsAngle,
      });
    }

    for (const comp of activeDefinition.compensationMetrics) {
      const signal = compensationWarningSignalsRef.current.get(comp.name);
      const coupled =
        getCompensationScoring(comp).mode === "primary-coupled";
      const sideSuffix = signal?.side ? ` · ${signal.side}` : "";
      cards.push({
        id: `compensation:${comp.name}`,
        metric: comp.name,
        label: `${metricLabel(comp.name)}${coupled ? " DEV" : ""}${sideSuffix}`,
        value: frameMetrics.metrics[comp.name] ?? null,
        kind: "compensation",
        isAngle: metricUsesDegrees(comp.name),
        warningThreshold: comp.warningThreshold,
        compareDirection: comp.compareDirection,
        // Single-cue consumption: only the metric the selector promoted is
        // highlighted, so the card list and the canvas overlay agree on the one
        // thing the patient is being asked to correct. Every metric still shows
        // its live value and threshold; the other latched warnings are simply
        // not highlighted while another cue holds the slot.
        warningActive:
          selectedCoachingCueMetric === comp.name &&
          activeCompensationWarnings.has(comp.name),
        // peakRelevant comps (elbowFlexion on ex_007/ex_008) only warn near
        // peak ROM — bent elbows are correct form lower in the movement.
        suppressWarning:
          sessionState !== "active" ||
          !captureOk ||
          baselinePhase !== "captured" ||
          (comp.peakRelevant === true && !nearPeak) ||
          (prescription.prescribedSide !== "both" &&
            comp.name === "shoulderSymmetry"),
      });
    }
    return cards;
  })();



  // Derived stat-panel values (replacing the hardcoded
  // placeholders that lived here pre-2026-05-22).

  /**
   * Progress through the entire session.
   *   completedSets * targetReps    — reps already locked in from finished sets.
   *   min(currentLeft, currentRight) — reps that count toward the CURRENT set
   *                                   under Model C (the slower side gates set
   *                                   completion; the faster side's surplus
   *                                   doesn't advance progress further).
   *   Divided by (targetSets * targetReps) for a 0–100 percentage.
   *
   * Isometric exercises (ex_006) don't track reps yet (P3b unbuilt) — we
   * fall back to 0 so the bar doesn't show a misleading value.
   */
  const currentSetMinReps = activeDefinition?.bilateral
    ? prescription.prescribedSide === "left"
      ? repCounts.left
      : prescription.prescribedSide === "right"
        ? repCounts.right
        : Math.min(repCounts.left, repCounts.right)
    : repCounts.left;
  const targetTotalReps = Math.max(1, prescription.sets * prescription.reps);
  const clampPct = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
  const progressPct =
    activeDefinition?.kind === "dynamic"
      ? clampPct(
          ((completedSets * prescription.reps + currentSetMinReps) /
            targetTotalReps) *
            100,
        )
      : activeDefinition?.kind === "isometric"
        ? (() => {
            // Hold analogue of the rep formula: each completed set contributes
            // a full hold; the current set contributes its credited hold
            // seconds, capped at the per-set target. Per-limb (ex_006): the
            // paired (both-arms-in-band) accumulator. Side-split (ex_004):
            // each side owes the full hold, so the set is the average of the
            // two capped per-side holds — finishing one side reads as half
            // the set, and the faster side's surplus can't advance it further.
            const creditedSec =
              prescription.prescribedSide === "left"
                ? holdState.leftSec
                : prescription.prescribedSide === "right"
                  ? holdState.rightSec
                  : Math.min(holdState.leftSec, holdState.rightSec);
            const cappedSec = Math.min(
              creditedSec,
              prescription.holdSeconds,
            );
            const targetTotalSec = Math.max(
              1,
              prescription.sets * prescription.holdSeconds,
            );
            return clampPct(
              ((completedSets * prescription.holdSeconds + cappedSec) /
                targetTotalSec) *
                100,
            );
          })()
        : 0;

  /**
   * TIME cell value: session elapsed time, formatted MM:SS. Driven by
   * `sessionElapsedSec` (ticked every 1 s by the session-timer useEffect
   * while `sessionState === "active"`). Shows 00:00 in idle/ended states.
   */
  const timer = formatElapsedTime(sessionElapsedSec);

  // ---------------------------------------------------------
  // Init model
  // ---------------------------------------------------------
  useEffect(() => {
    const initLandmarker = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );
        visionFilesetRef.current = vision;
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/models/pose_landmarker_full.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        });
        landmarkerRef.current = landmarker;
        setModelLoaded(true);
      } catch (err) {
        console.error(err);
        setError("AI Model failed. Check public/models/pose_landmarker_full.task");
      }
    };
    initLandmarker();
  }, []);

  // Opt-in staff diagnostic only. Face Landmarker is loaded lazily for
  // ex_004 and is never consulted by feedback, hold timing, scoring, storage,
  // or ML. numFaces=2 intentionally disables MediaPipe's single-face temporal
  // smoothing; frames with zero or multiple faces are rejected below.
  useEffect(() => {
    const staffAllowed = user?.role === "admin" || user?.role === "therapist";
    const shouldLoad =
      staffAllowed &&
      ex004FaceShadowEnabled &&
      activeDefinition?.id === "ex_004";

    if (!shouldLoad) {
      faceLandmarkerRef.current?.close();
      faceLandmarkerRef.current = null;
      commitEx004FaceShadowModelState(
        ex004FaceShadowEnabled ? "waiting" : "disabled",
      );
      return;
    }

    const vision = visionFilesetRef.current;
    if (!modelLoaded || !vision) {
      commitEx004FaceShadowModelState("waiting");
      return;
    }

    let cancelled = false;
    let created: FaceLandmarker | null = null;
    commitEx004FaceShadowModelState("loading");

    void FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: EX004_FACE_SHADOW_MODEL_PATH,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 2,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
    })
      .then((landmarker) => {
        created = landmarker;
        if (cancelled) {
          landmarker.close();
          return;
        }
        faceLandmarkerRef.current = landmarker;
        commitEx004FaceShadowModelState("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        console.error("[ex004-face-shadow] model load failed", reason);
        commitEx004FaceShadowModelState("error", message);
      });

    return () => {
      cancelled = true;
      if (created) {
        if (faceLandmarkerRef.current === created) {
          faceLandmarkerRef.current = null;
        }
        created.close();
      }
    };
  }, [
    activeDefinition?.id,
    commitEx004FaceShadowModelState,
    ex004FaceShadowEnabled,
    modelLoaded,
    user?.role,
  ]);

  // Load exercises from database.
  // Admin/therapist: fetch all exercises and show ex_001–ex_006 for troubleshooting.
  // Patient: fetch only their assigned exercises.
  useEffect(() => {
    if (!user?.id) return;

    const isStaff = user.role === "admin" || user.role === "therapist";

    if (isStaff) {
      fetch("/api/exercises")
        .then((r) => r.json())
        .then((data: unknown) => {
          // Staff debug catalog: the active ex_NNN list after EX_SWAP (2026-05-21).
          // ex_002 (Overhead Arm Raises) and ex_003 (Shoulder Shrugs) are
          // deprecated — see the @deprecated JSDocs on those entries in
          // `registry.ts`. They remain in the DB and registry for audit,
          // but should not surface in the staff dropdown.
          const DEBUG_IDS = ["ex_001", "ex_004", "ex_005", "ex_006", "ex_007", "ex_008"];
          const exercises: Exercise[] = recordsField(data, "exercises")
            .flatMap((row): Exercise[] => {
              const id = stringField(row, "id");
              if (!id || !DEBUG_IDS.includes(id)) return [];
              return [{
                id,
                name: stringField(row, "name") ?? id,
                description: stringField(row, "description") ?? "",
              // Staff debug catalog has no per-patient prescription —
              // fall back to the patient_exercises DB defaults (3 × 12)
              // so the session lifecycle still has a target to gate
              // set completion.
                sets: DEFAULT_PRESCRIPTION.sets,
                reps: DEFAULT_PRESCRIPTION.reps,
                restSeconds: DEFAULT_PRESCRIPTION.restSeconds,
                holdSeconds: DEFAULT_PRESCRIPTION.holdSeconds,
                prescribedSide: DEFAULT_PRESCRIPTION.prescribedSide,
                resistance: DEFAULT_PRESCRIPTION.resistance,
              }];
            })
            .sort((a, b) => a.id.localeCompare(b.id));
          setAssignedExercises(exercises);
          if (exercises.length > 0) {
            setSelectedExercise((prev) => {
              if (prev) return prev;
              const found = exercises.find((e) => e.id === initialExerciseId);
              return found ? initialExerciseId : exercises[0].id;
            });
          }
        })
        .catch((err) => console.error("Error loading exercises:", err));
    } else {
      fetch("/api/patient-exercises")
        .then((r) => r.json())
        .then((data: unknown) => {
          const assigned: Exercise[] = recordsField(data, "occurrences").flatMap((row): Exercise[] => {
            const occurrenceId = integerField(row, "id");
            const id = stringField(row, "exercise_id");
            const dueDate = stringField(row, "due_date");
            const makeupUntil = stringField(row, "makeup_until") ?? dueDate;
            const status = assignmentStatus(row.status);
            if (
              occurrenceId === undefined ||
              !id ||
              !dueDate ||
              !makeupUntil ||
              !status ||
              stringField(row, "monitoring_mode") !== "camera" ||
              !isOccurrenceActionable(
                { dueDate, makeupUntil, status },
                effectiveTodayPH,
              )
            ) {
              return [];
            }
            const prescribedSideValue = stringField(row, "prescribed_side");
            const prescribedSide: PrescribedSide =
              prescribedSideValue === "left" || prescribedSideValue === "right"
                ? prescribedSideValue
                : "both";
            const resistanceRow = isRecord(row.resistance) ? row.resistance : {};
            const resistanceValueRaw = resistanceRow.value;
            const resistanceValue =
              resistanceValueRaw === null || resistanceValueRaw === undefined
                ? null
                : Number(resistanceValueRaw);
            return [{
              id,
              name: stringField(row, "name") ?? id,
              description: stringField(row, "description") ?? "",
            // `patient_exercises.reps` is the per-side target: prescription
            // reps = 10 means 10 reps per side. `patient_exercises.sets`
            // is total set count.
            // Both default in the DB schema to 12 / 3 respectively;
            // mirror those if the API response omits them.
              reps: numberField(row, "reps") ?? DEFAULT_PRESCRIPTION.reps,
              sets: numberField(row, "sets") ?? DEFAULT_PRESCRIPTION.sets,
              restSeconds:
                numberField(row, "rest_seconds") ??
                DEFAULT_PRESCRIPTION.restSeconds,
              holdSeconds:
                numberField(row, "hold_seconds") ??
                DEFAULT_PRESCRIPTION.holdSeconds,
              patientExerciseId: integerField(row, "patient_exercise_id"),
              occurrenceId,
              dueDate,
              makeupUntil,
              sequenceIndex: integerField(row, "sequence_index") ?? Number.MAX_SAFE_INTEGER,
              status,
              prescribedSide,
              resistance: {
                type:
                  resistanceRow.type === "none" ||
                  resistanceRow.type === "external_weight" ||
                  resistanceRow.type === "resistance_band" ||
                  resistanceRow.type === "other"
                    ? resistanceRow.type
                    : "unknown",
                value:
                  resistanceValue !== null && Number.isFinite(resistanceValue)
                    ? resistanceValue
                    : null,
                unit:
                  resistanceRow.unit === "kg" || resistanceRow.unit === "lb"
                    ? resistanceRow.unit
                    : null,
                label:
                  typeof resistanceRow.label === "string"
                    ? resistanceRow.label
                    : null,
              },
            }];
          }).sort((left, right) =>
            compareActionableOccurrences(
              {
                occurrenceId: left.occurrenceId!,
                exerciseId: left.id,
                exerciseName: left.name,
                sequenceIndex: left.sequenceIndex!,
                dueDate: left.dueDate!,
                makeupUntil: left.makeupUntil!,
                status: left.status as OccurrenceStatus,
              },
              {
                occurrenceId: right.occurrenceId!,
                exerciseId: right.id,
                exerciseName: right.name,
                sequenceIndex: right.sequenceIndex!,
                dueDate: right.dueDate!,
                makeupUntil: right.makeupUntil!,
                status: right.status as OccurrenceStatus,
              },
            ),
          );
          assignedExercisesRef.current = assigned;
          setAssignedExercises(assigned);
          setActionableOccurrenceIds(
            new Set(
              assigned.flatMap((exercise) =>
                exercise.occurrenceId === undefined ? [] : [exercise.occurrenceId],
              ),
            ),
          );
          if (assigned.length > 0) {
            const exactOccurrenceWasRequested = initialOccurrenceIdParam !== null;
            const exactOccurrence =
              initialOccurrenceId === null
                ? undefined
                : assigned.find(
                    (exercise) => exercise.occurrenceId === initialOccurrenceId,
                  );
            if (exactOccurrenceWasRequested && !exactOccurrence) {
              selectedExerciseRef.current = "";
              setSelectedExercise("");
              setScheduleNotice(
                "That scheduled occurrence is no longer actionable. Returning to your schedule.",
              );
              router.replace("/dashboard/patient?tab=session");
              return;
            }
            const requested =
              exactOccurrence ??
              assigned.find((exercise) => exercise.id === initialExerciseId) ??
              assigned[0];
            selectedExerciseRef.current = requested.id;
            setSelectedExercise(requested.id);
            if (!exactOccurrenceWasRequested && requested.occurrenceId !== undefined) {
              router.replace(
                `/camera?occurrenceId=${requested.occurrenceId}&exerciseId=${encodeURIComponent(requested.id)}`,
                { scroll: false },
              );
            }
          } else {
            selectedExerciseRef.current = "";
            setSelectedExercise("");
          }
        })
        .catch((err) => console.error("Error loading exercises:", err));

      // Persisted session history → latest FINISHED session per exercise, for
      // the "already completed" recap overlay. Sessions arrive newest-first, so
      // the first one seen per exercise id with an ended_at is the latest
      // finished attempt. Fire-and-forget; failure just leaves the map empty.
      fetch("/api/sessions")
        .then((r) => (r.ok ? r.json() : null))
        .then((data: unknown) => {
          const sessions = recordsField(data, "sessions");
          if (sessions.length === 0) return;
          const recaps = new Map<string, ExerciseSessionRecap>();
          // Latest OPEN session per exercise (endedAt === null) — a disrupted
          // attempt whose row was never closed. Used to gate the resume prompt.
          const opens = new Map<string, { sessionId: number; startedAt: string }>();
          for (const s of sessions) {
            const exerciseId = stringField(s, "exerciseId");
            if (!exerciseId) continue;
            const endedAt = stringField(s, "endedAt");
            if (!endedAt) {
              const sessionId = integerField(s, "id");
              if (sessionId !== undefined && !opens.has(exerciseId)) {
                opens.set(exerciseId, {
                  sessionId,
                  startedAt: stringField(s, "startedAt") ?? "",
                });
              }
              continue;
            }
            // Recap = the latest TRULY completed attempt only. A completed
            // assignment keeps status "completed" across redos, so a later
            // ended-early ('user') or auto-superseded redo must NOT become the
            // recap source (it would show partial / 0-set numbers). Only
            // end_reason 'completed' rows qualify; newest-first → first wins.
            if (stringField(s, "endReason") !== "completed") continue;
            if (recaps.has(exerciseId)) continue;
            const recapSideValue = stringField(s, "prescribedSide");
            const recapPrescribedSide: PrescribedSide =
              recapSideValue === "left" || recapSideValue === "right"
                ? recapSideValue
                : "both";
            recaps.set(exerciseId, {
              sessionId: numberField(s, "id") ?? null,
              exerciseKind: exerciseKind(s.exerciseKind),
              prescribedSide: recapPrescribedSide,
              endedAt,
              durationMs: numberField(s, "durationMs") ?? null,
              setCount: numberField(s, "setCount") ?? 0,
              leftReps: numberField(s, "leftReps") ?? 0,
              rightReps: numberField(s, "rightReps") ?? 0,
              completeLeftReps: numberField(s, "completeLeftReps") ?? 0,
              completeRightReps: numberField(s, "completeRightReps") ?? 0,
              avgPeakValue: numberField(s, "avgPeakValue") ?? null,
              avgLeftPeakValue: numberField(s, "avgLeftPeakValue") ?? null,
              avgRightPeakValue: numberField(s, "avgRightPeakValue") ?? null,
              totalPairedHoldMs: numberField(s, "totalPairedHoldMs") ?? null,
              totalTargetHoldMs: numberField(s, "totalTargetHoldMs") ?? null,
              totalLeftHoldMs: numberField(s, "totalLeftHoldMs") ?? null,
              totalRightHoldMs: numberField(s, "totalRightHoldMs") ?? null,
            });
          }
          setSessionRecaps(recaps);
          setOpenSessions(opens);
        })
        .catch((err) => console.warn("Error loading session recaps:", err));
    }
  }, [
    effectiveTodayPH,
    initialExerciseId,
    initialOccurrenceId,
    initialOccurrenceIdParam,
    router,
    user?.id,
    user?.role,
  ]);

  useEffect(() => {
    const assignedEntry = selectedExercise
      ? assignedExercises.find((e) => e.id === selectedExercise)
      : undefined;
    const nextPrescription = assignedEntry
      ? {
          sets: assignedEntry.sets,
          reps: assignedEntry.reps,
          restSeconds: assignedEntry.restSeconds,
          holdSeconds: assignedEntry.holdSeconds,
          patientExerciseId: assignedEntry.patientExerciseId,
          occurrenceId: assignedEntry.occurrenceId,
          prescribedSide: assignedEntry.prescribedSide,
          resistance: assignedEntry.resistance,
        }
      : DEFAULT_PRESCRIPTION;
    prescriptionRef.current = nextPrescription;
    setPrescriptionRaw(nextPrescription);
  }, [selectedExercise, assignedExercises]);

  useLayoutEffect(() => {
    if (!selectedExercise) {
      setActiveDefinition(null);
      // Close any open persisted session (idempotent; no-op if none).
      endSessionPersistenceRef.current();
      leftRepCounterRef.current = null;
      rightRepCounterRef.current = null;
      bidirectionalRepCounterRef.current = null;
      dynamicRepQualityBufferRef.current.reset();
      repLogRef.current = { left: [], right: [] };
      priorRepOutcomesRef.current = { left: [], right: [] };
      neckRepDebugRef.current = [];
      neckRepDebugStartMsRef.current = null;
      neckRepDebugSeqRef.current = 0;
      if (typeof window !== "undefined") {
        window.__neckRepDebug = neckRepDebugRef.current;
      }
      clearEx004FaceShadow();
      setRepCounts({ left: 0, right: 0 });
      lastMetricsUpdateRef.current = 0;
      compensationWarningSignalsRef.current.clear();
      setDisplayPerSidePrimary(null);
      setFrameMetrics(emptyFrameMetrics());
      setNearPeak(false);
      resetCompensationWarnings();
      resetNeutralCalibration("not-needed");
      return;
    }

    const def = getExerciseDefinition(selectedExercise);
    setActiveDefinition(def);

    // Reset the session lifecycle on every exercise change.
    // The user has to click sidebar Start on the new exercise to begin a
    // fresh session; rep counting stays gated until they do. completedSets,
    // currentSetReps (repCounts), and the completed-sets log all clear.
    // Close any session left open on the previous exercise (idempotent: the
    // guided-flow auto-advance already ended it, so this is a safety net for
    // manual stepper navigation).
    endSessionPersistenceRef.current();
    setSessionState("idle");
    setConfirmingEnd(false);
    restEndsAtMsRef.current = null;
    setRestRemainingSec(0);
    sessionStartMsRef.current = null;
    setSessionElapsedSec(0);
    setCompletedSets(0);
    completedSetsLogRef.current = [];
    repCountsRef.current = { left: 0, right: 0 };
    currentSetStartMsRef.current = null;
    pairedHoldMsRef.current = 0;
    leftHoldMsRef.current = 0;
    rightHoldMsRef.current = 0;
    leftInBandRef.current = false;
    rightInBandRef.current = false;
    lastIsometricTickMsRef.current = null;
    resetHoldQualityAccumRef.current();
    setHoldState({ pairedSec: 0, leftSec: 0, rightSec: 0, leftInBand: false, rightInBand: false });
    // Clear every displayed value synchronously with the selected exercise.
    // The next exercise must enter calibration with empty cards rather than
    // briefly showing the previous side's primary/compensation telemetry.
    lastMetricsUpdateRef.current = 0;
    compensationWarningSignalsRef.current.clear();
    setDisplayPerSidePrimary(null);
    setFrameMetrics(emptyFrameMetrics());
    setNearPeak(false);
    resetCompensationWarnings();

    // Reset filters whenever the exercise changes — old filter history would
    // bleed across exercises and produce a misleading first-frame jump.
    // The per-side primary filters are RECREATED (rather than reset) so they
    // can pick up the per-exercise smoothing override when present. Falls
    // back to the global degree-scale default for exercises without one.
    metricFiltersRef.current.clear();
    const primaryParams =
      def?.kind === "dynamic" && def.primaryMetric.smoothing
        ? def.primaryMetric.smoothing
        : { minCutoff: 1.0, beta: 0.1, dCutoff: undefined };
    leftPrimaryFilterRef.current = new OneEuroFilter(
      primaryParams.minCutoff,
      primaryParams.beta,
      primaryParams.dCutoff,
    );
    rightPrimaryFilterRef.current = new OneEuroFilter(
      primaryParams.minCutoff,
      primaryParams.beta,
      primaryParams.dCutoff,
    );

    // Rebuild rep counters based on the new definition. Isometric exercises
    // get no counter (they use time-in-band, handled separately when we
    // implement ex_006).
    leftRepCounterRef.current = null;
    rightRepCounterRef.current = null;
    bidirectionalRepCounterRef.current = null;
    dynamicRepQualityBufferRef.current.reset();
    repLogRef.current = { left: [], right: [] };
    priorRepOutcomesRef.current = { left: [], right: [] };
    neckRepDebugRef.current = [];
    neckRepDebugStartMsRef.current = null;
    neckRepDebugSeqRef.current = 0;
    if (typeof window !== "undefined") {
      window.__neckRepDebug = neckRepDebugRef.current;
    }
    clearEx004FaceShadow();
    setRepCounts({ left: 0, right: 0 });

    // Calibration starts only after the user presses Start. Idle camera
    // preview must not silently establish an attempt's neutral reference.
    resetNeutralCalibration("not-needed");

    const counters = createRepCountersForDefinition(def);
    leftRepCounterRef.current = counters.left;
    rightRepCounterRef.current = counters.right;
    bidirectionalRepCounterRef.current = counters.bidirectional;
  }, [
    clearEx004FaceShadow,
    resetCompensationWarnings,
    resetNeutralCalibration,
    selectedExercise,
  ]);

  const commitCaptureState = (ok: boolean, msg: string) => {
    if (lastCaptureOkRef.current !== ok) {
      if (!ok && baselinePhaseRef.current === "capturing") {
        neutralCalibrationClockRef.current = pauseNeutralCalibrationClock(
          neutralCalibrationClockRef.current,
        );
        updateNeutralCalibrationProgress(neutralCalibrationClockRef.current);
      }
      lastCaptureOkRef.current = ok;
      setCaptureOk(ok);
    }
    if (lastCaptureMsgRef.current !== msg) {
      lastCaptureMsgRef.current = msg;
      setCaptureMessage(msg);
    }
  };

  // ---------------------------------------------------------
  // AI loop
  // ---------------------------------------------------------
  const predictWebcam = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker) return;

    // Read activeDefinition through the ref instead of the closure-captured
    // state binding. The rAF loop kicked off in `startCamera` keeps
    // scheduling THIS function instance, so its closure
    // captured `activeDefinition` at definition time. Without this local
    // shadow, switching exercises mid-session would run the loop with the
    // previous exercise's definition. The ref is sync'd by a useEffect.
    const activeDefinition = activeDefinitionRef.current;

    if (video.readyState === 4 && video.videoWidth > 0) {
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

      // Footer telemetry. Commit resolution only on change; tally one processed
      // frame and recompute FPS over a rolling ~1 s window.
      if (
        videoResolutionRef.current?.width !== video.videoWidth ||
        videoResolutionRef.current?.height !== video.videoHeight
      ) {
        videoResolutionRef.current = { width: video.videoWidth, height: video.videoHeight };
        setVideoResolution({ width: video.videoWidth, height: video.videoHeight });
      }
      const nowFrame = performance.now();
      fpsFrameCountRef.current += 1;
      if (fpsWindowStartMsRef.current === 0) {
        fpsWindowStartMsRef.current = nowFrame;
      } else if (nowFrame - fpsWindowStartMsRef.current >= 1000) {
        setFps(
          Math.round((fpsFrameCountRef.current * 1000) / (nowFrame - fpsWindowStartMsRef.current)),
        );
        // Flush the timing split accumulated over this window. Sums come from
        // prior frames (this frame accumulates at the end of the loop), so they
        // stay matched to perfSampleCountRef.
        if (perfSampleCountRef.current > 0) {
          const n = perfSampleCountRef.current;
          setPerfMs({
            infer: inferMsSumRef.current / n,
            frame: frameMsSumRef.current / n,
          });
        }
        fpsFrameCountRef.current = 0;
        fpsWindowStartMsRef.current = nowFrame;
        inferMsSumRef.current = 0;
        frameMsSumRef.current = 0;
        perfSampleCountRef.current = 0;
      }

      const ctx = canvas.getContext("2d");
      if (ctx) {
        // Diagnostic timing: `frameStart` brackets the whole per-frame pipeline
        // (detect + readiness + metrics + drawing); `inferMs` isolates the
        // detectForVideo cost. `inferStart` doubles as the detect timestamp,
        // which must be monotonically increasing.
        const frameStart = performance.now();
        let coachingObservation: CoachingObservation = {
          capture: "unavailable", sessionState: sessionStateRef.current,
          baselineReady: baselinePhaseRef.current === "captured",
          movement: { left: "unknown", right: "unknown", activeSide: null },
          selected: null, rendered: [], renderEvidence: "canvas-frame", suppressedMetrics: [], absenceReason: "capture-unavailable",
        };
        const inferStart = frameStart;
        // Cleared here and read after the pipeline below. `bufferTuningRawFrame`
        // sets it on the one path that persists a row; every other path — no
        // person, capture unreadable, baseline not yet frozen, session not
        // active, tracing off — leaves it false and blanks the readout.
        traceSyncWroteThisFrameRef.current = false;
        const results = landmarker.detectForVideo(video, inferStart);
        const inferMs = performance.now() - inferStart;

        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const drawingUtils = new DrawingUtils(ctx);

        if (results.landmarks && results.landmarks.length > 0) {
          const landmarks = results.landmarks[0];

          drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
            color: "#00FF00",
            lineWidth: 3,
          });
          drawingUtils.drawLandmarks(landmarks, {
            color: "#FF0000",
            lineWidth: 1,
            radius: 3,
          });
          // A consented session video keeps this frame's pose, and below the
          // cue drawn on it, so playback can redraw the coaching overlays.
          const overlayFrame = recorderRef.current?.addOverlayFrame(landmarks) ?? null;

          // Framing mode is per-exercise: exercises that reach above head
          // height (ex_007 Press, ex_008 Wall Angels — `requiresOverheadRoom:
          // true`) get a relaxed head-y range and skip the wrist gate so the
          // patient can stand further back without losing metrics when
          // wrists briefly leave the frame at peak. Defaults to "default"
          // when no exercise is selected.
          const framingMode: FramingMode =
            activeDefinition?.requiresOverheadRoom
              ? "overhead"
              : activeDefinition?.requiresLateralRoom
                ? "lateral"
                : "default";
          const r = evaluateCaptureReadiness(
            landmarks,
            canvas.width,
            canvas.height,
            framingMode,
            prescriptionRef.current.prescribedSide,
          );
          if (r.ok && lastCaptureOkRef.current) {
            coachingObservation.capture = "available";
            coachingObservation.absenceReason = baselinePhaseRef.current !== "captured" ? "baseline-unavailable" : "not-selected";
          }

          // Tally capture quality for the active session (→ capture_quality_summary).
          if (sessionStateRef.current === "active") {
            captureFramesTotalRef.current += 1;
            if (r.ok) {
              captureFramesOkRef.current += 1;
            } else {
              const rejected = captureRejectedByStatusRef.current;
              rejected[r.status] = (rejected[r.status] ?? 0) + 1;
            }
          }

          // Unsteady-tracking check (display only): fed only frames that pass
          // capture readiness, so a dropout measures nothing. Every frame is
          // marked for the repetitions' tracking records, with the parts the
          // check could judge; the message and the session counts use the
          // prescribed parts.
          const checkedNow: TrackingPart[] = [];
          const unsteadyNow: TrackingPart[] = [];
          let checkedPrescribed = false;
          let unsteadyPrescribed: TrackingPart[] = [];
          if (r.ok && activeDefinition) {
            const steady = updateSteadiness(steadinessRef.current, landmarks, frameStart, canvas.width, canvas.height);
            steadinessRef.current = steady.state;
            for (const [part, judged] of Object.entries(steady.result.checked)) if (judged) checkedNow.push(part as TrackingPart);
            for (const [part, flagged] of Object.entries(steady.result.unsteady)) if (flagged) unsteadyNow.push(part as TrackingPart);
            const prescribed = trackingParts(trackingRegion(activeDefinition), prescriptionRef.current.prescribedSide);
            checkedPrescribed = prescribed.some((part) => checkedNow.includes(part));
            unsteadyPrescribed = prescribed.filter((part) => unsteadyNow.includes(part));
          }
          trackingMarksRef.current = addTrackingMark(trackingMarksRef.current, {
            t: frameStart, captureOk: r.ok, checked: checkedNow, unsteady: unsteadyNow,
          });
          if (sessionStateRef.current === "active" && r.ok && checkedPrescribed) {
            captureCheckedFramesRef.current += 1;
          }
          if (sessionStateRef.current === "active" && r.ok && unsteadyPrescribed.length > 0) {
            captureUnsteadyFramesRef.current += 1;
          }
          trackingMessageRef.current = updateTrackingMessage(trackingMessageRef.current, unsteadyPrescribed, frameStart);
          const hint = trackingMessageRef.current.part ? trackingMessage(trackingMessageRef.current.part) : null;
          if (hint !== trackingHintRef.current) {
            trackingHintRef.current = hint;
            setTrackingHint(hint);
          }

          const now = performance.now();
          if (!r.ok) {
            lastBadCaptureAtRef.current = now;
            stableOkSinceRef.current = 0;
            if (captureDropoutStartedAtRef.current === null) {
              captureDropoutStartedAtRef.current = now;
            }
            commitCaptureState(false, r.message);
            if (
              activeDefinition?.id === "ex_005" &&
              now - lastEx005DebugMsRef.current > EX005_DEBUG_THROTTLE_MS
            ) {
              lastEx005DebugMsRef.current = now;
              pushEx005DebugRecord({
                kind: "not-ready",
                tNow: now,
                landmarks,
                framingMode,
                captureOk: false,
                captureMessage: r.message,
                rawSignedDeg: null,
                smoothedSignedDeg: null,
                tiltReference: null,
              });
            }
          } else {
            captureDropoutStartedAtRef.current = null;
            captureDropoutResetDoneRef.current = false;
            if (stableOkSinceRef.current === 0) stableOkSinceRef.current = now;
            const okStable = now - stableOkSinceRef.current > 400;
            const badGone = now - lastBadCaptureAtRef.current > 400;
            if (okStable && badGone) commitCaptureState(true, "Captured");
          }

          if (!r.ok) {
            drawCutoutOverlay(ctx, canvas.width, canvas.height, r);
          }

          if (r.ok) {
            if (!activeDefinition) {
              // No exercise selected — nothing to compute. Clear stale state.
              if (compensationWarningStateIsDirty()) {
                resetCompensationWarnings();
              }
              setFrameMetrics({
                tiltReference: { cameraTiltDeg: 0, confidence: "insufficient", divergenceDeg: null },
                metrics: {},
                compensationScore: null,
              });
            } else {
              const tNow = performance.now();
              const observedTilt = computeTiltReference(landmarks);
              const ex004FaceShadowInference = inferEx004FaceShadow(
                video,
                landmarks,
                tNow,
              );

              if (baselinePhaseRef.current === "capturing") {
                const clock = advanceNeutralCalibrationClock(
                  neutralCalibrationClockRef.current,
                  tNow,
                );
                neutralCalibrationClockRef.current = clock;
                neutralCalibrationSamplesRef.current.push({
                  landmarks: landmarks.map((landmark) => ({ ...landmark })),
                  observedTilt,
                });
                if (neutralCalibrationSamplesRef.current.length > 300) {
                  neutralCalibrationSamplesRef.current.shift();
                }
                updateNeutralCalibrationProgress(clock);
                if (neutralCalibrationReady(clock)) {
                  finalizeNeutralCalibration(activeDefinition);
                }
              }

              if (
                baselinePhaseRef.current !== "captured" ||
                frozenTiltDegRef.current === null
              ) {
                if (compensationWarningStateIsDirty()) {
                  resetCompensationWarnings();
                }
                setFrameMetrics({
                  tiltReference: observedTilt,
                  metrics: {},
                  compensationScore: null,
                });
                setDisplayPerSidePrimary(null);
                recordEx004FaceShadow(ex004FaceShadowInference, null, tNow);
              } else {
              const effectiveTilt = frozenNeutralTiltReference(
                observedTilt,
                frozenTiltDegRef.current,
              );
              const raw = computePoseMetricsForExercise(
                landmarks,
                activeDefinition,
                effectiveTilt,
              );
              const metricInputs: Partial<Record<MetricName, number | null>> = {
                ...raw.metrics,
              };
              recordEx004FaceShadow(
                ex004FaceShadowInference,
                activeDefinition.id === "ex_004" &&
                  typeof raw.metrics.neckLateralFlexion === "number"
                  ? raw.metrics.neckLateralFlexion
                  : null,
                tNow,
              );
              let ex005PerFrameCorrectedSignedDeg: number | null = null;

              // Durable tuning trace (opt-in, any active exercise): record
              // RAW/unsmoothed values before any One Euro filtering or
              // rep-state-machine processing. This block is already inside
              // capture-readiness `r.ok`, so unreliable frames remain
              // excluded per the logging discipline. Baseline values read
              // from the refs are the medians captured in earlier frames.
              bufferTuningRawFrame(
                landmarks,
                results.worldLandmarks?.[0],
                raw,
                observedTilt,
                tNow,
              );

              // Direction strings for compensation overlay labels.
              // computePoseMetricsForExercise only surfaces absolute values in
              // raw.metrics; direction-rich results require calling the
              // underlying functions with the same tilt reference.
              const metricDirections: Partial<Record<MetricName, string>> = {};
              {
                const neckDir = computeLateralNeckTilt(
                  landmarks,
                  raw.tiltReference,
                )?.direction;
                if (neckDir && neckDir !== "center") {
                  metricDirections.neckTilt = neckDir;
                }
                // (Shoulder asymmetry places its boxes/arrow by raw landmark y
                // inside the overlay, so it needs no direction string here.)
                // Lean side (image-space) drives the trunk "STRAIGHTEN" arrow.
                const leanDir = computeTrunkLateralLean(
                  landmarks,
                  raw.tiltReference,
                )?.direction;
                if (leanDir && leanDir !== "center") {
                  metricDirections.trunkLean = leanDir;
                }
              }

              if (
                activeDefinition.kind === "dynamic" &&
                activeDefinition.id === "ex_005"
              ) {
                const primaryName = activeDefinition.primaryMetric.name;
                const perFrameCorrected = raw.metrics[primaryName];
                ex005PerFrameCorrectedSignedDeg =
                  typeof perFrameCorrected === "number"
                    ? perFrameCorrected
                    : null;

                const neutralBaseline = bidirectionalBaselineRef.current.value;
                metricInputs[primaryName] =
                  neutralBaseline !== null
                    ? computeTrunkLateralFlexionFromNeutralSigned(
                        landmarks,
                        neutralBaseline,
                      )
                    : null;
              }

              // Per-side scapular-elevation deltas (baseline − raw), kept
              // alongside the collapsed worst-side value below so the per-limb
              // compensation score can evaluate each side against its OWN
              // primary (see the worst-side score step after smoothing). Null
              // until the scap baseline is ready, exactly like the collapsed
              // metricInputs["scapularElevation"].
              let scapDeltaLeft: number | null = null;
              let scapDeltaRight: number | null = null;

              // ── Scapular elevation compensation baseline ─────────────────
              // For an exercise whose scapularElevation compensation metric
              // requires a neutral baseline, replace the raw projection with
              // (baseline − raw). The medians were finalized from the shared
              // time-based calibration window before this outcome path opened.
              // At rest the delta ≈ 0; it grows positive when the patient
              // shrugs, making the 0.04 warningThreshold meaningful.
              const needsScapCompBaseline = activeDefinition.compensationMetrics.some(
                (c) => c.name === "scapularElevation" && c.requiresBaselineCapture,
              );

              if (needsScapCompBaseline) {
                const rawScapLeft  = computeScapularElevation(landmarks, raw.tiltReference, "left");
                const rawScapRight = computeScapularElevation(landmarks, raw.tiltReference, "right");

                // Override metricInputs with baseline-adjusted delta.
                // (baseline − raw) is positive when shrugging; worst side
                // by |delta| (mirrors pickWorstSide "above" logic). Until the
                // compensation baseline is ready, suppress the raw absolute
                // value so rest posture cannot fire a false shrug warning.
                const lb = leftScapBaselineRef.current.value;
                const rb = rightScapBaselineRef.current.value;
                if (lb !== null && rb !== null) {
                  const dL = rawScapLeft  !== null ? lb - rawScapLeft  : null;
                  const dR = rawScapRight !== null ? rb - rawScapRight : null;
                  scapDeltaLeft = dL;
                  scapDeltaRight = dR;
                  metricInputs["scapularElevation"] =
                    dL === null && dR === null ? null :
                    dL === null               ? dR   :
                    dR === null               ? dL   :
                    Math.abs(dL) >= Math.abs(dR) ? dL : dR;
                } else {
                  metricInputs["scapularElevation"] = null;
                }
              }

              // Per-metric filtering. Lazily allocate a filter the first time
              // we see each metric for the active exercise. The filter map
              // gets cleared when the exercise changes (see the
              // `selectedExercise` effect).
              const smoothedMetrics: Partial<Record<MetricName, number | null>> = {};
              const smoothedMetricVelocities: Partial<
                Record<MetricName, number | null>
              > = {};
              for (const [metricName, value] of Object.entries(metricInputs) as Array<
                [MetricName, number | null]
              >) {
                if (typeof value !== "number") {
                  smoothedMetrics[metricName] = null;
                  smoothedMetricVelocities[metricName] = null;
                  continue;
                }
                let filter = metricFiltersRef.current.get(metricName);
                if (!filter) {
                  // The primary metric of a dynamic exercise may declare a
                  // smoothing override (small-signal-scale metrics like
                  // neckLateralFlexion or scapularElevation, where the global
                  // degree-scale default is too light and landmark jitter
                  // accumulates phantom reps while the patient is still). The
                  // per-limb path already honors this via the dedicated
                  // per-side filters; the bidirectional/unilateral path reads
                  // smoothedMetrics[primaryName], so the override must be
                  // applied HERE too or it is silently ignored for those modes.
                  const isPrimary =
                    activeDefinition.kind === "dynamic" &&
                    activeDefinition.primaryMetric.name === metricName;
                  const params =
                    isPrimary && activeDefinition.primaryMetric.smoothing
                      ? activeDefinition.primaryMetric.smoothing
                      : { minCutoff: 1.0, beta: 0.1, dCutoff: undefined };
                  filter = new OneEuroFilter(
                    params.minCutoff,
                    params.beta,
                    params.dCutoff,
                  );
                  metricFiltersRef.current.set(metricName, filter);
                }
                const filtered = filter.filterWithDerivative(value, tNow);
                smoothedMetrics[metricName] =
                  roundFilteredMetric(metricName, filtered.value);
                smoothedMetricVelocities[metricName] = filtered.velocity;
              }

              // Per-limb primary streams are filtered once and reused by the
              // counter, card, coupled warning, and live score. This prevents
              // one surface from silently reading the legacy scalar-left slot.
              const scoreIsPerLimb =
                activeDefinition.bilateral &&
                activeDefinition.bilateralMode === "per-limb";
              const scorePrimaryName =
                activeDefinition.kind === "dynamic"
                  ? activeDefinition.primaryMetric.name
                  : activeDefinition.isometric.metric;
              const primaryNeedsBaseline =
                activeDefinition.kind === "dynamic" &&
                activeDefinition.primaryMetric.requiresBaselineCapture === true;
              const primaryScale =
                scorePrimaryName === "wristShoulderVertical" ? 1_000 : 10;
              const adjustedPrimary = (
                value: number | null | undefined,
                baseline: number | null,
              ): number | null =>
                typeof value !== "number"
                  ? null
                  : primaryNeedsBaseline && baseline !== null
                    ? baseline - value
                    : value;
              const rawPrimaryLeft = scoreIsPerLimb
                ? adjustedPrimary(
                    raw.perSideMetrics?.left,
                    leftBaselineRef.current.value,
                  )
                : null;
              const rawPrimaryRight = scoreIsPerLimb
                ? adjustedPrimary(
                    raw.perSideMetrics?.right,
                    rightBaselineRef.current.value,
                  )
                : null;
              const smoothedPrimaryLeft =
                rawPrimaryLeft === null
                  ? null
                  : Math.round(
                      leftPrimaryFilterRef.current.filter(rawPrimaryLeft, tNow) *
                        primaryScale,
                    ) / primaryScale;
              const smoothedPrimaryRight =
                rawPrimaryRight === null
                  ? null
                  : Math.round(
                      rightPrimaryFilterRef.current.filter(rawPrimaryRight, tNow) *
                        primaryScale,
                    ) / primaryScale;

              const filterSideCompensation = (
                filters: Map<MetricName, OneEuroFilter>,
                name: MetricName,
                value: number | null | undefined,
                threshold: number,
              ): number | null => {
                if (typeof value !== "number") return null;
                let filter = filters.get(name);
                if (!filter) {
                  filter = new OneEuroFilter(1.0, 0.1);
                  filters.set(name, filter);
                }
                const scale = threshold < 1 ? 1_000 : 10;
                return (
                  Math.round(filter.filter(value, tNow) * scale) / scale
                );
              };
              const smoothedLeftCompensations: Partial<
                Record<MetricName, number | null>
              > = { ...smoothedMetrics };
              const smoothedRightCompensations: Partial<
                Record<MetricName, number | null>
              > = { ...smoothedMetrics };
              if (scoreIsPerLimb) {
                for (const comp of activeDefinition.compensationMetrics) {
                  const leftValue =
                    comp.name === "scapularElevation" && needsScapCompBaseline
                      ? scapDeltaLeft
                      : raw.perSideCompensationMetrics?.left[comp.name] ??
                        metricInputs[comp.name];
                  const rightValue =
                    comp.name === "scapularElevation" && needsScapCompBaseline
                      ? scapDeltaRight
                      : raw.perSideCompensationMetrics?.right[comp.name] ??
                        metricInputs[comp.name];
                  smoothedLeftCompensations[comp.name] =
                    filterSideCompensation(
                      leftCompensationFiltersRef.current,
                      comp.name,
                      leftValue,
                      comp.warningThreshold,
                    );
                  smoothedRightCompensations[comp.name] =
                    filterSideCompensation(
                      rightCompensationFiltersRef.current,
                      comp.name,
                      rightValue,
                      comp.warningThreshold,
                    );
                }
              }

              // ── Per-frame compensation score ─────────────────────────────
              // Each limb is paired with its own primary. A unilateral
              // prescription surfaces its prescribed limb; "both" surfaces
              // the worse score so a clean limb cannot mask compensation.
              let leftFrameCompensationScore: number | null = null;
              let rightFrameCompensationScore: number | null = null;
              let frameCompensationScore: number | null;
              if (scoreIsPerLimb) {
                leftFrameCompensationScore = computeCompensationScore(
                  activeDefinition,
                  smoothedLeftCompensations,
                  smoothedPrimaryLeft,
                );
                rightFrameCompensationScore = computeCompensationScore(
                  activeDefinition,
                  smoothedRightCompensations,
                  smoothedPrimaryRight,
                );
                const prescribed = prescriptionRef.current.prescribedSide;
                if (prescribed === "left") {
                  frameCompensationScore = leftFrameCompensationScore;
                } else if (prescribed === "right") {
                  frameCompensationScore = rightFrameCompensationScore;
                } else {
                  frameCompensationScore =
                    leftFrameCompensationScore === null
                      ? rightFrameCompensationScore
                      : rightFrameCompensationScore === null
                        ? leftFrameCompensationScore
                        : Math.min(
                            leftFrameCompensationScore,
                            rightFrameCompensationScore,
                          );
                }
              } else {
                frameCompensationScore = computeCompensationScore(
                  activeDefinition,
                  smoothedMetrics,
                  smoothedMetrics[scorePrimaryName] ?? null,
                );
              }

              // Raw feature channels remain separate from the smoothed live
              // score above. `computePoseMetricsForExercise` exposes per-side
              // compensation values before worst-side collapsing; the only
              // transform applied here is the same captured scapular baseline
              // already used by the live rule path.
              const rawSingleCompensations: Partial<
                Record<MetricName, number | null>
              > = { ...raw.metrics };
              const rawLeftCompensations: Partial<
                Record<MetricName, number | null>
              > = {
                ...(raw.perSideCompensationMetrics?.left ?? raw.metrics),
              };
              const rawRightCompensations: Partial<
                Record<MetricName, number | null>
              > = {
                ...(raw.perSideCompensationMetrics?.right ?? raw.metrics),
              };
              if (needsScapCompBaseline) {
                rawSingleCompensations.scapularElevation =
                  metricInputs.scapularElevation ?? null;
                rawLeftCompensations.scapularElevation = scapDeltaLeft;
                rawRightCompensations.scapularElevation = scapDeltaRight;
              }

              // Warning/card inputs use the same transformed signal as the
              // score. Coupled metrics therefore show and threshold their
              // residual from the expected value, not the raw movement that
              // naturally accompanies the exercise.
              const warningDisplayMetrics: Partial<
                Record<MetricName, number | null>
              > = { ...smoothedMetrics };
              const warningSignals = new Map<
                MetricName,
                CompensationWarningSignal
              >();
              // Coupled deviations exist only while the movement is under way:
              // below the repetition start threshold the body is at rest and
              // gives no coupled warning value, so it cannot raise a cue.
              const warningRestOptions = {
                restBelow:
                  activeDefinition.kind === "dynamic"
                    ? activeDefinition.primaryMetric.thresholds.startThreshold
                    : undefined,
              };
              for (const comp of activeDefinition.compensationMetrics) {
                // A cue with a rep window is judged once per repetition, per
                // limb, inside that window (see repWindowWarning.ts).
                const repWindow = comp.cue?.evaluation;
                if (
                  repWindow &&
                  scoreIsPerLimb &&
                  activeDefinition.kind === "dynamic"
                ) {
                  const result = repWindowCompensationWarningSignal(
                    comp,
                    prescriptionRef.current.prescribedSide,
                    {
                      left: {
                        value: smoothedLeftCompensations[comp.name] ?? null,
                        primary: smoothedPrimaryLeft,
                        phase: leftRepCounterRef.current?.getState() ?? null,
                      },
                      right: {
                        value: smoothedRightCompensations[comp.name] ?? null,
                        primary: smoothedPrimaryRight,
                        phase: rightRepCounterRef.current?.getState() ?? null,
                      },
                    },
                    repWindowStatesRef.current.get(comp.name) ?? newRepWindowState(),
                    tNow,
                    {
                      from: activeDefinition.primaryMetric.thresholds.startThreshold,
                      upTo: repWindow.upTo,
                      persistMs: repWindow.persistMs,
                    },
                  );
                  repWindowStatesRef.current.set(comp.name, result.state);
                  warningSignals.set(comp.name, result.signal);
                  warningDisplayMetrics[comp.name] = result.signal.value;
                  if (result.signal.side !== null && limbSideIsOverlayDirection(comp.name)) {
                    metricDirections[comp.name] = result.signal.side;
                  }
                  continue;
                }
                const signal = scoreIsPerLimb
                  ? perLimbCompensationWarningSignal(
                      comp,
                      prescriptionRef.current.prescribedSide,
                      {
                        leftValue:
                          smoothedLeftCompensations[comp.name] ?? null,
                        leftPrimary: smoothedPrimaryLeft,
                        rightValue:
                          smoothedRightCompensations[comp.name] ?? null,
                        rightPrimary: smoothedPrimaryRight,
                      },
                      warningRestOptions,
                    )
                  : singleCompensationWarningSignal(
                      comp,
                      smoothedMetrics[comp.name] ?? null,
                      smoothedMetrics[scorePrimaryName] ?? null,
                      warningRestOptions,
                    );
                warningSignals.set(comp.name, signal);
                warningDisplayMetrics[comp.name] = signal.value;
                // An arm side must not replace the trunk-lean or neck-tilt lean
                // direction set above (limbSideIsOverlayDirection).
                if (signal.side !== null && limbSideIsOverlayDirection(comp.name)) {
                  metricDirections[comp.name] = signal.side;
                }
              }
              // Display-only coaching checks (hipShiftWarning.ts,
              // elbowBendWarning.ts): warned and cued like a compensation, but
              // never scored or stored.
              for (const check of activeDefinition.coachingChecks ?? []) {
                if (check.name === "hipShift") {
                  if (activeDefinition.kind !== "dynamic") continue;
                  const result = updateHipShift(
                    hipShiftStatesRef.current.get(check.name) ?? newHipShiftState(),
                    {
                      geometry: hipShiftGeometry(landmarks),
                      lean: smoothedMetrics[activeDefinition.primaryMetric.name] ?? null,
                      nowMs: tNow,
                    },
                    {
                      ...check.check,
                      restBelow: activeDefinition.primaryMetric.thresholds.startThreshold,
                    },
                    cueTriggerLevel(check),
                  );
                  hipShiftStatesRef.current.set(check.name, result.state);
                  warningSignals.set(check.name, { name: check.name, value: result.value, side: null });
                  warningDisplayMetrics[check.name] = result.value;
                  continue;
                }
                // Each arm is judged from its own raise reading, with the
                // elbow angle the tuning trace stores (elbowFlexionDeg).
                const result = updateElbowBend(
                  elbowBendStatesRef.current.get(check.name) ?? newElbowBendState(),
                  {
                    left: {
                      primary: smoothedPrimaryLeft,
                      elbow: computeElbowFlexion(landmarks, raw.tiltReference, "left"),
                    },
                    right: {
                      primary: smoothedPrimaryRight,
                      elbow: computeElbowFlexion(landmarks, raw.tiltReference, "right"),
                    },
                    sides: prescribedOutcomeSides(prescriptionRef.current.prescribedSide),
                    nowMs: tNow,
                  },
                  {
                    ...check.check,
                    restBelow:
                      activeDefinition.kind === "dynamic"
                        ? activeDefinition.primaryMetric.thresholds.startThreshold
                        : 0,
                  },
                  cueTriggerLevel(check),
                );
                elbowBendStatesRef.current.set(check.name, result.state);
                warningSignals.set(check.name, { name: check.name, value: result.value, side: result.side });
                warningDisplayMetrics[check.name] = result.value;
                if (result.side !== null) metricDirections[check.name] = result.side;
              }
              compensationWarningSignalsRef.current = warningSignals;

              // Near-peak gate for `peakRelevant` compensation warnings
              // (elbowFlexion "Straighten arms" on ex_007/ex_008). Driven by
              // the per-side primary (raw.perSideMetrics) for per-limb
              // exercises, else the single smoothed primary value. When the
              // arms aren't near the top of the movement we suppress the
              // warning, because bent elbows are correct form there.
              const nearPeakNow = isNearPeak(
                activeDefinition,
                scoreIsPerLimb
                  ? {
                      left: smoothedPrimaryLeft,
                      right: smoothedPrimaryRight,
                    }
                  : raw.perSideMetrics,
                activeDefinition.kind === "dynamic"
                  ? smoothedMetrics[activeDefinition.primaryMetric.name] ?? null
                  : null,
              );

              const baselineReadyForExercise =
                baselinePhaseRef.current === "captured";

              // ── Rep counting ──────────────────────────────────────────
              // Feeds the appropriate counter(s) based on the exercise's
              // bilateralMode. Skipped for isometric exercises and for
              // exercises whose primary metric is still a stub (null).
              if (activeDefinition.kind === "dynamic") {
                const primaryName = activeDefinition.primaryMetric.name;

                if (
                  activeDefinition.bilateral &&
                  activeDefinition.bilateralMode === "per-limb"
                ) {
                  // Two counters, each fed its own per-side metric.
                  // raw.perSideMetrics is populated by computePoseMetricsForExercise
                  // for per-limb bilateral exercises. Each side gets its own
                  // OneEuroFilter so left-arm jitter doesn't bleed into the
                  // right-arm angle stream (or vice versa).
                  //
                  // This branch is NOT guarded by a single rawValue check because
                  // each side can independently be null (e.g., left elbow occluded
                  // while right elbow is visible). Each side handles its own null.
                  const perSide = raw.perSideMetrics;
                  if (perSide) {
                      const inputLeft = rawPrimaryLeft;
                      const inputRight = rawPrimaryRight;
                      const smoothedLeft = smoothedPrimaryLeft;
                      const smoothedRight = smoothedPrimaryRight;

                      // Rep counting is gated on the active session state and
                      // completed baseline capture. During calibration, metrics
                      // can still display, but counters do not see frames.
                      const sessionIsActive =
                        sessionStateRef.current === "active" &&
                        baselineReadyForExercise;

                      if (sessionIsActive && typeof inputLeft === "number") {
                        dynamicRepQualityBufferRef.current.add("left", {
                          tMs: tNow,
                          rawPrimary: inputLeft,
                          liveScore: leftFrameCompensationScore,
                          rawRuleScore: computeCompensationScore(
                            activeDefinition,
                            rawLeftCompensations,
                            inputLeft,
                          ),
                          rawCompensations: rawLeftCompensations,
                        });
                      }
                      if (sessionIsActive && typeof inputRight === "number") {
                        dynamicRepQualityBufferRef.current.add("right", {
                          tMs: tNow,
                          rawPrimary: inputRight,
                          liveScore: rightFrameCompensationScore,
                          rawRuleScore: computeCompensationScore(
                            activeDefinition,
                            rawRightCompensations,
                            inputRight,
                          ),
                          rawCompensations: rawRightCompensations,
                        });
                      }

                      if (
                        sessionIsActive &&
                        typeof smoothedLeft === "number" &&
                        leftRepCounterRef.current
                      ) {
                        const event = leftRepCounterRef.current.update(smoothedLeft, tNow);
                        if (event) {
                          repLogRef.current.left.push(event);
                          bufferRepEvent(event, "left");
                          const newReps = {
                            ...repCountsRef.current,
                            left: repCountsRef.current.left + 1,
                          };
                          repCountsRef.current = newReps;
                          setRepCounts(newReps);
                          checkAndHandleSetCompletion(tNow);
                          console.log(`[rep] ${activeDefinition.id} left`, event);
                        }
                      }
                      if (
                        sessionIsActive &&
                        typeof smoothedRight === "number" &&
                        rightRepCounterRef.current
                      ) {
                        const event = rightRepCounterRef.current.update(smoothedRight, tNow);
                        if (event) {
                          repLogRef.current.right.push(event);
                          bufferRepEvent(event, "right");
                          const newReps = {
                            ...repCountsRef.current,
                            right: repCountsRef.current.right + 1,
                          };
                          repCountsRef.current = newReps;
                          setRepCounts(newReps);
                          checkAndHandleSetCompletion(tNow);
                          console.log(`[rep] ${activeDefinition.id} right`, event);
                        }
                      }
                  }
                } else {
                  // Bidirectional-alternating or unilateral — single smoothed value.
                  const rawValue = smoothedMetrics[primaryName];
                  const rawMetricValue = metricInputs[primaryName];
                  const rawSignedDeg =
                    typeof rawMetricValue === "number" ? rawMetricValue : null;
                  const smoothedSignedDeg =
                    typeof rawValue === "number" ? rawValue : null;
                  const smoothedVelocityDegPerSec =
                    typeof smoothedMetricVelocities[primaryName] === "number"
                      ? smoothedMetricVelocities[primaryName]
                      : null;

                  // ── TEMPORARY ex_005 head-lean diagnostic (2026-05-26) ──
                  // Opt-in with `enableEx005Debug()` from the browser console.
                  // Logs structured copy-pasteable JSON lines INCLUDING null
                  // metric frames so off-frame ears are visible.
                  // Remove this block once ex_005 is tuned.
                  if (
                    activeDefinition.id === "ex_005" &&
                    tNow - lastEx005DebugMsRef.current > EX005_DEBUG_THROTTLE_MS
                  ) {
                    lastEx005DebugMsRef.current = tNow;
                    const before = bidirectionalRepCounterRef.current?.getDebugSnapshot(
                      tNow,
                      typeof rawValue === "number" ? rawValue : 0,
                    );
                    pushEx005DebugRecord({
                      kind: "frame",
                      tNow,
                      landmarks,
                      framingMode,
                      captureOk: true,
                      captureMessage: null,
                      rawSignedDeg,
                      smoothedSignedDeg,
                      perFrameCorrectedSignedDeg:
                        activeDefinition.id === "ex_005"
                          ? ex005PerFrameCorrectedSignedDeg
                          : null,
                      tiltReference: raw.tiltReference,
                      before: before ?? null,
                    });
                  }

                  if (typeof rawValue === "number") {
                    if (
                      activeDefinition.bilateral &&
                      activeDefinition.bilateralMode === "bidirectional-alternating"
                    ) {
                      // One wrapper around RepCounter: it feeds |value| to the
                      // state machine, tags the side from the sign at peak, and
                      // blocks immediate opposite-side return-stroke overshoot
                      // until the signed metric has settled near neutral.
                      const counter = bidirectionalRepCounterRef.current;
                      // Gate on active session state and completed baseline.
                      // The debug-ring-buffer below still records before/
                      // after snapshots so the neck-rep analysis tooling
                      // remains functional during idle/ended states, but
                      // the .update() call is suppressed.
                      const sessionIsActive =
                        sessionStateRef.current === "active" &&
                        baselineReadyForExercise;
                      if (
                        sessionIsActive &&
                        typeof rawMetricValue === "number"
                      ) {
                        dynamicRepQualityBufferRef.current.add("single", {
                          tMs: tNow,
                          // The bidirectional counter operates on magnitude and
                          // assigns anatomical side from the sign at peak.
                          rawPrimary: Math.abs(rawMetricValue),
                          liveScore: frameCompensationScore,
                          rawRuleScore: computeCompensationScore(
                            activeDefinition,
                            rawSingleCompensations,
                            rawMetricValue,
                          ),
                          rawCompensations: rawSingleCompensations,
                        });
                      }
                      if (counter) {
                        const before = counter.getDebugSnapshot(tNow, rawValue);
                        const rep = sessionIsActive
                          ? counter.update(
                              rawValue,
                              tNow,
                              smoothedVelocityDegPerSec ?? undefined,
                            )
                          : null;
                        if (rep) {
                          const { side, event } = rep;
                          repLogRef.current[side].push(event);
                          bufferRepEvent(event, side);
                          const newReps = {
                            ...repCountsRef.current,
                            [side]: repCountsRef.current[side] + 1,
                          };
                          repCountsRef.current = newReps;
                          setRepCounts(newReps);
                          checkAndHandleSetCompletion(tNow);

                          console.log(`[rep] ${activeDefinition.id} ${side}`, event);
                        }
                        const after = counter.getDebugSnapshot(tNow, rawValue);

                        if (activeDefinition.id === "ex_005" && rep) {
                          pushEx005DebugRecord({
                            kind: "rep",
                            tNow,
                            landmarks,
                            framingMode,
                            captureOk: true,
                            captureMessage: null,
                            rawSignedDeg,
                            smoothedSignedDeg,
                            perFrameCorrectedSignedDeg:
                              activeDefinition.id === "ex_005"
                                ? ex005PerFrameCorrectedSignedDeg
                                : null,
                            tiltReference: raw.tiltReference,
                            before,
                            after,
                            emitted: {
                              side: rep.side,
                              index: rep.event.index,
                              peakValue:
                                Math.round(rep.event.peakValue * 10) / 10,
                              classification: rep.event.classification,
                            },
                          });
                        }

                        if (activeDefinition.id === "ex_004") {
                          if (neckRepDebugStartMsRef.current === null) {
                            neckRepDebugStartMsRef.current = tNow;
                          }

                          const record: NeckRepDebugRecord = {
                            seq: ++neckRepDebugSeqRef.current,
                            tMs: Math.round(tNow),
                            elapsedMs: Math.round(
                              tNow - neckRepDebugStartMsRef.current,
                            ),
                            exerciseId: activeDefinition.id,
                            signedDeg: Math.round(rawValue * 10) / 10,
                            absDeg: Math.round(Math.abs(rawValue) * 10) / 10,
                            before,
                            after,
                            blockedBySettleGate:
                              before.awaitingRestSettle &&
                              after.awaitingRestSettle &&
                              rep === null,
                            gateReleasedThisFrame:
                              before.awaitingRestSettle &&
                              !after.awaitingRestSettle,
                            emitted: rep
                              ? {
                                  side: rep.side,
                                  index: rep.event.index,
                                  peakValue:
                                    Math.round(rep.event.peakValue * 10) / 10,
                                  classification: rep.event.classification,
                                  endTimeMs: Math.round(rep.event.endTimeMs),
                                }
                              : null,
                            counts: {
                              left: repLogRef.current.left.length,
                              right: repLogRef.current.right.length,
                            },
                          };

                          neckRepDebugRef.current.push(record);
                          if (
                            neckRepDebugRef.current.length >
                            MAX_NECK_REP_DEBUG_RECORDS
                          ) {
                            neckRepDebugRef.current.splice(
                              0,
                              neckRepDebugRef.current.length -
                                MAX_NECK_REP_DEBUG_RECORDS,
                            );
                          }
                          if (typeof window !== "undefined") {
                            window.__neckRepDebug = neckRepDebugRef.current;
                          }
                        }
                      }
                    } else {
                      // Unilateral. Gate on active session and completed baseline.
                      const counter = leftRepCounterRef.current;
                      if (
                        sessionStateRef.current === "active" &&
                        baselineReadyForExercise &&
                        typeof rawMetricValue === "number"
                      ) {
                        dynamicRepQualityBufferRef.current.add("single", {
                          tMs: tNow,
                          rawPrimary: rawMetricValue,
                          liveScore: frameCompensationScore,
                          rawRuleScore: computeCompensationScore(
                            activeDefinition,
                            rawSingleCompensations,
                            rawMetricValue,
                          ),
                          rawCompensations: rawSingleCompensations,
                        });
                      }
                      if (
                        counter &&
                        sessionStateRef.current === "active" &&
                        baselineReadyForExercise
                      ) {
                        const event = counter.update(rawValue, tNow);
                        if (event) {
                          repLogRef.current.left.push(event);
                          bufferRepEvent(event, "both");
                          const newReps = {
                            ...repCountsRef.current,
                            left: repCountsRef.current.left + 1,
                          };
                          repCountsRef.current = newReps;
                          setRepCounts(newReps);
                          checkAndHandleSetCompletion(tNow);
                          console.log(`[rep] ${activeDefinition.id}`, event);
                        }
                      }
                    }
                  }
                }
              } else if (activeDefinition.kind === "isometric") {
                // ── Isometric time-in-band accumulation ──────────────────
                // Two modes, dispatched on bilateralMode:
                //  - per-limb (ex_006 T-pose): a valid T-pose requires BOTH
                //    arms in the target band at the same time, so the paired
                //    hold accrues only on both-in-band frames.
                //  - side-split (ex_004 neck hold): ONE signed bidirectional
                //    signal (positive = patient's LEFT, the pinned sign
                //    convention); each side accrues its own hold time while
                //    the signed angle sits inside that side's band. At most
                //    one side can be in band per frame (the registry enforces
                //    center − tolerance > 0), so the sides never double-count.
                // Per-side in-band status is computed EVERY frame (even when
                // idle) so the panel can guide the patient into position;
                // accrual + completion only run while the session is active
                // and any required baseline capture has completed.
                // Uses RAW values, not smoothed — the ±tolerance band plus
                // the cumulative nature make per-frame jitter negligible.
                // The dt clock restarts (null anchor) whenever the session is
                // not active so a paused/idle gap is never credited; a single
                // frame is capped at MAX_ISO_TICK_MS to absorb brief flickers.
                const band = activeDefinition.isometric.targetBand;
                const lo = band.center - band.tolerance;
                const hi = band.center + band.tolerance;
                const sideSplit = isSideSplitIsometric(activeDefinition);
                let lInBand: boolean;
                let rInBand: boolean;
                // Per-side RAW angle streams for the hold-quality stats.
                let leftAngle: number | null;
                let rightAngle: number | null;
                if (sideSplit) {
                  const signedRaw = raw.metrics[activeDefinition.isometric.metric];
                  const signed = typeof signedRaw === "number" ? signedRaw : null;
                  lInBand = signed !== null && signed >= lo && signed <= hi;
                  rInBand = signed !== null && -signed >= lo && -signed <= hi;
                  // Each side's quality stream is the |signed angle| while the
                  // sign points at that side (left-tilt frames feed only the
                  // left stats); null otherwise so no sample accrues.
                  leftAngle = signed !== null && signed > 0 ? signed : null;
                  rightAngle = signed !== null && signed < 0 ? -signed : null;
                } else {
                  const inBand = (v: number | null) =>
                    typeof v === "number" && v >= lo && v <= hi;
                  const perSide = raw.perSideMetrics;
                  lInBand = !!perSide && inBand(perSide.left);
                  rInBand = !!perSide && inBand(perSide.right);
                  leftAngle = perSide?.left ?? null;
                  rightAngle = perSide?.right ?? null;
                }
                leftInBandRef.current = lInBand;
                rightInBandRef.current = rInBand;

                if (
                  sessionStateRef.current !== "active" ||
                  !baselineReadyForExercise
                ) {
                  lastIsometricTickMsRef.current = null;
                } else {
                  const last = lastIsometricTickMsRef.current;
                  const dt =
                    last === null ? 0 : Math.min(tNow - last, MAX_ISO_TICK_MS);
                  lastIsometricTickMsRef.current = tNow;
                  if (dt > 0) {
                    // ── Hold-quality accumulation (set-level, time-weighted) ──
                    const acc = holdQualityAccumRef.current;
                    if (acc.setStartMs === null) acc.setStartMs = tNow;
                    const t = tNow - acc.setStartMs; // ms since hold started
                    acc.sampleCount += 1;

                    // Per-side RAW-angle stats. For per-limb sets these are
                    // accumulated even when out of band so a sagging arm's
                    // angle/error is still captured; for side-split sets each
                    // side only samples while the sign points at it.
                    const accumSide = (
                      s: HoldSideAccum,
                      v: number | null,
                      isIn: boolean,
                    ) => {
                      if (typeof v === "number") {
                        s.w += dt;
                        s.wa += dt * v;
                        s.wa2 += dt * v * v;
                        s.wt += dt * t;
                        s.wt2 += dt * t * t;
                        s.wta += dt * t * v;
                      }
                      if (isIn) s.inBandMs += dt;
                    };
                    accumSide(acc.left, leftAngle, lInBand);
                    accumSide(acc.right, rightAngle, rInBand);

                    if (sideSplit) {
                      // Side-split hold accrual: each side's accumulator
                      // advances only while ITS band is occupied. Sides stay
                      // separate (never merged) — the asymmetry between them
                      // is the clinical signal. The "paired" bookkeeping
                      // fields read as "holding either side" here: streaks,
                      // drops, settle, and out-of-position time describe
                      // whether the patient was holding at all.
                      if (lInBand) leftHoldMsRef.current += dt;
                      if (rInBand) rightHoldMsRef.current += dt;
                      const anyIn = lInBand || rInBand;
                      if (anyIn) {
                        acc.curStreakMs += dt;
                        if (acc.curStreakMs > acc.longestStreakMs) {
                          acc.longestStreakMs = acc.curStreakMs;
                        }
                        if (acc.settleMs === null) acc.settleMs = t;
                      } else {
                        acc.outOfPositionMs += dt;
                        if (acc.prevPairedInBand) acc.dropCount += 1;
                        acc.curStreakMs = 0;
                      }
                      acc.prevPairedInBand = anyIn;
                    } else {
                      // Per-limb hold accrual stays independent. A bilateral
                      // prescription later gates on the slower side; a
                      // unilateral prescription gates only its selected side.
                      // The simultaneous accumulator remains a quality field,
                      // not the completion source.
                      if (lInBand) leftHoldMsRef.current += dt;
                      if (rInBand) rightHoldMsRef.current += dt;
                      const pairedIn = lInBand && rInBand;
                      if (pairedIn) {
                        pairedHoldMsRef.current += dt;
                        acc.curStreakMs += dt;
                        if (acc.curStreakMs > acc.longestStreakMs) {
                          acc.longestStreakMs = acc.curStreakMs;
                        }
                        if (acc.settleMs === null) acc.settleMs = t;
                      } else {
                        acc.outOfPositionMs += dt;
                        if (acc.prevPairedInBand) acc.dropCount += 1;
                        acc.curStreakMs = 0;
                      }
                      acc.prevPairedInBand = pairedIn;
                    }

                    // Compensation aggregate. Reuses the single per-frame
                    // score computed above (per-side worst for per-limb holds
                    // like ex_006, single-primary for side-split ex_004), so
                    // the hold-quality accumulator and the UI card never
                    // disagree.
                    const score = frameCompensationScore;
                    if (typeof score === "number") {
                      // Time-weighted (by dt), consistent with the per-arm
                      // angle stats — answers "what fraction of HOLD TIME was
                      // the patient compensating," not "mean over samples."
                      acc.scoreWSum += score * dt;
                      acc.scoreWeight += dt;
                      acc.scoreMin =
                        acc.scoreMin === null
                          ? score
                          : Math.min(acc.scoreMin, score);
                    }
                  }
                  checkAndHandleSetCompletion(tNow);
                }
              }

              if (tNow - lastMetricsUpdateRef.current > COACHING_TICK_MS) {
                lastMetricsUpdateRef.current = tNow;
                // Compensation metrics, then display-only coaching checks.
                const cueSpecs = coachingWarningSpecs(activeDefinition);
                const coachingWarningsEnabled =
                  sessionStateRef.current === "active" &&
                  lastCaptureOkRef.current &&
                  baselineReadyForExercise;
                const suppressedWarningNames = new Set(
                  cueSpecs
                    .filter(
                      (comp) =>
                        !coachingWarningsEnabled ||
                        (comp.peakRelevant === true && !nearPeakNow) ||
                        (prescriptionRef.current.prescribedSide !== "both" &&
                          comp.name === "shoulderSymmetry"),
                    )
                    .map((comp) => comp.name),
                );
                const activeWarningNames = updateCompensationWarningMap(
                  compensationWarningLatchesRef.current,
                  cueSpecs,
                  warningDisplayMetrics,
                  tNow,
                  suppressedWarningNames,
                );

                // Arbitrate the latched warnings down to the single cue the
                // patient is shown. This decides WHICH warning surfaces; it
                // does not decide whether one exists, and it owns no
                // thresholds. Runs on the metrics tick, not per frame, so the
                // per-cue timing is measured on one consistent clock.
                const cueDecision = selectCoachingCue(
                  coachingCueStateRef.current,
                  cueSpecs,
                  activeWarningNames,
                  warningDisplayMetrics,
                  tNow,
                );
                coachingCueStateRef.current = cueDecision.state;
                coachingDecisionRef.current = {
                  cueId: cueDecision.cueId, metric: cueDecision.metric,
                  declaredMessage: cueDecision.message, reason: cueDecision.reason,
                  decisionAtMs: tNow, selectedSinceMs: cueDecision.state.currentSinceMs,
                  side: cueDecision.metric ? warningSignals.get(cueDecision.metric)?.side ?? null : null,
                  warningValuesSmoothed: Object.fromEntries(cueSpecs.map(comp => [comp.name, warningDisplayMetrics[comp.name] ?? null])),
                  activeLatches: [...activeWarningNames],
                };
                if (selectedCoachingCueMetricRef.current !== cueDecision.metric) {
                  selectedCoachingCueMetricRef.current = cueDecision.metric;
                  setSelectedCoachingCueMetric(cueDecision.metric);
                }

                if (
                  coachingShadowEnabledRef.current &&
                  coachingShadowStaffAllowedRef.current
                ) {
                  const startedAt =
                    coachingShadowStartMsRef.current ??
                    (coachingShadowStartMsRef.current = tNow);
                  coachingShadowSeqRef.current += 1;
                  const records = coachingShadowRecordsRef.current;
                  records.push({
                    seq: coachingShadowSeqRef.current,
                    tMs: tNow,
                    tShadowMs: tNow - startedAt,
                    wallIso: new Date().toISOString(),
                    exerciseId: activeDefinition.id,
                    prescribedSide: prescriptionRef.current.prescribedSide,
                    sessionState: sessionStateRef.current,
                    captureOk: lastCaptureOkRef.current,
                    captureMessage: lastCaptureMsgRef.current,
                    baselinePhase: baselinePhaseRef.current,
                    frozenTiltDeg: frozenTiltDegRef.current,
                    tiltConfidence: raw.tiltReference.confidence,
                    nearPeak: nearPeakNow,
                    activeLatches: [...activeWarningNames],
                    suppressedMetrics: [...suppressedWarningNames],
                    segmentLabel: coachingShadowSegmentLabelRef.current,
                    segmentIntent: coachingShadowSegmentIntentRef.current,
                    selectedCueId: cueDecision.cueId,
                    selectedMetric: cueDecision.metric,
                    selectedMessage: cueDecision.message,
                    reason: cueDecision.reason,
                    displayedForMs: cueDecision.displayedForMs,
                    clearedCueId: cueDecision.clearedCueId,
                    candidates: cueDecision.candidates.map((candidate) => ({
                      ...candidate,
                      side:
                        compensationWarningSignalsRef.current.get(candidate.metric)
                          ?.side ?? null,
                    })),
                  });
                  // Bounded ring. Overflow is counted, never silently dropped —
                  // the export reports it.
                  while (records.length > COACHING_SHADOW_RING_LIMIT) {
                    records.shift();
                    coachingShadowDroppedRef.current += 1;
                  }
                  if (coachingShadowExportedRef.current) {
                    coachingShadowExportedRef.current = false;
                  }
                  if (tNow - coachingShadowLastUiUpdateMsRef.current > 500) {
                    coachingShadowLastUiUpdateMsRef.current = tNow;
                    setCoachingShadowCount(coachingShadowSeqRef.current);
                    setCoachingShadowExported(false);
                  }
                }

                setFrameMetrics({
                  tiltReference: raw.tiltReference,
                  metrics: warningDisplayMetrics,
                  // Single per-frame score computed above from the SAME
                  // smoothed values the metric cards render (with per-side
                  // primaries for per-limb exercises). raw.metrics is still
                  // available separately for the ML/log pipeline.
                  compensationScore: frameCompensationScore,
                });
                setDisplayPerSidePrimary(
                  scoreIsPerLimb
                    ? {
                        left: smoothedPrimaryLeft,
                        right: smoothedPrimaryRight,
                      }
                    : null,
                );
                setNearPeak(nearPeakNow);
                setActiveCompensationWarnings(activeWarningNames);
                if (activeDefinition.kind === "isometric") {
                  setHoldState({
                    pairedSec: pairedHoldMsRef.current / 1000,
                    leftSec: leftHoldMsRef.current / 1000,
                    rightSec: rightHoldMsRef.current / 1000,
                    leftInBand: leftInBandRef.current,
                    rightInBand: rightInBandRef.current,
                  });
                }
              }
              // Draw at most ONE cue. The selector already chose it on the
              // metrics tick; this per-frame path re-applies the same
              // suppression gates the latch layer uses, because `nearPeak` and
              // capture readiness move between ticks and a stale cue must not
              // survive them. `peakRelevant` warnings (elbowFlexion
              // "Straighten arms" on ex_007/ex_008) are the reason that matters
              // in practice.
              //
              // `drawCompensationOverlay` keeps its existing signature: it is
              // handed a one-entry spec list and a one-entry active-name set
              // rather than the whole compensation list, so nothing about how
              // it draws (or its tests) changes.
              const overlayWarningNames = new Set<MetricName>();
              const overlayComps = coachingWarningSpecs(activeDefinition).filter((comp) => {
                if (comp.name !== selectedCoachingCueMetricRef.current) return false;
                if (
                  sessionStateRef.current !== "active" ||
                  !lastCaptureOkRef.current ||
                  !baselineReadyForExercise
                ) {
                  return false;
                }
                if (comp.peakRelevant === true && !nearPeakNow) return false;
                if (
                  prescriptionRef.current.prescribedSide !== "both" &&
                  comp.name === "shoulderSymmetry"
                ) {
                  return false;
                }
                // A cue the selector keeps for its minimum visible time stays
                // drawn after its warning clears, so it can be read.
                const isActive =
                  compensationWarningLatchesRef.current.get(comp.name)?.active === true ||
                  coachingDecisionRef.current?.reason === "held-min-visible";
                if (isActive) overlayWarningNames.add(comp.name);
                return isActive;
              });
              // The LOWER arrow keeps the shoulder it first appeared on until
              // the cue leaves the slot, and moves only once the other shoulder
              // reads higher than the cue's switch-off level (lowerArrowShoulder).
              const lowerSpec = overlayComps.find((comp) => comp.name === "shoulderSymmetry");
              if (lowerSpec) {
                lockedShoulderIndexRef.current = lowerArrowShoulder(
                  lockedShoulderIndexRef.current,
                  landmarks,
                  computeShoulderSymmetry(landmarks, raw.tiltReference),
                  cueClearLevel(lowerSpec),
                );
              } else if (selectedCoachingCueMetricRef.current !== "shoulderSymmetry") {
                lockedShoulderIndexRef.current = null;
              }
              // A shown cue whose reading has gone (the per-repetition, hip and
              // coupled readings are absent at rest) is drawn with the reading
              // and direction it was last drawn with, so its minimum visible
              // time holds on screen. A shown cue with no direction this frame
              // (a trunk lean momentarily centred) keeps its last direction, so
              // its label does not switch while it is held. The gates above
              // still apply.
              const drawValues: Partial<Record<MetricName, number | null>> = { ...warningDisplayMetrics };
              const drawDirections: Partial<Record<MetricName, string>> = { ...metricDirections };
              const lastDrawn = lastDrawnCueRef.current;
              for (const comp of overlayComps) {
                if (!lastDrawn || lastDrawn.metric !== comp.name) continue;
                if (typeof drawValues[comp.name] !== "number") drawValues[comp.name] = lastDrawn.value;
                if (lastDrawn.direction !== null) drawDirections[comp.name] ??= lastDrawn.direction;
              }
              const renderedCues = drawCompensationOverlay(
                ctx,
                landmarks,
                canvas.width,
                canvas.height,
                overlayComps,
                drawValues,
                drawDirections,
                overlayWarningNames,
                { shoulderElevatedIndex: lockedShoulderIndexRef.current ?? undefined },
              );
              const drawnCue = renderedCues[0];
              if (drawnCue) {
                lastDrawnCueRef.current = {
                  metric: drawnCue.metric,
                  value: drawValues[drawnCue.metric] as number,
                  direction: drawDirections[drawnCue.metric] ?? null,
                };
              } else if (lastDrawnCueRef.current?.metric !== selectedCoachingCueMetricRef.current) {
                lastDrawnCueRef.current = null;
              }
              // The saved video's track records the cue as drawn, including the
              // shoulder the LOWER arrow is locked to, so playback matches.
              if (overlayFrame && drawnCue) {
                overlayFrame.cue = {
                  metric: drawnCue.metric,
                  direction: drawnCue.direction,
                  ...(drawnCue.metric === "shoulderSymmetry" && lockedShoulderIndexRef.current !== null
                    ? { shoulder: lockedShoulderIndexRef.current }
                    : {}),
                };
              }
              const suppressedMetrics = coachingWarningSpecs(activeDefinition).filter(comp =>
                sessionStateRef.current !== "active" || !lastCaptureOkRef.current || !baselineReadyForExercise ||
                comp.peakRelevant === true && !nearPeakNow ||
                prescriptionRef.current.prescribedSide !== "both" && comp.name === "shoulderSymmetry",
              ).map(comp => comp.name);
              const singleAvailable = typeof metricInputs[scorePrimaryName] === "number";
              coachingObservation = {
                capture: lastCaptureOkRef.current ? "available" : "unavailable",
                sessionState: sessionStateRef.current, baselineReady: baselineReadyForExercise,
                movement: observeMovement(activeDefinition, {
                  left: leftRepCounterRef.current, right: rightRepCounterRef.current,
                  bidirectional: bidirectionalRepCounterRef.current,
                }, { left: scoreIsPerLimb ? rawPrimaryLeft !== null : singleAvailable,
                  right: scoreIsPerLimb ? rawPrimaryRight !== null : singleAvailable },
                { left: leftInBandRef.current, right: rightInBandRef.current }),
                selected: coachingDecisionRef.current, rendered: renderedCues, renderEvidence: "canvas-frame", suppressedMetrics,
                absenceReason: renderedCues.length ? null : !lastCaptureOkRef.current ? "capture-unavailable" :
                  !baselineReadyForExercise ? "baseline-unavailable" : sessionStateRef.current !== "active" ? "session-inactive" :
                  selectedCoachingCueMetricRef.current && suppressedMetrics.includes(selectedCoachingCueMetricRef.current) ? "suppressed" :
                  selectedCoachingCueMetricRef.current ? "not-rendered" : "not-selected",
              };
              }
            }
          } else {
            // Pause isometric dt accumulation immediately on any unverified
            // capture gap. Keep accumulated hold time unless the gap becomes
            // sustained below.
            lastIsometricTickMsRef.current = null;

            const dropoutStartedAt = captureDropoutStartedAtRef.current ?? now;
            const dropoutElapsedMs = now - dropoutStartedAt;
            if (
              !captureDropoutResetDoneRef.current &&
              dropoutElapsedMs >= CAPTURE_READINESS_RESET_GRACE_MS
            ) {
              resetAfterSustainedCaptureDropout(activeDefinition);
            }

            setFrameMetrics({
              tiltReference: { cameraTiltDeg: 0, confidence: "insufficient", divergenceDeg: null },
              metrics: {},
              compensationScore: null,
            });
          }
        } else {
          // No tracked person means no verified in-band interval. Do not erase
          // accumulated hold time for a flicker; just restart the dt anchor.
          lastIsometricTickMsRef.current = null;
          const noPersonNow = performance.now();
          if (captureDropoutStartedAtRef.current === null) {
            captureDropoutStartedAtRef.current = noPersonNow;
          }
          neutralCalibrationClockRef.current = pauseNeutralCalibrationClock(
            neutralCalibrationClockRef.current,
          );
          updateNeutralCalibrationProgress(neutralCalibrationClockRef.current);
          commitCaptureState(false, "No person detected. Step into the frame.");
          if (
            !captureDropoutResetDoneRef.current &&
            noPersonNow - captureDropoutStartedAtRef.current >=
              CAPTURE_READINESS_RESET_GRACE_MS
          ) {
            resetAfterSustainedCaptureDropout(activeDefinition);
          }
          // Count as a not-OK frame so a patient who steps out of frame lowers
          // pctOk rather than being invisible to the capture-quality summary.
          if (sessionStateRef.current === "active") {
            captureFramesTotalRef.current += 1;
            const rejected = captureRejectedByStatusRef.current;
            rejected.NOT_VISIBLE = (rejected.NOT_VISIBLE ?? 0) + 1;
          }
          trackingMarksRef.current = addTrackingMark(trackingMarksRef.current, {
            t: performance.now(), captureOk: false, checked: [], unsteady: [],
          });
        }

        ctx.restore();
        if (sessionStateRef.current === "active") {
          coachingAuditRef.current.observe(performance.now(), coachingObservation);
        }

        // Blank the sync readout on any frame that produced no trace row, so a
        // reading on screen always belongs to the video frame showing it.
        // Leaving the last good value up instead is what would let someone
        // pause inside a gap and label an older row with a later posture.
        if (!traceSyncWroteThisFrameRef.current) {
          writeTraceSyncReadout(TRACE_SYNC_PAUSED);
        }

        // Tally this frame's timing for the rolling average (flushed when the
        // FPS window closes above).
        inferMsSumRef.current += inferMs;
        frameMsSumRef.current += performance.now() - frameStart;
        perfSampleCountRef.current += 1;
      }
    }

    requestRef.current = requestAnimationFrame(predictWebcam);
  };

  // ---------------------------------------------------------
  // Camera helpers
  // ---------------------------------------------------------
  const canUseMediaDevices =
    mounted && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const stopCamera = useCallback(async () => {
    cameraStartEpochRef.current++;
    cameraReadyRef.current = false;
    if (sessionStateRef.current === "active") coachingAuditRef.current.interrupt(performance.now(), sessionStateRef.current);
    try {
      if (videoRef.current) videoRef.current.srcObject = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraStreamActive(false);

      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }

      // Clear the sync readout here specifically because the frame loop is the
      // thing that normally repairs it, and the line above just cancelled it.
      // Without this a stopped camera keeps the last traced row on screen with
      // nothing left running to blank it. Called through the module helper
      // rather than the local wrapper so this callback needs no extra dep.
      applyTraceSyncReadout(traceSyncElRef.current, TRACE_SYNC_PLACEHOLDER);

      // Drop footer telemetry so a stopped/restarting camera doesn't show a
      // stale resolution or FPS.
      videoResolutionRef.current = null;
      setVideoResolution(null);
      fpsFrameCountRef.current = 0;
      fpsWindowStartMsRef.current = 0;
      setFps(null);
      inferMsSumRef.current = 0;
      frameMsSumRef.current = 0;
      perfSampleCountRef.current = 0;
      setPerfMs(null);
      if (
        activeDefinitionRef.current &&
        (sessionStateRef.current === "active" ||
          sessionStateRef.current === "countdown")
      ) {
        resetNeutralCalibration("capturing");
      }
    } catch {
      // ignore
    }
  }, [resetNeutralCalibration]);

  async function listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const cams = all.filter((d) => d.kind === "videoinput");
    setDevices(cams);
    if (!selectedDeviceId && cams[0]?.deviceId) setSelectedDeviceId(cams[0].deviceId);
  }

  async function startCamera(deviceId?: string): Promise<boolean> {
    if (!canUseMediaDevices) {
      setError("Camera API not available in this browser/environment.");
      return false;
    }

    setIsStarting(true);
    setError(null);
    await stopCamera();
    const epoch = cameraStartEpochRef.current;

    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: useFrontCameraHint ? "user" : "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (epoch !== cameraStartEpochRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return false;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Video element unavailable");
      video.srcObject = stream;
      let videoTimeout: ReturnType<typeof setTimeout> | undefined;
      await new Promise<void>((resolve, reject) => {
        let playing = false;
        videoTimeout = setTimeout(() => reject(new Error("Camera video timed out")), 10_000);
        const play = () => {
          if (playing) return;
          playing = true;
          void video.play().then(resolve, reject);
        };
        video.onloadeddata = play;
        video.onerror = () => reject(new Error("Camera video failed"));
        if (video.readyState >= 2) play();
        // Also clear callbacks after timeout/rejection, so a late frame cannot
        // start inference after this attempt has failed.
      }).finally(() => {
        clearTimeout(videoTimeout);
        video.onloadeddata = null;
        video.onerror = null;
      });
      if (epoch !== cameraStartEpochRef.current) return false;
      cameraReadyRef.current = true;
      setCameraStreamActive(true);
      predictWebcam();
      // Enumeration is optional UI metadata; camera capture already succeeded.
      await listCameras().catch(() => undefined);
      return true;
    } catch (e) {
      const name = getErrorName(e);
      if (name === "NotAllowedError") setError("Permission denied. Please allow camera access.");
      else if (name === "NotFoundError") setError("No camera found on this device.");
      else if (name === "NotReadableError") setError("Camera is already in use by another app.");
      else setError(`Failed to start camera: ${name}`);
      if (epoch === cameraStartEpochRef.current) await stopCamera();
      return false;
    } finally {
      setIsStarting(false);
    }
  }

  useEffect(() => {
    setMounted(true);
    return () => {
      void stopCamera();
    };
  }, [stopCamera]);

  // Leaving the page ends any session recording; the uploaded part is kept.
  useEffect(() => {
    const recorders = recorderRef;
    return () => { void recorders.current?.stop(); };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateViewportSize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    updateViewportSize();
    window.addEventListener("resize", updateViewportSize);
    return () => window.removeEventListener("resize", updateViewportSize);
  }, []);

  if (!mounted) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "oklch(0.985 0.003 90)", fontFamily: "var(--sans)" }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "oklch(0.45 0.01 240)", letterSpacing: ".1em" }}>Loading camera…</span>
      </div>
    );
  }

  const selectedExerciseObj = assignedExercises.find((e) => e.id === selectedExercise);
  const ex004FaceShadowStaffAllowed =
    user?.role === "admin" || user?.role === "therapist";
  const ex004FaceShadowCoverage =
    ex004FaceShadowLive.attemptedFrames > 0
      ? ex004FaceShadowLive.detectedFrames /
        ex004FaceShadowLive.attemptedFrames
      : null;
  // "Already completed" recap: the selected exercise finished in a prior visit.
  // Status stays "completed" across redos (a restart only moves pending →
  // in_progress server-side), so this keeps showing. Gated on idle so it never
  // overlays a live session, and on a dismiss flag so the patient can close it.
  const selectedRecap = sessionRecaps.get(selectedExercise) ?? null;
  const selectedExerciseCompleted = selectedExerciseObj?.status === "completed";
  const selectedExercisePainStopped =
    selectedExerciseObj?.status === "pain_stopped";
  const showCompletedRecap =
    sessionState === "idle" &&
    selectedExerciseCompleted &&
    !!selectedRecap &&
    !recapDismissed;
  // Resume prompt: a disrupted (not End-button) in-progress session. The
  // authoritative gate is an OPEN DB session whose id matches the local
  // snapshot — this excludes "Ended Early" (row closed + snapshot cleared) and
  // exercise-switch (row closed) even though both also read "in_progress".
  const openSession = openSessions.get(selectedExercise) ?? null;
  // Only read localStorage when idle — avoids parsing it on every frame of an
  // active session (the prompt/pill only matter at idle anyway).
  const resumeSnap =
    sessionState === "idle"
      ? readResumeSnapshot(selectedExerciseObj?.patientExerciseId)
      : null;
  const resumeEligible =
    selectedExerciseObj?.status === "in_progress" &&
    !!openSession &&
    !!resumeSnap &&
    resumeSnap.sessionId === openSession.sessionId &&
    resumeSnap.exerciseId === selectedExercise &&
    Date.now() - resumeSnap.updatedAtWallMs < RESUME_MAX_AGE_MS;
  const showResumePrompt =
    sessionState === "idle" && resumeEligible && !resumeDismissed;
  // Read only when idle or ended, like the resume snapshot above.
  const rememberedVideoChoice =
    user?.role === "patient" && (sessionState === "idle" || sessionState === "ended")
      ? readVideoChoice(user.id)
      : null;
  const selectedExerciseIndex = assignedExercises.findIndex((e) => e.id === selectedExercise);
  const hasPrevExercise = selectedExerciseIndex > 0;
  const hasNextExercise =
    selectedExerciseIndex !== -1 &&
    selectedExerciseIndex < assignedExercises.length - 1;
  // Strict schedule lock (patients): the selected exercise has nothing
  // actionable today (no due/make-up occurrence). Staff debug is never blocked.
  const blockedBySchedule =
    user?.role === "patient" &&
    !!selectedExercise &&
    !actionableOccurrenceIds.has(selectedExerciseObj?.occurrenceId ?? -1);
  // Stepper navigation locked while a session is in progress.
  const sessionBusy =
    preSessionSurvey !== null ||
    videoQuestion !== null ||
    sessionState === "active" ||
    sessionState === "resting" ||
    sessionState === "countdown" ||
    sessionState === "reporting";
  const baselineVisible = baselinePhase === "capturing";
  const baselineProgressPct = neutralCalibrationProgressPct({
    validElapsedMs: baselineProgress.validElapsedMs,
    sampleCount: baselineProgress.samples,
    lastValidAtMs: null,
  });
  const baselineRemainingSec = Math.max(
    0,
    Math.ceil(
      (NEUTRAL_CALIBRATION_DURATION_MS - baselineProgress.validElapsedMs) /
        1_000,
    ),
  );
  const baselineFinishingSamples =
    baselineRemainingSec === 0 &&
    baselineProgress.samples < NEUTRAL_CALIBRATION_MIN_SAMPLES;
  const score = frameMetrics.compensationScore;
  const tier = scoreTier(score);
  const cameraBg = "oklch(0.20 0.008 240)";
  const currentSetIdx = Math.min(completedSets + 1, prescription.sets);
  const showTiltBanner = captureOk && showTiltWarning;
  const compactLayout = viewportWidth < 1024;
  const tightLayout = viewportWidth < 720;
  const prescriptionTargetText =
    activeDefinition?.kind === "isometric"
      ? `${prescription.holdSeconds}s hold${
          prescription.prescribedSide === "both"
            ? "/side"
            : ` · ${prescription.prescribedSide}`
        }`
      : activeDefinition?.bilateral
        ? `${prescription.reps} reps${
            prescription.prescribedSide === "both"
              ? "/side"
              : ` · ${prescription.prescribedSide}`
          }`
        : `${prescription.reps} reps`;

  const cameraOn = cameraStreamActive;
  // The frame loop records a video size on its first frame; until then the
  // readiness state still describes the previous stream.
  const cameraFramesFlowing = cameraOn && videoResolution !== null;
  const trackingPaused = cameraFramesFlowing && !captureOk;
  const cameraStatus: CameraStatus =
    isStarting || (cameraOn && videoResolution === null)
      ? "starting"
      : cameraOn
        ? "on"
        : "off";
  // A tour step can hold the camera menu open so its tray can be pointed out.
  const cameraMenuShown =
    cameraMenuOpen || (showTutorial && TOUR_STEPS[tutorialStep]?.opensCameraMenu === true);
  const exerciseQueueLabel =
    selectedExerciseIndex >= 0
      ? `Exercise ${selectedExerciseIndex + 1} of ${assignedExercises.length} today`
      : `${assignedExercises.length} exercises today`;
  // The form-check card may only point at a highlight the overlay is actually
  // drawing, so it reads the same gates as the metric rows: the selector's one
  // promoted cue, latched, and not suppressed this tick.
  const formCheckWarning =
    cameraFramesFlowing &&
    metricCards.some(
      (card) =>
        card.kind === "compensation" &&
        card.warningActive === true &&
        !card.suppressWarning &&
        card.value !== null,
    );
  const formCheckState: FormCheckState = formCheckWarning
    ? "warning"
    : cameraFramesFlowing && captureOk && baselinePhase === "captured"
      ? "clear"
      : baselineVisible
        ? "setup"
        : "paused";
  const restElapsedPct =
    prescription.restSeconds > 0
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round((1 - restRemainingSec / prescription.restSeconds) * 100),
          ),
        )
      : 0;
  // As a rest period opens, the camera view keeps the finished set's count for
  // two seconds, then rolls it back to zero and moves the set number on. The
  // counters themselves reset in the same frame as a set's last rep, so the
  // final count would otherwise never be drawn. Display only: the values come
  // from the set record just logged, and Skip rest or the next set ends the hold.
  const REST_HOLD_SEC = 2;
  const finishedSet =
    sessionState === "resting" &&
    restRemainingSec > prescription.restSeconds - REST_HOLD_SEC
      ? completedSetsLogRef.current[completedSetsLogRef.current.length - 1]
      : undefined;
  const hudRepCounts = finishedSet
    ? { left: finishedSet.leftReps, right: finishedSet.rightReps }
    : repCounts;
  const hudHoldState =
    finishedSet && activeDefinition?.kind === "isometric"
      ? {
          pairedSec: (finishedSet.pairedHoldMs ?? 0) / 1000,
          leftSec: (finishedSet.leftHoldMs ?? 0) / 1000,
          rightSec: (finishedSet.rightHoldMs ?? 0) / 1000,
          leftInBand: false,
          rightInBand: false,
        }
      : holdState;
  const hudSetIdx = finishedSet ? finishedSet.setIndex : currentSetIdx;
  // A wider right column on tall screens, where the demonstration would otherwise
  // stay small; the camera view keeps at least 70% of the width.
  const asideWidth = compactLayout
    ? "100%"
    : Math.round(Math.min(480, viewportWidth * 0.3, Math.max(340, (viewportHeight - 420) * 0.62)));
  // A session started with no camera running would count nothing, so bring the
  // camera up first, as resuming already does. Never before the pose model is
  // ready: `predictWebcam` returns without scheduling another frame when the
  // first frame arrives before the model, and nothing restarts the loop when
  // the model finishes loading. The buttons that call this stay disabled too,
  // matching the Start camera buttons.
  const startSessionWithCamera = async (onConfirmed?: () => void) => {
    if (!modelLoaded || isStarting || sessionStartPendingRef.current) return;
    sessionStartPendingRef.current = true;
    try {
      if (!cameraReadyRef.current && !(await startCamera(selectedDeviceId || undefined))) return;
      await handleSessionStart(onConfirmed);
    } finally { sessionStartPendingRef.current = false; }
  };

  // Trace sync readout — the join key between a screen recording and the
  // exported trace. Gated on a patient with tracing switched on; the toggle
  // defaults OFF, so an ordinary session never shows it. The session card of
  // whichever state is showing renders it, with the label stacked above the
  // reading so the reading keeps its full width in a narrow column.
  // `bufferTuningRawFrame` writes the text directly to this node from the same
  // values it persists.
  const traceSyncReadout = user?.role === "patient" && tuningTraceEnabled && (
    <div style={{
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid oklch(0.92 0.003 240)",
      background: "oklch(0.97 0.004 240)",
    }}>
      <div style={{
        marginBottom: 3,
        fontFamily: "var(--mono)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: ".14em",
        textTransform: "uppercase",
        color: "oklch(0.45 0.01 240)",
      }}>
        Trace sync — frame / elapsed
      </div>
      <div
        ref={traceSyncElRef}
        aria-live="off"
        style={{
          // Read back off compressed video, where small monospace digits
          // smear; tabular figures keep the field from shifting as digits change.
          fontFamily: "var(--mono)",
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: ".02em",
          fontVariantNumeric: "tabular-nums",
          color: "oklch(0.20 0.01 240)",
        }}
      >
        {TRACE_SYNC_PLACEHOLDER}
      </div>
      {traceUploadLoss && (
                  <div
                    role="alert"
                    style={{
                      marginTop: 4,
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      fontWeight: 600,
                      lineHeight: 1.35,
                      color: "oklch(0.55 0.17 25)",
                    }}
                  >
                    {traceUploadLossLabel(traceUploadLoss)}
                  </div>
                )}
    </div>
  );

  return (
    <>
      {/* Wheel animation for the rolling set and rep counts */}
      <style>{ROLLING_NUMBER_CSS}</style>

      {/* Full page wrapper */}
      <div style={{
        fontFamily: "var(--sans)",
        color: "oklch(0.18 0.01 240)",
        background: "oklch(0.985 0.003 90)",
        height: compactLayout ? "auto" : "100vh",
        minHeight: "100vh",
        width: "100%",
        overflow: compactLayout ? "visible" : "hidden",
        display: "flex",
        flexDirection: "column",
      }}>
        {/* HEADER */}
        <header style={{
          minHeight: 68,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: compactLayout ? "wrap" : "nowrap",
          gap: 12,
          padding: compactLayout ? "10px 16px" : "0 28px",
          background: "white",
          borderBottom: "1px solid oklch(0.93 0.003 240)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: tightLayout ? 10 : 16, minWidth: 0 }}>
            <Link
              href={dashboardHref}
              aria-label="Back to Dashboard"
              title="Back to Dashboard"
              style={ICON_BUTTON_STYLE}
            >
              <CameraHomeIcon />
            </Link>
            <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>Postural</span>
            <span style={{ color: "oklch(0.80 0.01 240)" }}>/</span>
            <span style={{ fontSize: 15, color: "oklch(0.25 0.01 240)", whiteSpace: "nowrap" }}>Camera</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {/* The camera menu: the dot beside the camera icon shows whether the
                camera is on, and a click opens the device and display settings.
                Pose-model readiness has its own "AI" indicator on the camera view. */}
            <div id="cam-tour-camera" style={{ position: "relative" }}>
              <CameraStatusButton
                status={cameraStatus}
                open={cameraMenuShown}
                onToggle={() => setCameraMenuOpen((open) => !open)}
              />

              {cameraMenuShown && (
                <>
                  <div
                    aria-hidden="true"
                    onClick={() => setCameraMenuOpen(false)}
                    style={{ position: "fixed", inset: 0, zIndex: 49 }}
                  />
                  <div id="cam-tour-camera-menu" role="dialog" aria-label="Camera settings" style={{
                    position: "absolute",
                    top: "calc(100% + 10px)",
                    // Aligned to the button's right edge: the button sits near the right
                    // of the header, and a left-aligned tray ran past the window edge.
                    right: 0,
                    zIndex: 50,
                    width: 320,
                    maxWidth: "calc(100vw - 24px)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    padding: 16,
                    borderRadius: 12,
                    background: "white",
                    border: "1px solid oklch(0.90 0.004 240)",
                    boxShadow: "0 14px 40px oklch(0 0 0 / 0.18)",
                  }}>
                    <div style={STAFF_HEADING_STYLE}>Capture</div>
                    <div>
                      <label htmlFor="camera-device-select" style={{ display: "block", marginBottom: 4, fontSize: 11, color: "oklch(0.45 0.01 240)" }}>
                        Device
                      </label>
                      <select
                        id="camera-device-select"
                        value={selectedDeviceId}
                        onChange={(e) => setSelectedDeviceId(e.target.value)}
                        style={FIELD_STYLE}
                      >
                        {devices.length === 0 ? (
                          <option value="">(Allow camera access to list devices)</option>
                        ) : (
                          devices.map((d) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label || `Camera ${d.deviceId.slice(0, 6)}…`}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                    {cameraOn ? (
                      <button
                        type="button"
                        onClick={() => { void stopCamera(); setCameraMenuOpen(false); }}
                        style={{ ...SECONDARY_BUTTON_STYLE, width: "100%", padding: "11px 14px", fontSize: 15 }}
                      >
                        Stop
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { void startCamera(selectedDeviceId || undefined); setCameraMenuOpen(false); }}
                        disabled={isStarting || !modelLoaded}
                        style={{
                          ...PRIMARY_BUTTON_STYLE,
                          width: "100%",
                          padding: "11px 14px",
                          fontSize: 15,
                          opacity: isStarting || !modelLoaded ? 0.5 : 1,
                        }}
                      >
                        {isStarting ? "Starting…" : "Start camera"}
                      </button>
                    )}
                    <div style={{ paddingTop: 6, borderTop: "1px solid oklch(0.93 0.003 240)" }}>
                      <ClinicalSettingRow
                        label="Mirror"
                        sub="Front cam feel"
                        on={mirror}
                        onChange={setMirror}
                      />
                      <ClinicalSettingRow
                        label="Prefer front camera"
                        sub="When no device selected"
                        on={useFrontCameraHint}
                        onChange={setUseFrontCameraHint}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => { setCameraMenuOpen(false); setTutorialStep(0); setShowTutorial(true); }}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "9px 16px", borderRadius: 8,
                border: `1px solid ${ACCENT.hex}`, background: "white",
                fontFamily: "var(--sans)", fontSize: 14, fontWeight: 600,
                color: ACCENT.text, cursor: "pointer",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              How to Use
            </button>
          </div>
        </header>

        {/* Error bar */}
        {error && (
          <div role="alert" style={{
            padding: compactLayout ? "10px 16px" : "10px 28px",
            background: "oklch(0.96 0.04 25)",
            borderBottom: "1px solid oklch(0.88 0.06 25)",
            fontSize: 14,
            color: "oklch(0.40 0.12 25)",
          }}>
            {error}
          </div>
        )}

        {/* BODY: [staff panel] camera view | exercise and demonstration column */}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: compactLayout ? "column" : "row",
          minHeight: 0,
          padding: compactLayout ? 12 : 20,
          gap: compactLayout ? 12 : 16,
        }}>
          <main style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: compactLayout ? "column" : "row",
            gap: 14,
          }}>
            {/* STAFF DIAGNOSTICS. Opened from the (i) button on the camera view;
                it docks on the left and the camera view narrows beside it. */}
            {staffDrawerOpen && (
              <aside aria-label="Staff diagnostics" style={{
                width: compactLayout ? "100%" : 360,
                flexShrink: 0,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                overflowY: compactLayout ? "visible" : "auto",
                padding: 12,
                borderRadius: 12,
                background: "oklch(0.985 0.003 240)",
                border: "1px solid oklch(0.93 0.003 240)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ ...STAFF_HEADING_STYLE, fontSize: 11 }}>Staff diagnostics</span>
                  <button
                    type="button"
                    onClick={() => setStaffDrawerOpen(false)}
                    aria-label="Close staff diagnostics"
                    style={{ ...ICON_BUTTON_STYLE, width: 30, height: 30 }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>

                {/* Live Metrics */}
                <div style={{ ...CARD_STYLE, flexShrink: 0, overflow: "hidden" }}>
                  <div style={{ ...STAFF_HEADING_STYLE, padding: "12px 16px", borderBottom: "1px solid oklch(0.93 0.003 240)" }}>
                    Live Metrics · angles are camera estimates
                  </div>
                  <ClinicalScoreRow score={score} tier={tier} />
                  {metricCards.map((card) => (
                    <ClinicalMetricRow key={card.id} card={card} />
                  ))}
                </div>

                {/* Capture telemetry */}
                <div style={{ ...CARD_STYLE, flexShrink: 0, padding: "12px 16px" }}>
                  <div style={{ ...STAFF_HEADING_STYLE, marginBottom: 10 }}>Capture</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <StaffStat label="Pose model" value={modelLoaded ? "AI ready" : "Loading model"} />
                    <StaffStat label="Capture" value={!cameraFramesFlowing ? "—" : captureOk ? "Capture OK" : captureMessage} />
                    <StaffStat label="Resolution" value={videoResolution ? `${videoResolution.width} × ${videoResolution.height}` : "—"} />
                    <StaffStat label="Frame rate" value={fps !== null ? `${fps} fps` : "—"} />
                    <StaffStat label="Pose infer" value={perfMs ? `${perfMs.infer.toFixed(1)} ms` : "—"} />
                    <StaffStat label="Frame total" value={perfMs ? `${perfMs.frame.toFixed(1)} ms` : "—"} />
                    <StaffStat label="Session progress" value={`${progressPct}%`} />
                  </div>
                </div>

                {/* Opt-in tuning-trace recording (patient sessions only persist) */}
                {user?.role === "patient" && (
                  <div style={{ ...CARD_STYLE, flexShrink: 0, display: "flex", alignItems: "flex-start", gap: 8, padding: "12px 16px" }}>
                    <input
                      type="checkbox"
                      id="tuning-trace-toggle"
                      checked={tuningTraceEnabled}
                      onChange={(e) => setTuningTraceEnabled(e.target.checked)}
                      style={{ marginTop: 2, accentColor: ACCENT.hex }}
                    />
                    <label htmlFor="tuning-trace-toggle" style={{ cursor: "pointer" }}>
                      <div style={STAFF_HEADING_STYLE}>Record tuning trace</div>
                      <div style={{ marginTop: 2, fontSize: 11, color: "oklch(0.50 0.01 240)" }}>
                        Saves raw movement metrics (no video) for threshold tuning.
                      </div>
                    </label>
                  </div>
                )}

                {ex004FaceShadowStaffAllowed && activeDefinition?.id === "ex_004" && (
                  <div
                    data-testid="ex004-face-shadow"
                    style={{
                      margin: 0,
                      padding: 10,
                      border: "1px solid oklch(0.88 0.02 250)",
                      borderRadius: 6,
                      background: "oklch(0.975 0.01 250)",
                    }}
                  >
                    <label
                      htmlFor="ex004-face-shadow-toggle"
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 7,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        id="ex004-face-shadow-toggle"
                        type="checkbox"
                        checked={ex004FaceShadowEnabled}
                        onChange={(event) => {
                          if (event.target.checked) clearEx004FaceShadow();
                          setEx004FaceShadowEnabled(event.target.checked);
                        }}
                        style={{ marginTop: 2, accentColor: ACCENT.hex }}
                      />
                      <span>
                        <span
                          style={{
                            display: "block",
                            fontFamily: "var(--mono)",
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: ".12em",
                            textTransform: "uppercase",
                            color: "oklch(0.30 0.05 250)",
                          }}
                        >
                          Face shadow comparison
                        </span>
                        <span
                          style={{
                            display: "block",
                            marginTop: 2,
                            fontSize: 10,
                            lineHeight: 1.35,
                            color: "oklch(0.48 0.02 250)",
                          }}
                        >
                          Diagnostic only. Pose remains authoritative.
                        </span>
                      </span>
                    </label>

                    {ex004FaceShadowEnabled && (
                      <div
                        style={{
                          marginTop: 9,
                          paddingTop: 8,
                          borderTop: "1px solid oklch(0.90 0.01 250)",
                          fontFamily: "var(--mono)",
                          fontSize: 10,
                          lineHeight: 1.55,
                          color: "oklch(0.32 0.02 250)",
                        }}
                      >
                        <div>
                          Status: {ex004FaceShadowModelState}
                          {ex004FaceShadowLive.status
                            ? ` / ${ex004FaceShadowLive.status}`
                            : ""}
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(0, 1fr) auto",
                            gap: 6,
                            alignItems: "end",
                            margin: "6px 0",
                          }}
                        >
                          <label style={{ display: "grid", gap: 3 }}>
                            <span>Trial phase</span>
                            <select
                              aria-label="Face shadow trial phase"
                              value={ex004FaceShadowPhase}
                              onChange={(event) => {
                                if (isEx004FaceShadowPhase(event.target.value)) {
                                  setEx004FaceShadowPhase(event.target.value);
                                }
                              }}
                              style={{
                                minWidth: 0,
                                padding: "4px 5px",
                                border: "1px solid oklch(0.82 0.03 250)",
                                borderRadius: 4,
                                background: "white",
                                color: "inherit",
                                font: "inherit",
                              }}
                            >
                              {EX004_FACE_SHADOW_PHASE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              appendEx004FaceShadowMark(
                                "phase",
                                ex004FaceShadowPhaseRef.current,
                              );
                              showToast({
                                variant: "success",
                                message: "Face trial phase marked.",
                              });
                            }}
                            style={{
                              padding: "5px 7px",
                              border: "1px solid oklch(0.82 0.03 250)",
                              borderRadius: 4,
                              background: "white",
                              color: "inherit",
                              font: "inherit",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Mark phase
                          </button>
                        </div>
                        <div>
                          Face baseline: {baselinePhase === "capturing"
                            ? "calibrating"
                            : baselinePhase === "captured"
                              ? ex004FaceShadowBaselineRollRef.current !== null
                                ? "ready"
                                : "unavailable — restart after Face is ready"
                              : "not started"}
                        </div>
                        <div>
                          Pose / Face roll: {ex004FaceShadowLive.poseSignedDeg?.toFixed(1) ?? "—"}
                          {"° / "}
                          {ex004FaceShadowLive.faceSignedDeg?.toFixed(1) ?? "—"}°
                        </div>
                        <div>
                          Face yaw / pitch: {ex004FaceShadowLive.faceYawDeltaDeg?.toFixed(1) ?? "—"}
                          {"° / "}
                          {ex004FaceShadowLive.facePitchDeltaDeg?.toFixed(1) ?? "—"}°
                        </div>
                        <div>
                          Face − Pose: {ex004FaceShadowLive.faceMinusPoseDeg?.toFixed(1) ?? "—"}°
                        </div>
                        <div>
                          Coverage: {ex004FaceShadowCoverage !== null
                            ? `${(ex004FaceShadowCoverage * 100).toFixed(1)}%`
                            : "—"}
                        </div>
                        <div>
                          Face inference: {ex004FaceShadowLive.inferenceMs?.toFixed(1) ?? "—"} ms
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(0, 1fr) auto",
                            gap: 6,
                            alignItems: "end",
                            marginTop: 7,
                          }}
                        >
                          <label style={{ display: "grid", gap: 3 }}>
                            <span>Reference angle (optional)</span>
                            <input
                              aria-label="Independent reference angle in degrees"
                              type="number"
                              step="0.1"
                              inputMode="decimal"
                              value={ex004FaceShadowReferenceInput}
                              onChange={(event) =>
                                setEx004FaceShadowReferenceInput(event.target.value)
                              }
                              placeholder="degrees"
                              style={{
                                minWidth: 0,
                                padding: "4px 5px",
                                border: "1px solid oklch(0.82 0.03 250)",
                                borderRadius: 4,
                                background: "white",
                                color: "inherit",
                                font: "inherit",
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            disabled={
                              ex004FaceShadowReferenceInput.trim() === "" ||
                              !Number.isFinite(Number(ex004FaceShadowReferenceInput))
                            }
                            onClick={() => {
                              const angle = Number(ex004FaceShadowReferenceInput);
                              if (!markEx004FaceShadowReference(angle)) return;
                              setEx004FaceShadowReferenceInput("");
                              showToast({
                                variant: "success",
                                message: "Reference angle marked.",
                              });
                            }}
                            style={{
                              padding: "5px 7px",
                              border: "1px solid oklch(0.82 0.03 250)",
                              borderRadius: 4,
                              background: "white",
                              color: "inherit",
                              font: "inherit",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Mark reference
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const dump = window.dumpEx004FaceShadow?.();
                            if (!dump) return;
                            void navigator.clipboard.writeText(dump)
                              .then(() => {
                                showToast({
                                  variant: "success",
                                  message: "Face shadow diagnostics copied.",
                                });
                              })
                              .catch((reason: unknown) => {
                                console.error(
                                  "[ex004-face-shadow] clipboard copy failed",
                                  reason,
                                );
                                showToast({
                                  variant: "error",
                                  message: "Could not copy Face diagnostics.",
                                });
                              });
                          }}
                          style={{
                            marginTop: 7,
                            padding: "5px 8px",
                            border: "1px solid oklch(0.82 0.03 250)",
                            borderRadius: 4,
                            background: "white",
                            color: "oklch(0.30 0.05 250)",
                            fontFamily: "var(--mono)",
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: ".08em",
                            textTransform: "uppercase",
                            cursor: "pointer",
                          }}
                        >
                          Copy diagnostics
                        </button>
                        {ex004FaceShadowModelError && (
                          <div style={{ color: "oklch(0.45 0.14 25)" }}>
                            {ex004FaceShadowModelError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Staff-only coaching shadow log. Records what the single-cue
                    selector decided and why; it does not change the cue itself, so
                    turning it on is invisible to the patient. */}
                {coachingShadowStaffAllowed && !!activeDefinition && (
                  <div
                    data-testid="coaching-shadow"
                    style={{
                      margin: 0,
                      padding: 10,
                      border: "1px solid oklch(0.88 0.02 250)",
                      borderRadius: 6,
                      background: "oklch(0.975 0.01 250)",
                    }}
                  >
                    <label
                      htmlFor="coaching-shadow-toggle"
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 7,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        id="coaching-shadow-toggle"
                        type="checkbox"
                        checked={coachingShadowEnabled}
                        onChange={(event) => {
                          if (event.target.checked) clearCoachingShadow();
                          setCoachingShadowEnabled(event.target.checked);
                        }}
                        style={{ marginTop: 2, accentColor: ACCENT.hex }}
                      />
                      <span>
                        <span
                          style={{
                            display: "block",
                            fontFamily: "var(--mono)",
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: ".12em",
                            textTransform: "uppercase",
                            color: "oklch(0.30 0.05 250)",
                          }}
                        >
                          Coaching shadow log
                        </span>
                        <span
                          style={{
                            display: "block",
                            marginTop: 2,
                            fontSize: 10,
                            lineHeight: 1.35,
                            color: "oklch(0.48 0.02 250)",
                          }}
                        >
                          Records cue decisions. Does not change what the patient sees.
                        </span>
                      </span>
                    </label>

                    {coachingShadowEnabled && (
                      <div
                        style={{
                          marginTop: 9,
                          paddingTop: 8,
                          borderTop: "1px solid oklch(0.90 0.01 250)",
                          fontFamily: "var(--mono)",
                          fontSize: 10,
                          lineHeight: 1.55,
                          color: "oklch(0.32 0.02 250)",
                        }}
                      >
                        <div>Schema: {COACHING_SHADOW_SCHEMA}</div>
                        <div style={{ color: "oklch(0.45 0.02 250)" }}>
                          Remote: <strong>F8</strong> starts the step · <strong>F9</strong> ends it ·
                          or park the cursor on the big control and left-click
                        </div>
                        <div>
                          Recording as: {coachingShadowActiveSegment
                            ? `${coachingShadowActiveSegment.label} · ${coachingShadowActiveSegment.intent}`
                            : "— not declared"}
                        </div>
                        {(() => {
                          const step = COACHING_SESSION_PLAN[coachingPlanIndex];
                          if (!step) {
                            return (
                              <div
                                style={{
                                  marginTop: 7,
                                  padding: "7px 8px",
                                  border: "1px solid oklch(0.82 0.03 250)",
                                  borderRadius: 4,
                                  background: "white",
                                }}
                              >
                                <div style={{ fontWeight: 700 }}>Plan complete</div>
                                <div style={{ marginTop: 2 }}>
                                  Export this capture, then run E3 (patient login) unrecorded.
                                </div>
                                <button
                                  type="button"
                                  onClick={restartCoachingShadowPlan}
                                  style={{
                                    marginTop: 6,
                                    padding: "4px 7px",
                                    border: "1px solid oklch(0.82 0.03 250)",
                                    borderRadius: 4,
                                    background: "white",
                                    color: "inherit",
                                    font: "inherit",
                                    cursor: "pointer",
                                  }}
                                >
                                  Restart plan
                                </button>
                              </div>
                            );
                          }
                          const wrongExercise = activeDefinition?.id !== step.exerciseId;
                          return (
                            <div
                              style={{
                                marginTop: 7,
                                padding: "7px 8px",
                                border: "1px solid oklch(0.82 0.03 250)",
                                borderLeft: step.startsCapture
                                  ? "3px solid oklch(0.65 0.16 60)"
                                  : "3px solid oklch(0.82 0.03 250)",
                                borderRadius: 4,
                                background: "white",
                              }}
                            >
                              <div style={{ fontWeight: 700 }}>
                                Step {coachingPlanIndex + 1}/{COACHING_SESSION_PLAN.length}
                                {" · "}{step.captureId}{" · "}{step.exerciseId}
                              </div>
                              <div style={{ marginTop: 2 }}>
                                {step.label}{" · "}{step.intent}
                              </div>
                              <div style={{ marginTop: 3, color: "oklch(0.45 0.02 250)" }}>
                                {step.hint}
                              </div>
                              {step.startsCapture && (
                                <div style={{ marginTop: 3, fontWeight: 700, color: "oklch(0.50 0.14 45)" }}>
                                  Stop/Start first, confirm set 1 · 0 reps · baseline captured, then Clear.
                                </div>
                              )}
                              {wrongExercise && (
                                <div style={{ marginTop: 3, fontWeight: 700, color: "oklch(0.45 0.14 25)" }}>
                                  Selected exercise is {activeDefinition?.id ?? "none"} — this step needs {step.exerciseId}.
                                </div>
                              )}
                              {(() => {
                                const recordingThis =
                                  coachingShadowActiveSegment?.label === step.label;
                                const blockAdvance = coachingShadowAdvanceBlocked;
                                return (
                                  <>
                                    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                                      <button
                                        type="button"
                                        disabled={coachingPlanIndex === 0}
                                        onClick={stepBackCoachingShadowPlan}
                                        style={{
                                          padding: "4px 7px",
                                          border: "1px solid oklch(0.82 0.03 250)",
                                          borderRadius: 4,
                                          background: "white",
                                          color: "inherit",
                                          font: "inherit",
                                          cursor: coachingPlanIndex === 0 ? "default" : "pointer",
                                        }}
                                      >
                                        Back
                                      </button>
                                      <button
                                        type="button"
                                        disabled={recordingThis}
                                        onClick={() => {
                                          if (!markCoachingShadowSegment(step.label, step.intent)) return;
                                          setCoachingShadowSegmentLabel(step.label);
                                          setCoachingShadowSegmentIntent(step.intent);
                                          showToast({
                                            variant: "success",
                                            message: `Recording ${step.label} (${step.intent}).`,
                                          });
                                        }}
                                        style={{
                                          padding: "4px 8px",
                                          border: "1px solid oklch(0.82 0.03 250)",
                                          borderRadius: 4,
                                          background: recordingThis ? "white" : ACCENT.hex,
                                          color: recordingThis ? "oklch(0.55 0.02 250)" : "white",
                                          font: "inherit",
                                          fontWeight: 700,
                                          cursor: recordingThis ? "default" : "pointer",
                                        }}
                                      >
                                        {recordingThis ? "Recording…" : "Start this step"}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={!recordingThis}
                                        onClick={() => {
                                          endCoachingShadowSegment();
                                          showToast({
                                            variant: "success",
                                            message: `Ended ${step.label}.`,
                                          });
                                        }}
                                        style={{
                                          padding: "4px 7px",
                                          border: "1px solid oklch(0.82 0.03 250)",
                                          borderRadius: 4,
                                          background: "white",
                                          color: "inherit",
                                          font: "inherit",
                                          fontWeight: 700,
                                          cursor: recordingThis ? "pointer" : "default",
                                        }}
                                      >
                                        End step
                                      </button>
                                      <button
                                        type="button"
                                        disabled={blockAdvance}
                                        onClick={advanceCoachingShadowPlan}
                                        style={{
                                          padding: "4px 7px",
                                          border: "1px solid oklch(0.82 0.03 250)",
                                          borderRadius: 4,
                                          background: "white",
                                          color: blockAdvance ? "oklch(0.60 0.02 250)" : "inherit",
                                          font: "inherit",
                                          cursor: blockAdvance ? "default" : "pointer",
                                        }}
                                      >
                                        Next →
                                      </button>
                                    </div>
                                    {blockAdvance && (
                                      <div style={{ marginTop: 4, fontWeight: 700, color: "oklch(0.45 0.14 25)" }}>
                                        This capture has {coachingShadowCount} unexported decisions. Download the log before moving on.
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          );
                        })()}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(0, 1fr) auto auto",
                            gap: 6,
                            alignItems: "end",
                            margin: "6px 0",
                          }}
                        >
                          <label style={{ display: "grid", gap: 3 }}>
                            <span>Capture / segment</span>
                            <input
                              aria-label="Capture or segment label"
                              type="text"
                              value={coachingShadowSegmentLabel}
                              onChange={(event) =>
                                setCoachingShadowSegmentLabel(event.target.value)
                              }
                              placeholder="A2-trunk"
                              style={{
                                minWidth: 0,
                                padding: "4px 5px",
                                border: "1px solid oklch(0.82 0.03 250)",
                                borderRadius: 4,
                                background: "white",
                                color: "inherit",
                                font: "inherit",
                              }}
                            />
                          </label>
                          <label style={{ display: "grid", gap: 3 }}>
                            <span>Intent</span>
                            <select
                              aria-label="Declared movement intent for this segment"
                              value={coachingShadowSegmentIntent}
                              onChange={(event) =>
                                setCoachingShadowSegmentIntent(
                                  event.target.value as CoachingShadowIntent,
                                )
                              }
                              style={{
                                padding: "4px 5px",
                                border: "1px solid oklch(0.82 0.03 250)",
                                borderRadius: 4,
                                background: "white",
                                color: "inherit",
                                font: "inherit",
                              }}
                            >
                              <option value="clean">clean</option>
                              <option value="faulty">faulty</option>
                              <option value="transition">transition</option>
                            </select>
                          </label>
                          <button
                            type="button"
                            disabled={coachingShadowSegmentLabel.trim() === ""}
                            onClick={() => {
                              if (
                                !markCoachingShadowSegment(
                                  coachingShadowSegmentLabel,
                                  coachingShadowSegmentIntent,
                                )
                              ) {
                                return;
                              }
                              showToast({
                                variant: "success",
                                message: `Segment ${coachingShadowSegmentLabel.trim()} started.`,
                              });
                            }}
                            style={{
                              padding: "5px 7px",
                              border: "1px solid oklch(0.82 0.03 250)",
                              borderRadius: 4,
                              background: "white",
                              color: "inherit",
                              font: "inherit",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Mark
                          </button>
                        </div>
                        <div>
                          Selected cue: {selectedCoachingCueMetric ?? "—"}
                        </div>
                        <div>
                          Active latches: {activeCompensationWarnings.size > 0
                            ? [...activeCompensationWarnings].join(", ")
                            : "—"}
                        </div>
                        <div>
                          Decisions: {coachingShadowCount} recorded
                          {coachingShadowDroppedRef.current > 0
                            ? ` · ${coachingShadowDroppedRef.current} dropped from the ring`
                            : ""}
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
                          <button
                            type="button"
                            onClick={() => {
                              const result = downloadCoachingShadow();
                              if (!result) {
                                showToast({
                                  variant: "error",
                                  message: "No coaching decisions recorded yet.",
                                });
                                return;
                              }
                              coachingShadowExportedRef.current = true;
                              setCoachingShadowExported(true);
                              if (result.warnings.length > 0) {
                                for (const warning of result.warnings) {
                                  console.warn("[coaching-shadow] " + warning);
                                }
                                showToast({
                                  variant: "error",
                                  message: `Downloaded with ${result.warnings.length} issue(s): ${result.warnings[0]}`,
                                });
                                return;
                              }
                              showToast({
                                variant: "success",
                                message: `Downloaded. ${result.checksRun} automated checks passed — still open the file.`,
                              });
                            }}
                            style={{
                              padding: "5px 8px",
                              border: "1px solid oklch(0.82 0.03 250)",
                              borderRadius: 4,
                              background: "white",
                              color: "oklch(0.30 0.05 250)",
                              fontFamily: "var(--mono)",
                              fontSize: 9,
                              fontWeight: 700,
                              letterSpacing: ".08em",
                              textTransform: "uppercase",
                              cursor: "pointer",
                            }}
                          >
                            Download log
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (coachingShadowCount > 0 && !coachingShadowExported) {
                                showToast({
                                  variant: "error",
                                  message: `${coachingShadowCount} decisions have not been exported. Download first, or press Clear again to discard.`,
                                });
                                setCoachingShadowExported(true);
                                return;
                              }
                              clearCoachingShadow();
                            }}
                            style={{
                              padding: "5px 8px",
                              border: "1px solid oklch(0.82 0.03 250)",
                              borderRadius: 4,
                              background: "white",
                              color: "oklch(0.30 0.05 250)",
                              fontFamily: "var(--mono)",
                              fontSize: 9,
                              fontWeight: 700,
                              letterSpacing: ".08em",
                              textTransform: "uppercase",
                              cursor: "pointer",
                            }}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </aside>
            )}

            {/* CAMERA VIEW */}
            <div id="cam-tour-feed" style={{
              flex: 1,
              position: "relative",
              minWidth: 0,
              minHeight: compactLayout ? (tightLayout ? 380 : 500) : 0,
              borderRadius: 12,
              overflow: "hidden",
              background: cameraBg,
              border: "1px solid oklch(0.90 0.004 240)",
            }}>
              {/* Mirrored video + canvas layer. Letterboxed, never cropped, so the
                  whole frame stays visible whatever width the view is given. */}
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                transform: mirror ? "scaleX(-1)" : "none",
              }}>
                <video ref={videoRef} playsInline muted style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "contain" }} />
                <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "contain" }} />
              </div>

              {/* Diagnostics corner: the staff (i) button and the processing
                  rate. Above the camera-off cover and the countdown, so the rate
                  is always on screen. The trace sync readout lives in the session
                  card, where a narrow camera view cannot clip it. */}
              <div style={{
                position: "absolute",
                top: tightLayout ? 10 : 14,
                left: tightLayout ? 10 : 14,
                zIndex: 36,
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
                maxWidth: "calc(100% - 28px)",
              }}>
                <button
                  type="button"
                  id="cam-tour-metrics"
                  onClick={() => setStaffDrawerOpen((open) => !open)}
                  aria-label={staffDrawerOpen ? "Close staff diagnostics" : "Open staff diagnostics"}
                  aria-pressed={staffDrawerOpen}
                  title="Staff diagnostics"
                  style={{
                    width: 36,
                    height: 36,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 999,
                    border: "1px solid oklch(1 0 0 / 0.25)",
                    background: staffDrawerOpen ? "white" : "oklch(0.16 0.01 240 / 0.72)",
                    color: staffDrawerOpen ? "oklch(0.25 0.01 240)" : "white",
                    cursor: "pointer",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="11" x2="12" y2="17"/>
                    <line x1="12" y1="7" x2="12.01" y2="7"/>
                  </svg>
                </button>
                <div title="Frame rate" style={FEED_CHIP_STYLE}>
                  {fps !== null ? `${fps} fps` : "—"}
                </div>

              </div>

              {/* AI indicator, top right: whether the pose model has loaded.
                  Above the camera-off cover and the countdown, like the
                  diagnostics corner opposite. */}
              <div
                id="cam-tour-ai"
                role="img"
                aria-label={modelLoaded ? "AI ready" : "AI loading"}
                title={modelLoaded ? "AI ready" : "AI loading"}
                style={{
                  ...FEED_CHIP_STYLE,
                  position: "absolute",
                  top: tightLayout ? 10 : 14,
                  right: tightLayout ? 10 : 14,
                  zIndex: 36,
                  gap: 8,
                  fontFamily: "var(--sans)",
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: ".04em",
                }}
              >
                AI
                <span aria-hidden="true" style={{
                  width: 10,
                  height: 10,
                  flexShrink: 0,
                  borderRadius: 999,
                  background: modelLoaded ? "oklch(0.72 0.17 145)" : "oklch(0.78 0.15 75)",
                  boxShadow: modelLoaded
                    ? "0 0 0 3px oklch(0.72 0.17 145 / 0.28)"
                    : "0 0 0 3px oklch(0.78 0.15 75 / 0.30)",
                }} />
              </div>

              {/* Status, positioning hint and set numbers share one column at
                  the bottom of the view. The top stays clear: that is where the
                  capture check draws its head-zone target when framing fails. */}
              <div style={{
                position: "absolute",
                left: tightLayout ? 10 : 16,
                right: tightLayout ? 10 : 16,
                bottom: tightLayout ? 10 : 16,
                zIndex: 22,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                pointerEvents: "none",
              }}>
                {trackingPaused && (sessionState === "idle" || sessionState === "active") && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: tightLayout ? 12 : 16,
                    maxWidth: 760,
                    padding: tightLayout ? "12px 16px" : "16px 22px",
                    borderRadius: 12,
                    background: "oklch(0.18 0.01 240 / 0.86)",
                    border: "2px solid oklch(0.70 0.16 65)",
                    boxShadow: "0 8px 24px oklch(0 0 0 / 0.25)",
                  }}>
                    <span aria-hidden="true" style={{
                      width: tightLayout ? 36 : 48,
                      height: tightLayout ? 36 : 48,
                      flexShrink: 0,
                      borderRadius: 999,
                      background: "oklch(0.70 0.16 65)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round">
                        <line x1="12" y1="6" x2="12" y2="14"/>
                        <line x1="12" y1="18" x2="12.01" y2="18"/>
                      </svg>
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{
                        display: "block",
                        marginBottom: 4,
                        fontFamily: "var(--mono)",
                        fontSize: tightLayout ? 13 : 16,
                        fontWeight: 700,
                        letterSpacing: ".12em",
                        textTransform: "uppercase",
                        color: "oklch(0.82 0.13 70)",
                      }}>
                        Paused
                      </span>
                      <span style={{
                        display: "block",
                        fontSize: tightLayout ? 18 : 26,
                        fontWeight: 700,
                        letterSpacing: "-0.01em",
                        lineHeight: 1.2,
                        color: "white",
                        overflowWrap: "anywhere",
                      }}>
                        {captureMessage}
                      </span>
                    </span>
                  </div>
                )}

                {showTiltBanner && cameraFramesFlowing && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    maxWidth: "100%",
                    padding: "10px 18px",
                    borderRadius: 12,
                    background: "oklch(0.99 0.02 80)",
                    border: "2px solid oklch(0.70 0.16 65)",
                    boxShadow: "0 4px 14px oklch(0 0 0 / 0.18)",
                  }}>
                    <span style={{ ...EYEBROW_STYLE, color: "oklch(0.45 0.10 65)", flexShrink: 0 }}>Tilt</span>
                    <span style={{ fontSize: tightLayout ? 15 : 18, fontWeight: 600, color: "oklch(0.25 0.05 65)" }}>
                      Keep hips &amp; head visible
                    </span>
                  </div>
                )}

                {/* Unsteady-tracking message: display only, it never pauses the
                    exercise or changes a measurement. */}
                {trackingHint && captureOk && cameraFramesFlowing && (
                  <div role="status" style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    maxWidth: "100%",
                    padding: "10px 18px",
                    borderRadius: 12,
                    background: "oklch(0.99 0.02 80)",
                    border: "2px solid oklch(0.70 0.16 65)",
                    boxShadow: "0 4px 14px oklch(0 0 0 / 0.18)",
                  }}>
                    <span style={{ ...EYEBROW_STYLE, color: "oklch(0.45 0.10 65)", flexShrink: 0 }}>Tracking</span>
                    <span style={{ fontSize: tightLayout ? 15 : 18, fontWeight: 600, color: "oklch(0.25 0.05 65)" }}>
                      {trackingHint}
                    </span>
                  </div>
                )}

                {/* Baseline-capture banner. The loudest card on the view, because
                    the patient has to hold still while it runs. */}
                {baselineVisible && (
                  <div style={{
                    alignSelf: "stretch",
                    width: "100%",
                    maxWidth: 820,
                    margin: "0 auto",
                    padding: tightLayout ? "14px 16px" : "20px 26px",
                    borderRadius: 14,
                    background: "white",
                    border: `3px solid ${ACCENT.hex}`,
                    boxShadow: "0 10px 30px oklch(0 0 0 / 0.30)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: tightLayout ? 12 : 20 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...EYEBROW_STYLE, fontSize: tightLayout ? 13 : 16, color: ACCENT.text, marginBottom: 6 }}>
                          Baseline capture
                        </div>
                        <div style={{ fontSize: tightLayout ? 22 : 34, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15, color: "oklch(0.18 0.01 240)" }}>
                          {captureOk
                            ? baselineFinishingSamples
                              ? "Finishing setup — stand still"
                              : "Stand naturally, arms relaxed"
                            : "Paused — improve framing"}
                        </div>
                      </div>
                      <div style={{ flexShrink: 0, fontFamily: "var(--mono)", fontSize: tightLayout ? 36 : 56, fontWeight: 600, lineHeight: 1, color: ACCENT.text, fontVariantNumeric: "tabular-nums" }}>
                        {baselineFinishingSamples
                          ? `${Math.min(
                              baselineProgress.samples,
                              NEUTRAL_CALIBRATION_MIN_SAMPLES,
                            )}/${NEUTRAL_CALIBRATION_MIN_SAMPLES}`
                          : baselineRemainingSec}
                        {!baselineFinishingSamples && (
                          <span style={{ fontSize: tightLayout ? 18 : 24, marginLeft: 2 }}>s</span>
                        )}
                      </div>
                    </div>
                    <div style={{ height: 10, marginTop: 14, borderRadius: 5, overflow: "hidden", background: "oklch(0.93 0.01 200)" }}>
                      <div style={{ height: "100%", width: `${baselineProgressPct}%`, borderRadius: 5, background: ACCENT.hex, transition: "width .3s" }} />
                    </div>
                    <div style={{ marginTop: 6, fontFamily: "var(--mono)", fontSize: 12, letterSpacing: ".14em", color: "oklch(0.50 0.01 240)" }}>
                      {baselineProgressPct}% READY
                    </div>
                  </div>
                )}

                {/* Stale-baseline prompt. Raised when tracking was interrupted
                    AFTER the neutral baseline was captured. The baseline is kept
                    rather than re-taken, because re-taking it here would anchor
                    "neutral" to whatever posture the interruption happened in.
                    Recalibrating is offered, never performed automatically. */}
                {calibrationStale && !baselineVisible && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    maxWidth: 640,
                    padding: "12px 18px",
                    borderRadius: 12,
                    background: "white",
                    border: "1px solid oklch(0.86 0.06 75)",
                    boxShadow: "0 4px 14px oklch(0 0 0 / 0.14)",
                    pointerEvents: "auto",
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ ...EYEBROW_STYLE, color: "oklch(0.48 0.10 75)", marginBottom: 3 }}>
                        Tracking was interrupted
                      </div>
                      <div style={{ fontSize: 15, lineHeight: 1.4, color: "oklch(0.30 0.01 240)" }}>
                        Your setup baseline is still the one taken at the start. Recalibrate
                        only if you or the camera moved.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleManualRecalibration}
                      style={{
                        flexShrink: 0,
                        padding: "10px 16px",
                        borderRadius: 8,
                        border: "1px solid oklch(0.86 0.06 75)",
                        background: "oklch(0.97 0.02 75)",
                        color: "oklch(0.40 0.10 75)",
                        fontFamily: "var(--sans)",
                        fontSize: 15,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        cursor: "pointer",
                      }}
                    >
                      Recalibrate
                    </button>
                  </div>
                )}

                {/* Positioning hint before a session starts */}
                {sessionState === "idle" && cameraFramesFlowing && captureOk && !showResumePrompt && !showCompletedRecap && !!activeDefinition && !blockedBySchedule && (
                  <div style={{
                    alignSelf: "flex-start",
                    maxWidth: 620,
                    padding: tightLayout ? "14px 18px" : "18px 24px",
                    borderRadius: 12,
                    background: "oklch(1 0 0 / 0.96)",
                    boxShadow: "0 6px 20px oklch(0 0 0 / 0.18)",
                  }}>
                    <div style={{ fontSize: tightLayout ? 18 : 24, fontWeight: 600, lineHeight: 1.25 }}>
                      Stand where the camera can see you from head to knees
                    </div>
                    <div style={{ marginTop: 6, fontSize: tightLayout ? 15 : 18, color: "oklch(0.45 0.01 240)" }}>
                      Then press Start session.
                    </div>
                  </div>
                )}

                {/* Set numbers sit on the camera view, where the patient is already
                    looking. They stay up through rest, so the reset to zero and the
                    next set number are seen rolling in. */}
                {(sessionState === "active" || sessionState === "resting") && activeDefinition && (
                  <CameraSetHud
                    activeDefinition={activeDefinition}
                    repCounts={hudRepCounts}
                    holdState={hudHoldState}
                    timer={timer}
                    prescription={prescription}
                    currentSetIdx={hudSetIdx}
                    compact={tightLayout}
                  />
                )}
              </div>

              {/* Rest */}
              {sessionState === "resting" && (
                <div style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 20,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: 24,
                  textAlign: "center",
                  background: "oklch(0.18 0.01 240 / 0.72)",
                }}>
                  <div style={{ fontSize: tightLayout ? 18 : 24, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "oklch(0.80 0.03 200)" }}>
                    Rest period
                  </div>
                  <div style={{
                    fontFamily: "var(--mono)",
                    fontSize: "clamp(88px, 19vh, 170px)",
                    fontWeight: 600,
                    lineHeight: 1,
                    letterSpacing: "-0.03em",
                    color: "white",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {formatElapsedTime(restRemainingSec)}
                  </div>
                  <div style={{ fontSize: tightLayout ? 18 : 26, fontWeight: 500, color: "oklch(0.88 0.01 240)" }}>
                    Set {currentSetIdx} of {prescription.sets} starts automatically
                  </div>
                  <div style={{
                    width: "min(460px, 80%)",
                    height: 10,
                    marginTop: 20,
                    borderRadius: 5,
                    overflow: "hidden",
                    background: "oklch(1 0 0 / 0.22)",
                  }}>
                    <div style={{ height: "100%", width: `${restElapsedPct}%`, borderRadius: 5, background: NEON.hex }} />
                  </div>
                  {trackingPaused && (
                    <div style={{ marginTop: 16, fontSize: tightLayout ? 15 : 18, color: "oklch(0.86 0.10 75)" }}>
                      {captureMessage}
                    </div>
                  )}
                </div>
              )}

              {/* Camera off */}
              {!cameraOn && (
                <div style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 25,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: tightLayout ? 14 : 20,
                  padding: tightLayout ? 20 : 40,
                  textAlign: "center",
                  background: "oklch(0.22 0.006 240)",
                }}>
                  <div aria-hidden="true" style={{
                    width: tightLayout ? 64 : 84,
                    height: tightLayout ? 64 : 84,
                    borderRadius: 999,
                    background: "oklch(0.30 0.008 240)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="oklch(0.78 0.01 240)" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M16 16H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1"/>
                      <path d="M10 6h4a2 2 0 0 1 2 2v1.5l5-3v11l-5-3"/>
                      <line x1="2" y1="2" x2="22" y2="22"/>
                    </svg>
                  </div>
                  <button
                    id="cam-tour-start"
                    type="button"
                    onClick={() => startCamera(selectedDeviceId || undefined)}
                    disabled={isStarting || !modelLoaded}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: tightLayout ? "14px 26px" : "18px 40px",
                      borderRadius: 12,
                      border: "none",
                      background: ACCENT.hex,
                      color: "white",
                      fontFamily: "var(--sans)",
                      fontSize: tightLayout ? 18 : 22,
                      fontWeight: 600,
                      cursor: isStarting || !modelLoaded ? "default" : "pointer",
                      opacity: isStarting || !modelLoaded ? 0.6 : 1,
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/>
                      <path d="M17 10.5l5-3v9l-5-3"/>
                    </svg>
                    {isStarting ? "Starting…" : "Start camera"}
                  </button>
                  <div style={{ maxWidth: 520, fontSize: tightLayout ? 15 : 18, lineHeight: 1.4, color: "oklch(0.82 0.01 240)" }}>
                    Please click Allow when browser asks for camera permission.
                  </div>
                </div>
              )}

              {/* 3-2-1 countdown overlay */}
              {/* Session video indicator: always visible while recording. */}
              {recordingState !== "off" && recordingState !== "stopped" &&
                (sessionState === "countdown" || sessionState === "active" || sessionState === "resting") && (
                <div role="status" style={{
                  position: "absolute",
                  top: 12,
                  left: 12,
                  zIndex: 34,
                  maxWidth: "calc(100% - 24px)",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: recordingState === "recording" ? "oklch(0.25 0.02 25 / 0.85)" : "oklch(0.30 0.05 75 / 0.9)",
                  color: "white",
                  fontSize: 13,
                  fontWeight: 600,
                }}>
                  {recordingState === "recording" ? (
                    <>
                      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 999, background: "oklch(0.63 0.24 25)" }} />
                      Recording video
                      <button
                        type="button"
                        onClick={() => { stopSessionRecording(true); setRecordingState("off"); }}
                        style={{
                          padding: "2px 10px",
                          borderRadius: 999,
                          border: "1px solid oklch(1 0 0 / 0.6)",
                          background: "transparent",
                          color: "white",
                          fontFamily: "var(--sans)",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >Stop</button>
                    </>
                  ) : recordingState === "unsupported" ? (
                    "This browser cannot record video. Your exercise results are not affected."
                  ) : (
                    "Video recording stopped: it could not be saved. Your exercise results are not affected."
                  )}
                </div>
              )}

              {sessionState === "countdown" && (
                <div style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 30,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  background: "oklch(0.18 0.01 240 / 0.55)",
                  pointerEvents: "none",
                }}>
                  <span
                    key={countdownSec}
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "clamp(96px, 21vh, 190px)",
                      fontWeight: 700,
                      lineHeight: 1,
                      color: "white",
                      userSelect: "none",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {countdownSec > 0 ? countdownSec : "···"}
                  </span>
                  <span style={{
                    fontSize: tightLayout ? 20 : 26,
                    fontWeight: 600,
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    color: "oklch(0.92 0.01 240)",
                  }}>
                    {countdownSec > 0 ? "Get ready" : "Finishing setup"}
                  </span>
                </div>
              )}

              {/* Post-session summary — recap of the just-finished session. A
                  completed patient attempt reaches this only after the required
                  pain report/decline, and navigation waits for acknowledgement. */}
              {sessionState === "ended" && !preSessionSurvey && !videoQuestion && (() => {
                const def = activeDefinition;
                const isIso = def?.kind === "isometric";
                const setsLog = completedSetsLogRef.current;
                const setsDone = setsLog.length;

                // Whole attempt: outcomes restored after a Resume plus this page's.
                const outcomes = sessionRepOutcomes(priorRepOutcomesRef.current, repLogRef.current);
                const L = outcomes.left;
                const R = outcomes.right;
                const outcomeSides = prescribedOutcomeSides(
                  prescription.prescribedSide,
                );
                const showAsymmetry = shouldShowOutcomeAsymmetry(
                  prescription.prescribedSide,
                );
                const repEventsBySide = { left: L, right: R };
                const completeBySide = {
                  left: L.filter((event) => event.classification === "complete").length,
                  right: R.filter((event) => event.classification === "complete").length,
                };
                const averagePeak = (events: RepOutcome[]) =>
                  events.length > 0
                    ? events.reduce((sum, event) => sum + event.peakValue, 0) /
                      events.length
                    : null;
                const avgPeakBySide = {
                  left: averagePeak(L),
                  right: averagePeak(R),
                };
                const isAngle = def && def.kind === "dynamic" ? def.primaryMetric.name !== "wristShoulderVertical" : true;
                const target = def && def.kind === "dynamic" ? def.primaryMetric.thresholds.targetROM : 0;
                const fmtVal = (v: number) => (isAngle ? `${Math.round(v)}` : v.toFixed(2));
                const avgAsym = setsDone ? setsLog.reduce((s, r) => s + r.asymmetryIndex, 0) / setsDone : 0;
                const asymLabel = avgAsym < 0.1 ? "Low" : avgAsym < 0.25 ? "Moderate" : "High";
                const targetMs = setsLog.reduce((s, r) => s + (r.targetHoldMs ?? 0), 0);
                const heldMsBySide = {
                  left: setsLog.reduce((s, r) => s + (r.leftHoldMs ?? 0), 0),
                  right: setsLog.reduce((s, r) => s + (r.rightHoldMs ?? 0), 0),
                };
                const isPatient = prescription.patientExerciseId !== undefined;

                return (
                  <div style={MODAL_BACKDROP_STYLE}>
                    <div style={MODAL_CARD_STYLE}>
                      <div style={{ ...EYEBROW_STYLE, fontSize: 15, color: "oklch(0.38 0.07 145)", marginBottom: 8 }}>
                        Session complete
                      </div>
                      <div style={{ marginBottom: 22, fontSize: tightLayout ? 26 : 34, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
                        {def?.name ?? "Exercise"}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
                        {isIso
                          ? outcomeSides.map((side) => (
                              <div key={side} style={MODAL_ROW_STYLE}>
                                <span style={MODAL_LABEL_STYLE}>{sideLabel(side)} hold</span>
                                <span style={MODAL_VALUE_STYLE}>
                                  {Math.round(heldMsBySide[side] / 1000)}s
                                  {targetMs ? ` / ${Math.round(targetMs / 1000)}s` : ""}
                                </span>
                              </div>
                            ))
                          : outcomeSides.map((side) => (
                              <div key={side} style={{ display: "contents" }}>
                                <div style={MODAL_ROW_STYLE}>
                                  <span style={MODAL_LABEL_STYLE}>{sideLabel(side)} reps</span>
                                  <span style={MODAL_VALUE_STYLE}>
                                    {fullRomOutcomeText(
                                      completeBySide[side],
                                      repEventsBySide[side].length,
                                    )}
                                  </span>
                                </div>
                                {avgPeakBySide[side] !== null && (
                                  <div style={MODAL_ROW_STYLE}>
                                    <span style={MODAL_LABEL_STYLE}>
                                      {sideLabel(side)} avg peak{isAngle ? ` ${ANGLE_ESTIMATE_LABEL}` : ""}
                                    </span>
                                    <span style={MODAL_VALUE_STYLE}>
                                      {fmtVal(avgPeakBySide[side]!)}
                                      {target ? ` · target ${fmtVal(target)}` : ""}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ))}
                        {showAsymmetry && (
                          <div style={MODAL_ROW_STYLE}><span style={MODAL_LABEL_STYLE}>Asymmetry</span><span style={MODAL_VALUE_STYLE}>{asymLabel}</span></div>
                        )}
                        <div style={MODAL_ROW_STYLE}><span style={MODAL_LABEL_STYLE}>Sets</span><span style={MODAL_VALUE_STYLE}>{setsDone} / {prescription.sets}</span></div>
                      </div>

                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                        {(pendingCompletionNavigation?.next ||
                          (!pendingCompletionNavigation && hasNextExercise)) && (
                          <button
                            type="button"
                            onClick={() =>
                              pendingCompletionNavigation
                                ? continueFromCompletionRecap("next")
                                : goToAdjacentExercise(1)
                            }
                            style={{ ...PRIMARY_BUTTON_STYLE, flex: "1 1 160px" }}
                          >Next exercise →</button>
                        )}
                        {!pendingCompletionNavigation && (
                          <button
                            type="button"
                            onClick={() => void startSessionWithCamera()}
                            disabled={!modelLoaded}
                            style={{ ...SECONDARY_BUTTON_STYLE, flex: "1 1 160px", opacity: modelLoaded ? 1 : 0.5 }}
                          >Redo</button>
                        )}
                        {isPatient && lastSessionId !== null && (
                          <ReportButton
                            label="Session report (PDF)"
                            onDownload={async () => {
                              const { downloadSessionReport } = await import("@/lib/reports/sessionReport");
                              await downloadSessionReport(lastSessionId, user?.name ?? "Patient");
                            }}
                            wrapperStyle={{ flex: "1 1 160px" }}
                            style={{ ...SECONDARY_BUTTON_STYLE, width: "100%" }}
                          />
                        )}
                        {isPatient && pendingCompletionNavigation ? (
                          <button
                            type="button"
                            onClick={() => continueFromCompletionRecap("schedule")}
                            style={{ ...SECONDARY_BUTTON_STYLE, flex: "1 1 160px" }}
                          >
                            {pendingCompletionNavigation.next
                              ? "Back to schedule"
                              : "Finish and return to schedule"}
                          </button>
                        ) : isPatient ? (
                          <Link
                            href="/dashboard/patient"
                            style={{ ...SECONDARY_BUTTON_STYLE, flex: "1 1 160px" }}
                          >Back to schedule</Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* "Already completed" recap — shown on return to the camera page
                  when the selected exercise was finished in a prior visit. Built
                  from the persisted latest-finished session (the live in-memory
                  summary above is gone after the route unmounts). Dismissable. */}
              {showCompletedRecap && selectedRecap && !preSessionSurvey && !videoQuestion && (() => {
                const recap = selectedRecap;
                const isIso = recap.exerciseKind === "isometric";
                const isPatient = prescription.patientExerciseId !== undefined;
                const duration =
                  recap.durationMs != null
                    ? formatElapsedTime(Math.round(recap.durationMs / 1000))
                    : "—";
                const finishedAt = recap.endedAt
                  ? new Date(recap.endedAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "—";
                const outcomeSides = prescribedOutcomeSides(
                  recap.prescribedSide,
                );
                const repCountBySide = {
                  left: recap.leftReps,
                  right: recap.rightReps,
                };
                const completeBySide = {
                  left: recap.completeLeftReps,
                  right: recap.completeRightReps,
                };
                const holdMsBySide = {
                  left: recap.totalLeftHoldMs ?? recap.totalPairedHoldMs ?? 0,
                  right: recap.totalRightHoldMs ?? recap.totalPairedHoldMs ?? 0,
                };
                const targetSec =
                  recap.totalTargetHoldMs != null
                    ? Math.round(recap.totalTargetHoldMs / 1000)
                    : 0;
                const peakBySide = {
                  left: recap.avgLeftPeakValue,
                  right: recap.avgRightPeakValue,
                };
                const recapIsAngle =
                  activeDefinition?.kind === "dynamic"
                    ? activeDefinition.primaryMetric.name !== "wristShoulderVertical"
                    : true;
                const formatRecapPeak = (value: number) =>
                  recapIsAngle ? `${Math.round(value)}` : value.toFixed(2);

                return (
                  <div style={MODAL_BACKDROP_STYLE}>
                    <div style={MODAL_CARD_STYLE}>
                      <button
                        type="button"
                        onClick={() => setRecapDismissed(true)}
                        aria-label="Dismiss"
                        style={MODAL_DISMISS_STYLE}
                      >✕</button>

                      <div style={{ ...EYEBROW_STYLE, fontSize: 15, color: "oklch(0.38 0.07 145)", marginBottom: 8 }}>
                        Already completed
                      </div>
                      <div style={{ marginBottom: 22, paddingRight: 36, fontSize: tightLayout ? 26 : 34, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
                        {selectedExerciseObj?.name ?? activeDefinition?.name ?? "Exercise"}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
                        {isIso
                          ? outcomeSides.map((side) => (
                              <div key={side} style={MODAL_ROW_STYLE}>
                                <span style={MODAL_LABEL_STYLE}>{sideLabel(side)} hold</span>
                                <span style={MODAL_VALUE_STYLE}>
                                  {Math.round(holdMsBySide[side] / 1000)}s
                                  {targetSec ? ` / ${targetSec}s` : ""}
                                </span>
                              </div>
                            ))
                          : outcomeSides.map((side) => (
                              <div key={side} style={{ display: "contents" }}>
                                <div style={MODAL_ROW_STYLE}>
                                  <span style={MODAL_LABEL_STYLE}>{sideLabel(side)} reps</span>
                                  <span style={MODAL_VALUE_STYLE}>
                                    {fullRomOutcomeText(
                                      completeBySide[side],
                                      repCountBySide[side],
                                    )}
                                  </span>
                                </div>
                                {peakBySide[side] !== null && (
                                  <div style={MODAL_ROW_STYLE}>
                                    <span style={MODAL_LABEL_STYLE}>
                                      {sideLabel(side)} avg peak{recapIsAngle ? ` ${ANGLE_ESTIMATE_LABEL}` : ""}
                                    </span>
                                    <span style={MODAL_VALUE_STYLE}>
                                      {formatRecapPeak(peakBySide[side]!)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            ))}
                        <div style={MODAL_ROW_STYLE}><span style={MODAL_LABEL_STYLE}>Sets</span><span style={MODAL_VALUE_STYLE}>{recap.setCount} / {prescription.sets}</span></div>
                        <div style={MODAL_ROW_STYLE}><span style={MODAL_LABEL_STYLE}>Duration</span><span style={MODAL_VALUE_STYLE}>{duration}</span></div>
                        <div style={MODAL_ROW_STYLE}><span style={MODAL_LABEL_STYLE}>Finished</span><span style={MODAL_VALUE_STYLE}>{finishedAt}</span></div>
                      </div>

                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                        {hasNextExercise && (
                          <button
                            type="button"
                            onClick={() => goToAdjacentExercise(1)}
                            style={{ ...PRIMARY_BUTTON_STYLE, flex: "1 1 160px" }}
                          >Next exercise →</button>
                        )}
                        <button
                          type="button"
                          onClick={() => void startSessionWithCamera()}
                          disabled={!modelLoaded}
                          style={{ ...(hasNextExercise ? SECONDARY_BUTTON_STYLE : PRIMARY_BUTTON_STYLE), flex: "1 1 160px", opacity: modelLoaded ? 1 : 0.5 }}
                        >Redo</button>
                        {isPatient && recap.sessionId !== null && (
                          <ReportButton
                            label="Session report (PDF)"
                            onDownload={async () => {
                              const { downloadSessionReport } = await import("@/lib/reports/sessionReport");
                              await downloadSessionReport(recap.sessionId!, user?.name ?? "Patient");
                            }}
                            wrapperStyle={{ flex: "1 1 160px" }}
                            style={{ ...SECONDARY_BUTTON_STYLE, width: "100%" }}
                          />
                        )}
                        {isPatient && (
                          <Link
                            href="/dashboard/patient"
                            style={{ ...SECONDARY_BUTTON_STYLE, flex: "1 1 160px" }}
                          >Back to schedule</Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* "Session in progress" resume prompt — shown on return to a
                  session that was disrupted (not ended via the End button). The
                  counter/sets/timer come from the device-local resume snapshot;
                  Resume continues the SAME open session. */}
              {showResumePrompt && resumeSnap && !preSessionSurvey && !videoQuestion && (() => {
                const snap = resumeSnap;
                if (!snap) return null;
                const isIso = snap.kind === "isometric";
                const heldSec = Math.round(snap.pairedHoldMs / 1000);
                // Side-split isometric snapshots carry per-side holds instead
                // of a paired hold; surface them separately (never merged).
                // (The prompt only renders when the snapshot matches the
                // selected exercise, so the active definition is authoritative.)
                const sideSplitIso = isIso && isSideSplitIsometric(activeDefinition);
                const leftHeldSec = Math.round((snap.sideHoldMs?.left ?? 0) / 1000);
                const rightHeldSec = Math.round((snap.sideHoldMs?.right ?? 0) / 1000);
                const elapsed = formatElapsedTime(Math.round(snap.elapsedMs / 1000));

                return (
                  <div style={MODAL_BACKDROP_STYLE}>
                    <div style={MODAL_CARD_STYLE}>
                      <button
                        type="button"
                        onClick={() => setResumeDismissed(true)}
                        aria-label="Dismiss"
                        style={MODAL_DISMISS_STYLE}
                      >✕</button>

                      <div style={{ ...EYEBROW_STYLE, fontSize: 15, color: "oklch(0.45 0.13 70)", marginBottom: 8 }}>
                        Session in progress
                      </div>
                      <div style={{ marginBottom: 22, paddingRight: 36, fontSize: tightLayout ? 26 : 34, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
                        {selectedExerciseObj?.name ?? activeDefinition?.name ?? "Exercise"}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
                        <div style={MODAL_ROW_STYLE}><span style={MODAL_LABEL_STYLE}>Set</span><span style={MODAL_VALUE_STYLE}>{snap.completedSets + 1} of {prescription.sets}</span></div>
                        {sideSplitIso ? (
                          <div style={MODAL_ROW_STYLE}><span style={MODAL_LABEL_STYLE}>Hold</span><span style={MODAL_VALUE_STYLE}>L {leftHeldSec}s · R {rightHeldSec}s</span></div>
                        ) : isIso ? (
                          <div style={MODAL_ROW_STYLE}><span style={MODAL_LABEL_STYLE}>Hold</span><span style={MODAL_VALUE_STYLE}>{heldSec}s</span></div>
                        ) : (
                          <div style={MODAL_ROW_STYLE}><span style={MODAL_LABEL_STYLE}>Reps</span><span style={MODAL_VALUE_STYLE}>L {snap.currentSetReps.left} · R {snap.currentSetReps.right}</span></div>
                        )}
                        <div style={MODAL_ROW_STYLE}><span style={MODAL_LABEL_STYLE}>Elapsed</span><span style={MODAL_VALUE_STYLE}>{elapsed}</span></div>
                      </div>

                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                        <button
                          type="button"
                          onClick={resumeSession}
                          disabled={!modelLoaded || isStarting}
                          style={{ ...PRIMARY_BUTTON_STYLE, flex: "1 1 160px" }}
                        >Resume</button>
                        <button
                          type="button"
                          // The snapshot is cleared only once the survey is
                          // answered, so Back still leaves Resume available.
                          onClick={() => void startSessionWithCamera(() => clearResumeSnapshot(snap.patientExerciseId))}
                          disabled={!modelLoaded}
                          style={{ ...SECONDARY_BUTTON_STYLE, flex: "1 1 160px", opacity: modelLoaded ? 1 : 0.5 }}
                        >Start over</button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Before-session pain survey: every new patient session waits
                  for Save or Skip, and Back returns without starting. */}
              {preSessionSurvey && (
                <div style={MODAL_BACKDROP_STYLE}>
                  <div role="dialog" aria-modal="true" aria-labelledby="pre-session-pain-title" style={MODAL_CARD_STYLE}>
                    <div id="pre-session-pain-title" style={{ marginBottom: 4, fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>
                      Pain before you start
                    </div>
                    <p style={{ margin: "0 0 14px", fontSize: 15, lineHeight: 1.45, color: "oklch(0.42 0.01 240)" }}>
                      How much pain do you feel right now? Choose 0 for no pain. This report
                      supports your therapist&apos;s review and is not a diagnosis.
                    </p>
                    <label htmlFor="pre-session-pain-score" style={{ display: "block", marginBottom: 6, fontSize: 15 }}>
                      Pain score: <strong>{preSessionSurvey.score}/10</strong>
                    </label>
                    <input
                      id="pre-session-pain-score"
                      type="range"
                      min={0}
                      max={10}
                      step={1}
                      value={preSessionSurvey.score}
                      onChange={(event) => {
                        const score = Number(event.target.value);
                        setPreSessionSurvey((survey) => survey && { ...survey, score });
                      }}
                      style={{ width: "100%", accentColor: ACCENT.hex }}
                    />
                    <label htmlFor="pre-session-pain-area" style={{ display: "block", marginTop: 12, marginBottom: 6, fontSize: 15 }}>
                      Body area (optional)
                    </label>
                    <input
                      id="pre-session-pain-area"
                      value={preSessionSurvey.bodyArea}
                      maxLength={80}
                      onChange={(event) => {
                        const bodyArea = event.target.value;
                        setPreSessionSurvey((survey) => survey && { ...survey, bodyArea });
                      }}
                      placeholder="e.g. left shoulder"
                      style={FIELD_STYLE}
                    />
                    {preSessionSurvey.score >= PRE_SESSION_PAIN_CAUTION_SCORE && (
                      <p role="status" style={{
                        margin: "14px 0 0",
                        padding: "10px 12px",
                        borderRadius: 10,
                        background: "oklch(0.97 0.03 80)",
                        border: "1px solid oklch(0.90 0.06 80)",
                        fontSize: 14,
                        lineHeight: 1.45,
                        color: "oklch(0.38 0.08 75)",
                      }}>
                        That is a high pain score. Consider checking with your therapist before
                        exercising today. You can still start if you feel able; press
                        &ldquo;Stop — I have pain&rdquo; if the pain gets worse.
                      </p>
                    )}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
                      <button
                        type="button"
                        onClick={() => answerPreSessionSurvey({
                          status: "reported",
                          score: preSessionSurvey.score,
                          bodyArea: preSessionSurvey.bodyArea.trim() || null,
                        })}
                        style={{ ...PRIMARY_BUTTON_STYLE, flex: "1 1 160px" }}
                      >{rememberedVideoChoice ? "Save and start" : "Continue"}</button>
                      <button
                        type="button"
                        onClick={() => answerPreSessionSurvey({ status: "declined" })}
                        style={{ ...SECONDARY_BUTTON_STYLE, flex: "1 1 160px" }}
                      >Skip</button>
                    </div>
                    <button
                      type="button"
                      onClick={() => answerPreSessionSurvey(null)}
                      style={{
                        marginTop: 10,
                        padding: "6px 0",
                        border: "none",
                        background: "none",
                        color: "oklch(0.45 0.01 240)",
                        fontFamily: "var(--sans)",
                        fontSize: 14,
                        cursor: "pointer",
                      }}
                    >Back</button>
                  </div>
                </div>
              )}

              {/* Session video question: asked before every patient session
                  unless the patient asked this device to remember the answer. */}
              {videoQuestion && (
                <div style={MODAL_BACKDROP_STYLE}>
                  <div role="dialog" aria-modal="true" aria-labelledby="session-video-title" style={MODAL_CARD_STYLE}>
                    <div id="session-video-title" style={{ marginBottom: 8, fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>
                      Record video of this session?
                    </div>
                    <p style={{ margin: "0 0 10px", fontSize: 15, lineHeight: 1.45, color: "oklch(0.42 0.01 240)" }}>
                      Recording is optional. Your exercise is measured the same either way.
                    </p>
                    <ul style={{ margin: "0 0 16px 20px", padding: 0, fontSize: 14, lineHeight: 1.55, color: "oklch(0.35 0.01 240)" }}>
                      {SESSION_VIDEO_NOTICE.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      <button
                        type="button"
                        onClick={() => answerVideoChoice({ record: true, remember: videoQuestion.remember })}
                        style={{ ...PRIMARY_BUTTON_STYLE, flex: "1 1 160px" }}
                      >Yes, record</button>
                      <button
                        type="button"
                        onClick={() => answerVideoChoice({ record: false, remember: videoQuestion.remember })}
                        style={{ ...SECONDARY_BUTTON_STYLE, flex: "1 1 160px" }}
                      >No</button>
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, fontSize: 14, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={videoQuestion.remember}
                        onChange={(event) => {
                          const remember = event.target.checked;
                          setVideoQuestion((question) => question && { ...question, remember });
                        }}
                        style={{ width: 18, height: 18, accentColor: ACCENT.hex }}
                      />
                      Remember my choice on this device (you can change it beside Start session)
                    </label>
                    <button
                      type="button"
                      onClick={() => answerVideoChoice(null)}
                      style={{
                        marginTop: 10,
                        padding: "6px 0",
                        border: "none",
                        background: "none",
                        color: "oklch(0.45 0.01 240)",
                        fontFamily: "var(--sans)",
                        fontSize: 14,
                        cursor: "pointer",
                      }}
                    >Back</button>
                  </div>
                </div>
              )}
            </div>
          </main>

          {/* RIGHT COLUMN — exercise and session controls on top, the
              demonstration below with all the height that is left */}
          <aside id="cam-tour-column" style={{
            width: asideWidth,
            flexShrink: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            overflowY: compactLayout ? "visible" : "auto",
          }}>
            {sessionState === "reporting" ? (
              <div id="cam-tour-session" style={{ ...CARD_STYLE, flex: "0 0 auto", padding: 16 }}>
                <div style={{ marginBottom: 4, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>
                  Pain after this attempt
                </div>
                <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.45, color: "oklch(0.42 0.01 240)" }}>
                  Choose 0 for no pain. This report supports your therapist&apos;s review and is not a diagnosis.
                </p>
                <label style={{ display: "block", marginBottom: 6, fontSize: 14 }}>
                  Pain score: <strong>{painScore}/10</strong>
                </label>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={painScore}
                  onChange={(event) => setPainScore(Number(event.target.value))}
                  disabled={painReportSaving}
                  style={{ width: "100%", accentColor: ACCENT.hex }}
                />
                <label style={{ display: "block", marginTop: 10, marginBottom: 6, fontSize: 14 }}>
                  Timing (optional)
                </label>
                <select
                  value={painTiming}
                  onChange={(event) => setPainTiming(event.target.value as PainTiming | "")}
                  disabled={painReportSaving}
                  style={FIELD_STYLE}
                >
                  <option value="">Not specified</option>
                  <option value="during">During</option>
                  <option value="after">After</option>
                  <option value="both">During and after</option>
                </select>
                <label style={{ display: "block", marginTop: 10, marginBottom: 6, fontSize: 14 }}>
                  Body area (optional)
                </label>
                <input
                  value={painBodyArea}
                  maxLength={80}
                  onChange={(event) => setPainBodyArea(event.target.value)}
                  disabled={painReportSaving}
                  placeholder="e.g. left shoulder"
                  style={FIELD_STYLE}
                />
                {painReportError && (
                  <p style={{ margin: "10px 0 0", fontSize: 13, color: "oklch(0.50 0.18 25)" }}>
                    {painReportError} Please retry while this page remains open.
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={() => void savePainReport(false)}
                    disabled={painReportSaving}
                    style={{ ...PRIMARY_BUTTON_STYLE, flex: 1, padding: "12px 14px", fontSize: 16 }}
                  >
                    {painReportSaving ? "Saving…" : "Save report"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void savePainReport(true)}
                    disabled={painReportSaving}
                    style={{ ...SECONDARY_BUTTON_STYLE, flex: 1, padding: "12px 14px", fontSize: 16 }}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ) : sessionState === "active" || sessionState === "resting" || sessionState === "countdown" ? (
              <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ ...CARD_STYLE, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <div style={{ ...EYEBROW_STYLE, fontSize: 11, color: ACCENT.text, marginBottom: 2 }}>Session</div>
                    {selectedExerciseObj && (
                      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.2 }}>
                        {selectedExerciseObj.name}
                      </div>
                    )}
                  </div>
                  <SessionProgressStrip
                    phase={finishedSet ? "active" : sessionState}
                    setNumber={hudSetIdx}
                    completedSets={completedSets}
                    sets={prescription.sets}
                    progressPct={progressPct}
                    setUnderway={sessionState === "active"}
                  />
                  {traceSyncReadout}
                </div>

                {sessionState === "active" && (
                  <FormCheckCard
                    state={formCheckState}
                    isometric={activeDefinition?.kind === "isometric"}
                  />
                )}

                <div id="cam-tour-session" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
                  {sessionState === "active" && confirmingEnd ? (
                    <div style={{
                      padding: 14,
                      borderRadius: 12,
                      background: "oklch(0.97 0.03 80)",
                      border: "1px solid oklch(0.90 0.06 80)",
                    }}>
                      <p style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 650, color: "oklch(0.35 0.08 75)" }}>
                        End this exercise early?
                      </p>
                      <p style={{ margin: "0 0 12px", fontSize: 14, color: "oklch(0.42 0.07 75)" }}>
                        The current set won&apos;t count as complete.
                      </p>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => { handleSessionEnd(); setConfirmingEnd(false); }}
                          style={{ ...DANGER_BUTTON_STYLE, flex: 1 }}
                        >Yes, end</button>
                        <button
                          type="button"
                          onClick={() => setConfirmingEnd(false)}
                          style={{ ...SECONDARY_BUTTON_STYLE, flex: 1, padding: "11px 12px", fontSize: 15 }}
                        >Cancel</button>
                      </div>
                    </div>
                  ) : sessionState === "resting" ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={skipRest}
                        style={{ ...SECONDARY_BUTTON_STYLE, flex: 1, padding: "13px 12px", fontSize: 15, fontWeight: 600 }}
                      >Skip rest</button>
                      <button
                        type="button"
                        onClick={() => handleSessionEnd()}
                        style={{ ...SECONDARY_BUTTON_STYLE, flex: 1, padding: "13px 12px", fontSize: 15, color: "oklch(0.45 0.01 240)" }}
                      >End</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (sessionState === "countdown") {
                          handleSessionEnd();
                        } else {
                          setConfirmingEnd(true);
                        }
                      }}
                      style={{ ...SECONDARY_BUTTON_STYLE, width: "100%", padding: "13px 12px", fontSize: 15, color: "oklch(0.45 0.01 240)" }}
                    >
                      End
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleSessionEnd("pain")}
                    style={{
                      width: "100%",
                      padding: "13px 12px",
                      borderRadius: 10,
                      border: "1px solid oklch(0.55 0.17 25)",
                      background: "oklch(0.97 0.025 25)",
                      color: "oklch(0.42 0.16 25)",
                      fontFamily: "var(--sans)",
                      fontSize: 15,
                      fontWeight: 650,
                      cursor: "pointer",
                    }}
                  >
                    Stop — I have pain
                  </button>
                </div>
              </div>
            ) : (
              <div id="cam-tour-exercise" style={{
                ...CARD_STYLE,
                flex: "1 1 auto",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 16,
              }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "oklch(0.40 0.01 240)" }}>Session</div>
                {assignedExercises.length === 0 ? (
                  <div style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "oklch(0.97 0.03 80)",
                    border: "1px solid oklch(0.90 0.06 80)",
                    fontSize: 14,
                    lineHeight: 1.45,
                    color: "oklch(0.40 0.08 75)",
                  }}>
                    No exercises are due today. Return to your schedule to review
                    completed, upcoming, or historical prescriptions.
                    {user?.role === "patient" && (
                      <div style={{ marginTop: 8 }}>
                        <Link href="/dashboard/patient?tab=session" style={{ color: ACCENT.text, fontWeight: 650 }}>
                          Return to schedule
                        </Link>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => goToAdjacentExercise(-1)}
                      disabled={!hasPrevExercise || sessionBusy}
                      aria-label="Previous exercise"
                      style={{ ...ICON_BUTTON_STYLE, opacity: (!hasPrevExercise || sessionBusy) ? 0.35 : 1 }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M15 18l-6-6 6-6"/>
                      </svg>
                    </button>
                    <span style={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: "center",
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: ".12em",
                      textTransform: "uppercase",
                      color: ACCENT.text,
                    }}>
                      {exerciseQueueLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() => goToAdjacentExercise(1)}
                      disabled={!hasNextExercise || sessionBusy}
                      aria-label="Next exercise"
                      style={{ ...ICON_BUTTON_STYLE, opacity: (!hasNextExercise || sessionBusy) ? 0.35 : 1 }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M9 18l6-6-6-6"/>
                      </svg>
                    </button>
                  </div>
                )}

                {selectedExerciseObj && (
                  <>
                    <div>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
                          {selectedExerciseObj.name}
                        </div>
                        {selectedExerciseCompleted ? (
                          <span style={{
                            flexShrink: 0,
                            marginTop: 4,
                            padding: "3px 8px",
                            borderRadius: 999,
                            background: "oklch(0.96 0.04 145)",
                            border: "1px solid oklch(0.88 0.06 145)",
                            color: "oklch(0.40 0.07 145)",
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: ".04em",
                          }}>✓ Completed</span>
                        ) : resumeEligible ? (
                          <span style={{
                            flexShrink: 0,
                            marginTop: 4,
                            padding: "3px 8px",
                            borderRadius: 999,
                            background: "oklch(0.96 0.05 75)",
                            border: "1px solid oklch(0.88 0.08 75)",
                            color: "oklch(0.45 0.13 70)",
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: ".04em",
                          }}>● In progress</span>
                        ) : null}
                      </div>
                      <p style={{ margin: "7px 0 0", fontSize: 16, lineHeight: 1.4, color: "oklch(0.40 0.01 240)" }}>
                        {selectedExerciseObj.description}
                      </p>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                      <span style={CHIP_STYLE}>{prescription.sets} sets</span>
                      <span style={CHIP_STYLE}>{prescriptionTargetText}</span>
                      <span style={CHIP_STYLE}>{prescription.restSeconds}s rest</span>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.45, color: "oklch(0.45 0.01 240)" }}>
                      Prescribed side: <strong>{prescription.prescribedSide}</strong>
                      {" · "}
                      {formatResistanceContext(prescription.resistance)}
                    </div>
                    {activeDefinition?.id === "ex_007" &&
                      prescription.patientExerciseId !== undefined && (
                        <div style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          background: ACCENT.soft,
                          color: ACCENT.text,
                          fontSize: 13,
                          lineHeight: 1.45,
                        }}>
                          <strong>Motion trace recording:</strong> raw upper-body
                          metrics and pose landmarks only. The trace holds no video.
                        </div>
                      )}
                  </>
                )}

                {/* Session controls */}
                <div id="cam-tour-session" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>
                  {traceSyncReadout}
                  <button
                    type="button"
                    onClick={() => void startSessionWithCamera()}
                    disabled={!activeDefinition || blockedBySchedule || !modelLoaded}
                    style={{
                      ...PRIMARY_BUTTON_STYLE,
                      width: "100%",
                      padding: "17px 18px",
                      fontSize: 20,
                      cursor: !activeDefinition || blockedBySchedule || !modelLoaded ? "not-allowed" : "pointer",
                      opacity: !activeDefinition || blockedBySchedule || !modelLoaded ? 0.5 : 1,
                    }}
                  >
                    {sessionState === "ended"
                      ? "Restart"
                      : blockedBySchedule
                        ? selectedExercisePainStopped
                          ? "Await therapist rescheduling"
                          : "Not scheduled today"
                        : "Start session"}
                  </button>
                  {rememberedVideoChoice && (
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.4, color: "oklch(0.45 0.01 240)" }}>
                      Session video: {rememberedVideoChoice.record ? "recorded" : "not recorded"}, as you asked this
                      device to remember.{" "}
                      <button
                        type="button"
                        onClick={() => { forgetVideoChoice(user?.id); setVideoChoiceVersion((v) => v + 1); }}
                        style={{
                          padding: 0,
                          border: "none",
                          background: "none",
                          color: ACCENT.text,
                          textDecoration: "underline",
                          fontFamily: "var(--sans)",
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >Ask me each time</button>
                    </p>
                  )}

                  {(blockedBySchedule || scheduleNotice) && (
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.4, color: "oklch(0.55 0.14 45)" }}>
                      {scheduleNotice ??
                        (selectedExercisePainStopped
                          ? "This occurrence was closed after pain was reported. Do not resume it; your therapist must review and reschedule if appropriate."
                          : "Not scheduled today — start this exercise from your schedule on its due day.")}
                    </p>
                  )}

                  {sessionState === "ended" && hasNextExercise && (
                    <button
                      type="button"
                      onClick={() => goToAdjacentExercise(1)}
                      style={{
                        ...SECONDARY_BUTTON_STYLE,
                        width: "100%",
                        padding: "12px 14px",
                        fontSize: 16,
                        fontWeight: 600,
                        border: `1px solid ${ACCENT.hex}`,
                        color: ACCENT.text,
                      }}
                    >
                      Next exercise →
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Demonstration, under the exercise card */}
            <DemoCard exerciseId={activeDefinition?.id ?? null} compact={compactLayout} />
          </aside>
        </div>
      </div>

      {/* Floating segment remote. The operator stands 2-3 m away, so the
          boundary has to be clickable without returning to the desk: park
          the pointer on this control before stepping back and a single
          LEFT click marks the boundary. Left click is the only pointer
          input the page reliably receives — thumb buttons are serviced by
          the browser and never reach it (see the keydown effect above). */}
      {coachingShadowStaffAllowed && coachingShadowEnabled && !!activeDefinition && (() => {
        const step = COACHING_SESSION_PLAN[coachingPlanIndex];
        const recording = coachingShadowActiveSegment !== null &&
          !coachingShadowActiveSegment.label.startsWith("after:") &&
          coachingShadowActiveSegment.label !== "idle";
        return (
          <div
            data-testid="coaching-remote"
            style={{
              position: "fixed",
              // Bottom-LEFT on purpose: the session Start/Stop controls live in
              // the right-hand sidebar, and an earlier bottom-right placement
              // covered them so the session could not be started at all.
              left: 18,
              bottom: 18,
              zIndex: 60,
              width: coachingRemoteCollapsed ? 200 : 260,
              padding: coachingRemoteCollapsed ? "8px 12px" : 14,
              borderRadius: 10,
              border: "2px solid oklch(0.30 0.05 250)",
              background: "oklch(0.99 0.004 250)",
              boxShadow: "0 10px 30px -12px rgba(0,0,0,.45)",
              fontFamily: "var(--mono)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "oklch(0.45 0.02 250)" }}>
                {step
                  ? `Step ${coachingPlanIndex + 1}/${COACHING_SESSION_PLAN.length} · ${step.captureId}`
                  : "Plan complete"}
              </div>
              <button
                type="button"
                aria-label={coachingRemoteCollapsed ? "Expand segment remote" : "Collapse segment remote"}
                onClick={() => setCoachingRemoteCollapsed((v) => !v)}
                style={{
                  border: "1px solid oklch(0.82 0.03 250)",
                  borderRadius: 4,
                  background: "white",
                  color: "oklch(0.30 0.05 250)",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  lineHeight: 1,
                  padding: "3px 7px",
                  cursor: "pointer",
                }}
              >
                {coachingRemoteCollapsed ? "▴" : "▾"}
              </button>
            </div>
            {!coachingRemoteCollapsed && (<>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3, color: "oklch(0.20 0.03 250)", wordBreak: "break-word" }}>
              {recording
                ? coachingShadowActiveSegment.label
                : step?.label ?? "—"}
            </div>
            <div style={{ fontSize: 11, marginTop: 2, color: "oklch(0.45 0.02 250)" }}>
              {recording ? `recording · ${coachingShadowActiveSegment.intent}` : "not recording"}
            </div>
            <button
              type="button"
              disabled={!step && !recording}
              onClick={() => {
                if (recording) {
                  endCoachingShadowSegment();
                  return;
                }
                if (!step) return;
                if (!markCoachingShadowSegment(step.label, step.intent)) return;
                setCoachingShadowSegmentLabel(step.label);
                setCoachingShadowSegmentIntent(step.intent);
              }}
              style={{
                display: "block",
                width: "100%",
                marginTop: 10,
                padding: "20px 8px",
                borderRadius: 8,
                border: "none",
                cursor: !step && !recording ? "default" : "pointer",
                background: recording ? "oklch(0.52 0.17 25)" : ACCENT.hex,
                color: "white",
                fontFamily: "var(--mono)",
                fontSize: 17,
                fontWeight: 700,
                letterSpacing: ".06em",
              }}
            >
              {recording ? "END SEGMENT" : "START SEGMENT"}
            </button>
            <button
              type="button"
              disabled={!step || coachingShadowAdvanceBlocked}
              onClick={advanceCoachingShadowPlan}
              style={{
                display: "block",
                width: "100%",
                marginTop: 6,
                padding: "8px",
                borderRadius: 6,
                border: "1px solid oklch(0.82 0.03 250)",
                background: "white",
                color: "oklch(0.30 0.05 250)",
                fontFamily: "var(--mono)",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".08em",
                cursor: step && !coachingShadowAdvanceBlocked ? "pointer" : "default",
              }}
            >
              {coachingShadowAdvanceBlocked ? "DOWNLOAD LOG FIRST" : "NEXT STEP →"}
            </button>
            <div style={{ fontSize: 9.5, marginTop: 7, lineHeight: 1.4, color: "oklch(0.48 0.02 250)" }}>
              {coachingShadowAdvanceBlocked
                ? `This capture has ${coachingShadowCount} unexported decisions.`
                : step?.hint ?? "Export this capture, then run E3 unrecorded."}
            </div>
            </>)}
          </div>
        );
      })()}

      {/* ── Spotlight Tour ──────────────────────────────────────────────── */}
      {showTutorial && (
        <CameraTour
          step={tutorialStep}
          onNext={() => setTutorialStep(s => s + 1)}
          onBack={() => setTutorialStep(s => s - 1)}
          onGoTo={setTutorialStep}
          onClose={() => setShowTutorial(false)}
        />
      )}
    </>
  );
}

// ── Spotlight Tour ────────────────────────────────────────────────────────────

const TOUR_STEPS: {
  targetId: string;
  /** When set, card is positioned relative to this element instead of targetId */
  anchorId?: string;
  /** Further elements spotlighted alongside targetId */
  alsoTargetIds?: string[];
  /** Hold the camera menu open while this step shows, so its tray can be spotlighted */
  opensCameraMenu?: boolean;
  title: string;
  lines: string[];
  placement: "below" | "above" | "right" | "left";
  /** Illustration beside the text; the card widens to `cardW` to fit it */
  graphic?: TourGraphicKind;
  cardW?: number;
  /** Extra gap (px) between card and target for "above" placement (default 16) */
  aboveGap?: number;
}[] = [
  {
    targetId: "cam-tour-start",
    alsoTargetIds: ["cam-tour-camera-menu"],
    opensCameraMenu: true,
    title: "Start Camera",
    placement: "below",
    graphic: "start",
    cardW: 560,
    lines: [
      "Click this button to turn on your camera.",
      "Please click Allow when browser asks for camera permission.",
      "The camera view will appear in the centre of the screen once ready.",
      "To switch cameras or turn the camera off, open the Camera menu at the top right.",
    ],
  },
  {
    targetId: "cam-tour-ai",
    alsoTargetIds: ["cam-tour-camera"],
    title: "Status Indicators",
    placement: "below",
    graphic: "status",
    cardW: 560,
    lines: [
      "AI (top right of the camera view) — a green dot means movement detection is ready.",
      "An orange dot means it is still loading. Start camera and Start session stay unavailable until it turns green.",
      "Camera (top right of the page) — a green dot means your camera is on.",
    ],
  },
  {
    targetId: "cam-tour-column",
    title: "Your Assigned Exercise",
    placement: "left",
    graphic: "exercise",
    cardW: 560,
    lines: [
      "This card shows the exercise assigned to you by your therapist.",
      "Use the left ( ‹ ) and right ( › ) arrows to move between exercises.",
      "The exercise name, sets, reps, and rest time are displayed in the card.",
      "Make sure you select the right exercise before starting your session.",
      "Below the card, the Reference Guide shows an animated example when one is available — press the full-screen button to see it larger. Your therapist's instructions come first.",
    ],
  },
  {
    targetId: "cam-tour-feed",
    anchorId: "cam-tour-metrics",
    title: "Camera View — Position Yourself Here",
    placement: "right",
    graphic: "position",
    cardW: 580,
    lines: [
      "Stand or sit about 2–3 metres (7–10 feet) from the camera.",
      "Make sure your body — head to knees — is visible on screen.",
      "A green skeleton outline appears when the app can track you correctly.",
    ],
  },
  {
    targetId: "cam-tour-metrics",
    title: "Live Metrics Panel",
    placement: "right",
    lines: [
      "This panel shows your movement angles in real time.",
      "You do not need to read every number — the on-screen cues will guide you.",
      "A coloured warning means your posture needs a small adjustment.",
      "The score at the top summarises your overall form for each frame.",
    ],
  },
  {
    // No real element — targetId won't be found, card falls back to centered
    targetId: "cam-tour-clothing",
    title: "Clothing & Environment Tips",
    placement: "below",
    graphic: "environment",
    cardW: 760,
    lines: [
      "Wear light or contrasting colours — dark clothing on a dark background makes it hard for the AI to track your joints.",
      "Avoid wearing very loose clothing — it can hide your joints from the camera.",
      "Face the light source (window or lamp). A bright light behind you silhouettes your body and reduces tracking accuracy.",
      "Clear the area behind you — plain or lightly patterned walls work best. Busy wallpaper or moving objects confuse the system.",
      "Make sure the room is well lit. Low light causes the camera to produce noise that reduces pose detection quality.",
    ],
  },
  {
    targetId: "cam-tour-session",
    title: "Start Session & End",
    placement: "left",
    graphic: "session",
    cardW: 600,
    lines: [
      "Press Start session when you are ready.",
      "A 3-2-1 countdown gives you time to get into position before counting begins.",
      "Press End at any time to stop the exercise early — your progress is still saved.",
      "After finishing all sets, the session saves automatically and is sent to your therapist.",
      "Not happy with your performance? Press Restart button to redo the exercise — your therapist will see the latest attempt.",
    ],
  },
];

/** Keyframes for the spotlight ring and the step illustrations. */
const TOUR_KEYFRAMES = `
  @keyframes tour-pulse {
    0%, 100% { box-shadow: 0 0 0 3px oklch(0.55 0.07 200 / 0.25), 0 0 14px oklch(0.55 0.07 200 / 0.31); }
    50%      { box-shadow: 0 0 0 6px oklch(0.55 0.07 200 / 0.15), 0 0 24px oklch(0.55 0.07 200 / 0.44); }
  }
  @keyframes gfx-rays { 0%, 100% { opacity: .35; } 50% { opacity: .95; } }
  @keyframes gfx-chev-a { 0%, 46% { background: white; border-color: oklch(0.90 0.003 240); } 50%, 96% { background: oklch(0.95 0.02 200); border-color: oklch(0.55 0.07 200); } }
  @keyframes gfx-chev-b { 0%, 46% { background: oklch(0.95 0.02 200); border-color: oklch(0.55 0.07 200); } 50%, 96% { background: white; border-color: oklch(0.90 0.003 240); } }
  @keyframes cd-3 { 0%, 22% { opacity: 1; } 28%, 100% { opacity: 0; } }
  @keyframes cd-2 { 0%, 28% { opacity: 0; } 34%, 55% { opacity: 1; } 61%, 100% { opacity: 0; } }
  @keyframes cd-1 { 0%, 61% { opacity: 0; } 67%, 88% { opacity: 1; } 94%, 100% { opacity: 0; } }
  @keyframes cd-go { 0%, 88% { opacity: 0; } 94%, 100% { opacity: 1; } }
  @keyframes gfx-pip { 0%, 100% { box-shadow: 0 0 8px oklch(0.82 0.20 195 / 0.7); } 50% { box-shadow: 0 0 14px oklch(0.82 0.20 195 / 0.9); } }
  @keyframes gfx-btn { 0%, 100% { box-shadow: 0 0 0 0 oklch(0.55 0.07 200 / 0.45); } 50% { box-shadow: 0 0 0 5px oklch(0.55 0.07 200 / 0); } }
  @keyframes gfx-cursor { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-2px, -2px); } }
  @keyframes gfx-amber { 0%, 100% { box-shadow: 0 0 0 3px oklch(0.72 0.15 70 / 0.14); } 50% { box-shadow: 0 0 0 6px oklch(0.72 0.15 70 / 0.30); } }
  @keyframes gfx-joint { 0%, 100% { opacity: .25; } 50% { opacity: .7; } }
  @media (prefers-reduced-motion: reduce) {
    .cam-tour-ring, .cam-tour-gfx * { animation: none !important; }
  }
`;

type TourGraphicKind = "start" | "status" | "exercise" | "position" | "environment" | "session";

function CameraTour({
  step,
  onNext,
  onBack,
  onGoTo,
  onClose,
}: {
  step: number;
  onNext: () => void;
  onBack: () => void;
  onGoTo: (i: number) => void;
  onClose: () => void;
}) {
  const total = TOUR_STEPS.length;
  const def = TOUR_STEPS[step];

  const [rect, setRect] = useState<DOMRect | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [extraRects, setExtraRects] = useState<DOMRect[]>([]);
  // Joined into a string so the effect reruns when the ids change, not on every render.
  const extraTargetKey = (def.alsoTargetIds ?? []).join(" ");

  useEffect(() => {
    const refresh = () => {
      const el = document.getElementById(def.targetId);
      setRect(el ? el.getBoundingClientRect() : null);
      const anchor = def.anchorId ? document.getElementById(def.anchorId) : null;
      setAnchorRect(anchor ? anchor.getBoundingClientRect() : null);
      setExtraRects(
        extraTargetKey
          .split(" ")
          .filter(Boolean)
          .flatMap((id) => {
            const extra = document.getElementById(id);
            return extra ? [extra.getBoundingClientRect()] : [];
          }),
      );
    };
    refresh();
    window.addEventListener("resize", refresh);
    return () => window.removeEventListener("resize", refresh);
  }, [def.targetId, def.anchorId, extraTargetKey]);

  const PAD = 8; // spotlight padding around target
  const EDGE = 8; // smallest gap between the card and the viewport edge
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const pad = (r: DOMRect | null) =>
    r
      ? {
          x: r.left - PAD,
          y: r.top - PAD,
          w: r.width + PAD * 2,
          h: r.height + PAD * 2,
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
        }
      : null;
  // Spotlight rings — targetId, plus any further elements the step points out
  const spots = [rect, ...extraRects]
    .map(pad)
    .filter((s): s is NonNullable<ReturnType<typeof pad>> => s !== null);
  // Card anchor — anchorId when provided, otherwise targetId, otherwise the first
  // further element (the Start camera button is absent while the camera is on)
  const anchor = pad(anchorRect ?? rect ?? extraRects[0] ?? null);

  // The illustration sits beside the text. When the screen cannot fit both, it
  // is left out and the card keeps the original text-only width.
  const maxW = Math.max(280, vw - EDGE * 2);
  // The clothing and environment illustration uses two columns.
  const wideGraphic = def.graphic === "environment";
  const graphicW = wideGraphic ? 348 : 208;
  const graphic =
    def.graphic && Math.min(def.cardW ?? 560, maxW) - 48 - graphicW >= 240 ? def.graphic : undefined;
  const cardW = Math.min(graphic ? (def.cardW ?? 560) : 360, maxW);
  const clampLeft = (x: number) => Math.max(EDGE, Math.min(x, vw - cardW - EDGE));

  // The card sits in a fixed column that owns its vertical span, so flex layout
  // keeps it inside the viewport however tall it renders. Beside a target, two
  // weighted spacers slide it along the column in proportion to the anchor's
  // height on screen; the arrow, placed at the same fraction of the card, then
  // meets the anchor's centre without measuring the card.
  const track: CSSProperties = {
    position: "fixed",
    zIndex: 62,
    width: cardW,
    left: clampLeft((vw - cardW) / 2),
    top: EDGE,
    bottom: EDGE,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    pointerEvents: "none",
  };
  let arrowSide: "top" | "bottom" | "left" | "right" | null = null;
  let arrowAt = "50%";
  let spacers: [number, number] | null = null;
  if (anchor) {
    if (def.placement === "below" || def.placement === "above") {
      const left = clampLeft(anchor.cx - cardW / 2);
      track.left = left;
      arrowAt = `${Math.max(22, Math.min(anchor.cx - left, cardW - 22))}px`;
      // A card that would not fit on its preferred side moves to the roomier
      // one. The height is an estimate used only for that choice; the track
      // still scrolls a card that is taller than the space it gets.
      const estH = graphic ? (wideGraphic ? 470 : 410) : 290;
      const gapAbove = def.aboveGap ?? 16;
      const roomBelow = vh - EDGE - (anchor.y + anchor.h + 16);
      const roomAbove = anchor.y - gapAbove - EDGE;
      const below =
        def.placement === "below"
          ? roomBelow >= estH || roomBelow >= roomAbove
          : roomAbove < estH && roomBelow > roomAbove;
      if (below) {
        const top = Math.min(anchor.y + anchor.h + 16, Math.max(EDGE, vh - 180));
        track.top = top;
        track.justifyContent = "flex-start";
        // No arrow when the card has had to overlap its target.
        if (top >= anchor.y + anchor.h) arrowSide = "top";
      } else {
        track.bottom = Math.max(EDGE, vh - anchor.y + gapAbove);
        track.justifyContent = "flex-end";
        arrowSide = "bottom";
      }
    } else {
      const left = clampLeft(def.placement === "right" ? anchor.x + anchor.w + 16 : anchor.x - cardW - 16);
      track.left = left;
      const t = Math.max(0, Math.min(1, (anchor.cy - EDGE) / Math.max(1, vh - EDGE * 2)));
      const before = Math.round(t * 1000);
      spacers = [before, 1000 - before];
      arrowAt = `clamp(22px, ${(t * 100).toFixed(2)}%, calc(100% - 22px))`;
      if (def.placement === "right" ? left >= anchor.x + anchor.w : left + cardW <= anchor.x) {
        arrowSide = def.placement === "right" ? "left" : "right";
      }
    }
  }

  const ARROW = 10;
  const arrowEl: Record<"top" | "bottom" | "left" | "right", CSSProperties> = {
    top: {
      position: "absolute", top: -ARROW, left: arrowAt,
      transform: "translateX(-50%)",
      width: 0, height: 0,
      borderLeft: `${ARROW}px solid transparent`,
      borderRight: `${ARROW}px solid transparent`,
      borderBottom: `${ARROW}px solid ${ACCENT.hex}`,
    },
    bottom: {
      position: "absolute", bottom: -ARROW, left: arrowAt,
      transform: "translateX(-50%)",
      width: 0, height: 0,
      borderLeft: `${ARROW}px solid transparent`,
      borderRight: `${ARROW}px solid transparent`,
      borderTop: `${ARROW}px solid ${ACCENT.hex}`,
    },
    left: {
      position: "absolute", left: -ARROW, top: arrowAt,
      transform: "translateY(-50%)",
      width: 0, height: 0,
      borderTop: `${ARROW}px solid transparent`,
      borderBottom: `${ARROW}px solid transparent`,
      borderRight: `${ARROW}px solid ${ACCENT.hex}`,
    },
    right: {
      position: "absolute", right: -ARROW, top: arrowAt,
      transform: "translateY(-50%)",
      width: 0, height: 0,
      borderTop: `${ARROW}px solid transparent`,
      borderBottom: `${ARROW}px solid transparent`,
      borderLeft: `${ARROW}px solid ${ACCENT.hex}`,
    },
  };

  return (
    <>
      {/* Dim overlay with a transparent cutout via SVG */}
      <svg
        style={{ position: "fixed", inset: 0, zIndex: 60, pointerEvents: "none" }}
        width="100%"
        height="100%"
      >
        <defs>
          <mask id="tour-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {spots.map((s, i) => (
              <rect
                key={i}
                x={s.x} y={s.y}
                width={s.w} height={s.h}
                rx={8} ry={8}
                fill="black"
              />
            ))}
          </mask>
        </defs>
        <rect
          width="100%" height="100%"
          fill="rgba(0,0,0,0.45)"
          mask="url(#tour-spotlight-mask)"
        />
      </svg>

      {/* Pulsing highlight ring around each target */}
      {spots.map((s, i) => (
        <div
          key={i}
          className="cam-tour-ring"
          style={{
            position: "fixed",
            zIndex: 61,
            left: s.x, top: s.y,
            width: s.w, height: s.h,
            borderRadius: 8,
            border: `2px solid ${ACCENT.hex}`,
            pointerEvents: "none",
            animation: "tour-pulse 1.6s ease-in-out infinite",
          }}
        />
      ))}

      {/* Backdrop click to close */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 60 }}
        onClick={onClose}
      />

      {/* Tooltip card */}
      <div style={track}>
        {spacers && <div style={{ flex: `${spacers[0]} 0 0px` }} />}
        <div
          role="dialog"
          aria-labelledby="camera-tour-title"
          style={{
            position: "relative",
            flex: "0 1 auto",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            pointerEvents: "auto",
          }}
        >
          {/* Arrow, outside the scrolling card so it is not clipped */}
          {arrowSide && <div style={arrowEl[arrowSide]} />}

          <div style={{
            flex: "0 1 auto",
            minHeight: 0,
            overflowY: "auto",
            background: "white",
            borderRadius: 14,
            boxShadow: "0 12px 40px oklch(0 0 0 / 0.22)",
            // Rendered outside the page wrapper, so it sets its own text colour:
            // the inherited body colour turns near-white under a dark system theme.
            color: "oklch(0.18 0.01 240)",
          }}>
            {/* Header */}
            <div style={{
              background: ACCENT.hex,
              padding: "14px 16px 12px",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 8,
            }}>
              <div>
                <div style={{
                  fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".14em",
                  textTransform: "uppercase", color: "oklch(0.95 0.02 200)", marginBottom: 3,
                }}>
                  Step {step + 1} of {total}
                </div>
                <div id="camera-tour-title" style={{ fontSize: 15, fontWeight: 700, color: "white", lineHeight: 1.25 }}>
                  {def.title}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close tour"
                style={{
                  flexShrink: 0, width: 24, height: 24,
                  border: "1px solid oklch(0.95 0.02 200 / 0.35)",
                  background: "oklch(0.95 0.02 200 / 0.12)",
                  borderRadius: 6, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "white",
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* Body: the step's lines, with its illustration beside them */}
            <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "flex-start", gap: 16 }}>
              <ul style={{
                margin: 0, padding: 0, listStyle: "none",
                display: "flex", flexDirection: "column", gap: 7,
                flex: "1 1 0", minWidth: 0,
              }}>
                {def.lines.map((line, i) => (
                  <li key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{
                      flexShrink: 0, marginTop: 6,
                      width: 6, height: 6, borderRadius: 99,
                      background: ACCENT.hex,
                    }} />
                    <span style={{ fontSize: 12.5, color: "oklch(0.22 0.01 240)", lineHeight: 1.55 }}>{line}</span>
                  </li>
                ))}
              </ul>
              {graphic && <TourGraphic kind={graphic} />}
            </div>

            {/* Footer */}
            <div style={{
              padding: "10px 16px 14px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              {/* Step dots */}
              <div style={{ display: "flex", gap: 5 }}>
                {Array.from({ length: total }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onGoTo(i); }}
                    aria-label={`Go to step ${i + 1}`}
                    style={{
                      width: i === step ? 18 : 7, height: 7,
                      borderRadius: 99,
                      background: i === step ? ACCENT.hex : "oklch(0.88 0.003 240)",
                      border: "none", cursor: "pointer", padding: 0,
                      transition: "width .18s, background .18s",
                    }}
                  />
                ))}
              </div>

              {/* Nav buttons */}
              <div style={{ display: "flex", gap: 6 }}>
                {step > 0 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onBack(); }}
                    style={{
                      padding: "5px 13px",
                      border: "1px solid oklch(0.90 0.003 240)",
                      background: "white", borderRadius: 7,
                      fontSize: 12, fontWeight: 500,
                      color: "oklch(0.35 0.01 240)", cursor: "pointer",
                    }}
                  >Back</button>
                )}
                {step < total - 1 ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onNext(); }}
                    style={{
                      padding: "5px 14px",
                      border: `1px solid ${ACCENT.hex}`,
                      background: ACCENT.hex, borderRadius: 7,
                      fontSize: 12, fontWeight: 600,
                      color: "white", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 5,
                    }}
                  >
                    Next
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" aria-hidden="true">
                      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                    </svg>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onClose(); }}
                    style={{
                      padding: "5px 14px",
                      border: `1px solid ${ACCENT.hex}`,
                      background: ACCENT.hex, borderRadius: 7,
                      fontSize: 12, fontWeight: 600,
                      color: "white", cursor: "pointer",
                    }}
                  >Got it!</button>
                )}
              </div>
            </div>
          </div>
        </div>
        {spacers && <div style={{ flex: `${spacers[1]} 0 0px` }} />}
      </div>

      {/* Keyframes for the ring and the illustrations */}
      <style>{TOUR_KEYFRAMES}</style>
    </>
  );
}

/**
 * The small illustration beside a tour step: what to click, how to read the
 * status dots, how to switch exercises, where to stand, clothing and lighting,
 * and what happens after Start session. Decorative only; each point it shows
 * is also stated in the step's text.
 */
function TourGraphic({ kind }: { kind: TourGraphicKind }) {
  const column: CSSProperties = { flex: "0 0 208px", width: 208, display: "flex", flexDirection: "column", gap: 8 };
  const label: CSSProperties = {
    fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: ".18em",
    textTransform: "uppercase", color: "oklch(0.50 0.01 240)",
  };
  const panel: CSSProperties = {
    border: "1px solid oklch(0.93 0.003 240)", borderRadius: 8,
    background: "oklch(0.985 0.003 240)", padding: 10,
  };
  const verdict = (tone: "ok" | "bad" | "warn", text: string) => {
    const colors = {
      ok: { bg: "oklch(0.96 0.04 145)", line: "oklch(0.88 0.06 145)", ink: "oklch(0.40 0.07 145)", mark: "✓" },
      bad: { bg: "oklch(0.96 0.04 25)", line: "oklch(0.88 0.08 25)", ink: "oklch(0.45 0.14 25)", mark: "✗" },
      warn: { bg: "oklch(0.96 0.05 80)", line: "oklch(0.86 0.09 70)", ink: "oklch(0.48 0.12 60)", mark: "!" },
    }[tone];
    return (
      <div style={{ flex: "1 1 auto", padding: "5px 8px", display: "flex", alignItems: "center", gap: 5, background: colors.bg, borderTop: `1px solid ${colors.line}` }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: colors.ink }}>{colors.mark}</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 8, letterSpacing: ".1em", textTransform: "uppercase", color: colors.ink, fontWeight: 600 }}>
          {text}
        </span>
      </div>
    );
  };
  const downArrow = (
    <div style={{ display: "flex", justifyContent: "center", color: "oklch(0.72 0.01 240)" }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
        <line x1="12" y1="4" x2="12" y2="19"/><polyline points="6 13 12 19 18 13"/>
      </svg>
    </div>
  );
  const figure = (head: CSSProperties, body: CSSProperties) => (
    <div style={{ position: "absolute", left: "50%", top: 16, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <div style={{ width: 15, height: 15, borderRadius: 999, ...head }} />
      <div style={{ borderRadius: "8px 8px 3px 3px", ...body }} />
    </div>
  );
  const ray = (position: CSSProperties, width: number, deg: number, origin: string, delay: number) => (
    <div style={{
      position: "absolute", ...position, width, height: 1.5,
      background: "oklch(0.80 0.12 90)",
      transform: `rotate(${deg}deg)`, transformOrigin: origin,
      animation: `gfx-rays 2.6s ease-in-out ${delay}s infinite`,
    }} />
  );
  const joint: CSSProperties = {
    position: "absolute", width: 5, height: 5, borderRadius: 999,
    background: "oklch(0.82 0.20 195)", boxShadow: "0 0 6px oklch(0.82 0.20 195 / 0.8)",
  };
  const lostJoint: CSSProperties = {
    position: "absolute", width: 5, height: 5, borderRadius: 999,
    border: "1px dashed oklch(0.72 0.15 70)",
  };
  const digit: CSSProperties = {
    position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
    fontFamily: "var(--mono)", fontSize: 20, fontWeight: 700, color: "oklch(0.35 0.06 200)",
  };

  if (kind === "start") {
    const cameraGlyph = (size: number) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/>
        <path d="M17 10.5l5-3v9l-5-3"/>
      </svg>
    );
    return (
      <div className="cam-tour-gfx" style={column}>
        <div style={label}>What to click</div>
        <div style={{ ...panel, padding: 8, display: "flex", flexDirection: "column", gap: 5 }}>
          {/* The camera view while the camera is off, with its Start camera button. */}
          <div style={{ height: 40, borderRadius: 6, background: "oklch(0.22 0.01 240)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 5, background: ACCENT.hex, color: "white", fontSize: 9, fontWeight: 600, animation: "gfx-btn 2.2s ease-out infinite" }}>
              {cameraGlyph(10)}
              Start camera
              <svg width="13" height="13" viewBox="0 0 24 24" fill="white" stroke="oklch(0.25 0.01 240)" strokeWidth="1.6" aria-hidden="true" style={{ position: "absolute", right: -7, bottom: -9, animation: "gfx-cursor 2.2s ease-in-out infinite" }}>
                <path d="M5 3l14 8-6 1.5L10 19z"/>
              </svg>
            </span>
          </div>
          {downArrow}
          <div style={{ padding: "6px 8px", background: "white", border: "1px solid oklch(0.90 0.003 240)", borderRadius: 6, boxShadow: "0 2px 6px oklch(0 0 0 / 0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5, color: "oklch(0.35 0.01 240)" }}>
              {cameraGlyph(10)}
              <span style={{ fontSize: 9.5, color: "oklch(0.25 0.01 240)", fontWeight: 500 }}>Use your camera?</span>
            </div>
            <div style={{ display: "flex", gap: 5 }}>
              <span style={{ flex: 1, textAlign: "center", padding: "3px 0", border: "1px solid oklch(0.90 0.003 240)", borderRadius: 4, fontSize: 9, color: "oklch(0.45 0.01 240)" }}>Block</span>
              <span style={{ flex: 1, textAlign: "center", padding: "3px 0", border: `1px solid ${ACCENT.hex}`, background: "oklch(0.95 0.02 200)", borderRadius: 4, fontSize: 9, color: "oklch(0.30 0.06 200)", fontWeight: 600 }}>Allow</span>
            </div>
          </div>
          {downArrow}
          {/* The live view that follows. */}
          <div style={{ border: "1px solid oklch(0.88 0.06 145)", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ position: "relative", height: 40, background: "linear-gradient(oklch(0.36 0.01 240), oklch(0.26 0.01 240))" }}>
              <div style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <div style={{ width: 12, height: 12, borderRadius: 999, background: "oklch(0.70 0.02 240)" }} />
                <div style={{ width: 30, height: 20, borderRadius: "10px 10px 0 0", background: "oklch(0.70 0.02 240)" }} />
              </div>
            </div>
            {verdict("ok", "Camera view appears")}
          </div>
        </div>
      </div>
    );
  }

  if (kind === "status") {
    const aiChip = (ready: boolean) => (
      <span style={{
        position: "absolute", top: 6, right: 6,
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 6px", borderRadius: 999,
        background: "oklch(0.16 0.01 240 / 0.72)", border: "1px solid oklch(1 0 0 / 0.18)",
        color: "white", fontSize: 8.5, fontWeight: 700, letterSpacing: ".04em",
      }}>
        AI
        <span style={ready
          ? { width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: "oklch(0.72 0.17 145)", boxShadow: "0 0 0 2px oklch(0.72 0.17 145 / 0.3)" }
          : { width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: "oklch(0.78 0.15 75)", animation: "gfx-amber 2s ease-in-out infinite" }}
        />
      </span>
    );
    const cameraView = (ready: boolean) => (
      <div style={{ position: "relative", height: 44, background: "oklch(0.22 0.01 240)" }}>
        {aiChip(ready)}
      </div>
    );
    return (
      <div className="cam-tour-gfx" style={column}>
        <div style={label}>Reading the dots</div>
        <div style={{ border: "1px solid oklch(0.88 0.06 145)", borderRadius: 8, overflow: "hidden" }}>
          {/* The page header's Camera menu above the camera view's AI indicator. */}
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "5px 6px", background: "white", borderBottom: "1px solid oklch(0.93 0.003 240)" }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 7px", borderRadius: 999,
              background: "oklch(0.96 0.04 145)", border: "1px solid oklch(0.88 0.06 145)",
              color: "oklch(0.38 0.07 145)", fontSize: 8.5, fontWeight: 600,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: 999, background: "oklch(0.62 0.13 145)", boxShadow: "0 0 0 2px oklch(0.62 0.13 145 / 0.22)" }} />
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/>
                <path d="M17 10.5l5-3v9l-5-3"/>
              </svg>
              Camera
              <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </span>
          </div>
          {cameraView(true)}
          {verdict("ok", "Both green — ready to start")}
        </div>
        <div style={{ border: "1px solid oklch(0.86 0.09 70)", borderRadius: 8, overflow: "hidden" }}>
          {cameraView(false)}
          {verdict("warn", "Orange — AI still loading")}
        </div>
      </div>
    );
  }

  if (kind === "exercise") {
    const chevron = (d: string, animation: string, active: boolean) => (
      <div style={{
        width: 26, flexShrink: 0, borderRadius: 6,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "oklch(0.35 0.06 200)",
        border: `1px solid ${active ? ACCENT.hex : "oklch(0.90 0.003 240)"}`,
        background: active ? "oklch(0.95 0.02 200)" : "white",
        animation,
      }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
          <path d={d}/>
        </svg>
      </div>
    );
    return (
      <div className="cam-tour-gfx" style={column}>
        <div style={label}>Switching exercises</div>
        <div style={{ ...panel, display: "flex", alignItems: "stretch", gap: 6 }}>
          {chevron("M15 18l-6-6 6-6", "gfx-chev-a 2.8s ease-in-out infinite", false)}
          <div style={{ flex: 1, minWidth: 0, padding: "8px 9px", borderRadius: 6, border: "1px solid oklch(0.95 0.02 200)", background: "white" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 8, letterSpacing: ".14em", textTransform: "uppercase", color: "oklch(0.35 0.06 200)", fontWeight: 600 }}>
              Exercise 2 / 4
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "oklch(0.18 0.01 240)", marginTop: 2, lineHeight: 1.2 }}>
              Shoulder Shrugs
            </div>
          </div>
          {chevron("M9 18l6-6-6-6", "gfx-chev-b 2.8s ease-in-out infinite", true)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--mono)", fontSize: 9.5, color: "oklch(0.50 0.01 240)", paddingLeft: 2 }}>
          <span>3 sets</span>
          <span style={{ color: "oklch(0.85 0.003 240)" }}>·</span>
          <span>12 reps</span>
          <span style={{ color: "oklch(0.85 0.003 240)" }}>·</span>
          <span>60s rest</span>
        </div>
        <div style={{ ...label, marginTop: 4 }}>Watching the guide</div>
        <div style={{ ...panel, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 7.5, fontWeight: 600, letterSpacing: ".14em", textTransform: "uppercase", color: "oklch(0.40 0.01 240)" }}>
              Reference Guide
            </span>
            <span style={{
              position: "relative", width: 18, height: 18, flexShrink: 0, borderRadius: 5,
              border: `1px solid ${ACCENT.hex}`, background: "oklch(0.95 0.02 200)", color: "oklch(0.35 0.06 200)",
              display: "flex", alignItems: "center", justifyContent: "center",
              animation: "gfx-btn 2.2s ease-out infinite",
            }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>
              </svg>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="oklch(0.25 0.01 240)" strokeWidth="1.6" aria-hidden="true" style={{ position: "absolute", right: -7, bottom: -9, animation: "gfx-cursor 2.2s ease-in-out infinite" }}>
                <path d="M5 3l14 8-6 1.5L10 19z"/>
              </svg>
            </span>
          </div>
          {/* A generic, still figure standing for the guide's picture; it shows no movement. */}
          <svg viewBox="0 0 184 64" style={{ display: "block", width: "100%", height: 64, borderRadius: 5, background: "linear-gradient(oklch(0.50 0.01 240), oklch(0.38 0.01 240))" }} aria-hidden="true">
            <g fill="oklch(0.88 0.01 240)">
              <circle cx="92" cy="13" r="6" />
              <rect x="85" y="20" width="14" height="22" rx="5" />
            </g>
            <g stroke="oklch(0.88 0.01 240)" strokeWidth={4} strokeLinecap="round">
              <line x1="86" y1="23" x2="81" y2="41" />
              <line x1="98" y1="23" x2="103" y2="41" />
              <line x1="89" y1="41" x2="88" y2="60" />
              <line x1="95" y1="41" x2="96" y2="60" />
            </g>
          </svg>
          <div style={{ fontSize: 8, lineHeight: 1.35, color: "oklch(0.50 0.01 240)" }}>
            {"Animated guide with illustrative timing. Your therapist's instructions come first."}
          </div>
        </div>
      </div>
    );
  }

  if (kind === "position") {
    const person = (x: number, ink: string, opacity: number) => (
      <g fill={ink} opacity={opacity}>
        <circle cx={x} cy={24} r={6} />
        <rect x={x - 5} y={31} width={10} height={22} rx={4} />
        <rect x={x - 3.5} y={52} width={7} height={30} rx={3} />
      </g>
    );
    // Side view: the camera on its stand at the left, the wedge it can see, and
    // the person twice over, faint in full and solid where the camera sees them.
    const sideView = (clipId: string, personX: number, ink: string, fov: string, textInk: string, distance: string) => (
      <svg viewBox="0 0 168 92" style={{ display: "block", width: "100%", height: "auto", aspectRatio: "168 / 92", background: "oklch(0.985 0.003 240)" }} aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <polygon points="29,26 164,-8 164,84" />
          </clipPath>
        </defs>
        <line x1="0" y1="82.5" x2="168" y2="82.5" stroke="oklch(0.86 0.005 240)" />
        <polygon points="29,26 164,-8 164,84" fill={fov} fillOpacity={0.13} />
        <g stroke={fov} strokeWidth={0.9} strokeDasharray="3 3">
          <line x1="29" y1="26" x2="164" y2="-8" />
          <line x1="29" y1="26" x2="164" y2="84" />
        </g>
        <g stroke="oklch(0.45 0.01 240)" strokeWidth={1.5} strokeLinecap="round">
          <line x1="18" y1="31" x2="18" y2="82" />
          <line x1="18" y1="71" x2="12" y2="82" />
          <line x1="18" y1="71" x2="24" y2="82" />
        </g>
        <rect x="9" y="21" width="17" height="10" rx="2" fill="oklch(0.30 0.01 240)" />
        <circle cx="27" cy="26" r="2.4" fill="oklch(0.82 0.20 195)" />
        {person(personX, ink, 0.25)}
        <g clipPath={`url(#${clipId})`}>{person(personX, ink, 1)}</g>
        <g stroke={textInk} strokeWidth={0.9}>
          <line x1="29" y1="88" x2={personX - 7} y2="88" />
          <line x1="29" y1="85.5" x2="29" y2="90.5" />
          <line x1={personX - 7} y1="85.5" x2={personX - 7} y2="90.5" />
        </g>
        <text x={(22 + personX) / 2} y="79" textAnchor="middle" fill={textInk} style={{ fontFamily: "var(--mono)", fontSize: 7.5, fontWeight: 600 }}>
          {distance}
        </text>
      </svg>
    );
    return (
      <div className="cam-tour-gfx" style={column}>
        <div style={label}>Side view</div>
        <div style={{ border: "1px solid oklch(0.88 0.06 145)", borderRadius: 8, overflow: "hidden" }}>
          {sideView("tour-gfx-fov-good", 128, "oklch(0.45 0.06 200)", "oklch(0.65 0.13 145)", "oklch(0.40 0.07 145)", "2–3 m")}
          {verdict("ok", "2–3 m, head to knees")}
        </div>
        <div style={{ border: "1px solid oklch(0.88 0.08 25)", borderRadius: 8, overflow: "hidden" }}>
          {sideView("tour-gfx-fov-close", 62, "oklch(0.55 0.17 25)", "oklch(0.58 0.17 25)", "oklch(0.45 0.14 25)", "< 2 m")}
          {verdict("bad", "Too close — knees cut off")}
        </div>
      </div>
    );
  }

  if (kind === "environment") {
    const tile = (tone: "ok" | "bad", scene: React.ReactNode, text: string) => (
      <div style={{
        display: "flex", flexDirection: "column",
        border: `1px solid ${tone === "ok" ? "oklch(0.88 0.06 145)" : "oklch(0.88 0.08 25)"}`,
        borderRadius: 8, overflow: "hidden",
      }}>
        {scene}
        {verdict(tone, text)}
      </div>
    );
    // One row per tip, with the good example beside the poor one.
    const topic = (text: string, first = false) => (
      <div style={{ ...label, gridColumn: "1 / -1", marginTop: first ? 0 : 4 }}>{text}</div>
    );
    const fitScene = (children: React.ReactNode) => (
      <svg viewBox="0 0 168 92" style={{ display: "block", width: "100%", height: 92, flexShrink: 0, background: "oklch(0.94 0.004 240)" }} aria-hidden="true">
        {children}
      </svg>
    );
    const trackedJoints: [number, number][] = [[76, 30], [92, 30], [68, 44], [100, 44], [80, 54], [88, 54], [79, 70], [89, 70]];
    const hiddenJoints: [number, number][] = [[76, 30], [92, 30], [62, 49], [106, 49], [74, 77], [94, 77]];
    return (
      <div className="cam-tour-gfx" style={{ flex: "0 0 348px", width: 348, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", alignContent: "start" }}>
        {topic("Clothing contrast", true)}
        {tile(
          "ok",
          <div style={{ position: "relative", height: 92, flexShrink: 0, background: "oklch(0.34 0.012 250)" }}>
            {figure({ background: "oklch(0.93 0.015 90)" }, { width: 30, height: 36, background: "oklch(0.93 0.015 90)" })}
            <div style={{ position: "absolute", left: "50%", top: 36, transform: "translateX(-50%)", width: 30, height: 22 }}>
              <span style={{ ...joint, left: -1, top: 0 }} />
              <span style={{ ...joint, right: -1, top: 0 }} />
              <span style={{ position: "absolute", left: "50%", top: 1, transform: "translateX(-50%)", width: 22, height: 1.5, background: "oklch(0.82 0.20 195)" }} />
              <span style={{ position: "absolute", left: "50%", top: 3, transform: "translateX(-50%)", width: 1.5, height: 16, background: "oklch(0.82 0.20 195)" }} />
              <span style={{ ...joint, left: "50%", bottom: 0, transform: "translateX(-50%)" }} />
            </div>
          </div>,
          "Light on dark — joints found",
        )}
        {tile(
          "bad",
          <div style={{ position: "relative", height: 92, flexShrink: 0, background: "oklch(0.32 0.012 250)" }}>
            {figure({ background: "oklch(0.27 0.014 255)" }, { width: 30, height: 36, background: "oklch(0.27 0.014 255)" })}
            <div style={{ position: "absolute", left: "50%", top: 36, transform: "translateX(-50%)", width: 30, height: 22, animation: "gfx-joint 2.6s ease-in-out infinite" }}>
              <span style={{ ...lostJoint, left: -1, top: 0 }} />
              <span style={{ ...lostJoint, right: -1, top: 0 }} />
              <span style={{ ...lostJoint, left: "50%", bottom: 0, transform: "translateX(-50%)" }} />
            </div>
          </div>,
          "Dark on dark — joints lost",
        )}

        {topic("Clothing fit")}
        {tile(
          "ok",
          fitScene(
            <>
              <g stroke="oklch(0.45 0.06 200)" strokeLinecap="round" strokeLinejoin="round" fill="none">
                <path d="M76 30 L68 44 L64 57" strokeWidth={5} />
                <path d="M92 30 L100 44 L104 57" strokeWidth={5} />
                <path d="M80 54 L79 70 L78 86" strokeWidth={6} />
                <path d="M88 54 L89 70 L90 86" strokeWidth={6} />
              </g>
              <rect x="75" y="26" width="18" height="30" rx="6" fill="oklch(0.45 0.06 200)" />
              <circle cx="84" cy="16" r="7" fill="oklch(0.45 0.06 200)" />
              <g fill="oklch(0.82 0.20 195)" style={{ filter: "drop-shadow(0 0 2px oklch(0.82 0.20 195 / 0.9))" }}>
                {trackedJoints.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={2.3} />)}
              </g>
            </>,
          ),
          "Fitted — joints visible",
        )}
        {tile(
          "bad",
          fitScene(
            <>
              <path d="M67 63 L101 63 L106 88 L89 88 L84 73 L79 88 L62 88 Z" fill="oklch(0.50 0.03 250)" />
              <path d="M74 23 Q84 27 94 23 L113 47 L106 58 L99 45 L102 65 L66 65 L69 45 L62 58 L55 47 Z" fill="oklch(0.58 0.03 250)" />
              <circle cx="84" cy="16" r="7" fill="oklch(0.45 0.02 250)" />
              <g fill="none" stroke="oklch(0.72 0.15 70)" strokeWidth={1.1} strokeDasharray="2 1.5" style={{ animation: "gfx-joint 2.6s ease-in-out infinite" }}>
                {hiddenJoints.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={3.2} />)}
              </g>
            </>,
          ),
          "Very loose — joints hidden",
        )}

        {topic("Light & background")}
        {tile(
          "ok",
          <div style={{ position: "relative", height: 92, flexShrink: 0, background: "oklch(0.94 0.004 240)" }}>
            {figure(
              { background: "oklch(0.90 0.02 90)", border: "1.5px solid oklch(0.45 0.02 240)" },
              { width: 28, height: 34, background: "oklch(0.90 0.02 90)", border: "1.5px solid oklch(0.45 0.02 240)" },
            )}
            <div style={{ position: "absolute", left: 10, bottom: 8, width: 14, height: 14, borderRadius: 999, background: "oklch(0.85 0.14 90)", boxShadow: "0 0 10px oklch(0.85 0.14 90 / 0.8)" }} />
            {ray({ left: 26, bottom: 22 }, 46, -24, "left center", 0)}
            {ray({ left: 26, bottom: 16 }, 52, -12, "left center", 0.3)}
            {ray({ left: 26, bottom: 11 }, 44, 0, "left center", 0.6)}
          </div>,
          "Light in front, plain wall",
        )}
        {tile(
          "bad",
          <div style={{ position: "relative", height: 92, flexShrink: 0, background: "repeating-linear-gradient(125deg, oklch(0.62 0.02 240) 0 6px, oklch(0.52 0.03 260) 6px 12px)" }}>
            {figure({ background: "oklch(0.28 0.01 240)" }, { width: 28, height: 34, background: "oklch(0.28 0.01 240)" })}
            <div style={{ position: "absolute", right: 10, top: 8, width: 14, height: 14, borderRadius: 999, background: "oklch(0.85 0.14 90)", boxShadow: "0 0 12px oklch(0.85 0.14 90 / 0.9)" }} />
            {ray({ right: 26, top: 22 }, 44, 24, "right center", 0)}
            {ray({ right: 26, top: 30 }, 50, 12, "right center", 0.3)}
          </div>,
          "Backlit, dark on busy wall",
        )}
      </div>
    );
  }

  // kind === "session"
  return (
    <div className="cam-tour-gfx" style={column}>
      <div style={label}>What happens next</div>
      <div style={{ ...panel, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ flex: 1, padding: "7px 8px", borderRadius: 5, background: ACCENT.hex, border: `1px solid ${ACCENT.hex}`, color: "white", fontSize: 10, fontWeight: 500, textAlign: "center" }}>
            Start session
          </div>
          <div style={{ padding: "7px 12px", borderRadius: 5, background: "white", border: "1px solid oklch(0.90 0.003 240)", color: "oklch(0.30 0.01 240)", fontSize: 10, fontWeight: 500, textAlign: "center" }}>
            End
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ position: "relative", width: 46, height: 46, borderRadius: 999, border: "2px solid oklch(0.90 0.003 240)", background: "white", flexShrink: 0 }}>
            {/* The later digits start hidden, so without animation only the 3 shows. */}
            <div style={{ ...digit, animation: "cd-3 3.6s linear infinite" }}>3</div>
            <div style={{ ...digit, opacity: 0, animation: "cd-2 3.6s linear infinite" }}>2</div>
            <div style={{ ...digit, opacity: 0, animation: "cd-1 3.6s linear infinite" }}>1</div>
            <div style={{ ...digit, opacity: 0, fontSize: 11, letterSpacing: ".08em", color: "oklch(0.40 0.07 145)", animation: "cd-go 3.6s linear infinite" }}>GO</div>
          </div>
          <div style={{ fontSize: 10.5, lineHeight: 1.45, color: "oklch(0.40 0.01 240)" }}>
            A 3-2-1 countdown runs before counting starts.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", gap: 4 }}>
            <span style={{ flex: 1, height: 8, borderRadius: 4, background: "oklch(0.82 0.20 195)", animation: "gfx-pip 2.4s ease-in-out infinite" }} />
            <span style={{ flex: 1, height: 8, borderRadius: 4, background: "oklch(0.90 0.08 195)" }} />
            <span style={{ flex: 1, height: 8, borderRadius: 4, background: "oklch(0.92 0.003 240)" }} />
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 8, letterSpacing: ".12em", textTransform: "uppercase", color: "oklch(0.50 0.01 240)" }}>
            Set 1 of 3 — saved as you go
          </div>
        </div>
      </div>
    </div>
  );
}

function metricWarnLabel(name: MetricName): string {
  switch (name) {
    case "neckTilt":            return "NECK TILT";
    case "shoulderSymmetry":    return "SHOULDER";
    case "trunkLean":           return "TRUNK";
    case "scapularElevation":   return "SHRUG";
    case "elbowFlexion":        return "ARMS";
    default:                    return "COMPENSATION";
  }
}

function ClinicalScoreRow({ score, tier }: { score: number | null; tier: ScoreTier }) {
  return (
    <div style={{
      padding: "16px 16px",
      borderBottom: "1px solid oklch(0.93 0.003 240)",
      background: "oklch(0.985 0.003 240)",
      position: "relative",
    }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: tier.hex }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{
          fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em",
          textTransform: "uppercase", color: "oklch(0.40 0.01 240)", fontWeight: 600,
        }}>Posture Score</span>
        <span style={{
          fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".14em",
          textTransform: "uppercase", color: tier.text, fontWeight: 600,
        }}>{tier.label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 10 }}>
        <span style={{
          fontFamily: "var(--mono)", fontSize: 44, fontWeight: 500,
          letterSpacing: "-0.03em",
          color: score === null ? "oklch(0.75 0.01 240)" : "oklch(0.18 0.01 240)",
          fontVariantNumeric: "tabular-nums", lineHeight: 1,
        }}>{score ?? "—"}</span>
        <span style={{ fontSize: 16, color: "oklch(0.55 0.01 240)", fontFamily: "var(--mono)" }}>/100</span>
      </div>
      <div style={{ height: 4, background: "oklch(0.92 0.003 240)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${score ?? 0}%`, background: tier.hex,
          transition: "width .4s ease, background .4s ease",
        }} />
      </div>
    </div>
  );
}

function ClinicalMetricRow({ card }: { card: CardSpec }) {
  const compareDirection = card.compareDirection ?? "above";
  const isFlag =
    card.kind === "compensation" &&
    card.warningThreshold !== undefined &&
    !card.suppressWarning &&
    card.warningActive === true &&
    card.value !== null;

  const displayValue =
    card.value === null
      ? "—"
      : Math.abs(card.value).toFixed(card.isAngle ? 1 : 3);
  const warnLabel = metricWarnLabel(card.metric);
  const warningText = compareDirection === "below" ? "Below threshold" : "Above threshold";

  return (
    <div style={{
      padding: "14px 16px",
      paddingLeft: isFlag ? 14 : 16,
      display: "grid",
      gridTemplateColumns: "1fr auto",
      alignItems: "center",
      gap: 12,
      borderBottom: "1px solid oklch(0.93 0.003 240)",
      borderLeft: isFlag ? "2px solid oklch(0.70 0.16 65)" : "2px solid transparent",
      background: isFlag ? "oklch(0.98 0.02 75)" : "transparent",
      transition: "background .2s, border-color .2s",
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em",
          textTransform: "uppercase", color: "oklch(0.30 0.01 240)",
          marginBottom: 4, fontWeight: 600,
        }}>
          <span>{card.label}</span>
          {isFlag && (
            <span style={{
              fontFamily: "var(--mono)", fontSize: 8.5, letterSpacing: ".18em",
              color: "oklch(0.45 0.10 65)", background: "white",
              border: "1px solid oklch(0.70 0.16 65)",
              padding: "1px 5px", borderRadius: 3,
            }}>{warnLabel}</span>
          )}
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 6, fontSize: 11,
          fontFamily: "var(--mono)", letterSpacing: ".04em",
          color: isFlag ? "oklch(0.45 0.10 65)" : "oklch(0.45 0.06 145)",
        }}>
          <span style={{
            display: "inline-block",
            width: 5, height: 5, borderRadius: 999,
            background: isFlag ? "oklch(0.70 0.16 65)" : "oklch(0.65 0.13 145)",
          }} />
          {card.kind === "primary" ? "Primary metric" : isFlag ? warningText : "Within range"}
        </div>
      </div>
      <div style={{
        fontVariantNumeric: "tabular-nums", fontSize: 28, fontWeight: 500,
        letterSpacing: "-0.02em",
        color: card.value === null
          ? "oklch(0.75 0.01 240)"
          : isFlag ? "oklch(0.45 0.10 65)" : "oklch(0.18 0.01 240)",
        fontFamily: "var(--mono)",
      }}>
        {displayValue}
      </div>
    </div>
  );
}

type CameraStatus = "off" | "starting" | "on";

/**
 * The camera menu in the header. The dot left of the camera icon shows whether
 * the camera is on; a click opens the camera settings. Whether the pose model
 * is ready has its own "AI" indicator on the camera view.
 */
function CameraStatusButton({
  status,
  open,
  onToggle,
}: {
  status: CameraStatus;
  open: boolean;
  onToggle: () => void;
}) {
  const tone =
    status === "on"
      ? { background: "oklch(0.96 0.04 145)", border: "oklch(0.88 0.06 145)", dot: "oklch(0.62 0.13 145)", halo: "oklch(0.62 0.13 145 / 0.22)", text: "oklch(0.38 0.07 145)" }
      : status === "starting"
        ? { background: "oklch(0.97 0.05 75)", border: "oklch(0.86 0.09 70)", dot: "oklch(0.70 0.16 65)", halo: "oklch(0.70 0.16 65 / 0.25)", text: "oklch(0.42 0.11 60)" }
        : { background: "oklch(0.96 0.004 240)", border: "oklch(0.90 0.004 240)", dot: "oklch(0.72 0.01 240)", halo: "oklch(0.72 0.01 240 / 0.25)", text: "oklch(0.42 0.01 240)" };
  const cameraState = status === "on" ? "on" : status === "starting" ? "starting" : "off";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={`Camera settings (camera ${cameraState})`}
      title={`Camera ${cameraState}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 12px",
        borderRadius: 999,
        background: tone.background,
        border: `1px solid ${tone.border}`,
        color: tone.text,
        fontFamily: "var(--sans)",
        fontSize: 14,
        fontWeight: 600,
        whiteSpace: "nowrap",
        cursor: "pointer",
      }}
    >
      <span aria-hidden="true" style={{
        width: 10,
        height: 10,
        flexShrink: 0,
        borderRadius: 999,
        background: tone.dot,
        boxShadow: `0 0 0 3px ${tone.halo}`,
      }} />
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 6h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/>
        <path d="M17 10.5l5-3v9l-5-3"/>
      </svg>
      <span>Camera</span>
      <svg
        width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"
        style={{ marginLeft: 2, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}
      >
        <path d="M6 9l6 6 6-6"/>
      </svg>
    </button>
  );
}

type FormCheckState = "warning" | "clear" | "setup" | "paused";

/**
 * Neutral form-check status beside the camera view. It never names a movement
 * or says how to correct one — cue wording and the overlay labels still await
 * physiotherapist review — so the warning state only points at the highlight
 * the overlay is already drawing.
 */
function FormCheckCard({
  state,
  isometric,
}: {
  state: FormCheckState;
  isometric: boolean;
}) {
  const warning = state === "warning";
  const title =
    state === "warning"
      ? "Check the highlighted area"
      : state === "clear"
        ? "No form warnings"
        : state === "setup"
          ? "Setting up"
          : "Form checks paused";
  const body =
    state === "warning"
      ? `Look at the highlight on your camera view. ${isometric ? "Your hold time still counts." : "Your reps still count."}`
      : state === "clear"
        ? "If something needs attention, it will be highlighted on your camera view."
        : state === "setup"
          ? "Form checks start once setup finishes."
          : "Form checks resume when the camera can see you clearly.";
  return (
    <div style={{
      padding: 20,
      borderRadius: 12,
      background: warning ? "oklch(0.97 0.05 75)" : "white",
      border: warning ? "2px solid oklch(0.70 0.16 65)" : "1px solid oklch(0.93 0.003 240)",
    }}>
      <div style={{ ...EYEBROW_STYLE, marginBottom: 8, color: warning ? "oklch(0.42 0.11 60)" : "oklch(0.42 0.01 240)" }}>
        Form check
      </div>
      <div style={{
        marginBottom: 6,
        fontSize: 26,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        lineHeight: 1.2,
        color: warning ? "oklch(0.30 0.09 60)" : "oklch(0.22 0.01 240)",
      }}>
        {title}
      </div>
      <div style={{ fontSize: 17, lineHeight: 1.45, color: warning ? "oklch(0.38 0.07 60)" : "oklch(0.42 0.01 240)" }}>
        {body}
      </div>
    </div>
  );
}

/**
 * Keyframes for RollingNumber: a digit rolls up into place when its count rises
 * and back down when it falls, overshooting a touch before it settles, like the
 * number wheels of a mechanical cash register. With reduced motion the digits
 * change in place.
 */
const ROLLING_NUMBER_CSS = `
  .cam-wheel-in-up, .cam-wheel-out-up, .cam-wheel-in-down, .cam-wheel-out-down {
    animation-duration: 520ms;
    animation-timing-function: cubic-bezier(0.25, 1.45, 0.45, 1);
    animation-fill-mode: both;
  }
  .cam-wheel-in-up { animation-name: cam-wheel-in-up; }
  .cam-wheel-out-up { animation-name: cam-wheel-out-up; }
  .cam-wheel-in-down { animation-name: cam-wheel-in-down; }
  .cam-wheel-out-down { animation-name: cam-wheel-out-down; }
  @keyframes cam-wheel-in-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
  @keyframes cam-wheel-out-up { from { transform: translateY(0); } to { transform: translateY(-100%); } }
  @keyframes cam-wheel-in-down { from { transform: translateY(-100%); } to { transform: translateY(0); } }
  @keyframes cam-wheel-out-down { from { transform: translateY(0); } to { transform: translateY(100%); } }
  @media (prefers-reduced-motion: reduce) {
    .cam-wheel-in-up, .cam-wheel-in-down { animation: none; }
    .cam-wheel-out-up, .cam-wheel-out-down { display: none; }
  }
`;

/** Keeps text available to screen readers while it is drawn some other way. */
const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/**
 * A count drawn as cash-register number wheels. When the value changes, each
 * digit that differs rolls to its new number, up for a rising count and down
 * for a falling one, and each moving wheel starts a beat after the one to its
 * right. Digits sit right-aligned in at least `minDigits` wheels, so a count
 * passing 9 does not shift the layout. A hidden copy of the text sizes the
 * wheels and carries the text baseline, so the number lines up with the labels
 * beside it exactly as plain text did.
 */
function RollingNumber({ value, minDigits = 1 }: { value: number; minDigits?: number }) {
  const text = String(value);
  const [shown, setShown] = useState(text);
  const [roll, setRoll] = useState<{ from: string; up: boolean; turn: number } | null>(null);
  if (text !== shown) {
    // React's pattern for responding to a changed prop: adjust state while rendering.
    setShown(text);
    setRoll({ from: shown, up: value > Number(shown), turn: (roll?.turn ?? 0) + 1 });
  }

  const width = Math.max(minDigits, text.length, roll ? roll.from.length : 0);
  const to = text.padStart(width, " ");
  const from = roll ? roll.from.padStart(width, " ") : to;
  const direction = roll?.up ? "up" : "down";
  const turn = roll?.turn ?? 0;
  const moving = Array.from(to, (digit, i) => roll !== null && from[i] !== digit);
  // Moving wheels start right to left, 70 ms apart.
  const delays = moving.map((isMoving, i) =>
    isMoving ? moving.slice(i + 1).filter(Boolean).length * 70 : 0,
  );

  return (
    <span style={{ position: "relative", display: "inline-block", whiteSpace: "pre" }}>
      <span aria-hidden="true" style={{ visibility: "hidden" }}>{to}</span>
      <span aria-hidden="true" style={{ position: "absolute", inset: 0, display: "flex", overflow: "hidden" }}>
        {Array.from(to, (digit, i) =>
          moving[i] ? (
            <span key={`${turn}-${i}`} style={{ position: "relative", display: "block" }}>
              <span className={`cam-wheel-in-${direction}`} style={{ display: "block", animationDelay: `${delays[i]}ms` }}>
                {digit}
              </span>
              <span className={`cam-wheel-out-${direction}`} style={{ position: "absolute", left: 0, top: 0, animationDelay: `${delays[i]}ms` }}>
                {from[i]}
              </span>
            </span>
          ) : (
            <span key={`wheel-${i}`} style={{ display: "block" }}>{digit}</span>
          ),
        )}
      </span>
      <span style={VISUALLY_HIDDEN}>{text}</span>
    </span>
  );
}

/**
 * The page's original set progress strip, now on the session card: where the
 * patient is in the session, one pip per set, and the whole session as a bar.
 * The set number rolls like the counts on the camera view.
 */
function SessionProgressStrip({
  phase,
  setNumber,
  completedSets,
  sets,
  progressPct,
  setUnderway,
}: {
  phase: SessionState;
  setNumber: number;
  completedSets: number;
  sets: number;
  progressPct: number;
  /** A set is being counted right now, which lights the current pip. */
  setUnderway: boolean;
}) {
  const prefix =
    phase === "countdown" ? "Starting set " : phase === "resting" ? "Rest — next: Set " : "Set ";
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 8,
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid oklch(0.92 0.003 240)",
      background: "oklch(0.985 0.003 240)",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: "oklch(0.40 0.01 240)",
        }}>
          {prefix}<RollingNumber value={setNumber} minDigits={String(sets).length} /> of {sets}
        </span>
        <span style={{
          fontFamily: "var(--mono)",
          fontSize: 13,
          fontWeight: 600,
          color: "oklch(0.20 0.01 240)",
          fontVariantNumeric: "tabular-nums",
        }}>
          {progressPct}%
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", gap: 5, flex: "0 1 auto", minWidth: 0 }}>
          {Array.from({ length: sets }).map((_, i) => {
            const done = i < completedSets;
            const current = i === completedSets;
            const lit = done || (current && setUnderway);
            return (
              <span key={i} style={{
                width: 28,
                flexShrink: 1,
                minWidth: 6,
                height: 10,
                borderRadius: 5,
                boxSizing: "border-box",
                background: done ? NEON.hex : current ? NEON.dim : "oklch(0.92 0.003 240)",
                boxShadow: lit ? `0 0 8px ${NEON.glow}, 0 0 3px ${NEON.glow}` : "none",
                outline: current && setUnderway ? `1px solid ${NEON.hex}` : "none",
                transition: "background .3s, box-shadow .3s",
              }} />
            );
          })}
        </div>
        <div style={{ flex: "1 1 60px", height: 10, borderRadius: 5, background: "oklch(0.93 0.003 240)" }}>
          <div style={{
            height: "100%",
            width: `${progressPct}%`,
            borderRadius: 5,
            background: NEON.hex,
            boxShadow: progressPct > 0 ? `0 0 10px ${NEON.glow}, 0 0 4px ${NEON.glow}` : "none",
            transition: "width .4s, box-shadow .3s",
          }} />
        </div>
      </div>
    </div>
  );
}

/**
 * Rep, set and time readouts drawn over the camera view: a row across the
 * bottom with its two panels pushed to the corners, so the patient's body and
 * the overlay stay clear. Painted with a flat translucent fill (no backdrop
 * blur) to keep compositing cheap while the pose loop runs. The labels keep the
 * camera page's original stat-strip wording. Rep counts and the set number
 * roll like cash-register wheels when they change.
 */
function CameraSetHud({
  activeDefinition, repCounts, holdState, timer, prescription, currentSetIdx, compact,
}: {
  activeDefinition: ExerciseDefinition;
  repCounts: { left: number; right: number };
  holdState: {
    pairedSec: number;
    leftSec: number;
    rightSec: number;
    leftInBand: boolean;
    rightInBand: boolean;
  };
  timer: string;
  prescription: Prescription;
  currentSetIdx: number;
  compact: boolean;
}) {
  const panelSt: CSSProperties = {
    padding: compact ? "8px 12px" : "12px 18px",
    borderRadius: 12,
    background: "oklch(0.16 0.01 240 / 0.78)",
    border: "1px solid oklch(1 0 0 / 0.10)",
    color: "white",
  };
  const labelSt: CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 6,
    fontFamily: "var(--mono)",
    fontSize: compact ? 11 : 13,
    fontWeight: 700,
    letterSpacing: ".18em",
    textTransform: "uppercase",
    color: "oklch(0.82 0.01 240)",
  };
  const suffixSt: CSSProperties = {
    fontSize: compact ? 11 : 12,
    fontWeight: 500,
    letterSpacing: "normal",
    textTransform: "none",
    color: "oklch(0.76 0.01 240)",
  };
  const numSt: CSSProperties = {
    fontFamily: "var(--mono)",
    fontSize: compact ? 34 : "clamp(40px, 6.4vh, 64px)",
    fontWeight: 600,
    lineHeight: 1,
    letterSpacing: "-0.03em",
    fontVariantNumeric: "tabular-nums",
  };
  const captionSt: CSSProperties = {
    marginTop: 6,
    fontFamily: "var(--mono)",
    fontSize: compact ? 11 : 12,
    fontWeight: 600,
    letterSpacing: ".14em",
    textTransform: "uppercase",
    color: "oklch(0.80 0.01 240)",
  };
  const sideSt: CSSProperties = {
    fontFamily: "var(--mono)",
    fontSize: compact ? 11 : 13,
    fontWeight: 700,
    letterSpacing: ".18em",
    textTransform: "uppercase",
    color: "oklch(0.80 0.01 240)",
  };
  const rowSt: CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: compact ? 8 : 12,
  };
  const separator = (
    <span style={{ fontSize: compact ? 18 : 24, fontWeight: 300, color: "oklch(0.62 0.01 240)" }}>·</span>
  );
  // Sides are shown separately and never merged: the asymmetry between them is
  // the signal. A side outside the prescription is still shown, marked as
  // observation only.
  const sideCell = (label: "L" | "R", value: React.ReactNode, done: boolean, observation: boolean) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
      <span style={sideSt}>{label}{observation ? " · observation" : ""}</span>
      <span style={{ ...numSt, color: done ? NEON.hex : "white" }}>{value}</span>
    </div>
  );
  const repDigits = String(prescription.reps).length;
  const seconds = (value: number) => (
    <>
      {value}
      <span style={{ fontSize: compact ? 16 : 22, fontWeight: 500 }}>s</span>
    </>
  );

  let primary: React.ReactNode;
  if (activeDefinition.kind === "isometric" && activeDefinition.bilateral) {
    const leftSec = Math.floor(holdState.leftSec);
    const rightSec = Math.floor(holdState.rightSec);
    primary = (
      <>
        <div style={labelSt}>
          <span>Hold</span>
          <span style={suffixSt}>/ {prescription.holdSeconds}s side</span>
        </div>
        <div style={rowSt}>
          {sideCell("L", seconds(leftSec), leftSec >= prescription.holdSeconds, prescription.prescribedSide === "right")}
          {separator}
          {sideCell("R", seconds(rightSec), rightSec >= prescription.holdSeconds, prescription.prescribedSide === "left")}
        </div>
      </>
    );
  } else if (activeDefinition.kind === "isometric") {
    const holdSec = Math.floor(holdState.pairedSec);
    const done = holdSec >= prescription.holdSeconds;
    primary = (
      <>
        <div style={labelSt}><span>Hold</span></div>
        <div style={{ ...numSt, color: done ? NEON.hex : "white" }}>{formatElapsedTime(holdSec)}</div>
        <div style={captionSt}>target {prescription.holdSeconds}s</div>
      </>
    );
  } else if (activeDefinition.bilateral) {
    primary = (
      <>
        <div style={labelSt}>
          <span>Reps</span>
          <span style={suffixSt}>/ {prescription.reps}</span>
        </div>
        <div style={rowSt}>
          {sideCell("L", <RollingNumber value={repCounts.left} minDigits={repDigits} />, repCounts.left >= prescription.reps, prescription.prescribedSide === "right")}
          {separator}
          {sideCell("R", <RollingNumber value={repCounts.right} minDigits={repDigits} />, repCounts.right >= prescription.reps, prescription.prescribedSide === "left")}
        </div>
      </>
    );
  } else {
    const singleReps = repCounts.left + repCounts.right;
    primary = (
      <>
        <div style={labelSt}>
          <span>Reps</span>
          <span style={suffixSt}>/ {prescription.reps}</span>
        </div>
        <div style={{ ...numSt, color: singleReps >= prescription.reps ? NEON.hex : "white" }}><RollingNumber value={singleReps} minDigits={repDigits} /></div>
      </>
    );
  }

  return (
    <div style={{
      alignSelf: "stretch",
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 10,
      pointerEvents: "none",
    }}>
      <div style={panelSt}>{primary}</div>
      <div style={panelSt}>
        <div style={labelSt}><span>Time</span></div>
        <div style={{ ...numSt, whiteSpace: "nowrap" }}>{timer}</div>
        <div style={captionSt}>Set <RollingNumber value={currentSetIdx} minDigits={String(prescription.sets).length} /> / {prescription.sets}</div>
      </div>
    </div>
  );
}

/** The guide keeps missing-media fallback local to the selected clip. */
function DemoCard({ exerciseId, compact }: { exerciseId: string | null; compact: boolean }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const clip = demoClipFor(exerciseId);
  const shownClip = clip !== null && clip.src !== failedSrc ? clip : null;
  return (
    <div id="cam-tour-demo" style={{ ...CARD_STYLE, flex: "0 1 auto", minHeight: 0,
      display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
      <span style={{ ...EYEBROW_STYLE, fontSize: 14 }}>Reference Guide</span>
      {shownClip ? (
        <DemoClipPlayer key={shownClip.src} clip={shownClip} compact={compact} onError={() => setFailedSrc(shownClip.src)} />
      ) : (
        <div style={{ minHeight: 150, height: compact ? 260 : 300, padding: 24, borderRadius: 10,
          display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
          background: "oklch(0.24 0.01 240)", color: "oklch(0.90 0.01 240)", fontSize: 13, lineHeight: 1.5 }}>
          No verified demonstration video is published for this exercise yet.
          Follow the written exercise description and your therapist&apos;s instructions.
        </div>
      )}
    </div>
  );
}

function StaffStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        marginBottom: 2,
        fontFamily: "var(--mono)",
        fontSize: 9,
        letterSpacing: ".14em",
        textTransform: "uppercase",
        color: "oklch(0.50 0.01 240)",
      }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "oklch(0.25 0.01 240)", overflowWrap: "anywhere" }}>
        {value}
      </div>
    </div>
  );
}

function ClinicalSettingRow({
  label, sub, on, onChange,
}: {
  label: string;
  sub: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0",
    }}>
      <div>
        <div style={{ fontSize: 12, color: "oklch(0.22 0.01 240)", fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11, color: "oklch(0.55 0.01 240)" }}>{sub}</div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!on)}
        role="switch"
        aria-checked={on}
        style={{
          width: 32, height: 18, borderRadius: 999,
          background: on ? ACCENT.hex : "oklch(0.88 0.003 240)",
          border: "none", padding: 2, cursor: "pointer",
          position: "relative", transition: "background .15s", flexShrink: 0,
        }}
      >
        <div style={{
          width: 14, height: 14, borderRadius: 999, background: "white",
          transform: `translateX(${on ? 14 : 0}px)`,
          transition: "transform .15s",
          boxShadow: "0 1px 2px rgba(0,0,0,.15)",
        }}/>
      </button>
    </div>
  );
}

/**
 * Format a non-negative second count as `MM:SS` with zero-padded fields.
 * Lets the minute count grow past 59 (e.g., `90:00` for 90 minutes).
 */
function formatElapsedTime(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function metricLabel(name: MetricName): string {
  switch (name) {
    case "shoulderAbduction":      return "SHOULDER ABD";
    case "shoulderFlexion":        return "SHOULDER FLEX";
    case "scapularElevation":      return "SHRUG";
    case "neckLateralFlexion":     return "NECK FLEX";
    case "trunkLateralFlexion":    return "TRUNK FLEX";
    case "shoulderHorizAbd":       return "T-POSE";
    case "neckTilt":               return "NECK TILT";
    case "shoulderSymmetry":       return "SHOULDER SYM";
    case "trunkLean":              return "TRUNK LEAN";
    case "elbowFlexion":           return "ELBOW FLEX";
    case "wristShoulderVertical":  return "OVERHEAD";
    case "shoulderElbowDistance":  return "ELBOW POS";
    case "hipShift":               return "HIP SHIFT";
    case "elbowBend":              return "ELBOW BEND";
  }
}

function metricUsesDegrees(name: MetricName): boolean {
  return (
    name !== "scapularElevation" &&
    name !== "wristShoulderVertical" &&
    name !== "shoulderElbowDistance"
  );
}

function CameraHomeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" style={{ width: 16, height: 16, flexShrink: 0 }} viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
    </svg>
  );
}
