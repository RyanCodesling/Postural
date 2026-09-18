/**
 * Trace upload loss — the on-screen record of tuning-trace batches that failed
 * to save.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * A raw-frame batch that exhausts its retries is gone for good: batches are too
 * large to queue in localStorage, so nothing sends them later. The only record
 * of a drop used to be a console warning, and the recording surface gave no
 * sign at all. The trace sync readout names rows as they are QUEUED, so it kept
 * advancing while every upload was being refused, and a session could be
 * recorded start to finish, video included, with no trace saved.
 *
 * So a loss is put on screen next to the readout it contradicts, and it stays
 * there after the session ends, which is when someone is most likely to look.
 *
 * ── WHAT IT DOES AND DOES NOT CLAIM ─────────────────────────────────────────
 * It reports batches that were abandoned. It does not claim the other batches
 * arrived: a batch that is still retrying is not counted until it is given up
 * on. It gives no row count, because the final batch of a session is smaller.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────────────
 * Pure state and wording. The upload loop that detects a loss lives in the
 * camera component; this module decides what a loss record holds and what the
 * person recording is told about it.
 */

/**
 * Losses for one session. `lastStatus` is the HTTP status of the most recent
 * abandoned batch's final attempt, or null when that attempt got no response.
 */
export type TraceUploadLoss = {
  sessionId: number;
  droppedBatches: number;
  lastStatus: number | null;
};

/**
 * Fold one abandoned batch into the loss record. Always returns a new object,
 * because the record is React state and a mutated object would not re-render.
 *
 * A drop for a different session starts a new record rather than adding to the
 * old one. Upload chains outlive the session that queued them, so the last
 * batch of a session that has just ended can fail after the next session has
 * started, and that loss belongs to the session it came from.
 */
export function recordTraceBatchLoss(
  previous: TraceUploadLoss | null,
  sessionId: number,
  status: number | null,
): TraceUploadLoss {
  return {
    sessionId,
    droppedBatches:
      previous !== null && previous.sessionId === sessionId
        ? previous.droppedBatches + 1
        : 1,
    lastStatus: status,
  };
}

function describeCause(status: number | null): string {
  return status === null ? "no response" : `HTTP ${status}`;
}

/** The warning drawn under the trace sync readout. */
export function traceUploadLossLabel(loss: TraceUploadLoss): string {
  const batches =
    loss.droppedBatches === 1 ? "1 batch" : `${loss.droppedBatches} batches`;
  return (
    `TRACE INCOMPLETE — ${batches} not saved, session ${loss.sessionId} ` +
    `(${describeCause(loss.lastStatus)})`
  );
}

/** The toast raised once, when a session loses its first batch. */
export function traceUploadLossToast(loss: TraceUploadLoss): string {
  return (
    `A tuning-trace batch was not saved in session ${loss.sessionId} ` +
    `(${describeCause(loss.lastStatus)}). Stop and check the server before recording more.`
  );
}
