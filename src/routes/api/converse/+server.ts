// POST /api/converse — the player's turn (SPEC §5.1). Server-only; the Gemini
// key never reaches the client.
//
// M2 scope: behaviours come from the in-repo placeholder build and conversation
// history is supplied by the client (Firestore-backed saves arrive in M3). The
// server resolves outcomeId -> AUTHORED effects and returns them; the model
// never invents effects. On any failure (incl. no key configured), the
// deterministic fallback runs so the game never hangs.
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { placeholderBuild } from '$lib/game/placeholderBuild';
import type { ConversationTurn } from '$lib/engine/types';
import { generateLlmResponse, isConfigured } from '$lib/llm/gemini';
import { findOutcome, fallbackOutcome, resolveEffects } from '$lib/llm/adjudicate';

const requestSchema = z.object({
	behaviourId: z.string().min(1),
	playerMessage: z.string().min(1).max(2000),
	history: z
		.array(
			z.object({
				role: z.enum(['player', 'computer']),
				text: z.string(),
				behaviourId: z.string()
			})
		)
		.default([])
});

const FALLBACK_REPLY =
	'[ placeholder fallback — no live model connected, so the most restrictive outcome was applied. Add a Gemini API key to enable real responses. ]';

export const POST: RequestHandler = async ({ request }) => {
	const parsed = requestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Invalid request body');
	const body = parsed.data;

	const behaviour = placeholderBuild.behaviours.find((b) => b.id === body.behaviourId);
	if (!behaviour) error(404, `Unknown behaviour: ${body.behaviourId}`);

	const history = body.history as ConversationTurn[];

	let reply = FALLBACK_REPLY;
	let outcomeId = fallbackOutcome(behaviour).id;

	if (isConfigured()) {
		try {
			const res = await generateLlmResponse(behaviour, history, body.playerMessage);
			const matched = findOutcome(behaviour, res.outcomeId);
			if (matched) {
				reply = res.reply;
				outcomeId = matched.id;
			} else {
				// Model picked an id outside the allowed set -> fallback (keep its prose).
				reply = res.reply || FALLBACK_REPLY;
				outcomeId = fallbackOutcome(behaviour).id;
			}
		} catch (err) {
			// timeout / transport error / schema-invalid -> fallback (SPEC §5.4: log it)
			console.error('[converse] Gemini call failed:', err instanceof Error ? err.message : err);
			reply = FALLBACK_REPLY;
			outcomeId = fallbackOutcome(behaviour).id;
		}
	}

	const outcome = findOutcome(behaviour, outcomeId) ?? fallbackOutcome(behaviour);
	const appliedEffects = resolveEffects(behaviour, outcome);
	const playerTurns = history.filter((t) => t.role === 'player').length + 1;
	const conversationOver =
		outcome.granted || (behaviour.maxTurns ? playerTurns >= behaviour.maxTurns : false);

	return json({
		reply,
		outcomeId: outcome.id,
		granted: outcome.granted,
		appliedEffects,
		conversationOver
	});
};
