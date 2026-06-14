<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteFlow, Background, Controls, MarkerType } from '@xyflow/svelte';
	import type { Node, Edge, Connection } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import SceneNode from '$lib/components/editor/SceneNode.svelte';
	import {
		loadDraft,
		saveScene,
		loadGraphPositions,
		saveGraphPositions,
		type GraphPositions
	} from '$lib/content/draft';
	import type { Scene } from '$lib/engine/types';
	import { layerImagePool } from '$lib/engine/graph';

	const nodeTypes = { scene: SceneNode };

	let scenes = $state<Scene[]>([]);
	let itemIds = $state<string[]>([]);
	let startSceneId = $state('');
	let positions = $state<GraphPositions>({});
	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let newId = $state('');
	let message = $state('');
	let selectedExit = $state<{
		sceneId: string;
		exitId: string;
		from: string;
		to: string;
		label: string;
		oneWay: boolean;
		requiredItems: string[];
	} | null>(null);

	const imgUrl = (p: string) =>
		!p ? '' : /^(https?:)?\/\//.test(p) || p.startsWith('/') ? p : `/${p}`;

	function buildGraph() {
		const anyStartFlag = scenes.some((s) => s.start);
		nodes = scenes.map((s, i) => ({
			id: s.id,
			type: 'scene',
			position: positions[s.id] ?? { x: (i % 4) * 220, y: Math.floor(i / 4) * 170 },
			deletable: false,
			data: {
				label: s.name || s.id,
				isStart: s.start || (!anyStartFlag && s.id === startSceneId),
				isEnding: !!s.ending,
				images: [...s.layers]
					.sort((a, b) => a.z - b.z)
					.map((l) => imgUrl(layerImagePool(l)[0] ?? ''))
					.filter(Boolean)
			}
		}));
		edges = scenes.flatMap((s) =>
			s.exits
				.filter((x) => x.toSceneId)
				.map((x) => {
					const locked = (x.requiredItems ?? []).length > 0;
					return {
						id: `${s.id}::${x.id}`,
						source: s.id,
						target: x.toSceneId,
						// No label: it covered the line and swallowed clicks. Locked = dashed;
						// the floating editor shows the label / lock details when selected.
						// dashed = locked behind items; arrows on both ends = two-way door
						style: `stroke: #38e08a;${locked ? ' stroke-dasharray: 7 4;' : ''}`,
						// Wide invisible band so the thin line is easy to click.
						interactionWidth: 28,
						markerEnd: { type: MarkerType.ArrowClosed, color: '#38e08a', width: 18, height: 18 },
						...(x.oneWay
							? {}
							: {
									markerStart: {
										type: MarkerType.ArrowClosed,
										color: '#38e08a',
										width: 18,
										height: 18
									}
								}),
						data: { sceneId: s.id, exitId: x.id }
					};
				})
		);
	}

	async function refresh() {
		const [d, pos] = await Promise.all([loadDraft(), loadGraphPositions()]);
		scenes = d?.scenes ?? [];
		itemIds = (d?.items ?? []).map((i) => i.id);
		startSceneId = d?.meta.startSceneId ?? '';
		positions = pos;
		// Self-repair: scrub links pointing at scenes that no longer exist (left
		// behind by older deletes — they'd block publish and are invisible here).
		const ids = new Set(scenes.map((s) => s.id));
		const dangling = scenes.filter((s) =>
			s.exits.some((x) => x.toSceneId && !ids.has(x.toSceneId))
		);
		if (dangling.length) {
			let n = 0;
			for (const s of dangling) {
				const kept = s.exits.filter((x) => !x.toSceneId || ids.has(x.toSceneId));
				n += s.exits.length - kept.length;
				await saveScene({ ...$state.snapshot(s), exits: kept });
			}
			const d2 = await loadDraft();
			scenes = d2?.scenes ?? [];
			message = `removed ${n} dangling link(s) to deleted scenes`;
		}
		buildGraph();
	}
	onMount(() => refresh().catch((e) => (message = String(e))));

	function openScene(id: string) {
		// resolve() handles the base path; the ?scene query is appended manually.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`${resolve('/editor/scenes')}?scene=${id}`);
	}

	async function persistPositions() {
		const map: GraphPositions = {};
		for (const n of nodes) map[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
		positions = map;
		try {
			await saveGraphPositions(map);
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		}
	}

	async function onConnect(c: Connection) {
		const scene = scenes.find((s) => s.id === c.source);
		if (!scene || !c.target) return;
		const label = scenes.find((s) => s.id === c.target)?.name || c.target;
		try {
			await saveScene({
				...scene,
				exits: [...scene.exits, { id: `exit-${Date.now()}`, toSceneId: c.target, label }]
			});
			message = `Added exit ${c.source} → ${c.target}.`;
			await refresh();
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		}
	}

	function selectEdge(edge: Edge) {
		// Prefer edge.data; fall back to the edge id (`${sceneId}::${exitId}`) since
		// custom data may not survive xyflow's internal round-trip.
		const data = edge.data as { sceneId?: string; exitId?: string } | undefined;
		const sep = edge.id.indexOf('::');
		const sceneId = data?.sceneId ?? (sep >= 0 ? edge.id.slice(0, sep) : undefined);
		const exitId = data?.exitId ?? (sep >= 0 ? edge.id.slice(sep + 2) : undefined);
		const scene = sceneId ? scenes.find((s) => s.id === sceneId) : undefined;
		const exit = exitId ? scene?.exits.find((x) => x.id === exitId) : undefined;
		if (!scene || !exit) return;
		selectedExit = {
			sceneId: scene.id,
			exitId: exit.id,
			from: scene.id,
			to: exit.toSceneId,
			label: exit.label,
			oneWay: !!exit.oneWay,
			requiredItems: [...(exit.requiredItems ?? [])]
		};
	}
	function toggleRequiredItem(id: string) {
		if (!selectedExit) return;
		selectedExit.requiredItems = selectedExit.requiredItems.includes(id)
			? selectedExit.requiredItems.filter((x) => x !== id)
			: [...selectedExit.requiredItems, id];
	}

	async function commitExit(mutate: (exits: Scene['exits']) => Scene['exits'], note: string) {
		if (!selectedExit) return;
		const scene = scenes.find((s) => s.id === selectedExit!.sceneId);
		if (!scene) return;
		try {
			await saveScene({ ...scene, exits: mutate(scene.exits) });
			message = note;
			selectedExit = null;
			await refresh();
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		}
	}
	const saveExit = () =>
		commitExit(
			(exits) =>
				exits.map((x) =>
					x.id === selectedExit!.exitId
						? {
								...x,
								label: selectedExit!.label,
								oneWay: selectedExit!.oneWay || undefined,
								requiredItems: selectedExit!.requiredItems.length
									? selectedExit!.requiredItems
									: undefined
							}
						: x
				),
			'Link updated.'
		);
	const removeSelectedExit = () =>
		commitExit((exits) => exits.filter((x) => x.id !== selectedExit!.exitId), 'Exit removed.');

	async function removeEdge(edge: Edge) {
		const data = edge.data as { sceneId?: string; exitId?: string } | undefined;
		const sep = edge.id.indexOf('::');
		const sceneId = data?.sceneId ?? (sep >= 0 ? edge.id.slice(0, sep) : undefined);
		const exitId = data?.exitId ?? (sep >= 0 ? edge.id.slice(sep + 2) : undefined);
		const scene = sceneId ? scenes.find((s) => s.id === sceneId) : undefined;
		if (!scene || !exitId) return;
		try {
			await saveScene({ ...scene, exits: scene.exits.filter((x) => x.id !== exitId) });
			message = 'Removed exit.';
			await refresh();
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		}
	}

	async function createScene() {
		const id = newId.trim();
		if (!id) return;
		if (scenes.some((s) => s.id === id)) return (message = `Scene "${id}" already exists.`);
		try {
			await saveScene({ id, name: id, layers: [], hotspots: [], exits: [] });
			newId = '';
			await refresh();
			message = `Created "${id}".`;
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		}
	}
</script>

<div class="head">
	<h1>Scene graph</h1>
	<form
		class="newscene"
		onsubmit={(e) => {
			e.preventDefault();
			createScene();
		}}
	>
		<input placeholder="new scene id" bind:value={newId} />
		<button type="submit">+ New scene</button>
	</form>
	{#if message}<span class="msg">{message}</span>{/if}
</div>
<p class="hint">
	drag between nodes to connect — links are <strong>two-way doors</strong> by default (arrows on both
	ends; dashed = locked 🔒) · click a link line to edit it (label, one-way, required items) · drag nodes
	to arrange (saved) · click a node to edit
</p>

<div class="graph-wrap">
	{#if selectedExit}
		<div class="edge-editor floating">
			<div class="row1">
				<span class="route"
					>{selectedExit.from}
					{selectedExit.oneWay ? '→' : '↔'}
					{selectedExit.to}</span
				>
				<input placeholder="exit label" bind:value={selectedExit.label} />
				<label class="chk"
					><input type="checkbox" bind:checked={selectedExit.oneWay} /> one-way</label
				>
				<button type="button" onclick={saveExit}>Save</button>
				<button type="button" class="del" onclick={removeSelectedExit}>Remove link</button>
				<button type="button" class="x" onclick={() => (selectedExit = null)}>✕</button>
			</div>
			<div class="row2">
				<span class="lbl">🔒 locked — opens with <strong>any</strong> of:</span>
				{#each selectedExit.requiredItems as id (id)}
					<span class="chip"
						>{id}<button type="button" class="chip-x" onclick={() => toggleRequiredItem(id)}
							>✕</button
						></span
					>
				{:else}
					<span class="lbl">(none — door is open)</span>
				{/each}
				<select
					class="additem"
					onchange={(e) => {
						if (e.currentTarget.value) toggleRequiredItem(e.currentTarget.value);
						e.currentTarget.value = '';
					}}
				>
					<option value="">+ add item…</option>
					{#each itemIds.filter((i) => !selectedExit!.requiredItems.includes(i)) as id (id)}
						<option value={id}>{id}</option>
					{/each}
				</select>
			</div>
		</div>
	{/if}

	<div class="graph">
		<SvelteFlow
			bind:nodes
			bind:edges
			{nodeTypes}
			fitView
			colorMode="dark"
			proOptions={{ hideAttribution: true }}
			onnodeclick={({ node }) => openScene(node.id)}
			onnodedragstop={() => persistPositions()}
			onedgeclick={({ edge }) => selectEdge(edge)}
			onconnect={onConnect}
			ondelete={({ edges: del }) => del.forEach((e) => removeEdge(e))}
		>
			<Background />
			<Controls />
		</SvelteFlow>
	</div>
</div>

<style>
	.head {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}
	h1 {
		margin: 0;
	}
	.newscene {
		display: flex;
		gap: 0.4rem;
	}
	.newscene input,
	.newscene button {
		font: inherit;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.35rem 0.6rem;
	}
	.newscene button {
		cursor: pointer;
	}
	.newscene button:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.msg {
		color: var(--accent);
		font-size: 0.85rem;
	}
	.hint {
		margin: 0.4rem 0 0;
		font-size: 0.8rem;
		color: var(--ink-dim);
	}
	.edge-editor {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--accent);
		background: var(--panel);
		font-size: 0.85rem;
	}
	.edge-editor .row1,
	.edge-editor .row2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.edge-editor .route {
		color: var(--ink-dim);
		white-space: nowrap;
	}
	.edge-editor .lbl {
		color: var(--ink-dim);
		font-size: 0.8rem;
	}
	.edge-editor .chk {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		white-space: nowrap;
	}
	.edge-editor .chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.1rem 0.2rem 0.1rem 0.5rem;
		border: 1px solid var(--line);
		background: #0c0e11;
		white-space: nowrap;
	}
	.edge-editor .chip-x {
		border: none;
		background: none;
		color: var(--ink-dim);
		cursor: pointer;
		padding: 0 0.25rem;
	}
	.edge-editor .chip-x:hover {
		color: var(--accent);
	}
	.edge-editor .additem {
		font: inherit;
		font-size: 0.8rem;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.2rem 0.4rem;
	}
	.edge-editor input:not([type]) {
		flex: 1;
		min-width: 10rem;
		font: inherit;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.3rem 0.5rem;
	}
	.edge-editor button {
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.3rem 0.6rem;
	}
	.edge-editor button:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.edge-editor .del {
		color: #e0a8a8;
	}
	.graph-wrap {
		position: relative;
		margin-top: 0.8rem;
	}
	.graph {
		height: 70vh;
		border: 1px solid var(--line);
	}
	/* The edge editor floats over the top of the graph so it's always visible
	   the moment you click a link (no scrolling up to find it). */
	.edge-editor.floating {
		position: absolute;
		top: 0.5rem;
		left: 0.5rem;
		right: 0.5rem;
		z-index: 10;
		margin-top: 0;
		box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5);
	}
</style>
