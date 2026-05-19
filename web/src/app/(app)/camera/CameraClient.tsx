"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

import { evaluateCaptureReadiness } from "@/lib/pose/captureReadiness";
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
import { RepCounter, type RepEvent } from "@/lib/pose/repCounter";
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
  const setBaselinePhase = (phase: BaselinePhase) => {
    baselinePhaseRef.current = phase;
    setBaselinePhaseState(phase);
  };

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
      });
    }
    return cards;
  })();
 
 
  
  const sets = 3;

  const progressPct = 65;
  const timer = "05:32";

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

  // Load assigned exercises from database
  useEffect(() => {
    if (!user?.id) return;

    fetch("/api/patient-exercises")
      .then((r) => r.json())
      .then((data) => {
        const assigned: Exercise[] = (data.exercises ?? []).map((e: any) => ({
          id: e.exercise_id,
          name: e.name,
          description: e.description,
        }));
        setAssignedExercises(assigned);
        if (assigned.length > 0 && !selectedExercise) setSelectedExercise(assigned[0].id);
      })
      .catch((err) => console.error("Error loading exercises:", err));
  }, [user?.id]);

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

    if (def && def.kind === "dynamic") {
      const thresholds = def.primaryMetric.thresholds;
      const options =
        def.primaryMetric.descentEpsilon !== undefined
          ? { descentEpsilon: def.primaryMetric.descentEpsilon }
          : {};

      if (def.bilateral && def.bilateralMode === "per-limb") {
        // Two limbs in parallel — one counter per side.
        leftRepCounterRef.current = new RepCounter(thresholds, options);
        rightRepCounterRef.current = new RepCounter(thresholds, options);
      } else if (def.bilateral && def.bilateralMode === "bidirectional-alternating") {
        // One signed metric, sides distinguished by sign at peak time.
        bidirectionalRepCounterRef.current = new BidirectionalRepCounter(
          thresholds,
          options,
        );
      } else {
        // Unilateral — single counter on the left ref.
        leftRepCounterRef.current = new RepCounter(thresholds, options);
      }
    }
  }, [selectedExercise]);

  const commitCaptureState = (ok: boolean, msg: string) => {
    if (lastCaptureOkRef.current !== ok) {
      // Transition into not-ok: any already-captured baseline is now stale
      // (patient may have shifted while we couldn't see them). Drop it and
      // require re-capture when readiness returns.
      if (
        !ok &&
        activeDefinition?.kind === "dynamic" &&
        activeDefinition.primaryMetric.requiresBaselineCapture
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

          const r = evaluateCaptureReadiness(landmarks as any, canvas.width, canvas.height);

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

                      if (typeof smoothedLeft === "number" && leftRepCounterRef.current) {
                        const event = leftRepCounterRef.current.update(smoothedLeft, tNow);
                        if (event) {
                          repLogRef.current.left.push(event);
                          setRepCounts((p) => ({ ...p, left: p.left + 1 }));
                          // eslint-disable-next-line no-console
                          console.log(`[rep] ${activeDefinition.id} left`, event);
                        }
                      }
                      if (typeof smoothedRight === "number" && rightRepCounterRef.current) {
                        const event = rightRepCounterRef.current.update(smoothedRight, tNow);
                        if (event) {
                          repLogRef.current.right.push(event);
                          setRepCounts((p) => ({ ...p, right: p.right + 1 }));
                          // eslint-disable-next-line no-console
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
                      if (counter) {
                        const before = counter.getDebugSnapshot(tNow, rawValue);
                        const rep = counter.update(rawValue, tNow);
                        if (rep) {
                          const { side, event } = rep;
                          repLogRef.current[side].push(event);
                          setRepCounts((prev) => ({
                            ...prev,
                            [side]: prev[side] + 1,
                          }));

                          // eslint-disable-next-line no-console
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
                      // Unilateral.
                      const counter = leftRepCounterRef.current;
                      if (counter) {
                        const event = counter.update(rawValue, tNow);
                        if (event) {
                          repLogRef.current.left.push(event);
                          setRepCounts((p) => ({ ...p, left: p.left + 1 }));
                          // eslint-disable-next-line no-console
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
                  // PC (handover §3.10): recompute the score from the SAME
                  // smoothed values the metric cards render, not from raw.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return (
    <main className="h-screen overflow-hidden bg-gray-50">
      {/* Full-width container (no max-w) */}
      <div className="h-full w-full px-4 lg:px-6 py-4 flex flex-col gap-3">
        {/* Header stays compact so content fits */}
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
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
                  />
                ) : (
                  <StatPanel
                    sets={sets}
                    reps={repCounts.left + repCounts.right}
                    timer={timer}
                  />
                )}
                <ProgressCard progressPct={progressPct} />
              </div>
            </div>
          </div>

          {/* Sidebar panel (must fit without scrolling) */}
          <aside className="lg:col-span-3 min-h-0 flex flex-col gap-3">
            <div className="p-3 rounded-2xl bg-white shadow-sm border">
              <h2 className="font-semibold text-sm mb-2">Controls</h2>

              <label className="block text-xs font-medium mb-1">Exercise</label>
              {assignedExercises.length === 0 ? (
                <div className="w-full p-2 rounded border border-yellow-200 bg-yellow-50 text-yellow-800 text-xs">
                  No exercises assigned yet.
                </div>
              ) : (
                <select
                  value={selectedExercise}
                  onChange={(e) => setSelectedExercise(e.target.value)}
                  className="w-full border rounded px-2 py-2 bg-white text-sm"
                >
                  {assignedExercises.map((exercise) => (
                    <option key={exercise.id} value={exercise.id}>
                      {exercise.name}
                    </option>
                  ))}
                </select>
              )}

              {selectedExerciseObj && (
                <div className="mt-2 p-2 rounded bg-blue-50 border border-blue-200 text-xs text-gray-700">
                  <div className="font-semibold text-gray-900">{selectedExerciseObj.name}</div>
                  <div className="line-clamp-3 mt-1">{selectedExerciseObj.description}</div>
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

              <div className="mt-2 flex gap-2">
                <button className="flex-1 px-3 py-2 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700">
                  Start
                </button>
                <button className="flex-1 px-3 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700">
                  End
                </button>
              </div>
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

function StatPanel({ sets, reps, timer }: { sets: number; reps: number; timer: string }) {
  return (
    <div className="bg-black/65 backdrop-blur-sm rounded-xl shadow-lg overflow-hidden">
      <div className="flex divide-x divide-white/10">
        <StatCell label="SETS" value={String(sets)} />
        <StatCell label="REPS" value={String(reps)} />
        <StatCell label="TIME" value={timer} />
      </div>
    </div>
  );
}
 
function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-3 text-center">
      <div className="text-[10px] tracking-widest text-white/50 uppercase mb-1.5">
        {label}
      </div>
      <div className="text-3xl font-bold text-white leading-none tabular-nums">
        {value}
      </div>
    </div>
  );
}

function BidirectionalStatPanel({
  leftReps,
  rightReps,
  timer,
}: {
  leftReps: number;
  rightReps: number;
  timer: string;
}) {
  return (
    <div className="bg-black/65 backdrop-blur-sm rounded-xl shadow-lg overflow-hidden">
      <div className="flex divide-x divide-white/10">
        <StatCell label="LEFT" value={String(leftReps)} />
        <StatCell label="RIGHT" value={String(rightReps)} />
        <StatCell label="TIME" value={timer} />
      </div>
    </div>
  );
}

function ProgressCard({ progressPct }: { progressPct: number }) {
  return (
    <div className="bg-black/65 backdrop-blur-sm rounded-xl px-5 py-3 shadow-lg">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] tracking-widest text-white/50 uppercase">
          Session Progress
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

function metricLabel(name: MetricName): string {
  switch (name) {
    case "shoulderAbduction":   return "SHOULDER ABD";
    case "shoulderFlexion":     return "SHOULDER FLEX";
    case "scapularElevation":   return "SHRUG";
    case "neckLateralFlexion":  return "NECK FLEX";
    case "trunkLateralFlexion": return "TRUNK FLEX";
    case "shoulderHorizAbd":    return "T-POSE";
    case "neckTilt":            return "NECK TILT";
    case "shoulderSymmetry":    return "SHOULDER SYM";
    case "trunkLean":           return "TRUNK LEAN";
  }
}
 
/**
 * Compensation metrics get a calm gray accent below their warning threshold,
 * red above. Primary metrics show neutral white — they're an information
 * display, not a quality flag.
 */
function compensationAccent(value: number | null, threshold: number): string {
  if (value === null) return "bg-white/25";
  return Math.abs(value) >= threshold ? "bg-red-500" : "bg-white/40";
}
 
function DynamicMetricCard({
  label,
  value,
  kind,
  warningThreshold,
}: {
  label: string;
  value: number | null;
  kind: "primary" | "compensation";
  warningThreshold?: number;
}) {
  const accentClass =
    kind === "primary"
      ? "bg-white/60"
      : compensationAccent(value, warningThreshold ?? Infinity);
 
  const isFlagging =
    kind === "compensation" &&
    value !== null &&
    Math.abs(value) >= (warningThreshold ?? Infinity);
 
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
          {kind === "primary" ? "Primary" : isFlagging ? "Above threshold" : "Within range"}
        </div>
      </div>
    </div>
  );
}
