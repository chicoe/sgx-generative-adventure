import { describe, it, expect } from 'vitest';
import {
	availableDoors,
	availableExits,
	availableHotspots,
	evaluate,
	findScene,
	rollGiveableItems
} from './graph';
import { createGameState } from './state';
import { applyEffects } from './effects';
import { testBuild } from './fixtures';
import type { Condition, GameState, Scene } from './types';

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

describe('availableDoors', () => {
	const mk = (id: string, over: Partial<Scene> = {}): Scene => ({
		id,
		name: id.toUpperCase(),
		layers: [],
		hotspots: [],
		exits: [],
		...over
	});

	it('links are bidirectional by default: the reverse of an incoming exit is a door', () => {
		const a = mk('a', { exits: [{ id: 'e1', toSceneId: 'b', label: 'to b' }] });
		const b = mk('b');
		const doors = availableDoors([a, b], b, createGameState('b'));
		expect(doors.map((d) => d.toSceneId)).toEqual(['a']);
		expect(doors[0].label).toBe('A'); // reverse doors are labelled with the room name
		expect(doors[0].locked).toBe(false);
	});

	it('oneWay exits do NOT create a reverse door', () => {
		const a = mk('a', { exits: [{ id: 'e1', toSceneId: 'b', label: 'chute', oneWay: true }] });
		const b = mk('b');
		expect(availableDoors([a, b], b, createGameState('b'))).toEqual([]);
	});

	it('requiredItems lock a door (both directions) until the player holds ANY one', () => {
		const a = mk('a', {
			exits: [{ id: 'e1', toSceneId: 'b', label: 'hatch', requiredItems: ['keycard', 'crowbar'] }]
		});
		const b = mk('b');
		const bare = createGameState('a');
		expect(availableDoors([a, b], a, bare)[0].locked).toBe(true);
		expect(availableDoors([a, b], b, createGameState('b'))[0].locked).toBe(true); // reverse side
		// OR semantics: holding just ONE of the listed items opens it.
		const withCrowbar = applyEffects(bare, [{ type: 'addItem', itemId: 'crowbar' }]);
		expect(availableDoors([a, b], a, withCrowbar)[0].locked).toBe(false);
	});

	it('dedupes when both directions are authored explicitly', () => {
		const a = mk('a', { exits: [{ id: 'e1', toSceneId: 'b', label: 'to b' }] });
		const b = mk('b', { exits: [{ id: 'e2', toSceneId: 'a', label: 'to a' }] });
		const doors = availableDoors([a, b], a, createGameState('a'));
		expect(doors.map((d) => d.toSceneId)).toEqual(['b']);
		expect(doors[0].label).toBe('to b'); // the authored exit wins over the reverse
	});
});

describe('rollGiveableItems', () => {
	const scene = (giveableItems: Scene['giveableItems']): Scene => ({
		id: 's',
		name: 'S',
		layers: [],
		hotspots: [],
		exits: [],
		giveableItems
	});

	it('includes an item only when the rng draw is below its chance', () => {
		const s = scene([
			{ itemId: 'a', chance: 0.5 },
			{ itemId: 'b', chance: 0.5 }
		]);
		const draws = [0.4, 0.6]; // a: 0.4 < 0.5 ✓, b: 0.6 < 0.5 ✗
		let i = 0;
		expect(rollGiveableItems(s, () => draws[i++])).toEqual(['a']);
	});

	it('chance 1 is always present, chance 0 never', () => {
		const s = scene([
			{ itemId: 'always', chance: 1 },
			{ itemId: 'never', chance: 0 }
		]);
		expect(rollGiveableItems(s, () => 0.99)).toEqual(['always']);
	});

	it('returns empty for a scene with no giveable items', () => {
		expect(rollGiveableItems(scene(undefined))).toEqual([]);
	});
});
