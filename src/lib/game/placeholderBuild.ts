// PLACEHOLDER build used to exercise the engine + renderer before the client
// authors real content in the editor (M4) and we load published builds from
// Firestore (M3). Everything here is intentionally generic and stand-in — no
// story, no real art. Do NOT add narrative; the client provides all of that.
import type { Build } from '$lib/engine/types';

export const placeholderBuild: Build = {
	meta: { version: 0, publishedAt: '2000-01-01T00:00:00.000Z', startSceneId: 'scene-a' },
	items: [
		{
			id: 'placeholder-item',
			name: 'Placeholder item',
			iconPath: '',
			description: '[ item description placeholder ]'
		}
	],
	behaviours: [
		{
			id: 'placeholder-behaviour',
			name: 'Placeholder behaviour',
			systemPrompt: '[ placeholder system prompt — the client authors the computer persona here ]',
			goal: '[ placeholder goal — what the player is trying to get the computer to do ]',
			guardrails: ['[ placeholder guardrail ]'],
			allowedOutcomes: [
				{ id: 'outcome-deny', label: 'Placeholder outcome (denied)', granted: false, effects: [] },
				{
					id: 'outcome-grant',
					label: 'Placeholder outcome (granted)',
					granted: true,
					effects: [{ type: 'setFlag', key: 'placeholderGranted', value: true }]
				}
			],
			onGrantedEffects: [{ type: 'setFlag', key: 'placeholderGranted', value: true }]
		}
	],
	scenes: [
		{
			id: 'scene-a',
			name: 'Scene A (placeholder)',
			introText: '[ placeholder intro text for Scene A — replace via editor ]',
			// Demonstrates the FilterSpec capability; not a final art grade.
			filter: { css: 'contrast(1.03) brightness(1.01)' },
			layers: [
				{ id: 'back', imagePath: 'placeholder/back-a.svg', z: 0, parallaxFactor: 0.08 },
				{ id: 'mid', imagePath: 'placeholder/mid.svg', z: 1, parallaxFactor: 0.4 },
				{ id: 'fore', imagePath: 'placeholder/fore.svg', z: 2, parallaxFactor: 0.85 }
			],
			hotspots: [
				{
					id: 'hotspot-dialogue',
					label: 'Placeholder hotspot (opens dialogue)',
					behaviourId: 'placeholder-behaviour'
				},
				{
					id: 'hotspot-effect',
					label: 'Placeholder hotspot (sets a flag)',
					effects: [{ type: 'setFlag', key: 'placeholderFlag', value: true }]
				}
			],
			exits: [{ id: 'to-b', toSceneId: 'scene-b', label: 'Go to Scene B (placeholder exit)' }]
		},
		{
			id: 'scene-b',
			name: 'Scene B (placeholder)',
			introText: '[ placeholder intro text for Scene B — replace via editor ]',
			filter: { css: 'contrast(1.03) brightness(1.01)' },
			layers: [
				{ id: 'back', imagePath: 'placeholder/back-b.svg', z: 0, parallaxFactor: 0.08 },
				{ id: 'mid', imagePath: 'placeholder/mid.svg', z: 1, parallaxFactor: 0.4 },
				{ id: 'fore', imagePath: 'placeholder/fore.svg', z: 2, parallaxFactor: 0.85 }
			],
			hotspots: [],
			exits: [{ id: 'to-a', toSceneId: 'scene-a', label: 'Back to Scene A (placeholder exit)' }]
		}
	]
};
