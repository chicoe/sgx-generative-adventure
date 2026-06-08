// Prompt construction (SPEC §5.2). Pure — composes a behaviour + transcript +
// the new player message into a system instruction and a user prompt. The model
// is told to reply in voice and pick exactly one outcomeId; it never emits effects.
import type { ConversationTurn, LLMBehaviour } from '../engine/types';

export interface PromptParts {
	systemInstruction: string;
	userPrompt: string;
}

export function buildPrompt(
	behaviour: LLMBehaviour,
	history: ConversationTurn[],
	playerMessage: string
): PromptParts {
	const outcomes = behaviour.allowedOutcomes
		.map(
			(o) => `- ${o.id}: ${o.label} (${o.granted ? 'grants the request' : 'denies the request'})`
		)
		.join('\n');

	const guardrails = behaviour.guardrails.length
		? behaviour.guardrails.map((g) => `- ${g}`).join('\n')
		: '- (none specified)';

	const systemInstruction = [
		behaviour.systemPrompt,
		'',
		`GOAL THE PLAYER IS PURSUING: ${behaviour.goal}`,
		'',
		'HARD RULES YOU MUST NEVER VIOLATE:',
		guardrails,
		'',
		'Respond in character, then choose exactly ONE outcomeId from this list:',
		outcomes,
		'',
		'Return only the structured fields: a short in-character `reply`, the chosen `outcomeId`,',
		'and optional `reasoning`. Never invent outcomes or game effects — only select an outcomeId.'
	].join('\n');

	const transcript = history.length
		? history.map((t) => `${t.role === 'player' ? 'PLAYER' : 'COMPUTER'}: ${t.text}`).join('\n')
		: '(no prior turns)';

	const userPrompt = ['CONVERSATION SO FAR:', transcript, '', `PLAYER: ${playerMessage}`].join(
		'\n'
	);

	return { systemInstruction, userPrompt };
}
