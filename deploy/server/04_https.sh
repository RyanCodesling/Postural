#!/usr/bin/env bash
# HTTPS for the Postural evaluation server (run as root; safe to rerun).
# Caddy serves the Azure DNS name with an automatic Let's Encrypt certificate and proxies to
# the app on 127.0.0.1:3000. The app is rebuilt with NEXT_PUBLIC_APP_URL set to that address
# (used for links in emails).
set -euo pipefail
HOST="${1:?usage: 04_https.sh <host name>}"
ENV=/etc/postural/env

cat > /etc/caddy/Caddyfile <<EOF
${HOST} {
	reverse_proxy 127.0.0.1:3000
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy

sed -i '/^NEXT_PUBLIC_APP_URL=/d' "$ENV"
echo "NEXT_PUBLIC_APP_URL=https://${HOST}" >> "$ENV"
sudo -u postural -H bash -c "set -a; . $ENV; set +a; cd /opt/postural/app/web && npm run build" > /var/log/postural-build.log 2>&1
systemctl restart postural-web
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login || true)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "app login page HTTP ${code}"
for i in $(seq 1 30); do
  if journalctl -u caddy --since "-5 min" --no-pager -o cat | grep -q "certificate obtained successfully"; then
    echo "certificate obtained"
    break
  fi
  sleep 3
done
journalctl -u caddy --since "-5 min" --no-pager -o cat | grep -i -E "certificate|error" | tail -3
