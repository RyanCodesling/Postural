/** Offline adapter for the actual CameraClient processing function.
 * Only browser/MediaPipe delivery, UI setters, and persistence transport are
 * replaced. Metrics, filters, counters, latches, selector, overlay draw calls,
 * quality writers and dropout handlers execute from current product source.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import type { ExerciseDefinition } from "../../src/lib/exercises/registry";
import type { CoachingProvenance } from "../../src/lib/pose/coachingConfig";

export const cameraPath = fileURLToPath(new URL("../../src/app/(app)/camera/CameraClient.tsx", import.meta.url));
export const cameraSource = readFileSync(cameraPath, "utf8");
const ast = ts.createSourceFile(cameraPath, cameraSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "CameraClient");
assert(component?.body);
const require = createRequire(import.meta.url);

export function cameraDeclarations(names: string[], source = cameraSource): string {
  const sourceAst = source === cameraSource ? ast : ts.createSourceFile(cameraPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sourceComponent = sourceAst.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "CameraClient");
  assert(sourceComponent?.body);
  return names.map(name => {
    const statement = [...sourceAst.statements, ...sourceComponent.body!.statements].find(n =>
      ts.isFunctionDeclaration(n) ? n.name?.text === name : ts.isVariableStatement(n) &&
        n.declarationList.declarations.some(d => d.name.getText(sourceAst) === name));
    assert(statement, `Camera declaration missing: ${name}`);
    return statement.getText(sourceAst);
  }).join("\n");
}

export function transpile(source: string) {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}

export function productGlobals(): Record<string, any> {
  const globals: Record<string, any> = {};
  for (const n of ast.statements) {
    if (!ts.isImportDeclaration(n) || !ts.isStringLiteral(n.moduleSpecifier)) continue;
    const path = n.moduleSpecifier.text;
    if (!/^@\/lib\/(pose\/|exercises\/|prescriptionContext|sessionOutcomePresentation)/.test(path)) continue;
    const mod = require(fileURLToPath(new URL(`../../src/${path.slice(2)}.ts`, import.meta.url)));
    const bindings = n.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const b of bindings.elements) {
      if (!b.isTypeOnly) globals[b.name.text] = mod[b.propertyName?.text ?? b.name.text];
    }
  }
  return globals;
}

export function createCameraReplay(definition: ExerciseDefinition, provenance: CoachingProvenance, options: {
  prescribedSide?: "both" | "left" | "right";
  firstTickMs?: number;
  /** For a caller-equivalence check against a preserved earlier camera source. */
  cameraSource?: string;
} = {}) {
  let time = 1_000;
  let landmarks: any[] = [];
  let accepted = true;
  let noPerson = false;
  const emitted: any[] = [];
  const sets: any[] = [];
  const textDraws: string[] = [];
  const frames: any[] = [];
  const ref = (current: any) => ({ current });
  const noop = () => undefined;
  const globals = productGlobals();
  const canvasContext: any = {
    measureText: (s: string) => ({ width: s.length * 10 }), fillText: (s: string) => textDraws.push(s),
  };
  for (const method of ["save", "restore", "clearRect", "transform", "beginPath", "moveTo", "arcTo", "closePath", "stroke", "fill", "lineTo"]) canvasContext[method] = noop;
  const context: Record<string, any> = {
    ...globals, structuredClone, Map, Set, performance: { now: () => time },
    console: { log: noop }, requestAnimationFrame: () => 1, useCallback: (fn: any) => fn,
    DrawingUtils: class { drawConnectors() {} drawLandmarks() {} }, PoseLandmarker: { POSE_CONNECTIONS: [] },
    drawCutoutOverlay: noop,
    // Stored traces omit knees/nose, so readiness cannot be recomputed for
    // historical accepted rows. Synthetic cases can explicitly reject frames.
    // A rejected fixture frame reports LOW_CONFIDENCE, so the capture summary
    // has a status to count it under.
    evaluateCaptureReadiness: () => ({ ok: accepted, status: accepted ? "OK" : "LOW_CONFIDENCE",
      message: accepted ? "Captured" : "fixture capture interruption" }),
    inferEx004FaceShadow: () => null, recordEx004FaceShadow: noop,
    pushEx005DebugRecord: noop, bufferTuningRawFrame: noop, writeTraceSyncReadout: noop,
    updateNeutralCalibrationProgress: noop, finalizeNeutralCalibration: noop,
    resetNeutralCalibration: () => { throw new Error("Replay requires a retained completed baseline"); },
    // Replay does not fabricate prescriptions or auto-complete a recorded set.
    // Product counters still call this at their normal points.
    checkAndHandleSetCompletion: noop,
    endSessionPersistence: async () => "saved", showSessionPersistenceToast: noop,
    clearResumeSnapshot: noop,
    perfToIso: (t: number) => new Date(t).toISOString(),
    videoRef: ref({ readyState: 4, videoWidth: 1280, videoHeight: 720 }),
    canvasRef: ref({ width: 1280, height: 720, getContext: () => canvasContext }),
    landmarkerRef: ref({ detectForVideo: () => ({ landmarks: noPerson ? [] : [landmarks] }) }),
    activeDefinitionRef: ref(definition), sessionStateRef: ref("active"),
    baselinePhaseRef: ref("captured"), frozenTiltDegRef: ref(0),
    prescriptionRef: ref({ prescribedSide: options.prescribedSide ?? "both", patientExerciseId: 1, reps: 12, holdSeconds: 30 }),
    repCountsRef: ref({ left: 0, right: 0 }), repLogRef: ref({ left: [], right: [] }),
    dynamicRepQualityBufferRef: ref(new globals.DynamicRepQualityBuffer()),
    coachingCueStateRef: ref(globals.newCoachingCueState()),
    coachingDecisionRef: ref(null), coachingProvenanceRef: ref(provenance),
    coachingAuditRef: ref(new globals.CoachingAuditBuffer()),
    selectedCoachingCueMetricRef: ref(null),
    eventOutboxRef: ref({ enqueue: (kind: string, value: any) => (kind === "set" ? sets : emitted).push(structuredClone(value)) }),
    currentSetStartMsRef: ref(0), completedSetsRef: ref(0), globalRepIndexRef: ref(0),
    completedSetsLogRef: ref([]), restEndsAtMsRef: ref(null),
    showCompletionRecapAfterReportRef: ref(false), terminalOccurrenceAfterReportRef: ref(null),
  };
  const refGroups: [any, string[]][] = [
    [0, ["fpsFrameCount", "fpsWindowStartMs", "perfSampleCount", "inferMsSum", "frameMsSum", "stableOkSince", "lastBadCaptureAt", "captureFramesTotal", "captureFramesOk", "lastEx005DebugMs", "lastMetricsUpdate", "leftHoldMs", "rightHoldMs", "pairedHoldMs", "neckRepDebugSeq", "captureDropoutResets"]],
    [false, ["captureDropoutResetDone", "leftInBand", "rightInBand", "coachingShadowEnabled", "coachingShadowStaffAllowed", "traceSyncWroteThisFrame", "calibrationStale"]],
    [null, ["videoResolution", "captureDropoutStartedAt", "lastIsometricTickMs", "neckRepDebugStartMs", "request", "recorder", "lockedShoulderIndex", "lastDrawnCue"]],
  ];
  for (const [initial, names] of refGroups) for (const name of names) context[`${name}Ref`] = ref(initial);
  for (const name of ["metricFilters", "leftCompensationFilters", "rightCompensationFilters", "compensationWarningLatches", "compensationWarningSignals", "repWindowStates", "hipShiftStates"]) context[`${name}Ref`] = ref(new Map());
  for (const name of ["leftBaseline", "rightBaseline", "leftScapBaseline", "rightScapBaseline", "bidirectionalBaseline"]) context[`${name}Ref`] = ref({ value: null, samples: [] });
  context.lastCaptureOkRef = ref(true); context.lastCaptureMsgRef = ref("Captured");
  context.captureRejectedByStatusRef = ref({});
  context.neckRepDebugRef = ref([]); context.neutralCalibrationSamplesRef = ref([]);
  context.neutralCalibrationClockRef = ref(globals.newNeutralCalibrationClock());
  const params = definition.kind === "dynamic" ? definition.primaryMetric.smoothing : undefined;
  for (const side of ["left", "right"]) context[`${side}PrimaryFilterRef`] = ref(new globals.OneEuroFilter(params?.minCutoff ?? 1, params?.beta ?? 0.1, params?.dCutoff));
  const names = ["createRepCountersForDefinition", "isSideSplitIsometric", "emptyFrameMetrics", "newHoldSideAccum", "newHoldQualityAccum", "resetHoldQualityAccum", "finalizeHoldQuality", "bufferSetEvent", "bufferRepEvent", "resetCompensationWarnings", "compensationWarningStateIsDirty", "discardInProgressMovement", "resetAfterSustainedCaptureDropout", "commitCaptureState", "predictWebcam", "computeAsymmetryIndex", "prescribedCreditedValue", "handleSessionEnd"];
  const constants = ["MAX_ISO_TICK_MS", "CAPTURE_READINESS_RESET_GRACE_MS", "EX005_DEBUG_THROTTLE_MS", "MAX_NECK_REP_DEBUG_RECORDS"];
  const code = cameraDeclarations([...constants, ...names], options.cameraSource);
  // UI state setters are sinks. Capture their outputs for caller assertions.
  for (const m of code.matchAll(/\b(set[A-Z]\w+)\(/g)) context[m[1]] = (value: any) => { context[`${m[1]}Output`] = value; };
  context.lastMetricsUpdateRef.current = options.firstTickMs ?? 0;
  const sandbox = vm.createContext(context);
  vm.runInContext(transpile(code + `
    const counters = createRepCountersForDefinition(activeDefinitionRef.current);
    globalThis.leftRepCounterRef = {current:counters.left};
    globalThis.rightRepCounterRef = {current:counters.right};
    globalThis.bidirectionalRepCounterRef = {current:counters.bidirectional};
    globalThis.holdQualityAccumRef = {current:newHoldQualityAccum()};
    globalThis.subject = {predictWebcam, bufferSetEvent, finalizeHoldQuality, handleSessionEnd};
  `), sandbox);
  return {
    context, emitted, sets, frames,
    end() { context.subject.handleSessionEnd("user"); },
    tick(input: { tMs: number; landmarks?: any[]; accepted?: boolean; noPerson?: boolean; baselines?: any; frozenTilt?: number }) {
      time = input.tMs; landmarks = input.landmarks ?? landmarks;
      accepted = input.accepted ?? true; noPerson = input.noPerson ?? false;
      if (input.baselines) {
        context.leftScapBaselineRef.current.value = input.baselines.scapLeft ?? null;
        context.rightScapBaselineRef.current.value = input.baselines.scapRight ?? null;
        context.bidirectionalBaselineRef.current.value = input.baselines.bidirectionalPrimary ?? null;
      }
      if (input.frozenTilt !== undefined) context.frozenTiltDegRef.current = input.frozenTilt;
      textDraws.length = 0;
      context.subject.predictWebcam();
      const f = { tMs: time, renderedTexts: [...textDraws], selected: structuredClone(context.coachingDecisionRef.current),
        movement: globals.observeMovement(definition, { left: context.leftRepCounterRef.current, right: context.rightRepCounterRef.current, bidirectional: context.bidirectionalRepCounterRef.current },
          { left: accepted && !noPerson, right: accepted && !noPerson }, { left: context.leftInBandRef.current, right: context.rightInBandRef.current }),
        counts: { ...context.repCountsRef.current } };
      frames.push(f); return f;
    },
    close(tMs = time) {
      time = tMs;
      context.subject.bufferSetEvent({ setIndex: 1, targetReps: 0, leftReps: context.repCountsRef.current.left, rightReps: context.repCountsRef.current.right,
        pairedReps: Math.min(context.repCountsRef.current.left, context.repCountsRef.current.right), targetHoldMs: 0,
        pairedHoldMs: context.pairedHoldMsRef.current, durationMs: time, terminatedBy: "user", asymmetryIndex: 0 }, definition.kind, time);
      return sets.at(-1);
    },
  };
}
