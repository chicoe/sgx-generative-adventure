// Tracks whether the editor draft differs from the live published build, so the
// editor can warn about unpublished changes. Client-only (browser SDK reads).
import type { Build } from '../engine/types';
import type { DraftContent } from './build';
import { loadDraft } from './draft';
import { loadActiveBuild } from './loader';

// Stable stringify: object keys sorted recursively (array order is preserved) so
// the comparison ignores key-ordering differences between Firestore reads and a
// build's stored JSON payload.
function stable(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
	if (v && typeof v === 'object') {
		const o = v as Record<string, unknown>;
		return `{${Object.keys(o)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
			.join(',')}}`;
	}
	return JSON.stringify(v) ?? 'null';
}

const byId = <T extends { id: string }>(arr: T[]): T[] =>
	[...arr].sort((a, b) => a.id.localeCompare(b.id));

// A content signature that ignores build meta (version/publishedAt) and the order
// of the top-level collections.
function signature(c: {
	scenes: { id: string }[];
	items: { id: string }[];
	behaviours: { id: string }[];
	startSceneId?: string;
	defaultBehaviourId?: string;
	display?: unknown;
}): string {
	return stable({
		startSceneId: c.startSceneId ?? '',
		defaultBehaviourId: c.defaultBehaviourId ?? '',
		display: c.display ?? null,
		scenes: byId(c.scenes),
		items: byId(c.items),
		behaviours: byId(c.behaviours)
	});
}

const draftSig = (d: DraftContent) =>
	signature({
		scenes: d.scenes,
		items: d.items,
		behaviours: d.behaviours,
		startSceneId: d.meta.startSceneId,
		defaultBehaviourId: d.meta.defaultBehaviourId,
		display: d.meta.display
	});
const buildSig = (b: Build) =>
	signature({
		scenes: b.scenes,
		items: b.items,
		behaviours: b.behaviours,
		startSceneId: b.meta.startSceneId,
		defaultBehaviourId: b.meta.defaultBehaviourId,
		display: b.meta.display
	});

class DraftStatus {
	dirty = $state(false);
	checked = $state(false);
	checking = $state(false);

	/** Recompute whether the draft differs from the live published build. */
	async check(): Promise<void> {
		this.checking = true;
		try {
			const draft = await loadDraft();
			if (!draft) {
				this.dirty = false;
			} else {
				const { build, source } = await loadActiveBuild();
				// No published build yet → any draft content is "unpublished".
				this.dirty =
					source !== 'firestore'
						? draft.scenes.length + draft.items.length + draft.behaviours.length > 0
						: draftSig(draft) !== buildSig(build);
			}
			this.checked = true;
		} catch {
			// Network hiccup: keep the previous state rather than asserting something wrong.
		} finally {
			this.checking = false;
		}
	}

	/** Optimistically flag changes (e.g. right after a save), before the next check. */
	markDirty(): void {
		this.dirty = true;
		this.checked = true;
	}
}

export const draftStatus = new DraftStatus();
