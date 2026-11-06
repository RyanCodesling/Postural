# Postural web application

Next.js 16 and React 19 application for Postural's patient camera workflow, therapist dashboard, and administrator surfaces. Webcam frames are processed in the browser; the application stores derived metrics rather than video.

## Local setup

1. Install Node.js and PostgreSQL.
2. Follow [`../AUTHENTICATION_SETUP.md`](../AUTHENTICATION_SETUP.md) to create the database, run the SQL scripts, and configure `DATABASE_URL`, `SESSION_SECRET`, and optional email settings.
3. Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The seeded credentials in the authentication guide are for local demonstration only.

`SESSION_SECRET` must contain at least 32 random bytes and must not be committed. Changing it invalidates existing `auth_token` cookies.

### Optional demo clock

The [demo clock](docs/demo-clock.md) is shown during local development through
**Admin → Demo Clock → Enable demo tools**, after one-time database setup.
Production builds hide the tab, its controls and the floating badge while
preserving the authenticated APIs and saved settings. It stays off by default.
Enable/disable needs no server restart; disabling restores real time and clears
the offset. The guide covers installation, recorded-date corrections, shared scope
and timestamp limits.

### Optional clinical profile fields

For an existing database, its `users` table owner can enable Diagnosis, Condition,
and Prescription by running [`../scripts/user_clinical_fields_pg.sql`](../scripts/user_clinical_fields_pg.sql).
This transaction only adds the three nullable text columns, is safe to rerun, and
has a five-second lock timeout. It does not seed accounts, change grants, or edit
stored rows. Do not rerun the full credentials/setup script just for this upgrade.

Before that migration, creating and editing accounts still works with these fields
blank. A nonempty value in an unavailable field returns HTTP 409 with code
`clinical_fields_unavailable` before any account write; the admin form displays
the explanation. Existing fields are saved normally, and schema availability is
checked on each affected write, so migration needs no application restart.

The regression suite checks both schema states and the API error/auth boundaries.
For an explicit PostgreSQL check using `.env.local` or `DATABASE_URL`, run:

```bash
node --import tsx src/lib/userClinicalFields.test.ts --database
```

This check copies the `public.users` structure into a private temporary table,
runs the real writers and the migration DDL there, and rolls back. It never copies
patient rows or migrates the real table, and sends no mail or notifications.

### Prescription inputs

New or edited assignments accept whole numbers of **1–4 sets** and **1–20 reps
per set**. Hold exercises accept **1–10 sets** instead: each set is one hold,
with the prescription's rest between holds, so a hold can be repeated with short
rests. Program templates use the same bounds when a dose is entered; their
dose fields can remain blank until assignment. Forms and APIs reject values
outside these ranges and fractional counts. These are prototype input limits;
the therapist chooses the dose. Isometric exercises use a separate hold-duration
target. Existing prescriptions and session history are not rewritten.

### Session report prototype

The standalone `/pt_session_summary_printable_report.html` and the direct therapist
route `/dashboard/therapist/session-report` are **demo templates only**. The route
is omitted from normal therapist navigation. The template starts blank, reads no
saved sessions, creates no clinical record or sign-off, and marks its preview,
print output, and JSON export as demo material. Use fictional entries only. The
existing saved-session and progress report buttons remain the reporting workflow.

### Evaluation deployment

For sessions reached through a temporary HTTPS tunnel, follow
[`docs/evaluation-deployment.md`](docs/evaluation-deployment.md): passwords, backups with
`npm run backup:local` (database and session videos, with a restore check), the release
check and the second-device test.

## Progress session eligibility

Progress charts, the Reports view and progress PDFs exclude attempts marked
`superseded` (replaced by a new start). The patient progress count and latest date
use that same subset. Original sessions, events, recordings and schedule history
are retained. Ended-early and pain-stopped outcomes remain eligible, as do legacy
summaries without a terminal-status field. Completed sessions are never removed
because their values are low or their repetitions did not reach the target.
The displayed GP is recomputed on the eligible sessions with the existing frozen
settings; this is not a model retraining or a new evaluation.

## Common checks

Manual exercise starts use the scheduled prescription snapshot, mark the task
in progress, and reject completed or pain-stopped tasks. The guide adopts the
server's returned prescription. A failed start does not begin an unsaved guide;
a failed pain stop keeps its session target available for retry. An early End
session does the same: the guide shows the end as saving or not saved, with a
retry, and offers Start session again only once the end is saved.

With `DATABASE_URL` set to a loopback PostgreSQL database, `npm run verify:manual:db`
exercises the actual manual start/end SQL against new connection-private
temporary tables. It does not read or modify public patient rows or sequences.

Removed session videos stay in Recently Deleted until an admin restores or
permanently deletes them. The recording notice and delete confirmation explain
this retention. A device's remembered recording answer expires when the notice
changes; historical session consent records keep their original version.

A restore or a permanent delete from Recently Deleted holds the item's row for
its whole transaction, so one item cannot be restored twice or restored while it
is being erased, and a guide file its exercise is showing is never erased. A
guide file that another entry still names is kept until the last such entry is
deleted for good, and a guide whose file is missing is not restored.
`npm run verify:deleted:db` runs these queries against connection-private
temporary tables and a temporary video folder, with a loopback `DATABASE_URL`.

The session check, `/api/auth/me`, never changes the sign-in cookie: a page sends
it as it loads, so its answer can arrive after a sign-in. Log Out clears the
cookie, and the proxy clears an invalid one when a protected page opens.

`npm run dev` and `npm run build` first bundle the trend Web Worker with esbuild.
The generated `public/workers/trend-fit.js` is ignored by Git and must be included
with `public/` when deploying a build. This separate bundle supports the current
Next.js/Turbopack version without changing the app bundler. Use the npm scripts
rather than invoking `next` directly. After editing worker/model source during
development, run `npm run build:trend-worker` and reload the browser (or restart
`npm run dev`). The worker uses the same fitting functions as synchronous readers.

```bash
npm run verify:coaching
npx tsc --noEmit --pretty false
npm run lint
npm run build
```

The project also keeps framework-free TypeScript regression files beside the modules they cover. Run an individual suite with `npx tsx path/to/file.test.ts`; the current release-readiness procedure runs every tracked `*.test.ts` file.

To synchronize the offline ML registry after an exercise-definition change:

```bash
npx tsx scripts/export-registry.ts
```

The generated `../ml/config/registry.json` must be reviewed and committed with the registry change. Raw tuning traces are recorded by default in patient sessions (the camera's staff panel can switch them off) and are not a substitute for a newly collected untouched validation set.

## Architecture boundaries

- Smoothed pose metrics drive display and repetition boundaries.
- Raw unsmoothed metrics feed persisted analytics and offline ML features.
- Dynamic bilateral exercises preserve per-side counts; isometric exercises use time in target band.
- `src/proxy.ts` performs optimistic page gating only. Protected API handlers use the DB-backed authentication helper and enforce current role, ownership, or therapist assignment.
- The offline Random Forest is a synthetic-data feasibility model, not a live clinical model.

This is an undergraduate proof-of-concept, not a medical device or clinically validated system.
