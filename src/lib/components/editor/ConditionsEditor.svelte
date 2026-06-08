<script lang="ts">
	// Edits an optional Condition as a flat list of leaves (hasItem | flag),
	// AND-combined (SPEC §4.3). or/not aren't surfaced in the UI yet — they round-
	// trip only if present. Operates directly on the bound value (source of truth).
	import type { Condition, FlagValue } from '$lib/engine/types';

	let {
		condition = $bindable(undefined),
		itemIds = []
	}: { condition?: Condition; itemIds?: string[] } = $props();

	type Leaf =
		| { type: 'hasItem'; itemId: string }
		| { type: 'flag'; key: string; equals: FlagValue };

	function toLeaves(c?: Condition): Leaf[] {
		if (!c) return [];
		if (c.type === 'and') return c.all.flatMap(toLeaves);
		if (c.type === 'hasItem' || c.type === 'flag') return [c];
		return [];
	}
	const leaves = () => toLeaves(condition);
	function setLeaves(ls: Leaf[]) {
		condition = ls.length === 0 ? undefined : ls.length === 1 ? ls[0] : { type: 'and', all: ls };
	}
	const addHasItem = () => setLeaves([...leaves(), { type: 'hasItem', itemId: '' }]);
	const addFlag = () => setLeaves([...leaves(), { type: 'flag', key: '', equals: true }]);
	const removeLeaf = (i: number) => setLeaves(leaves().filter((_, j) => j !== i));
	const update = (i: number, leaf: Leaf) => setLeaves(leaves().map((l, j) => (j === i ? leaf : l)));

	const valueType = (v: FlagValue) =>
		typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string';
	function convert(i: number, leaf: Leaf, vt: string) {
		if (leaf.type !== 'flag') return;
		const cur = String(leaf.equals);
		update(i, {
			...leaf,
			equals: vt === 'number' ? Number(cur) || 0 : vt === 'boolean' ? cur === 'true' : cur
		});
	}
	function setRaw(i: number, leaf: Leaf, raw: string) {
		if (leaf.type !== 'flag') return;
		const equals: FlagValue =
			typeof leaf.equals === 'number'
				? Number(raw) || 0
				: typeof leaf.equals === 'boolean'
					? raw === 'true'
					: raw;
		update(i, { ...leaf, equals });
	}
</script>

<fieldset>
	<legend>condition (all must be true; empty = always available)</legend>
	{#each leaves() as leaf, i (i)}
		<div class="cond">
			<select
				value={leaf.type}
				onchange={(e) =>
					update(
						i,
						e.currentTarget.value === 'flag'
							? { type: 'flag', key: '', equals: true }
							: { type: 'hasItem', itemId: '' }
					)}
			>
				<option value="hasItem">hasItem</option>
				<option value="flag">flag</option>
			</select>
			{#if leaf.type === 'hasItem'}
				<input
					placeholder="itemId"
					list="cond-items"
					value={leaf.itemId}
					oninput={(e) => update(i, { type: 'hasItem', itemId: e.currentTarget.value })}
				/>
			{:else}
				<input
					placeholder="flag key"
					value={leaf.key}
					oninput={(e) => update(i, { ...leaf, key: e.currentTarget.value })}
				/>
				<span class="eq">=</span>
				<select
					value={valueType(leaf.equals)}
					onchange={(e) => convert(i, leaf, e.currentTarget.value)}
				>
					<option value="boolean">bool</option>
					<option value="string">text</option>
					<option value="number">num</option>
				</select>
				{#if typeof leaf.equals === 'boolean'}
					<select
						value={String(leaf.equals)}
						onchange={(e) => setRaw(i, leaf, e.currentTarget.value)}
					>
						<option value="true">true</option>
						<option value="false">false</option>
					</select>
				{:else}
					<input
						value={String(leaf.equals)}
						oninput={(e) => setRaw(i, leaf, e.currentTarget.value)}
					/>
				{/if}
			{/if}
			<button type="button" class="x" onclick={() => removeLeaf(i)}>✕</button>
		</div>
	{/each}
	<datalist id="cond-items"
		>{#each itemIds as id (id)}<option value={id}></option>{/each}</datalist
	>
	<div class="add">
		<button type="button" onclick={addHasItem}>+ hasItem</button>
		<button type="button" onclick={addFlag}>+ flag</button>
	</div>
</fieldset>

<style>
	fieldset {
		border: 1px solid var(--line);
		margin: 0;
		padding: 0.4rem 0.6rem 0.6rem;
	}
	legend {
		color: var(--ink-dim);
		font-size: 0.75rem;
		padding: 0 0.4rem;
	}
	.cond {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		margin-bottom: 0.4rem;
	}
	.eq {
		color: var(--ink-dim);
	}
	input,
	select {
		font: inherit;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.3rem 0.45rem;
	}
	button {
		font: inherit;
		cursor: pointer;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.25rem 0.5rem;
		font-size: 0.8rem;
	}
	button:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.add {
		display: flex;
		gap: 0.4rem;
	}
	.x {
		color: var(--ink-dim);
	}
</style>
