#!/usr/bin/env bash
#
# Raspberry Pi kiosk launcher for the Retro LLM Adventure.
#
# Boots the local production server (SvelteKit adapter-node) and opens Chromium
# full-screen on the game (/play). Meant to run on boot — see sgx-kiosk.service.
#
# One-time setup on the Pi (Raspberry Pi OS with desktop):
#   sudo apt install -y chromium-browser unclutter curl   # "chromium" on Bookworm
#   cd <repo> && npm ci && npm run build                  # build WITH .env present
#   cp .env.example .env && nano .env                     # fill the keys
#   sudo raspi-config  ->  Display Options -> Screen Blanking -> Off
#
set -euo pipefail

# --- config (override via the environment) ----------------------------------
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
PORT="${PORT:-3000}"
# The ?kiosk tag turns on up-front media preloading (everything cached behind
# the loading screen). Non-kiosk visitors (no tag) load assets on demand.
URL="${KIOSK_URL:-http://localhost:${PORT}/play?kiosk=1}"

cd "$APP_DIR"

# --- load server env, then start the game server ----------------------------
# adapter-node honours HOST/PORT. The server reads GEMINI_API_KEY (and the public
# Firebase config) from .env; export them for this process only. Bind to
# localhost so the server isn't reachable from the network.
if [ -f "$APP_DIR/.env" ]; then
	set -a
	# shellcheck disable=SC1091
	. "$APP_DIR/.env"
	set +a
fi

HOST=127.0.0.1 PORT="$PORT" node build/index.js &
SERVER_PID=$!

PROFILE="$(mktemp -d)"
cleanup() {
	kill "$SERVER_PID" 2>/dev/null || true
	rm -rf "$PROFILE" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- wait until the server answers ------------------------------------------
echo "kiosk: waiting for the server on port $PORT …"
for _ in $(seq 1 60); do
	if curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then break; fi
	sleep 1
done

# --- keep the screen awake + hide the cursor (X11; no-ops elsewhere) ---------
xset s off 2>/dev/null || true
xset -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true
command -v unclutter >/dev/null 2>&1 && unclutter -idle 0 &

# --- launch Chromium in kiosk mode ------------------------------------------
# chromium-browser on Bullseye, chromium on Bookworm.
BROWSER="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "$BROWSER" ]; then
	echo "kiosk: Chromium not found — install chromium-browser (or chromium)" >&2
	exit 1
fi

"$BROWSER" \
	--kiosk "$URL" \
	--user-data-dir="$PROFILE" \
	--noerrdialogs \
	--disable-infobars \
	--disable-session-crashed-bubble \
	--disable-translate \
	--no-first-run \
	--check-for-update-interval=31536000 \
	--overscroll-history-navigation=0 \
	--disable-pinch \
	--autoplay-policy=no-user-gesture-required

# Chromium exited → cleanup() stops the server (systemd will restart us).
