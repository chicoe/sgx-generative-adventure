// Build assembly + validation + (de)serialization (SPEC §4.6, M3). Pure — no
// Firebase imports — so publish validation is unit-testable. The Firestore
// writes live in the server-only publish module.
import type {
	Build,
	Condition,
	DisplaySettings,
	Effect,
	Item,
	LLMBehaviour,
	Scene
} from '../engine/types';
import { itemSchema, llmBehaviourSchema, sceneSchema, buildSchema } from './schema';

/** The editable draft content the editor maintains (SPEC §4.6 draft/*). */
export interface DraftContent {
	meta: { startSceneId: string; defaultBehaviourId?: string; display?: DisplaySettings };
	scenes: Scene[];
	items: Item[];
	behaviours: LLMBehaviour[];
}

export interface AssembleResult {
	build?: Build;
	errors: string[];
}

function issuePath(prefix: string, e: { message: string; path: PropertyKey[] }): string {
	const path = e.path.join('.');
	return `${prefix}${path ? ` (${path})` : ''}: ${e.message}`;
}

/** Collect every itemId referenced by an effect/condition tree. */
function effectItemIds(effects: Effect[] = []): string[] {
	return effects.flatMap((e) =>
		e.type === 'addItem' || e.type === 'removeItem' ? [e.itemId] : []
	);
}
function conditionItemIds(c: Condition | undefined): string[] {
	if (!c) return [];
	switch (c.type) {
		case 'hasItem':
			return [c.itemId];
		case 'and':
			return c.all.flatMap(conditionItemIds);
		case 'or':
			return c.any.flatMap(conditionItemIds);
		case 'not':
			return conditionItemIds(c.cond);
		default:
			return [];
	}
}
function effectSceneIds(effects: Effect[] = []): string[] {
	return effects.flatMap((e) => (e.type === 'goToScene' ? [e.sceneId] : []));
}

/** Referential-integrity checks that zod can't express on its own. */
function validateReferences(draft: DraftContent): string[] {
	const errors: string[] = [];
	const sceneIds = new Set(draft.scenes.map((s) => s.id));
	const itemIds = new Set(draft.items.map((i) => i.id));
	const behaviourIds = new Set(draft.behaviours.map((b) => b.id));

	const sceneRef = (id: string | undefined, where: string) => {
		if (id && !sceneIds.has(id)) errors.push(`${where} targets unknown scene "${id}"`);
	};
	const itemRef = (id: string, where: string) => {
		if (!itemIds.has(id)) errors.push(`${where} references unknown item "${id}"`);
	};

	if (draft.meta.startSceneId && !sceneIds.has(draft.meta.startSceneId)) {
		errors.push(`startSceneId "${draft.meta.startSceneId}" is not an existing scene`);
	}
	if (!draft.scenes.some((s) => s.start) && !sceneIds.has(draft.meta.startSceneId)) {
		errors.push('No start scene — mark at least one scene as a start.');
	}
	if (draft.meta.defaultBehaviourId && !behaviourIds.has(draft.meta.defaultBehaviourId)) {
		errors.push(
			`defaultBehaviourId "${draft.meta.defaultBehaviourId}" is not an existing behaviour`
		);
	}

	for (const scene of draft.scenes) {
		for (const exit of scene.exits)
			sceneRef(exit.toSceneId, `scene "${scene.id}" exit "${exit.id}"`);
		for (const h of scene.hotspots) {
			sceneRef(h.goToSceneId, `scene "${scene.id}" hotspot "${h.id}"`);
			if (h.behaviourId && !behaviourIds.has(h.behaviourId)) {
				errors.push(
					`scene "${scene.id}" hotspot "${h.id}" references unknown behaviour "${h.behaviourId}"`
				);
			}
			for (const id of effectSceneIds(h.effects))
				sceneRef(id, `scene "${scene.id}" hotspot "${h.id}" effect`);
			for (const id of effectItemIds(h.effects))
				itemRef(id, `scene "${scene.id}" hotspot "${h.id}" effect`);
			for (const id of conditionItemIds(h.condition))
				itemRef(id, `scene "${scene.id}" hotspot "${h.id}" condition`);
		}
		for (const id of effectSceneIds(scene.onEnter)) sceneRef(id, `scene "${scene.id}" onEnter`);
		for (const id of effectItemIds(scene.onEnter)) itemRef(id, `scene "${scene.id}" onEnter`);
		for (const g of scene.giveableItems ?? [])
			itemRef(g.itemId, `scene "${scene.id}" giveable item`);
	}

	for (const b of draft.behaviours) {
		const all = [
			...b.onGrantedEffects,
			...(b.onDeniedEffects ?? []),
			...b.allowedOutcomes.flatMap((o) => o.effects)
		];
		for (const id of effectSceneIds(all)) sceneRef(id, `behaviour "${b.id}" effect`);
		for (const id of effectItemIds(all)) itemRef(id, `behaviour "${b.id}" effect`);
	}

	return errors;
}

/**
 * Validate all draft content and assemble an immutable Build snapshot, or return
 * a list of human-readable errors. Blocks publish on any invalid content.
 */
export function assembleBuild(
	draft: DraftContent,
	version: number,
	publishedAt: string
): AssembleResult {
	const errors: string[] = [];

	draft.scenes.forEach((s, i) => {
		const r = sceneSchema.safeParse(s);
		if (!r.success) errors.push(...r.error.issues.map((e) => issuePath(`scene[${i}]`, e)));
	});
	draft.items.forEach((it, i) => {
		const r = itemSchema.safeParse(it);
		if (!r.success) errors.push(...r.error.issues.map((e) => issuePath(`item[${i}]`, e)));
	});
	draft.behaviours.forEach((b, i) => {
		const r = llmBehaviourSchema.safeParse(b);
		if (!r.success) errors.push(...r.error.issues.map((e) => issuePath(`behaviour[${i}]`, e)));
	});

	if (errors.length) return { errors };

	errors.push(...validateReferences(draft));
	if (errors.length) return { errors };

	const build: Build = {
		meta: {
			version,
			publishedAt,
			startSceneId: draft.meta.startSceneId,
			defaultBehaviourId: draft.meta.defaultBehaviourId,
			display: draft.meta.display
		},
		scenes: draft.scenes,
		items: draft.items,
		behaviours: draft.behaviours
	};
	const r = buildSchema.safeParse(build);
	if (!r.success) return { errors: r.error.issues.map((e) => issuePath('build', e)) };
	return { build, errors: [] };
}

// --- Firestore storage shape ------------------------------------------------
// A build is stored as one document with denormalized meta fields (for listing /
// rollback) plus the full snapshot JSON in `payload` — a single read (SPEC §4.6).
export interface BuildDoc {
	version: number;
	publishedAt: string;
	startSceneId: string;
	payload: string;
	message?: string; // optional commit message, for identifying versions in lists
}

export function serializeBuild(build: Build): BuildDoc {
	return {
		version: build.meta.version,
		publishedAt: build.meta.publishedAt,
		startSceneId: build.meta.startSceneId,
		payload: JSON.stringify(build)
	};
}

export function deserializeBuild(doc: unknown): Build {
	const payload = (doc as { payload?: unknown })?.payload;
	if (typeof payload !== 'string') throw new Error('build document is missing its payload');
	return buildSchema.parse(JSON.parse(payload));
}
