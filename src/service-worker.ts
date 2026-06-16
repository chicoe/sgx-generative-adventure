/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
//
// Offline-first caching for the Raspberry Pi kiosk (SPEC: weak/intermittent
// connection). Two caches:
//  - APP: the SvelteKit app shell + everything in static/ (fonts, boot/intro/
//    outro media) — precached on install. On the kiosk these are served by the
//    Pi's own local Node server, so precaching makes them instant + offline.
//  - MEDIA: Firebase Storage content (scene images, item icons, ambient audio)
//    cached cache-first at runtime AND warmed up-front by the client's preload
//    pass. This is the slow-link content we most want local. Persists across the
//    publish-triggered reload, so a republish only fetches what actually changed.
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const APP_CACHE = `sgx-app-${version}`;
const MEDIA_CACHE = 'sgx-media-v1';
const APP_ASSETS = [...build, ...files];
const APP_PATHS = new Set(APP_ASSETS);

// Install: precache the app shell (resiliently — one bad asset can't block it).
sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(APP_CACHE);
			await Promise.allSettled(APP_ASSETS.map((u) => cache.add(u)));
			await sw.skipWaiting();
		})()
	);
});

// Activate: drop stale app caches (keep MEDIA across versions), take control.
sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== APP_CACHE && key !== MEDIA_CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

const MEDIA_RE = /\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|ogg|mp3|wav|m4a|aac|flac)(\?|$)/i;
function isMedia(url: URL): boolean {
	return url.hostname.includes('firebasestorage') || MEDIA_RE.test(url.pathname);
}

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return; // never touch POSTs (/api/converse) etc.
	const url = new URL(req.url);

	// Same-origin dynamic backend (the converse API) — always network.
	if (url.origin === sw.location.origin && url.pathname.startsWith('/api/')) return;

	// App shell (precached): cache-first.
	if (url.origin === sw.location.origin && APP_PATHS.has(url.pathname)) {
		event.respondWith(caches.match(req).then((r) => r ?? fetch(req)));
		return;
	}

	// Media (Storage images/audio + any media URL): cache-first runtime caching.
	// Everything else (Firestore, etc.) falls through to the network untouched.
	if (isMedia(url)) {
		event.respondWith(cacheFirstMedia(req));
	}
});

async function cacheFirstMedia(req: Request): Promise<Response> {
	const cache = await caches.open(MEDIA_CACHE);
	const cached = await cache.match(req);
	if (cached) return cached; // serve full cached response (also for range reqs)
	try {
		const res = await fetch(req);
		// Cache complete responses (200) or cross-origin opaque ones; skip 206/range
		// and errors so the Cache API never rejects.
		if (res && (res.status === 200 || res.type === 'opaque')) {
			cache.put(req, res.clone()).catch(() => {});
		}
		return res;
	} catch (err) {
		const fallback = await cache.match(req);
		if (fallback) return fallback;
		throw err;
	}
}

// The client prunes the media cache to the active build's assets after each
// preload, so a long-lived kiosk doesn't accumulate orphaned media forever.
sw.addEventListener('message', (event) => {
	const data = event.data as { type?: string; keep?: string[] } | null;
	if (data?.type === 'prune-media' && Array.isArray(data.keep)) {
		const keep = new Set(data.keep);
		event.waitUntil(
			(async () => {
				const cache = await caches.open(MEDIA_CACHE);
				for (const request of await cache.keys()) {
					if (!keep.has(request.url)) await cache.delete(request);
				}
			})()
		);
	}
});
