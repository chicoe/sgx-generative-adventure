// Up-front media preloading for the kiosk: before the game starts we download
// (and, for images, decode) every asset the active build references, so that on
// a weak connection the experience is fully cached and smooth afterwards. The
// service worker keeps these cached across reloads; this pass warms it and the
// browser's decoded-image cache. Best-effort: a missing/slow asset is skipped
// (the runtime still loads it on demand) and never blocks the boot indefinitely.
import type { Build } from '../engine/types';
import { layerImagePool } from '../engine/graph';

// Resolve a stored path the way SceneRenderer / the editor do: absolute URLs and
// rooted paths pass through; bare paths resolve under /static.
function resolveUrl(p: string): string {
	if (!p) return '';
	return /^(https?:)?\/\//.test(p) || p.startsWith('/') ? p : `/${p}`;
}

/**
 * Every media URL a build references: scene layer images (ALL variants), item
 * icons, and scene ambient audio. Deduped and resolved to load URLs. Pure.
 */
export function collectBuildAssets(build: Build): string[] {
	const urls = new Set<string>();
	for (const scene of build.scenes) {
		for (const layer of scene.layers) for (const img of layerImagePool(layer)) urls.add(img);
		if (scene.ambientSound?.trim()) urls.add(scene.ambientSound);
		if (scene.endingBackgrounds)
			for (const eb of scene.endingBackgrounds) if (eb.src?.trim()) urls.add(eb.src);
	}
	for (const item of build.items) if (item.iconPath?.trim()) urls.add(item.iconPath);
	return [...urls].map(resolveUrl).filter(Boolean);
}

const AUDIO_RE = /\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error('preload timeout')), ms);
		p.then(
			(v) => {
				clearTimeout(t);
				resolve(v);
			},
			(e) => {
				clearTimeout(t);
				reject(e);
			}
		);
	});
}

async function preloadOne(url: string): Promise<void> {
	if (AUDIO_RE.test(url)) {
		// Warm the (service-worker / HTTP) cache; no decode needed for audio.
		await fetch(url, { mode: 'no-cors' });
		return;
	}
	// Image: download AND decode so the first paint of the scene is instant.
	const img = new Image();
	img.src = url;
	if (typeof img.decode === 'function') {
		await img.decode();
	} else {
		await new Promise<void>((res, rej) => {
			img.onload = () => res();
			img.onerror = () => rej(new Error('image load failed'));
		});
	}
}

/** Run `fn` over `items`, at most `limit` in flight at once. */
async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
	const queue = items.slice();
	const worker = async () => {
		for (let next = queue.shift(); next !== undefined; next = queue.shift()) await fn(next);
	};
	await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
}

/**
 * Preload every URL (limited concurrency), calling `onProgress(done, total)` as
 * each finishes. Never rejects: a failed/slow asset (per-asset timeout) is just
 * skipped. Resolves once all are done — the caller can race an overall timeout.
 */
export async function preloadAssets(
	urls: string[],
	onProgress?: (done: number, total: number) => void,
	opts: { concurrency?: number; perAssetTimeoutMs?: number } = {}
): Promise<void> {
	const { concurrency = 6, perAssetTimeoutMs = 15000 } = opts;
	const total = urls.length;
	let done = 0;
	onProgress?.(0, total);
	await pool(urls, concurrency, async (url) => {
		try {
			await withTimeout(preloadOne(url), perAssetTimeoutMs);
		} catch {
			/* skip — the runtime will load it on demand */
		} finally {
			done += 1;
			onProgress?.(done, total);
		}
	});
}
