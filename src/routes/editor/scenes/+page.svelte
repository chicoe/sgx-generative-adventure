<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import EffectsEditor from '$lib/components/editor/EffectsEditor.svelte';
	import { loadDraft, saveScene, deleteSceneAndLinks } from '$lib/content/draft';
	import { draftStatus } from '$lib/content/draftStatus.svelte';
	import { uploadImage } from '$lib/firebase/storage';
	import type { Scene } from '$lib/engine/types';

	let scenes = $state<Scene[]>([]);
	let itemIds = $state<string[]>([]);
	let startSceneId = $state('');
	let current = $state<Scene | null>(null);
	let busy = $state(false);
	let uploading = $state(false);
	let message = $state('');

	// The filter/CSS-grade panel is hidden for now to keep the client's editor
	// simple. The data is still loaded/saved untouched; flip back on to re-expose.
	const SHOW_FILTER = false;

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

	// Duplicate the selected scene wholesale: every option, layers, effects, and
	// its links — exits AND entrances (every exit on another scene pointing at the
	// original gets a sibling pointing at the copy, same lock/one-way settings),
	// so the copy is reachable exactly like the original. Fresh ids throughout.
	async function duplicateScene() {
		if (!current?.id) return;
		const srcId = current.id;
		const copy = $state.snapshot(current) as Scene;
		let id = `${copy.id}-copy`;
		for (let n = 2; scenes.some((s) => s.id === id); n++) id = `${copy.id}-copy-${n}`;
		copy.id = id;
		copy.name = copy.name ? `${copy.name} (copy)` : id;
		copy.exits = copy.exits.map((x, i) => ({ ...x, id: `exit-${Date.now()}-${i}` }));
		busy = true;
		message = '';
		try {
			await saveScene(copy);
			for (const s of scenes) {
				if (s.id === srcId) continue;
				const into = s.exits.filter((x) => x.toSceneId === srcId);
				if (!into.length) continue;
				const mirrored = into.map((x, i) => ({
					...x,
					id: `exit-${Date.now()}-in-${i}`,
					toSceneId: id,
					label: copy.name
				}));
				await saveScene({ ...$state.snapshot(s), exits: [...s.exits, ...mirrored] });
			}
			draftStatus.markDirty();
			await refresh();
			const saved = scenes.find((s) => s.id === id);
			if (saved) select(saved);
			message = `Duplicated as "${id}" (links mirrored).`;
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function save() {
		if (!current) return;
		const id = current.id.trim();
		if (!id) return (message = 'Scene needs an id.');
		busy = true;
		message = '';
		try {
			await saveScene({ ...current, id });
			draftStatus.markDirty();
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
			await deleteSceneAndLinks(current.id);
			draftStatus.markDirty();
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

	// A layer can hold SEVERAL images — the game shows one at random per visit.
	// imagePaths is the pool; imagePath mirrors the first entry (legacy readers).
	const layerPool = (l: { imagePath: string; imagePaths?: string[] }): string[] =>
		l.imagePaths?.length ? l.imagePaths : l.imagePath ? [l.imagePath] : [];
	function setLayerPool(i: number, pool: string[]) {
		if (!current) return;
		current.layers[i].imagePaths = pool;
		current.layers[i].imagePath = pool[0] ?? '';
	}
	const addLayerImage = (i: number, path: string) =>
		current && path.trim() && setLayerPool(i, [...layerPool(current.layers[i]), path.trim()]);
	const removeLayerImage = (i: number, j: number) =>
		current &&
		setLayerPool(
			i,
			layerPool(current.layers[i]).filter((_, k) => k !== j)
		);
	// Draft text for each layer's "add by path" input.
	let pathDrafts = $state<Record<number, string>>({});
	async function upload(i: number, file?: File) {
		if (!file || !current) return;
		uploading = true;
		message = '';
		try {
			addLayerImage(i, await uploadImage(file, 'scenes'));
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			uploading = false;
		}
	}

	// giveable items (the computer may grant these here, rolled per run)
	const addGiveable = () =>
		current &&
		(current.giveableItems = [
			...(current.giveableItems ?? []),
			{ itemId: itemIds[0] ?? '', chance: 1 }
		]);
	const removeGiveable = (i: number) =>
		current && (current.giveableItems = (current.giveableItems ?? []).filter((_, j) => j !== i));
	function setGiveableChance(i: number, pct: number) {
		if (!current?.giveableItems) return;
		current.giveableItems[i].chance = Math.max(0, Math.min(100, pct || 0)) / 100;
	}
</script>

<h1>Scenes</h1>
{#if !scenes.length}
	<p class="note">
		⚠ Placeholder content. Upload art per layer; the game reads it from the published build.
	</p>
{/if}
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
	<button
		type="button"
		title="Copy the selected scene — everything including its links — under a new id"
		onclick={duplicateScene}
		disabled={busy || !current?.id}>⧉ Duplicate scene</button
	>
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

		{#if SHOW_FILTER}
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
						>blendMode <input
							bind:value={current.filter!.blendMode}
							placeholder="multiply"
						/></label
					>
					<label
						>overlay <input
							bind:value={current.filter!.overlay}
							placeholder="repeating-linear-gradient(...)"
						/></label
					>
				</div>
			</fieldset>
		{/if}

		<fieldset>
			<legend
				>backround layers (back → front by z — a layer with several images shows ONE at random per
				visit)</legend
			>
			{#each current.layers as layer, i (i)}
				<div class="layer">
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
						{#if layerPool(layer).length}
							<div class="variants">
								{#each layerPool(layer) as p, j (`${p}-${j}`)}
									<span class="variant">
										<img class="thumb" src={imgUrl(p)} alt="" title={p} />
										<button
											type="button"
											class="x vx"
											title="remove this image"
											onclick={() => removeLayerImage(i, j)}>✕</button
										>
									</span>
								{/each}
								{#if layerPool(layer).length > 1}
									<span class="muted small">1 of {layerPool(layer).length}, random per visit</span>
								{/if}
							</div>
						{/if}
						<div class="rowline">
							<input
								placeholder="add image by path / URL"
								bind:value={pathDrafts[i]}
								onkeydown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										addLayerImage(i, pathDrafts[i] ?? '');
										pathDrafts[i] = '';
									}
								}}
							/>
							<button
								type="button"
								onclick={() => {
									addLayerImage(i, pathDrafts[i] ?? '');
									pathDrafts[i] = '';
								}}>add</button
							>
							<input
								type="file"
								accept="image/png,image/jpeg,image/gif"
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
			<legend
				>giveable items (the computer may hand these out here — presence rolled per run)</legend
			>
			{#each current.giveableItems ?? [] as _gi, i (i)}
				<div class="rowline">
					<select bind:value={current.giveableItems![i].itemId}>
						<option value="" disabled>— item —</option>
						{#each itemIds as id (id)}<option value={id}>{id}</option>{/each}
					</select>
					<label class="num"
						>chance
						<input
							type="number"
							min="0"
							max="100"
							step="5"
							value={Math.round(current.giveableItems![i].chance * 100)}
							oninput={(e) => setGiveableChance(i, e.currentTarget.valueAsNumber)}
						/>
						%
					</label>
					<button type="button" class="x" onclick={() => removeGiveable(i)}>✕</button>
				</div>
			{/each}
			<button type="button" class="add" onclick={addGiveable} disabled={!itemIds.length}
				>+ giveable item</button
			>
			{#if !itemIds.length}<span class="muted"> create items first</span>{/if}
		</fieldset>

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
		flex-direction: row;
		align-items: center;
		gap: 0.4rem;
	}
	.roles .chk input {
		flex: none;
		width: auto;
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
	/* A layer's image pool: thumbnails with a per-image remove. */
	.variants {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}
	.variant {
		position: relative;
		display: inline-flex;
	}
	.variant .vx {
		position: absolute;
		top: -6px;
		right: -6px;
		padding: 0 0.25rem;
		line-height: 1.1;
		background: #14161a;
	}
	.small {
		font-size: 0.72rem;
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
