// Version save/publish from the editor (browser SDK). Two-step flow:
//   1. saveDraftBuild  — validate + commit the draft as an immutable build
//      (optional commit message); the live game is untouched.
//   2. setActiveBuild  — "publish version": atomically point config/current at a
//      build (also how rollback works — publish an older version).
// The game only ever reads complete immutable builds. Gated to editors by
// firestore.rules (builds: create-only; config: editor write).
import {
	collection,
	deleteField,
	doc,
	getDoc,
	getDocs,
	limit,
	orderBy,
	query,
	setDoc,
	updateDoc
} from 'firebase/firestore';
import { db } from '../firebase/client';
import type { Build } from '../engine/types';
import { assembleBuild, deserializeBuild, serializeBuild } from './build';
import { loadDraft } from './draft';

export interface SaveOutcome {
	buildId?: string;
	errors: string[];
}

/**
 * Validate the draft and commit it as a new immutable build (with an optional
 * commit message). Does NOT touch the live game — the version goes live only
 * when `setActiveBuild` ("publish version") points `config/current` at it.
 */
export async function saveDraftBuild(message?: string): Promise<SaveOutcome> {
	const draft = await loadDraft();
	if (!draft) return { errors: ['No draft content yet — seed or create content first.'] };

	const version = Date.now();
	const { build, errors } = assembleBuild(draft, version, new Date().toISOString());
	if (!build) return { errors };

	const buildId = `build-${version}`;
	const doc_ = serializeBuild(build);
	if (message) doc_.message = message;
	await setDoc(doc(db(), 'builds', buildId), doc_);
	return { buildId, errors: [] };
}

export interface BuildSummary {
	id: string;
	version: number;
	publishedAt: string;
	message?: string;
}

/** The 20 most recent versions, newest first. */
export async function listBuilds(): Promise<BuildSummary[]> {
	const snap = await getDocs(
		query(collection(db(), 'builds'), orderBy('version', 'desc'), limit(20))
	);
	return snap.docs.map((d) => ({
		id: d.id,
		version: d.data().version as number,
		publishedAt: d.data().publishedAt as string,
		message: d.data().message as string | undefined
	}));
}

/** Edit a version's commit message (the only mutable field on a build). */
export async function setBuildMessage(buildId: string, message: string): Promise<void> {
	await updateDoc(doc(db(), 'builds', buildId), {
		message: message.trim() || deleteField()
	});
}

/** Fetch and deserialize one published build snapshot. */
export async function getBuild(buildId: string): Promise<Build> {
	const snap = await getDoc(doc(db(), 'builds', buildId));
	if (!snap.exists()) throw new Error(`Build "${buildId}" not found`);
	return deserializeBuild(snap.data());
}

export async function getActiveBuildId(): Promise<string | undefined> {
	const snap = await getDoc(doc(db(), 'config', 'current'));
	return snap.exists() ? (snap.data().activeBuildId as string | undefined) : undefined;
}

/** Point the live game at a build ("publish version" — also how rollback works). */
export async function setActiveBuild(buildId: string): Promise<void> {
	await setDoc(doc(db(), 'config', 'current'), { activeBuildId: buildId });
}
