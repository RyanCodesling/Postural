/**
 * Optional session video: storage, byte ranges, the player's timeline, the
 * browser recorder's upload queue, and the actual API route handlers run
 * against a temporary recordings folder with fake authentication.
 *
 *   npx tsx src/lib/recording/recording.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import stream from "node:stream";
import vm from "node:vm";
import { cameraDeclarations, transpile } from "../../../scripts/lib/cameraReplayHarness";
import { getExerciseDefinition } from "../exercises/registry";
import { captureCoachingProvenance } from "../pose/coachingConfig";
import { CoachingAuditBuffer } from "../pose/coachingAudit";
import { parseRange } from "./http";
import { pickRecordingMimeType, SessionRecorder } from "./sessionRecorder";
import * as storage from "./storage";
import { REP_CHECK_RATIO, buildVideoTimeline, formatVideoTime, repChecks } from "./timeline";
import { forgetVideoChoice, readVideoChoice, rememberVideoChoice } from "./videoChoice";
import { drawCompensationOverlay } from "../pose/drawCompensationOverlay";
import {
  drawCueLabel,
  drawOverlayFrame,
  encodeLandmarks,
  OVERLAY_NOT_SAVED_LABEL,
  overlayFrameAt,
  overlayPlayback,
  parseOverlayTrack,
  POSE_CONNECTIONS,
} from "./overlayTrack";

const root = mkdtempSync(path.join(tmpdir(), "postural-recordings-"));
process.env.RECORDINGS_DIR = root;

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    failed += 1;
  }
}
const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

/** A canvas context that records every call; measureText is 10 px per character. */
function fakeCanvas() {
  const calls: Array<[string, any[]]> = [];
  const ctx = new Proxy({}, {
    get: (_target, name) => name === "measureText"
      ? (s: string) => ({ width: s.length * 10 })
      : (...args: any[]) => { calls.push([String(name), args]); },
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

/** A standing figure: shoulders at 11/12, hips at 23/24, the rest spread out. */
const standing = () => Array.from({ length: 33 }, (_, i) => ({
  x: i === 11 ? 0.45 : i === 12 ? 0.55 : i === 23 ? 0.47 : i === 24 ? 0.53 : 0.3 + (i % 10) * 0.04,
  y: i === 11 || i === 12 ? 0.35 : i === 23 || i === 24 ? 0.65 : 0.1 + (i % 7) * 0.1,
}));

async function run() {
  console.log("\nsession video\n");

  await test("storage appends chunks in order, ignores repeats and refuses gaps", async () => {
    const part = await storage.startPart(1, "video/webm;codecs=vp8", 1_000);
    assert.equal(part?.index, 1);
    assert.equal(await storage.appendChunk(1, 1, 1, bytes(1, 2)), "appended");
    assert.equal(await storage.appendChunk(1, 1, 2, bytes(3)), "appended");
    assert.equal(await storage.appendChunk(1, 1, 2, bytes(3)), "duplicate", "a retried chunk is harmless");
    assert.equal(await storage.appendChunk(1, 1, 4, bytes(9)), "gap", "a skipped chunk is refused");
    assert.equal(await storage.appendChunk(1, 2, 1, bytes(9)), "missing");
    assert.equal(await storage.finishPart(1, 1, 6_000, true), true);
    assert.equal(await storage.appendChunk(1, 1, 3, bytes(9)), "closed", "a finished part cannot grow");
    const manifest = await storage.readManifest(1);
    assert.deepEqual(manifest?.parts.map((p) => [p.index, p.bytes, p.chunks, p.status, p.endWallMs]), [[1, 3, 2, "complete", 6_000]]);
    assert.deepEqual([...readFileSync(path.join(root, "session-1", "part-1.webm"))], [1, 2, 3], "the file is the chunks in order");
    assert.equal(await storage.hasRecording(1), true);
    assert.equal(await storage.hasRecording(2), false);
  });

  await test("a part left open by a reload is closed as incomplete when the next one starts", async () => {
    await storage.startPart(3, "video/webm", 1_000);
    await storage.appendChunk(3, 1, 1, bytes(1));
    await storage.startPart(3, "video/webm", 9_000);
    const parts = (await storage.readManifest(3))!.parts;
    assert.deepEqual(parts.map((p) => [p.index, p.status]), [[1, "incomplete"], [2, "recording"]]);
  });

  await test("size, part-count and type limits hold, and delete removes everything", async () => {
    await storage.startPart(4, "video/webm", 1_000);
    assert.equal(await storage.appendChunk(4, 1, 1, new Uint8Array(storage.MAX_CHUNK_BYTES + 1)), "too-large");
    for (let i = 2; i <= storage.MAX_PARTS; i++) assert(await storage.startPart(4, "video/webm", 1_000 + i));
    assert.equal(await storage.startPart(4, "video/webm", 99_000), null, "part cap");
    for (const ok of ["video/webm", "video/webm;codecs=vp8", "video/mp4;codecs=avc1.42E01E"]) assert(storage.validRecordingMimeType(ok), ok);
    for (const bad of ["text/html", "video/webm;codecs=vp8<script>", "", 7]) assert(!storage.validRecordingMimeType(bad), String(bad));
    await storage.deleteRecording(4);
    assert.equal(await storage.readManifest(4), null);
  });

  await test("a remembered video answer is per patient and void under a newer notice", () => {
    const memory = new Map<string, string>();
    const store = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    };
    assert.equal(readVideoChoice("p1", store), null, "nothing remembered yet");
    rememberVideoChoice("p1", true, store);
    assert.equal(readVideoChoice("p1", store)?.record, true);
    assert.equal(readVideoChoice("p2", store), null, "another patient on this device is still asked");
    rememberVideoChoice("p1", false, store);
    assert.equal(readVideoChoice("p1", store)?.record, false, "a new answer replaces the old one");
    memory.set("postural.videoChoice.p1", JSON.stringify({ record: true, notice: "session_video_notice_v1", savedAt: "x" }));
    assert.equal(readVideoChoice("p1", store), null, "a choice made under an older notice is ignored");
    rememberVideoChoice("p1", true, store);
    forgetVideoChoice("p1", store);
    assert.equal(readVideoChoice("p1", store), null, "Ask me each time forgets it");
    assert.equal(readVideoChoice(undefined, store), null, "no user, no choice");
    memory.set("postural.videoChoice.p1", "{not json");
    assert.equal(readVideoChoice("p1", store), null, "a damaged entry is ignored");
  });

  await test("the overlay track round-trips and is looked up by time, leaving tracking gaps blank", () => {
    const encoded = encodeLandmarks(standing());
    assert.equal(encoded.length, 66, "x and y for 33 landmarks");
    assert.equal(encodeLandmarks([{ x: 0.123456, y: 0.98765 }]).join(","), "0.123,0.988", "3 decimals");
    const lines = [{ t: 200, lm: encoded }, { t: 0, lm: encoded }, { t: 100, lm: encoded, cue: { metric: "trunkLean", direction: "left" } }]
      .map((frame) => JSON.stringify(frame)).join("\n") + "\n{\"t\":300,\"lm\":[0.1";
    const frames = parseOverlayTrack(lines);
    assert.deepEqual(frames.map((f) => f.t), [0, 100, 200], "sorted, and a cut-off last line is skipped");
    assert.equal(overlayFrameAt(frames, 150)?.t, 100);
    assert.equal(overlayFrameAt(frames, 100)?.cue?.metric, "trunkLean");
    assert.equal(overlayFrameAt(frames, -5), null, "nothing before the first frame");
    assert.equal(overlayFrameAt(frames, 700), null, "nothing past a tracking gap");
  });

  await test("a recorded frame redraws the live skeleton and cue, with labels readable on the unmirrored video", () => {
    const landmarks = standing();
    const played = fakeCanvas();
    drawOverlayFrame(played.ctx, { t: 0, lm: encodeLandmarks(landmarks), cue: { metric: "trunkLean", direction: "right" } }, 1280, 720);
    assert.equal(played.calls.filter(([name]) => name === "arc").length, 33, "a dot per landmark");
    assert(played.calls.filter(([name]) => name === "lineTo").length >= POSE_CONNECTIONS.length, "the skeleton's lines");
    const playedLabel = played.calls.find(([name]) => name === "fillText")!;
    assert.equal(playedLabel[1][0], "STRAIGHTEN", "the same cue text as live");
    assert(!played.calls.some(([name]) => name === "transform"), "no pre-flip on the unmirrored video");

    const live = fakeCanvas();
    const rounded = encodeLandmarks(landmarks);
    const liveLandmarks = Array.from({ length: 33 }, (_, i) => ({ x: rounded[2 * i], y: rounded[2 * i + 1], z: 0, visibility: 1 }));
    drawCompensationOverlay(live.ctx, liveLandmarks, 1280, 720, [{ name: "trunkLean" } as any], { trunkLean: 0 },
      { trunkLean: "right" }, new Set(["trunkLean"] as const));
    const liveLabel = live.calls.find(([name]) => name === "fillText")!;
    assert(live.calls.some(([name]) => name === "transform"), "live keeps its pre-flip for the mirrored camera view");
    assert.equal(liveLabel[1][1] + playedLabel[1][1], 1280, "the label sits at the mirrored position live and the direct one in playback");

    const old = fakeCanvas();
    drawCueLabel(old.ctx, 'Trunk lean: "STRAIGHTEN"', 1280);
    assert.deepEqual(old.calls.find(([name]) => name === "fillText")![1].slice(0, 2), ['Trunk lean: "STRAIGHTEN"', 640],
      "older videos show the cue label, centred");
  });

  await test("a saved LOWER cue is redrawn on the shoulder it was locked to; older tracks draw as before", () => {
    // The live arrow was locked to landmark 11, but landmark 12 is now higher.
    const landmarks = standing().map((p, i) => (i === 11 ? { ...p, y: 0.39 } : i === 12 ? { ...p, y: 0.31 } : p));
    const lm = encodeLandmarks(landmarks);
    const rounded = Array.from({ length: 33 }, (_, i) => ({ x: lm[2 * i], y: lm[2 * i + 1], z: 0, visibility: 1 }));
    const lowerAt = (canvas: ReturnType<typeof fakeCanvas>) =>
      canvas.calls.find(([name, args]) => name === "fillText" && args[0] === "LOWER")![1].slice(1, 3);
    const drawLive = (shoulderElevatedIndex?: 11 | 12) => {
      const canvas = fakeCanvas();
      drawCompensationOverlay(canvas.ctx, rounded, 1280, 720, [{ name: "shoulderSymmetry", warningThreshold: 5 }],
        { shoulderSymmetry: 8 }, {}, new Set(["shoulderSymmetry"] as const), { mirroredDisplay: false, shoulderElevatedIndex });
      return canvas;
    };
    const saved = fakeCanvas();
    drawOverlayFrame(saved.ctx, { t: 0, lm, cue: { metric: "shoulderSymmetry", direction: "right", shoulder: 11 } }, 1280, 720);
    assert.deepEqual(lowerAt(saved), lowerAt(drawLive(11)), "playback places LOWER where it was drawn live");
    const older = fakeCanvas();
    drawOverlayFrame(older.ctx, { t: 0, lm, cue: { metric: "shoulderSymmetry", direction: "left" } }, 1280, 720);
    assert.deepEqual(lowerAt(older), lowerAt(drawLive()), "a track without the shoulder picks the higher one, as before");
    assert.notDeepEqual(lowerAt(saved), lowerAt(older), "the two cases differ in this pose");
  });

  await test("overlay tracks are stored per part in order and read back", async () => {
    await storage.startPart(70, "video/webm", 1_000);
    const line = '{"t":0,"lm":[0.1,0.2]}\n';
    assert.equal(await storage.appendOverlayChunk(70, 1, 1, text(line), 4_000), "appended");
    assert.equal(await storage.appendOverlayChunk(70, 1, 1, text(line), 4_000), "duplicate");
    assert.equal(await storage.appendOverlayChunk(70, 1, 3, text(line), 12_000), "gap");
    assert.equal(await storage.appendOverlayChunk(70, 2, 1, text(line)), "missing");
    assert.equal(await storage.readOverlay(70, 1), line);
    let part = (await storage.readManifest(70))!.parts[0];
    assert.deepEqual([part.overlayChunks, part.overlayBytes, part.bytes], [1, line.length, 0], "kept apart from the video bytes");
    assert.equal(part.overlayThroughMs, 4_000, "the stored chunk covers the part up to 4 s");
    assert.equal(storage.overlayCoverage(part), "partial", "an open track is not yet complete");
    await storage.finishPart(70, 1, 2_000, true, true);
    part = (await storage.readManifest(70))!.parts[0];
    assert.equal(storage.overlayCoverage(part), "complete", "the browser reported the whole track saved");
    assert.equal(await storage.appendOverlayChunk(70, 1, 2, text(line)), "closed");
    assert.equal(await storage.readOverlay(71, 1), null);

    // Whether the track is whole is kept apart from whether the video is.
    await storage.startPart(72, "video/webm", 1_000);
    await storage.appendOverlayChunk(72, 1, 1, text(line), 500);
    await storage.finishPart(72, 1, 9_000, true, false);
    part = (await storage.readManifest(72))!.parts[0];
    assert.deepEqual([part.status, storage.overlayCoverage(part), part.overlayThroughMs], ["complete", "partial", 500],
      "a complete video with a lost overlay stretch");
    await storage.startPart(73, "video/webm", 1_000);
    await storage.finishPart(73, 1, 9_000, true);
    assert.equal(storage.overlayCoverage((await storage.readManifest(73))!.parts[0]), "none", "no track and no report");
    await storage.startPart(74, "video/webm", 1_000);
    await storage.finishPart(74, 1, 9_000, true, false);
    assert.equal(storage.overlayCoverage((await storage.readManifest(74))!.parts[0]), "partial", "a track lost from its start");
  });

  await test("the player draws saved overlays, labels a lost stretch, and falls back to cue labels", () => {
    assert.deepEqual(overlayPlayback({ hasOverlay: true, overlay: "complete", overlayThroughMs: 9_000 }), {
      source: "track", savedThroughMs: null,
      note: "Overlays are redrawn from the pose and cues saved with this video, as they appeared on screen.",
    });
    assert.deepEqual(overlayPlayback({ hasOverlay: true, overlay: "partial", overlayThroughMs: 42_500 }), {
      source: "track", savedThroughMs: 42_500,
      note: "Overlays were saved only up to 0:42, so none are drawn after that.",
    }, "a lost stretch is stated, not left looking like no cue");
    assert.equal(overlayPlayback({ hasOverlay: true, overlay: "partial", overlayThroughMs: null }).savedThroughMs, null,
      "a track with no coverage record draws what it has");
    assert.deepEqual(overlayPlayback({ hasOverlay: false, overlay: "partial", overlayThroughMs: null }), {
      source: "labels", savedThroughMs: null,
      note: "The coaching overlays of this video could not be saved, so only the cue labels from the coaching record are shown.",
    });
    for (const overlay of ["none", undefined] as const) {
      assert.equal(overlayPlayback({ hasOverlay: false, overlay }).note,
        "No coaching overlays were saved with this video, so only the cue labels from the coaching record are shown.");
    }
    const note = fakeCanvas();
    drawCueLabel(note.ctx, OVERLAY_NOT_SAVED_LABEL, 1280, "note");
    assert.equal(note.calls.find(([name]) => name === "fillText")![1][0], "Overlay not saved from this point");
  });

  await test("byte ranges follow HTTP, clamped to the file", () => {
    assert.equal(parseRange(null, 100), null);
    assert.deepEqual(parseRange("bytes=0-9", 100), { start: 0, end: 9 });
    assert.deepEqual(parseRange("bytes=90-", 100), { start: 90, end: 99 });
    assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
    assert.deepEqual(parseRange("bytes=50-500", 100), { start: 50, end: 99 });
    assert.equal(parseRange("bytes=100-", 100), "unsatisfiable");
    assert.equal(parseRange("bytes=0-1,5-6", 100), null, "several ranges: serve the whole file");
  });

  await test("the timeline places sets, repetitions and cues on the part's video", async () => {
    const t0 = Date.parse("2026-09-26T03:00:00.000Z");
    const iso = (ms: number) => new Date(t0 + ms).toISOString();
    const provenance = await captureCoachingProvenance(getExerciseDefinition("ex_001")!);
    const buffer = new CoachingAuditBuffer();
    const observe = (t: number, cue: boolean) => buffer.observe(t, {
      capture: "available", sessionState: "active", baselineReady: true,
      movement: { left: "ASCENDING", right: "ASCENDING", activeSide: null }, selected: null,
      rendered: cue ? [{ metric: "trunkLean", text: "STRAIGHTEN", direction: null }] : [],
      renderEvidence: "canvas-frame", suppressedMetrics: [], absenceReason: cue ? null : "not-selected",
    });
    // The page's performance clock reads 0 at t0 - 5000 ms.
    for (let t = 5000; t <= 7000; t += 100) observe(t, t >= 6000 && t <= 6500);
    const audit = buffer.snapshot(provenance, 7000, iso(-5000));
    const rep = (repIndex: number, side: string, start: number, classification = "complete") =>
      ({ setIndex: 1, repIndex, side, startTs: iso(start), endTs: iso(start + 1500), classification });
    const part = { startWallMs: t0 - 2000 }; // recording began 2 s before the set
    const timeline = buildVideoTimeline(part, 20_000, {
      sets: [{ setIndex: 1, startTs: iso(0), endTs: iso(5000), holdQuality: { version: "coaching_set_v1", coaching: audit } }],
      reps: [rep(2, "left", 2500), rep(1, "left", 500), rep(3, "right", 600, "partial"), rep(9, "left", 40_000)],
    });
    assert.deepEqual(timeline.sets, [{ setIndex: 1, startMs: 2000, endMs: 7000 }]);
    assert.deepEqual(timeline.reps.map((r) => [r.side, r.number, r.startMs, r.complete]), [
      ["left", 1, 2500, true], ["right", 1, 2600, false], ["left", 2, 4500, true],
    ], "numbered per side in time order; a repetition after the part is left out");
    assert.deepEqual(timeline.cues.map((c) => [c.label, c.text, c.startMs, c.endMs]), [["Trunk lean", "STRAIGHTEN", 3000, 3500]],
      "the cue sits where the coaching record's clock puts it");
    assert.equal(formatVideoTime(65_400), "1:05");
  });

  await test("a repetition worth checking gets a marker: poor tracking, or twice or half its side's typical time", async () => {
    const t0 = Date.parse("2026-09-26T03:00:00.000Z");
    const iso = (ms: number) => new Date(t0 + ms).toISOString();
    const tracking = (unsteadyFrames: number) => ({
      tracking: { version: 1, check: "tracking_steadiness_v1", frames: 30, rejectedFrames: 0, checkedFrames: 30, unsteadyFrames },
    });
    const rep = (repIndex: number, totalMs: number, unsteady = 0) =>
      ({ setIndex: 1, repIndex, side: "left", classification: "complete", startTs: iso(repIndex * 10_000), endTs: iso(repIndex * 10_000 + totalMs),
        totalMs, compensations: tracking(unsteady) });
    // Repetition 1 is the set's first (its slow timing is expected); 4 took about 2.9 times the typical 1050 ms; 6 was tracked poorly.
    const reps = [rep(1, 9000), rep(2, 1000), rep(3, 1100), rep(4, 3000), rep(5, 1000), rep(6, 1000, 20)];
    const checks = repChecks(reps);
    assert.deepEqual([...checks.keys()].sort(), [4, 6], "only the long and the poorly tracked repetition");
    assert.equal(checks.get(4), "it took 2.9× as long as this side's typical repetition");
    assert.equal(checks.get(6), "the camera tracked this repetition poorly, so it counts in no trend");
    const timeline = buildVideoTimeline({ startWallMs: t0 }, 70_000, { sets: [], reps });
    assert.deepEqual(timeline.reps.map((r) => r.check !== null), [false, false, false, true, false, true], "carried onto the video's repetitions");
    assert.equal(REP_CHECK_RATIO, 2);
    // Without durations or tracking records (older details), nothing is marked.
    const older = reps.map((r) => ({ setIndex: r.setIndex, repIndex: r.repIndex, side: r.side, classification: r.classification }));
    assert.equal(repChecks(older).size, 0);
  });

  await test("the recorder uploads chunks in order, retries, and closes the part", async () => {
    const calls: Array<{ url: string; method: string; body: any }> = [];
    let failNextPut = 1;
    const fetchImpl = (async (url: string, init: any) => {
      calls.push({ url, method: init.method, body: init.body });
      if (init.method === "PUT" && failNextPut > 0) { failNextPut -= 1; throw new Error("network"); }
      if (init.method === "POST" && JSON.parse(init.body).action === "start") return new Response(JSON.stringify({ part: 2 }));
      return new Response("{}");
    }) as typeof fetch;
    class FakeRecorder {
      static made: FakeRecorder[] = [];
      state = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public stream: unknown, public options: { mimeType: string }) { FakeRecorder.made.push(this); }
      static isTypeSupported = (type: string) => type === "video/webm;codecs=vp9";
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["last"]) });
        this.onstop?.();
      }
    }
    const states: string[] = [];
    let now = 1_000;
    const recorder = new SessionRecorder({
      sessionId: 7, stream: {} as MediaStream, nowWallMs: () => now, onState: (s) => states.push(s),
      fetchImpl, Recorder: FakeRecorder as any, retryDelaysMs: [1, 1, 1],
    });
    assert.equal(await recorder.start(), true);
    const instance = FakeRecorder.made[0];
    assert.equal(instance.options.mimeType, "video/webm;codecs=vp9", "the first supported type");
    instance.ondataavailable?.({ data: new Blob(["a"]) });
    instance.ondataavailable?.({ data: new Blob(["b"]) });
    now = 9_000;
    await recorder.stop();
    await recorder.stop();
    const puts = calls.filter((c) => c.method === "PUT").map((c) => c.url);
    assert.deepEqual(puts, [
      "/api/sessions/7/recording/2?seq=1", "/api/sessions/7/recording/2?seq=1",
      "/api/sessions/7/recording/2?seq=2", "/api/sessions/7/recording/2?seq=3",
    ], "seq 1 retried after a network error, then 2 and the final chunk");
    const posts = calls.filter((c) => c.method === "POST").map((c) => JSON.parse(c.body));
    assert.deepEqual(posts, [
      { action: "start", mimeType: "video/webm;codecs=vp9", startWallMs: 1_000 },
      { action: "finish", part: 2, endWallMs: 9_000, complete: true, overlayComplete: true },
    ]);
    assert.deepEqual(states, ["recording", "stopped"]);
  });

  await test("the recorder gives up on a refused chunk and reports unsupported browsers", async () => {
    const states: string[] = [];
    class Recorder {
      state = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      static isTypeSupported = () => true;
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.onstop?.(); }
    }
    let finish: any = null;
    const refusing = new SessionRecorder({
      sessionId: 7, stream: {} as MediaStream, nowWallMs: () => 5, onState: (s) => states.push(s), retryDelaysMs: [1],
      Recorder: Recorder as any,
      fetchImpl: (async (_url: string, init: any) => {
        if (init.method === "PUT") return new Response("{}", { status: 403 });
        const body = JSON.parse(init.body);
        if (body.action === "finish") finish = body;
        return new Response(JSON.stringify({ part: 1 }));
      }) as typeof fetch,
    });
    assert.equal(await refusing.start(), true);
    (refusing as any).recorder.ondataavailable({ data: new Blob(["x"]) });
    await refusing.stop();
    assert.equal(finish.complete, false, "the part is closed as incomplete");
    assert(states.includes("failed"));
    assert.equal(pickRecordingMimeType(() => false), null);
    const unsupported: string[] = [];
    const none = new SessionRecorder({ sessionId: 7, stream: {} as MediaStream, nowWallMs: () => 0, onState: (s) => unsupported.push(s),
      Recorder: { isTypeSupported: () => false } as any });
    assert.equal(await none.start(), false);
    assert.deepEqual(unsupported, ["unsupported"]);
  });

  await test("Stop during a slow start waits for the part, closes it, and never reports recording", async () => {
    for (const finalChunk of [true, false]) {
      let resolveStart: (response: Response) => void = () => {};
      const startReply = new Promise<Response>((resolve) => { resolveStart = resolve; });
      const requests: string[] = [];
      const states: string[] = [];
      class SlowRecorder {
        state = "inactive";
        ondataavailable: ((e: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: (() => void) | null = null;
        static isTypeSupported = () => true;
        start() { this.state = "recording"; }
        stop() {
          this.state = "inactive";
          if (finalChunk) this.ondataavailable?.({ data: new Blob(["first seconds"]) });
          this.onstop?.();
        }
      }
      const recorder = new SessionRecorder({
        sessionId: 77, stream: {} as MediaStream, nowWallMs: () => 1_000, onState: (s) => states.push(s),
        Recorder: SlowRecorder as any, retryDelaysMs: [1],
        fetchImpl: (async (url: string, init: any) => {
          if (init.method === "PUT") { requests.push(`put ${url.split("?")[1]}`); return new Response("{}"); }
          const action = JSON.parse(init.body).action;
          requests.push(action);
          return action === "start" ? startReply : new Response("{}");
        }) as typeof fetch,
      });
      const started = recorder.start();
      const stopped = recorder.stop(); // End while the start request is still pending
      resolveStart(new Response(JSON.stringify({ part: 1 })));
      assert.equal(await started, false, "a start overtaken by Stop does not report recording");
      await stopped;
      assert.deepEqual(requests, finalChunk ? ["start", "put seq=1", "finish"] : ["start", "finish"],
        "the part that opened is uploaded to and closed");
      assert.deepEqual(states, ["stopped"], "no recording state after Stop");
    }
  });

  await test("a start the server never answers is abandoned, and a part opening later is still closed", async () => {
    let resolveStart: (response: Response) => void = () => {};
    const startReply = new Promise<Response>((resolve) => { resolveStart = resolve; });
    const finishes: any[] = [];
    const states: string[] = [];
    class Recorder {
      state = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      static isTypeSupported = () => true;
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.onstop?.(); }
    }
    const recorder = new SessionRecorder({
      sessionId: 77, stream: {} as MediaStream, nowWallMs: () => 1_000, onState: (s) => states.push(s),
      Recorder: Recorder as any, retryDelaysMs: [1], waitMs: 20,
      fetchImpl: (async (_url: string, init: any) => {
        const body = JSON.parse(init.body);
        if (body.action === "start") return startReply;
        finishes.push(body);
        return new Response("{}");
      }) as typeof fetch,
    });
    const started = recorder.start();
    await recorder.stop(); // gives up after 20 ms
    assert.equal(states.at(-1), "failed", "nothing was recorded, so the recording failed");
    resolveStart(new Response(JSON.stringify({ part: 3 })));
    assert.equal(await started, false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(finishes, [{ action: "finish", part: 3, endWallMs: 1_000, complete: false, overlayComplete: false }],
      "the late part is closed as incomplete");
    assert(!states.includes("recording"), "never reports recording after Stop");
  });

  await test("Resume anchors the page clock before the resumed part starts recording", () => {
    // After a reload the clock anchors are 0 until Resume sets them, and the
    // recorder reads the time through perfToIso. Starting it first stored the
    // resumed part's start as milliseconds since page load (live check,
    // 2026-10-02: startWallMs 20134), so playback could not place that part.
    const resume = cameraDeclarations(["resumeSession"]);
    const anchor = resume.indexOf("sessionWallStartMsRef.current = Date.now()");
    const record = resume.indexOf("startSessionRecording(snap.sessionId)");
    assert(anchor >= 0 && record >= 0, "both steps are present in resumeSession");
    assert(anchor < record, "the wall-clock anchor is set before the recorder starts");
    assert(resume.indexOf("sessionPerfStartMsRef.current = performance.now()") < record,
      "the performance-clock anchor is set before the recorder starts");
  });

  await test("the recorder sends the overlay track with each video chunk and at the end", async () => {
    const puts: Array<{ url: string; body: any }> = [];
    let finish: any = null;
    let overlayStatus = 200;
    class Recorder {
      static made: Recorder[] = [];
      state = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      static isTypeSupported = () => true;
      constructor() { Recorder.made.push(this); }
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["tail"]) }); this.onstop?.(); }
    }
    let now = 1_000;
    const states: string[] = [];
    const recorder = new SessionRecorder({
      sessionId: 7, stream: {} as MediaStream, nowWallMs: () => now, onState: (s) => states.push(s),
      Recorder: Recorder as any, retryDelaysMs: [1],
      fetchImpl: (async (url: string, init: any) => {
        if (init.method === "PUT") {
          puts.push({ url, body: init.body });
          return new Response("{}", { status: url.includes("track=overlay") ? overlayStatus : 200 });
        }
        const body = JSON.parse(init.body);
        if (body.action === "finish") finish = body;
        return new Response(JSON.stringify({ part: 4 }));
      }) as typeof fetch,
    });
    await recorder.start();
    now = 1_250;
    recorder.addOverlayFrame(standing());
    now = 1_320;
    const cued = recorder.addOverlayFrame(standing())!;
    cued.cue = { metric: "trunkLean", direction: "left" };
    Recorder.made[0].ondataavailable?.({ data: new Blob(["video"]) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    now = 1_400;
    recorder.addOverlayFrame(standing());
    await recorder.stop();
    assert.deepEqual(puts.map((p) => p.url.replace("/api/sessions/7/recording/4?", "")), [
      "seq=1", "seq=1&track=overlay&through=320", "seq=2", "seq=2&track=overlay&through=400",
    ], "each video chunk is followed by the overlay kept since the last one, with how far it reaches");
    const first = parseOverlayTrack(puts[1].body);
    assert.deepEqual(first.map((f) => [f.t, f.cue?.metric ?? null]), [[250, null], [320, "trunkLean"]],
      "frames carry their time from the part start and the cue drawn on them");
    assert.equal(parseOverlayTrack(puts[3].body).length, 1);
    assert.deepEqual([finish?.complete, finish?.overlayComplete], [true, true]);
    assert.equal(recorder.addOverlayFrame(standing()), null, "nothing is kept after Stop");

    // A refused overlay upload drops the overlays but not the video.
    overlayStatus = 403;
    puts.length = 0;
    Recorder.made.length = 0;
    const second = new SessionRecorder({
      sessionId: 7, stream: {} as MediaStream, nowWallMs: () => now, onState: (s) => states.push(s),
      Recorder: Recorder as any, retryDelaysMs: [1],
      fetchImpl: (async (url: string, init: any) => {
        if (init.method === "PUT") {
          puts.push({ url, body: init.body });
          return new Response("{}", { status: url.includes("track=overlay") ? overlayStatus : 200 });
        }
        const body = JSON.parse(init.body);
        if (body.action === "finish") finish = body;
        return new Response(JSON.stringify({ part: 5 }));
      }) as typeof fetch,
    });
    await second.start();
    second.addOverlayFrame(standing());
    Recorder.made[0].ondataavailable?.({ data: new Blob(["video"]) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(second.addOverlayFrame(standing()), null, "overlays stop after a refused upload");
    await second.stop();
    assert.deepEqual(puts.map((p) => p.url.includes("track=overlay")), [false, true, false], "the video goes on");
    assert.equal(states.at(-1), "stopped", "the recording itself succeeded");
    assert.deepEqual([finish.complete, finish.overlayComplete], [true, false], "the close records the lost overlay");
  });

  await test("a stalled overlay upload never holds back the video, and is abandoned after the time limit", async () => {
    const requests: string[] = [];
    const signals: AbortSignal[] = [];
    let finish: any = null;
    const states: string[] = [];
    class Recorder {
      static made: Recorder[] = [];
      state = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      static isTypeSupported = () => true;
      constructor() { Recorder.made.push(this); }
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["third"]) }); this.onstop?.(); }
    }
    const recorder = new SessionRecorder({
      sessionId: 8, stream: {} as MediaStream, nowWallMs: () => 1_000, onState: (s) => states.push(s),
      Recorder: Recorder as any, retryDelaysMs: [1], waitMs: 1_000, requestTimeoutMs: 60,
      fetchImpl: ((url: string, init: any) => {
        if (init.method === "PUT") {
          requests.push(url.includes("track=overlay") ? "overlay" : `video ${url.split("seq=")[1]}`);
          // Every overlay request hangs; the recorder must not wait for it.
          if (url.includes("track=overlay")) { signals.push(init.signal); return new Promise<Response>(() => {}); }
          return Promise.resolve(new Response("{}"));
        }
        const body = JSON.parse(init.body);
        if (body.action === "finish") finish = body;
        return Promise.resolve(new Response(JSON.stringify({ part: 1 })));
      }) as typeof fetch,
    });
    await recorder.start();
    recorder.addOverlayFrame(standing());
    Recorder.made[0].ondataavailable?.({ data: new Blob(["first"]) });
    Recorder.made[0].ondataavailable?.({ data: new Blob(["second"]) });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(requests, ["video 1", "overlay", "video 2"], "the second chunk goes up while the overlay hangs");
    await recorder.stop();
    assert.deepEqual(requests, ["video 1", "overlay", "video 2", "video 3", "overlay"], "all three chunks, and one retry of the overlay");
    assert(signals.every((signal) => signal.aborted), "each unanswered request was aborted");
    assert.deepEqual([finish.complete, finish.overlayComplete], [true, false], "a whole video, with the overlay loss recorded");
    assert.deepEqual(states, ["recording", "stopped"]);
  });

  await test("a failed finish is reported, and a transient one is retried", async () => {
    for (const [finishReplies, expected] of [[[500, 500, 500], "failed"], [[503, 200], "stopped"]] as const) {
      const replies = [...finishReplies];
      const states: string[] = [];
      class Recorder {
        state = "inactive";
        ondataavailable: ((e: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: (() => void) | null = null;
        static isTypeSupported = () => true;
        start() { this.state = "recording"; }
        stop() { this.state = "inactive"; this.onstop?.(); }
      }
      const recorder = new SessionRecorder({
        sessionId: 77, stream: {} as MediaStream, nowWallMs: () => 1_000, onState: (s) => states.push(s),
        Recorder: Recorder as any, retryDelaysMs: [1, 1],
        fetchImpl: (async (_url: string, init: any) => {
          if (JSON.parse(init.body).action === "start") return new Response(JSON.stringify({ part: 1 }));
          return new Response("{}", { status: replies.shift() ?? 500 });
        }) as typeof fetch,
      });
      await recorder.start();
      await recorder.stop();
      assert.equal(states.at(-1), expected, `finish replies ${finishReplies.join(",")}`);
    }
  });

  await test("the API routes enforce consent and ownership and serve byte ranges", async () => {
    let access: any = { ok: true, sessionId: 50, role: "owner", ended: false, videoConsent: true };
    const load = (file: string) => {
      const context: any = vm.createContext({
        exports: {}, console, Response, Headers, URL,
        require: (name: string) => {
          if (name === "next/server") return { NextResponse: { json: (body: any, init?: any) => new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: init?.headers }) } };
          if (name === "@/lib/auth-server") return { getAuthenticatedUser: async () => ({ id: "fixture", role: "patient" }) };
          if (name === "@/lib/recording/access") return { recordingAccess: async () => access };
          if (name === "@/lib/recording/storage") return storage;
          if (name === "@/lib/recording/http") return { parseRange };
          if (name === "node:stream") return stream;
          throw new Error(`Unexpected route import ${name}`);
        },
      });
      vm.runInContext(transpile(readFileSync(new URL(`../../app/api/sessions/[id]/recording/${file}`, import.meta.url), "utf8")), context);
      return context.exports;
    };
    const list = load("route.ts");
    const file = load("[part]/route.ts");
    const params = (part?: number) => ({ params: Promise.resolve({ id: "50", part: String(part ?? 1) }) });
    const request = (init: { body?: any; bytes?: Uint8Array; url?: string; range?: string } = {}) => ({
      json: async () => init.body,
      arrayBuffer: async () => (init.bytes ?? new Uint8Array()).buffer,
      nextUrl: new URL(init.url ?? "http://localhost/api/sessions/50/recording/1"),
      headers: new Headers(init.range ? { range: init.range } : {}),
    });

    const start = await list.POST(request({ body: { action: "start", mimeType: "video/webm", startWallMs: 1_000 } }), params());
    assert.equal(start.status, 200);
    assert.deepEqual(await start.json(), { part: 1 });
    for (const [seq, chunk] of [[1, bytes(10, 11, 12)], [2, bytes(13, 14)]] as const) {
      const put = await file.PUT(request({ bytes: chunk, url: `http://localhost/x?seq=${seq}` }), params(1));
      assert.equal(put.status, 200);
    }
    assert.equal((await file.PUT(request({ bytes: bytes(1), url: "http://localhost/x?seq=5" }), params(1))).status, 409, "gap");
    const overlayLine = '{"t":0,"lm":[0.5,0.5]}\n';
    assert.equal((await file.PUT(request({ bytes: text(overlayLine), url: "http://localhost/x?seq=1&track=overlay&through=-5" }), params(1))).status, 400,
      "a coverage time must be a whole, positive number");
    assert.equal((await file.PUT(request({ bytes: text(overlayLine), url: "http://localhost/x?seq=1&track=overlay&through=3000" }), params(1))).status, 200);
    assert.equal((await list.POST(request({ body: { action: "finish", part: 1, endWallMs: 4_000, complete: true, overlayComplete: "yes" } }), params())).status, 400);
    assert.equal((await list.POST(request({ body: { action: "finish", part: 1, endWallMs: 4_000, complete: true, overlayComplete: true } }), params())).status, 200);

    access = { ...access, role: "therapist" };
    const listing = await list.GET(request(), params());
    assert.deepEqual(await listing.json(), {
      parts: [{
        index: 1, mimeType: "video/webm", startWallMs: 1_000, endWallMs: 4_000, bytes: 5, status: "complete",
        hasOverlay: true, overlay: "complete", overlayThroughMs: 3_000,
      }],
      canDelete: false,
    });
    const overlay = await file.GET(request({ url: "http://localhost/x?track=overlay" }), params(1));
    assert.equal(overlay.headers.get("content-type"), "application/x-ndjson");
    assert.equal(await overlay.text(), overlayLine, "the therapist can load the overlay track");
    const ranged = await file.GET(request({ range: "bytes=1-3" }), params(1));
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("content-range"), "bytes 1-3/5");
    assert.deepEqual([...new Uint8Array(await ranged.arrayBuffer())], [11, 12, 13]);
    const whole = await file.GET(request(), params(1));
    assert.equal(whole.status, 200);
    assert.deepEqual([...new Uint8Array(await whole.arrayBuffer())], [10, 11, 12, 13, 14]);
    assert.equal((await file.GET(request({ range: "bytes=9-" }), params(1))).status, 416);
    assert.equal((await file.PUT(request({ bytes: bytes(1), url: "http://localhost/x?seq=3" }), params(1))).status, 403, "a therapist cannot upload");
    assert.equal((await list.DELETE(request(), params())).status, 403, "a therapist cannot delete");

    access = { ok: true, sessionId: 50, role: "owner", ended: false, videoConsent: false };
    assert.equal((await list.POST(request({ body: { action: "start", mimeType: "video/webm", startWallMs: 1 } }), params())).status, 403, "no consent, no recording");
    access = { ok: true, sessionId: 50, role: "owner", ended: true, videoConsent: true };
    assert.equal((await list.POST(request({ body: { action: "start", mimeType: "video/webm", startWallMs: 1 } }), params())).status, 409, "no new part after the session ended");
    access = { ok: false, status: 403, error: "Forbidden" };
    assert.equal((await file.GET(request(), params(1))).status, 403, "outsiders are refused");
    access = { ok: true, sessionId: 50, role: "owner", ended: true, videoConsent: true };
    assert.equal((await list.DELETE(request(), params())).status, 200);
    assert.deepEqual(await (await list.GET(request(), params())).json(), { parts: [], canDelete: true }, "deleted");

    // A part the browser never closed reads as incomplete once the session has ended.
    access = { ok: true, sessionId: 50, role: "owner", ended: false, videoConsent: true };
    await list.POST(request({ body: { action: "start", mimeType: "video/webm", startWallMs: 1_000 } }), params());
    await file.PUT(request({ bytes: bytes(1, 2), url: "http://localhost/x?seq=1" }), params(1));
    assert.equal((await (await list.GET(request(), params())).json()).parts[0].status, "recording", "still open mid-session");
    access = { ...access, ended: true };
    assert.equal((await (await list.GET(request(), params())).json()).parts[0].status, "incomplete", "open after the end");
  });

  await test("only the owning patient and their assigned therapist get access", async () => {
    const context: any = vm.createContext({
      exports: {},
      require: (name: string) => {
        if (name === "@/lib/db") {
          return {
            getSessionRecordingState: async (id: number) => (id === 60 ? { patientId: "p1", ended: false, videoConsent: true } : null),
            getUsers: async ({ therapistId }: { therapistId: string }) => (therapistId === "t1" ? [{ id: "p1" }] : [{ id: "p2" }]),
          };
        }
        throw new Error(`Unexpected access import ${name}`);
      },
    });
    vm.runInContext(transpile(readFileSync(new URL("./access.ts", import.meta.url), "utf8")), context);
    const check = async (user: any, id = "60") => {
      const result = await context.exports.recordingAccess(user, id);
      return result.ok ? result.role : result.status;
    };
    assert.equal(await check(null), 401, "signed out");
    assert.equal(await check({ id: "p1", role: "patient" }, "abc"), 400);
    assert.equal(await check({ id: "p1", role: "patient" }, "61"), 404);
    assert.equal(await check({ id: "p1", role: "patient" }), "owner");
    assert.equal(await check({ id: "p2", role: "patient" }), 403, "another patient");
    assert.equal(await check({ id: "t1", role: "therapist" }), "therapist", "the assigned therapist");
    assert.equal(await check({ id: "t2", role: "therapist" }), 403, "another therapist");
    assert.equal(await check({ id: "a1", role: "admin" }), 403, "admins are not in the pair");
  });

  rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

void run();
