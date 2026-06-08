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
