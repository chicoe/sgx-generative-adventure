<script lang="ts">
	// The rendering seam (SPEC §6): a stack of absolutely-positioned <img> layers
	// with CSS-transform parallax and a CSS filter grade. Pure CSS, no WebGL — a
	// future PixiJS renderer can replace THIS component without touching engine
	// logic. Keep it dumb: it takes a Scene + a look vector and draws.
	import type { Scene, SceneLayer } from '$lib/engine/types';
	import { layerImagePool, pickLayerImage } from '$lib/engine/graph';

	let {
		scene,
		look = { x: 0, y: 0 },
		// How a layer imagePath resolves to a URL. Absolute URLs (Storage download
		// URLs) and rooted paths pass through; bare paths resolve under /static.
		resolve = (path: string) =>
			/^(https?:)?\/\//.test(path) || path.startsWith('/') ? path : `/${path}`,
		// Per-RUN variant choices keyed "sceneId/layerId" (rollLayerImages at game
		// start) — so revisiting a room shows the same art all run. Without it
		// (editor previews) the component rolls locally, stable per mount.
		picks,
		// Max parallax shift in px at full look (×1) and full parallaxFactor. The
		// ending cinematic passes a bigger value for a more pronounced pan.
		amp = 42
	}: {
		scene: Scene;
		look?: { x: number; y: number };
		resolve?: (path: string) => string;
		picks?: Record<string, string>;
		amp?: number;
	} = $props();

	const AMP = $derived(amp);
	// Upscale headroom so a panning layer never reveals the backdrop at its edge.
	// PROPORTIONAL to parallaxFactor AND amp (amp/300 = 0.14 at the default 42), so
	// a static layer (factor 0) stays pixel-crisp and a bigger amp gets the extra
	// headroom it needs.
	const headroomScale = (parallaxFactor: number) => (1 + parallaxFactor * (AMP / 300)).toFixed(3);

	// Which image a multi-image layer shows: the run-level pick when provided
	// (same art all run), else a local pick — stable per mount, re-rolled only
	// if the picked image is removed from the pool (editor preview comfort).
	const localPicks: Record<string, string> = {};
	function srcFor(l: SceneLayer): string | undefined {
		const pool = layerImagePool(l);
		if (!pool.length) return undefined;
		const runPick = picks?.[`${scene.id}/${l.id}`];
		if (runPick && pool.includes(runPick)) return runPick;
		const prev = localPicks[l.id];
		if (prev && pool.includes(prev)) return prev;
		const next = pickLayerImage(l);
		if (next) localPicks[l.id] = next;
		return next;
	}

	const layers = $derived(
		[...scene.layers].sort((a, b) => a.z - b.z).map((l) => ({ ...l, src: srcFor(l) }))
	);
</script>

<div class="viewport" style:filter={scene.filter?.css ?? ''}>
	{#each layers as layer (layer.id)}
		{#if layer.src}
			<img
				class="layer"
				src={resolve(layer.src)}
				alt=""
				style:z-index={layer.z}
				style:transform={`translate3d(${(-look.x * layer.parallaxFactor * AMP).toFixed(2)}px, ${(-look.y * layer.parallaxFactor * AMP).toFixed(2)}px, 0) scale(${headroomScale(layer.parallaxFactor)})`}
			/>
		{/if}
	{/each}

	{#if scene.filter?.overlay}
		<div
			class="overlay"
			style:background={scene.filter.overlay}
			style:mix-blend-mode={scene.filter.blendMode ?? 'normal'}
		></div>
	{/if}
</div>

<style>
	.viewport {
		position: absolute;
		inset: 0;
		overflow: hidden;
		/* transparent so the image blends straight into the frame's backdrop */
		background: transparent;
	}

	.layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		/* The whole image stays visible (no cropping), anchored RIGHT — a narrower
		   image leaves backdrop-coloured space at the left, under the HUD. */
		object-fit: contain;
		object-position: right center;
		will-change: transform;
	}

	.overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 50;
	}
</style>
