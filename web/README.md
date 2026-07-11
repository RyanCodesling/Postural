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

## Common checks

```bash
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
