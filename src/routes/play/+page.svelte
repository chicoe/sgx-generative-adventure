<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import SceneRenderer from '$lib/components/SceneRenderer.svelte';
	import { placeholderBuild } from '$lib/game/placeholderBuild';
	import { startGame } from '$lib/engine/state';
	import { availableExits, findScene } from '$lib/engine/graph';
	import { applyEffects } from '$lib/engine/effects';
	import { loadActiveBuild } from '$lib/content/loader';
	import type { Build, ConversationTurn, Effect, GameState, Scene } from '$lib/engine/types';

	const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
	function autofocus(node: HTMLInputElement) {
		node.focus();
	}
	function describeEffect(e: Effect): string {
		switch (e.type) {
			case 'setFlag':
				return `flag ${e.key}=${e.value}`;
			case 'addItem':
				return `+item ${e.itemId}`;
			case 'removeItem':
				return `-item ${e.itemId}`;
			case 'goToScene':
				return `→ ${e.sceneId}`;
			case 'showText':
				return `"${e.text}"`;
		}
	}

	// --- state ---------------------------------------------------------------
	let build = $state<Build>(placeholderBuild);
	let buildSource = $state<'firestore' | 'placeholder'>('placeholder');
	let game = $state<GameState>(startGame(placeholderBuild).state);

	type Line = { who: 'narration' | 'player' | 'computer' | 'system'; text: string };
	let lines = $state<Line[]>([]);
	let inputText = $state('');
	let pending = $state(false);

	// The computer the terminal is talking to (the current scene's), plus that
	// conversation's history for the LLM.
	let activeBehaviourId = $state<string | undefined>(undefined);
	let convo = $state<ConversationTurn[]>([]);

	const scene = $derived(findScene(build.scenes, game.currentSceneId)!);

	function push(who: Line['who'], text?: string | null) {
		if (text) lines = [...lines, { who, text }].slice(-200);
	}
	// One ship-wide computer for the whole game; per-scene flavour comes from the
	// scene's `prompt`. (Behaviour-on-hotspot was dropped.)
	function shipComputer(b: Build): string | undefined {
		return b.meta.defaultBehaviourId ?? b.behaviours[0]?.id;
	}
	function sceneContextFor(s: Scene, state: GameState) {
		return {
			name: s.name,
			prompt: s.prompt,
			exits: availableExits(s, state).map((x) => ({ label: x.label, toSceneId: x.toSceneId })),
			inventory: state.inventory
		};
	}

	// Set up a scene's transcript + active computer (does NOT call the network,
	// so it is safe during SSR/init; callers trigger the opening greeting).
	function enterScene(b: Build, state: GameState, narration: string[]) {
		const s = findScene(b.scenes, state.currentSceneId);
		for (const t of narration) push('narration', t);
		push('narration', s?.introText);
		convo = [];
		activeBehaviourId = shipComputer(b);
	}

	function initFrom(b: Build) {
		const started = startGame(b);
		game = started.state;
		lines = [];
		enterScene(b, started.state, started.messages);
	}

	initFrom(placeholderBuild);

	// The computer speaks first when a scene is entered.
	async function requestOpening() {
		const behaviour = activeBehaviourId
			? build.behaviours.find((b) => b.id === activeBehaviourId)
			: undefined;
		if (!behaviour) return;
		pending = true;
		try {
			const resp = await fetch('/api/converse', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					behaviourId: behaviour.id,
					opening: true,
					history: [],
					sceneContext: sceneContextFor(scene, game)
				})
			});
			const data = await resp.json();
			if (resp.ok && data.reply) {
				push('computer', data.reply);
				convo = [...convo, { role: 'computer', text: data.reply, behaviourId: behaviour.id }];
			}
		} catch {
			/* opening greeting is best-effort */
		} finally {
			pending = false;
		}
	}

	async function sendMessage() {
		const text = inputText.trim();
		if (!text || pending) return;
		push('player', text);
		inputText = '';

		const behaviour = activeBehaviourId
			? build.behaviours.find((b) => b.id === activeBehaviourId)
			: undefined;
		if (!behaviour) {
			push('system', '[ nothing here responds ]');
			return;
		}

		const prior = convo;
		convo = [...convo, { role: 'player', text, behaviourId: behaviour.id }];
		pending = true;
		try {
			const resp = await fetch('/api/converse', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					behaviourId: behaviour.id,
					playerMessage: text,
					history: prior,
					sceneContext: sceneContextFor(scene, game)
				})
			});
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
			const data: { reply: string; appliedEffects: Effect[] } = await resp.json();

			push('computer', data.reply);
			convo = [...convo, { role: 'computer', text: data.reply, behaviourId: behaviour.id }];

			if (data.appliedEffects.length) {
				const prev = game.currentSceneId;
				game = applyEffects(game, data.appliedEffects);
				const nav = data.appliedEffects.some((e) => e.type === 'goToScene');
				if (!nav) push('system', `[ ${data.appliedEffects.map(describeEffect).join(', ')} ]`);
				if (game.currentSceneId !== prev) {
					enterScene(build, game, []);
					await requestOpening();
				}
			}
		} catch {
			push('system', '[ connection lost — try again ]');
		} finally {
			pending = false;
		}
	}

	// --- parallax look (only when not typing) --------------------------------
	let look = $state({ x: 0, y: 0 });
	const target = { x: 0, y: 0 };

	function onKeydown(e: KeyboardEvent) {
		const el = e.target as HTMLElement | null;
		if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
		switch (e.key) {
			case 'ArrowLeft':
				target.x = -1;
				e.preventDefault();
				break;
			case 'ArrowRight':
				target.x = 1;
				e.preventDefault();
				break;
			case 'ArrowUp':
				target.y = -1;
				e.preventDefault();
				break;
			case 'ArrowDown':
				target.y = 1;
				e.preventDefault();
				break;
		}
	}
	function onKeyup(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') target.x = 0;
		if (e.key === 'ArrowUp' || e.key === 'ArrowDown') target.y = 0;
	}

	let transcriptEl = $state<HTMLDivElement>();
	$effect(() => {
		if (lines.length && transcriptEl) transcriptEl.scrollTop = transcriptEl.scrollHeight;
	});

	onMount(() => {
		loadActiveBuild().then(({ build: loaded, source }) => {
			buildSource = source;
			if (source === 'firestore') {
				build = loaded;
				initFrom(loaded);
			}
			requestOpening();
		});

		let raf = 0;
		let t = 0;
		const tick = () => {
			t += 1 / 60;
			const swayX = Math.sin(t * 0.6) * 0.12;
			const swayY = Math.cos(t * 0.45) * 0.08;
			const tx = clamp(target.x + swayX, -1, 1);
			const ty = clamp(target.y + swayY, -1, 1);
			look = { x: look.x + (tx - look.x) * 0.08, y: look.y + (ty - look.y) * 0.08 };
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});
</script>

<svelte:head><title>Adventure Engine — Play</title></svelte:head>
<svelte:window onkeydown={onKeydown} onkeyup={onKeyup} />

<main>
	<div class="stage">
		{#key game.currentSceneId}
			{@const snap = findScene(build.scenes, game.currentSceneId)!}
			<div class="scene-holder" in:fade={{ duration: 450 }} out:fade={{ duration: 300 }}>
				<SceneRenderer scene={snap} {look} />
			</div>
		{/key}
		<span
			class="led {buildSource}"
			title={buildSource === 'firestore' ? 'Live build (Firestore)' : 'Placeholder build'}
		></span>
		{#if buildSource === 'placeholder'}<span class="ph-tag">placeholder build</span>{/if}
	</div>

	<section class="terminal">
		<div class="transcript" bind:this={transcriptEl}>
			{#each lines as line, i (i)}
				<p class={line.who}>
					{#if line.who === 'player'}<span class="who">&gt;</span>{/if}{line.text}
				</p>
			{/each}
			{#if pending}<p class="system">…</p>{/if}
		</div>

		<form
			class="composer"
			onsubmit={(e) => {
				e.preventDefault();
				sendMessage();
			}}
		>
			<span class="prompt">&gt;</span>
			<input
				use:autofocus
				placeholder="type to the computer…"
				bind:value={inputText}
				disabled={pending}
			/>
		</form>
	</section>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-items: center;
		min-height: 100dvh;
		padding: 1.25rem;
	}

	.stage {
		position: relative;
		width: min(100%, 1100px);
		aspect-ratio: 16 / 9;
		border: 1px solid var(--line);
		overflow: hidden;
	}
	.scene-holder {
		position: absolute;
		inset: 0;
	}

	.led {
		position: absolute;
		top: 0.6rem;
		right: 0.6rem;
		z-index: 60;
		width: 0.7rem;
		height: 0.7rem;
		border-radius: 50%;
	}
	.led.firestore {
		background: #38e08a;
		box-shadow: 0 0 8px #38e08a;
	}
	.led.placeholder {
		background: #d8a23a;
		box-shadow: 0 0 8px #d8a23a;
	}
	.ph-tag {
		position: absolute;
		top: 0.5rem;
		right: 1.7rem;
		z-index: 60;
		font-size: 0.65rem;
		letter-spacing: 0.06em;
		color: #d8a23a;
	}

	.terminal {
		width: min(100%, 1100px);
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.9rem 1rem;
		background: var(--panel);
		border: 1px solid var(--line);
	}
	.transcript {
		height: 12rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.95rem;
		line-height: 1.45;
	}
	.transcript p {
		margin: 0;
	}
	.transcript .narration {
		color: var(--ink-dim);
	}
	.transcript .player {
		color: var(--ink);
	}
	.transcript .computer {
		color: var(--accent);
	}
	.transcript .system {
		color: var(--ink-dim);
		font-style: italic;
		font-size: 0.85rem;
	}
	.transcript .who {
		color: var(--ink-dim);
		margin-right: 0.4rem;
	}

	.composer {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border-top: 1px solid var(--line);
		padding-top: 0.6rem;
	}
	.composer .prompt {
		color: var(--accent);
	}
	.composer input {
		flex: 1;
		font: inherit;
		color: var(--ink);
		background: transparent;
		border: none;
		outline: none;
		padding: 0.2rem 0;
	}
</style>
