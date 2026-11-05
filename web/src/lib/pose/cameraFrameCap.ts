/**
 * The live camera loop's frame limit.
 *
 * The camera loop runs once per screen refresh (requestAnimationFrame). Without
 * a limit it processes every refresh, so a fast computer, especially one with a
 * 60-144 Hz screen, runs pose detection more often than a 30 fps webcam delivers
 * pictures: it reads the same picture again, and every setting that counts
 * frames sees more of them than it was set for. The system was developed and
 * tuned at about 20 processed frames a second, and its frame-counting settings
 * assume that rate (the registry's "about three live" persistence notes, the
 * shrug cue's single-frame flag). So the loop processes at most
 * CAMERA_LOOP_MAX_FPS frames a second. A computer that cannot reach that rate
 * runs exactly as before.
 *
 * The limit is a schedule of 50 ms slots, not a minimum gap between frames. A
 * refresh may take a slot up to CAMERA_LOOP_SLOT_EARLY_MS before it is due, so a
 * 60 Hz screen processes every third refresh, and refreshes 33 ms apart (a
 * browser's 30 Hz power-saving rate) alternate 33 and 67 ms, still 20 a second,
 * where a plain 50 ms gap would give 15. A frame processed late books the next
 * slot no sooner than half a slot later, so a stall or a slow stretch is never
 * made up with a burst of frames.
 *
 * `fpsCap=off` in the camera page's address turns the limit off for that page
 * load, as a fallback.
 */

export const CAMERA_LOOP_MAX_FPS = 20;
export const CAMERA_LOOP_SLOT_MS = 1000 / CAMERA_LOOP_MAX_FPS;
/** Screen refreshes land a little before or after the moment a slot is due. */
export const CAMERA_LOOP_SLOT_EARLY_MS = 4;

export type CameraFrameCap = {
  /** False turns the limit off: every refresh is processed, as before the limit. */
  enabled: boolean;
  /** When the next frame may be processed; null before the first frame. */
  nextSlotMs: number | null;
};

export function newCameraFrameCap(enabled = true): CameraFrameCap {
  return { enabled, nextSlotMs: null };
}

/** Whether the camera loop processes the frame at `nowMs`. Taking a frame books the next slot. */
export function takeCameraFrameSlot(cap: CameraFrameCap, nowMs: number): boolean {
  if (!cap.enabled) return true;
  if (cap.nextSlotMs !== null && nowMs < cap.nextSlotMs - CAMERA_LOOP_SLOT_EARLY_MS) return false;
  const scheduled = (cap.nextSlotMs ?? nowMs) + CAMERA_LOOP_SLOT_MS;
  cap.nextSlotMs = Math.max(scheduled, nowMs + CAMERA_LOOP_SLOT_MS / 2);
  return true;
}

/** False when the page address carries `fpsCap=off`, which turns the limit off for that page load. */
export function cameraFrameCapEnabledFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("fpsCap")?.trim().toLowerCase() !== "off";
}
