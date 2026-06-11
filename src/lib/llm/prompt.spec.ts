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

	it('includes item descriptions for inventory and giveable items', () => {
		const { systemInstruction } = buildPrompt(behaviour, [], 'hi', {
			name: 'Cryo Pod',
			inventory: [{ name: 'Keycard', description: 'opens maintenance-level doors' }],
			giveable: [{ itemId: 'crowbar', label: 'Crowbar', description: 'pries sealed hatches' }]
		});
		expect(systemInstruction).toContain('- Keycard — opens maintenance-level doors');
		expect(systemInstruction).toContain('- Crowbar (item "crowbar") — pries sealed hatches');
	});
});
