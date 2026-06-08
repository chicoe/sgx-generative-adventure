// Loads the active published Build for the game (SPEC §4.6, §M3). Reads
// config/current -> builds/{activeBuildId} via the browser SDK (both are
// world-readable). Falls back to the in-repo placeholderBuild whenever nothing
// is published or Firestore is unreachable, so the game always runs.
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/client';
import { deserializeBuild } from './build';
import { placeholderBuild } from '../game/placeholderBuild';
import type { Build } from '../engine/types';

export interface LoadedBuild {
	build: Build;
	source: 'firestore' | 'placeholder';
	buildId?: string;
}

export async function loadActiveBuild(): Promise<LoadedBuild> {
	try {
		const cfg = await getDoc(doc(db(), 'config', 'current'));
		const activeBuildId = cfg.exists()
			? (cfg.data().activeBuildId as string | undefined)
			: undefined;
		if (!activeBuildId) return { build: placeholderBuild, source: 'placeholder' };

		const snap = await getDoc(doc(db(), 'builds', activeBuildId));
		if (!snap.exists()) return { build: placeholderBuild, source: 'placeholder' };

		return { build: deserializeBuild(snap.data()), source: 'firestore', buildId: activeBuildId };
	} catch (err) {
		console.error(
			'[loader] loadActiveBuild failed; using placeholder:',
			err instanceof Error ? err.message : err
		);
		return { build: placeholderBuild, source: 'placeholder' };
	}
}
