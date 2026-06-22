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

const col = () => collection(db(), 'roomStats');

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
