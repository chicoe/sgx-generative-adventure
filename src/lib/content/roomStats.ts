// Room-entry stats. Every time a player lands in a scene during a real (published)
// run, the game bumps that scene's counter by one. The editor's access page reads
// the counters to show how often each room was entered and how many players reached
// each ending. Counters (not an append log) keep this to one small doc per scene.
//
// The player side is unauthenticated, so firestore.rules scopes the public write
// to a single +1 on `count` and nothing else (see the roomStats match block).
import { collection, doc, getDocs, increment, setDoc } from 'firebase/firestore';
import { db } from '../firebase/client';

export interface RoomStat {
	sceneId: string;
	count: number;
}

// Per-code ending tally: how many times runs on a given access code reached a
// given ending scene. One counter doc per (code, sceneId).
export interface EndingStat {
	code: string;
	sceneId: string;
	count: number;
}

const col = () => collection(db(), 'roomStats');
const endCol = () => collection(db(), 'endingStats');

// Firestore doc ids can't be empty or contain '/'. Scene ids are author-defined,
// so guard rather than trust them.
const validId = (id: string) => !!id && !id.includes('/') && id !== '.' && id !== '..';

/** Record one entry into a scene. Best-effort — never throws into the caller. */
export async function logRoomEntry(sceneId: string): Promise<void> {
	if (!validId(sceneId)) return;
	try {
		await setDoc(doc(col(), sceneId), { sceneId, count: increment(1) }, { merge: true });
	} catch {
		/* stats are best-effort — a failure must never disrupt the game */
	}
}

/** Every scene's entry counter (editor-gated read). */
export async function loadRoomStats(): Promise<RoomStat[]> {
	const snap = await getDocs(col());
	return snap.docs.map((d) => {
		const data = d.data() as Partial<RoomStat>;
		return { sceneId: data.sceneId ?? d.id, count: data.count ?? 0 };
	});
}

/** Record that a run on `code` reached ending scene `sceneId`. Best-effort. */
export async function logEndingForCode(code: string, sceneId: string): Promise<void> {
	if (!validId(code) || !validId(sceneId)) return;
	try {
		// code is [A-Z0-9] (no underscores), so the first "__" cleanly separates it
		// from the sceneId; the fields are stored too, so the id need not be parsed.
		await setDoc(
			doc(endCol(), `${code}__${sceneId}`),
			{ code, sceneId, count: increment(1) },
			{ merge: true }
		);
	} catch {
		/* best-effort — never disrupt the game */
	}
}

/** Per-(code, ending) counters (editor-gated read). */
export async function loadEndingStats(): Promise<EndingStat[]> {
	const snap = await getDocs(endCol());
	return snap.docs.map((d) => {
		const data = d.data() as Partial<EndingStat>;
		return { code: data.code ?? '', sceneId: data.sceneId ?? '', count: data.count ?? 0 };
	});
}
