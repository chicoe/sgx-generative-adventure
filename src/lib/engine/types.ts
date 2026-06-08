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
	imagePath: string; // Firebase Storage path
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

export interface Exit {
	id: string;
	toSceneId: string;
	label: string;
	condition?: Condition;
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
	role: 'player' | 'computer';
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
// Build — an immutable published snapshot the GAME reads (SPEC §4.6).
// ---------------------------------------------------------------------------
export interface BuildMeta {
	version: number;
	publishedAt: string; // ISO timestamp
	startSceneId: string;
	defaultBehaviourId?: string; // the ship-wide computer the player talks to
}

export interface Build {
	meta: BuildMeta;
	scenes: Scene[];
	items: Item[];
	behaviours: LLMBehaviour[];
}
