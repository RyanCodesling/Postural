import type { AuthenticatedUser } from "@/lib/auth-server";
import { getSessionRecordingState, getUsers } from "@/lib/db";

export type RecordingAccess =
  | { ok: true; sessionId: number; role: "owner" | "therapist"; ended: boolean; videoConsent: boolean }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string };

/**
 * Only the patient who owns the session and their assigned therapist may
 * reach its video. Each route authenticates the request itself and passes the
 * user here; uploading and deleting are further limited to the owner by the
 * routes.
 */
export async function recordingAccess(user: AuthenticatedUser | null, idText: string): Promise<RecordingAccess> {
  if (!user) return { ok: false, status: 401, error: "Unauthorized" };
  const sessionId = Number(idText);
  if (!Number.isInteger(sessionId) || sessionId < 1) return { ok: false, status: 400, error: "Invalid session id" };
  const state = await getSessionRecordingState(sessionId);
  if (!state) return { ok: false, status: 404, error: "Session not found" };
  const base = { ok: true as const, sessionId, ended: state.ended, videoConsent: state.videoConsent };
  if (user.role === "patient" && state.patientId === user.id) return { ...base, role: "owner" };
  if (user.role === "therapist") {
    const assigned = await getUsers({ role: "patient", therapistId: user.id });
    if (assigned.some((patient) => patient.id === state.patientId)) return { ...base, role: "therapist" };
  }
  return { ok: false, status: 403, error: "Forbidden" };
}
