// Runs once when the Next.js server starts. Encrypts any email address still
// stored readable, then checks hourly whether the summary emails of the day that
// just ended, or the patients' exercise reminders, are due;
// sendDailyTherapistDigests and sendExerciseReminderEmails send each only once.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const state = globalThis as { __digestTimer?: NodeJS.Timeout };
  if (state.__digestTimer) return;

  try {
    const { encryptStoredEmails } = await import("@/lib/db");
    const converted = await encryptStoredEmails();
    if (converted > 0) console.log(`[email] Encrypted ${converted} stored email address(es).`);
  } catch (err) {
    console.error("[email] Encrypting stored email addresses failed:", err);
  }

  const run = async () => {
    try {
      const { sendDailyTherapistDigests } = await import("@/lib/db");
      await sendDailyTherapistDigests();
    } catch (err) {
      console.error("[digest] Daily therapist digest failed:", err);
    }
    try {
      const { sendExerciseReminderEmails } = await import("@/lib/db");
      await sendExerciseReminderEmails();
    } catch (err) {
      console.error("[digest] Exercise reminder emails failed:", err);
    }
  };
  state.__digestTimer = setInterval(run, 60 * 60 * 1000);
  setTimeout(run, 30 * 1000);
}
