<script lang="ts">
	// Like /play, but plays the current DRAFT (all unpublished content + display
	// settings) so changes can be tested before publishing. Requires a signed-in
	// editor, since reading the draft is gated by firestore.rules.
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Game from '$lib/components/Game.svelte';
	import { authStore, initAuth } from '$lib/firebase/auth.svelte';
	import { loadDraft } from '$lib/content/draft';
	import { assembleBuild } from '$lib/content/build';
	import { placeholderBuild } from '$lib/game/placeholderBuild';
	import type { Build } from '$lib/engine/types';

	onMount(() => initAuth());

	async function loadDraftBuild(): Promise<{ build: Build; source: 'draft' | 'placeholder' }> {
		try {
			const draft = await loadDraft();
			if (draft) {
				const { build, errors } = assembleBuild(draft, Date.now(), new Date().toISOString());
				if (build) return { build, source: 'draft' };
				console.warn('[testplay] draft has validation errors:', errors);
			}
		} catch (e) {
			console.warn('[testplay] could not read the draft:', e);
		}
		return { build: placeholderBuild, source: 'placeholder' };
	}
</script>

{#if !authStore.ready}
	<p class="gate">connecting…</p>
{:else if !authStore.user}
	<p class="gate">
		Sign in via the <a href={resolve('/editor')}>editor</a> first to test the unpublished draft.
	</p>
{:else}
	<Game loadBuild={loadDraftBuild} />
{/if}

<style>
	.gate {
		max-width: 32rem;
		margin: 3rem auto;
		padding: 0 1.25rem;
		color: var(--ink);
	}
</style>
