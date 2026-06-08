// Publish/rollback from the editor (browser SDK). Validates + assembles the
// draft, then writes the new immutable build and flips config/current in one
// atomic batch — so the live game never sees a half-written build. Gated to
// editors by firestore.rules (builds: create-only; config: editor write).
import {
	collection,
	doc,
	getDoc,
	getDocs,
	orderBy,
	query,
	setDoc,
	writeBatch
} from 'firebase/firestore';
import { db } from '../firebase/client';
import { assembleBuild, serializeBuild } from './build';
import { loadDraft } from './draft';

export interface PublishOutcome {
	buildId?: string;
	errors: string[];
}

export async function publishDraftClient(): Promise<PublishOutcome> {
	const draft = await loadDraft();
	if (!draft) return { errors: ['No draft content yet — seed or create content first.'] };

	const version = Date.now();
	const { build, errors } = assembleBuild(draft, version, new Date().toISOString());
	if (!build) return { errors };

	const buildId = `build-${version}`;
	const batch = writeBatch(db());
	batch.set(doc(db(), 'builds', buildId), serializeBuild(build));
	batch.set(doc(db(), 'config', 'current'), { activeBuildId: buildId });
	await batch.commit();
	return { buildId, errors: [] };
}

export interface BuildSummary {
	id: string;
	version: number;
	publishedAt: string;
}

export async function listBuilds(): Promise<BuildSummary[]> {
	const snap = await getDocs(query(collection(db(), 'builds'), orderBy('version', 'desc')));
	return snap.docs.map((d) => ({
		id: d.id,
		version: d.data().version as number,
		publishedAt: d.data().publishedAt as string
	}));
}

export async function getActiveBuildId(): Promise<string | undefined> {
	const snap = await getDoc(doc(db(), 'config', 'current'));
	return snap.exists() ? (snap.data().activeBuildId as string | undefined) : undefined;
}

export async function rollbackTo(buildId: string): Promise<void> {
	await setDoc(doc(db(), 'config', 'current'), { activeBuildId: buildId });
}
