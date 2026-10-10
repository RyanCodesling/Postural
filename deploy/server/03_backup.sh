#!/usr/bin/env bash
# Nightly backup on the Postural evaluation server (run as root; safe to rerun).
# A systemd timer runs `npm run backup:local` every night at 03:00 (server time, Asia/Manila)
# into /var/backups/postural/<date_time>: the database dump, a copy of the session videos and
# the manifest. Nothing is deleted automatically; prune old backups by hand after copying them
# to the laptop. Run one by hand any time with: sudo systemctl start postural-backup
set -euo pipefail

cat > /usr/local/bin/postural-backup <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/postural/app/web
exec npm run --silent backup:local -- --out "/var/backups/postural/$(date +%Y-%m-%d_%H%M%S)"
SH
chmod 755 /usr/local/bin/postural-backup

cat > /etc/systemd/system/postural-backup.service <<'UNIT'
[Unit]
Description=Postural backup: database and session videos
After=postgresql.service

[Service]
Type=oneshot
User=postural
Group=postural
EnvironmentFile=/etc/postural/env
ExecStart=/usr/local/bin/postural-backup
UNIT

cat > /etc/systemd/system/postural-backup.timer <<'UNIT'
[Unit]
Description=Nightly Postural backup

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now postural-backup.timer >/dev/null 2>&1
systemctl start postural-backup.service
journalctl -u postural-backup.service -n 3 --no-pager -o cat
ls -1 /var/backups/postural
systemctl list-timers postural-backup.timer --no-pager | head -2
df -h / | tail -1
