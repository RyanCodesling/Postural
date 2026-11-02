/**
 * What a patient agrees to when they choose to record a session. The camera
 * page shows these lines with the question, and the session's start context
 * stores the notice version with the time of consent.
 */
export { SESSION_VIDEO_NOTICE_VERSION } from "@/lib/prescriptionContext";

export const SESSION_VIDEO_NOTICE = [
  "The video uploads over an encrypted connection to the project's cloud server while you exercise.",
  "In the app, only you and your assigned therapist can watch it.",
  "The researcher who runs the server can also reach the stored files.",
  "You can remove it from your progress at any time. The video then stays in Recently Deleted until an admin restores it or permanently deletes it; it is not erased automatically.",
  "Ask the clinic's admin if you want the video permanently deleted.",
  "This prototype does not encrypt stored videos.",
  "After the study's evaluation, your recordings may be used to improve the system.",
] as const;
