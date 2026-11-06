#!/usr/bin/env bash
# Run interactively as root on the evaluation server. The app password is read
# only from the terminal and written only to the server settings file.
set +x
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then
  echo 'Run with sudo bash /usr/local/sbin/postural-configure-email' >&2
  exit 1
fi

ENV=/etc/postural/env
SENDER=accbpostural.noreply@gmail.com
[ -f "$ENV" ] || { echo 'Server settings file is missing' >&2; exit 1; }
password=''
staged=''
cleanup() {
  unset password
  if [ -n "$staged" ]; then rm -f -- "$staged"; fi
}
trap cleanup EXIT

printf 'Gmail app password for %s: ' "$SENDER" >/dev/tty
IFS= read -r -s password </dev/tty
printf '\n' >/dev/tty
password=${password//[[:space:]]/}
if [[ ! "$password" =~ ^[a-zA-Z0-9]{16}$ ]]; then
  echo 'Expected the 16-character Gmail app password; settings were not changed.' >&2
  exit 1
fi

# Verify Gmail before changing settings. The password goes only through stdin;
# it is never a command argument, and SMTP debugging is disabled.
auth_check=$(cat <<'NODE'
const fs = require('node:fs');
const nodemailer = require('nodemailer');
const transport = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  requireTLS: true,
  auth: { user: process.argv[1], pass: fs.readFileSync(0, 'utf8') },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
  logger: false,
  debug: false,
});
(async () => {
  try {
    await transport.verify();
    console.log('Gmail SMTP authentication verified.');
  } catch (error) {
    console.error('Gmail SMTP authentication failed: ' +
      String(error.code || 'unknown') + ', response ' +
      String(error.responseCode || 'unavailable') + '. Settings unchanged.');
    process.exitCode = 1;
  } finally {
    transport.close();
  }
})();
NODE
)
if ! printf '%s' "$password" | (
  cd /opt/postural/app/web
  sudo -u postural -H /usr/local/bin/node -e "$auth_check" "$SENDER"
); then
  exit 1
fi

systemctl start postural-backup
backup="${ENV}.before-email.$(date -u +%Y%m%dT%H%M%SZ).$$"
install -m 600 -o root -g root "$ENV" "$backup"
staged=$(mktemp /etc/postural/env.email.XXXXXXXX)
awk '!/^(SMTP_USER|SMTP_FROM|SMTP_PASS)=/' "$ENV" >"$staged"
printf '\nSMTP_USER=%s\nSMTP_FROM=%s\nSMTP_PASS=%s\n' "$SENDER" "$SENDER" "$password" >>"$staged"
unset password
chown root:postural "$staged"
chmod 640 "$staged"
mv -f -- "$staged" "$ENV"
staged=''

restore_settings() {
  install -m 640 -o root -g postural "$backup" "$ENV"
  systemctl restart postural-web || true
  echo 'Previous settings restored because the application did not restart cleanly.' >&2
}
if ! systemctl restart postural-web; then
  restore_settings
  exit 1
fi
for attempt in $(seq 1 30); do
  code=$(curl --max-time 2 -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login || true)
  if [ "$code" = 200 ]; then
    echo "Email settings installed for $SENDER; service active; login HTTP 200."
    echo 'SMTP delivery still needs the self-test described in the server README.'
    exit 0
  fi
  sleep 1
done
restore_settings
exit 1
