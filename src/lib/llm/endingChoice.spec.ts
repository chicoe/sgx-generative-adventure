import { describe, it, expect } from 'vitest';
import {
	buildEndingChoicePrompt,
	resolveEndingChoice,
	endingChoiceResponseSchema,
	type EndingOption
} from './endingChoice';
import type { ConversationTurn } from '../engine/types';

const options: EndingOption[] = [
	{ id: 'eb-crowd', tags: ['crowded', 'warm', 'city'], description: 'a teeming neon metropolis' },
	{ id: 'eb-ice', tags: ['solitude', 'cold'], description: 'an empty glacier' }
];

describe('buildEndingChoicePrompt', () => {
	it('lists every candidate id with its tags and description', () => {
		const { userPrompt } = buildEndingChoicePrompt(options, {}, []);
		expect(userPrompt).toContain(
			'eb-crowd: tags [crowded, warm, city] — a teeming neon metropolis'
		);
		expect(userPrompt).toContain('eb-ice: tags [solitude, cold] — an empty glacier');
		expect(userPrompt).toContain('Choose exactly ONE id from: eb-crowd, eb-ice');
	});

	it('includes the player profile + transcript so the model can match', () => {
		const history: ConversationTurn[] = [
			{ role: 'system', text: 'STATE UPDATE: the player loves crowded places.', behaviourId: 'b' },
			{ role: 'player', text: 'I hate being alone', behaviourId: 'b' }
		];
		const { userPrompt } = buildEndingChoicePrompt(options, {}, history);
		expect(userPrompt).toContain('the player loves crowded places');
		expect(userPrompt).toContain('PLAYER: I hate being alone');
	});

	it('renders scene name/prompt as ending context', () => {
		const { userPrompt } = buildEndingChoicePrompt(options, {
			sceneName: 'Escape Pod',
			scenePrompt: 'the player has escaped the ship'
		});
		expect(userPrompt).toContain('ENDING SCENE: Escape Pod');
		expect(userPrompt).toContain('ENDING NOTES: the player has escaped the ship');
	});

	it('notes when there is no transcript yet', () => {
		expect(buildEndingChoicePrompt(options, {}, []).userPrompt).toContain('(no prior turns)');
	});

	it('handles a tagless candidate', () => {
		const { userPrompt } = buildEndingChoicePrompt([{ id: 'eb-x', tags: [] }], {}, []);
		expect(userPrompt).toContain('eb-x: tags [none]');
	});
});

describe('resolveEndingChoice', () => {
	it('returns the id when it is a real candidate', () => {
		expect(resolveEndingChoice(options, 'eb-ice')).toBe('eb-ice');
	});
	it('returns null for an invented id or undefined', () => {
		expect(resolveEndingChoice(options, 'eb-nope')).toBeNull();
		expect(resolveEndingChoice(options, undefined)).toBeNull();
	});
});

describe('endingChoiceResponseSchema', () => {
	it('accepts a chosenId with optional reasoning', () => {
		expect(endingChoiceResponseSchema.parse({ chosenId: 'eb-crowd' }).chosenId).toBe('eb-crowd');
		expect(
			endingChoiceResponseSchema.parse({ chosenId: 'eb-ice', reasoning: 'they like solitude' })
				.reasoning
		).toBe('they like solitude');
	});
	it('rejects an empty chosenId', () => {
		expect(endingChoiceResponseSchema.safeParse({ chosenId: '' }).success).toBe(false);
	});
});
