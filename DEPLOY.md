# Deploying to Firebase App Hosting

The app is SSR (SvelteKit `adapter-node` + the server-only `/api/converse`), so it
runs on **Firebase App Hosting** (not classic static Hosting). App Hosting builds
from a connected GitHub branch and redeploys on every push.

Config already prepared in `apphosting.yaml`:

- `PUBLIC_FIREBASE_CONFIG` — the browser-safe web config (BUILD + RUNTIME).
- `GEMINI_MODEL`, `EDITOR_ALLOWED_EMAILS` — runtime values.
- `GEMINI_API_KEY` — pulled from Cloud Secret Manager (set in step 2).

Prereqs: a Blaze-billing project (✓ `sgx-generative-adventure`) and `firebase`
CLI logged in (`firebase login`).

## 1. Commit & push the config

App Hosting builds **the whole branch** from GitHub, so commit everything you want
live (all the app code, plus the filled-in `apphosting.yaml` and `scripts/`):

```bash
git add -A
git commit -m "Deploy: App Hosting config + Pi kiosk scripts"
git push origin main
```

## 2. Store the Gemini key as a secret

```bash
firebase apphosting:secrets:set GEMINI_API_KEY --project sgx-generative-adventure
# Paste the key when prompted. Say "yes" to granting the backend access.
```

## 3. Create the backend (one-time, interactive)

```bash
firebase apphosting:backends:create --project sgx-generative-adventure
```

It walks you through:

- **Region** — pick one near you (e.g. `europe-west4`). It can differ from the
  Firestore region; latency is the only cost.
- **GitHub** — authorize the Firebase GitHub app and pick
  `chicoe/sgx-generative-adventure`.
- **Branch** — `main` (this becomes the live branch).
- **Root directory** — `/`.

It then runs the first build + rollout and prints the public URL
(`https://<backend>--sgx-generative-adventure.<region>.hosted.app`).

## 4. Let Firebase Auth trust the new domain

The editor signs in with Firebase Auth, which only works on authorized domains.
In the console → **Authentication → Settings → Authorized domains**, add the App
Hosting domain from step 3 (the `*.hosted.app` URL). Without this, `/editor`
login fails on the deployed site (the game `/play` is unaffected).

## 5. Deploying again

Just push — App Hosting auto-builds the connected branch:

```bash
git push origin main
```

Or trigger one manually:

```bash
firebase apphosting:rollouts:create <backend-id> --project sgx-generative-adventure
```

## Changing the Gemini API key (e.g. switch to the client's)

The key lives in three independent places — update whichever apply. Swapping to a
key from a different Google account/project is fine; it's just another Developer
API key (make sure that account has billing/quota, or the server logs
`RESOURCE_EXHAUSTED`).

**1. Production (App Hosting).** The key is a Secret Manager secret. Add a new
version, then roll out so the backend picks it up:

```bash
firebase apphosting:secrets:set GEMINI_API_KEY --project sgx-generative-adventure
# paste the new key when prompted
firebase apphosting:rollouts:create <backend-id> --project sgx-generative-adventure
# (or just `git push origin main` — any rollout adopts the new version!)
```

The previous secret version stays in Secret Manager; disable or destroy it in the
console once the new rollout is live. Access granted to the backend carries over
to new versions, so there's nothing else to re-authorize.

**2. Local dev.** Edit `GEMINI_API_KEY=` in `.env` and restart `npm run dev`.

**3. Raspberry Pi.** Edit `GEMINI_API_KEY=` in the Pi's `.env`, then restart the
kiosk — no rebuild, the server reads the key at runtime:

```bash
sudo systemctl restart sgx-kiosk
```

(Changing the model is the same idea but simpler — `GEMINI_MODEL` is a plain value
in `apphosting.yaml` / `.env`, not a secret: edit it and redeploy / restart.)

## Notes

- **Firestore/Storage rules** deploy separately (already live): re-run after any
  rule change with `firebase deploy --only firestore:rules,storage:rules`.
- **Editing `apphosting.yaml` env** takes effect on the next rollout (push).
  Changing a **secret value** needs `firebase apphosting:secrets:set` again, then
  a rollout.
- **Cost:** `minInstances: 0` means it scales to zero when idle (cold starts), so
  it's cheap to leave up. Bump `minInstances` to 1 in `apphosting.yaml` if you
  want the first load to always be warm.
