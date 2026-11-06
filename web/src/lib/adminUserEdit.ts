/**
 * What the admin's Edit form sends for a user. The form holds the user as it
 * was when Edit opened, so two fields that someone else may change meanwhile
 * are sent only when the admin changed them: the patient's clinical text,
 * which the assigned therapist also edits, and the therapist assignment, which
 * this form never edits. Left out, they keep their current saved values.
 */
const SENT_ONLY_WHEN_CHANGED = ["diagnosis", "condition", "prescription", "therapistId"] as const;

type EditedUser = { diagnosis?: unknown; condition?: unknown; prescription?: unknown; therapistId?: unknown };

export function adminEditBody<T extends EditedUser>(loaded: T, edited: T): Partial<T> {
  const body: Partial<T> = { ...edited };
  for (const key of SENT_ONLY_WHEN_CHANGED) {
    // An empty field and a missing one hold the same text.
    if ((edited[key] ?? "") === (loaded[key] ?? "")) delete body[key];
  }
  return body;
}
