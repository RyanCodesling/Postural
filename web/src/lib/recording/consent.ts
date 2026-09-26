/**
 * What a patient agrees to when they choose to record a session. The camera
 * page shows these lines with the question, and the session's start context
 * stores the notice version with the time of consent.
 */
export { SESSION_VIDEO_NOTICE_VERSION } from "@/lib/prescriptionContext";

export const SESSION_VIDEO_NOTICE = [
  "The video uploads to this clinic's computer while you exercise.",
  "Once it is uploaded, your assigned therapist can watch it. No one else can.",
  "You can delete it at any time. It is not sent online.",
  "This prototype does not encrypt stored videos.",
  "Videos are never used to train or tune the system.",
] as const;
