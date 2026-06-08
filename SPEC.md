# Retro LLM Adventure — Build Specification

_Implementation spec for a coding agent (Claude Code). Read top to bottom, then build in the order under "Milestones." Where this doc says ASSUMPTION, that's a default decision you may proceed on; flag it if it conflicts with something you discover._

---

## 1. Product summary

A short (5–10 minute) retro point-and-click adventure inspired by old Mac/SCUMM-era games. The player is trapped on a multi-planet cruise ship and interacts with the ship's **computer** to escape. The defining mechanic: the player **free-types arguments** to the computer, and a **Gemini LLM adjudicates** whether to grant dangerous/restricted actions, returning both the computer's reply and the resulting game-state changes.

Two apps share one content model:

1. **Game runtime** — what the player plays. Runs in a Chromium kiosk on a Raspberry Pi, keyboard-only.
2. **Editor** — a web tool for a non-technical client to author scenes, items, the scene graph, and LLM behaviours, then publish.

Content and state live in **Firestore**. Gemini is called **server-side only**.

### Non-goals (do not build)

- No mouse/touch dependence (keyboard-only; design every interaction for keyboard).
- No multiplayer, no accounts for players, no leaderboards.
- No complex inventory combinatorics or pixel-hunting; keep mechanics minimal.
- No WebGL/PixiJS in v1 — effects are CSS (see §6). Leave a clean seam to add PixiJS later.
- No offline mode for the LLM (the game requires the server).

---

## 2. Tech stack (fixed)

- **Frontend**: SvelteKit (latest stable), TypeScript, Svelte 5 runes.
- **Hosting**: Firebase App Hosting (Node buildpack — no custom adapter needed).
- **Data**: Cloud Firestore.
- **Asset storage**: Firebase Storage (scene/item images).
- **Auth (editor only)**: Firebase Auth (email/password or Google; editor routes gated).
- **LLM**: Gemini via the `@google/genai` SDK, called from SvelteKit server endpoints. Default model `gemini-flash-lite` tier (cheap/fast, supports structured output + function calling). Make the model id an env var.
- **Scene-graph editor UI**: `@xyflow/svelte` (Svelte Flow).
- **Validation**: `zod` for both Gemini structured-output schemas and Firestore document validation.

ASSUMPTION: single SvelteKit project, one Firebase project, game at routes under `/play`, editor under `/editor`. Not a multi-repo split.

---

## 3. Repository layout

```
src/
  lib/
    engine/            # framework-agnostic game logic (pure TS, unit-testable)
      state.ts         # GameState, reducer, flag/inventory ops
      graph.ts         # scene-graph traversal + transition conditions
      effects.ts       # apply Effect[] to GameState
      types.ts         # shared content + state types (see §4)
    content/
      schema.ts        # zod schemas for every content type
      loader.ts        # load a published Build from Firestore
      build.ts         # publish/snapshot logic
    firebase/
      client.ts        # browser SDK init
      admin.ts         # server-only admin SDK init
    llm/
      gemini.ts        # server-only Gemini wrapper
      prompt.ts        # build system+user prompt from an LLMBehaviour
      outcome.ts       # zod schema for the structured response (see §5)
    components/        # shared Svelte components
  routes/
    play/              # GAME runtime
      +page.svelte
      [..]
    editor/            # EDITOR (auth-gated)
      +layout.server.ts   # auth guard
      scenes/
      items/
      graph/           # Svelte Flow canvas
      behaviours/
      publish/
    api/
      converse/+server.ts # POST: player turn -> Gemini -> Outcome (server-only)
static/
tests/
```

Keep `lib/engine` and `lib/content/schema.ts` free of Svelte/Firebase imports so they're unit-testable in isolation.

---

## 4. Content & state data model

All content types in `lib/engine/types.ts`, with matching `zod` schemas in `lib/content/schema.ts`. Firestore structure under §4.6.

### 4.1 Scene

```ts
interface SceneLayer {
	id: string;
	imagePath: string; // Firebase Storage path
	z: number; // stacking order, 0 = back
	parallaxFactor: number; // 0 = static, 1 = full movement
}
interface Hotspot {
	id: string;
	label: string; // shown for keyboard selection
	// a hotspot triggers effects and/or a transition and/or opens dialogue
	effects?: Effect[];
	goToSceneId?: string;
	behaviourId?: string; // open an LLM/dialogue exchange
	condition?: Condition; // only available if met
}
interface Scene {
	id: string;
	name: string;
	layers: SceneLayer[];
	filter?: FilterSpec; // CSS grade applied over the stack (see §6)
	hotspots: Hotspot[];
	exits: Exit[]; // navigable transitions (subset shown in graph)
	onEnter?: Effect[];
	introText?: string; // optional narration shown on enter
}
interface Exit {
	id: string;
	toSceneId: string;
	label: string;
	condition?: Condition;
}
```

### 4.2 Item

```ts
interface Item {
	id: string;
	name: string;
	iconPath: string;
	description: string;
}
```

### 4.3 Conditions & Effects (the deterministic core)

```ts
type Condition =
	| { type: 'hasItem'; itemId: string }
	| { type: 'flag'; key: string; equals: string | number | boolean }
	| { type: 'and'; all: Condition[] }
	| { type: 'or'; any: Condition[] }
	| { type: 'not'; cond: Condition };

type Effect =
	| { type: 'setFlag'; key: string; value: string | number | boolean }
	| { type: 'addItem'; itemId: string }
	| { type: 'removeItem'; itemId: string }
	| { type: 'goToScene'; sceneId: string }
	| { type: 'showText'; text: string };
```

`effects.ts` exports `applyEffects(state, effects): GameState` (pure). `graph.ts` exports `evaluate(condition, state): boolean`.

### 4.4 LLMBehaviour (the LLM authoring unit)

```ts
interface LLMBehaviour {
	id: string;
	name: string;
	systemPrompt: string; // computer persona + scene context, authored by client
	goal: string; // what the player is trying to get the computer to do
	guardrails: string[]; // hard rules the model must never violate
	allowedOutcomes: Outcome[]; // the finite set of decisions the model may pick from
	maxTurns?: number; // optional cap on the back-and-forth
	onGrantedEffects: Effect[]; // applied when an outcome with granted=true is chosen
	onDeniedEffects?: Effect[];
}
interface Outcome {
	id: string;
	label: string;
	granted: boolean;
	effects: Effect[];
}
```

Design intent: the **model chooses wording freely but must pick from `allowedOutcomes`**, and the engine — not the model — applies that outcome's effects. The model never invents game-state changes. This keeps consequences deterministic while keeping dialogue fluid.

### 4.5 GameState (per play session)

```ts
interface GameState {
	currentSceneId: string;
	flags: Record<string, string | number | boolean>;
	inventory: string[]; // itemIds
	history: ConversationTurn[]; // current behaviour's transcript
	visitedScenes: string[];
}
interface ConversationTurn {
	role: 'player' | 'computer';
	text: string;
	behaviourId: string;
}
```

Persist to Firestore (`saves/{sessionId}`) on each state change so a Pi power-cycle can resume. ASSUMPTION: anonymous session id in localStorage; single-player kiosk.

### 4.6 Firestore structure

```
builds/{buildId}            # an immutable published snapshot the GAME reads
  meta: { version, publishedAt, startSceneId }
  scenes: Scene[]           # denormalized into the build doc (small game; one read)
  items: Item[]
  behaviours: LLMBehaviour[]
config/current              # { activeBuildId }   <- game reads this to find the live build

draft/scenes/{id}           # EDITOR working copies (mutable)
draft/items/{id}
draft/behaviours/{id}
draft/meta                  # { startSceneId }

saves/{sessionId}           # GameState
```

**Publish** = validate all `draft/*` with zod, then write a new `builds/{buildId}` snapshot and update `config/current.activeBuildId` atomically. The game only ever reads the active build, so editing drafts can't break the live game. Keep prior builds for rollback.

---

## 5. LLM integration

### 5.1 Endpoint contract — `POST /api/converse`

Server-only. The Gemini key (`GEMINI_API_KEY`) lives in server env and is never sent to the client.

Request:

```json
{ "behaviourId": "string", "sessionId": "string", "playerMessage": "string" }
```

Server steps:

1. Load active build; find the `LLMBehaviour`. Load the save's `history` for this behaviour.
2. Build the prompt (§5.2). Call Gemini with **structured output** constrained to the Outcome schema (§5.3).
3. Validate the response with zod. If invalid or the call fails, return the deterministic fallback (§5.4).
4. Resolve the chosen `outcomeId` to the authored `Outcome`; apply its effects server-side to the save; append both turns to history.
5. Return reply + resolved effects to the client so the runtime can animate the result.

Response:

```json
{
	"reply": "Override denied. You are not authorised to vent the airlock.",
	"outcomeId": "deny",
	"granted": false,
	"appliedEffects": [{ "type": "setFlag", "key": "computerAnnoyed", "value": true }],
	"conversationOver": false
}
```

### 5.2 Prompt construction (`lib/llm/prompt.ts`)

Compose: behaviour `systemPrompt` + persona, then the `goal`, then `guardrails` as explicit MUST-NOT rules, then the running `history`, then the new `playerMessage`. Instruct the model to (a) reply in the computer's voice and (b) select exactly one `outcomeId` from the provided list. **Do not let the model emit raw effects** — only an `outcomeId` plus prose.

### 5.3 Structured-output schema (`lib/llm/outcome.ts`)

Constrain Gemini's `responseSchema` to:

```ts
{ reply: string, outcomeId: enum(...behaviour.allowedOutcomes.map(o => o.id)), reasoning?: string }
```

Use the JSON-schema / `responseSchema` support in the Gemini SDK; pass the enum of valid outcome ids per request.

### 5.4 Fallback & guardrails

- On API error, timeout (>~6s), or schema-invalid output: return a canned in-character computer line and the most restrictive `granted:false` outcome. Never hang the game.
- Rate-limit per session. Cap conversation length with `maxTurns`.
- Log prompt + raw response (without the API key) for the client to tune behaviours.

---

## 6. Rendering (game)

- Each scene = a stack of absolutely-positioned `<img>` layers ordered by `z`.
- **Parallax**: translate each layer by `offset * parallaxFactor`, where offset is driven by keyboard look (arrow keys / a small idle sway). Pure CSS `transform`; no WebGL.
- **Filter/grade**: `FilterSpec` maps to CSS (`filter`, `mix-blend-mode`, optional overlay layer for scanlines/vignette/CRT grade). Author-configurable per scene.
- Scene transitions: simple CSS fade/crossfade.
- **Keyboard model**: hotspots/exits are a focusable list; arrow keys cycle, Enter activates. A persistent text input is available when a `behaviourId` exchange is open. Show focus clearly (retro UI).
- Keep a clean rendering seam (`SceneRenderer.svelte`) so a PixiJS implementation can replace it later without touching engine logic. **Do not add PixiJS in v1.**

### Raspberry Pi target

- The build must run acceptably in Chromium kiosk (`chromium --kiosk --noerrdialogs --incognito <url>`, add `--start-fullscreen --start-maximized` if needed).
- Assume weak/absent GPU acceleration → CSS-only effects, modest image sizes, lazy-load adjacent scenes. Test on-device early (Milestone 1).

---

## 7. Editor requirements

Auth-gated under `/editor` (`+layout.server.ts` guard). All edits write to `draft/*`.

- **Scenes**: create/edit; upload layer images to Storage; set `z` and `parallaxFactor` per layer; configure `filter`; add hotspots/exits with conditions and effects; set `introText` / `onEnter`.
- **Items**: CRUD with icon upload.
- **Scene graph** (`@xyflow/svelte`): nodes = scenes, edges = exits/transitions; edge labels show conditions; add/remove edges updates the underlying `exits`. Mark the start scene. This is the client's primary mental model — make it the landing screen of the editor.
- **Behaviours**: edit `systemPrompt`, `goal`, `guardrails`, and the `allowedOutcomes` list (each with label, granted flag, and effects). A **test panel** that runs `/api/converse` against draft content so the client can iterate on prompts.
- **Playtest**: launch the game against the current draft (not just the published build).
- **Publish**: validate all drafts → snapshot to a new `build` → flip `config/current`. Show validation errors clearly; block publish on invalid content. Offer rollback to a previous build.

---

## 8. Environment & config

```
GEMINI_API_KEY=            # server only
GEMINI_MODEL=gemini-flash-lite   # overridable
PUBLIC_FIREBASE_CONFIG=    # client SDK config (public)
FIREBASE_ADMIN_CREDENTIALS= # server, for admin SDK
EDITOR_ALLOWED_EMAILS=     # comma-separated allowlist for editor access
```

Provide `.env.example`. Never expose `GEMINI_API_KEY` to the client bundle.

---

## 9. Milestones (build in this order)

**M0 — Scaffold.** SvelteKit + TS + Firebase init (client + admin), zod, Svelte Flow installed. `.env.example`. Deploys to Firebase App Hosting with a hello page. Firestore + Storage rules: editor writes gated by auth allowlist, builds world-readable, saves session-scoped.

**M1 — Engine + one hardcoded scene (de-risk rendering).** Implement `lib/engine/*` (state, graph, effects, types) with unit tests. Render one parallax, filtered scene from a hardcoded JSON Build. **Verify on the actual Raspberry Pi in kiosk mode.** Acceptance: scene renders, parallax responds to arrows, fade transition to a second scene works, on the Pi at acceptable framerate.

**M2 — LLM loop (de-risk the core mechanic).** Implement `/api/converse`, `gemini.ts`, `prompt.ts`, `outcome.ts` with structured output + fallback. Wire a dialogue panel into the game. Acceptance: player types an argument, computer replies in-character, model picks a valid `outcomeId`, engine applies that outcome's effects and the game state visibly changes; malformed/failed responses fall back gracefully.

**M3 — Firestore content + publish.** Move content to the `draft`/`build` model; implement loader and atomic publish/rollback. Game reads only the active build. Acceptance: editing drafts never affects the live game until publish; publish validates and is atomic.

**M4 — Editor.** Scenes, items, Svelte Flow graph, behaviours + test panel, playtest, publish UI, asset upload. Acceptance: a non-developer can author a 2-scene mini-game with one LLM gate and one item, publish it, and play it — without touching code.

**M5 — Polish & Pi tuning.** Transitions, audio hooks, keyboard UX, retro UI grade, performance pass on the Pi, network-failure handling, save/resume across power-cycle.

Each milestone: include tests for `lib/engine` and `lib/content/schema`, and a short README note on how to run/verify.

---

## 10. Acceptance criteria (whole project)

- Game is fully keyboard-operable and runs in Chromium kiosk on a Raspberry Pi.
- The Gemini key never reaches the client; all LLM calls are server-side.
- The model decides wording but can only select from authored `allowedOutcomes`; all state changes are applied deterministically by the engine.
- Editing draft content cannot break the live published game; publish is atomic with rollback.
- A non-technical client can author scenes, items, the scene graph, and LLM behaviours, and publish, entirely through the editor UI.
- `lib/engine` and content schemas have unit tests; CI builds and type-checks pass.
- A full playthrough takes 5–10 minutes.

---

## 11. Open decisions to confirm with the project owner

- Editor auth: email allowlist vs Google sign-in (defaulting to email allowlist).
- One Firebase project for both apps, or separate game/editor deploys (defaulting to one).
- Exact Gemini model tier and budget ceiling.
- Whether scripted (non-LLM) dialogue is needed at all, or every conversation goes through a behaviour (spec currently assumes behaviours cover both via trivial single-outcome cases).
