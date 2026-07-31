/**
 * Regression tests for durable outcome-event delivery.
 *
 * The defect these lock down: the previous flushers cleared their buffer before
 * issuing the request, never retried, and — because `fetch` resolves for 4xx/5xx
 * — treated a rejected batch as a success with no output at all.
 *
 * Run with: npx tsx src/lib/pose/eventOutbox.test.ts
 */

import {
  EventOutbox,
  outboxStorageKey,
  type OutboxFetch,
  type OutboxResponse,
  type OutboxStorage,
} from "./eventOutbox";

let passed = 0;
let failed = 0;

const tests: Array<{ name: string; fn: () => Promise<void> | void }> = [];

function test(name: string, fn: () => Promise<void> | void): void {
  tests.push({ name, fn });
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
}

type Rep = { repIndex: number; setIndex: number };
type Set_ = { setIndex: number };

const rep = (repIndex: number): Rep => ({ repIndex, setIndex: 1 });

/** Records every request so tests can assert exactly what was sent. */
function recordingFetch(
  responder: (call: number) => OutboxResponse | Error,
): { fetchFn: OutboxFetch; bodies: unknown[]; calls: () => number } {
  const bodies: unknown[] = [];
  let call = 0;
  const fetchFn: OutboxFetch = async (_url, init) => {
    call += 1;
    bodies.push(JSON.parse(init.body));
    const result = responder(call);
    if (result instanceof Error) throw result;
    return result;
  };
  return { fetchFn, bodies, calls: () => call };
}

const ok: OutboxResponse = { ok: true, status: 200 };

function memoryStorage(): OutboxStorage & { dump: () => Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    dump: () => Object.fromEntries(map),
  };
}

/** Runs scheduled callbacks immediately so tests need no real timers. */
const immediateSchedule = (fn: () => void) => {
  fn();
};

function makeOutbox(
  fetchFn: OutboxFetch,
  storage: OutboxStorage | null = null,
): EventOutbox<Rep, Set_> {
  return new EventOutbox<Rep, Set_>({
    fetchFn,
    storage,
    schedule: immediateSchedule,
    baseRetryDelayMs: 0,
    maxRetryDelayMs: 0,
  });
}

// ── delivery ────────────────────────────────────────────────────────────────

test("an OK response removes the delivered items", async () => {
  const { fetchFn, bodies } = recordingFetch(() => ok);
  const outbox = makeOutbox(fetchFn);
  outbox.setSession(1);
  outbox.enqueue("rep", rep(1));
  outbox.enqueue("rep", rep(2));

  assertEqual(await outbox.flush("rep"), "delivered", "flush outcome");
  assertEqual(outbox.pendingCount("rep"), 0, "pending after delivery");
  assertEqual((bodies[0] as { reps: Rep[] }).reps.length, 2, "batch size sent");
});

test("nothing is sent when the queue is empty or no session is bound", async () => {
  const { fetchFn, calls } = recordingFetch(() => ok);
  const outbox = makeOutbox(fetchFn);

  assertEqual(await outbox.flush("rep"), "idle", "no session bound");
  outbox.setSession(1);
  assertEqual(await outbox.flush("rep"), "idle", "empty queue");
  assertEqual(calls(), 0, "request count");
});

// ── the three original failure modes ────────────────────────────────────────

test("a 400 response retains the items instead of silently dropping them", async () => {
  // `fetch` resolves for 4xx — the old code's `.catch` never ran and the reps
  // were already gone from the buffer.
  const { fetchFn } = recordingFetch(() => ({ ok: false, status: 400 }));
  const outbox = makeOutbox(fetchFn);
  outbox.setSession(1);
  outbox.enqueue("rep", rep(1));

  assertEqual(await outbox.flush("rep"), "failed", "flush outcome");
  assertEqual(outbox.pendingCount("rep"), 1, "item retained after 400");
  assert(
    (outbox.lastError("rep") ?? "").includes("400"),
    "error message records the status",
  );
});

test("a 500 response retains the items", async () => {
  const { fetchFn } = recordingFetch(() => ({ ok: false, status: 500 }));
  const outbox = makeOutbox(fetchFn);
  outbox.setSession(1);
  outbox.enqueue("set", { setIndex: 1 });

  assertEqual(await outbox.flush("set"), "failed", "flush outcome");
  assertEqual(outbox.pendingCount("set"), 1, "item retained after 500");
});

test("a network rejection retains the items", async () => {
  const { fetchFn } = recordingFetch(() => new Error("offline"));
  const outbox = makeOutbox(fetchFn);
  outbox.setSession(1);
  outbox.enqueue("rep", rep(1));

  assertEqual(await outbox.flush("rep"), "failed", "flush outcome");
  assertEqual(outbox.pendingCount("rep"), 1, "item retained after rejection");
});

test("a failed batch is delivered by a later attempt", async () => {
  const { fetchFn, calls } = recordingFetch((call) =>
    call === 1 ? { ok: false, status: 503 } : ok,
  );
  const outbox = makeOutbox(fetchFn);
  outbox.setSession(1);
  outbox.enqueue("rep", rep(1));

  const result = await outbox.drain({ timeoutMs: 100, pollDelayMs: 0 });
  assertEqual(result.drained, true, "drained after retry");
  assertEqual(outbox.pendingCount("rep"), 0, "delivered");
  assert(calls() >= 2, "retried after the failure");
});

// ── concurrency ─────────────────────────────────────────────────────────────

test("items appended mid-flight are neither lost nor double-sent", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const bodies: unknown[] = [];
  const fetchFn: OutboxFetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    await gate;
    return ok;
  };

  const outbox = makeOutbox(fetchFn);
  outbox.setSession(1);
  outbox.enqueue("rep", rep(1));

  const inFlight = outbox.flush("rep");
  // Arrives while the first request is still open.
  outbox.enqueue("rep", rep(2));
  release();
  await inFlight;

  assertEqual(outbox.pendingCount("rep"), 1, "only the new item remains");
  await outbox.flush("rep");
  assertEqual(outbox.pendingCount("rep"), 0, "second pass delivers it");

  const sent = bodies.flatMap((b) => (b as { reps: Rep[] }).reps.map((r) => r.repIndex));
  assertEqual(sent.join(","), "1,2", "each rep sent exactly once");
});

test("a concurrent flush joins the in-flight attempt rather than double-sending", async () => {
  const { fetchFn, calls } = recordingFetch(() => ok);
  const outbox = makeOutbox(fetchFn);
  outbox.setSession(1);
  outbox.enqueue("rep", rep(1));

  await Promise.all([outbox.flush("rep"), outbox.flush("rep")]);
  assertEqual(calls(), 1, "request count");
});

test("an acknowledged repIndex is never queued again", async () => {
  const { fetchFn } = recordingFetch(() => ok);
  const outbox = makeOutbox(fetchFn);
  outbox.setSession(1);
  outbox.enqueue("rep", rep(1));
  await outbox.flush("rep");

  outbox.enqueue("rep", rep(1));
  assertEqual(outbox.pendingCount("rep"), 0, "duplicate rejected");
});

// ── drain ───────────────────────────────────────────────────────────────────

test("drain reports success once the queue empties", async () => {
  const { fetchFn } = recordingFetch(() => ok);
  const outbox = makeOutbox(fetchFn);
  outbox.setSession(1);
  outbox.enqueue("rep", rep(1));
  outbox.enqueue("set", { setIndex: 1 });

  const result = await outbox.drain({ timeoutMs: 50, pollDelayMs: 0 });
  assertEqual(result.drained, true, "drained");
  assertEqual(result.remaining, 0, "remaining");
});

test("drain reports what is still pending when delivery keeps failing", async () => {
  const { fetchFn } = recordingFetch(() => ({ ok: false, status: 500 }));
  const outbox = makeOutbox(fetchFn);
  outbox.setSession(1);
  outbox.enqueue("rep", rep(1));
  outbox.enqueue("rep", rep(2));

  const result = await outbox.drain({ timeoutMs: 0, pollDelayMs: 0 });
  assertEqual(result.drained, false, "not drained");
  assertEqual(result.remaining, 2, "remaining count reported honestly");
});

// ── durability ──────────────────────────────────────────────────────────────

test("pending items survive a reload via storage", async () => {
  const storage = memoryStorage();
  const { fetchFn } = recordingFetch(() => ({ ok: false, status: 500 }));
  const first = makeOutbox(fetchFn, storage);
  first.setSession(7);
  first.enqueue("rep", rep(1));
  first.enqueue("set", { setIndex: 3 });
  await first.flush("rep");

  const { fetchFn: okFetch } = recordingFetch(() => ok);
  const second = makeOutbox(okFetch, storage);
  const restored = second.restoreFor(7);

  assertEqual(restored, 2, "restored item count");
  assertEqual(second.pendingCount(), 2, "pending after restore");
  await second.drain({ timeoutMs: 50, pollDelayMs: 0 });
  assertEqual(second.pendingCount(), 0, "delivered after restore");
});

test("delivered state leaves no storage residue", async () => {
  const storage = memoryStorage();
  const { fetchFn } = recordingFetch(() => ok);
  const outbox = makeOutbox(fetchFn, storage);
  outbox.setSession(9);
  outbox.enqueue("rep", rep(1));
  await outbox.flush("rep");

  assertEqual(
    storage.getItem(outboxStorageKey(9)),
    null,
    "storage key removed once empty",
  );
});

test("a snapshot belonging to another session is ignored", () => {
  const storage = memoryStorage();
  storage.setItem(
    outboxStorageKey(11),
    JSON.stringify({ v: 1, sessionId: 999, rep: [rep(1)], set: [] }),
  );
  const { fetchFn } = recordingFetch(() => ok);
  const outbox = makeOutbox(fetchFn, storage);

  assertEqual(outbox.restoreFor(11), 0, "mismatched session not restored");
});

test("corrupt stored JSON does not throw", () => {
  const storage = memoryStorage();
  storage.setItem(outboxStorageKey(12), "{not json");
  const { fetchFn } = recordingFetch(() => ok);
  const outbox = makeOutbox(fetchFn, storage);

  assertEqual(outbox.restoreFor(12), 0, "corrupt snapshot ignored");
});

// ── runner ──────────────────────────────────────────────────────────────────

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`  ✗ ${name}`);
      console.log(`      ${error instanceof Error ? error.message : String(error)}`);
      failed += 1;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
})();
