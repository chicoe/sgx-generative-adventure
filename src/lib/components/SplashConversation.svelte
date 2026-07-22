<script lang="ts">
	// A standalone splash screen that types out a short scripted conversation in the
	// game's own framed CRT window (palette + backdrop + scanlines from the live
	// published build). Reusable: each /splashN route passes its own `lines`.
	import { onMount } from 'svelte';
	import { loadActiveBuild } from '$lib/content/loader';
	import { DEFAULT_DISPLAY, themeStyle, crtBackground } from '$lib/theme';
	import type { DisplaySettings } from '$lib/engine/types';

	let {
		// One string per line; they type out and stack, in order. A line like "..."
		// simply types as three dots — a natural beat between spoken lines.
		lines = [],
		charMs = 45, // per-character typing speed
		linePauseMs = 550, // pause after a line finishes before the next begins
		startDelayMs = 500 // beat before the first character
	}: {
		lines?: string[];
		charMs?: number;
		linePauseMs?: number;
		startDelayMs?: number;
	} = $props();

	// --- theme / frame (same framed window as the game and the code gate) --------
	let display = $state<DisplaySettings | null>(null);
	let scale = $state(1);
	function computeScale() {
		const dd = display ?? DEFAULT_DISPLAY;
		scale = Math.min(1, window.innerWidth / dd.width, window.innerHeight / dd.height);
	}
	const d = $derived(display ?? DEFAULT_DISPLAY);
	const backdrop = $derived(d.backdrop ?? '#000000');
	const crtBg = $derived(crtBackground(d.crt));
	const framePlacement = $derived(
		`width:${d.width}px;height:${d.height}px;left:50%;top:50%;` +
			`transform:translate(calc(-50% + ${d.offsetX ?? 0}px), calc(-50% + ${d.offsetY ?? 0}px)) scale(${scale});transform-origin:center`
	);
	// No duotone SVG filter here (like the gate) — full colour maps ui → ink.
	const frameStyle = $derived(
		`${themeStyle({ ...d, mode: 'full' })};background:${d.bg};${framePlacement}`
	);

	// --- typewriter --------------------------------------------------------------
	let shown = $state<string[]>([]); // finished lines
	let current = $state(''); // the line currently typing
	let done = $state(false);
	let started = false;
	let timers: ReturnType<typeof setTimeout>[] = [];

	function type(lineIdx: number, charIdx: number) {
		const line = lines[lineIdx];
		if (line === undefined) {
			done = true;
			return;
		}
		if (charIdx < line.length) {
			current = line.slice(0, charIdx + 1);
			timers.push(setTimeout(() => type(lineIdx, charIdx + 1), charMs));
		} else if (lineIdx + 1 >= lines.length) {
			done = true; // last line fully typed — leave the cursor blinking
		} else {
			timers.push(
				setTimeout(() => {
					shown = [...shown, line];
					current = '';
					type(lineIdx + 1, 0);
				}, linePauseMs)
			);
		}
	}

	onMount(() => {
		(async () => {
			try {
				const { build } = await loadActiveBuild();
				display = build.meta.display ?? DEFAULT_DISPLAY;
			} catch {
				display = DEFAULT_DISPLAY;
			}
		})();
		computeScale();
		window.addEventListener('resize', computeScale);
		return () => {
			window.removeEventListener('resize', computeScale);
			timers.forEach(clearTimeout);
		};
	});
	// Begin typing once the frame is visible (display loaded), so no characters are
	// drawn under the still-black boot frame.
	$effect(() => {
		if (display && !started) {
			started = true;
			timers.push(setTimeout(() => type(0, 0), startDelayMs));
		}
	});
</script>

<main class="letterbox" style:background={backdrop}>
	<div class="frame" style={frameStyle}>
		{#if display}
			<div class="splash">
				{#each shown as line, i (i)}
					<p class="line">{line}</p>
				{/each}
				<p class="line">{current}<span class="cursor" class:solid={!done}>█</span></p>
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
	.frame {
		position: absolute;
		overflow: hidden;
		font-family: var(--font-terminal, monospace);
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
	.splash {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 1.2rem;
		padding: 2rem 2.6rem;
		color: var(--ink);
		text-shadow: var(--glow);
	}
	.line {
		margin: 0;
		font-family: var(--font-terminal, monospace);
		font-size: 2.1rem;
		letter-spacing: 0.05em;
		line-height: 1.1;
		white-space: pre-wrap;
	}
	.cursor {
		animation: blink 1.05s steps(1) infinite;
	}
	/* Solid (no blink) while actively typing; blinks during pauses / at the end. */
	.cursor.solid {
		animation: none;
	}
	@keyframes blink {
		0%,
		49% {
			opacity: 1;
		}
		50%,
		100% {
			opacity: 0;
		}
	}
</style>
