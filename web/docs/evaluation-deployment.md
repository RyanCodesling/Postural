# Evaluation deployment checklist

For running Postural on one machine that other devices reach over HTTPS during
recording or evaluation sessions: the project's rented cloud server (a VPS), or
a laptop behind a temporary HTTPS tunnel. Browsers allow the camera only on
HTTPS or localhost. The app, the database and the video folder stay together on
that one machine; nothing here moves them to a separate storage service.

**Session videos are recorded only on the server.** The recording notice
(`session_video_notice_v3`) tells the patient that the video goes to the
project's cloud server, so on any other deployment, answer No when the camera
page asks to record.

The server's setup, updates, backups and logs are described in
[`../../deploy/server/README.md`](../../deploy/server/README.md). Its seeded demo
accounts are locked at setup and its admin password is set with the server's
password tool, so step 1 below applies to other deployments. Steps 2 to 4 and
the session-day steps apply to both.

## Once, before the first session

1. **Passwords.** Every account whose password is written in this repository
   must get a new one before any tunnel opens:
   - the seeded admin, test patient and test therapist in
     `scripts/user_credentials_pg.sql`;
   - the demo therapist and demo patients, if `npm run seed:demo:accounts` was
     run. Remove them with `npm run remove:demo:accounts` if they are not
     needed; that deletes only those demo accounts and their records.

   Sign in as each account and use the Change password page
   (`/change-password`). Never run `npm run seed:demo`: it deletes the test
   patient's sessions.
2. **Participant accounts.** The admin creates them in the app. Each new
   account must change its password at first sign-in, so have each person sign
   in once soon after the account is made.
   Give each participant the [email information notice](participant-email-information.md).
   It states: "Account and exercise emails, including pain-pause alerts, are sent
   through Gmail." If a separate study-information handout is used, include this
   sentence there too.
3. **Optional clinical fields.** Leave Diagnosis, Condition and Prescription
   blank unless the `users` table owner has run
   `scripts/user_clinical_fields_pg.sql` (see `web/README.md`).
4. **Restore check.** A database administrator creates an empty database
   owned by the app's login, once:

   ```bash
   createdb -U postgres -O postural postural_restore_check
   ```

   Then take a backup (below) and run
   `npm run backup:local -- --verify <backup folder> --into postural_restore_check`.
   It restores the backup there with the app's own login and compares every
   table's row count and every video file's hash. The administrator drops the
   copy afterwards with `dropdb -U postgres postural_restore_check`.

## Before each session day

- **Release.** From `web`: `npm run verify:coaching` passes, then build with
  `npm run build` and start with `npm start`. Running `next build` or
  `next dev` directly skips the step that generates the trend-chart worker
  (`public/workers/trend-fit.js`), and without it every trend shows "Trend
  unavailable".
- **Versions.** The backup manifest records the git revision, whether there
  were uncommitted changes, the coaching algorithm version and the trend
  settings file's SHA-256. Compare them with the values recorded when the
  configuration was frozen.
- **Backup.** `npm run backup:local -- --out <backup folder>\<date>-before`,
  while no session is running. Keep backups on this laptop or a drive you
  control, outside the repository and outside any cloud-synced folder.
- **Space.** The recordings folder (`RECORDINGS_DIR`, default `web/.recordings`)
  must be writable with room to spare; pilot sessions used about 10 MB each.
- **Second device.** Open the tunnel, then from another device check that the
  HTTPS address loads, sign-in works, the browser asks for the camera, and the
  camera page draws the skeleton.
- **Access.** Signed in as one participant, the session videos list shows only
  that participant's sessions, and another participant's video link is refused.

## After each session day

- Close the tunnel.
- `npm run backup:local -- --out <backup folder>\<date>-after`.
- The recordings are test data: nothing is tuned on them.
