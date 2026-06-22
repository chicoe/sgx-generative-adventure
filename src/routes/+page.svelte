<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { checkAccessCode } from '$lib/content/accessCodes';
	import { loadActiveBuild } from '$lib/content/loader';
	import { DEFAULT_DISPLAY, themeStyle } from '$lib/theme';
	import type { DisplaySettings } from '$lib/engine/types';

	let code = $state('');
	let error = $state('');
	let busy = $state(false);
	// Match the gate to the published build's UI colour. null until loaded (the
	// form is held back so it never flashes the default amber palette first).
	let display = $state<DisplaySettings | null>(null);
	onMount(async () => {
		try {
			const { build, source } = await loadActiveBuild();
			// If the gate is amber but the game is green, watch this log: source
			// 'placeholder' means no published build was read (the gate falls back to
			// the amber default); 'firestore' with an amber palette means the PUBLISHED
			// build is amber (publish the green settings to update it).
			console.info(`[gate] build source=${source}, ui=${build.meta.display?.ui ?? '(default)'}`);
			display = build.meta.display ?? DEFAULT_DISPLAY;
		} catch (e) {
			console.warn('[gate] could not load build palette; using default:', e);
			display = DEFAULT_DISPLAY;
		}
	});
	// The gate has no duotone SVG filter, so render the two chosen colours as a
	// straight full-colour palette (ui → ink) regardless of the build's mode.
	const gateStyle = $derived(themeStyle({ ...(display ?? DEFAULT_DISPLAY), mode: 'full' }));

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const c = code.trim().toUpperCase();
		if (c.length < 4) {
			error = 'Enter your access code.';
			return;
		}
		busy = true;
		error = '';
		const res = await checkAccessCode(c);
		busy = false;
		if (res.ok) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			goto(`${resolve('/play')}?code=${encodeURIComponent(c)}`);
		} else if (res.reason === 'depleted') {
			error = 'That code has no plays left.';
		} else if (res.reason === 'unknown') {
			error = 'Unknown code.';
		} else {
			error = 'Could not check the code — please try again.';
		}
	}
</script>

<svelte:head><title>Adventure Engine</title></svelte:head>

<main class="gate" style={gateStyle}>
	{#if display}
		<form class="box" onsubmit={submit}>
			<p class="title">ARGOS Alpha test program</p>
			<p class="prompt">type your access code to start</p>
			<input
				bind:value={code}
				oninput={() => (code = code.toUpperCase())}
				maxlength="24"
				autocomplete="off"
				spellcheck="false"
				placeholder="• • • •"
				aria-label="access code"
			/>
			<button type="submit" disabled={busy || code.trim().length < 4}>
				{busy ? 'checking…' : 'begin'}
			</button>
			{#if error}<p class="error">{error}</p>{/if}
		</form>
	{/if}
</main>

<style>
	.gate {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		background: var(--bg);
		font-family: var(--font-terminal, monospace);
	}
	.box {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 2rem;
		min-width: 18rem;
	}
	.title {
		margin: 0;
		color: var(--ink);
		letter-spacing: 0.18em;
		font-size: 1.1rem;
		text-shadow: var(--glow);
	}
	.prompt {
		margin: 0 0 0.4rem;
		color: var(--ink-dim);
		letter-spacing: 0.18em;
		font-size: 0.85rem;
	}
	input {
		width: 12rem;
		text-align: center;
		font: inherit;
		font-size: 1.6rem;
		letter-spacing: 0.4em;
		text-transform: uppercase;
		color: var(--ink);
		background: transparent;
		border: none;
		border-bottom: 2px solid var(--line);
		padding: 0.4rem 0;
		outline: none;
		text-shadow: var(--glow);
	}
	input:focus {
		border-bottom-color: var(--accent);
	}
	input::placeholder {
		color: var(--ink-dim);
		letter-spacing: 0.3em;
		opacity: 0.5;
	}
	button {
		font: inherit;
		letter-spacing: 0.2em;
		color: var(--bg);
		background: var(--ink);
		border: none;
		padding: 0.55rem 1.6rem;
		cursor: pointer;
		text-transform: uppercase;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.error {
		margin: 0;
		color: #e0a8a8;
		font-size: 0.85rem;
		letter-spacing: 0.08em;
	}
</style>
