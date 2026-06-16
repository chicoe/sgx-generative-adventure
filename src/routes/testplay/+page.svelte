<script lang="ts">
	// Like /play, but plays the current DRAFT (all unpublished content + display
	// settings) so changes can be tested before publishing. Requires a signed-in
	// editor, since reading the draft is gated by firestore.rules.
	//
	// If the draft fails validation we DON'T silently fall back to the placeholder
	// build (that looks like a different game — wrong palette/resolution); instead
	// we show the errors so they can be fixed (e.g. "Clean up references").
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Game from '$lib/components/Game.svelte';
	import { authStore, initAuth } from '$lib/firebase/auth.svelte';
	import { loadDraft } from '$lib/content/draft';
	import { assembleBuild } from '$lib/content/build';
	import type { Build } from '$lib/engine/types';

	type State =
		| { kind: 'loading' }
		| { kind: 'empty' }
		| { kind: 'errors'; errors: string[] }
		| { kind: 'failed'; message: string }
		| { kind: 'ready'; build: Build };
	let state = $state<State>({ kind: 'loading' });

	onMount(() => initAuth());

	// Assemble the draft once the editor is signed in.
	let prepared = false;
	$effect(() => {
		if (authStore.ready && authStore.user && !prepared) {
			prepared = true;
			void prepare();
		}
	});

	async function prepare() {
		try {
			const draft = await loadDraft();
			if (!draft) {
				state = { kind: 'empty' };
				return;
			}
			const { build, errors } = assembleBuild(draft, Date.now(), new Date().toISOString());
			if (build) state = { kind: 'ready', build };
			else state = { kind: 'errors', errors };
		} catch (e) {
			state = { kind: 'failed', message: e instanceof Error ? e.message : String(e) };
		}
	}

	const readyBuild = $derived(state.kind === 'ready' ? state.build : null);
</script>

{#if !authStore.ready}
	<p class="gate">connecting…</p>
{:else if !authStore.user}
	<p class="gate">
		Sign in via the <a href={resolve('/editor')}>editor</a> first to test the unpublished draft.
	</p>
{:else if state.kind === 'loading'}
	<p class="gate">assembling the draft…</p>
{:else if state.kind === 'empty'}
	<p class="gate">No draft yet — author content in the <a href={resolve('/editor')}>editor</a>.</p>
{:else if state.kind === 'failed'}
	<p class="gate">Couldn’t read the draft: {state.message}</p>
{:else if state.kind === 'errors'}
	<div class="gate errs">
		<h1>Draft can’t be played yet</h1>
		<p>
			Fix these in the <a href={resolve('/editor')}>editor</a> — most reference issues are cleared
			by
			<strong>“Clean up references”</strong> on the Overview page — then it will play with your settings:
		</p>
		<ul>
			{#each state.errors as e, i (i)}<li>{e}</li>{/each}
		</ul>
	</div>
{:else if readyBuild}
	<Game
		loadBuild={async () => ({ build: readyBuild, source: 'draft' as const })}
		reloadOnPublish={false}
	/>
{/if}

<style>
	.gate {
		max-width: 40rem;
		margin: 3rem auto;
		padding: 0 1.25rem;
		color: var(--ink);
	}
	.errs h1 {
		font-size: 1.2rem;
		color: #e0a8a8;
	}
	.errs ul {
		margin-top: 0.6rem;
		padding-left: 1.1rem;
	}
	.errs li {
		margin: 0.25rem 0;
		font-size: 0.9rem;
	}
</style>
