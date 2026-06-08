<script lang="ts">
	import { resolve } from '$app/paths';

	const buildTag = 'M2 · LLM loop · placeholder content';
</script>

<svelte:head>
	<title>Adventure Engine — Scaffold</title>
</svelte:head>

<main>
	<div class="terminal">
		<p class="prompt">ADVENTURE ENGINE · SCAFFOLD</p>
		<h1>LLM POINT-&amp;-CLICK ENGINE</h1>
		<p class="blurb">
			Engine + tooling scaffold for a keyboard-only adventure whose conversations are adjudicated by
			an LLM.
		</p>
		<p class="notice">
			⚠ Placeholder build. Every scene, image, label, and line of text here is a stand-in. The
			client authors all real story and assets in the editor — nothing on screen is final.
		</p>
		<p class="status">[ {buildTag} ]</p>
		<p>
			<a class="enter" href={resolve('/play')}>&gt; Open placeholder demo</a>
			<span class="cursor" aria-hidden="true">_</span>
		</p>
	</div>
</main>

<style>
	main {
		display: grid;
		place-items: center;
		min-height: 100dvh;
		padding: 2rem;
	}

	.terminal {
		max-width: 46rem;
		width: 100%;
		padding: 2rem 2.5rem;
		background: var(--panel);
		border: 1px solid var(--line);
	}

	.prompt {
		margin: 0 0 1.5rem;
		letter-spacing: 0.25em;
		font-size: 0.75rem;
		color: var(--ink-dim);
	}

	h1 {
		margin: 0;
		font-size: clamp(1.6rem, 5vw, 2.6rem);
		letter-spacing: 0.06em;
		color: var(--ink);
	}

	.blurb {
		color: var(--ink);
		line-height: 1.5;
	}

	.notice {
		padding: 0.6rem 0.9rem;
		font-size: 0.85rem;
		line-height: 1.5;
		color: #d8c98a;
		background: #2a2410;
		border: 1px dashed #6b5e2a;
	}

	.status {
		color: var(--ink-dim);
		font-size: 0.85rem;
	}

	.cursor {
		display: inline-block;
		animation: blink 1.1s steps(1) infinite;
	}

	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
</style>
