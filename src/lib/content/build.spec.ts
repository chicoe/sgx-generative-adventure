import { describe, it, expect } from 'vitest';
import { assembleBuild, serializeBuild, deserializeBuild, type DraftContent } from './build';
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

	it('flags a giveable item referencing an unknown item', () => {
		const bad: DraftContent = {
			...validDraft,
			scenes: [scene({ giveableItems: [{ itemId: 'ghostItem', chance: 0.5 }] }), scene({ id: 'b' })]
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

	it('flags a default behaviour that does not exist', () => {
		const r = assembleBuild(
			{ ...validDraft, meta: { startSceneId: 'a', defaultBehaviourId: 'ghost' } },
			1,
			'now'
		);
		expect(r.errors.join(' ')).toContain('ghost');
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
