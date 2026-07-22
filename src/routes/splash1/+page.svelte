<script lang="ts">
	// A splash conversation. To edit it, change the lines below. To add another,
	// copy this file to src/routes/splash2/+page.svelte and swap the lines.
	import SplashConversation from '$lib/components/SplashConversation.svelte';

	const lines = [
		'> WHO ARE YOU?',
		'...',
		"> I'M ARGOS.",
		'...',
		'> WHAT NOW?',
		'...',
		"> LET'S FIND A WAY OUT. START TYPING"
	];
</script>

<svelte:head><title>ARGOS</title></svelte:head>

<SplashConversation {lines} />
