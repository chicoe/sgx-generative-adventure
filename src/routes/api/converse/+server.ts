// POST /api/converse — the player's turn (SPEC §5.1). Server-only; the Gemini
// key never reaches the client.
//
// Resolves the behaviour from one of: an inline `behaviour` (the editor's draft
// test panel), or `behaviourId` against the active published build (the game).
// The server resolves outcomeId -> AUTHORED effects and returns them; the model
// never invents effects. On any failure (incl. no key configured), the
// deterministic fallback runs so the game never hangs.
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { loadActiveBuild } from '$lib/content/loader';
import { llmBehaviourSchema } from '$lib/content/schema';
import type { ConversationTurn, LLMBehaviour } from '$lib/engine/types';
import { generateLlmResponse, isConfigured } from '$lib/llm/gemini';
import {
	findOutcome,
	fallbackOutcome,
	resolveEffects,
	withSyntheticOutcomes,
	isSyntheticOutcomeId
} from '$lib/llm/adjudicate';

const requestSchema = z.object({
	behaviourId: z.string().min(1).optional(),
	behaviour: z.unknown().optional(), // validated with llmBehaviourSchema below
	// Omitted when `opening` is true (the computer speaks first).
	playerMessage: z.string().min(1).max(2000).optional(),
	opening: z.boolean().optional(),
	history: z
		.array(
			z.object({
				role: z.enum(['player', 'computer']),
				text: z.string(),
				behaviourId: z.string()
			})
		)
		.default([]),
	// Current-scene context so the model can converse in situ (SPEC: scene prompt,
	// exits, resources). Optional — the test panel runs a behaviour standalone.
	sceneContext: z
		.object({
			name: z.string().optional(),
			prompt: z.string().optional(),
			exits: z.array(z.object({ label: z.string(), toSceneId: z.string() })).optional(),
			inventory: z.array(z.string()).optional(),
			giveable: z.array(z.object({ label: z.string(), itemId: z.string() })).optional()
		})
		.optional()
});

async function resolveBehaviour(body: z.infer<typeof requestSchema>): Promise<LLMBehaviour> {
	if (body.behaviour !== undefined) {
		const parsed = llmBehaviourSchema.safeParse(body.behaviour);
		if (!parsed.success) error(400, 'Invalid behaviour');
		return parsed.data as LLMBehaviour;
	}
	if (body.behaviourId) {
		const { build } = await loadActiveBuild();
		const found = build.behaviours.find((b) => b.id === body.behaviourId);
		if (!found) error(404, `Unknown behaviour: ${body.behaviourId}`);
		return found;
	}
	error(400, 'Provide a behaviourId or an inline behaviour');
}

const FALLBACK_REPLY =
	'[ placeholder fallback — no live model connected, so the most restrictive outcome was applied. Add a Gemini API key to enable real responses. ]';

export const POST: RequestHandler = async ({ request }) => {
	const parsed = requestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Invalid request body');
	const body = parsed.data;

	if (!body.opening && !body.playerMessage) error(400, 'playerMessage required');

	// Augment with synthesized outcomes: a neutral "just reply" option + one per
	// available exit + one per giveable item (targets/items come from the scene,
	// not the model).
	const behaviour = withSyntheticOutcomes(
		await resolveBehaviour(body),
		body.sceneContext?.exits,
		body.sceneContext?.giveable
	);
	const history = body.history as ConversationTurn[];

	let reply = FALLBACK_REPLY;
	let outcomeId = fallbackOutcome(behaviour).id;

	if (isConfigured()) {
		try {
			const res = await generateLlmResponse(
				behaviour,
				history,
				body.playerMessage ?? '',
				body.sceneContext,
				body.opening
			);
			reply = res.reply || FALLBACK_REPLY;
			outcomeId = findOutcome(behaviour, res.outcomeId)?.id ?? fallbackOutcome(behaviour).id;
		} catch (err) {
			// timeout / transport error / schema-invalid -> fallback (SPEC §5.4: log it)
			console.error('[converse] Gemini call failed:', err instanceof Error ? err.message : err);
			reply = FALLBACK_REPLY;
			outcomeId = fallbackOutcome(behaviour).id;
		}
	}

	const outcome = findOutcome(behaviour, outcomeId) ?? fallbackOutcome(behaviour);
	// On opening the computer only greets — never apply effects. Exit outcomes
	// apply just their goToScene (no behaviour-level granted/denied effects).
	const appliedEffects = body.opening
		? []
		: isSyntheticOutcomeId(outcome.id)
			? outcome.effects
			: resolveEffects(behaviour, outcome);
	const playerTurns = history.filter((t) => t.role === 'player').length + (body.opening ? 0 : 1);
	const conversationOver = body.opening
		? false
		: outcome.granted || (behaviour.maxTurns ? playerTurns >= behaviour.maxTurns : false);

	return json({
		reply,
		outcomeId: outcome.id,
		granted: outcome.granted,
		appliedEffects,
		conversationOver
	});
};
