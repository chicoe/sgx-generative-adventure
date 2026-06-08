# LLM Point-&-Click Engine

Engine + tooling scaffold for a short (5–10 min), keyboard-only point-and-click adventure
(Mac/SCUMM-era style) whose conversations are **adjudicated by an LLM** — the player free-types
an argument and a Gemini model decides the outcome. See [`SPEC.md`](./SPEC.md) for the full build
specification — it is the source of truth.

> **Scaffolding only — no real content yet.** Every scene, image, label, and line of text in this
> repo is a deliberate placeholder ("Scene A", "placeholder behaviour", labeled stand-in art). The
> client authors all real story and assets in the editor; nothing here is final.

Two apps share one content model in a single SvelteKit project:

- **Game runtime** (`/play`) — what the player plays; runs in a Chromium kiosk on a Raspberry Pi.
- **Editor** (`/editor`) — auth-gated authoring tool (not built yet; M4).

## Status

- **M0 — Scaffold** ✓ SvelteKit + TS, Firebase init, security rules, App Hosting config.
- **M1 — Engine + render** ✓ deterministic engine (`src/lib/engine`) with unit tests; a
  parallax, CSS-graded scene at `/play` driven by a hardcoded build, with fade transitions.
  _Remaining acceptance: verify on the actual Raspberry Pi in kiosk mode (hardware needed)._
- **M2 — LLM loop** ✓ `POST /api/converse` + `src/lib/llm/*` (prompt, zod-validated structured
  output, deterministic outcome resolution, backend-agnostic Gemini wrapper) and a keyboard
  dialogue panel in `/play`. Runs the deterministic fallback until a Gemini key is configured.
  _Remaining acceptance: live-model end-to-end (needs a key)._
- M3 Firestore content + publish · M4 editor · M5 polish — not started.

## Develop

```sh
npm install
cp .env.example .env   # fill in for Firebase/Gemini features (not needed for /play yet)
npm run dev            # dev server; visit /play
```

## Verify

```sh
npm test          # engine + schema unit tests (Vitest)
npm run check     # svelte-check type-check
npm run lint      # prettier + eslint
npm run build     # production build (adapter-node)
npm run preview   # serve the production build
```

Run a single test: `npm run test:unit -- --run src/lib/engine/effects.spec.ts` (or `-t "name"`).

### Raspberry Pi kiosk

```sh
chromium --kiosk --noerrdialogs --incognito http://<host>:3000/play
```

Effects are CSS-only (no WebGL) for weak/no-GPU targets. The renderer lives behind a clean
seam (`src/lib/components/SceneRenderer.svelte`) so PixiJS could replace it later.
