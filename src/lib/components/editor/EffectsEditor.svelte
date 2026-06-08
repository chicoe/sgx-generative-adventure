<script lang="ts">
	// Reusable editor for an Effect[] (SPEC §4.3). Two-way bound via $bindable.
	import type { Effect, FlagValue } from '$lib/engine/types';

	let {
		effects = $bindable([]),
		itemIds = [],
		sceneIds = [],
		label = 'Effects'
	}: { effects: Effect[]; itemIds?: string[]; sceneIds?: string[]; label?: string } = $props();

	const TYPES: Effect['type'][] = ['setFlag', 'addItem', 'removeItem', 'goToScene', 'showText'];

	function blank(type: Effect['type']): Effect {
		switch (type) {
			case 'setFlag':
				return { type: 'setFlag', key: '', value: true };
			case 'addItem':
				return { type: 'addItem', itemId: '' };
			case 'removeItem':
				return { type: 'removeItem', itemId: '' };
			case 'goToScene':
				return { type: 'goToScene', sceneId: '' };
			case 'showText':
				return { type: 'showText', text: '' };
		}
	}

	function patch(i: number, partial: Record<string, unknown>) {
		effects = effects.map((e, j) => (j === i ? ({ ...e, ...partial } as Effect) : e));
	}
	const add = () => (effects = [...effects, blank('setFlag')]);
	const remove = (i: number) => (effects = effects.filter((_, j) => j !== i));
	const changeType = (i: number, t: Effect['type']) =>
		(effects = effects.map((e, j) => (j === i ? blank(t) : e)));

	const valueType = (v: FlagValue) =>
		typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string';

	function convertValue(i: number, vt: string) {
		const e = effects[i];
		if (e.type !== 'setFlag') return;
		const cur = String(e.value);
		patch(i, {
			value: vt === 'number' ? Number(cur) || 0 : vt === 'boolean' ? cur === 'true' : cur
		});
	}
	function setRaw(i: number, raw: string) {
		const e = effects[i];
		if (e.type !== 'setFlag') return;
		const value: FlagValue =
			typeof e.value === 'number'
				? Number(raw) || 0
				: typeof e.value === 'boolean'
					? raw === 'true'
					: raw;
		patch(i, { value });
	}
</script>

<fieldset>
	<legend>{label}</legend>
	{#each effects as e, i (i)}
		<div class="effect">
			<select
				value={e.type}
				onchange={(ev) => changeType(i, ev.currentTarget.value as Effect['type'])}
			>
				{#each TYPES as t (t)}<option value={t}>{t}</option>{/each}
			</select>

			{#if e.type === 'setFlag'}
				<input
					placeholder="flag key"
					value={e.key}
					oninput={(ev) => patch(i, { key: ev.currentTarget.value })}
				/>
				<select
					value={valueType(e.value)}
					onchange={(ev) => convertValue(i, ev.currentTarget.value)}
				>
					<option value="boolean">bool</option>
					<option value="string">text</option>
					<option value="number">num</option>
				</select>
				{#if typeof e.value === 'boolean'}
					<select value={String(e.value)} onchange={(ev) => setRaw(i, ev.currentTarget.value)}>
						<option value="true">true</option>
						<option value="false">false</option>
					</select>
				{:else}
					<input value={String(e.value)} oninput={(ev) => setRaw(i, ev.currentTarget.value)} />
				{/if}
			{:else if e.type === 'addItem' || e.type === 'removeItem'}
				<input
					placeholder="itemId"
					list="effect-items"
					value={e.itemId}
					oninput={(ev) => patch(i, { itemId: ev.currentTarget.value })}
				/>
			{:else if e.type === 'goToScene'}
				<input
					placeholder="sceneId"
					list="effect-scenes"
					value={e.sceneId}
					oninput={(ev) => patch(i, { sceneId: ev.currentTarget.value })}
				/>
			{:else if e.type === 'showText'}
				<input
					class="grow"
					placeholder="text"
					value={e.text}
					oninput={(ev) => patch(i, { text: ev.currentTarget.value })}
				/>
			{/if}

			<button type="button" class="x" onclick={() => remove(i)} title="remove">✕</button>
		</div>
	{/each}

	<datalist id="effect-items"
		>{#each itemIds as id (id)}<option value={id}></option>{/each}</datalist
	>
	<datalist id="effect-scenes"
		>{#each sceneIds as id (id)}<option value={id}></option>{/each}</datalist
	>

	<button type="button" class="add" onclick={add}>+ effect</button>
</fieldset>

<style>
	fieldset {
		border: 1px solid var(--line);
		padding: 0.5rem 0.7rem 0.7rem;
		margin: 0;
	}
	legend {
		color: var(--ink-dim);
		font-size: 0.8rem;
		padding: 0 0.4rem;
	}
	.effect {
		display: flex;
		gap: 0.4rem;
		margin-bottom: 0.4rem;
		align-items: center;
	}
	input,
	select {
		font: inherit;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.3rem 0.45rem;
	}
	input.grow {
		flex: 1;
	}
	button {
		font: inherit;
		cursor: pointer;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.3rem 0.55rem;
	}
	button:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.x {
		color: var(--ink-dim);
	}
	.add {
		font-size: 0.85rem;
	}
</style>
