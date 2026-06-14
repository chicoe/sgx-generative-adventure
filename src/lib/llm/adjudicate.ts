// Deterministic outcome resolution (SPEC §5.4, §4.4). Pure: maps a chosen
// outcomeId to the AUTHORED effects. The model only picks an id — these helpers,
// not the model, decide what actually happens. No SDK/env imports.
import type { Effect, LLMBehaviour, Outcome } from '../engine/types';

/** The authored outcome for an id, or undefined if the id isn't allowed. */
export function findOutcome(behaviour: LLMBehaviour, outcomeId: string): Outcome | undefined {
	return behaviour.allowedOutcomes.find((o) => o.id === outcomeId);
}

/**
 * The deterministic fallback: the most restrictive `granted:false` outcome.
 * Synthesizes a deny if the behaviour authored none, so the game never hangs.
 */
export function fallbackOutcome(behaviour: LLMBehaviour): Outcome {
	const denied = behaviour.allowedOutcomes.find((o) => !o.granted);
	return denied ?? { id: '__deny__', label: 'Denied', granted: false, effects: [] };
}

/**
 * Effects the engine applies for a chosen outcome: the outcome's own effects
 * plus the behaviour-level granted/denied effects. Only authored content
 * contributes — never the model.
 */
export function resolveEffects(behaviour: LLMBehaviour, outcome: Outcome): Effect[] {
	const behaviourEffects = outcome.granted
		? behaviour.onGrantedEffects
		: (behaviour.onDeniedEffects ?? []);
	return [...outcome.effects, ...behaviourEffects];
}

const EXIT_OUTCOME_PREFIX = 'exit:';
const GRANT_OUTCOME_PREFIX = 'grant:';
const UNLOCK_OUTCOME_PREFIX = 'unlock:';
const CONSUME_OUTCOME_PREFIX = 'consume:';
const TRANSFORM_OUTCOME_PREFIX = 'transform:';
export const NEUTRAL_OUTCOME_ID = '__none__';
// No effects — the client reacts to this id by opening the deck-plan overlay.
export const MAP_OUTCOME_ID = '__map__';

/** True for a synthesized "take the player through an exit" outcome. */
export function isExitOutcomeId(id: string): boolean {
	return id.startsWith(EXIT_OUTCOME_PREFIX);
}

/** True for a synthesized "give the player an item" outcome. */
export function isGrantOutcomeId(id: string): boolean {
	return id.startsWith(GRANT_OUTCOME_PREFIX);
}

/** True for a synthesized "unlock a sealed door with a carried item" outcome. */
export function isUnlockOutcomeId(id: string): boolean {
	return id.startsWith(UNLOCK_OUTCOME_PREFIX);
}

/** True for a synthesized "spend a consumable item the player holds" outcome. */
export function isConsumeOutcomeId(id: string): boolean {
	return id.startsWith(CONSUME_OUTCOME_PREFIX);
}

/** True for a synthesized "turn one held item into another" outcome. */
export function isTransformOutcomeId(id: string): boolean {
	return id.startsWith(TRANSFORM_OUTCOME_PREFIX);
}

/** Synthesized outcomes (neutral/map/exits/grants/unlocks/consumes/transforms) never carry behaviour-level effects. */
export function isSyntheticOutcomeId(id: string): boolean {
	return (
		id === NEUTRAL_OUTCOME_ID ||
		id === MAP_OUTCOME_ID ||
		isExitOutcomeId(id) ||
		isGrantOutcomeId(id) ||
		isUnlockOutcomeId(id) ||
		isConsumeOutcomeId(id) ||
		isTransformOutcomeId(id)
	);
}

/**
 * Augment a behaviour with synthesized outcomes the model can always pick:
 *  - a NEUTRAL "no change, just reply" outcome, so ordinary conversation doesn't
 *    fire the behaviour's authored effects,
 *  - one granted outcome per available exit, so it can move the player, and
 *  - one granted outcome per item the scene lets the computer give (addItem).
 * Exit targets and grantable items come from the scene — never invented by the
 * model — keeping transitions and rewards deterministic.
 */
export function withSyntheticOutcomes(
	behaviour: LLMBehaviour,
	exits: { label: string; toSceneId: string }[] = [],
	grantables: { label: string; itemId: string }[] = [],
	unlockables: { label: string; exitId: string }[] = [],
	consumables: { label: string; itemId: string }[] = [],
	transforms: { fromItemId: string; fromLabel: string; toItemId: string; toLabel: string }[] = []
): LLMBehaviour {
	const ids = new Set(behaviour.allowedOutcomes.map((o) => o.id));
	const extra: Outcome[] = [];
	if (!ids.has(NEUTRAL_OUTCOME_ID)) {
		extra.push({
			id: NEUTRAL_OUTCOME_ID,
			label: 'No change — just reply in character (use this for ordinary conversation)',
			granted: false,
			effects: []
		});
		ids.add(NEUTRAL_OUTCOME_ID);
	}
	if (!ids.has(MAP_OUTCOME_ID)) {
		extra.push({
			id: MAP_OUTCOME_ID,
			label: 'Show the deck plan / map on the player’s screen (when they ask to see a map)',
			granted: true,
			effects: []
		});
		ids.add(MAP_OUTCOME_ID);
	}
	for (const e of exits) {
		const id = `${EXIT_OUTCOME_PREFIX}${e.toSceneId}`;
		if (ids.has(id)) continue;
		ids.add(id);
		extra.push({
			id,
			label: `Take the player to "${e.label}" (scene ${e.toSceneId})`,
			granted: true,
			effects: [{ type: 'goToScene', sceneId: e.toSceneId }]
		});
	}
	for (const g of grantables) {
		const id = `${GRANT_OUTCOME_PREFIX}${g.itemId}`;
		if (ids.has(id)) continue;
		ids.add(id);
		extra.push({
			id,
			label: `Give the player "${g.label}" (item ${g.itemId}) — when they ask for it`,
			granted: true,
			effects: [{ type: 'addItem', itemId: g.itemId }]
		});
	}
	for (const u of unlockables) {
		const id = `${UNLOCK_OUTCOME_PREFIX}${u.exitId}`;
		if (ids.has(id)) continue;
		ids.add(id);
		extra.push({
			id,
			label: `Unlock "${u.label}" — the player opens it with an item they carry (does not move them)`,
			granted: true,
			effects: [{ type: 'setFlag', key: `unlocked:${u.exitId}`, value: true }]
		});
	}
	for (const c of consumables) {
		const id = `${CONSUME_OUTCOME_PREFIX}${c.itemId}`;
		if (ids.has(id)) continue;
		ids.add(id);
		extra.push({
			id,
			label: `Use up "${c.label}" (item ${c.itemId}) — spends it; it leaves the inventory`,
			granted: true,
			effects: [{ type: 'removeItem', itemId: c.itemId }]
		});
	}
	// One outcome, two effects: remove the source item and add the target — so a
	// transform is atomic and the model still picks just ONE outcomeId.
	for (const t of transforms) {
		const id = `${TRANSFORM_OUTCOME_PREFIX}${t.fromItemId}`;
		if (ids.has(id)) continue;
		ids.add(id);
		extra.push({
			id,
			label: `Transform "${t.fromLabel}" into "${t.toLabel}" — consumes ${t.fromItemId}, gives ${t.toItemId}`,
			granted: true,
			effects: [
				{ type: 'removeItem', itemId: t.fromItemId },
				{ type: 'addItem', itemId: t.toItemId }
			]
		});
	}
	return { ...behaviour, allowedOutcomes: [...behaviour.allowedOutcomes, ...extra] };
}
