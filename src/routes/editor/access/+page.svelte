<script lang="ts">
	import { onMount } from 'svelte';
	import {
		listAccessCodes,
		createAccessCode,
		deleteAccessCode,
		generateUniqueCode,
		type AccessCode
	} from '$lib/content/accessCodes';
	import {
		loadRoomStats,
		loadEndingStats,
		type RoomStat,
		type EndingStat
	} from '$lib/content/roomStats';
	import { loadActiveBuild } from '$lib/content/loader';
	import type { Scene } from '$lib/engine/types';

	let codes = $state<AccessCode[]>([]);
	let newCode = $state('');
	let newLives = $state(3);
	let busy = $state(false);
	let message = $state('');

	// Stats: room-entry counters + the live build's scenes (for names + which are
	// endings). Resolved against the ACTIVE build so labels match what players ran.
	let stats = $state<RoomStat[]>([]);
	let endingStats = $state<EndingStat[]>([]);
	let scenes = $state<Scene[]>([]);

	async function refresh() {
		codes = await listAccessCodes();
	}
	async function refreshStats() {
		const [s, es, loaded] = await Promise.all([
			loadRoomStats(),
			loadEndingStats(),
			loadActiveBuild()
		]);
		stats = s;
		endingStats = es;
		scenes = loaded.build.scenes;
	}
	onMount(() =>
		refresh()
			.then(() => suggest())
			.then(() => refreshStats())
			.catch((e) => (message = String(e)))
	);

	// sceneId → entry count.
	const countById = $derived<Record<string, number>>(
		Object.fromEntries(stats.map((s) => [s.sceneId, s.count]))
	);
	// Ending scenes with their reached-count (0 if never), most-reached first.
	const endingRows = $derived(
		scenes
			.filter((s) => s.ending)
			.map((s) => ({ id: s.id, label: s.name || s.id, count: countById[s.id] ?? 0 }))
			.sort((a, b) => b.count - a.count)
	);
	// Non-ending rooms + any orphan counters (scene since removed from the build).
	const roomRows = $derived.by(() => {
		const inBuild = new Set(scenes.map((s) => s.id));
		const rows = scenes
			.filter((s) => !s.ending)
			.map((s) => ({ id: s.id, label: s.name || s.id, count: countById[s.id] ?? 0 }));
		for (const st of stats)
			if (!inBuild.has(st.sceneId))
				rows.push({ id: st.sceneId, label: `${st.sceneId} (removed)`, count: st.count });
		return rows.sort((a, b) => b.count - a.count);
	});
	// One shared scale across BOTH graphs (endings + rooms) so bar lengths are
	// directly comparable — the largest count anywhere is the full-width bar.
	const maxCount = $derived(
		Math.max(1, ...roomRows.map((r) => r.count), ...endingRows.map((r) => r.count))
	);

	// code → (sceneId → count) for the per-code ending breakdown shown on each row.
	const endingByCode = $derived.by(() => {
		const m: Record<string, Record<string, number>> = {};
		for (const e of endingStats) (m[e.code] ??= {})[e.sceneId] = e.count;
		return m;
	});
	// For a code: the ending scenes it reached (count > 0), labelled, most first.
	function endingsForCode(code: string) {
		const m = endingByCode[code] ?? {};
		return endingRows
			.map((r) => ({ id: r.id, label: r.label, count: m[r.id] ?? 0 }))
			.filter((r) => r.count > 0)
			.sort((a, b) => b.count - a.count);
	}

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

<div class="codes-scroll">
	<table>
		<thead>
			<tr><th>Code</th><th>Lives left</th><th>Endings reached</th><th>Created</th><th></th></tr>
		</thead>
		<tbody>
			{#each codes as c (c.code)}
				<tr class:dead={c.lives <= 0}>
					<td class="code">{c.code}</td>
					<td>{c.lives} / {c.livesTotal}</td>
					<td>
						<div class="endings">
							{#each endingsForCode(c.code) as e (e.id)}
								<span class="chip">{e.label} ×{e.count}</span>
							{:else}
								<span class="muted">—</span>
							{/each}
						</div>
					</td>
					<td class="muted">{new Date(c.createdAt).toLocaleString()}</td>
					<td
						><button type="button" class="del" onclick={() => remove(c.code)} disabled={busy}
							>delete</button
						></td
					>
				</tr>
			{:else}
				<tr><td colspan="5" class="muted">No codes yet.</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<h2>Endings reached</h2>
{#if endingRows.length}
	<div class="bars">
		{#each endingRows as r (r.id)}
			<div class="bar-row">
				<span class="bar-label" title={r.label}>{r.label}</span>
				<span class="bar-track">
					<span class="bar-fill" style:width={`${(r.count / maxCount) * 100}%`}></span>
				</span>
				<span class="bar-count">{r.count}</span>
			</div>
		{/each}
	</div>
{:else}
	<p class="muted">No ending scenes in the active build.</p>
{/if}

<h2>Rooms entered</h2>
{#if roomRows.length}
	<div class="bars">
		{#each roomRows as r (r.id)}
			<div class="bar-row">
				<span class="bar-label" title={r.label}>{r.label}</span>
				<span class="bar-track">
					<span class="bar-fill" style:width={`${(r.count / maxCount) * 100}%`}></span>
				</span>
				<span class="bar-count">{r.count}</span>
			</div>
		{/each}
	</div>
{:else}
	<p class="muted">No room entries logged yet.</p>
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
	/* The codes list takes at most half the viewport, then scrolls. */
	.codes-scroll {
		max-height: 50vh;
		overflow: auto;
		border-bottom: 1px solid var(--line);
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
		/* Keep the header visible while the (capped) list scrolls. */
		position: sticky;
		top: 0;
		background: var(--bg);
	}
	h2 {
		margin: 1.5rem 0 0.6rem;
		font-size: 1rem;
		color: var(--ink-dim);
		font-weight: normal;
		letter-spacing: 0.08em;
	}
	/* Horizontal bar graph: label · proportional bar · count. */
	.bars {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		max-width: 48rem;
	}
	.bar-row {
		display: grid;
		grid-template-columns: 12rem 1fr 3rem;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.85rem;
	}
	.bar-label {
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bar-track {
		height: 1rem;
		background: #0c0e11;
		border: 1px solid var(--line);
	}
	.bar-fill {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	.bar-count {
		text-align: right;
		color: var(--ink-dim);
		font-variant-numeric: tabular-nums;
	}
	.code {
		font-family: var(--font-terminal, monospace);
		letter-spacing: 0.12em;
	}
	tr.dead .code {
		color: var(--ink-dim);
		text-decoration: line-through;
	}
	/* Per-code ending breakdown: small inline chips on the code's row. */
	.endings {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.chip {
		font-size: 0.72rem;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		border-radius: 2px;
		padding: 0.05rem 0.35rem;
		white-space: nowrap;
	}
</style>
