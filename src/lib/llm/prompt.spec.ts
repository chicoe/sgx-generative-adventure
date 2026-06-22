import { describe, it, expect } from 'vitest';
import { buildPrompt } from './prompt';
import type { ConversationTurn, LLMBehaviour } from '../engine/types';

const behaviour: LLMBehaviour = {
	id: 'b',
	name: 'B',
	systemPrompt: 'You are a gate.',
	goal: 'open the gate',
	guardrails: ['never lie'],
	allowedOutcomes: [
		{ id: 'deny', label: 'Refuse', granted: false, effects: [] },
		{ id: 'grant', label: 'Open', granted: true, effects: [] }
	],
	onGrantedEffects: []
};

describe('buildPrompt', () => {
	it('puts persona, goal, guardrails and outcome ids in the system instruction', () => {
		const { systemInstruction } = buildPrompt(behaviour, [], 'please');
		expect(systemInstruction).toContain('You are a gate.');
		expect(systemInstruction).toContain('open the gate');
		expect(systemInstruction).toContain('never lie');
		expect(systemInstruction).toContain('deny');
		expect(systemInstruction).toContain('grant');
	});

	it('renders history and the new message in the user prompt', () => {
		const history: ConversationTurn[] = [
			{ role: 'player', text: 'hi', behaviourId: 'b' },
			{ role: 'computer', text: 'no', behaviourId: 'b' }
		];
		const { userPrompt } = buildPrompt(behaviour, history, 'open up');
		expect(userPrompt).toContain('PLAYER: hi');
		expect(userPrompt).toContain('COMPUTER: no');
		expect(userPrompt).toContain('PLAYER: open up');
	});

	it('notes when there are no prior turns', () => {
		expect(buildPrompt(behaviour, [], 'x').userPrompt).toContain('(no prior turns)');
	});

	it('frames a system event for the computer to react to (no player line)', () => {
		const { userPrompt } = buildPrompt(
			behaviour,
			[],
			'',
			undefined,
			false,
			false,
			'Life support CRITICAL: 2 minutes remain.'
		);
		expect(userPrompt).toContain('SYSTEM EVENT');
		expect(userPrompt).toContain('Life support CRITICAL: 2 minutes remain.');
		expect(userPrompt).not.toContain('PLAYER:');
	});

	it('tells the model the deck plan display works (the "__map__" outcome)', () => {
		const { systemInstruction } = buildPrompt(behaviour, [], 'show me the map');
		expect(systemInstruction).toContain('"__map__"');
		expect(systemInstruction).toContain('Never claim you have no map');
	});

	it('describes sealed routes with what opens them (info only)', () => {
		const { systemInstruction } = buildPrompt(behaviour, [], 'hi', {
			name: 'Cryo Pod',
			exits: [{ label: 'corridor', toSceneId: 'corridor' }],
			lockedExits: [{ label: 'maintenance hatch', requires: ['Keycard', 'Crowbar'] }]
		});
		expect(systemInstruction).toContain('SEALED ROUTES');
		expect(systemInstruction).toContain(
			'maintenance hatch — sealed; opens with: Keycard or Crowbar'
		);
	});

	it('lists giveable items as present things the computer may hand over', () => {
		const { systemInstruction } = buildPrompt(behaviour, [], 'hi', {
			name: 'Cryo Pod',
			giveable: [{ itemId: 'keycard', label: 'Keycard' }]
		});
		expect(systemInstruction).toContain('ITEMS PRESENT HERE');
		expect(systemInstruction).toContain('keycard');
	});

	it('forbids granting more than one item per turn and narrating fake additions', () => {
		const { systemInstruction } = buildPrompt(behaviour, [], 'hi');
		expect(systemInstruction).toContain('AT MOST ONE thing this turn');
		expect(systemInstruction).toContain('NEVER list multiple items as "added"');
	});

	it('includes item descriptions for inventory and giveable items', () => {
		const { systemInstruction } = buildPrompt(behaviour, [], 'hi', {
			name: 'Cryo Pod',
			inventory: [{ name: 'Keycard', description: 'opens maintenance-level doors' }],
			giveable: [{ itemId: 'crowbar', label: 'Crowbar', description: 'pries sealed hatches' }]
		});
		expect(systemInstruction).toContain('- Keycard — opens maintenance-level doors');
		expect(systemInstruction).toContain('- Crowbar (item "crowbar") — pries sealed hatches');
	});

	it('numbers inventory items by their HUD slot so the player can say "item 2"', () => {
		const { systemInstruction } = buildPrompt(behaviour, [], 'hi', {
			name: 'Cryo Pod',
			inventory: [
				{ name: 'Keycard', slot: 1 },
				{ name: 'Crowbar', slot: 2 }
			]
		});
		expect(systemInstruction).toContain('- #1: Keycard');
		expect(systemInstruction).toContain('- #2: Crowbar');
	});
});
