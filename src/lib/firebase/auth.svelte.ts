// Reactive Firebase Auth state for the editor (client-only). Email/Password.
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { auth } from './client';

export const authStore = $state<{ user: User | null; ready: boolean }>({
	user: null,
	ready: false
});

let started = false;

/** Begin listening to auth state. Idempotent; browser-only. */
export function initAuth() {
	if (started || typeof window === 'undefined') return;
	started = true;
	onAuthStateChanged(auth(), (u) => {
		authStore.user = u;
		authStore.ready = true;
	});
}

export function login(email: string, password: string) {
	return signInWithEmailAndPassword(auth(), email, password);
}

export function logout() {
	return signOut(auth());
}
