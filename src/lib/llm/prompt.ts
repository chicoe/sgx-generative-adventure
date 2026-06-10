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
	cameFrom?: string; // the room the player arrived from ("go back" means there)
	exits?: { label: string; toSceneId: string; back?: boolean }[];
	lockedExits?: { label: string; requires: string[] }[]; // sealed, player lacks the items (info only)
	unlockable?: { label: string; exitId: string }[]; // sealed, but the player carries what opens it
	inventory?: string[];
	giveable?: { label: string; itemId: string }[]; // items the computer may hand over here
}

function sceneSection(scene: SceneContext): string {
	const exits = scene.exits?.length
		? scene.exits
				.map(
					(e) =>
						`- ${e.label} (leads to scene "${e.toSceneId}")${e.back ? ' — THIS is the way BACK; "go back" means this exit' : ''}`
				)
				.join('\n')
		: '- (none)';
	const sealed = scene.lockedExits?.length
		? scene.lockedExits
				.map((e) => `- ${e.label} — sealed; opens with: ${e.requires.join(' or ')}`)
				.join('\n')
		: '';
	const unlockable = scene.unlockable?.length
		? scene.unlockable.map((e) => `- ${e.label} (unlock outcome "unlock:${e.exitId}")`).join('\n')
		: '';
	const giveable = scene.giveable?.length
		? scene.giveable.map((g) => `- ${g.label} (item "${g.itemId}")`).join('\n')
		: '- (none)';
	return [
		`CURRENT SCENE: ${scene.name ?? '(unnamed)'}`,
		scene.prompt ? `SCENE NOTES: ${scene.prompt}` : '',
		scene.cameFrom
			? `THE PLAYER ARRIVED HERE FROM: ${scene.cameFrom} — if they ask to "go back", that is the destination.`
			: '',
		'AVAILABLE EXITS:',
		exits,
		sealed ? 'SEALED ROUTES (locked — you can NOT take the player through these):' : '',
		sealed,
		unlockable
			? 'SEALED ROUTES THE PLAYER CAN UNLOCK NOW — they ALREADY CARRY what is needed, never claim they lack it:'
			: '',
		unlockable,
		'ITEMS PRESENT HERE THAT YOU CAN GIVE THE PLAYER:',
		giveable,
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
	opening = false,
	revisit = false
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
		'- The CURRENT SCENE block reflects the LIVE game state: inventory, exits, and sealed/unlocked',
		'  status are refreshed every turn. For those MECHANICAL facts, trust it (and the SYSTEM lines',
		'  in the transcript) over older dialogue, which may be outdated. Everything ELSE in the',
		'  conversation still happened and still matters: remember names, details and promises the',
		'  player shared, and stay consistent with what you said before unless the state changed.',
		'- You may ONLY move the player through the exits listed under AVAILABLE EXITS. Never mention,',
		'  offer, or imply you can go anywhere that is not in that list. If the player asks for a place',
		'  that is not an available exit, say in character that there is no route there.',
		'- SEALED ROUTES exist but cannot be taken (there is no outcome for them). If the player asks',
		'  about one, acknowledge it is sealed and tell them what would open it. Never pretend to take',
		'  them through a sealed route.',
		'- For a route under "SEALED ROUTES THE PLAYER CAN UNLOCK NOW": when the player tries to open',
		'  it or uses the required item on it, choose its unlock outcome. Unlocking does NOT move the',
		'  player — it only opens the route; they can go through on a later turn.',
		'- If the player asks to "go back" or "return", take the exit marked as the way BACK — pick',
		'  that exit outcome immediately.',
		'- NEVER say you are doing something (moving, unlocking, giving) without picking the matching',
		'  outcome. Saying "acknowledged" to an action request means you MUST pick that action\'s',
		'  outcome this turn; if no outcome exists for it, say plainly that you cannot do it.',
		'- If SCENE NOTES say an exit or action requires an item (e.g. a key, a lever, a password), only',
		'  allow it when that item is listed in PLAYER INVENTORY; otherwise stay in character and explain',
		'  what is needed. Do not pretend the player has something they do not.',
		'- The items under ITEMS PRESENT HERE are genuinely in this location and you ARE allowed to give',
		'  them. Acknowledge them honestly when the player asks. When the player asks for one (a brief',
		'  reason helps but is not required), hand it over by choosing its grant outcome. Never invent,',
		'  offer, or promise an item that is not listed there.',
		'- Most turns are ordinary conversation: when no listed action or exit clearly applies, pick the',
		'  "no change" outcome and simply reply. Only pick an action or exit outcome when the player',
		'  clearly intends it.',
		'- Never invent outcomes or effects. Return only a short in-character `reply`, the chosen',
		'  `outcomeId`, and optional `reasoning`.'
	);

	const transcript = history.length
		? history
				.map(
					(t) =>
						`${t.role === 'player' ? 'PLAYER' : t.role === 'system' ? 'SYSTEM (ground truth)' : 'COMPUTER'}: ${t.text}`
				)
				.join('\n')
		: '(no prior turns)';
	const userPrompt = opening
		? revisit
			? [
					'CONVERSATION SO FAR:',
					transcript,
					'',
					'BEGIN: the player has just RETURNED to this location — they have been here before and you have already met. Give ONE short in-character line acknowledging their return (no re-introductions, do not repeat the room description), then await their reply. Do not take any exit or action yet.'
				].join('\n')
			: 'BEGIN: open the interaction. Greet the player and set the scene in character (1–2 sentences), then await their reply. Do not take any exit or action yet.'
		: ['CONVERSATION SO FAR:', transcript, '', `PLAYER: ${playerMessage}`].join('\n');

	return { systemInstruction: parts.join('\n'), userPrompt };
}
