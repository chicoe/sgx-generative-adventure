import { describe, it, expect } from 'vitest';
import {
	activateHotspot,
	appendTurn,
	clearHistory,
	createGameState,
	goToScene,
	historyFor,
	pickStartScene,
	startGame,
	takeExit
} from './state';
import { findScene } from './graph';
import { testBuild } from './fixtures';
import type { ConversationTurn } from './types';

describe('startGame', () => {
	it('positions at the start scene and applies its onEnter effects', () => {
		const { state } = startGame(testBuild);
		expect(state.currentSceneId).toBe('bridge');
		expect(state.visitedScenes).toEqual(['bridge']);
		expect(state.flags.visitedBridge).toBe(true);
	});
});

describe('pickStartScene', () => {
	const twoStarts = {
		...testBuild,
		scenes: testBuild.scenes.map((s) =>
			s.id === 'bridge' || s.id === 'airlock' ? { ...s, start: true } : s
		)
	};

	it('picks a random scene among flagged starts', () => {
		expect(pickStartScene(twoStarts, () => 0)).toBe('bridge');
		expect(pickStartScene(twoStarts, () => 0.99)).toBe('airlock');
	});

	it('falls back to meta.startSceneId when no scene is flagged', () => {
		expect(pickStartScene(testBuild, () => 0.99)).toBe('bridge');
	});
});

describe('goToScene', () => {
	it('moves, records the visit, and applies target onEnter (surfacing messages)', () => {
		const start = startGame(testBuild).state;
		const { state, messages } = goToScene(start, testBuild, 'corridor');
		expect(state.currentSceneId).toBe('corridor');
		expect(state.visitedScenes).toEqual(['bridge', 'corridor']);
		expect(messages).toEqual(['The corridor hums.']);
	});

	it('does not duplicate an already-visited scene', () => {
		let s = startGame(testBuild).state;
		s = goToScene(s, testBuild, 'corridor').state;
		s = goToScene(s, testBuild, 'bridge').state;
		s = goToScene(s, testBuild, 'corridor').state;
		expect(s.visitedScenes).toEqual(['bridge', 'corridor']);
	});
});

describe('activateHotspot', () => {
	it('applies hotspot effects', () => {
		const start = startGame(testBuild).state;
		const bridge = findScene(testBuild.scenes, 'bridge')!;
		const pickup = bridge.hotspots.find((h) => h.id === 'pickup')!;
		const { state } = activateHotspot(start, testBuild, pickup);
		expect(state.inventory).toEqual(['keycard']);
	});

	it('transitions when the hotspot has goToSceneId, applying target onEnter', () => {
		const start = startGame(testBuild).state;
		const bridge = findScene(testBuild.scenes, 'bridge')!;
		const door = bridge.hotspots.find((h) => h.id === 'locked-door')!;
		const { state } = activateHotspot(start, testBuild, door);
		expect(state.currentSceneId).toBe('airlock');
		expect(state.visitedScenes).toContain('airlock');
	});

	it('surfaces a behaviour id to open dialogue without changing scene', () => {
		const start = startGame(testBuild).state;
		const bridge = findScene(testBuild.scenes, 'bridge')!;
		const talk = bridge.hotspots.find((h) => h.id === 'talk')!;
		const res = activateHotspot(start, testBuild, talk);
		expect(res.openBehaviourId).toBe('override');
		expect(res.state.currentSceneId).toBe('bridge');
	});
});

describe('takeExit', () => {
	it('moves to the exit target', () => {
		const start = startGame(testBuild).state;
		const bridge = findScene(testBuild.scenes, 'bridge')!;
		const exit = bridge.exits.find((e) => e.id === 'to-corridor')!;
		expect(takeExit(start, testBuild, exit).state.currentSceneId).toBe('corridor');
	});
});

describe('conversation history', () => {
	const turn = (role: ConversationTurn['role'], text: string, b: string): ConversationTurn => ({
		role,
		text,
		behaviourId: b
	});

	it('appends, filters by behaviour, and clears', () => {
		let s = createGameState('bridge');
		s = appendTurn(s, turn('player', 'open the door', 'override'));
		s = appendTurn(s, turn('computer', 'Denied.', 'override'));
		s = appendTurn(s, turn('player', 'hello', 'greeter'));

		expect(s.history).toHaveLength(3);
		expect(historyFor(s, 'override')).toHaveLength(2);

		const clearedOne = clearHistory(s, 'override');
		expect(historyFor(clearedOne, 'override')).toHaveLength(0);
		expect(historyFor(clearedOne, 'greeter')).toHaveLength(1);

		expect(clearHistory(s).history).toEqual([]);
	});
});
