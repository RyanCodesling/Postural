/**
 * A patient's remembered answer to "Record video of this session?", kept in
 * this browser only and per patient, so another patient on the same computer
 * is still asked. A choice made under an older notice is ignored, because the
 * patient has not seen the current wording.
 */
import { SESSION_VIDEO_NOTICE_VERSION } from "@/lib/prescriptionContext";

const KEY_PREFIX = "postural.videoChoice.";

export type VideoChoice = { record: boolean; notice: string; savedAt: string };
type ChoiceStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStore(): ChoiceStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readVideoChoice(userId: string | undefined, store: ChoiceStore | null = browserStore()): VideoChoice | null {
  if (!userId || !store) return null;
  try {
    const choice = JSON.parse(store.getItem(KEY_PREFIX + userId) ?? "null") as VideoChoice | null;
    return choice && typeof choice.record === "boolean" && choice.notice === SESSION_VIDEO_NOTICE_VERSION ? choice : null;
  } catch {
    return null;
  }
}

export function rememberVideoChoice(
  userId: string | undefined,
  record: boolean,
  store: ChoiceStore | null = browserStore(),
): VideoChoice | null {
  if (!userId || !store) return null;
  const choice: VideoChoice = { record, notice: SESSION_VIDEO_NOTICE_VERSION, savedAt: new Date().toISOString() };
  try {
    store.setItem(KEY_PREFIX + userId, JSON.stringify(choice));
    return choice;
  } catch {
    return null;
  }
}

export function forgetVideoChoice(userId: string | undefined, store: ChoiceStore | null = browserStore()) {
  if (!userId || !store) return;
  try {
    store.removeItem(KEY_PREFIX + userId);
  } catch {
    // Storage unavailable: nothing was remembered.
  }
}
