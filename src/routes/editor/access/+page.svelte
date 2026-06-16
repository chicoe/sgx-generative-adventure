<script lang="ts">
	import { onMount } from 'svelte';
	import {
		listAccessCodes,
		createAccessCode,
		deleteAccessCode,
		generateUniqueCode,
		type AccessCode
	} from '$lib/content/accessCodes';

	let codes = $state<AccessCode[]>([]);
	let newCode = $state('');
	let newLives = $state(3);
	let busy = $state(false);
	let message = $state('');

	async function refresh() {
		codes = await listAccessCodes();
	}
	onMount(() =>
		refresh()
			.then(() => suggest())
			.catch((e) => (message = String(e)))
	);

	// Pre-fill a fresh random code (the editor can overwrite it before creating).
	function suggest() {
		newCode = generateUniqueCode(codes.map((c) => c.code));
	}

	async function create() {
		busy = true;
		message = '';
		try {
			const c = await createAccessCode(newCode, newLives);
			message = `Created "${c.code}" with ${c.lives} ${c.lives === 1 ? 'life' : 'lives'}.`;
			await refresh();
			suggest();
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function remove(code: string) {
		busy = true;
		message = '';
		try {
			await deleteAccessCode(code);
			await refresh();
			message = `Deleted "${code}".`;
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<h1>Access codes</h1>
<p class="note">
	Codes gate the public game (visitors enter one at the start). Each code has a number of
	<strong>lives</strong> — one is spent every time a run begins. <code>?specialaccess=sgx</code> on the
	URL skips the code prompt entirely.
</p>
{#if message}<p class="msg">{message}</p>{/if}

<div class="new">
	<label
		>code <input
			bind:value={newCode}
			maxlength="24"
			oninput={() => (newCode = newCode.toUpperCase())}
		/></label
	>
	<label class="num">lives <input type="number" min="1" bind:value={newLives} /></label>
	<button type="button" onclick={suggest} disabled={busy} title="random 4-character code">🎲</button
	>
	<button
		type="button"
		class="primary"
		onclick={create}
		disabled={busy || newCode.trim().length < 4}>Create code</button
	>
</div>

<table>
	<thead>
		<tr><th>Code</th><th>Lives left</th><th>Created</th><th></th></tr>
	</thead>
	<tbody>
		{#each codes as c (c.code)}
			<tr class:dead={c.lives <= 0}>
				<td class="code">{c.code}</td>
				<td>{c.lives} / {c.livesTotal}</td>
				<td class="muted">{new Date(c.createdAt).toLocaleString()}</td>
				<td
					><button type="button" class="del" onclick={() => remove(c.code)} disabled={busy}
						>delete</button
					></td
				>
			</tr>
		{:else}
			<tr><td colspan="4" class="muted">No codes yet.</td></tr>
		{/each}
	</tbody>
</table>

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
	.new {
		display: flex;
		align-items: flex-end;
		gap: 0.6rem;
		margin: 1rem 0;
		flex-wrap: wrap;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.75rem;
		color: var(--ink-dim);
	}
	.num input {
		width: 5rem;
	}
	input {
		font: inherit;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.35rem 0.5rem;
	}
	button {
		font: inherit;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.4rem 0.7rem;
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.primary {
		border-color: var(--accent);
	}
	.del {
		color: #e0a8a8;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid var(--line);
	}
	th {
		color: var(--ink-dim);
		font-weight: normal;
		font-size: 0.78rem;
	}
	.code {
		font-family: var(--font-terminal, monospace);
		letter-spacing: 0.12em;
	}
	tr.dead .code {
		color: var(--ink-dim);
		text-decoration: line-through;
	}
</style>
