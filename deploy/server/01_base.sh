#!/usr/bin/env bash
# Base system for the Postural evaluation server (Ubuntu 24.04, run as root, safe to rerun):
# package updates, 2 GB swap, the Asia/Manila time zone the app's daily scheduling assumes,
# Node.js v24.12.0 (the development laptop's version; official tarball, checksum verified),
# PostgreSQL 18 (the PostgreSQL project's repository; same major version as the laptop, so
# backups move both ways) and Caddy (its official repository) for HTTPS.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold upgrade
apt-get install -y -q curl ca-certificates gnupg xz-utils debian-keyring debian-archive-keyring apt-transport-https

if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

timedatectl set-timezone Asia/Manila

NODE_VERSION=v24.12.0
if ! command -v node >/dev/null || [ "$(node --version)" != "$NODE_VERSION" ]; then
  cd /tmp
  curl -fsSLO "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz"
  curl -fsSLO "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  grep " node-$NODE_VERSION-linux-x64.tar.xz\$" SHASUMS256.txt | sha256sum -c -
  tar -xJf "node-$NODE_VERSION-linux-x64.tar.xz" -C /usr/local --strip-components=1
  rm -f "node-$NODE_VERSION-linux-x64.tar.xz" SHASUMS256.txt
fi

if ! command -v psql >/dev/null || ! psql --version | grep -q ' 18\.'; then
  apt-get install -y -q postgresql-common
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
  apt-get install -y -q postgresql-18
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

echo "node $(node --version), npm $(npm --version)"
psql --version
caddy version
swapon --show --noheadings
echo "time zone $(timedatectl show -p Timezone --value)"
echo "postgres listens on: $(sudo -u postgres psql -tAc 'show listen_addresses')"
