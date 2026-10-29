#!/usr/bin/env bash
# App and fresh database on the Postural evaluation server (run as root; safe to rerun).
#   - System user "postural". Code in /opt/postural/app (copied in beforehand from the
#     repository at the given revision), recordings in /var/lib/postural/recordings,
#     backups in /var/backups/postural, settings in /etc/postural/env (root:postural, 640).
#   - The database password, SESSION_SECRET and EMAIL_ENCRYPTION_KEY are generated here and
#     written only to that settings file; none is printed. Keep a copy of the settings file
#     with the backups: without EMAIL_ENCRYPTION_KEY the stored email addresses cannot be read.
#   - Database "postural" with the project's SQL scripts in the documented order
#     (AUTHENTICATION_SETUP.md, "Required SQL order"). The only seeded account, the admin,
#     gets a random unknown password; the researcher then sets it with set-password.mjs.
#   - npm ci (with the build tools), npm run build, and a systemd service on 127.0.0.1:3000.
set -euo pipefail
REV="${1:?usage: 02_app_db.sh <git revision>}"
APP=/opt/postural/app
ENV=/etc/postural/env
as_app() { sudo -u postural -H bash -c "set -a; . $ENV; set +a; $1"; }

id postural >/dev/null 2>&1 || useradd --system --home-dir /opt/postural --shell /usr/sbin/nologin postural
install -d -m 755 -o postural -g postural /opt/postural
install -d -m 750 -o postural -g postural /var/lib/postural /var/lib/postural/recordings /var/backups/postural
install -d -m 750 -o root -g postural /etc/postural
chown -R postural:postural "$APP" /opt/postural/tools

if [ ! -f "$ENV" ]; then
  DBPASS=$(openssl rand -hex 24)
  SECRET=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n')
  (umask 027; cat > "$ENV" <<EOF
DATABASE_URL=postgresql://postural:${DBPASS}@localhost:5432/postural
SESSION_SECRET=${SECRET}
RECORDINGS_DIR=/var/lib/postural/recordings
NODE_ENV=production
TZ=Asia/Manila
EOF
  )
  chown root:postural "$ENV"
  chmod 640 "$ENV"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postural') THEN CREATE ROLE postural LOGIN; END IF;
END \$\$;
ALTER ROLE postural WITH LOGIN PASSWORD '${DBPASS}';
SQL
  unset DBPASS SECRET
fi
# The email encryption key is generated once (also for settings files written before email
# encryption) and never replaced: a new key would make the stored addresses unreadable.
if ! grep -q '^EMAIL_ENCRYPTION_KEY=' "$ENV"; then
  EMAILKEY=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n')
  echo "EMAIL_ENCRYPTION_KEY=${EMAILKEY}" >> "$ENV"
  unset EMAILKEY
fi
sed -i '/^APP_REVISION=/d' "$ENV"
echo "APP_REVISION=${REV}" >> "$ENV"

as_app "cd $APP/web && npm ci --include=dev --no-audit --no-fund --loglevel=error"

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'postural'" | grep -q 1; then
  sudo -u postgres createdb postural
  for f in user_credentials_pg exercises_pg patient_exercises_pg exercise_programs_pg sessions_pg \
           exercise_occurrences_pg email_features reset_token_migration notifications_pg; do
    echo "running $f.sql"
    sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d postural -f "$APP/scripts/$f.sql"
  done
  # The admin stays active, with an unknown password until the researcher sets one.
  as_app "node /opt/postural/tools/set-password.mjs admin_001 --lock"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d postural -c "UPDATE users SET is_archived = FALSE, archived_at = NULL WHERE id = 'admin_001'"
fi

as_app "cd $APP/web && npm run build"

cat > /etc/systemd/system/postural-web.service <<'UNIT'
[Unit]
Description=Postural web app
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=postural
Group=postural
WorkingDirectory=/opt/postural/app/web
EnvironmentFile=/etc/postural/env
ExecStart=/usr/local/bin/node /opt/postural/app/web/node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable postural-web >/dev/null 2>&1
systemctl restart postural-web

for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login || true)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "login page HTTP ${code}"
echo "worker bundle: $(stat -c %s $APP/web/public/workers/trend-fit.js 2>/dev/null || echo missing) bytes"
sudo -u postgres psql -tA -d postural -c "SELECT count(*) || ' tables' FROM information_schema.tables WHERE table_schema = 'public'"
sudo -u postgres psql -tA -d postural -c "SELECT id || ' ' || role || ' archived=' || is_archived || ' plaintext=' || (password NOT LIKE '\$2%') FROM users ORDER BY id"
systemctl is-active postural-web
