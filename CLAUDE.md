# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

**M0–M4 are done; M5 (polish) is next.** The project is a single SvelteKit + TypeScript app (Svelte 5 runes forced on, `adapter-node`, Vitest/Prettier/ESLint). `SPEC.md` ("Retro LLM Adventure — Build Specification") is the authoritative source of truth — follow the milestone order in §9 (M0 scaffold ✓ → M1 engine+render ✓ → M2 LLM loop ✓ → M3 Firestore publish ✓ → M4 editor ✓ → M5 polish). Where the spec says `ASSUMPTION`, that is a default you may proceed on; flag it if it conflicts with something you discover.

**Placeholder-only content.** This is scaffolding: the client supplies ALL real story, text, images, and assets later (via the editor). Keep every in-repo text and image an obvious stand-in (`Scene A`, `placeholder behaviour`, `[ placeholder intro ]`, labeled "missing asset" art) — never invent narrative, characters, or finished-looking art. The cruise-ship premise in `SPEC.md` only illustrates the mechanic; do not ship it as content. Demo content lives in `src/lib/game/placeholderBuild.ts` and `static/placeholder/`.

What exists so far:

- **M0:** Firebase init (`src/lib/firebase/client.ts`, `admin.ts`), security rules (`firestore.rules`, `storage.rules`), `apphosting.yaml`, `.env.example`, retro hello page.
- **M1:** the deterministic engine — `src/lib/engine/{types,effects,graph,state}.ts` (pure, fully unit-tested, `*.spec.ts` beside each); `SceneRenderer.svelte` (the rendering seam); a hardcoded build rendered at `/play` with parallax + CSS grade + fade transitions. Demo content is `src/lib/game/placeholderBuild.ts` + `static/placeholder/` (see placeholder rule above).
- **M2:** the LLM loop — `src/lib/llm/`: `outcome.ts` (zod response schema), `prompt.ts` (prompt builder), `adjudicate.ts` (pure outcomeId→effects resolution + deterministic fallback), and **server-only** `gemini.ts` (backend-agnostic: developer-key or Vertex/ADC via `GEMINI_BACKEND`). Endpoint `POST /api/converse`. Pure modules unit-tested; live model verified working. **`/play` is terminal-first / LLM-driven:** a persistent text terminal (no action buttons) where the computer **speaks first** (converse `opening:true` mode — greets, applies no effects) and the player types. **Scene context:** the request carries `sceneContext` (the scene's `prompt` + available exits + inventory), which `prompt.ts` injects so the computer converses in situ. **LLM navigation + plain conversation:** the endpoint augments the behaviour via `withSyntheticOutcomes` with (a) a neutral **`__none__`** "no change, just reply" outcome — so ordinary chat doesn't fire authored effects — and (b) one granted **`exit:<toSceneId>`→`goToScene`** outcome per available exit. `prompt.ts` instructs the model it may use ONLY the listed exits (decline anything else — no inventing destinations) and to default to `__none__`. Synthesized outcomes carry no behaviour-level effects (`isSyntheticOutcomeId`); exit targets come from the scene's real exits, never invented. Invariant #1 holds (the model only picks an `outcomeId`; the engine applies authored effects). The ship computer is **`build.meta.defaultBehaviourId`** (picked on the editor dashboard; falls back to the first behaviour) — one computer active in every scene, with per-scene flavour from `scene.prompt`. **Behaviour-on-hotspot was dropped**; the scene editor no longer edits hotspots (the `Scene.hotspots` field stays in the model/engine but is unused by the editor & runtime). Requires ≥1 behaviour in the build. **Starts & endings:** `startGame`/`pickStartScene` choose a **random** scene flagged `Scene.start` (fallback `meta.startSceneId` → first scene); reaching a `Scene.ending` scene shows "THE END" and **restarts** (`/play`) after 3 min or on any input. Both flags are toggled with checkboxes in the scene editor; the graph badges them (★ start / ⏹ end).
- **M3:** Firestore content model — `src/lib/content/`: `schema.ts` (zod for all content, drift-checked against `placeholderBuild`), `build.ts` (pure `assembleBuild` with referential-integrity checks + `serialize/deserializeBuild`), `loader.ts` (client-SDK read of `config/current`→`builds/{id}`, **falls back to `placeholderBuild`**). `/play` loads the active build on mount. Builds are stored as one doc with a JSON `payload` (single read). Draft layout: `draft/content` (+ `scenes`/`items`/`behaviours` subcollections).
- **M4:** the editor at `/editor` (client-only, `ssr=false`). Auth via Firebase Email/Password (`src/lib/firebase/auth.svelte.ts` reactive store); `+layout.svelte` shows a login gate then the editor. `src/lib/content/draft.ts` (draft CRUD, undefined-safe via JSON round-trip) + `publishClient.ts` (**client-side** atomic publish/rollback — validates with `assembleBuild`, then batches `builds/{id}` + `config/current`; gated by `firestore.rules` where editors can _create_ builds and write config, builds stay immutable). Done: **dashboard** (seed→publish→rollback), **scenes editor** (layers + **image upload** via `src/lib/firebase/storage.ts`, filter, `prompt`, onEnter effects, start/ending checkboxes; exits are on the graph, not here), **items editor**, **behaviour editor** + **live test panel**. Reusable `EffectsEditor.svelte` + `ConditionsEditor.svelte` (hasItem/flag AND-combined; or/not not surfaced yet). `SceneRenderer` resolves absolute URLs (Storage) as-is. `/api/converse` takes an inline `behaviour` (test panel) or resolves `behaviourId` from the **active build**. The **Svelte Flow scene graph** at `/editor/graph` (`@xyflow/svelte`, dark mode) **owns exits**: custom `SceneNode` shows a stacked preview of the scene's layer art (★ = start); dragging between nodes adds an exit (label defaults to the target scene's name); **clicking an edge** opens an inline editor to rename/remove that exit (Backspace also removes); node-click deep-links to the scene editor (`?scene=id`); a "new scene" control creates one; node layout is **persisted** to `graphPositions` on the `draft/content` doc (editor-only, not in the build). The **scene form no longer edits exits** (only the graph does) — note: exit `condition`s have no UI yet (they persist if present). `firestore.rules` + `storage.rules` are deployed. Editor flows need a signed-in allowlisted editor (can't be fully tested headlessly).

Outstanding acceptance items: M1's on-Pi kiosk verification (hardware; owner runs it); the editor authoring UI's full live click-through. **M5 (polish)** not started: transitions/audio hooks, keyboard UX, retro grade, Pi perf pass, network-failure handling, and **save/resume** across power-cycle (`saves/{sessionId}` — rules already allow it).

## What this project is

A short retro point-and-click adventure (Mac/SCUMM-era style) where the player is trapped on a cruise ship and escapes by **free-typing arguments to the ship's computer**. A Gemini LLM adjudicates each argument. Two apps share one content model in a single SvelteKit project:

- **Game runtime** (`/play`) — keyboard-only, runs in a Chromium kiosk on a Raspberry Pi.
- **Editor** (`/editor`) — auth-gated authoring tool for a non-technical client to build scenes/items/scene-graph/LLM behaviours, then publish.

## Tech stack (fixed by spec §2)

SvelteKit + TypeScript + Svelte 5 runes · Firebase App Hosting (Node buildpack) · Cloud Firestore (content + state) · Firebase Storage (images) · Firebase Auth (editor only) · Gemini via `@google/genai` (server-side only, model id from `GEMINI_MODEL`) · `@xyflow/svelte` (scene-graph editor) · `zod` (both Gemini structured-output schemas and Firestore validation).

## Architecture invariants (do not violate)

These are the load-bearing rules that the whole design depends on:

1. **The LLM never invents game-state changes.** The model picks exactly one `outcomeId` from the behaviour's authored `allowedOutcomes` (constrained via Gemini structured output / `responseSchema` enum) and writes prose. The **engine**, not the model, applies that outcome's `Effect[]`. This is what keeps consequences deterministic while dialogue stays fluid.

2. **`lib/engine/*` and `lib/content/schema.ts` must stay free of Svelte and Firebase imports** so they remain pure and unit-testable in isolation. Game logic (state reducer, condition evaluation, effect application, graph traversal) lives here as framework-agnostic TS.

3. **Gemini is server-only.** `GEMINI_API_KEY` lives in server env and must never reach the client bundle. All LLM calls go through `POST /api/converse` (`src/routes/api/converse/+server.ts`).

4. **The game reads only the active immutable build.** Content has two worlds in Firestore: mutable `draft/*` (editor working copies) and immutable `builds/{buildId}` snapshots. The game reads `config/current.activeBuildId` → that build only. **Publish** validates all drafts with zod, writes a new build, and atomically flips `config/current` — so editing drafts can never break the live game. Prior builds are kept for rollback.

5. **Deterministic core = Conditions + Effects.** `Condition` (hasItem/flag/and/or/not) gates availability; `Effect` (setFlag/addItem/removeItem/goToScene/showText) mutates state. `applyEffects(state, effects)` and `evaluate(condition, state)` are pure functions.

6. **`/api/converse` must never hang the game.** `gemini.ts` uses a ~12s timeout with **one retry** (and tolerates code-fenced JSON). On persistent error/timeout/schema-invalid output, return a canned in-character line + the most restrictive `granted:false` outcome (spec §5.4). The catch logs `[converse] Gemini call failed: <message>` — check the server console to see the real cause (e.g. `RESOURCE_EXHAUSTED` = rate limit).

7. **Keyboard-only, CSS-only rendering in v1.** No mouse/touch dependence. Scene = stack of absolutely-positioned `<img>` layers with CSS-transform parallax and CSS filter grades — **no WebGL/PixiJS in v1**. Keep a clean `SceneRenderer.svelte` seam so PixiJS can replace it later without touching engine logic. Target is a weak/no-GPU Raspberry Pi in Chromium kiosk.

## Intended layout (per spec §3)

```
src/lib/engine/      # pure TS: state.ts, graph.ts, effects.ts, types.ts
src/lib/content/     # schema.ts (zod), loader.ts (load build), build.ts (publish/snapshot)
src/lib/firebase/    # client.ts (browser SDK), admin.ts (server-only admin SDK)
src/lib/llm/         # gemini.ts, prompt.ts, outcome.ts  — all server-only
src/routes/play/     # game runtime
src/routes/editor/   # auth-gated; +layout.server.ts is the auth guard; writes to draft/*
src/routes/api/converse/+server.ts
```

## Commands

- `npm run dev` — dev server.
- `npm run build` — production build (`adapter-node`); `npm run preview` to serve it.
- `npm run check` — `svelte-check` type-check (run after edits).
- `npm run lint` — `prettier --check` + ESLint. `npm run format` to auto-fix.
- `npm test` — Vitest once (`passWithNoTests` is on so the pipeline stays green between milestones). `npm run test:unit` to watch.
- Single test: `npm run test:unit -- --run path/to/file.spec.ts` (or `-t "name"`).

Per spec §9, **every milestone must include unit tests for `src/lib/engine` and `src/lib/content/schema.ts`.** Note: this project uses **zod v4** and the new **`@google/genai`** SDK — use their current APIs, not v3/legacy ones.

## Gotchas

- **Never name a variable `state` in a `.svelte` component that also uses the `$state` rune.** `svelte-check` parses `$state(...)` as a legacy store subscription of a variable named `state` and throws confusing errors ("$state used before its declaration"), even though `vite build` compiles fine. Use `game`, `model`, etc. (see `src/routes/play/+page.svelte`).
- Internal links must use `resolve()` from `$app/paths` (e.g. `href={resolve('/play')}`) — the `svelte/no-navigation-without-resolve` lint rule enforces it.
- `npm test` has `passWithNoTests` on (vite.config.ts) so the pipeline stays green between milestones; this does not excuse skipping the per-milestone engine/schema tests.

## Environment (spec §8)

Provide `.env.example`. Keys: `GEMINI_API_KEY` (server only), `GEMINI_MODEL` (default `gemini-flash-lite`), `PUBLIC_FIREBASE_CONFIG` (public client config), `FIREBASE_ADMIN_CREDENTIALS` (server), `EDITOR_ALLOWED_EMAILS` (comma-separated editor allowlist).
