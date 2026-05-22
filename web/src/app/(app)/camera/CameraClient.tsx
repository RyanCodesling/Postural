"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

import { evaluateCaptureReadiness, type FramingMode } from "@/lib/pose/captureReadiness";
import { drawCutoutOverlay } from "@/lib/pose/drawFramingOverlay";
import {
  computePoseMetricsForExercise,
  computeCompensationScore,
  type ExerciseFrameMetrics,
} from "@/lib/pose/poseMetrics";
import {
  getExerciseDefinition,
  type ExerciseDefinition,
  type MetricName,
} from "@/lib/exercises/registry";
import { OneEuroFilter } from "@/lib/pose/oneEuroFilter";
import { RepCounter, type RepCounterOptions, type RepEvent } from "@/lib/pose/repCounter";
import {
  BidirectionalRepCounter,
  type BidirectionalRepCounterDebugSnapshot,
  type BidirectionalSide,
} from "@/lib/pose/bidirectionalRepCounter";

type CamDevice = MediaDeviceInfo;

interface Exercise {
  id: string;
  name: string;
  description: string;
  duration: number;
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
type SessionState = "idle" | "active" | "resting" | "ended";

/**
 * P4-friendly in-memory record of a completed set, shape-aligned with the
 * future Postgres `sets` table. This implementation keeps these in
 * memory only; a future P4 swap writes them to the DB without changing
   * this shape while the current implementation remains in-session UI only.
   * `pairedReps` / `asymmetryIndex` are tracked as
 * placeholders for now (paired-rep matching is not implemented yet).
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
};

type Prescription = { sets: number; reps: number; restSeconds: number };

const DEFAULT_PRESCRIPTION: Prescription = { sets: 3, reps: 12, restSeconds: 60 };

type RepCounterSet = {
  left: RepCounter | null;
  right: RepCounter | null;
  bidirectional: BidirectionalRepCounter | null;
};

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
    return {
      left: null,
      right: null,
      bidirectional: new BidirectionalRepCounter(thresholds, options),
    };
  }

  return {
    left: new RepCounter(thresholds, options),
    right: null,
    bidirectional: null,
  };
}

interface PatientExercise {
  exerciseId: string;
  patientId: string;
  assignedDate: string;
  status: "pending" | "in-progress" | "completed";
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

declare global {
  interface Window {
    __neckRepDebug?: NeckRepDebugRecord[];
    dumpNeckRepDebug?: (limit?: number) => string;
    clearNeckRepDebug?: () => void;
  }
}

const MAX_NECK_REP_DEBUG_RECORDS = 3000;
const CAPTURE_READINESS_RESET_GRACE_MS = 300;

export default function CameraClient() {
  const { user } = useAuth();
  const dashboardHref =
    user?.role === "admin" ? "/dashboard/admin"
    : user?.role === "therapist" ? "/dashboard/therapist"
    : "/dashboard/patient";

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const requestRef = useRef<number | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);

  const tiltFilterRef = useRef(new OneEuroFilter(1.0, 0.1));
  const metricFiltersRef = useRef<Map<MetricName, OneEuroFilter>>(new Map());
  // Dedicated smoothing filters for per-limb primary metrics. Separate from
  // the metricFiltersRef map because per-limb exercises need TWO filters for
  // the same MetricName — one per side. Cleared on exercise change, reset on
  // capture dropout, same lifecycle as metricFiltersRef.
  const leftPrimaryFilterRef = useRef(new OneEuroFilter(1.0, 0.1));
  const rightPrimaryFilterRef = useRef(new OneEuroFilter(1.0, 0.1));
  // Per-side resting baseline for metrics whose raw value is a positive
  // absolute distance (currently only scapularElevation for ex_003). Only
  // active when the primary metric has requiresBaselineCapture set. Reset
  // on exercise change and capture-readiness dropout.
  type BaselineState = { samples: number[]; value: number | null };
  const leftBaselineRef = useRef<BaselineState>({ samples: [], value: null });
  const rightBaselineRef = useRef<BaselineState>({ samples: [], value: null });
  const lastMetricsUpdateRef = useRef(0);

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

  // Bidirectional exercises use one signed metric. The wrapper feeds |angle|
  // into RepCounter, tags the side from the sign at peak, and gates immediate
  // opposite-side return-stroke overshoot until neutral has settled.
  const bidirectionalRepCounterRef = useRef<BidirectionalRepCounter | null>(null);
  const neckRepDebugRef = useRef<NeckRepDebugRecord[]>([]);
  const neckRepDebugStartMsRef = useRef<number | null>(null);
  const neckRepDebugSeqRef = useRef(0);
  
  // In-memory per-rep event log, keyed by side. Cleared when the exercise
  // changes. This is the buffer that will eventually feed Postgres in a later
  // step — for now, console.log on each rep is the only output beyond the
  // live counter.
  const repLogRef = useRef<{ left: RepEvent[]; right: RepEvent[] }>({
    left: [],
    right: [],
  });

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
  const [currentDate, setCurrentDate] = useState<string>("");

  const [assignedExercises, setAssignedExercises] = useState<Exercise[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<string>("");

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
   * Timestamp when the CURRENT set started (used for `CompletedSetRecord.durationMs`).
   * Reset on session start and on each set completion.
   */
  const currentSetStartMsRef = useRef<number | null>(null);

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
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [sessionState]);

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
    if (!def || def.kind !== "dynamic") return;
    const target = prescriptionRef.current.reps;
    const left = repCountsRef.current.left;
    const right = repCountsRef.current.right;
    const setComplete = def.bilateral
      ? Math.min(left, right) >= target
      : left >= target;
    if (!setComplete) return;

    const setRecord: CompletedSetRecord = {
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
    completedSetsLogRef.current.push(setRecord);

    setCompletedSets(completedSetsRef.current + 1);
    repCountsRef.current = { left: 0, right: 0 };
    setRepCounts({ left: 0, right: 0 });
    leftRepCounterRef.current?.reset();
    rightRepCounterRef.current?.reset();
    bidirectionalRepCounterRef.current?.reset();
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
  };

  /**
   * Sidebar Start button handler. Resets the session lifecycle and
   * transitions to `active`. The rep event log is cleared and rep counters
   * are rebuilt so a restarted session does not inherit stale event buffers
   * or lifetime-of-instance rep indices from the previous session.
   */
  const handleSessionStart = () => {
    if (!activeDefinition) return;
    const now = performance.now();
    const counters = createRepCountersForDefinition(activeDefinition);
    sessionStartMsRef.current = now;
    currentSetStartMsRef.current = now;
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
    setConfirmingEnd(false);
    restEndsAtMsRef.current = null;
    setRestRemainingSec(0);
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
      sessionStateRef.current !== "resting"
    ) {
      // Idempotent: clicking End in idle/ended state has no effect.
      return;
    }
    // Ending during rest: clear the countdown so the rest-timer effect can't
    // resume into "active" after we transition to "ended". (Reps are already
    // {0,0} during rest, so no partial set is logged below.)
    setConfirmingEnd(false);
    restEndsAtMsRef.current = null;
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
            ? performance.now() - currentSetStartMsRef.current
            : 0,
        terminatedBy: "user",
        asymmetryIndex: computeAsymmetryIndex(left, right),
      };
      completedSetsLogRef.current.push(setRecord);
    }
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

    return () => {
      delete window.__neckRepDebug;
      delete window.clearNeckRepDebug;
      delete window.dumpNeckRepDebug;
    };
  }, []);
  
  const [frameMetrics, setFrameMetrics] = useState<ExerciseFrameMetrics>({
    tiltReference: { cameraTiltDeg: 0, confidence: "insufficient", divergenceDeg: null },
    metrics: {},
    compensationScore: null,
  });
 
  // ── Derived display strings ──────────────────────────────────────────────
  // These keep the JSX clean and centralize all null-to-display-string logic.
 
  const showTiltWarning = frameMetrics.tiltReference.confidence === "low";
 
  // `metricCards` is the list of cards to render in the bottom-left overlay.
  // Built dynamically from the active exercise definition. Primary metric
  // renders first (severity-styled), then each compensation metric (compensation-styled).
  type CardSpec = {
    key: MetricName;
    label: string;
    value: number | null;
    kind: "primary" | "compensation";
    warningThreshold?: number;
    /**
     * Direction the warningThreshold compares against. Default "above"
     * preserves pre-2026-05-21 behavior: flag when `Math.abs(value) >=
     * warningThreshold` (typical "higher = worse" compensation like
     * trunkLean). "below" flags when `value < warningThreshold` ("lower
     * = worse", used by ex_007/ex_008 for elbowFlexion + the Wall Angels
     * foreshortening signal). See `CompensationMetricSpec` JSDoc in
     * registry.ts.
     */
    compareDirection?: "above" | "below";
  };
  
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
      });
    }
    return cards;
  })();
 
 
  
  // Derived stat-panel values (replacing the hardcoded
  // placeholders that lived here pre-2026-05-22).

  /**
   * SETS cell value: completed sets in this session. The StatPanel/
   * BidirectionalStatPanel renders this as a number; the progress bar
   * below the panel shows progress through the session.
   */
  const sets = completedSets;

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
  const progressPct =
    activeDefinition?.kind === "dynamic"
      ? Math.max(
          0,
          Math.min(
            100,
            Math.round(
              ((completedSets * prescription.reps + currentSetMinReps) /
                targetTotalReps) *
                100,
            ),
          ),
        )
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
        .then((data) => {
          // Staff debug catalog: the active ex_NNN list after EX_SWAP (2026-05-21).
          // ex_002 (Overhead Arm Raises) and ex_003 (Shoulder Shrugs) are
          // deprecated — see the @deprecated JSDocs on those entries in
          // `registry.ts`. They remain in the DB and registry for audit,
          // but should not surface in the staff dropdown.
          const DEBUG_IDS = ["ex_001", "ex_004", "ex_005", "ex_006", "ex_007", "ex_008"];
          const exercises: Exercise[] = (data.exercises ?? [])
            .filter((e: any) => DEBUG_IDS.includes(e.id))
            .sort((a: any, b: any) => a.id.localeCompare(b.id))
            .map((e: any) => ({
              id: e.id,
              name: e.name,
              description: e.description,
              // Staff debug catalog has no per-patient prescription —
              // fall back to the patient_exercises DB defaults (3 × 12)
              // so the session lifecycle still has a target to gate
              // set completion.
              sets: DEFAULT_PRESCRIPTION.sets,
              reps: DEFAULT_PRESCRIPTION.reps,
              restSeconds: DEFAULT_PRESCRIPTION.restSeconds,
          }));
          setAssignedExercises(exercises);
          if (exercises.length > 0) {
            setSelectedExercise((prev) => prev || exercises[0].id);
          }
        })
        .catch((err) => console.error("Error loading exercises:", err));
    } else {
      fetch("/api/patient-exercises")
        .then((r) => r.json())
        .then((data) => {
          const assigned: Exercise[] = (data.exercises ?? []).map((e: any) => ({
            id: e.exercise_id,
            name: e.name,
            description: e.description,
            // `patient_exercises.reps` is the per-side target: prescription
            // reps = 10 means 10 reps per side. `patient_exercises.sets`
            // is total set count.
            // Both default in the DB schema to 12 / 3 respectively;
            // mirror those if the API response omits them.
            reps: typeof e.reps === "number" ? e.reps : DEFAULT_PRESCRIPTION.reps,
            sets: typeof e.sets === "number" ? e.sets : DEFAULT_PRESCRIPTION.sets,
            restSeconds:
              typeof e.rest_seconds === "number"
                ? e.rest_seconds
                : DEFAULT_PRESCRIPTION.restSeconds,
          }));
          setAssignedExercises(assigned);
          if (assigned.length > 0) {
            setSelectedExercise((prev) => prev || assigned[0].id);
          }
        })
        .catch((err) => console.error("Error loading exercises:", err));
    }
  }, [user?.id, user?.role]);

  useEffect(() => {
    const assignedEntry = selectedExercise
      ? assignedExercises.find((e) => e.id === selectedExercise)
      : undefined;
    const nextPrescription = assignedEntry
      ? {
          sets: assignedEntry.sets,
          reps: assignedEntry.reps,
          restSeconds: assignedEntry.restSeconds,
        }
      : DEFAULT_PRESCRIPTION;
    prescriptionRef.current = nextPrescription;
    setPrescriptionRaw(nextPrescription);
  }, [selectedExercise, assignedExercises]);

  useEffect(() => {
    if (!selectedExercise) {
      setActiveDefinition(null);
      leftRepCounterRef.current = null;
      rightRepCounterRef.current = null;
      bidirectionalRepCounterRef.current = null;
      repLogRef.current = { left: [], right: [] };
      neckRepDebugRef.current = [];
      neckRepDebugStartMsRef.current = null;
      neckRepDebugSeqRef.current = 0;
      if (typeof window !== "undefined") {
        window.__neckRepDebug = neckRepDebugRef.current;
      }
      setRepCounts({ left: 0, right: 0 });
      return;
    }

    const def = getExerciseDefinition(selectedExercise);
    setActiveDefinition(def);

    // Reset the session lifecycle on every exercise change.
    // The user has to click sidebar Start on the new exercise to begin a
    // fresh session; rep counting stays gated until they do. completedSets,
    // currentSetReps (repCounts), and the completed-sets log all clear.
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

    // Reset filters whenever the exercise changes — old filter history would
    // bleed across exercises and produce a misleading first-frame jump.
    // The per-side primary filters are RECREATED (rather than reset) so they
    // can pick up the per-exercise smoothing override when present. Falls
    // back to the global degree-scale default for exercises without one.
    metricFiltersRef.current.clear();
    const primaryParams =
      def?.kind === "dynamic" && def.primaryMetric.smoothing
        ? def.primaryMetric.smoothing
        : { minCutoff: 1.0, beta: 0.1 };
    leftPrimaryFilterRef.current = new OneEuroFilter(
      primaryParams.minCutoff,
      primaryParams.beta,
    );
    rightPrimaryFilterRef.current = new OneEuroFilter(
      primaryParams.minCutoff,
      primaryParams.beta,
    );

    // Rebuild rep counters based on the new definition. Isometric exercises
    // get no counter (they use time-in-band, handled separately when we
    // implement ex_006).
    leftRepCounterRef.current = null;
    rightRepCounterRef.current = null;
    bidirectionalRepCounterRef.current = null;
    repLogRef.current = { left: [], right: [] };
    neckRepDebugRef.current = [];
    neckRepDebugStartMsRef.current = null;
    neckRepDebugSeqRef.current = 0;
    if (typeof window !== "undefined") {
      window.__neckRepDebug = neckRepDebugRef.current;
    }
    setRepCounts({ left: 0, right: 0 });

    // Reset baseline state on every exercise change. If the new exercise
    // needs a baseline, enter "capturing"; otherwise "not-needed".
    leftBaselineRef.current = { samples: [], value: null };
    rightBaselineRef.current = { samples: [], value: null };
    setBaselinePhase(
      def?.kind === "dynamic" && def.primaryMetric.requiresBaselineCapture
        ? "capturing"
        : "not-needed",
    );

    const counters = createRepCountersForDefinition(def);
    leftRepCounterRef.current = counters.left;
    rightRepCounterRef.current = counters.right;
    bidirectionalRepCounterRef.current = counters.bidirectional;
  }, [selectedExercise, setBaselinePhase]);

  const commitCaptureState = (ok: boolean, msg: string) => {
    if (lastCaptureOkRef.current !== ok) {
      const currentDefinition = activeDefinitionRef.current;
      // Transition into not-ok: any already-captured baseline is now stale
      // (patient may have shifted while we couldn't see them). Drop it and
      // require re-capture when readiness returns.
      if (
        !ok &&
        currentDefinition?.kind === "dynamic" &&
        currentDefinition.primaryMetric.requiresBaselineCapture
      ) {
        leftBaselineRef.current = { samples: [], value: null };
        rightBaselineRef.current = { samples: [], value: null };
        setBaselinePhase("capturing");
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

      const ctx = canvas.getContext("2d");
      if (ctx) {
        const results = landmarker.detectForVideo(video, performance.now());

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
            activeDefinition?.requiresOverheadRoom ? "overhead" : "default";
          const r = evaluateCaptureReadiness(landmarks as any, canvas.width, canvas.height, framingMode);

          const now = performance.now();
          if (!r.ok) {
            lastBadCaptureAtRef.current = now;
            stableOkSinceRef.current = 0;
            if (captureDropoutStartedAtRef.current === null) {
              captureDropoutStartedAtRef.current = now;
            }
            commitCaptureState(false, r.message);
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
              setFrameMetrics({
                tiltReference: { cameraTiltDeg: 0, confidence: "insufficient", divergenceDeg: null },
                metrics: {},
                compensationScore: null,
              });
            } else {
              const raw = computePoseMetricsForExercise(landmarks as any, activeDefinition);
              const tNow = performance.now();

              // Smooth the camera-tilt estimate (still always needed)
              const smoothedTilt = tiltFilterRef.current.filter(
                raw.tiltReference.cameraTiltDeg,
                tNow
              );

              // Per-metric filtering. Lazily allocate a filter the first time
              // we see each metric for the active exercise. The filter map
              // gets cleared when the exercise changes (see the
              // `selectedExercise` effect).
              const smoothedMetrics: Partial<Record<MetricName, number | null>> = {};
              for (const [metricName, value] of Object.entries(raw.metrics) as Array<
                [MetricName, number | null]
              >) {
                if (typeof value !== "number") {
                  smoothedMetrics[metricName] = null;
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
                      : { minCutoff: 1.0, beta: 0.1 };
                  filter = new OneEuroFilter(params.minCutoff, params.beta);
                  metricFiltersRef.current.set(metricName, filter);
                }
                smoothedMetrics[metricName] =
                  Math.round(filter.filter(value, tNow) * 10) / 10;
              }

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
                    // Read via ref — the rAF chain captured a stale state value.
                    if (baselinePhaseRef.current === "capturing") {
                      // Accumulate raw projections until each side has enough
                      // samples to summarize. Rep counting stays paused while
                      // the patient is in calibration.
                      if (typeof perSide.left === "number") {
                        leftBaselineRef.current.samples.push(perSide.left);
                      }
                      if (typeof perSide.right === "number") {
                        rightBaselineRef.current.samples.push(perSide.right);
                      }
                      const N_REQUIRED = 90; // ~3 s at 30 fps
                      if (
                        leftBaselineRef.current.samples.length >= N_REQUIRED &&
                        rightBaselineRef.current.samples.length >= N_REQUIRED
                      ) {
                        // Median, not mean — robust to single-frame spikes
                        // if the patient briefly shifted during capture.
                        const median = (xs: number[]) => {
                          const sorted = [...xs].sort((a, b) => a - b);
                          const mid = Math.floor(sorted.length / 2);
                          return sorted.length % 2 === 0
                            ? (sorted[mid - 1] + sorted[mid]) / 2
                            : sorted[mid];
                        };
                        leftBaselineRef.current.value = median(
                          leftBaselineRef.current.samples,
                        );
                        rightBaselineRef.current.value = median(
                          rightBaselineRef.current.samples,
                        );
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
                          ? lb !== null ? lb - perSide.left : perSide.left
                          : null;
                      const inputRight =
                        typeof perSide.right === "number"
                          ? rb !== null ? rb - perSide.right : perSide.right
                          : null;

                      const smoothedLeft =
                        inputLeft !== null
                          ? Math.round(
                              leftPrimaryFilterRef.current.filter(inputLeft, tNow) * 10,
                            ) / 10
                          : null;
                      const smoothedRight =
                        inputRight !== null
                          ? Math.round(
                              rightPrimaryFilterRef.current.filter(inputRight, tNow) * 10,
                            ) / 10
                          : null;

                      // Rep counting is gated on
                      // `sessionStateRef.current === "active"`. When the
                      // session is idle or ended, metrics still compute
                      // (display updates) but the rep counter never sees
                      // a frame, so its state machine stays in
                      // WAITING_FOR_REP_START. `handleSessionStart` rebuilds
                      // counters before transitioning to active, so the next
                      // session begins with clean state and rep indices.
                      const sessionIsActive =
                        sessionStateRef.current === "active";

                      if (
                        sessionIsActive &&
                        typeof smoothedLeft === "number" &&
                        leftRepCounterRef.current
                      ) {
                        const event = leftRepCounterRef.current.update(smoothedLeft, tNow);
                        if (event) {
                          repLogRef.current.left.push(event);
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
                      // Gate on active session state.
                      // The debug-ring-buffer below still records before/
                      // after snapshots so the neck-rep analysis tooling
                      // remains functional during idle/ended states, but
                      // the .update() call is suppressed.
                      const sessionIsActive =
                        sessionStateRef.current === "active";
                      if (counter) {
                        const before = counter.getDebugSnapshot(tNow, rawValue);
                        const rep = sessionIsActive
                          ? counter.update(rawValue, tNow)
                          : null;
                        if (rep) {
                          const { side, event } = rep;
                          repLogRef.current[side].push(event);
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
                      // Unilateral. Gate on active session.
                      const counter = leftRepCounterRef.current;
                      if (counter && sessionStateRef.current === "active") {
                        const event = counter.update(rawValue, tNow);
                        if (event) {
                          repLogRef.current.left.push(event);
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
              }

              if (tNow - lastMetricsUpdateRef.current > 150) {
                lastMetricsUpdateRef.current = tNow;
                setFrameMetrics({
                  tiltReference: { ...raw.tiltReference, cameraTiltDeg: smoothedTilt },
                  metrics: smoothedMetrics,
                  // Recompute the score from the SAME smoothed values the
                  // metric cards render, not from raw.
                  // Otherwise a card sitting just under a warning threshold
                  // can pair with a score that just penalized it. raw.metrics
                  // is still available separately for the ML/log pipeline.
                  compensationScore: computeCompensationScore(
                    activeDefinition,
                    smoothedMetrics
                  ),
                });
              }
            }
          } else {
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
              captureDropoutResetDoneRef.current = true;
            }

            setFrameMetrics({
              tiltReference: { cameraTiltDeg: 0, confidence: "insufficient", divergenceDeg: null },
              metrics: {},
              compensationScore: null,
            });
          }
        } else {
          commitCaptureState(false, "No person detected. Step into the frame.");
        }

        ctx.restore();
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
    } catch (e: any) {
      const name = e?.name || "Error";
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
      setCurrentDate(now.toLocaleDateString());
    };
    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!mounted) {
    return (
      <main className="h-screen overflow-hidden bg-gray-50 p-4">
        <div className="w-full">
          <div className="p-4 rounded border bg-white">Loading camera…</div>
        </div>
      </main>
    );
  }

  const selectedExerciseObj = assignedExercises.find((e) => e.id === selectedExercise);
  const selectedExerciseIndex = assignedExercises.findIndex((e) => e.id === selectedExercise);
  const hasPrevExercise = selectedExerciseIndex > 0;
  const hasNextExercise =
    selectedExerciseIndex !== -1 &&
    selectedExerciseIndex < assignedExercises.length - 1;

  // Hero panel state. "Complete" = the session ended with every prescribed set
  // finished (emerald). "Ended early" = ended before completion via the End
  // button (slate). Otherwise idle/active shows the default indigo→blue.
  // Note: completing a non-last exercise auto-advances to the next one (which
  // lands idle), so the emerald "complete" hero is seen on the final exercise
  // when the whole session finishes.
  const isResting = sessionState === "resting";
  // Stepper navigation is locked while a session is in progress (active OR
  // resting) so an exercise can't be abandoned mid-session by accident.
  const sessionBusy = sessionState === "active" || sessionState === "resting";
  const exerciseComplete =
    sessionState === "ended" && completedSets >= prescription.sets;
  const endedEarly =
    sessionState === "ended" && completedSets < prescription.sets;
  const heroGradient = isResting
    ? "from-sky-500 to-cyan-600"
    : exerciseComplete
      ? "from-emerald-500 to-green-600"
      : endedEarly
        ? "from-slate-400 to-slate-500"
        : "from-indigo-500 to-blue-600";
  const heroCaption = isResting
    ? "Resting"
    : exerciseComplete
      ? "✓ Complete"
      : endedEarly
        ? "Ended early"
        : selectedExerciseIndex >= 0
          ? `Exercise ${selectedExerciseIndex + 1} of ${assignedExercises.length}`
          : `${assignedExercises.length} exercises`;

  return (
    <main className="h-screen overflow-hidden bg-gray-50">
      {/* Full-width container (no max-w) */}
      <div className="h-full w-full px-4 lg:px-6 py-4 flex flex-col gap-3">
        {/* Header stays compact so content fits */}
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Link href={dashboardHref} className="text-sm text-green-700 hover:text-green-900 inline-block mb-1">
              ← Back to Dashboard
            </Link>
            <h1 className="text-xl font-bold leading-tight">Camera</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span className={`w-2 h-2 rounded-full ${modelLoaded ? "bg-green-500" : "bg-orange-500"}`} />
              <span className="text-xs text-gray-600">{modelLoaded ? "AI Ready" : "Loading Model..."}</span>
              <span
                className={`px-2 py-0.5 rounded text-xs font-semibold ${
                  captureOk ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
                }`}
                title={captureMessage}
              >
                {captureOk ? "Capture OK" : "Paused"}
              </span>
              {!captureOk && <span className="text-xs text-gray-600 truncate">{captureMessage}</span>}
            </div>
          </div>

          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => startCamera(selectedDeviceId || undefined)}
              disabled={isStarting || !modelLoaded}
              className="px-3 py-2 rounded bg-black text-white text-sm disabled:opacity-50"
            >
              {isStarting ? "Starting..." : "Start"}
            </button>
            <button
              onClick={stopCamera}
              className="px-3 py-2 rounded border border-gray-300 bg-white text-sm"
            >
              Stop
            </button>
          </div>
        </header>

        {/* Errors (still no scrolling; keep compact) */}
        {error && (
          <div className="px-3 py-2 rounded border border-red-200 bg-red-50 text-red-800 text-sm">
            {error}
          </div>
        )}

        {/* Main content fills remaining height */}
        <section className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* Camera panel */}
          <div className="lg:col-span-9 min-h-0">
            <div className="relative h-full rounded-2xl overflow-hidden bg-black shadow">
              {/* Mirrored visual layer only */}
              <div className={`absolute inset-0 ${mirror ? "-scale-x-100" : ""}`}>
                <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />
              </div>

              {/* Non-mirrored message overlay */}
              {!captureOk && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-6 py-3 rounded-xl bg-black/75 text-white text-lg font-semibold shadow-lg">
                  {captureMessage}
                </div>
              )}

              {/* Baseline-capture prompt: only when capture is good but we
                  still need to calibrate the resting reference. The yellow
                  capture-paused banner above already covers the not-ok case. */}
              {captureOk && baselinePhase === "capturing" && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 px-6 py-3 rounded-xl bg-blue-900/80 text-white text-base font-semibold shadow-lg">
                  Stand naturally with arms relaxed — capturing baseline…
                </div>
              )}

              {/* ── Tilt confidence warning — top center, own absolute element ── */}
              {showTiltWarning && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-yellow-500/90 backdrop-blur-sm text-black text-xs font-semibold shadow-lg whitespace-nowrap">
                  <span>⚠</span>
                  <span>Measurement confidence reduced — ensure hips and head are visible</span>
                </div>
              )}
 
              {/* ── Posture metrics — bottom left ── */}
              <div className="absolute bottom-3 left-3 z-20 flex flex-col gap-2">
                {metricCards.length === 0 ? (
                  <div className="px-4 py-3 rounded-xl bg-black/65 backdrop-blur-sm text-white/60 text-xs w-44">
                    Select an exercise to begin
                  </div>
                ) : (
                  metricCards.map((card) => (
                    <DynamicMetricCard
                      key={card.key}
                      label={card.label}
                      value={card.value}
                      kind={card.kind}
                      warningThreshold={card.warningThreshold}
                      compareDirection={card.compareDirection}
                    />
                  ))
                )}
                <ScoreCard score={frameMetrics.compensationScore} />
              </div>
 
              {/* ── Exercise stats — bottom right ── */}
              <div className="absolute bottom-3 right-3 z-20 flex flex-col gap-2 items-stretch">
                {activeDefinition?.bilateral ? (
                  <BidirectionalStatPanel
                    leftReps={repCounts.left}
                    rightReps={repCounts.right}
                    timer={timer}
                    targetReps={
                      activeDefinition.kind === "dynamic" ? prescription.reps : undefined
                    }
                  />
                ) : (
                  <StatPanel
                    sets={sets}
                    reps={repCounts.left + repCounts.right}
                    timer={timer}
                    targetReps={
                      activeDefinition?.kind === "dynamic" ? prescription.reps : undefined
                    }
                    targetSets={prescription.sets}
                  />
                )}
                <ProgressCard
                  progressPct={progressPct}
                  completedSets={completedSets}
                  targetSets={prescription.sets}
                  sessionState={sessionState}
                />
              </div>
            </div>
          </div>

          {/* Sidebar panel (must fit without scrolling) */}
          <aside className="lg:col-span-3 min-h-0 flex flex-col gap-3">
            <div className="p-3 rounded-2xl bg-white shadow-sm border">
              <h2 className="font-semibold text-sm mb-2">Controls</h2>

              {assignedExercises.length === 0 ? (
                <div className="w-full p-2 rounded border border-yellow-200 bg-yellow-50 text-yellow-800 text-xs">
                  No exercises assigned yet.
                </div>
              ) : (
                // Guided-flow stepper (hero). The current exercise name is the
                // focal point — large type on a colored panel — flanked by
                // Prev/Next. Both arrows are disabled while a session is active
                // so an in-progress set can't be lost by accidental navigation
                // (End first). Ends of the list disable the respective arrow
                // (no wraparound).
                <div className="flex items-stretch gap-2">
                  <button
                    type="button"
                    onClick={() => goToAdjacentExercise(-1)}
                    disabled={!hasPrevExercise || sessionBusy}
                    aria-label="Previous exercise"
                    className="shrink-0 w-9 rounded-xl border bg-white text-gray-700 flex items-center justify-center hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ◀
                  </button>
                  <div
                    className={`flex-1 min-w-0 rounded-xl bg-gradient-to-br ${heroGradient} px-3 py-3 text-center text-white shadow-sm transition-colors`}
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
                      {heroCaption}
                    </div>
                    <div className="text-lg font-bold leading-tight truncate">
                      {selectedExerciseObj?.name ?? "—"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => goToAdjacentExercise(1)}
                    disabled={!hasNextExercise || sessionBusy}
                    aria-label="Next exercise"
                    className="shrink-0 w-9 rounded-xl border bg-white text-gray-700 flex items-center justify-center hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ▶
                  </button>
                </div>
              )}

              {selectedExerciseObj && (
                <div className="mt-2 p-2 rounded bg-blue-50 border border-blue-200 text-xs text-gray-700">
                  <div className="line-clamp-3">{selectedExerciseObj.description}</div>
                  <div className="mt-2 flex gap-2 text-[11px] text-gray-600">
                    <span>⏱ {selectedExerciseObj.duration}s</span>
                  </div>
                </div>
              )}

              <label className="block text-xs font-medium mt-3 mb-1">Camera device</label>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="w-full border rounded px-2 py-2 bg-white text-sm"
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

              <div className="mt-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">Mirror</p>
                  <p className="text-[11px] text-gray-500">Front cam feel</p>
                </div>
                <input
                  type="checkbox"
                  checked={mirror}
                  onChange={(e) => setMirror(e.target.checked)}
                  className="h-5 w-5"
                />
              </div>

              <div className="mt-2 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">Prefer front camera</p>
                  <p className="text-[11px] text-gray-500">When no device selected</p>
                </div>
                <input
                  type="checkbox"
                  checked={useFrontCameraHint}
                  onChange={(e) => setUseFrontCameraHint(e.target.checked)}
                  className="h-5 w-5"
                />
              </div>

              <button
                onClick={() => startCamera()}
                className="mt-3 w-full px-3 py-2 rounded bg-gray-900 text-white text-sm"
              >
                Restart with preference
              </button>
            </div>

            {/* Reference + time/date compact, still no scrolling */}
            <div className="p-3 rounded-2xl bg-white shadow-sm border flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-sm">Reference</h2>
                <div className="text-[11px] text-gray-600 text-right">
                  <div>{currentTime}</div>
                  <div>{currentDate}</div>
                </div>
              </div>

              <div className="rounded-lg overflow-hidden bg-gray-200 flex-1 min-h-0">
                <video className="w-full h-full object-cover bg-gray-300" controls controlsList="nodownload">
                  <source src="/sample-video.mp4" type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              </div>

              {/*
                Sidebar session controls (wired 2026-05-22).
                Distinct from the header Start/Stop which control the camera
                hardware. These control the EXERCISE SESSION lifecycle:
                Start enters `active` (rep counter ticks, timer runs); End
                enters `ended` (counter freezes, timer stops, optional
                partial-set record logged). The Start button reads "Restart"
                when the session is in the ended state so it's clear that
                clicking it resets completedSets / repCounts / timer.
              */}
              {sessionState === "resting" ? (
                // Hard-block rest between sets. Rep counting is suspended (the
                // rep gate requires "active"); the next set resumes
                // automatically when the countdown elapses.
                <div className="mt-2 rounded-xl border border-sky-300 bg-sky-50 p-3 text-center">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-700">
                    Rest
                  </p>
                  <p className="text-3xl font-bold text-sky-900 tabular-nums leading-tight">
                    {formatElapsedTime(restRemainingSec)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-sky-700">
                    Next set starts automatically
                  </p>
                  <div className="mt-2 flex gap-2">
                    {/*
                      TEMPORARY: rest is specified as a HARD BLOCK with no skip.
                      This Skip button is a stopgap for testing and should be
                      removed so rest is non-skippable per the spec.
                    */}
                    <button
                      type="button"
                      onClick={skipRest}
                      className="flex-1 px-3 py-2 rounded border bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Skip rest
                    </button>
                    <button
                      type="button"
                      onClick={handleSessionEnd}
                      className="flex-1 px-3 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700"
                    >
                      End
                    </button>
                  </div>
                </div>
              ) : sessionState === "active" && confirmingEnd ? (
                // Inline confirm step for ending an exercise early. Ending now
                // logs the in-progress set as a user-terminated partial (it
                // won't count as complete). Shown in place of Start/End so the
                // End action can't be double-triggered; Cancel resumes the
                // running session untouched (reps kept counting underneath).
                <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-900">
                    End this exercise early?
                  </p>
                  <p className="mt-0.5 text-[11px] text-amber-700">
                    The current set won&apos;t count as complete.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        handleSessionEnd();
                        setConfirmingEnd(false);
                      }}
                      className="flex-1 px-3 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700"
                    >
                      Yes, end
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingEnd(false)}
                      className="flex-1 px-3 py-2 rounded border bg-white text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={handleSessionStart}
                    disabled={!activeDefinition || sessionState === "active"}
                    className="flex-1 px-3 py-2 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {sessionState === "ended" ? "Restart" : "Start"}
                  </button>
                  <button
                    onClick={() => setConfirmingEnd(true)}
                    disabled={sessionState !== "active"}
                    className="flex-1 px-3 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    End
                  </button>
                </div>
              )}
              {/*
                After a manual End on a non-last exercise, offer to move on.
                Completing all prescribed sets auto-advances (never lands here
                with a next exercise available), so this prompt only appears
                when the user ended early — they can either Restart this
                exercise above or step forward here.
              */}
              {sessionState === "ended" && hasNextExercise && (
                <button
                  type="button"
                  onClick={() => goToAdjacentExercise(1)}
                  className="mt-2 w-full px-3 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                >
                  Next exercise →
                </button>
              )}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function scoreAccent(score: number | null): string {
  if (score === null) return "bg-white/25";
  if (score >= 80)   return "bg-emerald-400";
  if (score >= 60)   return "bg-yellow-400";
  if (score >= 40)   return "bg-orange-500";
  return "bg-red-500";
}
 
function scoreValueColor(score: number | null): string {
  if (score === null) return "text-white/40";
  if (score >= 80)   return "text-emerald-400";
  if (score >= 60)   return "text-yellow-400";
  if (score >= 40)   return "text-orange-400";
  return "text-red-400";
}

function ScoreCard({ score }: { score: number | null }) {
  const pct = score ?? 0;
  return (
    <div className="flex overflow-hidden rounded-xl bg-black/65 backdrop-blur-sm shadow-lg w-44">
      <div className={`w-1.5 shrink-0 ${scoreAccent(score)}`} />
      <div className="px-4 py-3 flex-1">
        <div className="text-[10px] tracking-widest text-white/50 uppercase mb-1.5">
          POSTURE SCORE
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className={`text-4xl font-bold leading-none tabular-nums ${scoreValueColor(score)}`}>
            {score ?? "--"}
          </span>
          <span className="text-sm text-white/35 leading-none">/100</span>
        </div>
        {/* Mini score bar — animates smoothly between frames */}
        <div className="mt-3 h-1.5 bg-white/15 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${scoreAccent(score)}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function StatPanel({
  sets,
  reps,
  timer,
  targetReps,
  targetSets,
}: {
  sets: number;
  reps: number;
  timer: string;
  /** Per-side rep target. undefined for isometric (no rep target). */
  targetReps?: number;
  /** Total set target. undefined hides the `/target` suffix. */
  targetSets?: number;
}) {
  return (
    <div className="bg-black/65 backdrop-blur-sm rounded-xl shadow-lg overflow-hidden">
      <div className="flex divide-x divide-white/10">
        <StatCell
          label="SETS"
          value={String(sets)}
          target={targetSets}
          done={targetSets !== undefined && sets >= targetSets}
        />
        <StatCell
          label="REPS"
          value={String(reps)}
          target={targetReps}
          done={targetReps !== undefined && reps >= targetReps}
        />
        <StatCell label="TIME" value={timer} />
      </div>
    </div>
  );
}
 
function StatCell({
  label,
  value,
  target,
  done,
}: {
  label: string;
  value: string;
  /** When provided, renders a dimmed `/target` suffix after the value. */
  target?: number;
  /**
   * When true, the cell turns emerald and a ✓ appears next to the label —
   * the per-side "this side hit its target" cue (added
   * 2026-05-22). Note this does NOT block further reps on that side
   * (synchronization philosophy: the side keeps counting; only the
   * progress bar is gated by the slower side via min()).
   */
  done?: boolean;
}) {
  return (
    <div className="px-5 py-3 text-center">
      <div className="text-[10px] tracking-widest text-white/50 uppercase mb-1.5 flex items-center justify-center gap-1">
        <span>{label}</span>
        {done && <span className="text-emerald-400 leading-none">✓</span>}
      </div>
      <div
        className={`text-3xl font-bold leading-none tabular-nums ${
          done ? "text-emerald-400" : "text-white"
        }`}
      >
        {value}
        {target !== undefined && (
          <span className="text-base font-medium text-white/40">{`/${target}`}</span>
        )}
      </div>
    </div>
  );
}

function BidirectionalStatPanel({
  leftReps,
  rightReps,
  timer,
  targetReps,
}: {
  leftReps: number;
  rightReps: number;
  timer: string;
  /** Per-side rep target. undefined for isometric (no rep target shown). */
  targetReps?: number;
}) {
  return (
    <div className="bg-black/65 backdrop-blur-sm rounded-xl shadow-lg overflow-hidden">
      <div className="flex divide-x divide-white/10">
        <StatCell
          label="LEFT"
          value={String(leftReps)}
          target={targetReps}
          done={targetReps !== undefined && leftReps >= targetReps}
        />
        <StatCell
          label="RIGHT"
          value={String(rightReps)}
          target={targetReps}
          done={targetReps !== undefined && rightReps >= targetReps}
        />
        <StatCell label="TIME" value={timer} />
      </div>
    </div>
  );
}

function ProgressCard({
  progressPct,
  completedSets,
  targetSets,
  sessionState,
}: {
  progressPct: number;
  completedSets: number;
  targetSets: number;
  sessionState: SessionState;
}) {
  // The label communicates session lifecycle
  // + set position in addition to the raw percentage. Mid-session it
  // reads "SET X OF Y" (1-indexed, capped at Y). After session end it
  // reads "COMPLETE" if all sets done, or "ENDED EARLY" with the set
  // count when the user clicked End before reaching the target.
  const setLabel =
    sessionState === "ended"
      ? completedSets >= targetSets
        ? "SESSION COMPLETE"
        : `ENDED AT SET ${completedSets} / ${targetSets}`
      : sessionState === "resting"
        ? `RESTING • NEXT: SET ${Math.min(completedSets + 1, targetSets)} OF ${targetSets}`
        : sessionState === "active"
          ? `SET ${Math.min(completedSets + 1, targetSets)} OF ${targetSets}`
          : `READY • ${targetSets} SETS`;
  return (
    <div className="bg-black/65 backdrop-blur-sm rounded-xl px-5 py-3 shadow-lg">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] tracking-widest text-white/50 uppercase">
          {setLabel}
        </span>
        <span className="text-sm font-bold text-white tabular-nums">{progressPct}%</span>
      </div>
      <div className="h-2 bg-white/15 rounded-full overflow-hidden">
        <div
          className="h-full bg-white/75 rounded-full transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Format a non-negative second count as `MM:SS` with zero-padded fields.
 * Used for the session timer cell. Handles sessions longer than an hour
 * by letting the minute count grow past 59 (e.g., `01:30:00 → "90:00"`),
 * which matches the StatPanel's tight 5-char display budget better than
 * spilling into hours.
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
 
/**
 * True iff a compensation metric value crosses its `warningThreshold` in
 * the bad direction.
 *
 *   "above" (default): flag when `Math.abs(value) >= warningThreshold`.
 *     Use for "higher = worse" metrics (trunkLean, neckTilt,
 *     shoulderSymmetry, scapularElevation-as-compensation).
 *   "below":           flag when `value < warningThreshold`.
 *     Use for "lower = worse" metrics added in EX_SWAP 2026-05-21:
 *     `elbowFlexion` (180° = arm straight = good; warn if bent below
 *     threshold) and `shoulderElbowDistance` (~0.5 = on-wall = good;
 *     warn if foreshortened below threshold).
 *
 * Mirrors `CompensationMetricSpec.compareDirection` in registry.ts.
 */
function isCompensationFlagging(
  value: number | null,
  threshold: number,
  direction: "above" | "below",
): boolean {
  if (value === null) return false;
  return direction === "below"
    ? value < threshold
    : Math.abs(value) >= threshold;
}

/**
 * Compensation metrics get a calm gray accent below their warning threshold,
 * red above. Primary metrics show neutral white — they're an information
 * display, not a quality flag.
 */
function compensationAccent(
  value: number | null,
  threshold: number,
  direction: "above" | "below",
): string {
  if (value === null) return "bg-white/25";
  return isCompensationFlagging(value, threshold, direction) ? "bg-red-500" : "bg-white/40";
}

function DynamicMetricCard({
  label,
  value,
  kind,
  warningThreshold,
  compareDirection,
}: {
  label: string;
  value: number | null;
  kind: "primary" | "compensation";
  warningThreshold?: number;
  compareDirection?: "above" | "below";
}) {
  const direction = compareDirection ?? "above";
  const threshold = warningThreshold ?? Infinity;
  const accentClass =
    kind === "primary"
      ? "bg-white/60"
      : compensationAccent(value, threshold, direction);

  const isFlagging =
    kind === "compensation" &&
    isCompensationFlagging(value, threshold, direction);
 
  // Display string: degrees for angles, just the rounded number for now
  // for displacement metrics. Consumers can refine units later per metric.
  const display = value === null ? "--" : `${value.toFixed(1)}°`;
 
  return (
    <div
      className={`flex overflow-hidden rounded-xl backdrop-blur-sm shadow-lg w-44 transition-colors ${
        isFlagging ? "bg-red-900/70 ring-1 ring-red-400/60" : "bg-black/65"
      }`}
    >
      <div className={`w-1.5 shrink-0 ${accentClass}`} />
      <div className="px-4 py-3 flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] tracking-widest text-white/50 uppercase">
            {label}
          </span>
          {isFlagging && (
            <span className="text-[9px] tracking-wider text-red-300 uppercase font-semibold">
              ⚠ Compensation
            </span>
          )}
        </div>
        <div className="text-4xl font-bold text-white leading-none tabular-nums">
          {display}
        </div>
        <div className="text-xs text-white/55 mt-1.5 truncate">
          {kind === "primary"
            ? "Primary"
            : isFlagging
              ? (direction === "below" ? "Below threshold" : "Above threshold")
              : "Within range"}
        </div>
      </div>
    </div>
  );
}
