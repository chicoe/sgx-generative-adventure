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

	it('lists giveable items as present things the computer may hand over', () => {
		const { systemInstruction } = buildPrompt(behaviour, [], 'hi', {
			name: 'Cryo Pod',
			giveable: [{ itemId: 'keycard', label: 'Keycard' }]
		});
		expect(systemInstruction).toContain('ITEMS PRESENT HERE');
		expect(systemInstruction).toContain('keycard');
	});
});
