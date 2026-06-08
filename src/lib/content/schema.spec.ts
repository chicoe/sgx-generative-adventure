import { describe, it, expect } from 'vitest';
import { buildSchema, conditionSchema, effectSchema, sceneSchema } from './schema';
import { placeholderBuild } from '../game/placeholderBuild';

describe('content schema', () => {
	it('accepts the placeholder build (drift check vs engine types)', () => {
		expect(buildSchema.safeParse(placeholderBuild).success).toBe(true);
	});

	it('validates nested/recursive conditions', () => {
		expect(
			conditionSchema.safeParse({
				type: 'and',
				all: [
					{ type: 'hasItem', itemId: 'k' },
					{ type: 'not', cond: { type: 'flag', key: 'x', equals: true } }
				]
			}).success
		).toBe(true);
		expect(conditionSchema.safeParse({ type: 'hasItem' }).success).toBe(false);
	});

	it('accepts known effects and rejects unknown ones', () => {
		expect(effectSchema.safeParse({ type: 'setFlag', key: 'k', value: 1 }).success).toBe(true);
		expect(effectSchema.safeParse({ type: 'explode' }).success).toBe(false);
	});

	it('requires a non-empty scene id', () => {
		expect(
			sceneSchema.safeParse({ id: '', name: 'x', layers: [], hotspots: [], exits: [] }).success
		).toBe(false);
	});
});
