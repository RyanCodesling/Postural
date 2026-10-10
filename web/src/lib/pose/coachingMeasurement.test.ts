/** Actual camera writers, API validation, SQL serialization and readback.
 * Browser and PostgreSQL transports are disposable in-memory fixtures.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createCameraReplay, cameraDeclarations, transpile } from "../../../scripts/lib/cameraReplayHarness";
import * as config from "./coachingConfig";
import * as versioning from "../exercises/versioning";
import * as contextContract from "../prescriptionContext";
import * as readModels from "../sessionReadModels";
import { getExerciseDefinition, EXERCISE_REGISTRY } from "../exercises/registry";
import { POSE_METRIC_ALGORITHM_VERSION } from "./metricVersion";
import { RepCounter } from "./repCounter";
import { BidirectionalRepCounter } from "./bidirectionalRepCounter";
import { validCoachingAudit, CoachingAuditBuffer, MAX_COACHING_RECORDS } from "./coachingAudit";
import * as hold from "./holdQuality";
import { EventOutbox } from "./eventOutbox";
import { isDynamicRepQuality } from "./repQuality";

const plain = (v: any) => JSON.parse(JSON.stringify(v));
const thresholds = { startThreshold: 20, repCompleteThreshold: 10, minimumPeakThreshold: 45, targetROM: 80 };
export function pose(left: number, right = left, headDrop = 0): any[] {
  const p = (x: number, y: number) => ({ x, y, z: 0, visibility: 1 });
  const lm = Array.from({ length: 33 }, () => p(0.5, 0.5));
  lm[7] = p(0.6, 0.23 + headDrop); lm[8] = p(0.4, 0.23 + headDrop);
  lm[11] = p(0.6, 0.35); lm[12] = p(0.4, 0.35);
  lm[23] = p(0.6, 0.7); lm[24] = p(0.4, 0.7);
  for (const [angle, shoulder, elbow, wrist, sign] of [[left, 11, 13, 15, 1], [right, 12, 14, 16, -1]]) {
    const r = angle * Math.PI / 180;
    lm[elbow] = p(lm[shoulder].x + sign * 0.16 * Math.sin(r), 0.35 + 0.16 * Math.cos(r));
    lm[wrist] = p(lm[shoulder].x + sign * 0.3 * Math.sin(r), 0.35 + 0.3 * Math.cos(r));
  }
  return lm;
}

async function run() {
  for (const definition of Object.values(EXERCISE_REGISTRY)) {
    const before = versioning.sha256Version(versioning.exerciseVersionPayload(definition));
    const modified = structuredClone(definition);
    modified.compensationMetrics[0].cue!.message += " Test";
    modified.compensationMetrics[0].cue!.priority += 1;
    modified.compensationMetrics[0].cue!.cooldownMs = 4567;
    assert.equal(versioning.sha256Version(versioning.exerciseVersionPayload(modified)), before);
    const a = await config.captureCoachingProvenance(definition);
    assert.equal(a.version, versioning.COACHING_CONFIG_VERSIONS[definition.id]);
    assert.notEqual((await config.captureCoachingProvenance(modified)).version, a.version);
  }
  const c = new RepCounter(thresholds);
  c.update(0, 100); c.update(40, 200); c.update(90, 300);
  const snapshot = c.getMovementSnapshot();
  assert.equal(snapshot.state, "ASCENDING");
  assert(Object.isFrozen(snapshot));
  assert.equal(c.getState(), "ASCENDING");
  c.update(90, 400);
  assert.equal(c.getMovementSnapshot().state, "ASCENDING", "plateau is not a proven peak phase");
  c.update(70, 500); assert.equal(c.getMovementSnapshot().state, "DESCENDING");
  assert(c.update(0, 600)); c.reset();
  assert.equal(c.getRepCount(), 1); assert.equal(c.getMovementSnapshot().runningPeak, null);
  c.update(0, 1000); c.update(50, 1301);
  assert.equal(c.getState(), "WAITING_FOR_REP_START", "301 ms still clears rest evidence");
  const b = new BidirectionalRepCounter(thresholds);
  b.update(0, 100); b.update(-50, 200);
  assert.equal(b.getMovementSnapshot().activeSide, "right");

  const definition = getExerciseDefinition("ex_001")!;
  const provenance = await config.captureCoachingProvenance(definition);
  assert.equal(provenance.configuration.messageRendered, false, "current product still does not render messages");
  const futureConfiguration = { ...provenance.configuration, messageRendered: true };
  assert(config.validCoachingProvenance({ version: versioning.sha256Version(futureConfiguration), configuration: futureConfiguration }),
    "provenance validates the recorded boolean, not today's rollout policy");
  assert(!config.validCoachingProvenance({ ...provenance, configuration: { ...futureConfiguration, messageRendered: "true" } }));
  const replay = createCameraReplay(definition, provenance, { prescribedSide: "left" });
  let now = 1000;
  const baseline = { scapLeft: 0.12 / 0.35, scapRight: 0.12 / 0.35 };
  // One complete left cycle, right arm stationary: real metrics + filters + counters.
  for (const a of [0, 0, 15, 30, 50, 70, 95, 95, 95, 70, 50, 30, 10, 0, 0, 0]) {
    replay.tick({ tMs: now += 100, landmarks: pose(a, 0), baselines: baseline });
  }
  assert.equal(replay.emitted.filter(r => r.side === "left").length, 1);
  assert.equal(replay.emitted.filter(r => r.side === "right").length, 0);
  assert(isDynamicRepQuality(replay.emitted[0].compensations), "actual rep writer retains V2 raw/live/features contract");
  assert(replay.emitted[0].compensations.rawFeatures);
  for (let i = 0; i < 30; i++) replay.tick({ tMs: now += 100, landmarks: pose(0, 0, 0.07), baselines: baseline });
  assert(replay.frames.some(f => f.renderedTexts.includes("Shoulder / head position")), "actual renderer records the label");
  assert(replay.frames.every(f => !f.renderedTexts.includes("Relax your shoulders down.")), "declared sentence stays unrendered");
  const countBefore = replay.emitted.length;
  replay.tick({ tMs: now += 100, noPerson: true });
  replay.tick({ tMs: now += 400, noPerson: true });
  assert.equal(replay.emitted.length, countBefore);
  assert.equal(replay.context.leftRepCounterRef.current.getState(), "WAITING_FOR_REP_START");
  assert.equal(replay.context.calibrationStaleRef.current, true);
  const set = replay.close();
  assert(hold.validSetMeasurement(set.holdQuality, "dynamic"));
  assert(set.holdQuality.coaching.records.some((r: any) => r.absenceReason === "capture-unavailable" && r.rendered.length === 0));
  assert(!JSON.stringify(set.holdQuality).includes('"corrected"'));
  const noCredit = createCameraReplay(definition, provenance);
  noCredit.tick({ tMs: 1000, noPerson: true });
  noCredit.end();
  assert.equal(noCredit.sets.length, 1, "End persists capture-only attempts with no credited movement");
  assert.equal(noCredit.context.completedSetsLogRef.current.length, 0, "audit-only row does not alter the live recap");
  assert.equal(noCredit.sets[0].pairedReps, 0);
  assert.equal(noCredit.sets[0].holdQuality.auditOnly, true);
  assert(hold.validSetMeasurement(noCredit.sets[0].holdQuality, "dynamic"));

  const isoDef = getExerciseDefinition("ex_006")!;
  const iso = createCameraReplay(isoDef, await config.captureCoachingProvenance(isoDef));
  for (let i = 0; i < 12; i++) iso.tick({ tMs: 1000 + 100 * i, landmarks: pose(90, 0), baselines: baseline });
  assert(iso.context.leftHoldMsRef.current > 0);
  assert.equal(iso.context.rightHoldMsRef.current, 0);
  assert.equal(iso.context.pairedHoldMsRef.current, 0);
  const isoSet = iso.close();
  assert(hold.validSetMeasurement(isoSet.holdQuality, "isometric"));
  assert.equal(isoSet.holdQuality.leftInBandMs, 1100);
  assert.equal(hold.isAuditOnlyMeasurement(isoSet.holdQuality), false, "one-sided hold is a real partial outcome even with zero paired credit");
  const isoNoCredit = createCameraReplay(isoDef, await config.captureCoachingProvenance(isoDef));
  isoNoCredit.tick({ tMs: 1000, noPerson: true });
  isoNoCredit.end();
  assert(hold.isAuditOnlyMeasurement(isoNoCredit.sets[0].holdQuality));
  const legacy = plain(isoSet.holdQuality);
  for (const key of ["version", "coaching", "primaryUnits", "compensationScoreSource", "streakMode"]) delete legacy[key];
  assert(hold.readHoldQuality(legacy));
  for (const bad of [{ ...legacy, sampleCount: -1 }, { ...legacy, meanCompensationScore: 101 },
    { ...legacy, leftInBandMs: NaN }, { ...legacy, version: "hold_quality_v999" }, { arbitrary: true }]) assert.equal(hold.readHoldQuality(bad), null);
  const clipped = new CoachingAuditBuffer();
  for (let i = 0; i < MAX_COACHING_RECORDS + 3; i++) clipped.interrupt(i * 500, "active");
  const clippedAudit = clipped.snapshot(provenance, (MAX_COACHING_RECORDS + 3) * 500);
  assert.equal(clippedAudit.droppedRecords, 3);
  assert(clippedAudit.records.slice(1).every(r => r.gapBeforeMs === 500));
  assert(validCoachingAudit(clippedAudit));
  assert(!validCoachingAudit({ ...clippedAudit, closedAtMs: 0 }));

  // Execute the production database functions against a disposable transport.
  let storedSession: any;
  const storedSets: any[] = [];
  const client = { release() {}, async query(sql: string, values: any[] = []) {
    if (sql.includes("FROM exercise_occurrences eo")) return { rows: [{ id: 1, due_date: "2026-09-23", makeup_until: "2026-09-23", status: "pending", prescription_snapshot: null,
      patient_exercise_id: 1, exercise_id: "ex_001", sets: 1, reps: 1, rest_seconds: 0, hold_seconds: 0, sequence_index: 1, prescribed_side: "left", resistance_type: "none", name: definition.name }] };
    if (sql.includes("INSERT INTO sessions")) {
      // started_at is the sixth value: it comes from the app's clock (the demo clock in demo mode).
      storedSession = { id: 71, patient_id: "fixture", exercise_id: "ex_001", started_at: values[5], context_snapshot: JSON.parse(values[6]),
        registry_version: values[9], exercise_config_version: values[10], app_revision: values[11] };
      return { rows: [{ id: 71, started_at: "2026-09-23T00:00:00Z" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO set_events")) {
      assert(sql.includes("ON CONFLICT (session_id, set_index) DO NOTHING"));
      const duplicate = storedSets.some(s => s.set_index === values[1]);
      if (!duplicate) storedSets.push({ set_index: values[1], exercise_kind: values[2], hold_quality: JSON.parse(values[14]) });
      return { rows: [], rowCount: duplicate ? 0 : 1 };
    }
    return { rows: [], rowCount: 0 };
  } };
  const pool = { connect: async () => client, async query(sql: string) {
    if (sql.includes("FROM sessions s")) return { rows: [storedSession] };
    if (sql.includes("FROM set_events")) return { rows: storedSets };
    return { rows: [] };
  } };
  const dbSource = readFileSync(new URL("../db.ts", import.meta.url), "utf8");
  const dbAst = ts.createSourceFile("db.ts", dbSource, ts.ScriptTarget.Latest, true);
  const dbFunctions = dbAst.statements.filter(n => ts.isFunctionDeclaration(n) && ["createSession", "insertSetEvents", "getSessionDetail"].includes(n.name?.text ?? ""));
  assert.equal(dbFunctions.length, 3);
  const dbContext: any = vm.createContext({ exports: {}, pool, ...versioning, ...contextContract, ...readModels, ...hold,
    POSE_METRIC_ALGORITHM_VERSION, getExerciseDefinition, coachingConfiguration: config.coachingConfiguration,
    getUserById: async () => null, todayKeyPH: () => "2026-09-23",
    getEffectiveNow: async () => new Date("2026-09-23T04:00:00.000Z"), console });
  vm.runInContext(transpile(dbFunctions.map(n => n.getText(dbAst)).join("\n")), dbContext);
  await dbContext.exports.createSession({ patientId: "fixture", patientExerciseId: 1, occurrenceId: 1, exerciseId: "ex_001" });
  assert.equal(storedSession.started_at, "2026-09-23T04:00:00.000Z", "the session starts at the app's time");
  assert.equal(storedSession.context_snapshot.coaching.source, "server-default-unverified", "legacy client provenance is not fabricated");
  assert(!("preSessionPain" in storedSession.context_snapshot), "a start without the survey stores no answer");
  const jsonResponse = (body: any, init?: any) => new Response(JSON.stringify(body), { status: init?.status ?? 200 });
  const sessionRouteContext: any = vm.createContext({ exports: {}, console, require: (name: string) => {
    if (name === "next/server") return { NextResponse: { json: jsonResponse } };
    if (name === "@/lib/auth-server") return { getAuthenticatedUser: async () => ({ id: "fixture", role: "patient" }) };
    if (name === "@/lib/db") return { createSession: dbContext.exports.createSession, SessionNotScheduledError: class extends Error {} };
    if (name === "@/lib/pose/coachingConfig") return config;
    if (name === "@/lib/exercises/versioning") return versioning;
    if (name === "@/lib/prescriptionContext") return contextContract;
    if (name === "@/lib/recording/storage") return { hasRecording: async () => false };
    throw new Error(`Unexpected session route import ${name}`);
  } });
  vm.runInContext(transpile(readFileSync(new URL("../../app/api/sessions/route.ts", import.meta.url), "utf8")), sessionRouteContext);
  const sessionRequest = (body: any) => sessionRouteContext.exports.POST({ json: async () => body });
  const invalidResponse = await sessionRequest({ patientExerciseId: 1, occurrenceId: 1, exerciseId: definition.id,
    coaching: { ...provenance, version: `sha256:${"0".repeat(64)}` } });
  assert.equal(invalidResponse.status, 400);
  for (const preSessionPain of [{ status: "reported", score: 11 }, { status: "reported", score: 2.5 }, { status: "later" },
    { status: "reported", score: 3, bodyArea: "x".repeat(81) }]) {
    const invalidPain = await sessionRequest({ patientExerciseId: 1, occurrenceId: 1, exerciseId: definition.id, preSessionPain });
    assert.equal(invalidPain.status, 400, `malformed pre-session pain is refused: ${JSON.stringify(preSessionPain)}`);
  }
  const noop = () => undefined;
  const sessionClient: any = { console, performance: { now: () => 1000 }, resetSessionPersistence: noop,
    setTraceUploadLoss: noop, setPendingCompletionNavigation: noop, setScheduleNotice: noop,
    setPrescriptionRaw: noop, flushSetEvents: noop, flushRepEvents: noop, flushRawFrames: noop, writeResumeSnapshot: noop,
    fetch: async (url: string, init: any) => {
      assert.equal(url, "/api/sessions");
      const body = JSON.parse(init.body);
      assert.deepEqual(body.coaching, provenance, "executing browser provenance is sent by actual session writer");
      return sessionRequest(body);
    },
    prescriptionRef: { current: { patientExerciseId: 1, occurrenceId: 1 } }, activeDefinitionRef: { current: definition },
    coachingProvenanceRef: { current: provenance }, eventOutboxRef: { current: { setSession: noop } },
  };
  for (const name of ["traceUploadLoss", "reportSessionId", "showCompletionRecapAfterReport", "terminalOccurrenceAfterReport", "pendingStaleEndReason", "sessionWallStartMs", "sessionPerfStartMs", "sessionId", "preSessionPain", "videoConsent"]) sessionClient[`${name}Ref`] = { current: null };
  sessionClient.preSessionPainRef.current = { status: "reported", score: 7, bodyArea: "  left shoulder " };
  sessionClient.sessionTokenRef = { current: 0 };
  vm.createContext(sessionClient);
  vm.runInContext(transpile(cameraDeclarations(["startSessionPersistence"]) + "\nglobalThis.start = startSessionPersistence;"), sessionClient);
  assert.equal(await sessionClient.start(), true);
  assert.equal(sessionClient.sessionIdRef.current, 71);
  assert.equal(storedSession.context_snapshot.version, 3);
  assert.equal(storedSession.context_snapshot.versions.coachingConfig, provenance.version);
  assert.equal(storedSession.context_snapshot.coaching.source, "executing-client");
  assert.deepEqual(storedSession.context_snapshot.preSessionPain, { status: "reported", score: 7, bodyArea: "left shoulder" },
    "the survey answer is stored, trimmed, with the start context");

  const routeContext: any = vm.createContext({ exports: {}, console: { warn() {}, error() {} }, require: (name: string) => {
    if (name === "next/server") return { NextResponse: { json: (body: any, init?: any) => new Response(JSON.stringify(body), { status: init?.status ?? 200 }) } };
    if (name === "@/lib/auth-server") return { getAuthenticatedUser: async () => ({ id: "fixture", role: "patient" }) };
    if (name === "@/lib/db") return { getSessionOwner: async () => "fixture", insertSetEvents: dbContext.exports.insertSetEvents };
    if (name === "@/lib/pose/holdQuality") return hold;
    if (name === "@/lib/exercises/versioning") return versioning;
    throw new Error(`Unexpected route import ${name}`);
  } });
  const route = readFileSync(new URL("../../app/api/sessions/[id]/set-events/route.ts", import.meta.url), "utf8");
  vm.runInContext(transpile(route), routeContext);
  const post = (sets: any[]) => routeContext.exports.POST({ json: async () => ({ sets }) }, { params: Promise.resolve({ id: "71" }) });
  const malformed = { ...set, setIndex: 4, holdQuality: { version: "hold_quality_v999", meanCompensationScore: 99 } };
  const mixed = await post([set, malformed]);
  assert.equal(mixed.status, 200);
  assert.equal((await mixed.json()).quarantined.length, 1);
  assert.equal(storedSets.length, 2, "valid outcome and invalid evidence must both be retained");
  const quarantine = storedSets[1].hold_quality;
  assert.equal(quarantine.version, "quarantined_measurement_v1");
  assert.deepEqual(quarantine.original, malformed.holdQuality);
  assert.equal(hold.readHoldQuality(quarantine), null);
  assert.equal(quarantine.meanCompensationScore, undefined, "quarantine must not masquerade as usable quality");

  let failOnce = true;
  const storage = new Map<string, string>();
  const options = { storage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } },
    schedule: () => undefined, fetchFn: async (_url: string, init: any) => {
      if (failOnce) { failOnce = false; throw new Error("fixture offline"); }
      return post(JSON.parse(init.body).sets);
    } };
  const outbox = new EventOutbox<any, any>(options);
  outbox.setSession(71); outbox.enqueue("set", malformed);
  assert.equal(await outbox.flush("set"), "failed");
  const restored = new EventOutbox<any, any>(options);
  restored.setSession(71); assert(restored.restoreFor(71) > 0);
  restored.enqueue("set", { ...isoSet, setIndex: 2 });
  assert.equal(await restored.flush("set"), "delivered");
  assert.equal(restored.pendingCount(), 0, "malformed evidence must not block a later valid set after reload");
  assert.equal((await post([set])).status, 200);
  assert.equal(storedSets.length, 3);
  assert.equal((await post([{ ...isoSet, setIndex: 2 }, { ...isoSet, setIndex: 3, holdQuality: legacy }])).status, 200);
  assert.equal((await post([{ ...noCredit.sets[0], setIndex: 5 }, { ...isoNoCredit.sets[0], setIndex: 6 }])).status, 200);
  const badFingerprint = plain(noCredit.sets[0]);
  badFingerprint.setIndex = 7;
  badFingerprint.holdQuality.coaching.provenance.configuration.tickMs++;
  const badReply = await post([badFingerprint]);
  assert.equal(badReply.status, 200);
  assert.equal((await badReply.json()).quarantined[0].reason, "coaching configuration fingerprint mismatch");
  const detail = plain(await dbContext.exports.getSessionDetail(71));
  const qualityAt = (index: number) => detail.sets.find((s: any) => s.setIndex === index)?.holdQuality;
  assert.deepEqual(qualityAt(1), plain(set.holdQuality));
  assert.deepEqual(qualityAt(2), plain(isoSet.holdQuality));
  assert.deepEqual(qualityAt(3), legacy);
  assert.deepEqual(qualityAt(4), quarantine);
  assert.equal(detail.sets.length, 4, "audit-only attempts must not render as therapist outcome sets");
  assert.equal(detail.auditAttempts.length, 3);
  assert.deepEqual(detail.auditAttempts[0].holdQuality, plain(noCredit.sets[0].holdQuality));
  assert.equal(detail.auditAttempts[2].holdQuality.auditOnly, true, "invalid audit remains excluded after quarantine");
  assert.deepEqual(detail.auditAttempts[2].holdQuality.original, badFingerprint.holdQuality);
  assert.equal(detail.context.versions.coachingConfig, provenance.version);

  // Video consent counts only for the notice the page showed: a page from
  // before a notice change (or one that sends no notice) is refused.
  const consentStart = { patientExerciseId: 1, occurrenceId: 1, exerciseId: definition.id, videoConsent: true };
  for (const videoNotice of [undefined, "session_video_notice_v1"]) {
    const stale = await sessionRequest({ ...consentStart, videoNotice });
    assert.equal(stale.status, 409, `consent under notice ${videoNotice} is refused`);
    assert.equal((await stale.json()).code, "video_notice_changed");
  }
  assert.equal((await sessionRequest({ ...consentStart, videoConsent: false })).status, 200, "declining needs no notice");
  assert(!("videoConsent" in storedSession.context_snapshot));
  sessionClient.videoConsentRef.current = true;
  sessionClient.videoConsentRememberedRef = { current: true };
  sessionClient.videoConsentNoticeRef = { current: contextContract.SESSION_VIDEO_NOTICE_VERSION };
  assert.equal(await sessionClient.start(), true, "the camera page sends the notice it showed");
  assert.deepEqual({ ...storedSession.context_snapshot.videoConsent, consentedAt: "" },
    { consentedAt: "", notice: contextContract.SESSION_VIDEO_NOTICE_VERSION, remembered: true });
  console.log("Coaching contract: hashes, read-only movement, real camera processing/writers, draw labels, dropout, hold/legacy validation, API, durable retry and SQL readback passed (fake transports).");
}
run().catch(e => { console.error(e); process.exitCode = 1; });
