/**
 * Custom exercise videos: the accepted file types, YouTube embed parsing, and
 * the disk storage's size and format checks, run against a temporary folder.
 *
 *   npx tsx src/lib/exercises/customVideo.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MAX_EXERCISE_VIDEO_BYTES,
  exerciseVideoFromRow,
  exerciseVideoMimeType,
  hasExerciseVideoSignature,
  parseYouTubeVideoId,
} from "./customVideo";

const tests: { name: string; run: () => void | Promise<void> }[] = [];
const test = (name: string, run: () => void | Promise<void>) => tests.push({ name, run });

const MP4_HEAD = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const WEBM_HEAD = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]);

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

test("only MP4 and WebM files are accepted", () => {
  assert.equal(exerciseVideoMimeType({ name: "a.mp4", type: "video/mp4" }), "video/mp4");
  assert.equal(exerciseVideoMimeType({ name: "a.WEBM", type: "" }), "video/webm");
  assert.equal(exerciseVideoMimeType({ name: "a.mov", type: "video/quicktime" }), null);
  assert.equal(exerciseVideoMimeType({ name: "a.mp4", type: "video/webm" }), null);
  assert.equal(exerciseVideoMimeType({ name: "a.avi", type: "" }), null);
});

test("file signatures are checked", () => {
  assert(hasExerciseVideoSignature(MP4_HEAD, "video/mp4"));
  assert(hasExerciseVideoSignature(WEBM_HEAD, "video/webm"));
  assert(!hasExerciseVideoSignature(WEBM_HEAD, "video/mp4"));
  assert(!hasExerciseVideoSignature(new TextEncoder().encode("<html>"), "video/webm"));
});

test("YouTube ids come from embed code, links or bare ids", () => {
  const id = "dQw4w9WgXcQ";
  assert.equal(
    parseYouTubeVideoId(`<iframe width="560" height="315" src="https://www.youtube.com/embed/${id}?si=abc" title="YouTube video player" allowfullscreen></iframe>`),
    id,
  );
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${id}&t=10s`), id);
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/watch?feature=share&amp;v=${id}`), id);
  assert.equal(parseYouTubeVideoId(`https://youtu.be/${id}`), id);
  assert.equal(parseYouTubeVideoId(`https://www.youtube.com/shorts/${id}`), id);
  assert.equal(parseYouTubeVideoId(` ${id} `), id);
  assert.equal(parseYouTubeVideoId(`<iframe src="https://evil.example/embed/${id}"></iframe>`), null);
  assert.equal(parseYouTubeVideoId("https://www.youtube.com/embed/tooshort"), null);
  assert.equal(parseYouTubeVideoId(""), null);
});

test("a row's video prefers a valid uploaded file, then a YouTube id", () => {
  assert.deepEqual(exerciseVideoFromRow({ video_mime_type: "video/webm" }), { kind: "file", mimeType: "video/webm" });
  assert.deepEqual(exerciseVideoFromRow({ youtube_video_id: "dQw4w9WgXcQ" }), { kind: "youtube", youtubeId: "dQw4w9WgXcQ" });
  assert.equal(exerciseVideoFromRow({ video_mime_type: "video/avi", youtube_video_id: "bad" }), null);
  assert.equal(exerciseVideoFromRow({}), null);
});

test("storage saves, replaces, refuses and deletes videos", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "exercise-videos-"));
  process.env.EXERCISE_VIDEOS_DIR = root;
  try {
    const storage = await import("./customVideoStorage");
    const first = await storage.saveExerciseVideo("ex_101", "video/mp4", streamOf(MP4_HEAD, new Uint8Array(100)));
    assert.notEqual(typeof first, "string");
    if (typeof first === "string") throw new Error(first);
    const opened = await storage.openExerciseVideo("ex_101", "video/mp4", first.fileName);
    assert.equal(opened?.size, MP4_HEAD.length + 100);

    // A refused upload leaves the stored video alone.
    assert.equal(await storage.saveExerciseVideo("ex_101", "video/mp4", streamOf(WEBM_HEAD)), "bad-signature");
    assert.equal(await storage.saveExerciseVideo("ex_101", "video/mp4", streamOf()), "empty");
    const big = new Uint8Array(MAX_EXERCISE_VIDEO_BYTES);
    big.set(MP4_HEAD);
    assert.equal(await storage.saveExerciseVideo("ex_101", "video/mp4", streamOf(big, new Uint8Array(1))), "too-large");
    assert.equal((await storage.openExerciseVideo("ex_101", "video/mp4", first.fileName))?.size, MP4_HEAD.length + 100);

    // Replacing with the other type, then dropping the old file.
    const second = await storage.saveExerciseVideo("ex_101", "video/webm", streamOf(WEBM_HEAD));
    if (typeof second === "string") throw new Error(second);
    assert.notEqual(first.fileName, second.fileName);
    await storage.deleteExerciseVideoFile("ex_101", "video/mp4", first.fileName);
    assert.equal(await storage.openExerciseVideo("ex_101", "video/mp4", first.fileName), null);
    assert(existsSync(path.join(root, second.fileName)));

    await storage.deleteExerciseVideoFile("ex_101", "video/webm", second.fileName);
    assert.equal(await storage.openExerciseVideo("ex_101", "video/webm", second.fileName), null);
    await assert.rejects(() => storage.saveExerciseVideo("../x", "video/mp4", streamOf(MP4_HEAD)));
    await assert.rejects(() => storage.openExerciseVideo("ex_101", "video/mp4", "../secret.mp4"));
    await assert.rejects(() => storage.openExerciseVideo("ex_102", "video/webm", second.fileName));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

(async () => {
  console.log("customVideo - custom exercise videos\n");
  let failed = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed++;
      console.log(`  ✗ ${name}\n      ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
