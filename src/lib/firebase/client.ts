// Browser Firebase SDK init. Safe to import in client code.
// Config comes from PUBLIC_FIREBASE_CONFIG (a JSON string); it is public by design.
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { env } from '$env/dynamic/public';

function readConfig(): Record<string, string> {
	const raw = env.PUBLIC_FIREBASE_CONFIG;
	if (!raw) throw new Error('PUBLIC_FIREBASE_CONFIG is not set');
	return JSON.parse(raw);
}

export function firebaseApp(): FirebaseApp {
	return getApps().length ? getApp() : initializeApp(readConfig());
}

export function auth(): Auth {
	return getAuth(firebaseApp());
}

export function db(): Firestore {
	return getFirestore(firebaseApp());
}

export function storage(): FirebaseStorage {
	return getStorage(firebaseApp());
}
