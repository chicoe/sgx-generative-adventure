<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteFlow, Background, Controls } from '@xyflow/svelte';
	import type { Node, Edge, Connection } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { loadDraft, saveScene } from '$lib/content/draft';
	import type { Scene } from '$lib/engine/types';

	let scenes = $state<Scene[]>([]);
	let startSceneId = $state('');
	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let message = $state('');

	function buildGraph() {
		const cols = Math.max(1, Math.ceil(Math.sqrt(scenes.length)));
		nodes = scenes.map((s, i) => ({
			id: s.id,
			position: { x: (i % cols) * 240, y: Math.floor(i / cols) * 150 },
			data: { label: (s.id === startSceneId ? '★ ' : '') + (s.name || s.id) },
			deletable: false,
			style: s.id === startSceneId ? 'border:1px solid var(--accent);' : undefined
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
		const d = await loadDraft();
		scenes = d?.scenes ?? [];
		startSceneId = d?.meta.startSceneId ?? '';
		buildGraph();
	}
	onMount(() => refresh().catch((e) => (message = String(e))));

	function openScene(id: string) {
		// resolve() handles the base path; the ?scene query is appended manually.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`${resolve('/editor/scenes')}?scene=${id}`);
	}

	async function onConnect(c: Connection) {
		const scene = scenes.find((s) => s.id === c.source);
		if (!scene || !c.target) return;
		const updated: Scene = {
			...scene,
			exits: [...scene.exits, { id: `exit-${Date.now()}`, toSceneId: c.target, label: '' }]
		};
		try {
			await saveScene(updated);
			message = `Added exit ${c.source} → ${c.target}.`;
			await refresh();
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		}
	}

	async function onDelete({ edges: deleted }: { nodes: Node[]; edges: Edge[] }) {
		for (const e of deleted) {
			const data = e.data as { sceneId?: string; exitId?: string } | undefined;
			const scene = data?.sceneId ? scenes.find((s) => s.id === data.sceneId) : undefined;
			if (!scene || !data?.exitId) continue;
			try {
				await saveScene({ ...scene, exits: scene.exits.filter((x) => x.id !== data.exitId) });
			} catch (err) {
				message = err instanceof Error ? err.message : String(err);
			}
		}
		await refresh();
	}
</script>

<div class="head">
	<h1>Scene graph</h1>
	<p class="hint">
		nodes = scenes (★ = start) · drag between nodes to add an exit · select an edge + Backspace to
		remove it · click a node to edit it
	</p>
	{#if message}<span class="msg">{message}</span>{/if}
</div>

<div class="graph">
	<SvelteFlow
		bind:nodes
		bind:edges
		fitView
		colorMode="dark"
		onnodeclick={({ node }) => openScene(node.id)}
		onconnect={onConnect}
		ondelete={onDelete}
	>
		<Background />
		<Controls />
	</SvelteFlow>
</div>

<style>
	.head {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		flex-wrap: wrap;
	}
	h1 {
		margin: 0 0 0.3rem;
	}
	.hint {
		margin: 0;
		font-size: 0.8rem;
		color: var(--ink-dim);
	}
	.msg {
		color: var(--accent);
		font-size: 0.85rem;
	}
	.graph {
		height: 70vh;
		margin-top: 0.8rem;
		border: 1px solid var(--line);
	}
</style>
