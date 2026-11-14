# Demo clock

The Demo Clock tab, its controls and the floating clock badge are hidden by default
in production builds. They remain available during local development (`npm run dev`).
This only changes visibility: saved clock settings, effective dates, recorded
history and the authenticated APIs are preserved. Hiding the interface does not
disable an already enabled clock or clear its offset.

The clock is **off by default**. In local development, an administrator can enable
or disable it from the dashboard without editing environment settings or restarting
the server.

## Open the hidden production controls

While signed in as an administrator, open `/dashboard/admin?demoClock=1`.
This shows the Demo Clock tab and opens its panel, including recorded-date
corrections while demo tools are enabled. If the address already has a query
parameter, append `&demoClock=1` instead.

The parameter only reveals the interface; it does not enable the clock, set a
date or change any recorded data. Other roles still cannot access the admin
dashboard or change the clock. The floating badge stays hidden in production,
including on this page. Remove `demoClock=1` from the address to hide the controls
again. The address option is not saved on the device or in the database.

## Prepare without changing the date

As the owner of the intended database, run
[`../../scripts/demo_clock_settings_pg.sql`](../../scripts/demo_clock_settings_pg.sql)
once. Rerun the updated script if the clock table already exists: it adds the
`enabled` column, initially false. Old saved offsets stay ignored until an admin
explicitly enables the tools. A fresh enable clears the old offset. Rerunning
setup after this upgrade preserves the current admin choice. No reseeding or
computer-clock change is needed.

Leave `DEMO_CLOCK` unset for normal dashboard control. Local and deployed
installations keep separate settings when they use separate databases.

## Use later

Start the local development app with `npm run dev`, or use the hidden production
address above.
After the code and one-time schema setup are installed:

1. Sign in as an administrator and open **Demo Clock**. In development this tab is
   visible to admins even while the tools are off; production shows it only with
   `demoClock=1` in the address.
2. Click **Enable demo tools**. The app initially stays on real time. The recorded
   date correction form is now available without choosing a simulated date.
3. To simulate another date for new work, enter the date/time in the device's
   local timezone and click **Set demo time**. Scheduling uses Asia/Manila.
4. When finished, click **Disable demo tools**. This restores real time and clears
   the offset. A later enable starts fresh on real time.

No restart or rebuild is needed for these actions. During local development a badge
identifies a nonzero override; the clock advances normally from the chosen time. Other signed-in tabs
pick up changes within about 15 seconds; refresh their pages before using a new
day. **Reset to system time** clears only the offset, leaving correction tools
enabled. Disabling/resetting does not rewrite previously saved records.

For administrators of the server, `DEMO_CLOCK=off` remains an optional hard lock:
it ignores persisted mode/offset and refuses changes. The visible Demo Clock panel
explains the lock. Removing an existing environment lock needs a service restart
once; normal dashboard switching then needs none. `DEMO_CLOCK=on` and the older `dev:demo` /
`start:demo` aliases merely permit the dashboard controls; they no longer enable
the stored mode automatically. Keep `NODE_ENV=production` on deployed services.

The setting applies to every user of that demo-enabled installation. Use demo
accounts and assignments scheduled for the simulated day. Finish any active
session before changing the date. Reminder and daily-summary selection also uses
the simulated day; configured email delivery remains real.

## What follows the clock

Session start/end and session context capture, exercise completion and pain-stop
dates, manual completion, scheduling, calendars, and reminder date selection use
the simulated application time. The recorded session date therefore changes for
new entries made under a demo date.

This is not an operating-system clock override. Repetition/set timestamps and
recording anchors still use the browser's real clock; post-session pain reports,
notifications and other creation/audit fields may use database real time. Login,
password expiry, the operating system and PostgreSQL's own clock remain real.
Changing the clock does not backdate existing records or create missing assignments.

Only signed-in users can read the setting; only administrators can enable,
disable, set or reset it. A missing table or required column is reported in the
admin panel, and the application uses real time until setup is complete.

## Correct a session recorded on the wrong day

For this optional control, the database owner must also run
[`../../scripts/session_date_corrections_pg.sql`](../../scripts/session_date_corrections_pg.sql)
after the session and occurrence schema exists. This adds an audit table and its
permissions; it does not alter any existing session or scheduled day. Install it
separately in each database where corrections will be used. Keep demo mode off
until needed; no correction is made simply by enabling it.

An administrator can open **Demo Clock → Correct a recorded date** in local
development or through the hidden production address above. The existing
authenticated correction API and audit history remain available.
The clock offset may stay at zero:

1. Find and select a finished session by patient, exercise, or session number.
2. Choose the destination scheduled day (Asia/Manila). It must already exist in
   the same prescription, be uncancelled and unused, and match the recorded dose,
   side, and resistance. A day with different or unknown prescription context
   cannot receive the session. The current day is also offered for time-only fixes.
3. Check the corrected start date/time in the device's local timezone. Selecting
   a new day initially keeps the original Manila time of day. The start must fall
   within that scheduled day's make-up window. The end shifts by the same amount,
   preserving the exact duration.
4. Enter a reason, review the start/end and scheduled-day preview, then select
   **Save date correction**. Refresh other open schedules, histories, and reports.

The session and its outcome move together. A completion remains completed; a
pain stop remains a pain stop; a finished partial attempt remains partial. The
old day becomes pending, or in progress if earlier partial attempts remain.
Those attempts stay attached to the old day. The destination's completion or
pain-stop time becomes the corrected session end. The calendar and adherence
therefore reflect the corrected scheduled day, while session history, trends,
and newly generated reports use the corrected session start. Moving to an old
date can change trend ordering; it does not rerun measurements or train a model.

The control rejects active sessions, conflicting outcomes, occupied destinations,
changed prescriptions, sessions without an occurrence, and stale edits. It does
not create missing schedule days or move work between prescriptions. Review the
prescription schedule separately if the intended destination is not listed.

Each correction atomically saves the exact previous/new timestamps, old/new
occurrence links and occurrence snapshots, administrator, reason, and actual
correction time. The application role can read and append this history but
cannot update or delete it. Correcting a mistake again creates another audit
entry, including when returning to the original day. Measurement, rep/set/raw
data, immutable captured context, and recording anchors are preserved. The
captured context still describes the original recording; the correction audit
explains the later date/occurrence change. No account, global clock, prescription
dose, reminder email or notification is changed by this action. Previously sent
emails, notifications and exported reports retain their original content.

The correction is persistent: resetting or disabling the demo clock does not
undo it. Corrections are prepared as an optional feature, not automatically
applied to any existing sessions during setup or deployment.

Developer verification: `npx tsx src/lib/sessionDateCorrection.test.tsx` checks
validation, rendered preview, and route access. `npm run verify:session-dates`
also exercises the actual SQL and patient schedule reader using connection-private
temporary tables on the configured local database. It refuses non-local hosts,
does not read patient rows, and drops its fixtures when the connection closes.
