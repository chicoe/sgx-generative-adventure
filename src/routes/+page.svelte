<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { checkAccessCode } from '$lib/content/accessCodes';
	import { loadActiveBuild } from '$lib/content/loader';
	import { DEFAULT_DISPLAY, themeStyle, crtBackground } from '$lib/theme';
	import type { DisplaySettings } from '$lib/engine/types';

	let code = $state('');
	let error = $state('');
	let busy = $state(false);
	// The code field — auto-focused so a keyboard-only kiosk can type immediately.
	let inputEl = $state<HTMLInputElement>();
	// Match the gate to the published build's UI colour. null until loaded (the
	// form is held back so it never flashes the default amber palette first).
	let display = $state<DisplaySettings | null>(null);
	onMount(() => {
		(async () => {
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
		})();
		computeScale();
		// Keep keyboard focus on the code field — if the window/WM hands focus back
		// (kiosk boot), pull it into the input so typing the code works.
		const refocus = () => inputEl?.focus();
		window.addEventListener('resize', computeScale);
		window.addEventListener('focus', refocus);
		return () => {
			window.removeEventListener('resize', computeScale);
			window.removeEventListener('focus', refocus);
		};
	});
	// Focus the field as soon as it renders (the form appears once the build loads).
	$effect(() => {
		inputEl?.focus();
	});

	// Render the same framed window as the game: a backdrop-coloured letterbox with
	// a centered frame at the build's resolution (scaled to fit, never up past 1:1),
	// the palette bg inside, and the CRT overlay on top. The gate has no duotone SVG
	// filter, so the palette is rendered as straight full colour (ui → ink).
	const d = $derived(display ?? DEFAULT_DISPLAY);
	const backdrop = $derived(d.backdrop ?? '#000000');
	const crtBg = $derived(crtBackground(d.crt));
	let scale = $state(1);
	function computeScale() {
		const dd = display ?? DEFAULT_DISPLAY;
		scale = Math.min(1, window.innerWidth / dd.width, window.innerHeight / dd.height);
	}
	// Refit once the live build's resolution loads.
	$effect(() => {
		void [d.width, d.height];
		computeScale();
	});
	const framePlacement = $derived(
		`width:${d.width}px;height:${d.height}px;left:50%;top:50%;` +
			`transform:translate(calc(-50% + ${d.offsetX ?? 0}px), calc(-50% + ${d.offsetY ?? 0}px)) scale(${scale});transform-origin:center`
	);
	const frameStyle = $derived(
		`${themeStyle({ ...d, mode: 'full' })};background:${d.bg};${framePlacement}`
	);

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
			// Carry the kiosk tag through so /play resumes up-front preloading.
			const kiosk = new URLSearchParams(window.location.search).has('kiosk');
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			goto(`${resolve('/play')}?code=${encodeURIComponent(c)}${kiosk ? '&kiosk=1' : ''}`);
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

<main class="letterbox" style:background={backdrop}>
	<div class="frame" style={frameStyle}>
		{#if display}
			<div class="gate-content">
				<form class="box" onsubmit={submit}>
					<p class="title">ARGOS alpha test program</p>
					<p class="prompt">type your access code to start</p>
					<input
						bind:this={inputEl}
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
			</div>
		{/if}
		<div class="crt" aria-hidden="true" style:background={crtBg}></div>
	</div>
</main>

<style>
	.letterbox {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: #000;
	}
	/* The window renders at the build's resolution; size + placement + theme colours
	   come from the inline frameStyle (scaled to fit, never up past 1:1). */
	.frame {
		position: absolute;
		overflow: hidden;
		font-family: var(--font-terminal, monospace);
	}
	.gate-content {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
	}
	.crt {
		position: absolute;
		inset: 0;
		z-index: 100;
		pointer-events: none;
		animation: crt-flicker 4s infinite;
	}
	@keyframes crt-flicker {
		0%,
		97%,
		100% {
			opacity: 1;
		}
		98% {
			opacity: 0.82;
		}
		99% {
			opacity: 0.94;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.crt {
			animation: none;
		}
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
