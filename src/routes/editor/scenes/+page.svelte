<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import EffectsEditor from '$lib/components/editor/EffectsEditor.svelte';
	import { loadDraft, saveScene, deleteScene } from '$lib/content/draft';
	import { uploadImage } from '$lib/firebase/storage';
	import type { Scene } from '$lib/engine/types';

	let scenes = $state<Scene[]>([]);
	let itemIds = $state<string[]>([]);
	let startSceneId = $state('');
	let current = $state<Scene | null>(null);
	let busy = $state(false);
	let uploading = $state(false);
	let message = $state('');

	const sceneIds = $derived(scenes.map((s) => s.id));
	const imgUrl = (p: string) =>
		!p ? '' : /^(https?:)?\/\//.test(p) || p.startsWith('/') ? p : `/${p}`;

	async function refresh() {
		const d = await loadDraft();
		scenes = d?.scenes ?? [];
		itemIds = (d?.items ?? []).map((i) => i.id);
		startSceneId = d?.meta.startSceneId ?? '';
	}
	onMount(() =>
		refresh()
			.then(() => {
				const id = page.url.searchParams.get('scene');
				const s = id ? scenes.find((x) => x.id === id) : undefined;
				if (s) select(s);
			})
			.catch((e) => (message = String(e)))
	);

	function normalize(s: Scene): Scene {
		// $state.snapshot, not structuredClone — the latter throws DataCloneError on
		// Svelte state proxies.
		const c = $state.snapshot(s) as Scene;
		c.onEnter ??= [];
		c.filter ??= {};
		return c;
	}
	const select = (s: Scene) => (current = normalize(s));
	function newScene() {
		current = { id: '', name: '', layers: [], hotspots: [], exits: [], onEnter: [], filter: {} };
	}

	async function save() {
		if (!current) return;
		const id = current.id.trim();
		if (!id) return (message = 'Scene needs an id.');
		busy = true;
		message = '';
		try {
			await saveScene({ ...current, id });
			message = `Saved "${id}".`;
			await refresh();
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
	async function remove() {
		if (!current?.id) return;
		busy = true;
		try {
			await deleteScene(current.id);
			current = null;
			await refresh();
			message = 'Deleted.';
		} catch (e) {
			message = String(e);
		} finally {
			busy = false;
		}
	}

	// layers
	const addLayer = () =>
		current &&
		(current.layers = [
			...current.layers,
			{
				id: `layer-${current.layers.length + 1}`,
				imagePath: '',
				z: current.layers.length,
				parallaxFactor: 0.3
			}
		]);
	const removeLayer = (i: number) =>
		current && (current.layers = current.layers.filter((_, j) => j !== i));
	async function upload(i: number, file?: File) {
		if (!file || !current) return;
		uploading = true;
		message = '';
		try {
			current.layers[i].imagePath = await uploadImage(file, 'scenes');
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			uploading = false;
		}
	}
</script>

<h1>Scenes</h1>
<p class="note">
	⚠ Placeholder content. Upload art per layer; the game reads it from the published build.
</p>
{#if message}<p class="msg">{message}</p>{/if}

<div class="toolbar">
	<select
		value={current?.id ?? ''}
		onchange={(e) => {
			const s = scenes.find((x) => x.id === e.currentTarget.value);
			if (s) select(s);
		}}
	>
		<option value="" disabled>— pick a scene —</option>
		{#each scenes as s (s.id)}
			<option value={s.id}>
				{s.name || s.id}{s.start || s.id === startSceneId ? '  ★' : ''}{s.ending ? '  ⏹' : ''}
			</option>
		{/each}
	</select>
	<button type="button" onclick={newScene}>+ New scene</button>
</div>

{#if current}
	<div class="form">
		<div class="grid2">
			<label>id <input bind:value={current.id} placeholder="bridge" /></label>
			<label>name <input bind:value={current.name} /></label>
		</div>
		<label
			>intro text (narration on enter)
			<textarea rows="2" bind:value={current.introText}></textarea>
		</label>
		<label
			>scene prompt (context + instructions for the computer/LLM — it also sees exits & inventory)
			<textarea rows="3" bind:value={current.prompt}></textarea>
		</label>

		<div class="roles">
			<label class="chk"
				><input type="checkbox" bind:checked={current.start} /> start scene (one is picked at random)</label
			>
			<label class="chk"
				><input type="checkbox" bind:checked={current.ending} /> ending scene (reaching it ends the run,
				then restarts)</label
			>
		</div>

		<fieldset>
			<legend>filter / CSS grade (optional)</legend>
			<label
				>css <input
					bind:value={current.filter!.css}
					placeholder="contrast(1.05) saturate(0.9)"
				/></label
			>
			<div class="grid2">
				<label
					>blendMode <input bind:value={current.filter!.blendMode} placeholder="multiply" /></label
				>
				<label
					>overlay <input
						bind:value={current.filter!.overlay}
						placeholder="repeating-linear-gradient(...)"
					/></label
				>
			</div>
		</fieldset>

		<fieldset>
			<legend>layers (back → front by z)</legend>
			{#each current.layers as layer, i (i)}
				<div class="layer">
					{#if layer.imagePath}<img class="thumb" src={imgUrl(layer.imagePath)} alt="" />{/if}
					<div class="layer-fields">
						<div class="rowline">
							<input class="sm" placeholder="layer id" bind:value={current.layers[i].id} />
							<label class="num">z <input type="number" bind:value={current.layers[i].z} /></label>
							<label class="num"
								>parallax
								<input
									type="number"
									min="0"
									max="1"
									step="0.05"
									bind:value={current.layers[i].parallaxFactor}
								/>
							</label>
							<button type="button" class="x" onclick={() => removeLayer(i)}>✕</button>
						</div>
						<div class="rowline">
							<input placeholder="image path / URL" bind:value={current.layers[i].imagePath} />
							<input
								type="file"
								accept="image/*"
								onchange={(e) => upload(i, e.currentTarget.files?.[0])}
							/>
						</div>
					</div>
				</div>
			{/each}
			<button type="button" class="add" onclick={addLayer} disabled={uploading}>+ layer</button>
			{#if uploading}<span class="muted"> uploading…</span>{/if}
		</fieldset>

		<p class="exits-note">
			Exits are managed on the <strong>Graph</strong> — connect scenes there ({current.exits.length}
			exit{current.exits.length === 1 ? '' : 's'} from this scene).
		</p>

		<EffectsEditor
			bind:effects={current.onEnter!}
			{itemIds}
			{sceneIds}
			label="on enter (effects when the scene loads)"
		/>

		<div class="actions">
			<button type="button" class="primary" onclick={save} disabled={busy}>Save</button>
			<button type="button" class="del" onclick={remove} disabled={busy}>Delete</button>
		</div>
	</div>
{:else}
	<p class="muted">Pick a scene above, or create a new one.</p>
{/if}

<style>
	h1 {
		margin: 0 0 0.5rem;
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
	.exits-note {
		font-size: 0.8rem;
		color: var(--ink-dim);
		border: 1px solid var(--line);
		padding: 0.4rem 0.7rem;
	}
	.muted {
		color: var(--ink-dim);
	}
	.roles {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.8rem;
	}
	.chk {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.toolbar {
		display: flex;
		gap: 0.6rem;
		margin-bottom: 1rem;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		max-width: 52rem;
	}
	.grid2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.75rem;
		color: var(--ink-dim);
	}
	label.num {
		flex-direction: row;
		align-items: center;
		gap: 0.3rem;
	}
	label.num input {
		width: 5rem;
	}
	input,
	textarea,
	select {
		font: inherit;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.35rem 0.5rem;
	}
	textarea {
		resize: vertical;
	}
	fieldset {
		border: 1px solid var(--line);
		margin: 0;
		padding: 0.5rem 0.7rem 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	legend {
		color: var(--ink-dim);
		font-size: 0.8rem;
		padding: 0 0.4rem;
	}
	.rowline {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.rowline input:not(.sm):not([type='number']):not([type='file']) {
		flex: 1;
	}
	.sm {
		max-width: 8rem;
	}
	.layer {
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
	}
	.layer-fields {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.thumb {
		width: 64px;
		height: 40px;
		object-fit: cover;
		border: 1px solid var(--line);
	}
	.actions {
		display: flex;
		gap: 0.6rem;
		margin-top: 0.5rem;
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
	.add {
		font-size: 0.8rem;
		padding: 0.25rem 0.55rem;
	}
	.x {
		color: var(--ink-dim);
	}
	.primary {
		border-color: var(--accent);
	}
	.del {
		color: #e0a8a8;
	}
</style>
