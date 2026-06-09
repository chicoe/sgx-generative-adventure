// Editor draft content access via the browser SDK (SPEC §4.6 draft/*). Writes
// require an allowlisted editor (enforced by firestore.rules isEditor()).
// Layout: draft/content (doc, holds startSceneId) + scenes/items/behaviours
// subcollections.
import {
	collection,
	deleteDoc,
	doc,
	getDoc,
	getDocs,
	setDoc,
	writeBatch
} from 'firebase/firestore';
import { db } from '../firebase/client';
import type { Build, DisplaySettings, Item, LLMBehaviour, Scene } from '../engine/types';
import type { DraftContent } from './build';

const rootDoc = () => doc(db(), 'draft', 'content');

// Firestore rejects `undefined`; a JSON round-trip drops undefined keys so
// optional fields (filter, condition, effects, …) left unset don't error.
const clean = <T>(o: T): T => JSON.parse(JSON.stringify(o));

export async function loadDraft(): Promise<DraftContent | null> {
	const [meta, scenes, items, behaviours] = await Promise.all([
		getDoc(rootDoc()),
		getDocs(collection(db(), 'draft', 'content', 'scenes')),
		getDocs(collection(db(), 'draft', 'content', 'items')),
		getDocs(collection(db(), 'draft', 'content', 'behaviours'))
	]);
	if (!meta.exists() && scenes.empty && items.empty && behaviours.empty) return null;
	return {
		meta: {
			startSceneId: (meta.data()?.startSceneId as string) ?? '',
			defaultBehaviourId: meta.data()?.defaultBehaviourId as string | undefined,
			display: meta.data()?.display as DisplaySettings | undefined
		},
		scenes: scenes.docs.map((d) => d.data() as Scene),
		items: items.docs.map((d) => d.data() as Item),
		behaviours: behaviours.docs.map((d) => d.data() as LLMBehaviour)
	};
}

export async function setStartScene(sceneId: string) {
	await setDoc(rootDoc(), { startSceneId: sceneId }, { merge: true });
}

/** The ship-wide computer the player talks to in every scene. */
export async function setDefaultBehaviour(behaviourId: string) {
	await setDoc(rootDoc(), { defaultBehaviourId: behaviourId }, { merge: true });
}

/** Global display/theme settings (resolution, palette, opacity, …). */
export async function setDisplay(display: DisplaySettings) {
	await setDoc(rootDoc(), { display: clean(display) }, { merge: true });
}

// Editor-only graph node layout, kept on the draft root doc (not part of the
// published build).
export type GraphPositions = Record<string, { x: number; y: number }>;

export async function loadGraphPositions(): Promise<GraphPositions> {
	const snap = await getDoc(rootDoc());
	return (snap.data()?.graphPositions as GraphPositions) ?? {};
}

export async function saveGraphPositions(positions: GraphPositions) {
	await setDoc(rootDoc(), { graphPositions: clean(positions) }, { merge: true });
}

export const saveScene = (s: Scene) =>
	setDoc(doc(db(), 'draft', 'content', 'scenes', s.id), clean(s));
export const deleteScene = (id: string) => deleteDoc(doc(db(), 'draft', 'content', 'scenes', id));
export const saveItem = (it: Item) =>
	setDoc(doc(db(), 'draft', 'content', 'items', it.id), clean(it));
export const deleteItem = (id: string) => deleteDoc(doc(db(), 'draft', 'content', 'items', id));
export const saveBehaviour = (b: LLMBehaviour) =>
	setDoc(doc(db(), 'draft', 'content', 'behaviours', b.id), clean(b));
export const deleteBehaviour = (id: string) =>
	deleteDoc(doc(db(), 'draft', 'content', 'behaviours', id));

/** Replace the whole draft with a build's content (e.g. seed from placeholder). */
export async function seedDraftFromBuild(build: Build): Promise<void> {
	const batch = writeBatch(db());
	batch.set(rootDoc(), { startSceneId: build.meta.startSceneId });
	for (const s of build.scenes) batch.set(doc(db(), 'draft', 'content', 'scenes', s.id), clean(s));
	for (const it of build.items) batch.set(doc(db(), 'draft', 'content', 'items', it.id), clean(it));
	for (const b of build.behaviours)
		batch.set(doc(db(), 'draft', 'content', 'behaviours', b.id), clean(b));
	await batch.commit();
}
