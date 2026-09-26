/**
 * Records the camera stream for a patient who opted in, uploading it to the
 * local server in chunks as the session runs, so a reload keeps what was
 * already sent. Everything here is best-effort and isolated: a recording
 * failure is reported through `onState` and never touches exercise outcomes.
 *
 * Timing: the part's start and end are taken from `nowWallMs`, the same clock
 * that stamps sets, repetitions and the coaching record, so the player can
 * place them on the video. Chunk boundaries are not used for timing.
 *
 * Stop is final: once requested it waits for a part that is still opening,
 * closes it, and no later event reports "recording" again.
 *
 * Beside the video, each processed frame's pose and cue are kept as an
 * overlay track, so playback can redraw the coaching overlays. The track
 * uploads on a queue of its own that the video never waits for: a slow or
 * failed overlay upload only drops overlays, and closing the part records
 * whether the whole track was saved. A request with no answer within the
 * time limit is abandoned and retried.
 */
import { encodeLandmarks, type OverlayFrame } from "./overlayTrack";

export type RecordingState = "recording" | "stopped" | "failed" | "unsupported";

const PREFERRED_TYPES = [
  "video/webm;codecs=vp8",
  "video/webm;codecs=vp9",
  "video/webm",
  "video/mp4",
];
const TIMESLICE_MS = 4000;
const VIDEO_BITS_PER_SECOND = 1_000_000;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const DRAIN_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 30_000;

type RecorderLike = {
  state: string;
  start(timeslice?: number): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
};
type RecorderClass = {
  new (stream: MediaStream, options: { mimeType: string; videoBitsPerSecond: number }): RecorderLike;
  isTypeSupported(type: string): boolean;
};

export function pickRecordingMimeType(isTypeSupported: (type: string) => boolean): string | null {
  return PREFERRED_TYPES.find((type) => isTypeSupported(type)) ?? null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class SessionRecorder {
  private recorder: RecorderLike | null = null;
  private part: number | null = null;
  /** The request opening the part; Stop waits for it so a part never stays open. */
  private opening: Promise<boolean> | null = null;
  private uploaded = 0;
  private queue: Blob[] = [];
  private sending = false;
  private failed = false;
  private stopping: Promise<void> | null = null;
  /** Stop has closed the part; uploads still in flight change nothing. */
  private finished = false;
  /** Stop stopped waiting for the part to open; a part opening later is closed by start(). */
  private openingAbandoned = false;
  private startWallMs = 0;
  private endWallMs: number | null = null;
  private overlayFrames: OverlayFrame[] = [];
  /** Overlay batches waiting to upload, in order, each covering the part up to `throughMs`. */
  private overlayQueue: Array<{ body: string; throughMs: number }> = [];
  private overlaySending = false;
  private overlayUploaded = 0;
  private overlayFailed = false;

  constructor(private readonly options: {
    sessionId: number;
    stream: MediaStream;
    nowWallMs: () => number;
    onState: (state: RecordingState) => void;
    fetchImpl?: typeof fetch;
    Recorder?: RecorderClass;
    retryDelaysMs?: number[];
    /** How long Stop waits for a part that is still opening, and for uploads to drain. */
    waitMs?: number;
    /** How long one request may go unanswered before it is abandoned. */
    requestTimeoutMs?: number;
  }) {}

  private get base() {
    return `/api/sessions/${this.options.sessionId}/recording`;
  }

  /** One request, aborted and rejected when no answer comes within the time limit. */
  private async fetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`no answer from ${url}`));
      }, this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
    });
    try {
      return await Promise.race([(this.options.fetchImpl ?? fetch)(url, { ...init, signal: controller.signal }), timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Resolves true once recording is under way; false when unsupported, refused, or stopped first. */
  async start(): Promise<boolean> {
    const Recorder = this.options.Recorder ??
      (typeof MediaRecorder === "undefined" ? undefined : (MediaRecorder as unknown as RecorderClass));
    const mimeType = Recorder ? pickRecordingMimeType((type) => Recorder.isTypeSupported(type)) : null;
    if (!Recorder || !mimeType) {
      this.options.onState("unsupported");
      return false;
    }
    let recorder: RecorderLike;
    try {
      recorder = new Recorder(this.options.stream, { mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.queue.push(event.data);
          void this.pump();
        }
        // The overlay kept so far follows at the same pace, on its own queue.
        this.cutOverlay();
      };
      // The recorder also stops by itself when the camera stream ends.
      recorder.onstop = () => void this.stop();
      recorder.onerror = () => this.fail();
      recorder.start(TIMESLICE_MS);
    } catch {
      this.options.onState("failed");
      return false;
    }
    this.recorder = recorder;
    this.startWallMs = this.options.nowWallMs();
    this.opening = this.openPart(mimeType, this.startWallMs);
    const opened = await this.opening;
    // Stop may have been requested while the part was opening. Stop closes
    // the part, unless it gave up waiting; then the part is closed here.
    if (opened && this.openingAbandoned) void this.close(false, false);
    if (!opened || this.stopping) return false;
    this.options.onState("recording");
    void this.pump();
    void this.pumpOverlay();
    return true;
  }

  private async openPart(mimeType: string, startWallMs: number): Promise<boolean> {
    try {
      const response = await this.fetch(this.base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", mimeType, startWallMs }),
      });
      const body = response.ok ? await response.json() : null;
      if (!body || !Number.isInteger(body.part)) throw new Error(`recording start returned ${response.status}`);
      this.part = body.part;
      return true;
    } catch {
      this.fail();
      return false;
    }
  }

  /**
   * Keeps one processed frame's pose for the overlay track while recording and
   * returns it, so the caller can add the cue it drew on that frame.
   */
  addOverlayFrame(landmarks: ReadonlyArray<{ x: number; y: number }>): OverlayFrame | null {
    if (!this.recorder || this.stopping || this.failed || this.overlayFailed) return null;
    const frame: OverlayFrame = { t: Math.round(this.options.nowWallMs() - this.startWallMs), lm: encodeLandmarks(landmarks) };
    this.overlayFrames.push(frame);
    return frame;
  }

  /** Moves the frames kept so far into an upload batch that covers the part up to now. */
  private cutOverlay() {
    if (this.overlayFailed || this.overlayFrames.length === 0) return;
    const frames = this.overlayFrames;
    this.overlayFrames = [];
    const now = this.endWallMs ?? this.options.nowWallMs();
    this.overlayQueue.push({
      body: frames.map((frame) => JSON.stringify(frame)).join("\n") + "\n",
      throughMs: Math.max(0, Math.round(now - this.startWallMs)),
    });
    void this.pumpOverlay();
  }

  /** Uploads overlay batches in order. The first one that cannot be saved ends the overlays, never the video. */
  private async pumpOverlay() {
    if (this.overlaySending || this.part === null || this.overlayFailed || this.finished) return;
    this.overlaySending = true;
    try {
      while (this.overlayQueue.length > 0 && !this.overlayFailed && !this.finished) {
        const batch = this.overlayQueue[0];
        const seq = this.overlayUploaded + 1;
        const sent = await this.withRetries(() => this.fetch(
          `${this.base}/${this.part}?seq=${seq}&track=overlay&through=${batch.throughMs}`,
          { method: "PUT", headers: { "Content-Type": "application/x-ndjson" }, body: batch.body },
        ));
        if (!sent) {
          this.overlayFailed = true;
          this.overlayQueue = [];
          this.overlayFrames = [];
          break;
        }
        this.overlayQueue.shift();
        this.overlayUploaded = seq;
      }
    } finally {
      this.overlaySending = false;
    }
  }

  private fail() {
    if (this.failed || this.finished) return;
    this.failed = true;
    this.options.onState("failed");
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
  }

  /** Sends a request, retrying network errors, unanswered requests and server errors; a refusal is final. */
  private async withRetries(send: () => Promise<Response>): Promise<boolean> {
    const delays = this.options.retryDelaysMs ?? RETRY_DELAYS_MS;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (attempt > 0) await sleep(delays[attempt - 1]);
      try {
        const response = await send();
        if (response.ok) return true;
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) return false;
      } catch {
        // Network error or no answer in time: retry.
      }
    }
    return false;
  }

  /** Uploads queued chunks in order; each chunk is retried before the part is given up. */
  private async pump() {
    if (this.sending || this.part === null || this.failed || this.finished) return;
    this.sending = true;
    try {
      while (this.queue.length > 0 && !this.failed && !this.finished) {
        const seq = this.uploaded + 1;
        const chunk = this.queue[0];
        const sent = await this.withRetries(() => this.fetch(`${this.base}/${this.part}?seq=${seq}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: chunk,
        }));
        if (!sent) {
          this.fail();
          break;
        }
        this.queue.shift();
        this.uploaded = seq;
      }
    } finally {
      this.sending = false;
    }
  }

  /** Closes the part on the server, retrying; false when it could not be closed. */
  private close(complete: boolean, overlayComplete: boolean): Promise<boolean> {
    return this.withRetries(() => this.fetch(this.base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "finish", part: this.part, endWallMs: this.endWallMs, complete, overlayComplete }),
    }));
  }

  /** Stops recording, sends what is left and closes the part. Safe to call more than once. */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.endWallMs = this.options.nowWallMs();
    const waitMs = this.options.waitMs ?? DRAIN_TIMEOUT_MS;
    this.stopping = (async () => {
      const recorder = this.recorder;
      if (recorder && recorder.state !== "inactive") {
        await new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
          recorder.stop();
        });
      }
      // A part still opening must open before it can be closed, but a server
      // that never answers is not waited for indefinitely.
      if (this.opening) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const gaveUp = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), waitMs); });
        const opened = await Promise.race([this.opening, gaveUp]);
        clearTimeout(timer);
        if (opened === null) {
          this.openingAbandoned = true;
          this.fail();
        }
      }
      const until = Date.now() + waitMs;
      while ((this.queue.length > 0 || this.sending) && !this.failed && Date.now() < until) {
        void this.pump();
        await sleep(100);
      }
      const complete = !this.failed && this.queue.length === 0;
      // Then the rest of the overlay track, within the same limit.
      this.cutOverlay();
      while (this.part !== null && (this.overlayQueue.length > 0 || this.overlaySending) && !this.overlayFailed &&
        Date.now() < until) {
        void this.pumpOverlay();
        await sleep(100);
      }
      const overlayComplete = !this.overlayFailed && this.overlayQueue.length === 0 && !this.overlaySending;
      this.finished = true;
      const closed = this.part === null ? !this.openingAbandoned : await this.close(complete, overlayComplete);
      this.options.onState(complete && closed ? "stopped" : "failed");
    })();
    return this.stopping;
  }
}
