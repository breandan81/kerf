#!/bin/sh
# Install / update the Kerf static site. Run on the tau server:  sudo sh ~/install-kerf.sh
# - copies ~/kerf-site to /var/www/kerf (owned by breandan so later deploys need no sudo)
# - adds a kerf.bposhaughnessy.com block to the Caddyfile (once; backs it up first)
# - validates the config and reloads Caddy (other sites keep running)
set -e
SRC=/home/breandan/kerf-site
DST=/var/www/kerf
CF=/etc/caddy/Caddyfile

mkdir -p "$DST"
rsync -a --delete "$SRC"/ "$DST"/
chown -R breandan:breandan "$DST"; find "$DST" -type d -exec chmod 755 {} +; find "$DST" -type f -exec chmod 644 {} +
echo "files installed in $DST"

if ! grep -q "^kerf.bposhaughnessy.com" "$CF"; then
  cp "$CF" "$CF.bak-$(date +%Y%m%d-%H%M%S)"
  cat >> "$CF" <<'CADDY'

kerf.bposhaughnessy.com {
	encode gzip
	root * /var/www/kerf
	file_server

	header {
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		Cache-Control "public, max-age=300"
		-Server
	}
}
CADDY
  echo "added kerf block to $CF (backup saved next to it)"
else
  echo "kerf block already in $CF; files updated only"
fi

caddy validate --config "$CF" --adapter caddyfile
systemctl reload caddy
echo "Caddy reloaded. https://kerf.bposhaughnessy.com (needs the DNS records; certificate is automatic)"
