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

### Session report prototype

The standalone `/pt_session_summary_printable_report.html` and the direct therapist
route `/dashboard/therapist/session-report` are **demo templates only**. The route
is omitted from normal therapist navigation. The template starts blank, reads no
saved sessions, creates no clinical record or sign-off, and marks its preview,
print output, and JSON export as demo material. Use fictional entries only. The
existing saved-session and progress report buttons remain the reporting workflow.

## Common checks

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

The generated `../ml/config/registry.json` must be reviewed and committed with the registry change. Raw tuning traces are opt-in and are not a substitute for a newly collected untouched validation set.

## Architecture boundaries

- Smoothed pose metrics drive display and repetition boundaries.
- Raw unsmoothed metrics feed persisted analytics and offline ML features.
- Dynamic bilateral exercises preserve per-side counts; isometric exercises use time in target band.
- `src/proxy.ts` performs optimistic page gating only. Protected API handlers use the DB-backed authentication helper and enforce current role, ownership, or therapist assignment.
- The offline Random Forest is a synthetic-data feasibility model, not a live clinical model.

This is an undergraduate proof-of-concept, not a medical device or clinically validated system.
