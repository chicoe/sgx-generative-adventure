// POST /api/choose-ending — pick the ending background that best fits the player.
// Server-only (the Gemini key never reaches the client). Given an ending scene's
// tagged candidate images + the player's transcript (incl. the pinned intake
// profile), the model returns the chosen candidate id. On any failure (no key,
// timeout, invalid output) it falls back to the first candidate so the ending
// always has a background. The client resolves the id → image URL.
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import type { ConversationTurn } from '$lib/engine/types';
import { chooseEndingBackground, isConfigured } from '$lib/llm/gemini';
import { resolveEndingChoice } from '$lib/llm/endingChoice';

const requestSchema = z.object({
	options: z
		.array(
			z.object({
				id: z.string().min(1),
				tags: z.array(z.string()).default([]),
				description: z.string().optional()
			})
		)
		.min(1),
	sceneName: z.string().optional(),
	scenePrompt: z.string().optional(),
	history: z
		.array(
			z.object({
				role: z.enum(['player', 'computer', 'system']),
				text: z.string(),
				behaviourId: z.string()
			})
		)
		.default([])
});

export const POST: RequestHandler = async ({ request }) => {
	const parsed = requestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Invalid request body');
	const body = parsed.data;
	const options = body.options;

	// Deterministic fallback: the first candidate (the editor's preferred default).
	let chosenId = options[0].id;

	if (!isConfigured()) {
		console.warn('[choose-ending] no Gemini backend configured — using the first candidate');
	} else {
		try {
			const res = await chooseEndingBackground(
				options,
				{ sceneName: body.sceneName, scenePrompt: body.scenePrompt },
				body.history as ConversationTurn[]
			);
			chosenId = resolveEndingChoice(options, res.chosenId) ?? options[0].id;
		} catch (err) {
			console.error(
				'[choose-ending] Gemini call failed:',
				err instanceof Error ? err.message : err
			);
		}
	}

	return json({ chosenId });
};
