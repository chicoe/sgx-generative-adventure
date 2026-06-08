<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import EffectsEditor from '$lib/components/editor/EffectsEditor.svelte';
	import ConditionsEditor from '$lib/components/editor/ConditionsEditor.svelte';
	import { loadDraft, saveScene, deleteScene, setStartScene } from '$lib/content/draft';
	import { uploadImage } from '$lib/firebase/storage';
	import type { Scene } from '$lib/engine/types';

	let scenes = $state<Scene[]>([]);
	let itemIds = $state<string[]>([]);
	let behaviourIds = $state<string[]>([]);
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
		behaviourIds = (d?.behaviours ?? []).map((b) => b.id);
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
		for (const h of c.hotspots) h.effects ??= [];
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
	async function makeStart() {
		if (!current?.id) return;
		await setStartScene(current.id);
		startSceneId = current.id;
		message = `"${current.id}" is now the start scene.`;
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

	// hotspots / exits
	const addHotspot = () =>
		current &&
		(current.hotspots = [
			...current.hotspots,
			{ id: `hotspot-${current.hotspots.length + 1}`, label: '', effects: [] }
		]);
	const removeHotspot = (i: number) =>
		current && (current.hotspots = current.hotspots.filter((_, j) => j !== i));
	const addExit = () =>
		current &&
		(current.exits = [
			...current.exits,
			{ id: `exit-${current.exits.length + 1}`, toSceneId: '', label: '' }
		]);
	const removeExit = (i: number) =>
		current && (current.exits = current.exits.filter((_, j) => j !== i));

	const orNone = (v: string) => (v === '' ? undefined : v);
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
			<option value={s.id}>{s.name || s.id}{s.id === startSceneId ? '  ★ start' : ''}</option>
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

		<fieldset>
			<legend>hotspots (keyboard-selectable actions)</legend>
			{#each current.hotspots as hotspot, i (i)}
				<div class="block">
					<div class="rowline">
						<input class="sm" placeholder="id" bind:value={current.hotspots[i].id} />
						<input placeholder="label" bind:value={current.hotspots[i].label} />
						<button type="button" class="x" onclick={() => removeHotspot(i)}>✕</button>
					</div>
					<div class="grid2">
						<label
							>go to scene
							<select
								value={hotspot.goToSceneId ?? ''}
								onchange={(e) => (current!.hotspots[i].goToSceneId = orNone(e.currentTarget.value))}
							>
								<option value="">— none —</option>
								{#each sceneIds as id (id)}<option value={id}>{id}</option>{/each}
							</select>
						</label>
						<label
							>open behaviour
							<select
								value={hotspot.behaviourId ?? ''}
								onchange={(e) => (current!.hotspots[i].behaviourId = orNone(e.currentTarget.value))}
							>
								<option value="">— none —</option>
								{#each behaviourIds as id (id)}<option value={id}>{id}</option>{/each}
							</select>
						</label>
					</div>
					<ConditionsEditor bind:condition={current.hotspots[i].condition} {itemIds} />
					<EffectsEditor
						bind:effects={current.hotspots[i].effects!}
						{itemIds}
						{sceneIds}
						label="hotspot effects"
					/>
				</div>
			{/each}
			<button type="button" class="add" onclick={addHotspot}>+ hotspot</button>
		</fieldset>

		<fieldset>
			<legend>exits (scene transitions)</legend>
			{#each current.exits as _exit, i (i)}
				<div class="block">
					<div class="rowline">
						<input class="sm" placeholder="id" bind:value={current.exits[i].id} />
						<input placeholder="label" bind:value={current.exits[i].label} />
						<label
							>to
							<select bind:value={current.exits[i].toSceneId}>
								<option value="">— pick —</option>
								{#each sceneIds as id (id)}<option value={id}>{id}</option>{/each}
							</select>
						</label>
						<button type="button" class="x" onclick={() => removeExit(i)}>✕</button>
					</div>
					<ConditionsEditor bind:condition={current.exits[i].condition} {itemIds} />
				</div>
			{/each}
			<button type="button" class="add" onclick={addExit}>+ exit</button>
		</fieldset>

		<EffectsEditor
			bind:effects={current.onEnter!}
			{itemIds}
			{sceneIds}
			label="on enter (effects when the scene loads)"
		/>

		<div class="actions">
			<button type="button" class="primary" onclick={save} disabled={busy}>Save</button>
			<button type="button" onclick={makeStart} disabled={busy || !current.id}
				>Set as start scene</button
			>
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
	.muted {
		color: var(--ink-dim);
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
	.block {
		border-left: 2px solid var(--line);
		padding-left: 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-bottom: 0.4rem;
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
