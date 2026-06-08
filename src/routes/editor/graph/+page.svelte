<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteFlow, Background, Controls } from '@xyflow/svelte';
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

	const nodeTypes = { scene: SceneNode };

	let scenes = $state<Scene[]>([]);
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
	} | null>(null);

	const imgUrl = (p: string) =>
		!p ? '' : /^(https?:)?\/\//.test(p) || p.startsWith('/') ? p : `/${p}`;

	function buildGraph() {
		nodes = scenes.map((s, i) => ({
			id: s.id,
			type: 'scene',
			position: positions[s.id] ?? { x: (i % 4) * 220, y: Math.floor(i / 4) * 170 },
			deletable: false,
			data: {
				label: s.name || s.id,
				isStart: s.id === startSceneId,
				images: [...s.layers]
					.sort((a, b) => a.z - b.z)
					.map((l) => imgUrl(l.imagePath))
					.filter(Boolean)
			}
		}));
		edges = scenes.flatMap((s) =>
			s.exits
				.filter((x) => x.toSceneId)
				.map((x) => ({
					id: `${s.id}::${x.id}`,
					source: s.id,
					target: x.toSceneId,
					label: x.label || undefined,
					data: { sceneId: s.id, exitId: x.id }
				}))
		);
	}

	async function refresh() {
		const [d, pos] = await Promise.all([loadDraft(), loadGraphPositions()]);
		scenes = d?.scenes ?? [];
		startSceneId = d?.meta.startSceneId ?? '';
		positions = pos;
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
		const data = edge.data as { sceneId?: string; exitId?: string } | undefined;
		const scene = data?.sceneId ? scenes.find((s) => s.id === data.sceneId) : undefined;
		const exit = data?.exitId ? scene?.exits.find((x) => x.id === data.exitId) : undefined;
		if (!scene || !exit) return;
		selectedExit = {
			sceneId: scene.id,
			exitId: exit.id,
			from: scene.id,
			to: exit.toSceneId,
			label: exit.label
		};
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
	const saveExitLabel = () =>
		commitExit(
			(exits) =>
				exits.map((x) =>
					x.id === selectedExit!.exitId ? { ...x, label: selectedExit!.label } : x
				),
			'Exit label updated.'
		);
	const removeSelectedExit = () =>
		commitExit((exits) => exits.filter((x) => x.id !== selectedExit!.exitId), 'Exit removed.');

	async function removeEdge(edge: Edge) {
		const data = edge.data as { sceneId?: string; exitId?: string } | undefined;
		const scene = data?.sceneId ? scenes.find((s) => s.id === data.sceneId) : undefined;
		if (!scene || !data?.exitId) return;
		try {
			await saveScene({ ...scene, exits: scene.exits.filter((x) => x.id !== data.exitId) });
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
	drag between nodes to add an exit · click a link to rename/remove it · drag nodes to arrange
	(saved) · click a node to edit it
</p>

{#if selectedExit}
	<div class="edge-editor">
		<span class="route">{selectedExit.from} → {selectedExit.to}</span>
		<input placeholder="exit label" bind:value={selectedExit.label} />
		<button type="button" onclick={saveExitLabel}>Save label</button>
		<button type="button" class="del" onclick={removeSelectedExit}>Remove exit</button>
		<button type="button" class="x" onclick={() => (selectedExit = null)}>✕</button>
	</div>
{/if}

<div class="graph">
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		fitView
		colorMode="dark"
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
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.5rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--accent);
		background: var(--panel);
		font-size: 0.85rem;
	}
	.edge-editor .route {
		color: var(--ink-dim);
		white-space: nowrap;
	}
	.edge-editor input {
		flex: 1;
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
	.graph {
		height: 70vh;
		margin-top: 0.8rem;
		border: 1px solid var(--line);
	}
</style>
