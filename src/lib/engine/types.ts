// Shared content + state types (SPEC §4).
//
// This module is the deterministic core of the game and MUST stay free of
// Svelte and Firebase imports so it can be unit-tested in isolation.

// ---------------------------------------------------------------------------
// Primitive value used by flags.
// ---------------------------------------------------------------------------
export type FlagValue = string | number | boolean;

// ---------------------------------------------------------------------------
// Conditions & Effects — the deterministic core (SPEC §4.3).
// ---------------------------------------------------------------------------
export type Condition =
	| { type: 'hasItem'; itemId: string }
	| { type: 'flag'; key: string; equals: FlagValue }
	| { type: 'and'; all: Condition[] }
	| { type: 'or'; any: Condition[] }
	| { type: 'not'; cond: Condition };

export type Effect =
	| { type: 'setFlag'; key: string; value: FlagValue }
	| { type: 'addItem'; itemId: string }
	| { type: 'removeItem'; itemId: string }
	| { type: 'goToScene'; sceneId: string }
	| { type: 'showText'; text: string };

// ---------------------------------------------------------------------------
// Scene (SPEC §4.1).
// ---------------------------------------------------------------------------
export interface SceneLayer {
	id: string;
	imagePath: string; // single image (legacy / fallback when imagePaths is empty)
	// Optional pool of variants: when non-empty, ONE is picked at random each
	// time the scene is shown. The editor keeps imagePath = the first variant.
	imagePaths?: string[];
	z: number; // stacking order, 0 = back
	parallaxFactor: number; // 0 = static, 1 = full movement
}

export interface Hotspot {
	id: string;
	label: string; // shown for keyboard selection
	// a hotspot triggers effects and/or a transition and/or opens dialogue
	effects?: Effect[];
	goToSceneId?: string;
	behaviourId?: string; // open an LLM/dialogue exchange
	condition?: Condition; // only available if met
}

// A link between rooms is a DOOR: bidirectional by default (the player can
// always go back), optionally one-way, optionally locked behind items.
export interface Exit {
	id: string;
	toSceneId: string;
	label: string;
	condition?: Condition;
	oneWay?: boolean; // default false — traversable in both directions
	requiredItems?: string[]; // locked until the player holds ANY ONE of these
}

// An item the computer MAY hand the player while in this scene (only here), if
// they earn/convince it. `chance` (0..1) is rolled on entry to decide whether
// the item is actually present this run.
export interface GiveableItem {
	itemId: string;
	chance: number;
}

// CSS grade applied over the layer stack (SPEC §6). Author-configurable.
export interface FilterSpec {
	// Raw CSS `filter` value, e.g. 'contrast(1.1) saturate(0.8) hue-rotate(8deg)'.
	css?: string;
	// CSS `mix-blend-mode` for an optional overlay.
	blendMode?: string;
	// Optional full-screen overlay layer (scanlines/vignette/CRT), as a CSS
	// background value applied to an absolutely-positioned element.
	overlay?: string;
}

export interface Scene {
	id: string;
	name: string;
	layers: SceneLayer[];
	filter?: FilterSpec;
	hotspots: Hotspot[];
	exits: Exit[]; // navigable transitions (subset shown in graph)
	onEnter?: Effect[];
	introText?: string; // optional narration shown on enter
	prompt?: string; // scene description + instructions given to the LLM as context
	giveableItems?: GiveableItem[]; // items the computer may grant here (rolled per run)
	start?: boolean; // a possible starting scene — one is chosen at random per run
	ending?: boolean; // reaching it ends the run (then auto/interaction restart)
}

// ---------------------------------------------------------------------------
// Item (SPEC §4.2).
// ---------------------------------------------------------------------------
export interface Item {
	id: string;
	name: string;
	iconPath: string;
	description: string;
	// One-use: when the computer spends it (the player uses it up), the engine
	// removes it from the inventory.
	consumable?: boolean;
	// Transform: the itemId this becomes when the computer transforms it — one
	// outcome that removes this item and adds the target (e.g. paper → letter).
	transformsTo?: string;
}

// ---------------------------------------------------------------------------
// LLMBehaviour — the LLM authoring unit (SPEC §4.4).
// ---------------------------------------------------------------------------
export interface Outcome {
	id: string;
	label: string;
	granted: boolean;
	effects: Effect[];
}

export interface LLMBehaviour {
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

// ---------------------------------------------------------------------------
// GameState — per play session (SPEC §4.5).
// ---------------------------------------------------------------------------
export interface ConversationTurn {
	// 'system' turns are engine-generated ground-truth notes (state updates) the
	// model must trust over earlier dialogue; they are never shown to the player.
	role: 'player' | 'computer' | 'system';
	text: string;
	behaviourId: string;
}

export interface GameState {
	currentSceneId: string;
	flags: Record<string, FlagValue>;
	inventory: string[]; // itemIds
	history: ConversationTurn[]; // current behaviour's transcript
	visitedScenes: string[];
}

// ---------------------------------------------------------------------------
// Global display/theme settings — author-configurable in the editor, applied
// across the whole runtime (resolution, placement, palette, opacity).
// ---------------------------------------------------------------------------
export interface DisplaySettings {
	width: number; // gameplay resolution, px
	height: number;
	// The window is ALWAYS centered; the offsets nudge it from the screen centre
	// in px (negative = left/up).
	offsetX?: number;
	offsetY?: number;
	backdrop?: string; // colour of everything OUTSIDE the window (hex; default #000000)
	// Legacy placement fields (pre-offset builds) — ignored by the runtime.
	center?: boolean;
	marginLeft?: number;
	marginTop?: number;
	bg: string; // background colour (hex)
	ui: string; // UI / ink colour (hex)
	// full colour · duotone gradient (luminance map) · duotone (hard two-colour, no in-betweens)
	mode: 'full' | 'gradient' | 'duotone';
	uiOpacity: number; // 0..1 — opacity of the overlay panels (forced opaque in hard duotone)
	crt: number; // 0..1 — CRT effect strength (scanlines, vignette, phosphor glow)
	invertUi?: boolean; // swap bg/ui for the UI only (bright panels, dark text); scene art unchanged
	fontScale?: number; // 0.5..2 — multiplies every font size in the game (kiosk tuning)
}

// ---------------------------------------------------------------------------
// Build — an immutable published snapshot the GAME reads (SPEC §4.6).
// ---------------------------------------------------------------------------
export interface BuildMeta {
	version: number;
	publishedAt: string; // ISO timestamp
	startSceneId: string;
	defaultBehaviourId?: string; // the ship-wide computer the player talks to
	display?: DisplaySettings; // global look; runtime falls back to DEFAULT_DISPLAY
}

export interface Build {
	meta: BuildMeta;
	scenes: Scene[];
	items: Item[];
	behaviours: LLMBehaviour[];
}
