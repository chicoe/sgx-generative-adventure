<script lang="ts">
	// The rendering seam (SPEC §6): a stack of absolutely-positioned <img> layers
	// with CSS-transform parallax and a CSS filter grade. Pure CSS, no WebGL — a
	// future PixiJS renderer can replace THIS component without touching engine
	// logic. Keep it dumb: it takes a Scene + a look vector and draws.
	import type { Scene } from '$lib/engine/types';

	let {
		scene,
		look = { x: 0, y: 0 },
		// How a layer imagePath resolves to a URL. Absolute URLs (Storage download
		// URLs) and rooted paths pass through; bare paths resolve under /static.
		resolve = (path: string) =>
			/^(https?:)?\/\//.test(path) || path.startsWith('/') ? path : `/${path}`
	}: {
		scene: Scene;
		look?: { x: number; y: number };
		resolve?: (path: string) => string;
	} = $props();

	// Max parallax shift in px at full look (×1) and full parallaxFactor.
	const AMP = 42;

	const layers = $derived([...scene.layers].sort((a, b) => a.z - b.z));
</script>

<div class="viewport" style:filter={scene.filter?.css ?? ''}>
	{#each layers as layer (layer.id)}
		<img
			class="layer"
			src={resolve(layer.imagePath)}
			alt=""
			style:z-index={layer.z}
			style:transform={`translate3d(${(-look.x * layer.parallaxFactor * AMP).toFixed(2)}px, ${(-look.y * layer.parallaxFactor * AMP).toFixed(2)}px, 0) scale(1.12)`}
		/>
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
		background: #02080c;
	}

	.layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		will-change: transform;
	}

	.overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 50;
	}
</style>
