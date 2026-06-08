// Server-only Firebase Admin SDK init. NEVER import this from client code.
// Importing `$env/dynamic/private` makes SvelteKit fail the build if this file
// is pulled into the client bundle, which is the guard we want.
import { initializeApp, getApps, cert, applicationDefault, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { env } from '$env/dynamic/private';

let app: App | undefined;

export function adminApp(): App {
	if (app) return app;
	const existing = getApps();
	if (existing.length) {
		app = existing[0];
		return app;
	}
	// On Firebase App Hosting / GCP, Application Default Credentials are available,
	// so FIREBASE_ADMIN_CREDENTIALS is only needed for local development.
	const raw = env.FIREBASE_ADMIN_CREDENTIALS;
	app = initializeApp({
		credential: raw ? cert(JSON.parse(raw)) : applicationDefault()
	});
	return app;
}

export function adminDb(): Firestore {
	return getFirestore(adminApp());
}

export function adminStorage() {
	return getStorage(adminApp());
}
