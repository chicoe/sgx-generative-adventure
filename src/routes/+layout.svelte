<script lang="ts">
	import { onMount } from 'svelte';
	import { dev } from '$app/environment';
	import { base } from '$app/paths';
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';

	let { children } = $props();

	// Register the offline-caching service worker (images/audio/app shell). The
	// kiosk's weak connection then only matters on first load; reloads are local.
	onMount(() => {
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker
				.register(`${base}/service-worker.js`, { type: dev ? 'module' : 'classic' })
				.catch(() => {});
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
