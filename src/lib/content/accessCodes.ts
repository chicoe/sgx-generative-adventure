// Access codes gate the public game. The editor manages them (list/create/delete,
// gated by firestore.rules isEditor()); the player side (check / spend a life)
// uses scoped public rules: anyone may `get` a code they know and atomically
// decrement its lives by one, nothing else.
import {
	collection,
	deleteDoc,
	doc,
	getDoc,
	getDocs,
	runTransaction,
	setDoc
} from 'firebase/firestore';
import { db } from '../firebase/client';

export interface AccessCode {
	code: string; // normalized (uppercase) — also the doc id
	lives: number; // remaining
	livesTotal: number; // as created
	createdAt: string; // ISO
}

const col = () => collection(db(), 'accessCodes');
const normalize = (code: string) => code.trim().toUpperCase();

// Unambiguous alphabet (no 0/O/1/I) for human-friendly codes.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomCode(length = 4): string {
	let out = '';
	for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
	return out;
}

export async function listAccessCodes(): Promise<AccessCode[]> {
	const snap = await getDocs(col());
	return snap.docs
		.map((d) => d.data() as AccessCode)
		.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** Generate a code not already in `existing` (falls back to a longer one). */
export function generateUniqueCode(existing: string[], length = 4): string {
	const taken = new Set(existing.map(normalize));
	for (let i = 0; i < 200; i++) {
		const c = randomCode(length);
		if (!taken.has(c)) return c;
	}
	return randomCode(length + 2); // virtually-certain fallback
}

/** Create a code (min 4 chars, unique). Throws if it already exists / too short. */
export async function createAccessCode(rawCode: string, lives: number): Promise<AccessCode> {
	const code = normalize(rawCode);
	if (code.length < 4) throw new Error('Code must be at least 4 characters.');
	if (!/^[A-Z0-9]+$/.test(code)) throw new Error('Code must be letters and digits only.');
	const lifeCount = Math.max(1, Math.floor(lives) || 0);
	const ref = doc(col(), code);
	if ((await getDoc(ref)).exists()) throw new Error(`Code "${code}" already exists.`);
	const record: AccessCode = {
		code,
		lives: lifeCount,
		livesTotal: lifeCount,
		createdAt: new Date().toISOString()
	};
	await setDoc(ref, record);
	return record;
}

export async function deleteAccessCode(code: string): Promise<void> {
	await deleteDoc(doc(col(), normalize(code)));
}

// --- player side ----------------------------------------------------------

export interface AccessResult {
	ok: boolean;
	reason: 'unknown' | 'depleted' | 'error' | null;
	lives: number;
}

/** Does this code exist and have a life left? Read-only (no mutation). */
export async function checkAccessCode(rawCode: string): Promise<AccessResult> {
	try {
		const snap = await getDoc(doc(col(), normalize(rawCode)));
		if (!snap.exists()) return { ok: false, reason: 'unknown', lives: 0 };
		const lives = (snap.data() as AccessCode).lives ?? 0;
		return { ok: lives > 0, reason: lives > 0 ? null : 'depleted', lives };
	} catch {
		return { ok: false, reason: 'error', lives: 0 };
	}
}

/** Spend one life atomically (a transaction, so simultaneous starts can't overspend). */
export async function spendAccessLife(rawCode: string): Promise<AccessResult> {
	const ref = doc(col(), normalize(rawCode));
	try {
		return await runTransaction(db(), async (tx) => {
			const snap = await tx.get(ref);
			if (!snap.exists()) return { ok: false, reason: 'unknown' as const, lives: 0 };
			const lives = (snap.data() as AccessCode).lives ?? 0;
			if (lives <= 0) return { ok: false, reason: 'depleted' as const, lives: 0 };
			tx.update(ref, { lives: lives - 1 });
			return { ok: true, reason: null, lives: lives - 1 };
		});
	} catch {
		return { ok: false, reason: 'error', lives: 0 };
	}
}
