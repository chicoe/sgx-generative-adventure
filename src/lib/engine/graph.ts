// Condition evaluation + scene-graph traversal (SPEC §4.3, §6). Pure module.
import type { Condition, Exit, GameState, Hotspot, Scene, SceneLayer } from './types';

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
	exitId: string; // the authored exit this door represents (shared by both sides)
	locked: boolean; // still sealed (unlocking is an explicit act, not passive)
	canUnlock: boolean; // locked, but the player holds a qualifying item
}

/** Flag the engine sets when a locked door is explicitly unlocked. */
export const doorUnlockedFlag = (exitId: string) => `unlocked:${exitId}`;

// A door with requiredItems opens with ANY one of them (OR semantics).
const holdsAny = (items: string[] | undefined, state: GameState) =>
	!items?.length || items.some((id) => state.inventory.includes(id));

// Locked until explicitly unlocked — merely holding the item is not enough.
const isLocked = (x: Exit, state: GameState) =>
	(x.requiredItems?.length ?? 0) > 0 && state.flags[doorUnlockedFlag(x.id)] !== true;

/**
 * All doors visible from a scene. A link is a DOOR: bidirectional by default
 * (the reverse of any non-`oneWay` exit leading in counts too, so the player
 * can always go back), `condition` gates visibility, and `requiredItems` lock
 * it — in both directions — until it is EXPLICITLY unlocked (the unlock flag is
 * keyed on the authored exit, so opening one side opens both). Holding a
 * qualifying item marks the door `canUnlock`; the unlock itself is an engine
 * effect. Reverse doors are labelled with the destination room's name and
 * deduped against authored exits.
 */
export function availableDoors(scenes: Scene[], scene: Scene, state: GameState): Door[] {
	const doorOf = (x: Exit, over: Partial<Exit>): Door => {
		const locked = isLocked(x, state);
		return {
			...x,
			...over,
			exitId: x.id,
			locked,
			canUnlock: locked && holdsAny(x.requiredItems, state)
		};
	};
	const doors: Door[] = availableExits(scene, state).map((x) => doorOf(x, {}));
	const have = new Set(doors.map((d) => d.toSceneId));
	for (const other of scenes) {
		if (other.id === scene.id || have.has(other.id)) continue;
		const back = other.exits.find(
			(x) => !x.oneWay && x.toSceneId === scene.id && evaluate(x.condition, state)
		);
		if (back) {
			have.add(other.id);
			doors.push(
				doorOf(back, {
					id: `return-${other.id}`,
					toSceneId: other.id,
					label: other.name || other.id
				})
			);
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

/**
 * A layer's image pool: the variant list when present (blank entries ignored),
 * else the legacy single imagePath. Empty = the layer has no art.
 */
export function layerImagePool(layer: SceneLayer): string[] {
	const pool = (layer.imagePaths ?? []).filter((p) => p.trim());
	if (pool.length) return pool;
	return layer.imagePath?.trim() ? [layer.imagePath] : [];
}

/**
 * Pick the image a layer shows — uniform across its pool. Pure; `rng` is
 * injectable so tests can make the pick deterministic.
 */
export function pickLayerImage(
	layer: SceneLayer,
	rng: () => number = Math.random
): string | undefined {
	const pool = layerImagePool(layer);
	if (!pool.length) return undefined;
	return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/**
 * Roll ONCE PER RUN which variant every layer shows, keyed "sceneId/layerId"
 * (layer ids repeat across scenes). Rolled at game start so leaving a room and
 * coming straight back shows the same art; a new run re-rolls.
 */
export function rollLayerImages(
	scenes: Scene[],
	rng: () => number = Math.random
): Record<string, string> {
	const picks: Record<string, string> = {};
	for (const s of scenes)
		for (const l of s.layers) {
			const img = pickLayerImage(l, rng);
			if (img) picks[`${s.id}/${l.id}`] = img;
		}
	return picks;
}
