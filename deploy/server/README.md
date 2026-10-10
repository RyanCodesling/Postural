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

Email is not configured on the server (no `SMTP_*` settings), so account emails and
password-reset codes are not sent. New accounts use their first-sign-in password and must
change it.

## Updating to a new revision

Copy the new code over `/opt/postural/app` (step 2's first command), then rerun
`02_app_db.sh` with the new revision. It reinstalls packages, rebuilds and restarts; it
leaves the existing database and secrets alone. A change to the database schema needs its
SQL script run by hand (`sudo -u postgres psql -d postural -f <script>`), as on any other
deployment. Take a backup first.

## Backups

- Run one by hand before and after a session day: `sudo systemctl start postural-backup`.
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
