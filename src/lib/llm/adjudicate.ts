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

/** True for a synthesized "take the player through an exit" outcome. */
export function isExitOutcomeId(id: string): boolean {
	return id.startsWith(EXIT_OUTCOME_PREFIX);
}

/**
 * Augment a behaviour with one granted outcome per available exit, so the LLM
 * can move the player by selecting it. The targets come from the scene's real
 * exits (never the model), keeping transitions deterministic.
 */
export function withExitOutcomes(
	behaviour: LLMBehaviour,
	exits: { label: string; toSceneId: string }[] = []
): LLMBehaviour {
	if (!exits.length) return behaviour;
	const ids = new Set(behaviour.allowedOutcomes.map((o) => o.id));
	const extra: Outcome[] = [];
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
	return { ...behaviour, allowedOutcomes: [...behaviour.allowedOutcomes, ...extra] };
}
