/**
 * Durable outbox for session outcome events (counted repetitions and completed
 * sets).
 *
 * The camera loop previously handed these to `fetch` fire-and-forget *after*
 * clearing its pending buffer, so three separate failures silently destroyed
 * outcome data:
 *
 *   1. The buffer was emptied before the request existed, so any failure was
 *      unrecoverable.
 *   2. `.catch()` only logged a warning — nothing was ever retried.
 *   3. `fetch` rejects on network failure but NOT on 4xx/5xx, so a rejected
 *      batch never reached `.catch()` at all and produced no output whatsoever.
 *
 * This module owns the queue instead. Items leave it only when the server has
 * acknowledged them with an OK response; everything else keeps them queued for
 * a later attempt. Repetition and set batches are small and bounded per session,
 * so the queue is never dropped on the floor — an item that cannot be delivered
 * stays pending and is reported honestly rather than discarded.
 *
 * `fetch`, storage, and the timer are injected so the whole thing is testable
 * without a network or a browser (see `eventOutbox.test.ts`).
 */

export type OutboxKind = "rep" | "set";

/** Minimal `Response` shape this module depends on. */
export type OutboxResponse = { ok: boolean; status: number };

export type OutboxFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<OutboxResponse>;

/** Minimal `localStorage` shape. */
export type OutboxStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type OutboxScheduler = (fn: () => void, delayMs: number) => void;

export type EventOutboxOptions = {
  fetchFn: OutboxFetch;
  storage?: OutboxStorage | null;
  schedule?: OutboxScheduler;
  /** Attempts before auto-retry backs off to the ceiling delay. */
  maxAttempts?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  /** Safety valve so a pathological session cannot exhaust storage quota. */
  maxPersistedItems?: number;
  onError?: (kind: OutboxKind, message: string) => void;
};

export type FlushOutcome =
  | "idle"        // nothing queued, or no session bound yet
  | "delivered"
  | "failed";

type Queue<T> = {
  pending: T[];
  inFlight: Promise<FlushOutcome> | null;
  attempt: number;
  retryScheduled: boolean;
  lastError: string | null;
};

const OUTBOX_STORAGE_PREFIX = "postural.outbox.v1";
const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_BASE_RETRY_MS = 800;
const DEFAULT_MAX_RETRY_MS = 15_000;
const DEFAULT_MAX_PERSISTED_ITEMS = 500;

export const outboxStorageKey = (sessionId: number): string =>
  `${OUTBOX_STORAGE_PREFIX}.${sessionId}`;

const KIND_PATH: Record<OutboxKind, string> = {
  rep: "rep-events",
  set: "set-events",
};

const KIND_BODY_KEY: Record<OutboxKind, string> = {
  rep: "reps",
  set: "sets",
};

const emptyQueue = <T>(): Queue<T> => ({
  pending: [],
  inFlight: null,
  attempt: 0,
  retryScheduled: false,
  lastError: null,
});

export class EventOutbox<
  R extends { repIndex: number },
  S extends { setIndex: number },
> {
  private sessionId: number | null = null;
  private readonly repQueue: Queue<R> = emptyQueue<R>();
  private readonly setQueue: Queue<S> = emptyQueue<S>();
  /** Keys the server has already acknowledged, so a restore never resends. */
  private readonly ackedRepIndices = new Set<number>();
  private readonly ackedSetIndices = new Set<number>();

  private readonly fetchFn: OutboxFetch;
  private readonly storage: OutboxStorage | null;
  private readonly schedule: OutboxScheduler;
  private readonly maxAttempts: number;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly maxPersistedItems: number;
  private readonly onError?: (kind: OutboxKind, message: string) => void;

  constructor(options: EventOutboxOptions) {
    this.fetchFn = options.fetchFn;
    this.storage = options.storage ?? null;
    this.schedule =
      options.schedule ??
      ((fn, delayMs) => {
        setTimeout(fn, delayMs);
      });
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? DEFAULT_BASE_RETRY_MS;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_MS;
    this.maxPersistedItems =
      options.maxPersistedItems ?? DEFAULT_MAX_PERSISTED_ITEMS;
    this.onError = options.onError;
  }

  /**
   * Bind the outbox to a session.
   *
   * Adopting an id while unbound (`null` → id) KEEPS whatever is queued: session
   * creation is asynchronous, so repetitions can legitimately be recorded before
   * the row exists, and those belong to the session now being adopted. Every
   * other transition clears the queue, because items are addressed to a specific
   * session's endpoint and must not be redirected to a different one.
   */
  setSession(sessionId: number | null): void {
    if (this.sessionId === sessionId) return;
    const adoptingWhileUnbound = this.sessionId === null && sessionId !== null;
    this.sessionId = sessionId;
    if (!adoptingWhileUnbound) this.resetQueues();
  }

  getSession(): number | null {
    return this.sessionId;
  }

  enqueue(kind: "rep", item: R): void;
  enqueue(kind: "set", item: S): void;
  enqueue(kind: OutboxKind, item: R | S): void {
    if (kind === "rep") {
      const rep = item as R;
      if (this.ackedRepIndices.has(rep.repIndex)) return;
      this.repQueue.pending.push(rep);
    } else {
      const set = item as S;
      if (this.ackedSetIndices.has(set.setIndex)) return;
      this.setQueue.pending.push(set);
    }
    this.persist();
  }

  pendingCount(kind?: OutboxKind): number {
    if (kind === "rep") return this.repQueue.pending.length;
    if (kind === "set") return this.setQueue.pending.length;
    return this.repQueue.pending.length + this.setQueue.pending.length;
  }

  lastError(kind: OutboxKind): string | null {
    return kind === "rep" ? this.repQueue.lastError : this.setQueue.lastError;
  }

  /**
   * Send everything currently queued for `kind`. Only the exact slice that was
   * sent is removed on success — items appended while the request was in flight
   * stay queued for the next pass rather than being silently dropped.
   */
  flush(kind: OutboxKind): Promise<FlushOutcome> {
    const queue = this.queueFor(kind);
    // A concurrent caller joins the in-flight attempt rather than double-sending.
    if (queue.inFlight) return queue.inFlight;
    if (this.sessionId === null || queue.pending.length === 0) {
      return Promise.resolve("idle");
    }
    return this.runFlush(kind);
  }

  private runFlush(kind: OutboxKind): Promise<FlushOutcome> {
    const queue = this.queueFor(kind);
    const sessionId = this.sessionId as number;
    const batch = queue.pending.slice();
    const sentCount = batch.length;

    const run = (async (): Promise<FlushOutcome> => {
      try {
        const response = await this.fetchFn(
          `/api/sessions/${sessionId}/${KIND_PATH[kind]}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [KIND_BODY_KEY[kind]]: batch }),
          },
        );
        // The bug this module exists to fix: `fetch` resolves for 4xx/5xx, so
        // the status MUST be checked explicitly or failures pass as successes.
        if (!response.ok) {
          throw new Error(`${KIND_PATH[kind]} returned ${response.status}`);
        }
      } catch (error) {
        queue.lastError =
          error instanceof Error ? error.message : String(error);
        queue.attempt += 1;
        this.onError?.(kind, queue.lastError);
        // NB: the retry is scheduled by the caller below, *after* the in-flight
        // slot is released — scheduling it here would re-enter `flush()` while
        // `inFlight` is still set and be swallowed by the concurrency guard.
        return "failed";
      }

      // Remove only what was actually sent; the queue may have grown meanwhile.
      queue.pending.splice(0, sentCount);
      queue.attempt = 0;
      queue.lastError = null;
      this.markAcked(kind, batch);
      this.persist();
      return "delivered";
    })();

    queue.inFlight = run;
    return run
      .finally(() => {
        queue.inFlight = null;
      })
      .then((outcome) => {
        if (outcome === "failed") this.scheduleRetry(kind);
        return outcome;
      });
  }

  private markAcked(kind: OutboxKind, batch: Array<R | S>): void {
    if (kind === "rep") {
      for (const item of batch) {
        this.ackedRepIndices.add((item as R).repIndex);
      }
    } else {
      for (const item of batch) {
        this.ackedSetIndices.add((item as S).setIndex);
      }
    }
  }

  private scheduleRetry(kind: OutboxKind): void {
    const queue = this.queueFor(kind);
    if (queue.retryScheduled) return;
    // Bounded auto-retry. Items are NOT discarded at the cap — they stay queued,
    // are persisted, and are reported by `drain()` at session end, which also
    // retries them explicitly. Without the cap, a synchronous scheduler plus a
    // persistently failing endpoint would loop forever.
    if (queue.attempt >= this.maxAttempts) return;
    queue.retryScheduled = true;
    const exponent = Math.min(queue.attempt, this.maxAttempts) - 1;
    const delay = Math.min(
      this.baseRetryDelayMs * 2 ** Math.max(0, exponent),
      this.maxRetryDelayMs,
    );
    this.schedule(() => {
      queue.retryScheduled = false;
      // Items are never discarded: if this attempt fails too, another retry is
      // scheduled, and anything still pending is reported at session end.
      void this.flush(kind);
    }, delay);
  }

  flushAll(): Promise<[FlushOutcome, FlushOutcome]> {
    return Promise.all([this.flush("rep"), this.flush("set")]);
  }

  /**
   * Best-effort drain used at session end. Retries until the queue is empty or
   * the deadline passes, then reports what is left so the caller can tell the
   * patient the truth instead of an unconditional "Session saved."
   */
  async drain(options?: {
    timeoutMs?: number;
    pollDelayMs?: number;
  }): Promise<{ drained: boolean; remaining: number }> {
    const timeoutMs = options?.timeoutMs ?? 8000;
    const pollDelayMs = options?.pollDelayMs ?? 400;
    const started = Date.now();
    // Hard cap in addition to the deadline: with an immediate scheduler (tests,
    // or a zero timeout) the wall-clock check alone could spin.
    const maxPasses = 32;

    for (let pass = 0; pass < maxPasses && this.pendingCount() > 0; pass += 1) {
      await this.flushAll();
      if (this.pendingCount() === 0) break;
      if (Date.now() - started >= timeoutMs) break;
      await this.delay(pollDelayMs);
    }

    const remaining = this.pendingCount();
    if (remaining > 0) this.persist();
    return { drained: remaining === 0, remaining };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.schedule(() => resolve(), ms);
    });
  }

  /** Serialize pending items so a tab close or crash does not lose them. */
  persist(): void {
    if (!this.storage || this.sessionId === null) return;
    const key = outboxStorageKey(this.sessionId);
    if (this.pendingCount() === 0) {
      try {
        this.storage.removeItem(key);
      } catch {
        /* storage unavailable — nothing further to do */
      }
      return;
    }
    const payload = {
      v: 1 as const,
      sessionId: this.sessionId,
      rep: this.repQueue.pending.slice(0, this.maxPersistedItems),
      set: this.setQueue.pending.slice(0, this.maxPersistedItems),
      updatedAtWallMs: Date.now(),
    };
    try {
      this.storage.setItem(key, JSON.stringify(payload));
    } catch {
      /* quota or unavailable — in-memory queue still holds the items */
    }
  }

  /**
   * Reload any pending items left behind by a previous page load. Returns the
   * number of items restored.
   */
  restoreFor(sessionId: number): number {
    if (!this.storage) return 0;
    let parsed: unknown;
    try {
      const raw = this.storage.getItem(outboxStorageKey(sessionId));
      if (!raw) return 0;
      parsed = JSON.parse(raw);
    } catch {
      return 0;
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      (parsed as { v?: unknown }).v !== 1 ||
      (parsed as { sessionId?: unknown }).sessionId !== sessionId
    ) {
      return 0;
    }
    const record = parsed as { rep?: unknown; set?: unknown };
    this.setSession(sessionId);
    let restored = 0;
    if (Array.isArray(record.rep)) {
      for (const item of record.rep) {
        if (
          item !== null &&
          typeof item === "object" &&
          typeof (item as R).repIndex === "number"
        ) {
          this.repQueue.pending.push(item as R);
          restored += 1;
        }
      }
    }
    if (Array.isArray(record.set)) {
      for (const item of record.set) {
        if (
          item !== null &&
          typeof item === "object" &&
          typeof (item as S).setIndex === "number"
        ) {
          this.setQueue.pending.push(item as S);
          restored += 1;
        }
      }
    }
    return restored;
  }

  /** Drop persisted state for a session that is finished and fully delivered. */
  clearStorage(sessionId: number): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(outboxStorageKey(sessionId));
    } catch {
      /* storage unavailable */
    }
  }

  private queueFor(kind: OutboxKind): Queue<R | S> {
    return (kind === "rep" ? this.repQueue : this.setQueue) as Queue<R | S>;
  }

  private resetQueues(): void {
    this.repQueue.pending.length = 0;
    this.repQueue.attempt = 0;
    this.repQueue.lastError = null;
    this.setQueue.pending.length = 0;
    this.setQueue.attempt = 0;
    this.setQueue.lastError = null;
    this.ackedRepIndices.clear();
    this.ackedSetIndices.clear();
  }
}
