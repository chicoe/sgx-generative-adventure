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
	// Items carry their authored description — it holds the important information
	// about what an item is and does. `consumable` marks one-use items.
	inventory?: { name: string; description?: string; consumable?: boolean }[];
	giveable?: { label: string; itemId: string; description?: string }[]; // items the computer may hand over here
	consumables?: { label: string; itemId: string }[]; // held one-use items the computer can spend
	transformables?: { fromItemId: string; fromLabel: string; toLabel: string }[]; // held items that can become another
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
		? scene.giveable
				.map(
					(g) => `- ${g.label} (item "${g.itemId}")${g.description ? ` — ${g.description}` : ''}`
				)
				.join('\n')
		: '- (none)';
	const inventory = scene.inventory?.length
		? scene.inventory
				.map(
					(i) =>
						`- ${i.name}${i.consumable ? ' (CONSUMABLE — one use)' : ''}${i.description ? ` — ${i.description}` : ''}`
				)
				.join('\n')
		: '- (empty)';
	const consumables = scene.consumables?.length
		? scene.consumables.map((c) => `- ${c.label} (use-up outcome "consume:${c.itemId}")`).join('\n')
		: '';
	const transformables = scene.transformables?.length
		? scene.transformables
				.map(
					(t) => `- ${t.fromLabel} → ${t.toLabel} (transform outcome "transform:${t.fromItemId}")`
				)
				.join('\n')
		: '';
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
		'PLAYER INVENTORY (what each item is and does):',
		inventory,
		consumables
			? 'CONSUMABLE ITEMS THE PLAYER HOLDS — using one up spends it (it leaves their inventory):'
			: '',
		consumables,
		transformables
			? 'ITEMS THE PLAYER CAN TRANSFORM — the transform swaps the first item for the second in one step:'
			: '',
		transformables
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
		'- Your DECK PLAN display WORKS: when the player asks for a map, a deck plan, directions, or',
		'  where they are, pick the "__map__" outcome — it brings the deck plan up on their screen —',
		'  and tell them it is now on their display (they can also toggle it with the "0" key).',
		'  Never claim you have no map or that the map function is offline.',
		'- Your ROOM SCANNER WORKS: when the player asks to scan, sweep, or analyse the room/area, pick',
		'  the "__scan__" outcome — it sweeps their screen and beeps. In the SAME reply, drop ONE short,',
		'  slightly cryptic HINT about a single thing here worth investigating (an exit, an item present,',
		'  something interactable from the scene). Vary which thing you highlight; keep it to one line.',
		'- You pick exactly ONE outcomeId, so you may do AT MOST ONE thing this turn: hand over ONE item,',
		'  OR move the player, OR unlock one route — not several. If the player asks for several items at',
		"  once, give exactly ONE (pick that item's grant outcome) and tell them to ask for the next one",
		'  on the following turn. NEVER list multiple items as "added" — only the single item whose grant',
		'  outcome you pick THIS turn actually enters their inventory; claiming any other did is a lie.',
		'- NEVER say you are doing something (moving, unlocking, giving) without picking the matching',
		'  outcome. Saying "acknowledged" to an action request means you MUST pick that action\'s',
		'  outcome this turn; if no outcome exists for it, say plainly that you cannot do it. Do NOT write',
		'  "added to inventory", "you now have", or similar unless you are picking that exact grant',
		'  outcome — the inventory only changes through the outcome you choose, never through your words.',
		'- If SCENE NOTES say an exit or action requires an item (e.g. a key, a lever, a password), only',
		'  allow it when that item is listed in PLAYER INVENTORY; otherwise stay in character and explain',
		'  what is needed. Do not pretend the player has something they do not.',
		'- The ONLY items you can give are the ones listed under ITEMS PRESENT HERE THAT YOU CAN GIVE',
		'  (each has a grant outcome). If that list is empty, you have NOTHING to give here — say so',
		'  plainly and never claim otherwise. When the player asks for a listed item (a brief reason',
		'  helps but is not required), hand over ONE by choosing its grant outcome. Never invent, offer,',
		'  promise, or "add" an item that is not on that list.',
		'- CONSUMABLE items are one-use. When the player actually uses one up (spends it on something this',
		'  turn), pick its "consume:" outcome — the engine then removes it from their inventory. Only',
		'  consume an item when it is genuinely spent; merely talking about or examining it does not.',
		'- A TRANSFORM turns one held item into another in a single step (the first is removed, the second',
		'  added). When the player does the thing that changes it (e.g. writes on the paper to make a',
		'  letter), pick that "transform:" outcome. Only transform when the change actually happens this',
		'  turn — not for idle talk about it.',
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
			: [
					// A fresh greeting can still have prior ground truth (e.g. the intake
					// questionnaire) — show it so the computer can use it from line one.
					...(history.length ? ['CONVERSATION SO FAR:', transcript, ''] : []),
					'BEGIN: open the interaction. Greet the player and set the scene in character (1–2 sentences), then await their reply. Do not take any exit or action yet.'
				].join('\n')
		: ['CONVERSATION SO FAR:', transcript, '', `PLAYER: ${playerMessage}`].join('\n');

	return { systemInstruction: parts.join('\n'), userPrompt };
}
