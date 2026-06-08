<script lang="ts">
	import { onMount } from 'svelte';
	import { loadDraft, saveItem, deleteItem } from '$lib/content/draft';
	import type { Item } from '$lib/engine/types';

	let items = $state<Item[]>([]);
	let busy = $state(false);
	let message = $state('');
	let draftNew = $state<Item>({ id: '', name: '', iconPath: '', description: '' });

	async function refresh() {
		items = (await loadDraft())?.items ?? [];
	}
	onMount(() => refresh().catch((e) => (message = String(e))));

	async function save(item: Item) {
		busy = true;
		message = '';
		try {
			await saveItem(item);
			message = `Saved "${item.id}".`;
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function remove(id: string) {
		busy = true;
		try {
			await deleteItem(id);
			await refresh();
			message = `Deleted "${id}".`;
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function create() {
		const id = draftNew.id.trim();
		if (!id) return (message = 'New item needs an id.');
		if (items.some((i) => i.id === id)) return (message = `Item "${id}" already exists.`);
		await save({ ...draftNew, id });
		draftNew = { id: '', name: '', iconPath: '', description: '' };
		await refresh();
	}
</script>

<h1>Items</h1>
<p class="note">
	⚠ Placeholder content. Icon upload (Storage) comes later — `iconPath` is a path/URL for now.
</p>
{#if message}<p class="msg">{message}</p>{/if}

<div class="list">
	{#each items as item (item.id)}
		<div class="card">
			<div class="row">
				<code>{item.id}</code>
				<button type="button" class="del" onclick={() => remove(item.id)} disabled={busy}
					>delete</button
				>
			</div>
			<label>name <input bind:value={item.name} /></label>
			<label>iconPath <input bind:value={item.iconPath} placeholder="items/key.png" /></label>
			<label>description <input bind:value={item.description} /></label>
			<button type="button" onclick={() => save(item)} disabled={busy}>Save</button>
		</div>
	{:else}
		<p class="muted">No items yet.</p>
	{/each}
</div>

<div class="card new">
	<h2>New item</h2>
	<label>id <input bind:value={draftNew.id} placeholder="keycard" /></label>
	<label>name <input bind:value={draftNew.name} /></label>
	<label>iconPath <input bind:value={draftNew.iconPath} /></label>
	<label>description <input bind:value={draftNew.description} /></label>
	<button type="button" onclick={create} disabled={busy}>Create</button>
</div>

<style>
	h1 {
		margin: 0 0 0.5rem;
	}
	h2 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}
	.note {
		color: #d8c98a;
		background: #2a2410;
		border: 1px dashed #6b5e2a;
		padding: 0.4rem 0.7rem;
		font-size: 0.8rem;
	}
	.msg {
		color: var(--accent);
	}
	.muted {
		color: var(--ink-dim);
	}
	.list {
		display: grid;
		gap: 0.8rem;
		grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
	}
	.card {
		border: 1px solid var(--line);
		padding: 0.7rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.card.new {
		margin-top: 1.5rem;
		max-width: 22rem;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.75rem;
		color: var(--ink-dim);
	}
	input {
		font: inherit;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.35rem 0.5rem;
	}
	button {
		font: inherit;
		cursor: pointer;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.4rem 0.7rem;
		align-self: flex-start;
	}
	button:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}
	button:disabled {
		opacity: 0.5;
	}
	.del {
		color: #e0a8a8;
		padding: 0.2rem 0.5rem;
		font-size: 0.8rem;
	}
	code {
		color: var(--accent);
	}
</style>
