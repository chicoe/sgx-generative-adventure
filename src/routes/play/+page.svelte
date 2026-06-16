<script lang="ts">
	// The game runtime (active published build). Access-gated: a visitor needs a
	// valid ?code=… (entered at the root prompt), or the ?specialaccess=sgx bypass,
	// or the kiosk flag. Anyone else is bounced to the code prompt. The code (if
	// any) is handed to Game, which spends a life each time a run starts.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Game from '$lib/components/Game.svelte';

	let ready = $state(false);
	let accessCode = $state<string | undefined>(undefined);

	onMount(() => {
		const p = page.url.searchParams;
		const code = p.get('code')?.trim().toUpperCase() || undefined;
		const special = p.get('specialaccess') === 'sgx';
		const kiosk = p.has('kiosk');
		if (!code && !special && !kiosk) {
			// No way in — send them to the access-code prompt.
			goto(resolve('/'));
			return;
		}
		// specialaccess / kiosk play freely (no code to spend).
		accessCode = special || kiosk ? undefined : code;
		ready = true;
	});
</script>

{#if ready}
	<Game {accessCode} />
{/if}
