<script lang="ts">
	// Custom Svelte Flow node: a small stacked preview of the scene's layer art +
	// the scene name (★ = start). Handles let you drag connections (= exits).
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	let { data }: NodeProps = $props();
	const d = $derived(data as { label: string; images?: string[]; isStart?: boolean });
</script>

<div class="scene-node" class:start={d.isStart}>
	<Handle type="target" position={Position.Top} />
	<div class="preview">
		{#if d.images?.length}
			{#each d.images as src, i (i)}<img {src} alt="" />{/each}
		{:else}
			<span class="empty">no art</span>
		{/if}
	</div>
	<div class="label">{d.isStart ? '★ ' : ''}{d.label}</div>
	<Handle type="source" position={Position.Bottom} />
</div>

<style>
	.scene-node {
		width: 132px;
		background: #16191d;
		border: 1px solid var(--line);
		font-size: 0.72rem;
		color: var(--ink);
	}
	.scene-node.start {
		border-color: var(--accent);
	}
	.preview {
		position: relative;
		height: 74px;
		background: #0c0e11;
		overflow: hidden;
	}
	.preview img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--ink-dim);
	}
	.label {
		padding: 0.3rem 0.45rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
