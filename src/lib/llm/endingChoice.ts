// Ending-background chooser (pure). When an ending scene carries several tagged
// candidate images, the computer picks the ONE that best fits this player — from
// their intake questionnaire answers and the whole conversation. This module
// builds the prompt and resolves/validates the chosen id; the actual model call
// lives in the server-only gemini.ts. No SDK or env imports, so it stays
// unit-testable alongside the rest of the LLM core.
import { z } from 'zod';
import type { ConversationTurn } from '../engine/types';

// A candidate the model may pick (the image url is resolved client-side from the
// chosen id, so it never has to echo a URL).
export interface EndingOption {
	id: string;
	tags: string[];
	description?: string;
}

export interface EndingChoiceContext {
	sceneName?: string;
	scenePrompt?: string; // describes the ending (e.g. an escape vs a death)
}

// Shape of the model's reply. The chosenId is additionally constrained to the
// candidate ids via the responseSchema enum at request time (gemini.ts).
export const endingChoiceResponseSchema = z.object({
	chosenId: z.string().min(1),
	reasoning: z.string().optional()
});
export type EndingChoiceResponse = z.infer<typeof endingChoiceResponseSchema>;

function transcriptOf(history: ConversationTurn[]): string {
	if (!history.length) return '(no prior turns)';
	return history
		.map(
			(t) =>
				`${t.role === 'player' ? 'PLAYER' : t.role === 'system' ? 'SYSTEM (ground truth)' : 'COMPUTER'}: ${t.text}`
		)
		.join('\n');
}

export function buildEndingChoicePrompt(
	options: EndingOption[],
	ctx: EndingChoiceContext,
	history: ConversationTurn[] = []
): { systemInstruction: string; userPrompt: string } {
	const systemInstruction = [
		'You choose the single ending image that best fits THIS player.',
		'An interactive story has just reached its ending. You are given what the game knows',
		'about the player — their intake questionnaire answers and the whole conversation — and a',
		'list of candidate images, each described by TAGS and an optional description.',
		'Pick the ONE image whose tags/description best match who this player is, the preferences',
		'they stated, and the way their story went. If nothing fits well, pick the closest.',
		'Return only the chosen image id and a one-line reasoning.'
	].join('\n');

	const optionLines = options
		.map(
			(o) =>
				`- ${o.id}: tags [${o.tags.length ? o.tags.join(', ') : 'none'}]${o.description ? ` — ${o.description}` : ''}`
		)
		.join('\n');

	const userPrompt = [
		ctx.sceneName ? `ENDING SCENE: ${ctx.sceneName}` : '',
		ctx.scenePrompt ? `ENDING NOTES: ${ctx.scenePrompt}` : '',
		'',
		'WHAT WE KNOW ABOUT THE PLAYER (intake answers + conversation):',
		transcriptOf(history),
		'',
		'CANDIDATE ENDING IMAGES:',
		optionLines,
		'',
		`Choose exactly ONE id from: ${options.map((o) => o.id).join(', ')}.`
	]
		.filter((l) => l !== '')
		.join('\n');

	return { systemInstruction, userPrompt };
}

// Validate the model's pick against the real candidates: returns the matching id,
// or null when it picked something not on the list (the caller then falls back).
export function resolveEndingChoice(
	options: EndingOption[],
	chosenId: string | undefined
): string | null {
	if (!chosenId) return null;
	return options.find((o) => o.id === chosenId)?.id ?? null;
}
