<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { afterNavigate } from '$app/navigation';
	import { authStore, initAuth, login, logout } from '$lib/firebase/auth.svelte';
	import { draftStatus } from '$lib/content/draftStatus.svelte';

	let { children } = $props();

	onMount(() => initAuth());

	// Keep the "unpublished changes" indicator current: re-check when the editor
	// signs in and after every navigation between editor pages.
	$effect(() => {
		if (authStore.user) draftStatus.check();
	});
	afterNavigate(() => {
		if (authStore.user) draftStatus.check();
	});

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	async function doLogin(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		busy = true;
		try {
			await login(email.trim(), password);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Sign-in failed';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Editor — Adventure Engine</title></svelte:head>

<div class="editor">
	<header>
		<div class="bar info">
			<span class="brand">ADVENTURE ENGINE · EDITOR</span>
			<span class="spacer"></span>
			{#if authStore.user}
				{#if draftStatus.dirty}
					<a
						class="status dirty"
						href={resolve('/editor')}
						title="The draft has changes that aren't live yet — save & publish a version"
						>● unpublished changes</a
					>
				{:else if draftStatus.checked}
					<span class="status clean" title="The draft matches the live version">✓ published</span>
				{/if}
				<span class="who">{authStore.user.email}</span>
				<button type="button" onclick={() => logout()}>sign out</button>
			{/if}
		</div>
		{#if authStore.user}
			<nav class="bar">
				<a href={resolve('/editor')}>Overview</a>
				<a href={resolve('/editor/graph')}>Graph</a>
				<a href={resolve('/editor/scenes')}>Scenes</a>
				<a href={resolve('/editor/items')}>Items</a>
				<a href={resolve('/editor/behaviours')}>Behaviours</a>
				<a href={resolve('/editor/settings')}>Display</a>
				<a href={resolve('/editor/access')}>Access</a>
				<a href={resolve('/testplay')}>▶ Test</a>
				<a href={resolve('/play')}>▶ Play</a>
			</nav>
		{/if}
	</header>

	<main>
		{#if !authStore.ready}
			<p class="muted">connecting…</p>
		{:else if !authStore.user}
			<form class="login" onsubmit={doLogin}>
				<h1>Sign in</h1>
				<p class="muted">Editor access is restricted to the allowlist.</p>
				<input type="email" placeholder="email" bind:value={email} autocomplete="username" />
				<input
					type="password"
					placeholder="password"
					bind:value={password}
					autocomplete="current-password"
				/>
				<button type="submit" disabled={busy || !email || !password}>
					{busy ? '…' : 'Sign in'}
				</button>
				{#if error}<p class="error">{error}</p>{/if}
			</form>
		{:else}
			{@render children()}
		{/if}
	</main>
</div>

<style>
	header {
		border-bottom: 1px solid var(--line);
		font-size: 0.85rem;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.55rem 1.25rem;
	}
	.bar.info {
		border-bottom: 1px solid var(--line);
	}
	.brand {
		letter-spacing: 0.18em;
		color: var(--ink-dim);
		white-space: nowrap;
	}
	header nav a {
		white-space: nowrap;
	}
	.spacer {
		flex: 1;
	}
	.who {
		color: var(--ink-dim);
	}
	.status {
		font-size: 0.8rem;
		white-space: nowrap;
	}
	.status.dirty {
		color: #ff5a4a;
		text-decoration: none;
	}
	.status.dirty:hover {
		text-decoration: underline;
	}
	.status.clean {
		color: #9fc0a8;
	}
	main {
		max-width: 64rem;
		margin: 0 auto;
		padding: 1.5rem 1.25rem 4rem;
	}
	.muted {
		color: var(--ink-dim);
	}
	.error {
		color: #e08a8a;
	}
	.login {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 22rem;
		margin: 3rem auto 0;
	}
	.login h1 {
		margin: 0;
		font-size: 1.3rem;
	}
	input,
	button {
		font: inherit;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.5rem 0.7rem;
	}
	button {
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
</style>
