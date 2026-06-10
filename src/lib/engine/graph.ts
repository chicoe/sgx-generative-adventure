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

/** An Exit seen from a room, with its lock state resolved against the player. */
export interface Door extends Exit {
	locked: boolean; // requiredItems not all in the inventory yet
}

// A door with requiredItems opens with ANY one of them (OR semantics).
const holdsAny = (items: string[] | undefined, state: GameState) =>
	!items?.length || items.some((id) => state.inventory.includes(id));

/**
 * All doors visible from a scene. A link is a DOOR: bidirectional by default
 * (the reverse of any non-`oneWay` exit leading in counts too, so the player
 * can always go back), `condition` gates visibility, and `requiredItems` lock
 * it — in both directions — until the player holds AT LEAST ONE of them.
 * Reverse doors are labelled with the destination room's name and deduped
 * against authored exits.
 */
export function availableDoors(scenes: Scene[], scene: Scene, state: GameState): Door[] {
	const doors: Door[] = availableExits(scene, state).map((x) => ({
		...x,
		locked: !holdsAny(x.requiredItems, state)
	}));
	const have = new Set(doors.map((d) => d.toSceneId));
	for (const other of scenes) {
		if (other.id === scene.id || have.has(other.id)) continue;
		const back = other.exits.find(
			(x) => !x.oneWay && x.toSceneId === scene.id && evaluate(x.condition, state)
		);
		if (back) {
			have.add(other.id);
			doors.push({
				id: `return-${other.id}`,
				toSceneId: other.id,
				label: other.name || other.id,
				condition: back.condition,
				requiredItems: back.requiredItems,
				locked: !holdsAny(back.requiredItems, state)
			});
		}
	}
	return doors;
}

/** Hotspots whose condition is currently met. */
export function availableHotspots(scene: Scene, state: GameState): Hotspot[] {
	return scene.hotspots.filter((hotspot) => evaluate(hotspot.condition, state));
}

/** Look up a scene by id within a list (e.g. a Build's scenes). */
export function findScene(scenes: Scene[], sceneId: string): Scene | undefined {
	return scenes.find((scene) => scene.id === sceneId);
}

/**
 * Roll which of a scene's giveable items are present this visit. Each item is
 * included with probability `chance` (0..1). Pure; `rng` is injectable so tests
 * can make the roll deterministic.
 */
export function rollGiveableItems(scene: Scene, rng: () => number = Math.random): string[] {
	return (scene.giveableItems ?? []).filter((g) => rng() < g.chance).map((g) => g.itemId);
}
