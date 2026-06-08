import { describe, it, expect } from 'vitest';
import { availableExits, availableHotspots, evaluate, findScene } from './graph';
import { createGameState } from './state';
import { applyEffects } from './effects';
import { testBuild } from './fixtures';
import type { Condition, GameState } from './types';

const stateWith = (mut: (s: GameState) => GameState): GameState => mut(createGameState('bridge'));

describe('evaluate', () => {
	it('undefined condition is always true', () => {
		expect(evaluate(undefined, createGameState('bridge'))).toBe(true);
	});

	it('hasItem reflects inventory', () => {
		const cond: Condition = { type: 'hasItem', itemId: 'keycard' };
		expect(evaluate(cond, createGameState('bridge'))).toBe(false);
		const withItem = applyEffects(createGameState('bridge'), [
			{ type: 'addItem', itemId: 'keycard' }
		]);
		expect(evaluate(cond, withItem)).toBe(true);
	});

	it('flag compares by strict equality across types', () => {
		const s = stateWith((st) => applyEffects(st, [{ type: 'setFlag', key: 'n', value: 3 }]));
		expect(evaluate({ type: 'flag', key: 'n', equals: 3 }, s)).toBe(true);
		// 3 (number) must not equal '3' (string)
		expect(evaluate({ type: 'flag', key: 'n', equals: '3' }, s)).toBe(false);
		expect(evaluate({ type: 'flag', key: 'missing', equals: false }, s)).toBe(false);
	});

	it('combines and / or / not', () => {
		const s = applyEffects(createGameState('bridge'), [
			{ type: 'addItem', itemId: 'keycard' },
			{ type: 'setFlag', key: 'power', value: true }
		]);
		const hasKey: Condition = { type: 'hasItem', itemId: 'keycard' };
		const powered: Condition = { type: 'flag', key: 'power', equals: true };
		expect(evaluate({ type: 'and', all: [hasKey, powered] }, s)).toBe(true);
		expect(evaluate({ type: 'and', all: [hasKey, { type: 'not', cond: powered }] }, s)).toBe(false);
		expect(evaluate({ type: 'or', any: [{ type: 'not', cond: powered }, hasKey] }, s)).toBe(true);
		expect(evaluate({ type: 'not', cond: hasKey }, s)).toBe(false);
	});
});

describe('availability helpers', () => {
	const bridge = findScene(testBuild.scenes, 'bridge')!;

	it('filters hotspots by condition', () => {
		const labels = availableHotspots(bridge, createGameState('bridge')).map((h) => h.label);
		expect(labels).toEqual(['Take keycard', 'Use computer']); // locked-door needs keycard

		const withKey = applyEffects(createGameState('bridge'), [
			{ type: 'addItem', itemId: 'keycard' }
		]);
		expect(availableHotspots(bridge, withKey).map((h) => h.id)).toContain('locked-door');
	});

	it('filters exits by condition', () => {
		expect(availableExits(bridge, createGameState('bridge')).map((e) => e.id)).toEqual([
			'to-corridor'
		]);
		const unlocked = applyEffects(createGameState('bridge'), [
			{ type: 'setFlag', key: 'airlockUnlocked', value: true }
		]);
		expect(availableExits(bridge, unlocked).map((e) => e.id)).toEqual([
			'to-corridor',
			'to-airlock'
		]);
	});
});

describe('findScene', () => {
	it('returns undefined for unknown ids', () => {
		expect(findScene(testBuild.scenes, 'nope')).toBeUndefined();
	});
});
