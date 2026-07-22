"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/lib/ToastContext";
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

import { evaluateCaptureReadiness, type FramingMode } from "@/lib/pose/captureReadiness";
import { drawCutoutOverlay } from "@/lib/pose/drawFramingOverlay";
import { drawCompensationOverlay } from "@/lib/pose/drawCompensationOverlay";
import {
  computePoseMetricsForExercise,
  computeCompensationScore,
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
} from "@/lib/pose/poseMetrics";
import {
  updateCompensationWarningMap,
  type CompensationWarningLatch,
} from "@/lib/pose/compensationWarningState";
import {
  getCompensationScoring,
  getExerciseDefinition,
  type ExerciseDefinition,
  type MetricName,
} from "@/lib/exercises/registry";
import { DEPRECATED_EXERCISE_IDS } from "@/lib/exercises/deprecated";
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
  type DynamicRepQualityV1,
  type RepQualityChannel,
} from "@/lib/pose/repQuality";

type CamDevice = MediaDeviceInfo;

type AssignmentStatus = "pending" | "in_progress" | "completed";
type EndSessionPersistenceResult = "saved" | "pending" | "skipped" | "failed";

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
  /**
   * Assignment status from `patient_exercises.status` via
   * `/api/patient-exercises` (patient assignments only). Drives the
   * "already completed" recap overlay + stepper pill when the patient returns
   * to a finished exercise. Undefined for the staff debug catalog.
   */
  status?: AssignmentStatus;
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
  exerciseKind: "dynamic" | "isometric" | null;
  endedAt: string | null;
  durationMs: number | null;
  setCount: number;
  leftReps: number;
  rightReps: number;
  completeLeftReps: number;
  completeRightReps: number;
  avgPeakValue: number | null;
  totalPairedHoldMs: number | null;
  totalTargetHoldMs: number | null;
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
  return value === "pending" || value === "in_progress" || value === "completed"
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
};

// A resumable session older than this (by last snapshot write) is not offered —
// avoids resuming a days-old still-open session.
const RESUME_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

const resumeKey = (patientExerciseId: number) =>
  `postural.resume.v1.${patientExerciseId}`;

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
type SessionState = "idle" | "countdown" | "active" | "resting" | "ended";

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
  terminatedBy: "min_reached" | "user" | "capture_lost" | "stall";
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
};

const DEFAULT_PRESCRIPTION: Prescription = { sets: 3, reps: 12, restSeconds: 60, holdSeconds: 30 };

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
  compensations: DynamicRepQualityV1;
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
 * Raw per-frame metric payload for the tuning trace (`upper_body_v2`).
 * Extends the original ex_007-only `ex_007_upper_body_v1` payload with the
 * metrics the other active exercises need (neck/trunk signed flexion,
 * horizontal abduction) plus a snapshot of the in-session baselines, so the
 * offline analysis can reproduce the values the live score sees:
 *   - scapularElevation as scored = baseline − raw (per side)
 *   - ex_005 primary as counted   = |uncorrected signed − bidirectional baseline|
 * All metric values are RAW/unsmoothed (pre One Euro), captured only on
 * capture-ready frames. No image/video data, ever.
 */
type UpperBodyTraceMetrics = {
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
    cameraTiltDeg: number;
    confidence: ExerciseFrameMetrics["tiltReference"]["confidence"];
    divergenceDeg: number | null;
  };
};

/**
 * One raw metric-only frame shaped for the `/raw-frames` write API. The
 * landmark payload is deliberately limited to upper-body analysis points plus
 * hips (needed for the trunk-relative coordinate frame); no image/video data.
 * `ex_007_upper_body_v1` rows (the original ex_007-only trace) remain in the
 * table; this client only writes `upper_body_v2`.
 */
type RawFramePayload = {
  frameIndex: number;
  setIndex: number;
  elapsedMs: number;
  capturedAt: string;
  traceKind: "upper_body_v2";
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
type HoldSideQuality = {
  meanDeg: number;
  sdDeg: number;
  meanErrorDeg: number;
  droopSlopeDegPerSec: number;
};

/**
 * Set-level hold-quality summary for an isometric hold. Aggregates per-frame raw
 * signals the camera loop already computes; persisted to `set_events.hold_quality`.
 */
type HoldQuality = {
  sampleCount: number;
  leftInBandMs: number;
  rightInBandMs: number;
  outOfPositionMs: number;          // active time NOT both-in-band
  dropCount: number;                // both-in-band → not transitions
  longestPairedStreakMs: number;    // longest continuous both-in-band run
  settleMs: number | null;          // set start → first both-in-band (null if never)
  left: HoldSideQuality | null;
  right: HoldSideQuality | null;
  meanCompensationScore: number | null;
  minCompensationScore: number | null;
};

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
  // Isometric only; absent for dynamic sets.
  holdQuality?: HoldQuality;
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
  }
}

const MAX_NECK_REP_DEBUG_RECORDS = 3000;
const MAX_EX005_DEBUG_RECORDS = 2000;
const EX005_DEBUG_THROTTLE_MS = 250;
const RAW_FRAME_UPLOAD_BATCH_SIZE = 120;
const BASELINE_SAMPLE_COUNT = 90; // ~3 s at 30 fps
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
  exerciseId: string,
  baselines: UpperBodyTraceMetrics["baselines"],
  baselinePhase: UpperBodyTraceMetrics["baselinePhase"],
): UpperBodyTraceMetrics {
  const tilt = raw.tiltReference;
  const trunkLean = computeTrunkLateralLean(landmarks, tilt);
  const shoulderSymmetry = computeShoulderSymmetry(landmarks, tilt);
  const neckTilt = computeLateralNeckTilt(landmarks, tilt);
  return {
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
      confidence: tilt.confidence,
      divergenceDeg: finiteNumberOrNull(tilt.divergenceDeg),
    },
  };
}

// ── Clinical design constants ────────────────────────────────────────────────

const ACCENT = {
  hex:  "oklch(0.55 0.07 200)",
  soft: "oklch(0.95 0.02 200)",
  text: "oklch(0.35 0.06 200)",
};

// Bright "glowing neon" palette, used only by the session progress strip
// (set pips + overall progress bar) to make completion state pop. Kept
// separate from ACCENT so the rest of the clinical UI stays restrained.
const NEON = {
  hex:  "oklch(0.82 0.20 195)",        // bright neon cyan fill
  glow: "oklch(0.82 0.20 195 / 0.7)",  // box-shadow glow color
  dim:  "oklch(0.90 0.08 195)",        // current/upcoming set tint
};

type ScoreTier = { hex: string; soft: string; text: string; label: string };

function scoreTier(score: number | null): ScoreTier {
  if (score == null) return { hex: "oklch(0.75 0.01 240)", soft: "oklch(0.95 0.005 240)", text: "oklch(0.55 0.01 240)", label: "calibrating" };
  if (score >= 80)   return { hex: "oklch(0.62 0.11 145)", soft: "oklch(0.96 0.04 145)", text: "oklch(0.40 0.07 145)", label: "in range" };
  if (score >= 60)   return { hex: "oklch(0.70 0.12 80)",  soft: "oklch(0.96 0.04 80)",  text: "oklch(0.42 0.09 75)",  label: "borderline" };
  if (score >= 40)   return { hex: "oklch(0.65 0.15 50)",  soft: "oklch(0.96 0.05 50)",  text: "oklch(0.43 0.12 45)",  label: "compensating" };
  return             { hex: "oklch(0.58 0.17 25)",  soft: "oklch(0.96 0.04 25)",  text: "oklch(0.45 0.14 25)",  label: "poor form" };
}

function clinicalNavBtnStyle(): CSSProperties {
  return {
    width: 36,
    border: "1px solid oklch(0.90 0.003 240)",
    background: "white",
    borderRadius: 8,
    color: "oklch(0.35 0.01 240)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  };
}

type CardSpec = {
  key: MetricName;
  label: string;
  value: number | null;
  kind: "primary" | "compensation";
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
  const { showToast } = useToast();
  const dashboardHref =
    user?.role === "admin" ? "/dashboard/admin"
    : user?.role === "therapist" ? "/dashboard/therapist"
    : "/dashboard/patient";

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const requestRef = useRef<number | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);

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

  const tiltFilterRef = useRef(new OneEuroFilter(1.0, 0.1));
  const metricFiltersRef = useRef<Map<MetricName, OneEuroFilter>>(new Map());
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
  const lastMetricsUpdateRef = useRef(0);
  const compensationWarningLatchesRef = useRef<Map<MetricName, CompensationWarningLatch>>(
    new Map(),
  );
  const [activeCompensationWarnings, setActiveCompensationWarnings] = useState<Set<MetricName>>(
    new Set(),
  );
  const resetCompensationWarnings = useCallback(() => {
    compensationWarningLatchesRef.current.clear();
    setActiveCompensationWarnings(new Set());
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
  const [error, setError] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);

  // Capture readiness (HTML overlay, never mirrored)
  const [captureOk, setCaptureOk] = useState(true);
  const [captureMessage, setCaptureMessage] = useState("Captured");

  // Resting-baseline phase. "capturing" while the per-side baseline samples
  // are being accumulated, "captured" once both sides have enough samples,
  // "not-needed" for exercises whose primary metric is already baseline-
  // relative (everything except scapularElevation today).
  //
  // The ref is what predictWebcam reads — the rAF chain holds a stale
  // closure on the React state, mirroring the lastCaptureOkRef pattern
  // used for captureOk. The state is only for re-rendering the JSX banner.
  type BaselinePhase = "not-needed" | "capturing" | "captured";
  const baselinePhaseRef = useRef<BaselinePhase>("not-needed");
  const [baselinePhase, setBaselinePhaseState] = useState<BaselinePhase>("not-needed");
  const [baselineProgress, setBaselineProgress] = useState({
    samples: 0,
    required: BASELINE_SAMPLE_COUNT,
  });
  const setBaselinePhase = useCallback((phase: BaselinePhase) => {
    baselinePhaseRef.current = phase;
    setBaselinePhaseState(phase);
  }, []);

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

  const [currentTime, setCurrentTime] = useState<string>("");
  const [viewportWidth, setViewportWidth] = useState(1280);

  const searchParams = useSearchParams();
  const initialExerciseId = searchParams.get("exerciseId") ?? "";

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
  const [actionableExerciseIds, setActionableExerciseIds] = useState<Set<string>>(new Set());
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
   *  - `pendingSetEventsRef` / `pendingRepEventsRef` — outcomes buffered since
   *    the last flush. Flushed at each set completion and at session end.
   *    Persistence is best-effort: all writes are fire-and-forget and never
   *    block rep counting, hold accumulation, or the UI.
   */
  const sessionIdRef = useRef<number | null>(null);
  const sessionWallStartMsRef = useRef<number>(0);
  const sessionPerfStartMsRef = useRef<number>(0);
  const globalRepIndexRef = useRef<number>(0);
  const pendingSetEventsRef = useRef<SetEventPayload[]>([]);
  const pendingRepEventsRef = useRef<RepEventPayload[]>([]);
  const rawFrameIndexRef = useRef<number>(0);
  const pendingRawFramesRef = useRef<RawFramePayload[]>([]);
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
    (completed?: boolean, endReason?: "user") => Promise<EndSessionPersistenceResult>
  >(() => Promise.resolve("skipped"));
  /**
   * If an end (notably the End button) fires before the session create resolves,
   * there's no row yet to PATCH — stash the intended end reason here so the
   * create's stale-close path can record it. Without this, a fast End on a slow
   * create leaves `end_reason` NULL and the dashboard mislabels the attempt as
   * "In Progress" instead of "Ended Early". Reset on each start and after use.
   */
  const pendingStaleEndReasonRef = useRef<"user" | undefined>(undefined);

  // Capture-quality tally for the current session (→ sessions.capture_quality_summary).
  // Counts frames processed while the session is active and how many had OK
  // capture readiness, so the dashboard can distinguish a genuinely low-ROM
  // session from one degraded by poor tracking/framing. Reset on session start.
  const captureFramesTotalRef = useRef<number>(0);
  const captureFramesOkRef = useRef<number>(0);

  /** Reset all in-memory session-persistence state (no DB call). */
  const resetSessionPersistence = () => {
    sessionIdRef.current = null;
    globalRepIndexRef.current = 0;
    pendingSetEventsRef.current = [];
    pendingRepEventsRef.current = [];
    rawFrameIndexRef.current = 0;
    pendingRawFramesRef.current = [];
    dynamicRepQualityBufferRef.current.reset();
  };

  /**
   * Open a persisted session for the active exercise, if it is a patient
   * assignment (has a patient_exercise_id). Staff debug has none → no-op.
   * Returns false when the server refuses the start, so the UI can stay idle
   * instead of running a local-only session that will never persist.
   */
  const startSessionPersistence = async (): Promise<boolean> => {
    resetSessionPersistence();
    pendingStaleEndReasonRef.current = undefined;
    const patientExerciseId = prescriptionRef.current.patientExerciseId;
    const exerciseId = activeDefinitionRef.current?.id;
    if (typeof patientExerciseId !== "number" || !exerciseId) return true;
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
          exerciseId,
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
      if (!data || typeof data.sessionId !== "number") {
        setScheduleNotice("The session could not be saved, so it was not started.");
        resetSessionPersistence();
        return false;
      }

      if (sessionTokenRef.current === token) {
        // Still the active run — adopt the session and flush buffered outcomes.
        sessionIdRef.current = data.sessionId;
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
        body: JSON.stringify({ endReason: pendingStaleEndReasonRef.current }),
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
   * now covers every active exercise with the `upper_body_v2` payload.
   */
  const bufferTuningRawFrame = (
    landmarks: NormalizedLandmark[],
    raw: ExerciseFrameMetrics,
    tNow: number,
  ) => {
    if (!tuningTraceEnabledRef.current) return;
    if (prescriptionRef.current.patientExerciseId === undefined) return;
    const def = activeDefinitionRef.current;
    if (!def || DEPRECATED_EXERCISE_IDS.has(def.id)) return;
    if (sessionStateRef.current !== "active") return;

    pendingRawFramesRef.current.push({
      frameIndex: ++rawFrameIndexRef.current,
      setIndex: completedSetsRef.current + 1,
      elapsedMs: Math.max(0, Math.round(tNow - sessionPerfStartMsRef.current)),
      capturedAt: perfToIso(tNow),
      traceKind: "upper_body_v2",
      metrics: upperBodyTraceMetrics(
        landmarks,
        raw,
        def.id,
        {
          scapLeft: leftScapBaselineRef.current.value,
          scapRight: rightScapBaselineRef.current.value,
          bidirectionalPrimary: bidirectionalBaselineRef.current.value,
        },
        baselinePhaseRef.current,
      ),
      landmarks: upperBodyTraceLandmarks(landmarks),
    });

    if (pendingRawFramesRef.current.length >= RAW_FRAME_UPLOAD_BATCH_SIZE) {
      flushRawFrames();
    }
  };

  /**
   * Queue pending raw-frame batches for durable upload. The queue is
   * fire-and-forget like rep/set persistence, but serializing batches avoids a
   * burst of concurrent large JSON requests during a long set.
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
          const response = await fetch(`/api/sessions/${sessionId}/raw-frames`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ frames }),
          });
          if (!response.ok) {
            throw new Error(`raw-frames upload returned ${response.status}`);
          }
        })
        .catch((err) => console.warn("raw-frames flush failed:", err));
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
    const compensations = dynamicRepQualityBufferRef.current.finalize(
      qualityChannel,
      event,
      scoredCompensations,
    );
    pendingRepEventsRef.current.push({
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
  const finalizeHoldQuality = (centerDeg: number): HoldQuality | undefined => {
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
  ) => {
    if (prescriptionRef.current.patientExerciseId === undefined) return;
    const durationMs = Math.max(0, record.durationMs);
    const startPerfMs = currentSetStartMsRef.current ?? endPerfMs - durationMs;
    // Read the hold-quality accumulators for isometric sets BEFORE any per-set
    // reset clears them. Uses the active exercise's target-band center.
    const def = activeDefinitionRef.current;
    const holdQuality =
      exerciseKind === "isometric" && def?.kind === "isometric"
        ? finalizeHoldQuality(def.isometric.targetBand.center)
        : undefined;
    pendingSetEventsRef.current.push({
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
  };

  /**
   * Flush buffered set outcomes to the DB. Kept separate from rep flushing so
   * ex_006 can persist a set even when no rep_events exist.
   */
  const flushSetEvents = () => {
    const sessionId = sessionIdRef.current;
    if (sessionId === null || pendingSetEventsRef.current.length === 0) return;
    const sets = pendingSetEventsRef.current;
    pendingSetEventsRef.current = [];
    fetch(`/api/sessions/${sessionId}/set-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sets }),
    }).catch((err) => console.warn("set-events flush failed:", err));
  };

  /**
   * Flush buffered reps to the DB. No-op while `sessionIdRef` is null (keeps
   * them buffered until the session id resolves). Fire-and-forget; on failure
   * the reps are dropped (best-effort persistence for a proof-of-concept).
   */
  const flushRepEvents = () => {
    const sessionId = sessionIdRef.current;
    if (sessionId === null || pendingRepEventsRef.current.length === 0) return;
    const reps = pendingRepEventsRef.current;
    pendingRepEventsRef.current = [];
    fetch(`/api/sessions/${sessionId}/rep-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reps }),
    }).catch((err) => console.warn("rep-events flush failed:", err));
  };

  /**
   * Close the persisted session: flush remaining reps, then stamp ended_at.
   * Idempotent — no-op when no session is open. Clears persistence state so a
   * subsequent stray rep can't write to the just-ended session.
   */
  const endSessionPersistence = (
    completed = false,
    endReason?: "user",
  ): Promise<EndSessionPersistenceResult> => {
    const sessionId = sessionIdRef.current;
    const hasPatientAssignment =
      typeof prescriptionRef.current.patientExerciseId === "number";
    // Invalidate any in-flight create for this run. If the create has not
    // resolved yet (sessionId still null), its handler will see the bumped
    // token and self-close the row it creates, so nothing is left open.
    sessionTokenRef.current++;
    if (sessionId === null) {
      // Create hasn't resolved yet — stash the reason so the create's stale-close
      // can record it on the row it self-closes (e.g. a fast End press).
      pendingStaleEndReasonRef.current = endReason;
      resetSessionPersistence();
      return Promise.resolve(hasPatientAssignment ? "pending" : "skipped");
    }
    flushSetEvents();
    flushRepEvents();
    flushRawFrames();
    // Session-level capture-quality summary (% of active frames with OK capture).
    const framesTotal = captureFramesTotalRef.current;
    const framesOk = captureFramesOkRef.current;
    const captureQualitySummary =
      framesTotal > 0
        ? { framesTotal, framesOk, pctOk: Math.round((framesOk / framesTotal) * 100) }
        : undefined;
    // `completed` is true only when all prescribed sets were finished (not on a
    // manual early End) — it flips the patient_exercise to "completed" server-side.
    const endRequest = fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed, captureQualitySummary, endReason }),
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
    resetSessionPersistence();
    return endRequest;
  };
  endSessionPersistenceRef.current = endSessionPersistence;

  const showSessionPersistenceToast = useCallback(
    (result: EndSessionPersistenceResult) => {
      if (result === "saved") {
        showToast({ variant: "success", message: "Session saved." });
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

  /**
   * 3-2-1 start countdown. Fires when the Start button transitions the session
   * to "countdown". Counts from 3 to 1 at 1-second intervals, then stamps the
   * session start timestamps and transitions to "active". The guard on
   * `sessionStateRef` ensures that if End is clicked mid-countdown the interval
   * does not then overwrite the "ended" state with "active".
   *
   * Baseline capture (for exercises that need it) runs in parallel during the
   * countdown — both are reset together in `handleSessionStart`, so they race
   * and typically finish around the same time.
   */
  useEffect(() => {
    if (sessionState !== "countdown") return;
    setCountdownSec(3);
    let remaining = 3;
    const interval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(interval);
        // Guard: End button may have fired during the interval
        if (sessionStateRef.current !== "countdown") return;
        const now = performance.now();
        sessionStartMsRef.current = now;
        currentSetStartMsRef.current = now;
        setSessionState("active");
      } else {
        setCountdownSec(remaining);
      }
    }, 1000);
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
    const nextId = ids[nextIdx].id;
    selectedExerciseRef.current = nextId;
    setSelectedExercise(nextId);
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
        ? Math.min(left, right) >= target
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
      setComplete = Math.min(leftMs, rightMs) >= targetMs;
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
        pairedHoldMs: Math.min(leftMs, rightMs),
        targetHoldMs: targetMs,
        leftHoldMs: leftMs,
        rightHoldMs: rightMs,
      };
    } else {
      // Per-limb isometric (ex_006): a set completes when the patient has held
      // a valid T-pose (BOTH arms in the band simultaneously) for the
      // prescribed duration. The paired accumulator only advanced on
      // both-in-band frames, so this is a single threshold — no per-side
      // min() needed.
      const targetMs = prescriptionRef.current.holdSeconds * 1000;
      const pairedMs = pairedHoldMsRef.current;
      setComplete = pairedMs >= targetMs;
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
        asymmetryIndex: 0,
        pairedHoldMs: pairedMs,
        targetHoldMs: targetMs,
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
      // All prescribed sets done. Guided flow: advance to the next assigned
      // exercise if there is one, otherwise the whole session is complete.
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
      void endSessionPersistence(true).then(showSessionPersistenceToast);
      // This exercise is finished — drop its resume snapshot so a later visit
      // shows the "already completed" recap, not a resume prompt.
      clearResumeSnapshot(prescriptionRef.current.patientExerciseId);
      setSessionState("idle");
      if (!goToAdjacentExercise(1)) {
        setSessionState("ended");
      }
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
  const handleSessionStart = async () => {
    if (!activeDefinition) return;
    // Strict schedule lock: a patient may only start an exercise that is
    // actionable today (due, or still within its make-up window). Staff debug
    // bypasses this. The server enforces the same rule on session create.
    if (
      user?.role === "patient" &&
      selectedExercise &&
      !actionableExerciseIds.has(selectedExercise)
    ) {
      setScheduleNotice(
        "This exercise isn't scheduled for today. Start it from your schedule on its due day.",
      );
      return;
    }
    setScheduleNotice(null);
    const canPersist = await startSessionPersistence();
    if (!canPersist) return;

    const counters = createRepCountersForDefinition(activeDefinition);
    captureFramesTotalRef.current = 0;
    captureFramesOkRef.current = 0;
    setSessionElapsedSec(0);
    setCompletedSets(0);
    completedSetsLogRef.current = [];
    repLogRef.current = { left: [], right: [] };
    neckRepDebugRef.current = [];
    neckRepDebugStartMsRef.current = null;
    neckRepDebugSeqRef.current = 0;
    if (typeof window !== "undefined") {
      window.__neckRepDebug = neckRepDebugRef.current;
    }
    repCountsRef.current = { left: 0, right: 0 };
    setRepCounts({ left: 0, right: 0 });
    leftRepCounterRef.current = counters.left;
    rightRepCounterRef.current = counters.right;
    bidirectionalRepCounterRef.current = counters.bidirectional;
    resetCompensationWarnings();
    if (
      (activeDefinition.kind === "dynamic" &&
        !!activeDefinition.primaryMetric.requiresBaselineCapture) ||
      activeDefinition.compensationMetrics.some((c) => c.requiresBaselineCapture)
    ) {
      leftBaselineRef.current  = { samples: [], value: null };
      rightBaselineRef.current = { samples: [], value: null };
      bidirectionalBaselineRef.current = { samples: [], value: null };
      leftScapBaselineRef.current  = { samples: [], value: null };
      rightScapBaselineRef.current = { samples: [], value: null };
      setBaselinePhase("capturing");
      setBaselineSampleProgress(0);
    }
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
    setSessionState("countdown");
  };

  /**
   * Resume a disrupted session from its localStorage snapshot: restore the
   * completed-set count, the current set's counter, and the elapsed timer, and
   * continue writing to the SAME open DB session (no new row). Mirrors
   * `handleSessionStart`, but restores state instead of zeroing it and goes
   * straight to `active` — routing through `countdown` would overwrite the
   * restored timer anchor (see the countdown effect).
   */
  const resumeSession = () => {
    if (!activeDefinition) return;
    const snap = readResumeSnapshot(prescriptionRef.current.patientExerciseId);
    if (!snap || snap.exerciseId !== activeDefinition.id) return;

    const counters = createRepCountersForDefinition(activeDefinition);
    // Capture-quality tally restarts for the resumed portion.
    captureFramesTotalRef.current = 0;
    captureFramesOkRef.current = 0;

    // Completed-set count comes back; the live per-set log starts empty (the
    // pre-disruption sets already live in the DB / the "already completed"
    // analytics — the headline "Sets X/N" tracks the restored completedSets).
    setCompletedSets(snap.completedSets);
    completedSetsLogRef.current = [];
    repLogRef.current = { left: [], right: [] };
    neckRepDebugRef.current = [];
    neckRepDebugStartMsRef.current = null;
    neckRepDebugSeqRef.current = 0;
    if (typeof window !== "undefined") {
      window.__neckRepDebug = neckRepDebugRef.current;
    }

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

    // Re-capture the resting baseline if the exercise needs one (same as start).
    if (
      (activeDefinition.kind === "dynamic" &&
        !!activeDefinition.primaryMetric.requiresBaselineCapture) ||
      activeDefinition.compensationMetrics.some((c) => c.requiresBaselineCapture)
    ) {
      leftBaselineRef.current  = { samples: [], value: null };
      rightBaselineRef.current = { samples: [], value: null };
      bidirectionalBaselineRef.current = { samples: [], value: null };
      leftScapBaselineRef.current  = { samples: [], value: null };
      rightScapBaselineRef.current = { samples: [], value: null };
      setBaselinePhase("capturing");
      setBaselineSampleProgress(0);
    }

    setConfirmingEnd(false);
    restEndsAtMsRef.current = null;
    setRestRemainingSec(0);

    // Reuse the OPEN persisted session — do NOT POST a new one. Restore the
    // session-wide rep/raw-frame indices so writes stay contiguous and don't
    // collide with rows already persisted under this session id.
    resetSessionPersistence();
    sessionIdRef.current = snap.sessionId;
    globalRepIndexRef.current = snap.globalRepIndex;
    rawFrameIndexRef.current = snap.rawFrameIndex;
    sessionWallStartMsRef.current = Date.now();
    sessionPerfStartMsRef.current = performance.now();
    sessionTokenRef.current++;
    pendingStaleEndReasonRef.current = undefined;

    // Continue the timer from where it stopped (away-time excluded); start the
    // partial set's duration clock fresh.
    const now = performance.now();
    sessionStartMsRef.current = now - snap.elapsedMs;
    currentSetStartMsRef.current = now;
    setSessionElapsedSec(Math.floor(snap.elapsedMs / 1000));

    // Manual-start page: ensure the camera is running so reps can count.
    if (!streamRef.current) {
      void startCamera(selectedDeviceId || undefined);
    }

    setSessionState("active");
  };

  /**
   * Sidebar End button handler. Transitions to `ended`. If there are
   * reps in flight in the current set, log a partial set record with
   * `terminatedBy: "user"` so the session timeline reflects the
   * incomplete attempt.
   */
  const handleSessionEnd = () => {
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
      const sideSplit = isSideSplitIsometric(def);
      const leftMs = leftHoldMsRef.current;
      const rightMs = rightHoldMsRef.current;
      const pairedMs = sideSplit
        ? Math.min(leftMs, rightMs)
        : pairedHoldMsRef.current;
      const anyHold = sideSplit ? leftMs > 0 || rightMs > 0 : pairedMs > 0;
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
          terminatedBy: "user",
          asymmetryIndex: sideSplit ? computeAsymmetryIndex(leftMs, rightMs) : 0,
          pairedHoldMs: pairedMs,
          targetHoldMs: prescriptionRef.current.holdSeconds * 1000,
          ...(sideSplit ? { leftHoldMs: leftMs, rightHoldMs: rightMs } : {}),
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
          terminatedBy: "user",
          asymmetryIndex: computeAsymmetryIndex(left, right),
        };
        completedSetsLogRef.current.push(setRecord);
        if (def) bufferSetEvent(setRecord, def.kind, endedAtMs);
      }
    }
    // Flush any reps from the in-progress (partial) set and stamp ended_at.
    // endReason "user" = the End button was pressed — distinguishes a deliberate
    // early end from a tab-close/exit (which leaves the session open).
    void endSessionPersistence(false, "user").then(showSessionPersistenceToast);
    // Deliberate end → drop the resume snapshot so this attempt is not offered
    // for resume on return (the row is also closed, the authoritative guard).
    clearResumeSnapshot(prescriptionRef.current.patientExerciseId);
    setSessionState("ended");
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

  function roundDebugNumber(
    value: number | null | undefined,
    digits = 3,
  ): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
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

  function medianSample(xs: number[]): number {
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  function setBaselineSampleProgress(samples: number) {
    const clamped = Math.max(0, Math.min(BASELINE_SAMPLE_COUNT, samples));
    setBaselineProgress((prev) =>
      prev.samples === clamped && prev.required === BASELINE_SAMPLE_COUNT
        ? prev
        : { samples: clamped, required: BASELINE_SAMPLE_COUNT },
    );
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
  
  const [frameMetrics, setFrameMetrics] = useState<ExerciseFrameMetrics>({
    tiltReference: { cameraTiltDeg: 0, confidence: "insufficient", divergenceDeg: null },
    metrics: {},
    compensationScore: null,
  });
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
  
    if (activeDefinition.kind === "dynamic") {
      const p = activeDefinition.primaryMetric;
      cards.push({
        key: p.name,
        label: metricLabel(p.name),
        value: frameMetrics.metrics[p.name] ?? null,
        kind: "primary",
      });
    } else {
      const i = activeDefinition.isometric;
      cards.push({
        key: i.metric,
        label: metricLabel(i.metric),
        value: frameMetrics.metrics[i.metric] ?? null,
        kind: "primary",
      });
    }
  
    for (const comp of activeDefinition.compensationMetrics) {
      cards.push({
        key: comp.name,
        label: metricLabel(comp.name),
        value: frameMetrics.metrics[comp.name] ?? null,
        kind: "compensation",
        warningThreshold: comp.warningThreshold,
        compareDirection: comp.compareDirection,
        warningActive: activeCompensationWarnings.has(comp.name),
        // peakRelevant comps (elbowFlexion on ex_007/ex_008) only warn near
        // peak ROM — bent elbows are correct form lower in the movement.
        suppressWarning: comp.peakRelevant === true && !nearPeak,
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
    ? Math.min(repCounts.left, repCounts.right)
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
            const cappedSec = isSideSplitIsometric(activeDefinition)
              ? (Math.min(holdState.leftSec, prescription.holdSeconds) +
                  Math.min(holdState.rightSec, prescription.holdSeconds)) / 2
              : Math.min(holdState.pairedSec, prescription.holdSeconds);
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
          const assigned: Exercise[] = recordsField(data, "exercises").flatMap((row): Exercise[] => {
            const id = stringField(row, "exercise_id");
            if (!id) return [];
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
            // patient_exercises.id — returned by the API, carried through so a
            // session can be persisted against it. Absent → session
            // persistence is skipped (staff debug has no such row).
              patientExerciseId: integerField(row, "id"),
            // Assignment status — drives the "already completed" recap.
              status: assignmentStatus(row.status),
            }];
          });
          setAssignedExercises(assigned);
          if (assigned.length > 0) {
            setSelectedExercise((prev) => prev || assigned[0].id);
          }

          // Strict schedule lock: an exercise is startable today only if it has
          // an occurrence due today or still inside its make-up window.
          const todayPH = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
          const actionable = new Set<string>();
          for (const o of recordsField(data, "occurrences")) {
            const exId = stringField(o, "exercise_id");
            const due = stringField(o, "due_date");
            if (!exId || !due) continue;
            const makeup = stringField(o, "makeup_until") ?? due;
            if (stringField(o, "status") !== "completed" && due <= todayPH && makeup >= todayPH) {
              actionable.add(exId);
            }
          }
          setActionableExerciseIds(actionable);
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
            recaps.set(exerciseId, {
              exerciseKind: exerciseKind(s.exerciseKind),
              endedAt,
              durationMs: numberField(s, "durationMs") ?? null,
              setCount: numberField(s, "setCount") ?? 0,
              leftReps: numberField(s, "leftReps") ?? 0,
              rightReps: numberField(s, "rightReps") ?? 0,
              completeLeftReps: numberField(s, "completeLeftReps") ?? 0,
              completeRightReps: numberField(s, "completeRightReps") ?? 0,
              avgPeakValue: numberField(s, "avgPeakValue") ?? null,
              totalPairedHoldMs: numberField(s, "totalPairedHoldMs") ?? null,
              totalTargetHoldMs: numberField(s, "totalTargetHoldMs") ?? null,
            });
          }
          setSessionRecaps(recaps);
          setOpenSessions(opens);
        })
        .catch((err) => console.warn("Error loading session recaps:", err));
    }
  }, [initialExerciseId, user?.id, user?.role]);

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
        }
      : DEFAULT_PRESCRIPTION;
    prescriptionRef.current = nextPrescription;
    setPrescriptionRaw(nextPrescription);
  }, [selectedExercise, assignedExercises]);

  useEffect(() => {
    if (!selectedExercise) {
      setActiveDefinition(null);
      // Close any open persisted session (idempotent; no-op if none).
      endSessionPersistenceRef.current();
      leftRepCounterRef.current = null;
      rightRepCounterRef.current = null;
      bidirectionalRepCounterRef.current = null;
      dynamicRepQualityBufferRef.current.reset();
      repLogRef.current = { left: [], right: [] };
      neckRepDebugRef.current = [];
      neckRepDebugStartMsRef.current = null;
      neckRepDebugSeqRef.current = 0;
      if (typeof window !== "undefined") {
        window.__neckRepDebug = neckRepDebugRef.current;
      }
      setRepCounts({ left: 0, right: 0 });
      resetCompensationWarnings();
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
    neckRepDebugRef.current = [];
    neckRepDebugStartMsRef.current = null;
    neckRepDebugSeqRef.current = 0;
    if (typeof window !== "undefined") {
      window.__neckRepDebug = neckRepDebugRef.current;
    }
    setRepCounts({ left: 0, right: 0 });

    // Reset baseline state on every exercise change. If the new exercise
    // needs a baseline (primary metric or any compensation metric), enter
    // "capturing"; otherwise "not-needed".
    leftBaselineRef.current  = { samples: [], value: null };
    rightBaselineRef.current = { samples: [], value: null };
    bidirectionalBaselineRef.current = { samples: [], value: null };
    leftScapBaselineRef.current  = { samples: [], value: null };
    rightScapBaselineRef.current = { samples: [], value: null };
    const needsBaseline =
      (def?.kind === "dynamic" && !!def.primaryMetric.requiresBaselineCapture) ||
      !!def?.compensationMetrics.some((c) => c.requiresBaselineCapture);
    setBaselinePhase(needsBaseline ? "capturing" : "not-needed");
    setBaselineSampleProgress(0);

    const counters = createRepCountersForDefinition(def);
    leftRepCounterRef.current = counters.left;
    rightRepCounterRef.current = counters.right;
    bidirectionalRepCounterRef.current = counters.bidirectional;
  }, [selectedExercise, resetCompensationWarnings, setBaselinePhase]);

  const commitCaptureState = (ok: boolean, msg: string) => {
    if (lastCaptureOkRef.current !== ok) {
      const currentDefinition = activeDefinitionRef.current;
      // Transition into not-ok: any already-captured baseline is now stale
      // (patient may have shifted while we couldn't see them). Drop it and
      // require re-capture when readiness returns.
      if (
        !ok &&
        ((currentDefinition?.kind === "dynamic" &&
          !!currentDefinition.primaryMetric.requiresBaselineCapture) ||
          !!currentDefinition?.compensationMetrics.some((c) => c.requiresBaselineCapture))
      ) {
        leftBaselineRef.current  = { samples: [], value: null };
        rightBaselineRef.current = { samples: [], value: null };
        bidirectionalBaselineRef.current = { samples: [], value: null };
        leftScapBaselineRef.current  = { samples: [], value: null };
        rightScapBaselineRef.current = { samples: [], value: null };
        setBaselinePhase("capturing");
        setBaselineSampleProgress(0);
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
        const inferStart = frameStart;
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
          const r = evaluateCaptureReadiness(landmarks, canvas.width, canvas.height, framingMode);

          // Tally capture quality for the active session (→ capture_quality_summary).
          if (sessionStateRef.current === "active") {
            captureFramesTotalRef.current += 1;
            if (r.ok) captureFramesOkRef.current += 1;
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
              if (compensationWarningLatchesRef.current.size > 0) {
                resetCompensationWarnings();
              }
              setFrameMetrics({
                tiltReference: { cameraTiltDeg: 0, confidence: "insufficient", divergenceDeg: null },
                metrics: {},
                compensationScore: null,
              });
            } else {
              const raw = computePoseMetricsForExercise(landmarks, activeDefinition);
              const tNow = performance.now();
              const metricInputs: Partial<Record<MetricName, number | null>> = {
                ...raw.metrics,
              };
              let ex005PerFrameCorrectedSignedDeg: number | null = null;

              // Durable tuning trace (opt-in, any active exercise): record
              // RAW/unsmoothed values before any One Euro filtering or
              // rep-state-machine processing. This block is already inside
              // capture-readiness `r.ok`, so unreliable frames remain
              // excluded per the logging discipline. Baseline values read
              // from the refs are the medians captured in earlier frames.
              bufferTuningRawFrame(landmarks, raw, tNow);

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

              // Smooth the camera-tilt estimate (still always needed)
              const smoothedTilt = tiltFilterRef.current.filter(
                raw.tiltReference.cameraTiltDeg,
                tNow
              );

              // Re-correct the tilt-dependent COMPENSATION metrics against the
              // smoothed camera tilt instead of the raw per-frame consensus
              // tilt. The raw consensus tilt (hip/ear lines) carries several
              // degrees of landmark jitter at rest, which leaked into trunk
              // lean / shoulder symmetry / neck tilt and tripped compensation
              // warnings while the patient held still. We reuse the same metric
              // computation (identical sign/worst-side/rounding) with only the
              // tilt swapped, then value-smooth as usual below. `raw.metrics`
              // is left untouched and continues to feed the ML/log pipeline
              // (data-flow discipline: raw -> ML, smoothed -> display/warnings).
              const smoothedTiltMetrics = computePoseMetricsForExercise(
                landmarks,
                activeDefinition,
                { ...raw.tiltReference, cameraTiltDeg: smoothedTilt },
              );
              for (const comp of activeDefinition.compensationMetrics) {
                if (comp.name in smoothedTiltMetrics.metrics) {
                  metricInputs[comp.name] =
                    smoothedTiltMetrics.metrics[comp.name] ?? null;
                }
              }

              if (
                activeDefinition.kind === "dynamic" &&
                activeDefinition.id === "ex_005"
              ) {
                const primaryName = activeDefinition.primaryMetric.name;
                const uncorrected = computeTrunkLateralFlexionUncorrectedSigned(
                  landmarks,
                );
                const perFrameCorrected = raw.metrics[primaryName];
                ex005PerFrameCorrectedSignedDeg =
                  typeof perFrameCorrected === "number"
                    ? perFrameCorrected
                    : null;

                if (baselinePhaseRef.current === "capturing") {
                  if (typeof uncorrected === "number") {
                    bidirectionalBaselineRef.current.samples.push(uncorrected);
                  }
                  // Progress is updated (and phase transitioned) by the scap
                  // compensation baseline block below so both baselines complete
                  // together. Only compute the median here once ready.
                  if (
                    bidirectionalBaselineRef.current.samples.length >=
                    BASELINE_SAMPLE_COUNT
                  ) {
                    bidirectionalBaselineRef.current.value = medianSample(
                      bidirectionalBaselineRef.current.samples,
                    );
                    metricFiltersRef.current.delete(primaryName);
                  }
                }

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
              // For any exercise whose scapularElevation compensation metric
              // carries requiresBaselineCapture, capture 90 resting frames
              // per side, compute per-side medians, then replace the raw
              // absolute projection in metricInputs with (baseline − raw).
              // At rest the delta ≈ 0; it grows positive when the patient
              // shrugs, making the 0.04 warningThreshold meaningful.
              // This block is also the single "captured" transition point for
              // ex_005, where both the primary bidirectional baseline and this
              // scap baseline must complete before the phase advances.
              const needsScapCompBaseline = activeDefinition.compensationMetrics.some(
                (c) => c.name === "scapularElevation" && c.requiresBaselineCapture,
              );
              const needsPrimaryBaseline =
                activeDefinition.kind === "dynamic" &&
                !!activeDefinition.primaryMetric.requiresBaselineCapture;

              if (needsScapCompBaseline) {
                const rawScapLeft  = computeScapularElevation(landmarks, raw.tiltReference, "left");
                const rawScapRight = computeScapularElevation(landmarks, raw.tiltReference, "right");

                if (baselinePhaseRef.current === "capturing") {
                  if (typeof rawScapLeft  === "number") leftScapBaselineRef.current.samples.push(rawScapLeft);
                  if (typeof rawScapRight === "number") rightScapBaselineRef.current.samples.push(rawScapRight);

                  // Finalize medians once both sides have enough samples
                  if (
                    leftScapBaselineRef.current.value === null &&
                    leftScapBaselineRef.current.samples.length  >= BASELINE_SAMPLE_COUNT &&
                    rightScapBaselineRef.current.samples.length >= BASELINE_SAMPLE_COUNT
                  ) {
                    leftScapBaselineRef.current.value  = medianSample(leftScapBaselineRef.current.samples);
                    rightScapBaselineRef.current.value = medianSample(rightScapBaselineRef.current.samples);
                  }

                  // Overall progress = min across all active baselines
                  const scapProg = Math.min(
                    leftScapBaselineRef.current.samples.length,
                    rightScapBaselineRef.current.samples.length,
                  );
                  const primaryProg = needsPrimaryBaseline
                    ? (activeDefinition.kind === "dynamic" &&
                       activeDefinition.bilateralMode === "bidirectional-alternating"
                         ? bidirectionalBaselineRef.current.samples.length
                         : Math.min(
                             leftBaselineRef.current.samples.length,
                             rightBaselineRef.current.samples.length,
                           ))
                    : BASELINE_SAMPLE_COUNT;
                  setBaselineSampleProgress(Math.min(scapProg, primaryProg));

                  // Transition to "captured" only when ALL needed baselines
                  // are ready (prevents early completion on ex_005 where both
                  // primary bidirectional and scap baselines must finish).
                  const scapDone =
                    leftScapBaselineRef.current.value  !== null &&
                    rightScapBaselineRef.current.value !== null;
                  const primaryDone = !needsPrimaryBaseline || (
                    activeDefinition.kind === "dynamic" &&
                    activeDefinition.bilateralMode === "bidirectional-alternating"
                      ? bidirectionalBaselineRef.current.value !== null
                      : leftBaselineRef.current.value  !== null &&
                        rightBaselineRef.current.value !== null
                  );
                  if (scapDone && primaryDone) {
                    setBaselineSampleProgress(BASELINE_SAMPLE_COUNT);
                    setBaselinePhase("captured");
                  }
                }

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
                  Math.round(filtered.value * 10) / 10;
                smoothedMetricVelocities[metricName] = filtered.velocity;
              }

              // ── Per-frame compensation score ─────────────────────────────
              // Computed once and reused by the isometric hold-quality
              // accumulator and the frame-metrics UI update below.
              //
              // For per-limb exercises (ex_001 dynamic, ex_006 isometric) each
              // side is scored against its OWN primary so a `primary-coupled`
              // metric's expected baseline (scapular elevation rising with
              // abduction) is anatomically paired, then the WORSE side is
              // surfaced — a clean arm cannot mask a compensating one. We reuse
              // the smoothed whole-body metrics for both sides and override
              // only scapularElevation with that side's raw per-side delta
              // (trunkLean / shoulderSymmetry are single whole-body measures;
              // any future scored metric flows through unchanged). Per-side
              // scap/primary are read raw: their frame jitter (~0.006 scap,
              // ~1° primary → ~0.0015 expected) sits well below the coupled
              // residual's 0.02 noise floor, so smoothing would not move the
              // rounded score. Bidirectional/unilateral exercises pass the
              // single smoothed primary.
              const scoreIsPerLimb =
                activeDefinition.bilateral &&
                activeDefinition.bilateralMode === "per-limb";
              let leftFrameCompensationScore: number | null = null;
              let rightFrameCompensationScore: number | null = null;
              let frameCompensationScore: number | null;
              if (scoreIsPerLimb) {
                leftFrameCompensationScore = computeCompensationScore(
                  activeDefinition,
                  { ...smoothedMetrics, scapularElevation: scapDeltaLeft },
                  raw.perSideMetrics?.left ?? null,
                );
                rightFrameCompensationScore = computeCompensationScore(
                  activeDefinition,
                  { ...smoothedMetrics, scapularElevation: scapDeltaRight },
                  raw.perSideMetrics?.right ?? null,
                );
                frameCompensationScore =
                  leftFrameCompensationScore === null
                    ? rightFrameCompensationScore
                    : rightFrameCompensationScore === null
                      ? leftFrameCompensationScore
                      : Math.min(
                          leftFrameCompensationScore,
                          rightFrameCompensationScore,
                        );
              } else {
                const scorePrimaryName =
                  activeDefinition.kind === "dynamic"
                    ? activeDefinition.primaryMetric.name
                    : activeDefinition.isometric.metric;
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

              // Near-peak gate for `peakRelevant` compensation warnings
              // (elbowFlexion "Straighten arms" on ex_007/ex_008). Driven by
              // the per-side primary (raw.perSideMetrics) for per-limb
              // exercises, else the single smoothed primary value. When the
              // arms aren't near the top of the movement we suppress the
              // warning, because bent elbows are correct form there.
              const nearPeakNow = isNearPeak(
                activeDefinition,
                raw.perSideMetrics,
                activeDefinition.kind === "dynamic"
                  ? smoothedMetrics[activeDefinition.primaryMetric.name] ?? null
                  : null,
              );

              const baselineReadyForExercise =
                baselinePhaseRef.current !== "capturing";

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
                    const primaryNeedsBaseline =
                      !!activeDefinition.primaryMetric.requiresBaselineCapture;
                    // Read via ref — the rAF chain captured a stale state value.
                    if (
                      primaryNeedsBaseline &&
                      baselinePhaseRef.current === "capturing"
                    ) {
                      // Accumulate raw projections until each side has enough
                      // samples to summarize. Rep counting stays paused while
                      // the primary metric is in calibration. Compensation-only
                      // baselines must not calibrate or transform rep inputs.
                      if (typeof perSide.left === "number") {
                        leftBaselineRef.current.samples.push(perSide.left);
                      }
                      if (typeof perSide.right === "number") {
                        rightBaselineRef.current.samples.push(perSide.right);
                      }
                      setBaselineSampleProgress(
                        Math.min(
                          leftBaselineRef.current.samples.length,
                          rightBaselineRef.current.samples.length,
                        ),
                      );
                      if (
                        leftBaselineRef.current.samples.length >=
                          BASELINE_SAMPLE_COUNT &&
                        rightBaselineRef.current.samples.length >=
                          BASELINE_SAMPLE_COUNT
                      ) {
                        // Median, not mean — robust to single-frame spikes
                        // if the patient briefly shifted during capture.
                        leftBaselineRef.current.value = medianSample(
                          leftBaselineRef.current.samples,
                        );
                        rightBaselineRef.current.value = medianSample(
                          rightBaselineRef.current.samples,
                        );
                        setBaselineSampleProgress(BASELINE_SAMPLE_COUNT);
                        setBaselinePhase("captured");
                      }
                    } else {
                      // For requiresBaselineCapture exercises, the registry's
                      // thresholds expect (baseline − raw): a shrug DECREASES
                      // the raw projection, so subtracting from the captured
                      // resting value yields a positive delta that increases
                      // during the rep — matching what the state machine expects.
                      // Pass-through when no baseline was captured.
                      const lb = leftBaselineRef.current.value;
                      const rb = rightBaselineRef.current.value;
                      const inputLeft =
                        typeof perSide.left === "number"
                          ? primaryNeedsBaseline && lb !== null
                            ? lb - perSide.left
                            : perSide.left
                          : null;
                      const inputRight =
                        typeof perSide.right === "number"
                          ? primaryNeedsBaseline && rb !== null
                            ? rb - perSide.right
                            : perSide.right
                          : null;

                      // ex_007's normalized wrist-height calibration groups
                      // are separated by hundredths (low <= 0.18, intended
                      // partial >= 0.24). One-decimal rounding collapses both
                      // into 0.2 before the RepCounter sees them, so preserve
                      // three decimals for that metric. Degree-scale metrics
                      // keep their existing one-decimal behavior.
                      const primaryInputScale =
                        primaryName === "wristShoulderVertical" ? 1000 : 10;
                      const smoothedLeft =
                        inputLeft !== null
                          ? Math.round(
                              leftPrimaryFilterRef.current.filter(inputLeft, tNow) *
                                primaryInputScale,
                            ) / primaryInputScale
                          : null;
                      const smoothedRight =
                        inputRight !== null
                          ? Math.round(
                              rightPrimaryFilterRef.current.filter(inputRight, tNow) *
                                primaryInputScale,
                            ) / primaryInputScale
                          : null;

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
                      // Paired (true T-pose) bookkeeping: hold accrual, streak,
                      // drops, settle time, out-of-position time.
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

              if (tNow - lastMetricsUpdateRef.current > 150) {
                lastMetricsUpdateRef.current = tNow;
                const suppressedWarningNames = new Set(
                  activeDefinition.compensationMetrics
                    .filter((comp) => comp.peakRelevant === true && !nearPeakNow)
                    .map((comp) => comp.name),
                );
                const activeWarningNames = updateCompensationWarningMap(
                  compensationWarningLatchesRef.current,
                  activeDefinition.compensationMetrics,
                  smoothedMetrics,
                  tNow,
                  suppressedWarningNames,
                );
                setFrameMetrics({
                  tiltReference: { ...raw.tiltReference, cameraTiltDeg: smoothedTilt },
                  metrics: smoothedMetrics,
                  // Single per-frame score computed above from the SAME
                  // smoothed values the metric cards render (with per-side
                  // primaries for per-limb exercises). raw.metrics is still
                  // available separately for the ML/log pipeline.
                  compensationScore: frameCompensationScore,
                });
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
              // Suppress `peakRelevant` compensation warnings (elbowFlexion
              // "Straighten arms" on ex_007/ex_008) unless the movement is near
              // peak ROM — drawn every frame, so gate with the per-frame value.
              const overlayWarningNames = new Set<MetricName>();
              const overlayComps = activeDefinition.compensationMetrics.filter((comp) => {
                if (comp.peakRelevant === true && !nearPeakNow) return false;
                const isActive =
                  compensationWarningLatchesRef.current.get(comp.name)?.active === true;
                if (isActive) overlayWarningNames.add(comp.name);
                return isActive;
              });
              drawCompensationOverlay(
                ctx,
                landmarks,
                canvas.width,
                canvas.height,
                overlayComps,
                smoothedMetrics,
                metricDirections,
                overlayWarningNames,
              );
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
              // A sustained not-ready interval is a true capture dropout:
              // reset filters/counters so the next good frame does not blend
              // against stale pre-dropout state. Short flickers only pause
              // computation; resetting on those was discarding valid reps.
              tiltFilterRef.current.reset();
              metricFiltersRef.current.forEach((f) => f.reset());
              leftPrimaryFilterRef.current.reset();
              rightPrimaryFilterRef.current.reset();
              leftRepCounterRef.current?.reset();
              rightRepCounterRef.current?.reset();
              bidirectionalRepCounterRef.current?.reset();
              dynamicRepQualityBufferRef.current.reset();
              // Discard any in-progress isometric hold — a sustained dropout
              // means we couldn't verify the band, so the partial accumulation
              // is stale (matches the rep-counter reset philosophy).
              pairedHoldMsRef.current = 0;
              leftHoldMsRef.current = 0;
              rightHoldMsRef.current = 0;
              leftInBandRef.current = false;
              rightInBandRef.current = false;
              lastIsometricTickMsRef.current = null;
              resetHoldQualityAccum();
              setHoldState({ pairedSec: 0, leftSec: 0, rightSec: 0, leftInBand: false, rightInBand: false });
              resetCompensationWarnings();
              captureDropoutResetDoneRef.current = true;
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
          commitCaptureState(false, "No person detected. Step into the frame.");
          // Count as a not-OK frame so a patient who steps out of frame lowers
          // pctOk rather than being invisible to the capture-quality summary.
          if (sessionStateRef.current === "active") {
            captureFramesTotalRef.current += 1;
          }
        }

        ctx.restore();

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

  async function stopCamera() {
    try {
      if (videoRef.current) videoRef.current.srcObject = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }

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
    } catch {
      // ignore
    }
  }

  async function listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const cams = all.filter((d) => d.kind === "videoinput");
    setDevices(cams);
    if (!selectedDeviceId && cams[0]?.deviceId) setSelectedDeviceId(cams[0].deviceId);
  }

  async function startCamera(deviceId?: string) {
    if (!canUseMediaDevices) {
      setError("Camera API not available in this browser/environment.");
      return;
    }

    setIsStarting(true);
    setError(null);
    await stopCamera();

    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: useFrontCameraHint ? "user" : "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadeddata = () => {
          videoRef.current?.play();
          predictWebcam();
        };
      }

      await listCameras();
    } catch (e) {
      const name = getErrorName(e);
      if (name === "NotAllowedError") setError("Permission denied. Please allow camera access.");
      else if (name === "NotFoundError") setError("No camera found on this device.");
      else if (name === "NotReadableError") setError("Camera is already in use by another app.");
      else setError(`Failed to start camera: ${name}`);
    } finally {
      setIsStarting(false);
    }
  }

  useEffect(() => {
    setMounted(true);
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString());
    };
    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    updateViewportWidth();
    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);

  if (!mounted) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "oklch(0.985 0.003 90)", fontFamily: "var(--sans)" }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "oklch(0.45 0.01 240)", letterSpacing: ".1em" }}>Loading camera…</span>
      </div>
    );
  }

  const selectedExerciseObj = assignedExercises.find((e) => e.id === selectedExercise);
  // "Already completed" recap: the selected exercise finished in a prior visit.
  // Status stays "completed" across redos (a restart only moves pending →
  // in_progress server-side), so this keeps showing. Gated on idle so it never
  // overlays a live session, and on a dismiss flag so the patient can close it.
  const selectedRecap = sessionRecaps.get(selectedExercise) ?? null;
  const selectedExerciseCompleted = selectedExerciseObj?.status === "completed";
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
    !actionableExerciseIds.has(selectedExercise);
  // Stepper navigation locked while a session is in progress.
  const sessionBusy =
    sessionState === "active" ||
    sessionState === "resting" ||
    sessionState === "countdown";
  const baselineVisible = baselinePhase === "capturing";
  const baselineSamples = Math.min(
    baselineProgress.samples,
    baselineProgress.required,
  );
  const baselineProgressPct = Math.round(
    (baselineSamples / Math.max(1, baselineProgress.required)) * 100,
  );
  const baselineRemainingSec = Math.max(
    0,
    Math.ceil((baselineProgress.required - baselineSamples) / 30),
  );
  const score = frameMetrics.compensationScore;
  const tier = scoreTier(score);
  const cameraBg = "oklch(0.20 0.008 240)";
  const currentSetIdx = Math.min(completedSets + 1, prescription.sets);
  const showTiltBanner = captureOk && showTiltWarning;
  const patientAlertVisible = !captureOk || showTiltBanner;
  const compactLayout = viewportWidth < 1024;
  const tightLayout = viewportWidth < 720;
  const prescriptionTargetText =
    activeDefinition?.kind === "isometric"
      ? isSideSplitIsometric(activeDefinition)
        ? `${prescription.holdSeconds}s hold/side`
        : `${prescription.holdSeconds}s hold`
      : activeDefinition?.bilateral
        ? `${prescription.reps} reps/side`
        : `${prescription.reps} reps`;

  return (
    <>
      {/* Sidebar overlay backdrop */}
      {sidebarOpen && (
        <div
          style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 30, background: "rgba(0,0,0,0.4)" }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Slide-in navigation sidebar */}
      <aside
        style={{
          position: "fixed",
          top: 0,
          bottom: 0,
          left: 0,
          zIndex: 40,
          width: 256,
          background: "white",
          borderRight: "1px solid oklch(0.93 0.003 240)",
          display: "flex",
          flexDirection: "column",
          padding: 24,
          transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.2s",
          boxShadow: sidebarOpen ? "4px 0 16px oklch(0 0 0 / 0.08)" : "none",
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: "oklch(0.18 0.01 240)" }}>Postural</span>
          </div>
          {user?.name && (
            <div style={{ fontSize: 12, color: "oklch(0.50 0.01 240)", marginTop: 4 }}>{user.name}</div>
          )}
        </div>

        <nav>
          <Link
            href={dashboardHref}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 10px", borderRadius: 6,
              fontSize: 13, color: "oklch(0.30 0.01 240)",
              textDecoration: "none",
            }}
            onClick={() => setSidebarOpen(false)}
          >
            <CameraHomeIcon /> Back to Dashboard
          </Link>
        </nav>

        <div style={{ marginTop: "auto", paddingTop: 24 }}>
          <button
            onClick={() => setSidebarOpen(false)}
            style={{
              width: "100%", padding: "8px 12px", borderRadius: 6,
              border: "1px solid oklch(0.90 0.003 240)", background: "white",
              fontSize: 13, color: "oklch(0.35 0.01 240)", cursor: "pointer",
            }}
          >
            ✕ Close
          </button>
        </div>
      </aside>

      {/* Full page wrapper */}
      <div style={{
        fontFamily: "var(--sans)",
        color: "oklch(0.18 0.01 240)",
        background: "oklch(0.985 0.003 90)",
        height: compactLayout ? "auto" : "100vh",
        minHeight: "100vh",
        width: "100vw",
        overflow: compactLayout ? "auto" : "hidden",
        display: "flex",
        flexDirection: "column",
      }}>
        {/* HEADER */}
        <header style={{
          height: 56,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: compactLayout ? "wrap" : "nowrap",
          gap: compactLayout ? 12 : 0,
          padding: compactLayout ? "10px 12px" : "0 24px",
          background: "white",
          borderBottom: "1px solid oklch(0.93 0.003 240)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: tightLayout ? 10 : 20 }}>
            <button
              id="cam-tour-sidebar"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
              style={{
                width: 28, height: 28, border: "1px solid oklch(0.90 0.003 240)",
                background: "white", borderRadius: 6, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "oklch(0.35 0.01 240)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>Postural</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ color: "oklch(0.75 0.01 240)" }}>/</span>
              <span style={{ color: "oklch(0.20 0.01 240)" }}>Camera</span>
            </div>
          </div>

          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: compactLayout ? "flex-start" : "flex-end",
            flexWrap: "wrap",
            gap: compactLayout ? 10 : 16,
          }}>
            <div id="cam-tour-status" style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ClinicalStatusDot ok={modelLoaded} />
              <span style={{ fontSize: 12, color: "oklch(0.30 0.01 240)" }}>
                {modelLoaded ? "AI ready" : "Loading model"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ClinicalStatusDot ok={captureOk} />
              <span
                title={captureMessage}
                style={{
                  fontSize: 12,
                  color: "oklch(0.30 0.01 240)",
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {captureOk ? "Capture OK" : captureMessage}
              </span>
            </div>
            </div>{/* end cam-tour-status */}
            <div style={{ width: 1, height: 20, background: "oklch(0.92 0.003 240)", display: tightLayout ? "none" : "block" }} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "oklch(0.50 0.01 240)", display: tightLayout ? "none" : "inline" }}>
              {currentTime}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                id="cam-tour-stop"
                onClick={stopCamera}
                style={{
                  padding: "6px 14px", border: "1px solid oklch(0.90 0.003 240)",
                  background: "white", borderRadius: 6, fontSize: 12, fontWeight: 500,
                  color: "oklch(0.30 0.01 240)", cursor: "pointer",
                }}
              >Stop</button>
              <button
                id="cam-tour-start"
                onClick={() => startCamera(selectedDeviceId || undefined)}
                disabled={isStarting || !modelLoaded}
                style={{
                  padding: "6px 14px",
                  border: `1px solid ${ACCENT.hex}`,
                  background: ACCENT.hex,
                  borderRadius: 6, fontSize: 12, fontWeight: 500,
                  color: "white", cursor: "pointer",
                  opacity: (isStarting || !modelLoaded) ? 0.5 : 1,
                }}
              >
                {isStarting ? "Starting…" : "Start camera"}
              </button>
              <button
                onClick={() => { setTutorialStep(0); setShowTutorial(true); }}
                style={{
                  padding: "6px 14px",
                  border: `1px solid ${ACCENT.hex}`,
                  background: "white",
                  borderRadius: 6, fontSize: 12, fontWeight: 500,
                  color: ACCENT.text, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 5,
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                How to Use
              </button>
            </div>
          </div>
        </header>

        {/* Error bar */}
        {error && (
          <div style={{
            padding: "8px 24px",
            background: "oklch(0.96 0.04 25)",
            borderBottom: "1px solid oklch(0.88 0.06 25)",
            fontSize: 12,
            color: "oklch(0.40 0.12 25)",
          }}>
            {error}
          </div>
        )}

        {/* BODY: 3-column grid */}
        <div style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: compactLayout ? "1fr" : "240px minmax(0, 1fr) 300px",
          minHeight: 0,
        }}>
          {/* LEFT RAIL — live metrics */}
          <aside id="cam-tour-metrics" style={{
            background: "white",
            borderRight: compactLayout ? "none" : "1px solid oklch(0.93 0.003 240)",
            borderTop: compactLayout ? "1px solid oklch(0.93 0.003 240)" : "none",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: compactLayout ? "visible" : "hidden",
            order: compactLayout ? 2 : 0,
          }}>
            <div style={{
              padding: "14px 16px",
              borderBottom: "1px solid oklch(0.93 0.003 240)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <span style={{
                fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em",
                textTransform: "uppercase", color: "oklch(0.30 0.01 240)", fontWeight: 600,
              }}>Live Metrics</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "oklch(0.55 0.01 240)" }}>°</span>
            </div>

            <ClinicalScoreRow score={score} tier={tier} />

            {metricCards.map((card) => (
              <ClinicalMetricRow key={card.key} card={card} />
            ))}

            <div style={{ flex: 1 }} />

            {/* Opt-in tuning-trace recording (patient sessions only persist) */}
            {user?.role === "patient" && (
              <div style={{
                padding: "10px 16px",
                borderTop: "1px solid oklch(0.93 0.003 240)",
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
              }}>
                <input
                  type="checkbox"
                  id="tuning-trace-toggle"
                  checked={tuningTraceEnabled}
                  onChange={(e) => setTuningTraceEnabled(e.target.checked)}
                  style={{ marginTop: 2, accentColor: ACCENT.hex }}
                />
                <label htmlFor="tuning-trace-toggle" style={{ cursor: "pointer" }}>
                  <div style={{
                    fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em",
                    textTransform: "uppercase", color: "oklch(0.30 0.01 240)", fontWeight: 600,
                  }}>
                    Record tuning trace
                  </div>
                  <div style={{ fontSize: 11, color: "oklch(0.50 0.01 240)", marginTop: 2 }}>
                    Saves raw movement metrics (no video) for threshold tuning.
                  </div>
                </label>
              </div>
            )}

            {/* Footer: resolution + fps + inference/frame-total timing split */}
            <div style={{
              padding: "12px 16px",
              borderTop: "1px solid oklch(0.93 0.003 240)",
              background: "oklch(0.985 0.003 240)",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}>
              <div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".14em", textTransform: "uppercase", color: "oklch(0.50 0.01 240)", marginBottom: 2 }}>Resolution</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "oklch(0.25 0.01 240)" }}>
                  {videoResolution ? `${videoResolution.width} × ${videoResolution.height}` : "—"}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".14em", textTransform: "uppercase", color: "oklch(0.50 0.01 240)", marginBottom: 2 }}>Frame rate</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "oklch(0.25 0.01 240)" }}>{fps !== null ? `${fps} fps` : "—"}</div>
              </div>
              <div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".14em", textTransform: "uppercase", color: "oklch(0.50 0.01 240)", marginBottom: 2 }}>Inference</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "oklch(0.25 0.01 240)" }}>{perfMs ? `${perfMs.infer.toFixed(1)} ms` : "—"}</div>
              </div>
              <div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".14em", textTransform: "uppercase", color: "oklch(0.50 0.01 240)", marginBottom: 2 }}>Frame total</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "oklch(0.25 0.01 240)" }}>{perfMs ? `${perfMs.frame.toFixed(1)} ms` : "—"}</div>
              </div>
            </div>
          </aside>

          {/* CAMERA CENTER */}
          <main id="cam-tour-feed" style={{
            minWidth: 0,
            padding: compactLayout ? 12 : 16,
            display: "flex",
            flexDirection: "column",
            minHeight: compactLayout ? 560 : 0,
            order: compactLayout ? 1 : 0,
          }}>
            <div style={{
              flex: 1,
              position: "relative",
              borderRadius: 8,
              overflow: "hidden",
              background: cameraBg,
              border: "1px solid oklch(0.92 0.003 240)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 0,
            }}>
              {/* Subtle radial gradient */}
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                background: `radial-gradient(ellipse at center, oklch(0.25 0.008 240) 0%, ${cameraBg} 60%)`,
                pointerEvents: "none",
              }} />

              {/* Mirrored video + canvas layer */}
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                transform: mirror ? "scaleX(-1)" : "none",
              }}>
                <video ref={videoRef} playsInline muted style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} />
                <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} />
              </div>

              {/* Corner ticks */}
              <ClinicalCornerTicks />

              {/* Tilt confidence warning */}
              {!captureOk && (
                <div style={{
                  position: "absolute",
                  top: 16,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "oklch(0.99 0.02 80)",
                  border: "2px solid oklch(0.70 0.16 65)",
                  borderRadius: 8,
                  padding: "10px 18px",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  boxShadow: "0 2px 8px oklch(0 0 0 / 0.20)",
                  maxWidth: "calc(100% - 32px)",
                  zIndex: 5,
                }}>
                  <span style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: "oklch(0.70 0.16 65)",
                    boxShadow: "0 0 0 5px oklch(0.70 0.16 65 / 0.15)",
                    flexShrink: 0,
                    display: "inline-block",
                  }} />
                  <span style={{
                    fontFamily: "var(--mono)",
                    fontSize: tightLayout ? 13 : 18,
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    color: "oklch(0.45 0.10 65)",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>Paused</span>
                  <span style={{
                    fontSize: tightLayout ? 13 : 18,
                    fontWeight: 500,
                    color: "oklch(0.25 0.05 65)",
                    overflowWrap: "anywhere",
                  }}>
                    {captureMessage}
                  </span>
                </div>
              )}

              {showTiltBanner && (
                <div style={{
                  position: "absolute",
                  top: 16, left: "50%", transform: "translateX(-50%)",
                  background: "oklch(0.99 0.02 80)",
                  border: "2px solid oklch(0.70 0.16 65)",
                  borderRadius: 8,
                  padding: "10px 18px",
                  display: "flex", alignItems: "center", gap: 14,
                  boxShadow: "0 2px 8px oklch(0 0 0 / 0.20)",
                  maxWidth: "calc(100% - 32px)",
                  zIndex: 5,
                }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: 999,
                    background: "oklch(0.70 0.16 65)",
                    boxShadow: "0 0 0 5px oklch(0.70 0.16 65 / 0.15)",
                    flexShrink: 0,
                    display: "inline-block",
                  }} />
                  <span style={{
                    fontFamily: "var(--mono)", fontSize: 18, letterSpacing: ".12em",
                    textTransform: "uppercase", color: "oklch(0.45 0.10 65)", fontWeight: 700,
                    flexShrink: 0,
                  }}>Tilt</span>
                  <span style={{ fontSize: 18, fontWeight: 500, color: "oklch(0.25 0.05 65)", whiteSpace: "nowrap" }}>
                    Keep hips &amp; head visible
                  </span>
                </div>
              )}

              {/* Baseline-capture banner */}
              {baselineVisible && (
                <div style={{
                  position: "absolute",
                  top: patientAlertVisible ? (tightLayout ? 96 : 84) : 16,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "white",
                  border: "1px solid oklch(0.92 0.003 240)",
                  borderRadius: 8,
                  padding: "10px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  boxShadow: "0 1px 2px oklch(0 0 0 / 0.04)",
                  maxWidth: "calc(100% - 32px)",
                  zIndex: 5,
                }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: 999, background: ACCENT.hex,
                    boxShadow: `0 0 0 4px ${ACCENT.soft}`,
                    display: "inline-block",
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em",
                      textTransform: "uppercase", color: ACCENT.text, fontWeight: 600, marginBottom: 2,
                    }}>Baseline capture</div>
                    <div style={{ fontSize: 12, color: "oklch(0.35 0.01 240)" }}>
                      {captureOk ? "Stand naturally, arms relaxed" : "Paused — improve framing"}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 18, fontWeight: 500, color: "oklch(0.18 0.01 240)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                      {baselineRemainingSec}<span style={{ fontSize: 12, color: "oklch(0.55 0.01 240)", marginLeft: 2 }}>s</span>
                    </div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".14em", color: "oklch(0.55 0.01 240)", marginTop: 3 }}>
                      {baselineProgressPct}% READY
                    </div>
                  </div>
                </div>
              )}

              {/* Resting banner */}
              {sessionState === "resting" && (
                <div style={{
                  position: "absolute",
                  top: patientAlertVisible ? (tightLayout ? 96 : 84) : 16, left: "50%", transform: "translateX(-50%)",
                  background: "white",
                  border: `1px solid ${ACCENT.soft}`,
                  borderRadius: 8,
                  padding: "8px 16px",
                  display: "flex", alignItems: "center", gap: 14,
                  boxShadow: "0 1px 2px oklch(0 0 0 / 0.04)",
                  zIndex: 5,
                }}>
                  <span style={{
                    fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em",
                    textTransform: "uppercase", color: ACCENT.text, fontWeight: 600,
                  }}>Rest period</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 16, color: "oklch(0.18 0.01 240)", fontVariantNumeric: "tabular-nums" }}>
                    {formatElapsedTime(restRemainingSec)}
                  </span>
                  <span style={{ fontSize: 11, color: "oklch(0.55 0.01 240)" }}>
                    Set {currentSetIdx} of {prescription.sets} starts automatically
                  </span>
                </div>
              )}

              {/* 3-2-1 countdown overlay */}
              {sessionState === "countdown" && (
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  zIndex: 30, pointerEvents: "none",
                }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <span
                      key={countdownSec}
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: "6rem",
                        fontWeight: 900,
                        lineHeight: 1,
                        color: "white",
                        filter: "drop-shadow(0 4px 16px rgba(0,0,0,0.8))",
                        userSelect: "none",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {countdownSec}
                    </span>
                    <span style={{
                      fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.8)",
                      textTransform: "uppercase", letterSpacing: "0.2em",
                      filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.9))",
                    }}>
                      Get ready
                    </span>
                  </div>
                </div>
              )}

              {/* Post-session summary — recap of the just-finished session. Shown
                  in the "ended" state (last exercise complete, or a manual End;
                  the guided flow auto-advances between exercises otherwise). */}
              {sessionState === "ended" && (() => {
                const def = activeDefinition;
                const isIso = def?.kind === "isometric";
                const setsLog = completedSetsLogRef.current;
                const setsDone = setsLog.length;

                // Per-side tallies — NEVER summed (preserves the asymmetry signal).
                const L = repLogRef.current.left;
                const R = repLogRef.current.right;
                const lComplete = L.filter((e) => e.classification === "complete").length;
                const rComplete = R.filter((e) => e.classification === "complete").length;
                const peaks = [...L, ...R].map((e) => e.peakValue);
                const avgPeak = peaks.length ? peaks.reduce((a, b) => a + b, 0) / peaks.length : null;
                const isAngle = def && def.kind === "dynamic" ? def.primaryMetric.name !== "wristShoulderVertical" : true;
                const target = def && def.kind === "dynamic" ? def.primaryMetric.thresholds.targetROM : 0;
                const unit = isAngle ? "°" : "";
                const fmtVal = (v: number) => (isAngle ? `${Math.round(v)}` : v.toFixed(2));
                const avgAsym = setsDone ? setsLog.reduce((s, r) => s + r.asymmetryIndex, 0) / setsDone : 0;
                const asymLabel = avgAsym < 0.1 ? "Low" : avgAsym < 0.25 ? "Moderate" : "High";
                const heldMs = setsLog.reduce((s, r) => s + (r.pairedHoldMs ?? 0), 0);
                const targetMs = setsLog.reduce((s, r) => s + (r.targetHoldMs ?? 0), 0);
                // Side-split isometric (ex_004): per-side hold totals, shown
                // as separate rows — never merged into one number.
                const sideSplitIso = isIso && isSideSplitIsometric(def);
                const leftHeldMs = setsLog.reduce((s, r) => s + (r.leftHoldMs ?? 0), 0);
                const rightHeldMs = setsLog.reduce((s, r) => s + (r.rightHoldMs ?? 0), 0);
                const isPatient = prescription.patientExerciseId !== undefined;

                const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 14 };
                const labelStyle: CSSProperties = { color: "oklch(0.45 0.01 240)" };
                const valStyle: CSSProperties = { fontWeight: 600, color: "oklch(0.18 0.01 240)", fontVariantNumeric: "tabular-nums" };

                return (
                  <div style={{
                    position: "absolute", inset: 0, zIndex: 35,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "oklch(0.18 0.01 240 / 0.55)", padding: 16,
                  }}>
                    <div style={{
                      background: "white", borderRadius: 14, padding: "22px 24px",
                      width: "min(380px, 100%)", boxShadow: "0 8px 30px oklch(0 0 0 / 0.25)",
                    }}>
                      <div style={{
                        fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em",
                        textTransform: "uppercase", color: ACCENT.text, fontWeight: 700, marginBottom: 4,
                      }}>Session complete</div>
                      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", color: "oklch(0.18 0.01 240)", marginBottom: 16 }}>
                        {def?.name ?? "Exercise"}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
                        {sideSplitIso ? (
                          <>
                            <div style={rowStyle}><span style={labelStyle}>Left hold</span><span style={valStyle}>{Math.round(leftHeldMs / 1000)}s{targetMs ? ` / ${Math.round(targetMs / 1000)}s` : ""}</span></div>
                            <div style={rowStyle}><span style={labelStyle}>Right hold</span><span style={valStyle}>{Math.round(rightHeldMs / 1000)}s{targetMs ? ` / ${Math.round(targetMs / 1000)}s` : ""}</span></div>
                            <div style={rowStyle}><span style={labelStyle}>Asymmetry</span><span style={valStyle}>{asymLabel}</span></div>
                            <div style={rowStyle}><span style={labelStyle}>Sets</span><span style={valStyle}>{setsDone} / {prescription.sets}</span></div>
                          </>
                        ) : isIso ? (
                          <>
                            <div style={rowStyle}><span style={labelStyle}>Hold time</span><span style={valStyle}>{Math.round(heldMs / 1000)}s{targetMs ? ` / ${Math.round(targetMs / 1000)}s` : ""}</span></div>
                            <div style={rowStyle}><span style={labelStyle}>Sets</span><span style={valStyle}>{setsDone} / {prescription.sets}</span></div>
                          </>
                        ) : (
                          <>
                            <div style={rowStyle}><span style={labelStyle}>Left</span><span style={valStyle}>{lComplete}/{L.length} complete</span></div>
                            <div style={rowStyle}><span style={labelStyle}>Right</span><span style={valStyle}>{rComplete}/{R.length} complete</span></div>
                            {avgPeak !== null && (
                              <div style={rowStyle}><span style={labelStyle}>Avg peak</span><span style={valStyle}>{fmtVal(avgPeak)}{unit}{target ? ` · target ${fmtVal(target)}${unit}` : ""}</span></div>
                            )}
                            <div style={rowStyle}><span style={labelStyle}>Asymmetry</span><span style={valStyle}>{asymLabel}</span></div>
                            <div style={rowStyle}><span style={labelStyle}>Sets</span><span style={valStyle}>{setsDone} / {prescription.sets}</span></div>
                          </>
                        )}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <button
                          type="button"
                          onClick={handleSessionStart}
                          style={{
                            width: "100%", padding: "10px 12px",
                            background: ACCENT.hex, border: `1px solid ${ACCENT.hex}`, borderRadius: 6,
                            fontSize: 13, fontWeight: 600, color: "white", cursor: "pointer",
                          }}
                        >Redo</button>
                        {hasNextExercise && (
                          <button
                            type="button"
                            onClick={() => goToAdjacentExercise(1)}
                            style={{
                              width: "100%", padding: "10px 12px",
                              background: "white", border: `1px solid ${ACCENT.hex}`, borderRadius: 6,
                              fontSize: 13, fontWeight: 600, color: ACCENT.text, cursor: "pointer",
                            }}
                          >Next exercise →</button>
                        )}
                        {isPatient && (
                          <Link
                            href="/dashboard/patient"
                            style={{
                              width: "100%", padding: "10px 12px", textAlign: "center", textDecoration: "none",
                              background: "white", border: "1px solid oklch(0.90 0.003 240)", borderRadius: 6,
                              fontSize: 13, fontWeight: 500, color: "oklch(0.30 0.01 240)",
                            }}
                          >Back to schedule</Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* "Already completed" recap — shown on return to the camera page
                  when the selected exercise was finished in a prior visit. Built
                  from the persisted latest-finished session (the live in-memory
                  summary above is gone after the route unmounts). Dismissable. */}
              {showCompletedRecap && selectedRecap && (() => {
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
                const heldSec =
                  recap.totalPairedHoldMs != null
                    ? Math.round(recap.totalPairedHoldMs / 1000)
                    : 0;
                const targetSec =
                  recap.totalTargetHoldMs != null
                    ? Math.round(recap.totalTargetHoldMs / 1000)
                    : 0;

                const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 14 };
                const labelStyle: CSSProperties = { color: "oklch(0.45 0.01 240)" };
                const valStyle: CSSProperties = { fontWeight: 600, color: "oklch(0.18 0.01 240)", fontVariantNumeric: "tabular-nums" };

                return (
                  <div style={{
                    position: "absolute", inset: 0, zIndex: 35,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "oklch(0.18 0.01 240 / 0.55)", padding: 16,
                  }}>
                    <div style={{
                      position: "relative",
                      background: "white", borderRadius: 14, padding: "22px 24px",
                      width: "min(380px, 100%)", boxShadow: "0 8px 30px oklch(0 0 0 / 0.25)",
                    }}>
                      <button
                        type="button"
                        onClick={() => setRecapDismissed(true)}
                        aria-label="Dismiss"
                        style={{
                          position: "absolute", top: 12, right: 12,
                          width: 28, height: 28, display: "flex",
                          alignItems: "center", justifyContent: "center",
                          border: "1px solid oklch(0.90 0.003 240)", background: "white",
                          borderRadius: 6, color: "oklch(0.40 0.01 240)", cursor: "pointer",
                          fontSize: 15, lineHeight: 1,
                        }}
                      >✕</button>

                      <div style={{
                        fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em",
                        textTransform: "uppercase", color: "oklch(0.40 0.07 145)", fontWeight: 700, marginBottom: 4,
                      }}>Already completed</div>
                      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", color: "oklch(0.18 0.01 240)", marginBottom: 16, paddingRight: 28 }}>
                        {selectedExerciseObj?.name ?? activeDefinition?.name ?? "Exercise"}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
                        {isIso ? (
                          <div style={rowStyle}><span style={labelStyle}>Hold time</span><span style={valStyle}>{heldSec}s{targetSec ? ` / ${targetSec}s` : ""}</span></div>
                        ) : (
                          <>
                            <div style={rowStyle}><span style={labelStyle}>Left</span><span style={valStyle}>{recap.completeLeftReps}/{recap.leftReps} complete</span></div>
                            <div style={rowStyle}><span style={labelStyle}>Right</span><span style={valStyle}>{recap.completeRightReps}/{recap.rightReps} complete</span></div>
                          </>
                        )}
                        <div style={rowStyle}><span style={labelStyle}>Sets</span><span style={valStyle}>{recap.setCount} / {prescription.sets}</span></div>
                        <div style={rowStyle}><span style={labelStyle}>Duration</span><span style={valStyle}>{duration}</span></div>
                        <div style={rowStyle}><span style={labelStyle}>Finished</span><span style={valStyle}>{finishedAt}</span></div>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <button
                          type="button"
                          onClick={handleSessionStart}
                          style={{
                            width: "100%", padding: "10px 12px",
                            background: ACCENT.hex, border: `1px solid ${ACCENT.hex}`, borderRadius: 6,
                            fontSize: 13, fontWeight: 600, color: "white", cursor: "pointer",
                          }}
                        >Redo</button>
                        {hasNextExercise && (
                          <button
                            type="button"
                            onClick={() => goToAdjacentExercise(1)}
                            style={{
                              width: "100%", padding: "10px 12px",
                              background: "white", border: `1px solid ${ACCENT.hex}`, borderRadius: 6,
                              fontSize: 13, fontWeight: 600, color: ACCENT.text, cursor: "pointer",
                            }}
                          >Next exercise →</button>
                        )}
                        {isPatient && (
                          <Link
                            href="/dashboard/patient"
                            style={{
                              width: "100%", padding: "10px 12px", textAlign: "center", textDecoration: "none",
                              background: "white", border: "1px solid oklch(0.90 0.003 240)", borderRadius: 6,
                              fontSize: 13, fontWeight: 500, color: "oklch(0.30 0.01 240)",
                            }}
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
              {showResumePrompt && resumeSnap && (() => {
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

                const rowStyle: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 14 };
                const labelStyle: CSSProperties = { color: "oklch(0.45 0.01 240)" };
                const valStyle: CSSProperties = { fontWeight: 600, color: "oklch(0.18 0.01 240)", fontVariantNumeric: "tabular-nums" };

                return (
                  <div style={{
                    position: "absolute", inset: 0, zIndex: 35,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "oklch(0.18 0.01 240 / 0.55)", padding: 16,
                  }}>
                    <div style={{
                      position: "relative",
                      background: "white", borderRadius: 14, padding: "22px 24px",
                      width: "min(380px, 100%)", boxShadow: "0 8px 30px oklch(0 0 0 / 0.25)",
                    }}>
                      <button
                        type="button"
                        onClick={() => setResumeDismissed(true)}
                        aria-label="Dismiss"
                        style={{
                          position: "absolute", top: 12, right: 12,
                          width: 28, height: 28, display: "flex",
                          alignItems: "center", justifyContent: "center",
                          border: "1px solid oklch(0.90 0.003 240)", background: "white",
                          borderRadius: 6, color: "oklch(0.40 0.01 240)", cursor: "pointer",
                          fontSize: 15, lineHeight: 1,
                        }}
                      >✕</button>

                      <div style={{
                        fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em",
                        textTransform: "uppercase", color: "oklch(0.48 0.13 75)", fontWeight: 700, marginBottom: 4,
                      }}>Session in progress</div>
                      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", color: "oklch(0.18 0.01 240)", marginBottom: 16, paddingRight: 28 }}>
                        {selectedExerciseObj?.name ?? activeDefinition?.name ?? "Exercise"}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
                        <div style={rowStyle}><span style={labelStyle}>Set</span><span style={valStyle}>{snap.completedSets + 1} of {prescription.sets}</span></div>
                        {sideSplitIso ? (
                          <div style={rowStyle}><span style={labelStyle}>Hold</span><span style={valStyle}>L {leftHeldSec}s · R {rightHeldSec}s</span></div>
                        ) : isIso ? (
                          <div style={rowStyle}><span style={labelStyle}>Hold</span><span style={valStyle}>{heldSec}s</span></div>
                        ) : (
                          <div style={rowStyle}><span style={labelStyle}>Reps</span><span style={valStyle}>L {snap.currentSetReps.left} · R {snap.currentSetReps.right}</span></div>
                        )}
                        <div style={rowStyle}><span style={labelStyle}>Elapsed</span><span style={valStyle}>{elapsed}</span></div>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <button
                          type="button"
                          onClick={resumeSession}
                          style={{
                            width: "100%", padding: "10px 12px",
                            background: ACCENT.hex, border: `1px solid ${ACCENT.hex}`, borderRadius: 6,
                            fontSize: 13, fontWeight: 600, color: "white", cursor: "pointer",
                          }}
                        >Resume</button>
                        <button
                          type="button"
                          onClick={() => {
                            clearResumeSnapshot(snap.patientExerciseId);
                            handleSessionStart();
                          }}
                          style={{
                            width: "100%", padding: "10px 12px",
                            background: "white", border: "1px solid oklch(0.90 0.003 240)", borderRadius: 6,
                            fontSize: 13, fontWeight: 500, color: "oklch(0.30 0.01 240)", cursor: "pointer",
                          }}
                        >Start over</button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Stat strip — patient-facing distance readouts */}
              <ClinicalStatStrip
                score={score}
                tier={tier}
                activeDefinition={activeDefinition}
                repCounts={repCounts}
                holdState={holdState}
                timer={timer}
                prescription={prescription}
                sessionState={sessionState}
                currentSetIdx={currentSetIdx}
                compact={compactLayout}
              />
            </div>

            {/* Set progress strip */}
            <ClinicalProgressStrip
              sessionState={sessionState}
              currentSetIdx={currentSetIdx}
              prescription={prescription}
              completedSets={completedSets}
              progressPct={progressPct}
              compact={compactLayout}
            />
          </main>

          {/* RIGHT RAIL — controls + reference */}
          <aside style={{
            background: "white",
            borderLeft: "1px solid oklch(0.93 0.003 240)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: compactLayout ? "visible" : "hidden",
            order: compactLayout ? 3 : 0,
          }}>
            {/* Exercise stepper */}
            <div style={{ padding: "16px 16px 14px", borderBottom: "1px solid oklch(0.93 0.003 240)" }}>
              <div style={{
                fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em",
                textTransform: "uppercase", color: "oklch(0.40 0.01 240)", fontWeight: 600,
                marginBottom: 10,
              }}>Session</div>

              {assignedExercises.length === 0 ? (
                <div style={{
                  padding: "8px 10px", borderRadius: 6,
                  background: "oklch(0.97 0.03 80)", border: "1px solid oklch(0.90 0.06 80)",
                  fontSize: 12, color: "oklch(0.40 0.08 75)",
                }}>
                  No exercises assigned yet.
                </div>
              ) : (
                <div id="cam-tour-exercise" style={{ display: "flex", alignItems: "stretch", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => goToAdjacentExercise(-1)}
                    disabled={!hasPrevExercise || sessionBusy}
                    aria-label="Previous exercise"
                    style={{ ...clinicalNavBtnStyle(), opacity: (!hasPrevExercise || sessionBusy) ? 0.35 : 1 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M15 18l-6-6 6-6"/>
                    </svg>
                  </button>
                  <div style={{
                    flex: 1, padding: "12px 14px", borderRadius: 8,
                    border: `1px solid ${ACCENT.soft}`, background: "white",
                  }}>
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      gap: 8, marginBottom: 4,
                    }}>
                      <span style={{
                        fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em",
                        textTransform: "uppercase", color: ACCENT.text, fontWeight: 600,
                      }}>
                        {selectedExerciseIndex >= 0
                          ? `Exercise ${selectedExerciseIndex + 1} / ${assignedExercises.length}`
                          : `${assignedExercises.length} exercises`}
                      </span>
                      {selectedExerciseCompleted ? (
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 3,
                          flexShrink: 0, fontSize: 10, fontWeight: 700, letterSpacing: ".04em",
                          padding: "2px 7px", borderRadius: 999,
                          background: "oklch(0.96 0.04 145)", color: "oklch(0.40 0.07 145)",
                          border: "1px solid oklch(0.88 0.06 145)",
                        }}>✓ Completed</span>
                      ) : resumeEligible ? (
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          flexShrink: 0, fontSize: 10, fontWeight: 700, letterSpacing: ".04em",
                          padding: "2px 7px", borderRadius: 999,
                          background: "oklch(0.96 0.05 75)", color: "oklch(0.45 0.13 70)",
                          border: "1px solid oklch(0.88 0.08 75)",
                        }}>● In progress</span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", color: "oklch(0.18 0.01 240)" }}>
                      {selectedExerciseObj?.name ?? "—"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => goToAdjacentExercise(1)}
                    disabled={!hasNextExercise || sessionBusy}
                    aria-label="Next exercise"
                    style={{ ...clinicalNavBtnStyle(), opacity: (!hasNextExercise || sessionBusy) ? 0.35 : 1 }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  </button>
                </div>
              )}

              {selectedExerciseObj && (
                <>
                  <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12.5, lineHeight: 1.5, color: "oklch(0.40 0.01 240)" }}>
                    {selectedExerciseObj.description}
                  </p>
                  <div style={{
                    marginTop: 10, display: "flex", alignItems: "center", gap: 14,
                    fontFamily: "var(--mono)", fontSize: 11, color: "oklch(0.50 0.01 240)",
                  }}>
                    <span>{prescription.sets} sets</span>
                    <span style={{ color: "oklch(0.85 0.003 240)" }}>·</span>
                    <span>{prescriptionTargetText}</span>
                    <span style={{ color: "oklch(0.85 0.003 240)" }}>·</span>
                    <span>{prescription.restSeconds}s rest</span>
                  </div>
                  {activeDefinition?.id === "ex_007" &&
                    prescription.patientExerciseId !== undefined && (
                      <div style={{
                        marginTop: 10,
                        padding: "8px 10px",
                        borderRadius: 6,
                        background: ACCENT.soft,
                        color: ACCENT.text,
                        fontSize: 11,
                        lineHeight: 1.45,
                      }}>
                        <strong>Motion trace recording:</strong> raw upper-body
                        metrics and pose landmarks only. No video is stored.
                      </div>
                    )}
                </>
              )}
            </div>

            {/* Reference guidance */}
            <div style={{ padding: "14px 16px", borderBottom: "1px solid oklch(0.93 0.003 240)" }}>
              <div style={{ marginBottom: 10 }}>
                <span style={{
                  fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em",
                  textTransform: "uppercase", color: "oklch(0.40 0.01 240)", fontWeight: 600,
                }}>Reference guidance</span>
              </div>
              <div style={{ borderRadius: 6, padding: "12px", background: "oklch(0.97 0.003 240)", border: "1px solid oklch(0.92 0.003 240)", color: "oklch(0.42 0.01 240)", fontSize: 11.5, lineHeight: 1.5 }}>
                No verified demonstration video is published for this exercise yet.
                Follow the written exercise description and your therapist&apos;s instructions.
              </div>
            </div>

            {/* Capture settings */}
            <div style={{ padding: "14px 16px", borderBottom: "1px solid oklch(0.93 0.003 240)" }}>
              <div style={{
                fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em",
                textTransform: "uppercase", color: "oklch(0.40 0.01 240)", fontWeight: 600,
                marginBottom: 10,
              }}>Capture</div>

              <label style={{ display: "block", fontSize: 11, color: "oklch(0.45 0.01 240)", marginBottom: 4 }}>Device</label>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                style={{
                  width: "100%", padding: "8px 10px",
                  border: "1px solid oklch(0.90 0.003 240)",
                  borderRadius: 6, fontSize: 12, color: "oklch(0.25 0.01 240)",
                  background: "white", marginBottom: 12,
                }}
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

            {/* Session controls */}
            <div id="cam-tour-session" style={{ padding: 16, marginTop: "auto" }}>
              {sessionState === "resting" ? (
                <>
                  <div style={{
                    padding: 12, borderRadius: 8,
                    background: ACCENT.soft,
                    marginBottom: 10, textAlign: "center",
                  }}>
                    <div style={{
                      fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em",
                      textTransform: "uppercase", color: ACCENT.text, fontWeight: 600, marginBottom: 4,
                    }}>Rest</div>
                    <div style={{
                      fontFamily: "var(--mono)", fontSize: 32, fontWeight: 500,
                      color: ACCENT.text, fontVariantNumeric: "tabular-nums", lineHeight: 1,
                    }}>{formatElapsedTime(restRemainingSec)}</div>
                    <div style={{ fontSize: 11, color: ACCENT.text, marginTop: 4, opacity: 0.8 }}>
                      Next set starts automatically
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={skipRest}
                      style={{
                        flex: 1, padding: "8px 12px",
                        border: "1px solid oklch(0.90 0.003 240)", background: "white",
                        borderRadius: 6, fontSize: 12, fontWeight: 500,
                        color: "oklch(0.30 0.01 240)", cursor: "pointer",
                      }}
                    >Skip rest</button>
                    <button
                      type="button"
                      onClick={handleSessionEnd}
                      style={{
                        flex: 1, padding: "8px 12px",
                        background: "oklch(0.55 0.17 25)", border: "1px solid oklch(0.55 0.17 25)",
                        borderRadius: 6, fontSize: 12, fontWeight: 500,
                        color: "white", cursor: "pointer",
                      }}
                    >End</button>
                  </div>
                </>
              ) : sessionState === "active" && confirmingEnd ? (
                <div style={{
                  padding: 12, borderRadius: 8,
                  background: "oklch(0.97 0.03 80)", border: "1px solid oklch(0.90 0.06 80)",
                }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "oklch(0.35 0.08 75)", margin: "0 0 4px" }}>
                    End this exercise early?
                  </p>
                  <p style={{ fontSize: 11, color: "oklch(0.42 0.07 75)", margin: "0 0 10px" }}>
                    The current set won&apos;t count as complete.
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => { handleSessionEnd(); setConfirmingEnd(false); }}
                      style={{
                        flex: 1, padding: "8px 12px",
                        background: "oklch(0.55 0.17 25)", border: "1px solid oklch(0.55 0.17 25)",
                        borderRadius: 6, fontSize: 12, fontWeight: 500,
                        color: "white", cursor: "pointer",
                      }}
                    >Yes, end</button>
                    <button
                      type="button"
                      onClick={() => setConfirmingEnd(false)}
                      style={{
                        flex: 1, padding: "8px 12px",
                        border: "1px solid oklch(0.90 0.003 240)", background: "white",
                        borderRadius: 6, fontSize: 12, fontWeight: 500,
                        color: "oklch(0.30 0.01 240)", cursor: "pointer",
                      }}
                    >Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={handleSessionStart}
                    disabled={!activeDefinition || blockedBySchedule || sessionState === "active" || sessionState === "countdown"}
                    style={{
                      flex: 1, padding: "10px 12px",
                      background: (sessionState === "active" || sessionState === "countdown") ? "white" : ACCENT.hex,
                      color: (sessionState === "active" || sessionState === "countdown") ? "oklch(0.30 0.01 240)" : "white",
                      border: (sessionState === "active" || sessionState === "countdown") ? "1px solid oklch(0.90 0.003 240)" : `1px solid ${ACCENT.hex}`,
                      borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: "pointer",
                      opacity: (!activeDefinition || blockedBySchedule || sessionState === "active" || sessionState === "countdown") ? 0.5 : 1,
                    }}
                  >
                    {sessionState === "ended"
                      ? "Restart"
                      : sessionState === "countdown"
                        ? `Starting… (${countdownSec})`
                        : blockedBySchedule
                          ? "Not scheduled today"
                          : "Start session"}
                  </button>
                  <button
                    onClick={() => {
                      if (sessionState === "countdown") {
                        handleSessionEnd();
                      } else {
                        setConfirmingEnd(true);
                      }
                    }}
                    disabled={sessionState !== "active" && sessionState !== "countdown"}
                    style={{
                      flex: 1, padding: "10px 12px",
                      background: "white", color: "oklch(0.30 0.01 240)",
                      border: "1px solid oklch(0.90 0.003 240)",
                      borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: "pointer",
                      opacity: (sessionState !== "active" && sessionState !== "countdown") ? 0.4 : 1,
                    }}
                  >End</button>
                </div>
              )}

              {(blockedBySchedule || scheduleNotice) && sessionState !== "active" && sessionState !== "countdown" && (
                <p style={{ marginTop: 8, fontSize: 12, color: "oklch(0.55 0.14 45)", lineHeight: 1.4 }}>
                  {scheduleNotice ??
                    "Not scheduled today — start this exercise from your schedule on its due day."}
                </p>
              )}

              {sessionState === "ended" && hasNextExercise && (
                <button
                  type="button"
                  onClick={() => goToAdjacentExercise(1)}
                  style={{
                    marginTop: 8, width: "100%", padding: "10px 12px",
                    background: ACCENT.hex, border: `1px solid ${ACCENT.hex}`,
                    borderRadius: 6, fontSize: 13, fontWeight: 500,
                    color: "white", cursor: "pointer",
                  }}
                >
                  Next exercise →
                </button>
              )}
            </div>
          </aside>
        </div>
      </div>

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
  title: string;
  lines: string[];
  placement: "below" | "above" | "right" | "left";
  /** Override estimated card height (px) used for "above"/"right"/"left" placement */
  cardH?: number;
  /** Extra gap (px) between card and target for "above" placement (default 16) */
  aboveGap?: number;
}[] = [
  {
    targetId: "cam-tour-start",
    title: "Start Camera",
    placement: "below",
    lines: [
      "Click this button to turn on your camera.",
      "Your browser will ask permission — click Allow when prompted.",
      "The camera view will appear in the centre of the screen once ready.",
      "Check that both status dots (AI ready & Capture OK) are green before continuing.",
    ],
  },
  {
    targetId: "cam-tour-status",
    title: "Status Indicators",
    placement: "below",
    lines: [
      "AI ready (green dot) — the movement detection engine is loaded.",
      "Capture OK (green dot) — the app can see your body clearly.",
      "If a dot is orange, adjust your position or lighting until both turn green.",
      "Never start a session while a dot is still orange.",
    ],
  },
  {
    targetId: "cam-tour-exercise",
    title: "Your Assigned Exercise",
    placement: "left",
    lines: [
      "This card shows the exercise assigned to you by your therapist.",
      "Use the left ( ‹ ) and right ( › ) arrows to move between exercises.",
      "The exercise name, sets, reps, and rest time are displayed in the card.",
      "Make sure you select the right exercise before starting your session.",
    ],
  },
  {
    targetId: "cam-tour-feed",
    anchorId: "cam-tour-metrics",
    title: "Camera View — Position Yourself Here",
    placement: "right",
    lines: [
      "Stand or sit about 1–2 metres (3–6 feet) from the camera.",
      "Make sure your full upper body — head to hips — is visible on screen.",
      "A green skeleton outline appears when the app can track you correctly.",
      "Good lighting helps. Avoid a bright window directly behind you.",
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
    lines: [
      "Wear light or contrasting colours — dark clothing on a dark background makes it hard for the AI to track your joints.",
      "Face the light source (window or lamp). A bright light behind you silhouettes your body and reduces tracking accuracy.",
      "Clear the area behind you — plain or lightly patterned walls work best. Busy wallpaper or moving objects confuse the system.",
      "Make sure the room is well lit. Low light causes the camera to produce noise that reduces pose detection quality.",
      "Keep about 1–2 metres of free space in front of the camera so your full upper body stays in frame as you move.",
    ],
  },
  {
    targetId: "cam-tour-session",
    title: "Start Session & End",
    placement: "above",
    cardH: 300,
    aboveGap: 100,
    lines: [
      "Press Start session when both status dots are green and you are ready.",
      "A 3-2-1 countdown gives you time to get into position before counting begins.",
      "Press End at any time to stop the exercise early — your progress is still saved.",
      "After finishing all sets, the session saves automatically and is sent to your therapist.",
      "Not happy with your performance? Press Restart button to redo the exercise — your therapist will see the latest attempt.",
    ],
  },
];

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

  useEffect(() => {
    const refresh = () => {
      const el = document.getElementById(def.targetId);
      setRect(el ? el.getBoundingClientRect() : null);
      const anchor = def.anchorId ? document.getElementById(def.anchorId) : null;
      setAnchorRect(anchor ? anchor.getBoundingClientRect() : null);
    };
    refresh();
    window.addEventListener("resize", refresh);
    return () => window.removeEventListener("resize", refresh);
  }, [def.targetId, def.anchorId]);

  const PAD = 8; // spotlight padding around target
  const CARD_W = 360;

  // Spotlight ring — always follows targetId
  const spot = rect
    ? {
        x: rect.left - PAD,
        y: rect.top - PAD,
        w: rect.width + PAD * 2,
        h: rect.height + PAD * 2,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
      }
    : null;

  // Card anchor — anchorId when provided, otherwise targetId
  const aRect = anchorRect ?? rect;
  const anchor = aRect
    ? {
        x: aRect.left - PAD,
        y: aRect.top - PAD,
        w: aRect.width + PAD * 2,
        h: aRect.height + PAD * 2,
        cx: aRect.left + aRect.width / 2,
        cy: aRect.top + aRect.height / 2,
      }
    : null;

  // Card position: default center, then adjust based on placement + anchor
  let cardStyle: CSSProperties = {
    position: "fixed",
    zIndex: 62,
    width: CARD_W,
    maxWidth: "calc(100vw - 32px)",
    background: "white",
    borderRadius: 14,
    boxShadow: "0 12px 40px oklch(0 0 0 / 0.22)",
    overflow: "hidden",
  };

  // Arrow: which side of the card points toward the target
  let arrowSide: "top" | "bottom" | "left" | "right" = "top";

  if (anchor) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardH = def.cardH ?? 260;

    if (def.placement === "below") {
      const top = anchor.y + anchor.h + 16;
      let left = anchor.cx - CARD_W / 2;
      left = Math.max(16, Math.min(left, vw - CARD_W - 16));
      cardStyle = { ...cardStyle, top, left };
      arrowSide = "top";
    } else if (def.placement === "above") {
      const gap = def.aboveGap ?? 16;
      const top = Math.max(16, anchor.y - cardH - gap);
      let left = anchor.cx - CARD_W / 2;
      left = Math.max(16, Math.min(left, vw - CARD_W - 16));
      cardStyle = { ...cardStyle, top, left };
      arrowSide = "bottom";
    } else if (def.placement === "right") {
      const top = Math.max(16, Math.min(anchor.cy - cardH / 2, vh - cardH - 16));
      const left = Math.min(anchor.x + anchor.w + 16, vw - CARD_W - 16);
      cardStyle = { ...cardStyle, top, left };
      arrowSide = "left";
    } else {
      // left: card sits to the left of anchor
      const top = Math.max(16, Math.min(anchor.cy - cardH / 2, vh - cardH - 16));
      const left = Math.max(16, anchor.x - CARD_W - 16);
      cardStyle = { ...cardStyle, top, left };
      arrowSide = "right";
    }
  } else {
    // Fallback: center
    cardStyle = {
      ...cardStyle,
      top: "50%",
      left: "50%",
      transform: "translate(-50%,-50%)",
    };
  }

  const arrowSize = 10;
  const arrowColor = ACCENT.hex;

  const arrowEl: Record<"top" | "bottom" | "left" | "right", CSSProperties> = {
    top: {
      position: "absolute", top: -arrowSize, left: "50%",
      transform: "translateX(-50%)",
      width: 0, height: 0,
      borderLeft: `${arrowSize}px solid transparent`,
      borderRight: `${arrowSize}px solid transparent`,
      borderBottom: `${arrowSize}px solid ${arrowColor}`,
    },
    bottom: {
      position: "absolute", bottom: -arrowSize, left: "50%",
      transform: "translateX(-50%)",
      width: 0, height: 0,
      borderLeft: `${arrowSize}px solid transparent`,
      borderRight: `${arrowSize}px solid transparent`,
      borderTop: `${arrowSize}px solid ${arrowColor}`,
    },
    left: {
      position: "absolute", left: -arrowSize, top: "50%",
      transform: "translateY(-50%)",
      width: 0, height: 0,
      borderTop: `${arrowSize}px solid transparent`,
      borderBottom: `${arrowSize}px solid transparent`,
      borderRight: `${arrowSize}px solid ${arrowColor}`,
    },
    right: {
      position: "absolute", right: -arrowSize, top: "50%",
      transform: "translateY(-50%)",
      width: 0, height: 0,
      borderTop: `${arrowSize}px solid transparent`,
      borderBottom: `${arrowSize}px solid transparent`,
      borderLeft: `${arrowSize}px solid ${arrowColor}`,
    },
  };

  return (
    <>
      {/* Dim overlay — no blur, with transparent cutout via SVG */}
      <svg
        style={{ position: "fixed", inset: 0, zIndex: 60, pointerEvents: "none" }}
        width="100%"
        height="100%"
      >
        <defs>
          <mask id="tour-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {spot && (
              <rect
                x={spot.x} y={spot.y}
                width={spot.w} height={spot.h}
                rx={8} ry={8}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%" height="100%"
          fill="rgba(0,0,0,0.45)"
          mask="url(#tour-spotlight-mask)"
        />
      </svg>

      {/* Pulsing highlight ring around target */}
      {spot && (
        <div
          style={{
            position: "fixed",
            zIndex: 61,
            left: spot.x, top: spot.y,
            width: spot.w, height: spot.h,
            borderRadius: 8,
            border: `2px solid ${ACCENT.hex}`,
            boxShadow: `0 0 0 3px ${ACCENT.hex}40, 0 0 16px ${ACCENT.hex}60`,
            pointerEvents: "none",
            animation: "tour-pulse 1.6s ease-in-out infinite",
          }}
        />
      )}

      {/* Backdrop click to close */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 60 }}
        onClick={onClose}
      />

      {/* Tooltip card */}
      <div style={{ ...cardStyle, position: "fixed", zIndex: 62 }}>
        {/* Arrow */}
        {spot && <div style={arrowEl[arrowSide]} />}

        {/* Header */}
        <div style={{
          background: ACCENT.hex,
          padding: "14px 16px 12px",
          position: "relative",
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
            <div style={{ fontSize: 15, fontWeight: 700, color: "white", lineHeight: 1.25 }}>
              {def.title}
            </div>
          </div>
          <button
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
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "14px 16px 10px" }}>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
            {def.lines.map((line, i) => (
              <li key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{
                  flexShrink: 0, marginTop: 4,
                  width: 6, height: 6, borderRadius: 99,
                  background: ACCENT.hex, display: "inline-block",
                }} />
                <span style={{ fontSize: 12.5, color: "oklch(0.22 0.01 240)", lineHeight: 1.55 }}>{line}</span>
              </li>
            ))}
          </ul>
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
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
                  <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                </svg>
              </button>
            ) : (
              <button
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

      {/* Keyframe animation injected once */}
      <style>{`
        @keyframes tour-pulse {
          0%, 100% { box-shadow: 0 0 0 3px ${ACCENT.hex}40, 0 0 14px ${ACCENT.hex}50; }
          50%       { box-shadow: 0 0 0 6px ${ACCENT.hex}25, 0 0 24px ${ACCENT.hex}70; }
        }
      `}</style>
    </>
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

function ClinicalStatusDot({ ok }: { ok: boolean }) {
  return (
    <span style={{
      display: "inline-block",
      width: 6, height: 6, borderRadius: 999,
      background: ok ? "oklch(0.65 0.13 145)" : "oklch(0.70 0.13 60)",
      boxShadow: ok
        ? "0 0 0 3px oklch(0.65 0.13 145 / 0.18)"
        : "0 0 0 3px oklch(0.70 0.13 60 / 0.18)",
    }} />
  );
}

function ClinicalCornerTicks() {
  const tick = (style: CSSProperties) => (
    <div style={{
      position: "absolute",
      width: 18, height: 18,
      borderColor: "oklch(0.95 0.005 240 / 0.5)",
      borderStyle: "solid",
      ...style,
    }}/>
  );
  return (
    <>
      {tick({ top: 18, left: 18, borderWidth: "1px 0 0 1px" })}
      {tick({ top: 18, right: 18, borderWidth: "1px 1px 0 0" })}
      {tick({ bottom: 18, left: 18, borderWidth: "0 0 1px 1px" })}
      {tick({ bottom: 18, right: 18, borderWidth: "0 1px 1px 0" })}
    </>
  );
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

  const displayValue = card.value === null ? "—" : Math.abs(card.value).toFixed(1);
  const warnLabel = metricWarnLabel(card.key);
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
        {displayValue !== "—" && (
          <span style={{ fontSize: 14, color: "oklch(0.60 0.01 240)", marginLeft: 1 }}>°</span>
        )}
      </div>
    </div>
  );
}

function ClinicalStatStrip({
  score, tier, activeDefinition, repCounts, holdState,
  timer, prescription, sessionState, currentSetIdx, compact,
}: {
  score: number | null;
  tier: ScoreTier;
  activeDefinition: ExerciseDefinition | null;
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
  sessionState: SessionState;
  currentSetIdx: number;
  compact: boolean;
}) {
  const labelSt: CSSProperties = {
    fontFamily: "var(--mono)", fontSize: 12, letterSpacing: ".18em",
    textTransform: "uppercase", color: "oklch(0.40 0.01 240)",
    marginBottom: 6, fontWeight: 700,
  };
  const numSt: CSSProperties = {
    fontFamily: "var(--mono)", fontSize: 44, fontWeight: 600,
    letterSpacing: "-0.03em", color: "oklch(0.12 0.01 240)",
    fontVariantNumeric: "tabular-nums", lineHeight: 1,
  };
  const divider = (
    <div
      style={compact
        ? { height: 1, background: "oklch(0.93 0.003 240)" }
        : { width: 1, background: "oklch(0.93 0.003 240)" }}
    />
  );

  let repsContent: React.ReactNode;
  if (activeDefinition?.kind === "isometric" && isSideSplitIsometric(activeDefinition)) {
    // Side-split isometric (ex_004): per-side hold times, split-panel style —
    // the same L/R convention as bilateral rep counting, never merged into
    // one number (the asymmetry between sides is the clinical signal).
    const leftSec = Math.floor(holdState.leftSec);
    const rightSec = Math.floor(holdState.rightSec);
    const leftDone = leftSec >= prescription.holdSeconds;
    const rightDone = rightSec >= prescription.holdSeconds;
    repsContent = (
      <div style={{ padding: "14px 18px", flex: "1.4 1 0", minWidth: 0 }}>
        <div style={{ ...labelSt, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Hold</span>
          <span style={{ fontWeight: 500, fontSize: 11, color: "oklch(0.55 0.01 240)" }}>/ {prescription.holdSeconds}s side</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, lineHeight: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{
              fontFamily: "var(--mono)", fontSize: 11, letterSpacing: ".18em",
              textTransform: "uppercase", color: "oklch(0.50 0.01 240)", fontWeight: 700,
            }}>L</span>
            <span style={{ ...numSt, color: leftDone ? ACCENT.hex : "oklch(0.12 0.01 240)" }}>
              {leftSec}
              <span style={{ fontSize: 18, fontWeight: 500 }}>s</span>
            </span>
          </div>
          <span style={{ fontSize: 24, color: "oklch(0.85 0.003 240)", fontWeight: 300 }}>·</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{
              fontFamily: "var(--mono)", fontSize: 11, letterSpacing: ".18em",
              textTransform: "uppercase", color: "oklch(0.50 0.01 240)", fontWeight: 700,
            }}>R</span>
            <span style={{ ...numSt, color: rightDone ? ACCENT.hex : "oklch(0.12 0.01 240)" }}>
              {rightSec}
              <span style={{ fontSize: 18, fontWeight: 500 }}>s</span>
            </span>
          </div>
        </div>
      </div>
    );
  } else if (activeDefinition?.kind === "isometric") {
    const holdSec = Math.floor(holdState.pairedSec);
    const done = holdSec >= prescription.holdSeconds;
    repsContent = (
      <div style={{ padding: "14px 18px", flex: "1.4 1 0", minWidth: 0 }}>
        <div style={labelSt}>Hold</div>
        <div style={{ ...numSt, color: done ? ACCENT.hex : "oklch(0.12 0.01 240)" }}>
          {formatElapsedTime(holdSec)}
        </div>
        <div style={{
          marginTop: 6, fontFamily: "var(--mono)", fontSize: 11,
          letterSpacing: ".14em", textTransform: "uppercase",
          color: done ? ACCENT.text : "oklch(0.50 0.01 240)", fontWeight: 600,
        }}>target {prescription.holdSeconds}s</div>
      </div>
    );
  } else if (activeDefinition?.bilateral) {
    const leftDone = repCounts.left >= prescription.reps;
    const rightDone = repCounts.right >= prescription.reps;
    repsContent = (
      <div style={{ padding: "14px 18px", flex: "1.4 1 0", minWidth: 0 }}>
        <div style={{ ...labelSt, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Reps</span>
          <span style={{ fontWeight: 500, fontSize: 11, color: "oklch(0.55 0.01 240)" }}>/ {prescription.reps}</span>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, lineHeight: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{
              fontFamily: "var(--mono)", fontSize: 11, letterSpacing: ".18em",
              textTransform: "uppercase", color: "oklch(0.50 0.01 240)", fontWeight: 700,
            }}>L</span>
            <span style={{ ...numSt, color: leftDone ? ACCENT.hex : "oklch(0.12 0.01 240)" }}>
              {repCounts.left}
            </span>
          </div>
          <span style={{ fontSize: 24, color: "oklch(0.85 0.003 240)", fontWeight: 300 }}>·</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{
              fontFamily: "var(--mono)", fontSize: 11, letterSpacing: ".18em",
              textTransform: "uppercase", color: "oklch(0.50 0.01 240)", fontWeight: 700,
            }}>R</span>
            <span style={{ ...numSt, color: rightDone ? ACCENT.hex : "oklch(0.12 0.01 240)" }}>
              {repCounts.right}
            </span>
          </div>
        </div>
      </div>
    );
  } else {
    const singleReps = repCounts.left + repCounts.right;
    const done = activeDefinition?.kind === "dynamic" && singleReps >= prescription.reps;
    repsContent = (
      <div style={{ padding: "14px 18px", flex: "1.4 1 0", minWidth: 0 }}>
        <div style={{ ...labelSt, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Reps</span>
          {activeDefinition?.kind === "dynamic" && (
            <span style={{ fontWeight: 500, fontSize: 11, color: "oklch(0.55 0.01 240)" }}>/ {prescription.reps}</span>
          )}
        </div>
        <div style={{ ...numSt, color: done ? ACCENT.hex : "oklch(0.12 0.01 240)" }}>
          {activeDefinition ? singleReps : "—"}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", left: 16, right: 16, bottom: 16, pointerEvents: "none" }}>
      <div style={{
        background: "oklch(1 0 0 / 0.96)",
        backdropFilter: "blur(10px)",
        border: "1px solid oklch(0.92 0.003 240)",
        borderRadius: 8,
        display: "flex",
        flexDirection: compact ? "column" : "row",
        pointerEvents: "auto",
        boxShadow: "0 1px 3px oklch(0 0 0 / 0.06)",
        overflow: "hidden",
        width: "100%",
      }}>
        <div style={{
          padding: "14px 18px", minWidth: 0,
          borderLeft: `4px solid ${tier.hex}`,
          background: "oklch(0.985 0.003 240)",
          flex: "1 1 0",
        }}>
          <div style={labelSt}>Posture</div>
          <div style={numSt}>{score ?? "—"}</div>
          <div style={{
            marginTop: 6, fontFamily: "var(--mono)", fontSize: 11,
            letterSpacing: ".14em", textTransform: "uppercase",
            color: tier.text, fontWeight: 700,
          }}>{tier.label}</div>
        </div>
        {divider}
        {repsContent}
        {divider}
        <div style={{ padding: "14px 18px", flex: "0.85 1 0", minWidth: 0 }}>
          <div style={labelSt}>Time</div>
          <div style={{ ...numSt, whiteSpace: "nowrap" }}>
            {(sessionState === "idle" || sessionState === "countdown") ? "00:00" : timer}
          </div>
          <div style={{
            marginTop: 6, fontFamily: "var(--mono)", fontSize: 11,
            letterSpacing: ".14em", textTransform: "uppercase",
            color: "oklch(0.50 0.01 240)", fontWeight: 600,
          }}>Set {currentSetIdx} / {prescription.sets}</div>
        </div>
      </div>
    </div>
  );
}

function ClinicalProgressStrip({
  sessionState, currentSetIdx, prescription, completedSets, progressPct, compact,
}: {
  sessionState: SessionState;
  currentSetIdx: number;
  prescription: Prescription;
  completedSets: number;
  progressPct: number;
  compact: boolean;
}) {
  const label =
    sessionState === "ended"
      ? completedSets >= prescription.sets
        ? "Session complete"
        : `Ended at set ${completedSets} / ${prescription.sets}`
      : sessionState === "countdown"
        ? `Starting set ${currentSetIdx} of ${prescription.sets}`
        : sessionState === "active"
      ? `Set ${currentSetIdx} of ${prescription.sets}`
      : sessionState === "resting"
        ? `Rest — next: Set ${currentSetIdx} of ${prescription.sets}`
        : `Ready — ${prescription.sets} sets`;

  return (
    <div style={{
      marginTop: 12,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: compact ? "wrap" : "nowrap",
      gap: 16,
      padding: "10px 14px",
      background: "white",
      border: "1px solid oklch(0.93 0.003 240)",
      borderRadius: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span style={{
          fontFamily: "var(--mono)", fontSize: 10, letterSpacing: ".14em",
          textTransform: "uppercase", color: "oklch(0.40 0.01 240)", fontWeight: 600,
        }}>{label}</span>
        <div style={{ display: "flex", gap: 5 }}>
          {Array.from({ length: prescription.sets }).map((_, i) => {
            const done = i < completedSets;
            const current =
              i === completedSets && sessionState !== "idle" && sessionState !== "ended";
            const lit = done || (current && sessionState === "active");
            return (
              <span key={i} style={{
                width: 32, height: 10, borderRadius: 5, display: "inline-block",
                background: done ? NEON.hex : current ? NEON.dim : "oklch(0.92 0.003 240)",
                boxShadow: lit ? `0 0 8px ${NEON.glow}, 0 0 3px ${NEON.glow}` : "none",
                outline: current && sessionState === "active" ? `1px solid ${NEON.hex}` : "none",
                boxSizing: "border-box",
                transition: "background .3s, box-shadow .3s",
              }}/>
            );
          })}
        </div>
      </div>
      <div style={{
        flex: 1, height: 10, background: "oklch(0.94 0.003 240)",
        borderRadius: 5, maxWidth: 360,
      }}>
        <div style={{
          height: "100%", width: `${progressPct}%`,
          background: NEON.hex, borderRadius: 5,
          boxShadow: progressPct > 0 ? `0 0 10px ${NEON.glow}, 0 0 4px ${NEON.glow}` : "none",
          transition: "width .4s, box-shadow .3s",
        }} />
      </div>
      <span style={{
        fontFamily: "var(--mono)", fontSize: 12, fontWeight: 500,
        color: "oklch(0.20 0.01 240)", fontVariantNumeric: "tabular-nums",
        minWidth: 32, textAlign: "right",
      }}>{progressPct}%</span>
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
  }
}

function CameraHomeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" style={{ width: 16, height: 16, flexShrink: 0 }} viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
    </svg>
  );
}
