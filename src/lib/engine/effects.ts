// Pure effect application (SPEC §4.3). No Svelte/Firebase imports.
import type { Effect, GameState } from './types';

/**
 * Text surfaced by a `showText` effect, collected so the runtime can display it
 * without the engine knowing anything about rendering.
 */
export interface EffectResult {
	state: GameState;
	/** Texts emitted by `showText` effects, in order. */
	messages: string[];
}

function applyOne(state: GameState, effect: Effect): { state: GameState; message?: string } {
	switch (effect.type) {
		case 'setFlag':
			return { state: { ...state, flags: { ...state.flags, [effect.key]: effect.value } } };

		case 'addItem':
			if (state.inventory.includes(effect.itemId)) return { state };
			return { state: { ...state, inventory: [...state.inventory, effect.itemId] } };

		case 'removeItem':
			return {
				state: { ...state, inventory: state.inventory.filter((id) => id !== effect.itemId) }
			};

		case 'goToScene': {
			const visited = state.visitedScenes.includes(effect.sceneId)
				? state.visitedScenes
				: [...state.visitedScenes, effect.sceneId];
			return { state: { ...state, currentSceneId: effect.sceneId, visitedScenes: visited } };
		}

		case 'showText':
			return { state, message: effect.text };
	}
}

/**
 * Apply a list of effects to a GameState, returning a new state plus any
 * `showText` messages. Pure: never mutates the input.
 */
export function applyEffectsResult(state: GameState, effects: Effect[] = []): EffectResult {
	let next = state;
	const messages: string[] = [];
	for (const effect of effects) {
		const { state: s, message } = applyOne(next, effect);
		next = s;
		if (message !== undefined) messages.push(message);
	}
	return { state: next, messages };
}

/**
 * Convenience wrapper when callers only need the resulting state (SPEC §4.3
 * signature: `applyEffects(state, effects): GameState`).
 */
export function applyEffects(state: GameState, effects: Effect[] = []): GameState {
	return applyEffectsResult(state, effects).state;
}
