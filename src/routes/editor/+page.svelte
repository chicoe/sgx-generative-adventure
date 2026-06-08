<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { loadDraft, seedDraftFromBuild } from '$lib/content/draft';
	import {
		publishDraftClient,
		listBuilds,
		rollbackTo,
		getActiveBuildId,
		type BuildSummary
	} from '$lib/content/publishClient';
	import { placeholderBuild } from '$lib/game/placeholderBuild';
	import type { DraftContent } from '$lib/content/build';

	let draft = $state<DraftContent | null>(null);
	let builds = $state<BuildSummary[]>([]);
	let activeBuildId = $state<string | undefined>(undefined);
	let busy = $state(false);
	let message = $state('');
	let errors = $state<string[]>([]);

	async function refresh() {
		[draft, builds, activeBuildId] = await Promise.all([
			loadDraft(),
			listBuilds(),
			getActiveBuildId()
		]);
	}

	onMount(() => {
		refresh().catch((e) => (errors = [String(e)]));
	});

	async function run(fn: () => Promise<void>, ok: string) {
		busy = true;
		message = '';
		errors = [];
		try {
			await fn();
			message = ok;
			await refresh();
		} catch (e) {
			errors = [e instanceof Error ? e.message : String(e)];
		} finally {
			busy = false;
		}
	}

	const seed = () =>
		run(() => seedDraftFromBuild(placeholderBuild), 'Draft seeded from the placeholder build.');

	async function publish() {
		busy = true;
		message = '';
		errors = [];
		try {
			const r = await publishDraftClient();
			if (r.errors.length) errors = r.errors;
			else message = `Published ${r.buildId} and pointed the live game at it.`;
			await refresh();
		} catch (e) {
			errors = [e instanceof Error ? e.message : String(e)];
		} finally {
			busy = false;
		}
	}

	const rollback = (id: string) => run(() => rollbackTo(id), `Rolled the live game back to ${id}.`);
</script>

<h1>Dashboard</h1>
<p class="note">
	⚠ Editor in progress (M4). Scene / item / behaviour editors and the scene-graph canvas are coming;
	this page exercises the draft → publish → rollback pipeline. All content is still placeholder.
</p>

{#if message}<p class="ok">{message}</p>{/if}
{#if errors.length}
	<div class="errors">
		<strong>Validation failed — publish blocked:</strong>
		<ul>
			{#each errors as e, i (i)}<li>{e}</li>{/each}
		</ul>
	</div>
{/if}

<section>
	<h2>Draft</h2>
	{#if draft}
		<p>
			Start scene: <code>{draft.meta.startSceneId || '—'}</code> · {draft.scenes.length} scenes ·
			{draft.items.length} items · {draft.behaviours.length} behaviours
		</p>
	{:else}
		<p class="muted">No draft yet.</p>
	{/if}
	<div class="row">
		<button type="button" onclick={seed} disabled={busy}>Seed draft from placeholder</button>
		<button type="button" class="primary" onclick={publish} disabled={busy}
			>Validate &amp; publish</button
		>
	</div>
</section>

<section>
	<h2>Published builds</h2>
	{#if builds.length}
		<ul class="builds">
			{#each builds as b (b.id)}
				<li>
					<span class="bid">{b.id}</span>
					<span class="muted">{new Date(b.publishedAt).toLocaleString()}</span>
					{#if b.id === activeBuildId}
						<span class="live">● live</span>
					{:else}
						<button type="button" onclick={() => rollback(b.id)} disabled={busy}
							>roll back here</button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">Nothing published yet. Seed a draft, then publish.</p>
	{/if}
	<p><a href={resolve('/play')}>▶ Open the game</a> to see the active build.</p>
</section>

<style>
	h1 {
		margin: 0 0 0.5rem;
	}
	h2 {
		font-size: 1.05rem;
		border-bottom: 1px solid var(--line);
		padding-bottom: 0.3rem;
	}
	section {
		margin-top: 2rem;
	}
	.note {
		color: #d8c98a;
		background: #2a2410;
		border: 1px dashed #6b5e2a;
		padding: 0.5rem 0.8rem;
		font-size: 0.85rem;
	}
	.ok {
		color: #9fc0a8;
	}
	.muted {
		color: var(--ink-dim);
	}
	.errors {
		border: 1px solid #6b3a3a;
		background: #20100f;
		padding: 0.6rem 0.9rem;
		color: #e0a8a8;
		font-size: 0.9rem;
	}
	.errors ul {
		margin: 0.4rem 0 0;
		padding-left: 1.1rem;
	}
	.row {
		display: flex;
		gap: 0.6rem;
		margin-top: 0.8rem;
	}
	button {
		font: inherit;
		cursor: pointer;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.45rem 0.8rem;
	}
	button:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button.primary {
		border-color: var(--accent);
	}
	.builds {
		list-style: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.builds li {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}
	.bid {
		font-family: inherit;
	}
	.live {
		color: #9fc0a8;
	}
	code {
		color: var(--accent);
	}
</style>
