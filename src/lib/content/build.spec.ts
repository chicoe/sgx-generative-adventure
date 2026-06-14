import { describe, it, expect } from 'vitest';
import {
	assembleBuild,
	scrubDraft,
	serializeBuild,
	deserializeBuild,
	type DraftContent
} from './build';
import type { Scene } from '../engine/types';

const scene = (over: Partial<Scene> = {}): Scene => ({
	id: 'a',
	name: 'A',
	layers: [],
	hotspots: [],
	exits: [],
	...over
});

const validDraft: DraftContent = {
	meta: { startSceneId: 'a' },
	scenes: [scene(), scene({ id: 'b', name: 'B' })],
	items: [{ id: 'key', name: 'Key', iconPath: '', description: '' }],
	behaviours: []
};

describe('assembleBuild', () => {
	it('assembles a valid draft into a Build', () => {
		const r = assembleBuild(validDraft, 1, '2026-01-01T00:00:00.000Z');
		expect(r.errors).toEqual([]);
		expect(r.build?.meta.startSceneId).toBe('a');
		expect(r.build?.scenes).toHaveLength(2);
	});

	it('flags a missing start scene', () => {
		const r = assembleBuild({ ...validDraft, meta: { startSceneId: 'zzz' } }, 1, 'now');
		expect(r.build).toBeUndefined();
		expect(r.errors.join(' ')).toContain('zzz');
	});

	it('flags an exit to an unknown scene', () => {
		const bad: DraftContent = {
			...validDraft,
			scenes: [scene({ exits: [{ id: 'e', toSceneId: 'ghost', label: 'go' }] }), scene({ id: 'b' })]
		};
		expect(assembleBuild(bad, 1, 'now').errors.join(' ')).toContain('ghost');
	});

	it('flags a hotspot referencing an unknown behaviour', () => {
		const bad: DraftContent = {
			...validDraft,
			scenes: [
				scene({ hotspots: [{ id: 'h', label: 'x', behaviourId: 'nope' }] }),
				scene({ id: 'b' })
			]
		};
		expect(assembleBuild(bad, 1, 'now').errors.join(' ')).toContain('nope');
	});

	it('flags an effect referencing an unknown item', () => {
		const bad: DraftContent = {
			...validDraft,
			scenes: [scene({ onEnter: [{ type: 'addItem', itemId: 'ghostItem' }] }), scene({ id: 'b' })]
		};
		expect(assembleBuild(bad, 1, 'now').errors.join(' ')).toContain('ghostItem');
	});

	it('flags an exit requiredItems entry referencing an unknown item', () => {
		const bad: DraftContent = {
			...validDraft,
			scenes: [
				scene({ exits: [{ id: 'e', toSceneId: 'b', label: 'door', requiredItems: ['ghostKey'] }] }),
				scene({ id: 'b' })
			]
		};
		expect(assembleBuild(bad, 1, 'now').errors.join(' ')).toContain('ghostKey');
	});

	it('flags a giveable item referencing an unknown item', () => {
		const bad: DraftContent = {
			...validDraft,
			scenes: [scene({ giveableItems: [{ itemId: 'ghostItem', chance: 0.5 }] }), scene({ id: 'b' })]
		};
		expect(assembleBuild(bad, 1, 'now').errors.join(' ')).toContain('ghostItem');
	});

	it('flags an item transformsTo pointing at an unknown item', () => {
		const bad: DraftContent = {
			...validDraft,
			items: [{ id: 'key', name: 'Key', iconPath: '', description: '', transformsTo: 'ghostItem' }]
		};
		expect(assembleBuild(bad, 1, 'now').errors.join(' ')).toContain('ghostItem');
	});

	it('rejects schema-invalid content', () => {
		const bad = {
			...validDraft,
			items: [{ id: '', name: 'x', iconPath: '', description: '' }]
		} as DraftContent;
		const r = assembleBuild(bad, 1, 'now');
		expect(r.build).toBeUndefined();
		expect(r.errors.length).toBeGreaterThan(0);
	});

	it('carries display settings into the build meta', () => {
		const r = assembleBuild(
			{
				...validDraft,
				meta: {
					startSceneId: 'a',
					display: {
						width: 800,
						height: 600,
						center: false,
						marginLeft: 10,
						marginTop: 20,
						bg: '#102030',
						ui: '#a0b0c0',
						mode: 'duotone',
						uiOpacity: 0.5,
						crt: 0.5
					}
				}
			},
			1,
			'now'
		);
		expect(r.errors).toEqual([]);
		expect(r.build?.meta.display?.mode).toBe('duotone');
		expect(r.build?.meta.display?.width).toBe(800);
	});

	it('flags a default behaviour that does not exist', () => {
		const r = assembleBuild(
			{ ...validDraft, meta: { startSceneId: 'a', defaultBehaviourId: 'ghost' } },
			1,
			'now'
		);
		expect(r.errors.join(' ')).toContain('ghost');
	});
});

describe('scrubDraft', () => {
	it('leaves a clean draft untouched and reports nothing', () => {
		const { draft, removed } = scrubDraft(validDraft);
		expect(removed).toEqual([]);
		expect(draft.scenes).toHaveLength(2);
	});

	it('removes effects, giveables and door keys that reference missing items', () => {
		const dirty: DraftContent = {
			...validDraft,
			scenes: [
				scene({
					onEnter: [
						{ type: 'addItem', itemId: 'ghost' },
						{ type: 'setFlag', key: 'ok', value: true }
					],
					giveableItems: [
						{ itemId: 'ghost', chance: 1 },
						{ itemId: 'key', chance: 1 }
					],
					exits: [{ id: 'e', toSceneId: 'b', label: 'door', requiredItems: ['ghost', 'key'] }]
				}),
				scene({ id: 'b' })
			]
		};
		const { draft, removed } = scrubDraft(dirty);
		expect(draft.scenes[0].onEnter).toEqual([{ type: 'setFlag', key: 'ok', value: true }]);
		expect(draft.scenes[0].giveableItems).toEqual([{ itemId: 'key', chance: 1 }]);
		expect(draft.scenes[0].exits[0].requiredItems).toEqual(['key']);
		expect(removed).toHaveLength(3);
		// …and the scrubbed draft now validates.
		expect(assembleBuild(draft, 1, 'now').errors).toEqual([]);
	});

	it('removes exits to missing scenes and broken behaviour effects', () => {
		const dirty: DraftContent = {
			...validDraft,
			scenes: [
				scene({ exits: [{ id: 'e', toSceneId: 'ghost', label: 'go' }] }),
				scene({ id: 'b' })
			],
			behaviours: [
				{
					id: 'comp',
					name: 'C',
					systemPrompt: 'p',
					goal: 'g',
					guardrails: [],
					allowedOutcomes: [
						{ id: 'o', label: 'O', granted: true, effects: [{ type: 'addItem', itemId: 'ghost' }] }
					],
					onGrantedEffects: [{ type: 'goToScene', sceneId: 'ghost' }]
				}
			]
		};
		const { draft, removed } = scrubDraft(dirty);
		expect(draft.scenes[0].exits).toEqual([]);
		expect(draft.behaviours[0].allowedOutcomes[0].effects).toEqual([]);
		expect(draft.behaviours[0].onGrantedEffects).toEqual([]);
		expect(removed).toHaveLength(3);
		expect(assembleBuild(draft, 1, 'now').errors).toEqual([]);
	});

	it('clears an item transformsTo that points at a deleted item', () => {
		const dirty: DraftContent = {
			...validDraft,
			items: [{ id: 'key', name: 'Key', iconPath: '', description: '', transformsTo: 'ghost' }]
		};
		const { draft, removed } = scrubDraft(dirty);
		expect(draft.items[0].transformsTo).toBeUndefined();
		expect(removed).toHaveLength(1);
		expect(assembleBuild(draft, 1, 'now').errors).toEqual([]);
	});

	it('repoints a missing startSceneId at a start-flagged scene', () => {
		const dirty: DraftContent = {
			...validDraft,
			meta: { startSceneId: 'ghost' },
			scenes: [scene(), scene({ id: 'b', start: true })]
		};
		const { draft, removed } = scrubDraft(dirty);
		expect(draft.meta.startSceneId).toBe('b');
		expect(removed).toHaveLength(1);
	});
});

describe('serialize/deserialize', () => {
	it('round-trips a build through the Firestore payload shape', () => {
		const b = assembleBuild(validDraft, 7, '2026-01-01T00:00:00.000Z').build!;
		const doc = serializeBuild(b);
		expect(doc.version).toBe(7);
		expect(deserializeBuild(doc)).toEqual(b);
	});

	it('throws on a document without a payload', () => {
		expect(() => deserializeBuild({})).toThrow();
	});
});
