// GameState construction + high-level operations (SPEC §4.5). Pure module:
// every function returns new state and never mutates its inputs.
import type { Build, ConversationTurn, Exit, FlagValue, GameState, Hotspot } from './types';
import { applyEffectsResult, type EffectResult } from './effects';
import { findScene } from './graph';

/** A fresh GameState positioned at `startSceneId` (no effects applied yet). */
export function createGameState(startSceneId: string): GameState {
	return {
		currentSceneId: startSceneId,
		flags: {},
		inventory: [],
		history: [],
		visitedScenes: [startSceneId]
	};
}

/**
 * Begin a new game from a Build: create state at the start scene and apply that
 * scene's `onEnter` effects.
 */
export function startGame(build: Build): EffectResult {
	const base = createGameState(build.meta.startSceneId);
	const scene = findScene(build.scenes, build.meta.startSceneId);
	return applyEffectsResult(base, scene?.onEnter);
}

/**
 * Move to a scene: update `currentSceneId`, record the visit, and apply the
 * target scene's `onEnter` effects.
 */
export function goToScene(state: GameState, build: Build, sceneId: string): EffectResult {
	const scene = findScene(build.scenes, sceneId);
	const moved: GameState = {
		...state,
		currentSceneId: sceneId,
		visitedScenes: state.visitedScenes.includes(sceneId)
			? state.visitedScenes
			: [...state.visitedScenes, sceneId]
	};
	return applyEffectsResult(moved, scene?.onEnter);
}

/** Result of activating a hotspot, including a behaviour to open (if any). */
export interface HotspotResult extends EffectResult {
	openBehaviourId?: string;
}

/**
 * Activate a hotspot: apply its effects, optionally transition to another scene
 * (applying that scene's `onEnter`), and surface a behaviour id to open a
 * dialogue. Callers should only pass hotspots that are currently available.
 */
export function activateHotspot(state: GameState, build: Build, hotspot: Hotspot): HotspotResult {
	const afterEffects = applyEffectsResult(state, hotspot.effects);
	const messages = [...afterEffects.messages];
	let next = afterEffects.state;

	if (hotspot.goToSceneId) {
		const moved = goToScene(next, build, hotspot.goToSceneId);
		next = moved.state;
		messages.push(...moved.messages);
	}

	return { state: next, messages, openBehaviourId: hotspot.behaviourId };
}

/** Take an exit to its target scene. */
export function takeExit(state: GameState, build: Build, exit: Exit): EffectResult {
	return goToScene(state, build, exit.toSceneId);
}

// ---------------------------------------------------------------------------
// Conversation history ops (used by the LLM loop, SPEC §5).
// ---------------------------------------------------------------------------

/** Append a conversation turn. */
export function appendTurn(state: GameState, turn: ConversationTurn): GameState {
	return { ...state, history: [...state.history, turn] };
}

/** The transcript for a single behaviour. */
export function historyFor(state: GameState, behaviourId: string): ConversationTurn[] {
	return state.history.filter((turn) => turn.behaviourId === behaviourId);
}

/** Clear history — all of it, or just one behaviour's turns. */
export function clearHistory(state: GameState, behaviourId?: string): GameState {
	if (behaviourId === undefined) return { ...state, history: [] };
	return { ...state, history: state.history.filter((turn) => turn.behaviourId !== behaviourId) };
}

// ---------------------------------------------------------------------------
// Small read helpers.
// ---------------------------------------------------------------------------

export function hasItem(state: GameState, itemId: string): boolean {
	return state.inventory.includes(itemId);
}

export function getFlag(state: GameState, key: string): FlagValue | undefined {
	return state.flags[key];
}
