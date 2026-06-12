<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		loadDraft,
		seedDraftFromBuild,
		restoreDraftFromBuild,
		setDefaultBehaviour,
		cleanupDraft
	} from '$lib/content/draft';
	import {
		saveDraftBuild,
		listBuilds,
		setActiveBuild,
		setBuildMessage,
		getActiveBuildId,
		getBuild,
		type BuildSummary
	} from '$lib/content/publishClient';
	import { placeholderBuild } from '$lib/game/placeholderBuild';
	import { draftStatus } from '$lib/content/draftStatus.svelte';
	import type { DraftContent } from '$lib/content/build';

	let draft = $state<DraftContent | null>(null);
	let builds = $state<BuildSummary[]>([]);
	let activeBuildId = $state<string | undefined>(undefined);
	let busy = $state(false);
	let message = $state('');
	let errors = $state<string[]>([]);

	// Once the client has authored real content, the placeholder-seeding affordances
	// are hidden so they don't get confused into wiping their work.
	const hasContent = $derived(
		!!draft && draft.scenes.length + draft.items.length + draft.behaviours.length > 0
	);

	async function refresh() {
		[draft, builds, activeBuildId] = await Promise.all([
			loadDraft(),
			listBuilds(),
			getActiveBuildId()
		]);
		await draftStatus.check();
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

	let commitMsg = $state('');
	async function save() {
		busy = true;
		message = '';
		errors = [];
		try {
			const r = await saveDraftBuild(commitMsg.trim() || undefined);
			if (r.errors.length) errors = r.errors;
			else {
				message = `Saved ${r.buildId}. Press "publish version" below to make it live.`;
				commitMsg = '';
			}
			await refresh();
		} catch (e) {
			errors = [e instanceof Error ? e.message : String(e)];
		} finally {
			busy = false;
		}
	}

	const publishVersion = (id: string) =>
		run(() => setActiveBuild(id), `${id} is now live — the game runs this version.`);

	// One-shot repair for drafts with dangling references (e.g. items deleted
	// before deletes learned to scrub): removes them and reports each removal.
	async function cleanup() {
		busy = true;
		message = '';
		errors = [];
		try {
			const removed = await cleanupDraft();
			message = removed.length
				? `Cleaned up ${removed.length} dangling reference${removed.length === 1 ? '' : 's'}:\n— ${removed.join('\n— ')}`
				: 'Nothing to clean — the draft has no dangling references.';
			draftStatus.markDirty();
			await refresh();
		} catch (e) {
			errors = [e instanceof Error ? e.message : String(e)];
		} finally {
			busy = false;
		}
	}

	// Inline editing of a version's commit message.
	let editingId = $state<string | null>(null);
	let editMsg = $state('');
	function startEdit(b: BuildSummary) {
		editingId = b.id;
		editMsg = b.message ?? '';
	}
	function saveEdit() {
		const id = editingId;
		if (!id) return;
		editingId = null;
		run(() => setBuildMessage(id, editMsg), 'Commit message updated.');
	}
	const setComputer = (id: string) => run(() => setDefaultBehaviour(id), 'Ship computer set.');
	function restoreVersion(id: string) {
		if (
			!confirm(
				`Restore the settings and content of ${id} into the editor?\n\nThis OVERWRITES your current settings and content with that version's snapshot — unsaved/unpublished edits are lost. (The live game is not touched.)`
			)
		)
			return;
		run(async () => restoreDraftFromBuild(await getBuild(id)), `Editor restored to ${id}.`);
	}
</script>

<h1>Overview</h1>
{#if !hasContent}
	<p class="note">
		⚠ Placeholder content. Seed from the placeholder build to explore, or start your own in
		<strong>Graph</strong> / <strong>Scenes</strong> / <strong>Items</strong> /
		<strong>Behaviours</strong>, then save &amp; publish a version.
	</p>
{/if}

{#if message}<p class="ok">{message}</p>{/if}
{#if errors.length}
	<div class="errors">
		<strong>Validation failed — save blocked:</strong>
		<ul>
			{#each errors as e, i (i)}<li>{e}</li>{/each}
		</ul>
	</div>
{/if}

<section>
	<h2>Draft</h2>
	{#if draft}
		<label class="computer">
			Ship computer <span class="muted">(the behaviour the player talks to everywhere)</span>
			<select
				value={draft.meta.defaultBehaviourId ?? ''}
				onchange={(e) => setComputer(e.currentTarget.value)}
				disabled={busy || !draft.behaviours.length}
			>
				<option value="" disabled>— pick a behaviour —</option>
				{#each draft.behaviours as b (b.id)}<option value={b.id}>{b.name || b.id}</option>{/each}
			</select>
		</label>
	{:else}
		<p class="muted">No draft yet.</p>
	{/if}
	{#if draftStatus.dirty}
		<p class="dirty-note">
			● Unpublished changes — save a version, then publish it to push them live.
		</p>
	{/if}
	<div class="row">
		{#if !hasContent}
			<button type="button" onclick={seed} disabled={busy}>Seed draft from placeholder</button>
		{/if}
		<input
			class="commit"
			placeholder="commit message (optional)"
			bind:value={commitMsg}
			disabled={busy}
		/>
		<button type="button" class="primary" onclick={save} disabled={busy}>Validate &amp; save</button
		>
		<button
			type="button"
			title="Remove references to deleted scenes/items/behaviours from the whole draft"
			onclick={cleanup}
			disabled={busy}>Clean up references</button
		>
	</div>
</section>

<section>
	<h2>Versions</h2>
	{#if builds.length}
		<ul class="builds">
			{#each builds as b (b.id)}
				<li class="vrow">
					{#if b.id === activeBuildId}
						<button type="button" class="live-btn" disabled>● live</button>
					{:else}
						<button
							type="button"
							class="cell-btn"
							title="Make this version the live game"
							onclick={() => publishVersion(b.id)}
							disabled={busy}>publish</button
						>
					{/if}
					<button
						type="button"
						class="cell-btn"
						title="Load this version's settings & content into the editor (overwrites current)"
						onclick={() => restoreVersion(b.id)}
						disabled={busy}>restore settings</button
					>
					<button
						type="button"
						class="cell-btn edit"
						title="Edit the commit message"
						onclick={() => startEdit(b)}
						disabled={busy}>✎</button
					>
					<span class="bid">{b.id}</span>
					<span class="muted">{new Date(b.publishedAt).toLocaleString()}</span>
					{#if editingId === b.id}
						<form
							class="msgline"
							onsubmit={(e) => {
								e.preventDefault();
								saveEdit();
							}}
						>
							<!-- svelte-ignore a11y_autofocus -->
							<input autofocus placeholder="commit message" bind:value={editMsg} />
							<button type="submit">save</button>
							<button type="button" onclick={() => (editingId = null)}>cancel</button>
						</form>
					{:else if b.message}
						<span class="msgline bmsg">“{b.message}”</span>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">
			No versions yet — {hasContent
				? 'Validate & save one, then publish it.'
				: 'seed a draft, then save a version.'}
		</p>
	{/if}
	<p><a href={resolve('/play')}>▶ Open the game</a> to see the live version.</p>
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
		/* the cleanup report is multi-line (one removal per line) */
		white-space: pre-line;
	}
	.dirty-note {
		color: #ff5a4a;
		font-size: 0.85rem;
	}
	.muted {
		color: var(--ink-dim);
	}
	.computer {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		max-width: 28rem;
		margin-top: 0.6rem;
		font-size: 0.85rem;
	}
	.computer select {
		font: inherit;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.4rem 0.5rem;
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
	.commit {
		flex: 1;
		max-width: 24rem;
		font: inherit;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.45rem 0.6rem;
	}
	.bmsg {
		color: var(--ink);
		font-style: italic;
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
	/* The versions table: one grid on the list; each version is a bordered BLOCK
	   spanning all columns and subgridding them, so the columns
	   ([publish/live] [restore] [edit] [id] [date]) stay aligned across blocks
	   while the commit message clearly lives inside its version's box. */
	.builds {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(3, max-content) max-content 1fr;
		gap: 0.55rem 0.9rem;
	}
	.vrow {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: subgrid;
		gap: 0.45rem 0.9rem;
		align-items: center;
		border: 1px solid var(--line);
		background: var(--panel);
		padding: 0.55rem 0.7rem;
	}
	.cell-btn {
		width: 100%;
		white-space: nowrap;
		font-size: 0.85rem;
		padding: 0.35rem 0.7rem;
	}
	/* "live" looks like the other buttons but isn't clickable. */
	.live-btn {
		width: 100%;
		white-space: nowrap;
		font-size: 0.85rem;
		padding: 0.35rem 0.7rem;
		color: #9fc0a8;
		border-color: #3a5a44;
		opacity: 1;
		cursor: default;
	}
	.edit {
		color: var(--ink-dim);
	}
	.msgline {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.msgline input {
		flex: 1;
		max-width: 34rem;
		font: inherit;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.3rem 0.5rem;
	}
	.msgline button {
		font-size: 0.8rem;
		padding: 0.25rem 0.6rem;
	}
	.bid {
		font-family: inherit;
		white-space: nowrap;
	}
</style>
