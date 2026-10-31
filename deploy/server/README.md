# Evaluation server

How the project's rented server is set up and kept running. It is one Ubuntu 24.04 machine
(2 vCPUs, 4 GB memory) that holds the app, its PostgreSQL database and the session-video
folder together; nothing is stored with a separate storage service. Browsers reach it over
HTTPS on its DNS name, SSH is open only to the researcher's own address, and PostgreSQL and
the app's port 3000 are reachable only from inside the server.

The general checklist (passwords, accounts, backups, the second-device test) is
[`../../web/docs/evaluation-deployment.md`](../../web/docs/evaluation-deployment.md).

## What runs where

| Item | Location |
|---|---|
| Code (one revision of this repository) | `/opt/postural/app` (`web`, `scripts`, `AUTHENTICATION_SETUP.md`) |
| Reference Guide clips (gitignored, copied from a developer machine) | `/opt/postural/app/web/public/demos/` |
| Settings and secrets (generated on the server, never printed) | `/etc/postural/env` |
| Session videos | `/var/lib/postural/recordings` |
| Uploaded custom exercise guides | `EXERCISE_VIDEOS_DIR`, preferably `/var/lib/postural/exercise-videos` |
| Backups (nightly at 03:00, never deleted automatically) | `/var/backups/postural/<date_time>` |
| App service, on 127.0.0.1:3000 | `postural-web` (systemd) |
| HTTPS (automatic certificate) | Caddy, `/etc/caddy/Caddyfile` |
| Password tool | `/opt/postural/tools/set-password.mjs` |

Logs: `sudo journalctl -u postural-web`, `sudo journalctl -u caddy`,
`sudo journalctl -u postural-backup`.

## First setup

Run each script as root, in this order, from a machine with this repository (`<ssh>` stands
for `ssh -i <key file> <admin user>@<server>`):

1. `<ssh> "sudo bash -s" < 01_base.sh`: updates, 2 GB swap, the Asia/Manila time zone the
   app's daily scheduling assumes, Node.js 24.12.0, PostgreSQL 18 and Caddy.
2. Copy the code, the clips and the password tool:
   - `git archive --format=tar <revision> web scripts AUTHENTICATION_SETUP.md | <ssh> "sudo mkdir -p /opt/postural/app && sudo tar -x -C /opt/postural/app"`
   - `tar -c -C web/public/demos ex_001-figure-motion.mp4 ex_005-figure-motion.mp4 ex_006-figure-motion.mp4 ex_007-figure-motion.mp4 ex_008-figure-motion.mp4 | <ssh> "sudo mkdir -p /opt/postural/app/web/public/demos && sudo tar -x -C /opt/postural/app/web/public/demos"`
   - `<ssh> "sudo mkdir -p /opt/postural/tools && sudo tee /opt/postural/tools/set-password.mjs >/dev/null" < set-password.mjs`
3. `<ssh> "sudo bash -s -- <full revision>" < 02_app_db.sh`: the service user, generated
   secrets, a fresh database with the SQL scripts in the documented order, the seeded demo
   accounts locked (the demo patient and therapist also archived), the build, and the service.
4. `<ssh> "sudo bash -s" < 03_backup.sh`: the nightly backup, plus one run straight away.
5. Give the server's public IP a DNS name, then
   `<ssh> "sudo bash -s -- <dns name>" < 04_https.sh`: the Caddy site and a rebuild with
   `NEXT_PUBLIC_APP_URL`.
6. Set the admin password; the researcher types it, and it is never shown:
   `ssh -t -i <key file> <admin user>@<server> "sudo -u postural -H bash -c 'set -a; . /etc/postural/env; set +a; node /opt/postural/tools/set-password.mjs admin_001'"`

The first setup leaves email unconfigured. Existing deployments may already have
`SMTP_USER`, `SMTP_PASS` and sender settings in `/etc/postural/env`; preserve them when
updating. Account emails and password-reset codes require that configuration. New accounts
use their first-sign-in password and must change it.

## System email

The system sender and seeded administrator email are `accbpostural.noreply@gmail.com`.

Email was configured on the evaluation server on 2026-10-21. Gmail SMTP
authentication passed and Gmail accepted one self-addressed test message with a
250 response. The user confirmed Gmail inbox receipt on 2026-10-21.

The public Forgot Password APIs were also verified on 2026-10-21 with a disposable
account and the code actually delivered to Gmail. Password reset and new-password
sign-in succeeded; the old password and consumed reset token were refused. The
password-changed notice arrived too. The disposable account and its reset/login
records were removed after verification. This exercised the API/email lifecycle;
the interactive browser form sequence and scheduled notification delivery were not tested.

On an existing database, back up first and run only `scripts/replace_system_email_pg.sql`
as the database owner to change the existing `admin_001` email. It preserves the same
account ID, password and all other fields. Do not rerun the full user seed for this change.
Existing Postural passwords are independent of the Gmail password.

Sending requires all three runtime settings in `/etc/postural/env`: `SMTP_USER` and
`SMTP_FROM` set to the system sender, and `SMTP_PASS` set to that account's Gmail app
password. Without the app password, account emails and password-reset codes are not sent.
Enable 2-Step Verification on the Gmail account before creating an app password. Change
the normal Google password first if needed: doing so afterward revokes app passwords.

Install `deploy/server/05_email.sh` as root-owned
`/usr/local/sbin/postural-configure-email` (mode 755), then run it in an interactive SSH
session with `sudo bash /usr/local/sbin/postural-configure-email`. It reads the app
password at a hidden terminal prompt and verifies Gmail authentication before
changing settings. A rejected credential leaves the settings unchanged. It then
backs up, updates only the SMTP settings,
keeps root:postural 640 permissions and restarts the app. Failed application startup
restores the previous settings. Never put the app password in chat, command arguments
or logs. No application rebuild is needed for runtime email settings.

Afterward, send one self-addressed test email and check both SMTP acceptance and receipt
in the new inbox. A service restart alone does not verify email delivery.

## Updating to a new revision

Copy the new code over `/opt/postural/app` (step 2's first command), then rerun
`02_app_db.sh` with the new revision. It reinstalls packages, rebuilds and restarts; it
leaves the existing database and secrets alone. A change to the database schema needs its
SQL script run by hand (`sudo -u postgres psql -d postural -f <script>`), as on any other
deployment. Take a backup first.

The admin dashboard's User status panel needs `scripts/user_presence_pg.sql` run once on a
database created before it existed:
`sudo -u postgres psql -d postural -f /opt/postural/app/scripts/user_presence_pg.sql`.
Until then the panel says so and the rest of the app works as before.

The unused therapist ID column is removed by `scripts/drop_therapist_id_num_pg.sql`, run once
after a backup: `sudo -u postgres psql -d postural -f /opt/postural/app/scripts/drop_therapist_id_num_pg.sql`.
The app no longer uses the column, so it works the same before and after.

## Optional demo clock

The [demo clock](../../web/docs/demo-clock.md) is off until an admin selects
**Demo Clock → Enable demo tools**. The tab remains visible while off. Leave
`DEMO_CLOCK` unset for normal use. Enable/disable needs no restart or rebuild.

After deploying this version, back up and run the updated
`scripts/demo_clock_settings_pg.sql` as the database owner, including on an
installation that already has the table. The new `enabled` column defaults to
false; an old saved offset does not activate itself. Later reruns preserve the
admin's current choice. Keep the ordinary production start command and
`NODE_ENV=production`.

Enable starts on real time. An admin can then set a simulated date or use the
recorded-date correction form. **Disable demo tools** restores real time and
clears the offset; a later enable starts fresh. All users share that installation's
clock, while local and deployed databases have independent settings. Reminder
emails still use real delivery and the simulated day for selection.

`DEMO_CLOCK=off` is an optional server-level lock. If an existing service has it,
remove that lock and restart once to permit dashboard control; preserve the
environment file's root:postural 640 permissions. Merely setting `DEMO_CLOCK=on`
does not enable the database mode. See the guide for fields that retain real time.

For the optional **Correct a recorded date** control, also run
`scripts/session_date_corrections_pg.sql` as the database owner after the existing
session/occurrence schema. It adds audit storage without changing historical
rows. In demo mode, an admin can move a finished session and its outcome to an
unused compatible day of the same prescription. The form previews the move and
requires a reason; existing notifications/emails are not rewritten or resent.
The guide covers the restrictions and original-context preservation. Corrections
persist after demo mode is disabled.

## Backups

- Run one by hand before and after a session day: `sudo systemctl start postural-backup`.
- Backups include uploaded exercise guides in `exercise-videos/`, with their sizes and hashes in `manifest.json`, as well as session recordings and the database. Restore-check accepts older manifests without guide files. To recover guides, copy that folder back to the configured `EXERCISE_VIDEOS_DIR` and retain ownership by `postural`.
- Copy them to a developer machine regularly, for example
  `scp -r -i <key file> <admin user>@<server>:/var/backups/postural/<date_time> <local backup folder>`.
  Keep them outside the repository and outside cloud-synced folders. They hold patient data
  and videos.
- `npm run backup:local -- --verify <backup> --into <empty database>` checks a backup by
  restoring it (see the checklist). On the server the manifest's `gitRevision` is empty,
  because git is not installed; `APP_REVISION` in the settings file records the revision.
- Old backups are pruned by hand after they have been copied off the server.

## If SSH stops answering

The firewall admits SSH only from one public IPv4 address. If the researcher's home address
changes, update that network security group rule in the Azure portal.
