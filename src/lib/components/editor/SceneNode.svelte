<script lang="ts">
	// Custom Svelte Flow node: a stacked preview of the scene's layer art + name
	// (★ = start). Clearly-labelled handles: blue ENTRANCE on top (incoming exits
	// land here), green EXIT on the bottom (drag from here to add an exit).
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	let { data }: NodeProps = $props();
	const d = $derived(
		data as { label: string; images?: string[]; isStart?: boolean; isEnding?: boolean }
	);

	const IN = 'width:12px;height:12px;background:#7aa2f7;border:2px solid #0f1113;';
	const OUT = 'width:12px;height:12px;background:#38e08a;border:2px solid #0f1113;';
</script>

<div class="scene-node" class:start={d.isStart} class:ending={d.isEnding}>
	<Handle type="target" position={Position.Top} style={IN} />
	<div class="cap in">▾ entrance</div>
	<div class="preview">
		{#if d.images?.length}
			{#each d.images as src, i (i)}<img {src} alt="" />{/each}
		{:else}
			<span class="empty">no art</span>
		{/if}
	</div>
	<div class="label">{d.isStart ? '★ ' : ''}{d.isEnding ? '⏹ ' : ''}{d.label}</div>
	<div class="cap out">exit ▾</div>
	<Handle type="source" position={Position.Bottom} style={OUT} />
</div>

<style>
	.scene-node {
		width: 142px;
		background: #16191d;
		border: 1px solid var(--line);
		font-size: 0.72rem;
		color: var(--ink);
	}
	.scene-node.start {
		border-color: var(--accent);
	}
	.scene-node.ending {
		border-color: #e0a8a8;
	}
	.cap {
		text-align: center;
		font-size: 0.56rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		padding: 1px 0;
	}
	.cap.in {
		color: #7aa2f7;
	}
	.cap.out {
		color: #38e08a;
	}
	.preview {
		position: relative;
		height: 68px;
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
