<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { checkAccessCode } from '$lib/content/accessCodes';

	let code = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const c = code.trim().toUpperCase();
		if (c.length < 4) {
			error = 'Enter your access code.';
			return;
		}
		busy = true;
		error = '';
		const res = await checkAccessCode(c);
		busy = false;
		if (res.ok) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			goto(`${resolve('/play')}?code=${encodeURIComponent(c)}`);
		} else if (res.reason === 'depleted') {
			error = 'That code has no plays left.';
		} else if (res.reason === 'unknown') {
			error = 'Unknown code.';
		} else {
			error = 'Could not check the code — please try again.';
		}
	}
</script>

<svelte:head><title>Adventure Engine</title></svelte:head>

<main class="gate">
	<form class="box" onsubmit={submit}>
		<p class="prompt">ENTER ACCESS CODE</p>
		<input
			bind:value={code}
			oninput={() => (code = code.toUpperCase())}
			maxlength="24"
			autocomplete="off"
			spellcheck="false"
			placeholder="• • • •"
			aria-label="access code"
		/>
		<button type="submit" disabled={busy || code.trim().length < 4}>
			{busy ? 'checking…' : 'begin'}
		</button>
		{#if error}<p class="error">{error}</p>{/if}
	</form>
</main>

<style>
	.gate {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		background: #000;
		font-family: var(--font-terminal, monospace);
	}
	.box {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.2rem;
		padding: 2rem;
		min-width: 18rem;
	}
	.prompt {
		margin: 0;
		color: #ffb000;
		letter-spacing: 0.25em;
		font-size: 1rem;
	}
	input {
		width: 12rem;
		text-align: center;
		font: inherit;
		font-size: 1.6rem;
		letter-spacing: 0.4em;
		text-transform: uppercase;
		color: #ffb000;
		background: transparent;
		border: none;
		border-bottom: 2px solid #6b4e10;
		padding: 0.4rem 0;
		outline: none;
	}
	input::placeholder {
		color: #5a4410;
		letter-spacing: 0.3em;
	}
	button {
		font: inherit;
		letter-spacing: 0.2em;
		color: #000;
		background: #ffb000;
		border: none;
		padding: 0.55rem 1.6rem;
		cursor: pointer;
		text-transform: uppercase;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.error {
		margin: 0;
		color: #e0a8a8;
		font-size: 0.85rem;
		letter-spacing: 0.08em;
	}
</style>
