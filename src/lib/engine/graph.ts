// Condition evaluation + scene-graph traversal (SPEC §4.3, §6). Pure module.
import type { Condition, Exit, GameState, Hotspot, Scene } from './types';

/**
 * Evaluate a condition against the current state. Pure and total: an undefined
 * condition is treated as "always available".
 */
export function evaluate(condition: Condition | undefined, state: GameState): boolean {
	if (!condition) return true;
	switch (condition.type) {
		case 'hasItem':
			return state.inventory.includes(condition.itemId);
		case 'flag':
			return state.flags[condition.key] === condition.equals;
		case 'and':
			return condition.all.every((c) => evaluate(c, state));
		case 'or':
			return condition.any.some((c) => evaluate(c, state));
		case 'not':
			return !evaluate(condition.cond, state);
	}
}

/** Exits whose condition is currently met. */
export function availableExits(scene: Scene, state: GameState): Exit[] {
	return scene.exits.filter((exit) => evaluate(exit.condition, state));
}

/** Hotspots whose condition is currently met. */
export function availableHotspots(scene: Scene, state: GameState): Hotspot[] {
	return scene.hotspots.filter((hotspot) => evaluate(hotspot.condition, state));
}

/** Look up a scene by id within a list (e.g. a Build's scenes). */
export function findScene(scenes: Scene[], sceneId: string): Scene | undefined {
	return scenes.find((scene) => scene.id === sceneId);
}
