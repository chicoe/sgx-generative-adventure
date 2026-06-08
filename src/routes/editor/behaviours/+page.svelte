<script lang="ts">
	import { onMount } from 'svelte';
	import EffectsEditor from '$lib/components/editor/EffectsEditor.svelte';
	import { loadDraft, saveBehaviour, deleteBehaviour } from '$lib/content/draft';
	import type { ConversationTurn, LLMBehaviour } from '$lib/engine/types';

	let behaviours = $state<LLMBehaviour[]>([]);
	let itemIds = $state<string[]>([]);
	let sceneIds = $state<string[]>([]);
	let current = $state<LLMBehaviour | null>(null);
	let busy = $state(false);
	let message = $state('');

	async function refresh() {
		const d = await loadDraft();
		behaviours = d?.behaviours ?? [];
		itemIds = (d?.items ?? []).map((i) => i.id);
		sceneIds = (d?.scenes ?? []).map((s) => s.id);
	}
	onMount(() => refresh().catch((e) => (message = String(e))));

	function select(b: LLMBehaviour) {
		// $state.snapshot, not structuredClone (which throws on Svelte state proxies).
		current = $state.snapshot(b) as LLMBehaviour;
		if (!current.onDeniedEffects) current.onDeniedEffects = [];
		resetTest();
	}
	function newBehaviour() {
		current = {
			id: '',
			name: '',
			systemPrompt: '',
			goal: '',
			guardrails: [],
			allowedOutcomes: [{ id: 'deny', label: 'Refuse', granted: false, effects: [] }],
			onGrantedEffects: [],
			onDeniedEffects: []
		};
		resetTest();
	}

	async function save() {
		if (!current) return;
		const id = current.id.trim();
		if (!id) return (message = 'Behaviour needs an id.');
		const toSave: LLMBehaviour = {
			...current,
			id,
			guardrails: current.guardrails.map((g) => g).filter((g) => g.trim() !== '')
		};
		if (toSave.maxTurns === undefined || Number.isNaN(toSave.maxTurns)) delete toSave.maxTurns;
		busy = true;
		message = '';
		try {
			await saveBehaviour(toSave);
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
			await deleteBehaviour(current.id);
			current = null;
			await refresh();
			message = 'Deleted.';
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	const addGuardrail = () => current && (current.guardrails = [...current.guardrails, '']);
	const removeGuardrail = (i: number) =>
		current && (current.guardrails = current.guardrails.filter((_, j) => j !== i));
	const addOutcome = () =>
		current &&
		(current.allowedOutcomes = [
			...current.allowedOutcomes,
			{ id: '', label: '', granted: false, effects: [] }
		]);
	const removeOutcome = (i: number) =>
		current && (current.allowedOutcomes = current.allowedOutcomes.filter((_, j) => j !== i));

	// --- test panel ---
	let testInput = $state('');
	let testTurns = $state<ConversationTurn[]>([]);
	let testPending = $state(false);
	function resetTest() {
		testTurns = [];
		testInput = '';
	}
	async function sendTest() {
		if (!current || !testInput.trim() || testPending) return;
		const text = testInput.trim();
		const prior = testTurns;
		const tag = current.id || 'draft';
		testTurns = [...testTurns, { role: 'player', text, behaviourId: tag }];
		testInput = '';
		testPending = true;
		try {
			const resp = await fetch('/api/converse', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ behaviour: current, playerMessage: text, history: prior })
			});
			const data = await resp.json();
			if (!resp.ok) throw new Error(data?.message || `HTTP ${resp.status}`);
			const tail = `  ·  [${data.outcomeId}${data.granted ? ' ✓granted' : ''}]`;
			testTurns = [...testTurns, { role: 'computer', text: data.reply + tail, behaviourId: tag }];
		} catch (e) {
			testTurns = [
				...testTurns,
				{
					role: 'computer',
					text: `[ error: ${e instanceof Error ? e.message : e} ]`,
					behaviourId: tag
				}
			];
		} finally {
			testPending = false;
		}
	}
</script>

<h1>Behaviours</h1>
<p class="note">
	⚠ Placeholder content. The test panel runs the live model against the behaviour you're editing
	(unpublished).
</p>
{#if message}<p class="msg">{message}</p>{/if}

<div class="toolbar">
	<select
		value={current?.id ?? ''}
		onchange={(e) => {
			const b = behaviours.find((x) => x.id === e.currentTarget.value);
			if (b) select(b);
		}}
	>
		<option value="" disabled>— pick a behaviour —</option>
		{#each behaviours as b (b.id)}<option value={b.id}>{b.name || b.id}</option>{/each}
	</select>
	<button type="button" onclick={newBehaviour}>+ New behaviour</button>
</div>

{#if current}
	<div class="editor-grid">
		<div class="form">
			<label>id <input bind:value={current.id} placeholder="override" /></label>
			<label>name <input bind:value={current.name} /></label>
			<label
				>system prompt (computer persona)
				<textarea rows="3" bind:value={current.systemPrompt}></textarea>
			</label>
			<label
				>goal (what the player is trying to achieve)
				<textarea rows="2" bind:value={current.goal}></textarea>
			</label>

			<fieldset>
				<legend>guardrails (MUST-NOT rules)</legend>
				{#each current.guardrails as _g, i (i)}
					<div class="rowline">
						<input bind:value={current.guardrails[i]} />
						<button type="button" class="x" onclick={() => removeGuardrail(i)}>✕</button>
					</div>
				{/each}
				<button type="button" class="add" onclick={addGuardrail}>+ guardrail</button>
			</fieldset>

			<label class="inline"
				>max turns (optional)
				<input type="number" min="1" bind:value={current.maxTurns} />
			</label>

			<fieldset>
				<legend>allowed outcomes (the model picks exactly one)</legend>
				{#each current.allowedOutcomes as _o, k (k)}
					<div class="outcome">
						<div class="rowline">
							<input class="oid" placeholder="id" bind:value={current.allowedOutcomes[k].id} />
							<input placeholder="label" bind:value={current.allowedOutcomes[k].label} />
							<label class="chk">
								<input type="checkbox" bind:checked={current.allowedOutcomes[k].granted} /> granted
							</label>
							<button type="button" class="x" onclick={() => removeOutcome(k)}>✕</button>
						</div>
						<EffectsEditor
							bind:effects={current.allowedOutcomes[k].effects}
							{itemIds}
							{sceneIds}
							label="outcome effects"
						/>
					</div>
				{/each}
				<button type="button" class="add" onclick={addOutcome}>+ outcome</button>
			</fieldset>

			<EffectsEditor
				bind:effects={current.onGrantedEffects}
				{itemIds}
				{sceneIds}
				label="on granted (any granted outcome)"
			/>
			<EffectsEditor
				bind:effects={current.onDeniedEffects!}
				{itemIds}
				{sceneIds}
				label="on denied"
			/>

			<div class="actions">
				<button type="button" class="primary" onclick={save} disabled={busy}>Save</button>
				<button type="button" class="del" onclick={remove} disabled={busy}>Delete</button>
			</div>
		</div>

		<div class="test">
			<h2>Test panel</h2>
			<div class="transcript">
				{#each testTurns as t, i (i)}
					<p class={t.role}>
						<span class="who">{t.role === 'player' ? 'YOU' : 'COMPUTER'}</span>
						{t.text}
					</p>
				{:else}
					<p class="muted">Type a message to try the behaviour against the live model.</p>
				{/each}
				{#if testPending}<p class="muted">thinking…</p>{/if}
			</div>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					sendTest();
				}}
			>
				<input
					placeholder="say something to the computer…"
					bind:value={testInput}
					disabled={testPending}
				/>
				<button type="submit" disabled={testPending || !testInput.trim()}>Send</button>
			</form>
		</div>
	</div>
{:else}
	<p class="muted">Pick a behaviour above, or create a new one.</p>
{/if}

<style>
	h1 {
		margin: 0 0 0.5rem;
	}
	h2 {
		margin: 0 0 0.6rem;
		font-size: 1rem;
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
	.editor-grid {
		display: grid;
		grid-template-columns: 1fr 22rem;
		gap: 1.2rem;
		align-items: start;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.75rem;
		color: var(--ink-dim);
	}
	label.inline {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}
	label.inline input {
		width: 6rem;
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
	}
	legend {
		color: var(--ink-dim);
		font-size: 0.8rem;
		padding: 0 0.4rem;
	}
	.rowline {
		display: flex;
		gap: 0.4rem;
		margin-bottom: 0.4rem;
		align-items: center;
	}
	.rowline input {
		flex: 1;
	}
	.oid {
		max-width: 7rem;
	}
	.chk {
		flex-direction: row;
		align-items: center;
		gap: 0.3rem;
		color: var(--ink);
		white-space: nowrap;
	}
	.outcome {
		border-left: 2px solid var(--line);
		padding-left: 0.6rem;
		margin-bottom: 0.7rem;
	}
	.actions {
		display: flex;
		gap: 0.6rem;
		margin-top: 0.4rem;
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
		padding: 0.25rem 0.5rem;
	}
	.x {
		color: var(--ink-dim);
		padding: 0.2rem 0.45rem;
	}
	.primary {
		border-color: var(--accent);
	}
	.del {
		color: #e0a8a8;
	}
	.test {
		position: sticky;
		top: 1rem;
		border: 1px solid var(--line);
		padding: 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.transcript {
		min-height: 8rem;
		max-height: 24rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		font-size: 0.9rem;
	}
	.transcript p {
		margin: 0;
	}
	.transcript .who {
		color: var(--ink-dim);
		margin-right: 0.4rem;
	}
	.transcript .computer {
		color: var(--accent);
	}
	.test form {
		display: flex;
		gap: 0.5rem;
	}
	.test form input {
		flex: 1;
	}
</style>
