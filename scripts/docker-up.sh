#!/bin/sh
# Starts hub + Jellyfin with this computer's LAN address, so the TV and phones can reach both.
set -e
cd "$(dirname "$0")/.."

ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$ip" ]; then
  echo "Could not find the LAN address; set HUB_PUBLIC_URL and JELLYFIN_URL yourself." >&2
  exit 1
fi

mkdir -p data media
export HUB_PUBLIC_URL="${HUB_PUBLIC_URL:-http://$ip:8090}"
export JELLYFIN_URL="${JELLYFIN_URL:-http://$ip:8096}"
docker compose up -d --build "$@"
echo
echo "aTV (TV app):   $HUB_PUBLIC_URL/"
echo "Phone remote:   $HUB_PUBLIC_URL/remote.html"
echo "Jellyfin:       $JELLYFIN_URL/"
