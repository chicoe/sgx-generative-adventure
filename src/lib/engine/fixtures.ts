// Shared test fixtures for the engine specs.
import type { Build } from './types';

export const testBuild: Build = {
	meta: { version: 1, publishedAt: '2026-01-01T00:00:00.000Z', startSceneId: 'bridge' },
	items: [
		{
			id: 'keycard',
			name: 'Keycard',
			iconPath: 'items/keycard.png',
			description: 'A crew keycard.'
		}
	],
	behaviours: [],
	scenes: [
		{
			id: 'bridge',
			name: 'Bridge',
			layers: [{ id: 'bg', imagePath: 'scenes/bridge.png', z: 0, parallaxFactor: 0 }],
			hotspots: [
				{ id: 'pickup', label: 'Take keycard', effects: [{ type: 'addItem', itemId: 'keycard' }] },
				{ id: 'talk', label: 'Use computer', behaviourId: 'override' },
				{
					id: 'locked-door',
					label: 'Go to airlock',
					goToSceneId: 'airlock',
					condition: { type: 'hasItem', itemId: 'keycard' }
				}
			],
			exits: [
				{ id: 'to-corridor', toSceneId: 'corridor', label: 'Corridor' },
				{
					id: 'to-airlock',
					toSceneId: 'airlock',
					label: 'Airlock',
					condition: { type: 'flag', key: 'airlockUnlocked', equals: true }
				}
			],
			onEnter: [{ type: 'setFlag', key: 'visitedBridge', value: true }]
		},
		{
			id: 'corridor',
			name: 'Corridor',
			layers: [{ id: 'bg', imagePath: 'scenes/corridor.png', z: 0, parallaxFactor: 0 }],
			hotspots: [],
			exits: [{ id: 'back', toSceneId: 'bridge', label: 'Bridge' }],
			onEnter: [{ type: 'showText', text: 'The corridor hums.' }]
		},
		{
			id: 'airlock',
			name: 'Airlock',
			layers: [{ id: 'bg', imagePath: 'scenes/airlock.png', z: 0, parallaxFactor: 0 }],
			hotspots: [],
			exits: []
		}
	]
};
