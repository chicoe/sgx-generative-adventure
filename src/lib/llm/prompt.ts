// Prompt construction (SPEC §5.2). Pure — composes a behaviour + scene context +
// transcript + the new player message into a system instruction and a user
// prompt. The model replies in voice and picks exactly one outcomeId; it never
// emits effects.
import type { ConversationTurn, LLMBehaviour } from '../engine/types';

export interface PromptParts {
	systemInstruction: string;
	userPrompt: string;
}

// What the LLM is told about the player's current situation, so it can converse
// in context and pick the right outcome (e.g. one whose effects take an exit).
export interface SceneContext {
	name?: string;
	prompt?: string; // author's scene description + instructions for the computer
	exits?: { label: string; toSceneId: string }[];
	inventory?: string[];
}

function sceneSection(scene: SceneContext): string {
	const exits = scene.exits?.length
		? scene.exits.map((e) => `- ${e.label} (leads to scene "${e.toSceneId}")`).join('\n')
		: '- (none)';
	return [
		`CURRENT SCENE: ${scene.name ?? '(unnamed)'}`,
		scene.prompt ? `SCENE NOTES: ${scene.prompt}` : '',
		'AVAILABLE EXITS:',
		exits,
		`PLAYER INVENTORY: ${scene.inventory?.length ? scene.inventory.join(', ') : '(empty)'}`
	]
		.filter(Boolean)
		.join('\n');
}

export function buildPrompt(
	behaviour: LLMBehaviour,
	history: ConversationTurn[],
	playerMessage: string,
	scene?: SceneContext,
	opening = false
): PromptParts {
	const outcomes = behaviour.allowedOutcomes
		.map(
			(o) => `- ${o.id}: ${o.label} (${o.granted ? 'grants the request' : 'denies the request'})`
		)
		.join('\n');

	const guardrails = behaviour.guardrails.length
		? behaviour.guardrails.map((g) => `- ${g}`).join('\n')
		: '- (none specified)';

	const parts = [behaviour.systemPrompt, ''];
	if (scene) parts.push(sceneSection(scene), '');
	parts.push(
		`GOAL THE PLAYER IS PURSUING: ${behaviour.goal}`,
		'',
		'HARD RULES YOU MUST NEVER VIOLATE:',
		guardrails,
		'',
		'Respond in character, then choose exactly ONE outcomeId from this list:',
		outcomes,
		'',
		'RULES:',
		'- You may ONLY move the player through the exits listed under AVAILABLE EXITS. Never mention,',
		'  offer, or imply you can go anywhere that is not in that list. If the player asks for a place',
		'  that is not an available exit, say in character that there is no route there.',
		'- Most turns are ordinary conversation: when no listed action or exit clearly applies, pick the',
		'  "no change" outcome and simply reply. Only pick an action or exit outcome when the player',
		'  clearly intends it.',
		'- Never invent outcomes or effects. Return only a short in-character `reply`, the chosen',
		'  `outcomeId`, and optional `reasoning`.'
	);

	const transcript = history.length
		? history.map((t) => `${t.role === 'player' ? 'PLAYER' : 'COMPUTER'}: ${t.text}`).join('\n')
		: '(no prior turns)';
	const userPrompt = opening
		? 'BEGIN: open the interaction. Greet the player and set the scene in character (1–2 sentences), then await their reply. Do not take any exit or action yet.'
		: ['CONVERSATION SO FAR:', transcript, '', `PLAYER: ${playerMessage}`].join('\n');

	return { systemInstruction: parts.join('\n'), userPrompt };
}
