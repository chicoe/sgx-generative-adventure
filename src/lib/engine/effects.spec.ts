import { describe, it, expect } from 'vitest';
import { applyEffects, applyEffectsResult } from './effects';
import { createGameState } from './state';
import type { GameState } from './types';

const base = (): GameState => createGameState('start');

describe('applyEffects', () => {
	it('sets and overwrites flags', () => {
		const s1 = applyEffects(base(), [{ type: 'setFlag', key: 'power', value: 'on' }]);
		expect(s1.flags.power).toBe('on');
		const s2 = applyEffects(s1, [{ type: 'setFlag', key: 'power', value: false }]);
		expect(s2.flags.power).toBe(false);
	});

	it('adds items without duplicating', () => {
		const s = applyEffects(base(), [
			{ type: 'addItem', itemId: 'keycard' },
			{ type: 'addItem', itemId: 'keycard' }
		]);
		expect(s.inventory).toEqual(['keycard']);
	});

	it('removes items', () => {
		const withItem = applyEffects(base(), [{ type: 'addItem', itemId: 'keycard' }]);
		const without = applyEffects(withItem, [{ type: 'removeItem', itemId: 'keycard' }]);
		expect(without.inventory).toEqual([]);
	});

	it('goToScene updates current scene and records the visit once', () => {
		const s = applyEffects(base(), [
			{ type: 'goToScene', sceneId: 'airlock' },
			{ type: 'goToScene', sceneId: 'airlock' }
		]);
		expect(s.currentSceneId).toBe('airlock');
		expect(s.visitedScenes).toEqual(['start', 'airlock']);
	});

	it('collects showText messages in order', () => {
		const { messages } = applyEffectsResult(base(), [
			{ type: 'showText', text: 'one' },
			{ type: 'setFlag', key: 'x', value: 1 },
			{ type: 'showText', text: 'two' }
		]);
		expect(messages).toEqual(['one', 'two']);
	});

	it('is pure — does not mutate the input state', () => {
		const original = base();
		const snapshot = structuredClone(original);
		applyEffects(original, [
			{ type: 'addItem', itemId: 'keycard' },
			{ type: 'setFlag', key: 'x', value: 1 }
		]);
		expect(original).toEqual(snapshot);
	});

	it('treats an empty/omitted effect list as a no-op', () => {
		const s = base();
		expect(applyEffects(s)).toEqual(s);
	});
});
