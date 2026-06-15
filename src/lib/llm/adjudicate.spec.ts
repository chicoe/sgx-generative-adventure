import { describe, it, expect } from 'vitest';
import {
	findOutcome,
	fallbackOutcome,
	resolveEffects,
	withSyntheticOutcomes,
	isSyntheticOutcomeId,
	NEUTRAL_OUTCOME_ID,
	MAP_OUTCOME_ID,
	SCAN_OUTCOME_ID
} from './adjudicate';
import type { LLMBehaviour } from '../engine/types';

const behaviour: LLMBehaviour = {
	id: 'b',
	name: 'B',
	systemPrompt: '',
	goal: '',
	guardrails: [],
	allowedOutcomes: [
		{
			id: 'grant',
			label: 'Open',
			granted: true,
			effects: [{ type: 'setFlag', key: 'open', value: true }]
		},
		{
			id: 'deny',
			label: 'Refuse',
			granted: false,
			effects: [{ type: 'setFlag', key: 'annoyed', value: true }]
		}
	],
	onGrantedEffects: [{ type: 'addItem', itemId: 'pass' }],
	onDeniedEffects: [{ type: 'setFlag', key: 'denials', value: 1 }]
};

describe('findOutcome', () => {
	it('finds by id, undefined for unknown', () => {
		expect(findOutcome(behaviour, 'grant')?.id).toBe('grant');
		expect(findOutcome(behaviour, 'nope')).toBeUndefined();
	});
});

describe('fallbackOutcome', () => {
	it('returns the most restrictive granted:false outcome', () => {
		expect(fallbackOutcome(behaviour).id).toBe('deny');
	});

	it('synthesizes a deny when none is authored', () => {
		const onlyGrant: LLMBehaviour = {
			...behaviour,
			allowedOutcomes: [behaviour.allowedOutcomes[0]]
		};
		const fb = fallbackOutcome(onlyGrant);
		expect(fb.granted).toBe(false);
		expect(fb.effects).toEqual([]);
	});
});

describe('withSyntheticOutcomes', () => {
	it('always adds a neutral no-change outcome', () => {
		const aug = withSyntheticOutcomes(behaviour, []);
		const neutral = findOutcome(aug, NEUTRAL_OUTCOME_ID);
		expect(neutral?.granted).toBe(false);
		expect(neutral?.effects).toEqual([]);
		expect(isSyntheticOutcomeId(NEUTRAL_OUTCOME_ID)).toBe(true);
	});

	it('always adds a show-the-map outcome (no effects — client-side reaction)', () => {
		const aug = withSyntheticOutcomes(behaviour, []);
		const map = findOutcome(aug, MAP_OUTCOME_ID);
		expect(map?.granted).toBe(true);
		expect(map?.effects).toEqual([]);
		expect(isSyntheticOutcomeId(MAP_OUTCOME_ID)).toBe(true);
	});

	it('always adds a run-the-scanner outcome (no effects — client-side reaction)', () => {
		const aug = withSyntheticOutcomes(behaviour, []);
		const scan = findOutcome(aug, SCAN_OUTCOME_ID);
		expect(scan?.granted).toBe(true);
		expect(scan?.effects).toEqual([]);
		expect(isSyntheticOutcomeId(SCAN_OUTCOME_ID)).toBe(true);
	});

	it('adds one granted goToScene outcome per exit', () => {
		const aug = withSyntheticOutcomes(behaviour, [{ label: 'North', toSceneId: 'hall' }]);
		const exit = findOutcome(aug, 'exit:hall');
		expect(exit?.granted).toBe(true);
		expect(exit?.effects).toEqual([{ type: 'goToScene', sceneId: 'hall' }]);
		expect(isSyntheticOutcomeId('exit:hall')).toBe(true);
		expect(isSyntheticOutcomeId('grant')).toBe(false);
	});

	it('adds one granted addItem outcome per giveable item', () => {
		const aug = withSyntheticOutcomes(behaviour, [], [{ label: 'Pass card', itemId: 'pass-card' }]);
		const grant = findOutcome(aug, 'grant:pass-card');
		expect(grant?.granted).toBe(true);
		expect(grant?.effects).toEqual([{ type: 'addItem', itemId: 'pass-card' }]);
		expect(isSyntheticOutcomeId('grant:pass-card')).toBe(true);
	});

	it('adds one granted setFlag outcome per unlockable door', () => {
		const aug = withSyntheticOutcomes(behaviour, [], [], [{ label: 'hatch', exitId: 'e1' }]);
		const unlock = findOutcome(aug, 'unlock:e1');
		expect(unlock?.granted).toBe(true);
		expect(unlock?.effects).toEqual([{ type: 'setFlag', key: 'unlocked:e1', value: true }]);
		expect(isSyntheticOutcomeId('unlock:e1')).toBe(true);
	});

	it('adds one granted removeItem outcome per held consumable', () => {
		const aug = withSyntheticOutcomes(behaviour, [], [], [], [{ label: 'Gum', itemId: 'gum' }]);
		const consume = findOutcome(aug, 'consume:gum');
		expect(consume?.granted).toBe(true);
		expect(consume?.effects).toEqual([{ type: 'removeItem', itemId: 'gum' }]);
		expect(isSyntheticOutcomeId('consume:gum')).toBe(true);
	});

	it('adds one transform outcome (remove source + add target) per transformable', () => {
		const aug = withSyntheticOutcomes(
			behaviour,
			[],
			[],
			[],
			[],
			[{ fromItemId: 'paper', fromLabel: 'Paper', toItemId: 'letter', toLabel: 'Letter' }]
		);
		const transform = findOutcome(aug, 'transform:paper');
		expect(transform?.granted).toBe(true);
		expect(transform?.effects).toEqual([
			{ type: 'removeItem', itemId: 'paper' },
			{ type: 'addItem', itemId: 'letter' }
		]);
		expect(isSyntheticOutcomeId('transform:paper')).toBe(true);
	});
});

describe('resolveEffects', () => {
	it('combines a granted outcome with onGrantedEffects', () => {
		const grant = findOutcome(behaviour, 'grant')!;
		expect(resolveEffects(behaviour, grant)).toEqual([
			{ type: 'setFlag', key: 'open', value: true },
			{ type: 'addItem', itemId: 'pass' }
		]);
	});

	it('combines a denied outcome with onDeniedEffects', () => {
		const deny = findOutcome(behaviour, 'deny')!;
		expect(resolveEffects(behaviour, deny)).toEqual([
			{ type: 'setFlag', key: 'annoyed', value: true },
			{ type: 'setFlag', key: 'denials', value: 1 }
		]);
	});
});
