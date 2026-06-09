# Raspberry Pi kiosk

Runs the game full-screen on a Pi: a local Node server (`/play`) opened in a
Chromium kiosk window on boot. The Pi still needs **internet** (Firestore for the
active build, Gemini for the computer's replies).

## Files

- `kiosk.sh` — starts the local server and opens Chromium full-screen on `/play`.
- `sgx-kiosk.service` — systemd unit that runs `kiosk.sh` on boot.

## One-time setup

1. **OS:** Raspberry Pi OS **with desktop**, set to **Desktop Autologin**
   (`sudo raspi-config` → System Options → Boot/Auto Login). On Pi 4/5 (Bookworm)
   either Wayland or X11 works; X11 is simplest for the systemd unit below.

2. **Packages** (Node 18+, Chromium, helpers):

   ```bash
   sudo apt update
   sudo apt install -y git nodejs npm chromium-browser unclutter curl
   # On Bookworm the package is "chromium" (the script finds either).
   ```

3. **Get + build the app** (the build embeds the public Firebase config, so `.env`
   must exist _before_ building):

   ```bash
   git clone https://github.com/chicoe/sgx-generative-adventure.git
   cd sgx-generative-adventure
   cp .env.example .env && nano .env      # fill GEMINI_API_KEY + PUBLIC_FIREBASE_CONFIG
   npm ci
   npm run build
   ```

   `.env` must have at least `GEMINI_API_KEY` and `PUBLIC_FIREBASE_CONFIG`
   (`FIREBASE_ADMIN_CREDENTIALS` can stay blank — the runtime uses the client SDK).

4. **Stop screen blanking:** `sudo raspi-config` → Display Options → Screen Blanking → Off.

5. **Try it once** (from the repo root, inside the desktop session):

   ```bash
   ./scripts/kiosk.sh
   ```

   You should get the amber boot screen, then the game. `Ctrl-C` (or Alt-F4) exits.

## Run on boot (systemd)

Edit `sgx-kiosk.service` if your user isn't `pi` or the repo isn't at
`/home/pi/sgx-generative-adventure`, then:

```bash
sudo cp scripts/sgx-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sgx-kiosk.service
journalctl -u sgx-kiosk -f      # watch the logs
```

Reboot to confirm it comes up on its own.

## Knobs

`kiosk.sh` reads these from the environment (defaults in parentheses):

- `PORT` (`3000`) — local server port.
- `KIOSK_URL` (`http://localhost:$PORT/play`) — point it at the deployed App
  Hosting URL instead if you'd rather not run the server locally.
- `APP_DIR` (repo root) — where the build + `.env` live.

## Notes / troubleshooting

- **Black screen, no window:** the service can't reach the X display. Confirm the
  desktop auto-logs-in and that `DISPLAY` / `XAUTHORITY` in the unit match the
  logged-in user.
- **Blank/placeholder game (amber LED):** no build is published yet, or the Pi's
  `.env` has the wrong `PUBLIC_FIREBASE_CONFIG`. Publish from the editor and make
  sure the config matches the project.
- **Computer never replies:** the Pi can't reach Gemini — check internet and that
  `GEMINI_API_KEY` is in `.env` (and rebuild isn't needed for that; it's runtime).
- **Updating content** doesn't need a Pi rebuild — publish from the editor and the
  Pi picks up the new active build on its next load/restart. Only a code change
  needs `git pull && npm run build` + `sudo systemctl restart sgx-kiosk`.
