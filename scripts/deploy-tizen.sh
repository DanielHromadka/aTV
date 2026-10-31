#!/bin/sh
# Builds aTV for Tizen, signs it with your Samsung certificate profile and installs and starts it
# on the TV. Needs Tizen Studio (CLI is enough) and a Samsung TV certificate profile (README).
#   TV_IP=192.168.0.106 TIZEN_PROFILE=atv sh scripts/deploy-tizen.sh
set -e
cd "$(dirname "$0")/.."

TV_IP="${TV_IP:-192.168.0.106}"
PROFILE="${TIZEN_PROFILE:-atv}"
TIZEN_HOME="${TIZEN_HOME:-$HOME/tizen-studio}"
SDB="$TIZEN_HOME/tools/sdb"
TIZEN="$TIZEN_HOME/tools/ide/bin/tizen"
APP_ID="aTVattoSft.aTV"

for tool in "$SDB" "$TIZEN"; do
  [ -x "$tool" ] || { echo "Missing $tool: install Tizen Studio or set TIZEN_HOME." >&2; exit 1; }
done

# The packaged app runs from the TV, so it needs this computer's address to find the hub.
ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I | awk '{print $1}')
export VITE_HUB_URL="${VITE_HUB_URL:-http://$ip:8090}"
echo "Hub for the TV app: $VITE_HUB_URL"

npm run build:tizen

serial="$TV_IP:26101"
"$SDB" connect "$serial"
"$SDB" devices | grep -q "^$serial" || { echo "TV not connected: is Developer Mode on with Host PC IP $ip?" >&2; exit 1; }

rm -f build/tizen/*.wgt
"$TIZEN" package -t wgt -s "$PROFILE" -- build/tizen
wgt=$(ls build/tizen/*.wgt | head -1)
"$TIZEN" install -n "$(basename "$wgt")" -s "$serial" -- build/tizen
"$TIZEN" run -p "$APP_ID" -s "$serial"
echo "aTV is running on the TV."
