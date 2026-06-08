<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import SceneRenderer from '$lib/components/SceneRenderer.svelte';
	import { placeholderBuild } from '$lib/game/placeholderBuild';
	import { startGame, takeExit, activateHotspot } from '$lib/engine/state';
	import { availableExits, availableHotspots, findScene } from '$lib/engine/graph';
	import { applyEffects } from '$lib/engine/effects';
	import { loadActiveBuild } from '$lib/content/loader';
	import type {
		Build,
		ConversationTurn,
		Effect,
		Exit,
		GameState,
		Hotspot
	} from '$lib/engine/types';

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

	// --- game state ----------------------------------------------------------
	// NB: don't name game state `state` — the `$state` rune clashes with a
	// variable named `state` (reads as a legacy store subscription) in svelte-check.
	// We start synchronously on the in-repo placeholder build, then swap in the
	// published Firestore build (if any) on mount.
	let build = $state<Build>(placeholderBuild);
	let buildSource = $state<'firestore' | 'placeholder'>('placeholder');
	const init = startGame(placeholderBuild);
	let game = $state(init.state);
	const startScene = findScene(placeholderBuild.scenes, init.state.currentSceneId);
	let log = $state<string[]>(
		[...init.messages, startScene?.introText].filter((l): l is string => Boolean(l)).slice(-6)
	);

	function startFrom(b: Build) {
		const started = startGame(b);
		game = started.state;
		const intro = findScene(b.scenes, started.state.currentSceneId)?.introText;
		log = [...started.messages, intro].filter((l): l is string => Boolean(l)).slice(-6);
	}

	const scene = $derived(findScene(build.scenes, game.currentSceneId)!);

	type Action = { kind: 'hotspot' | 'exit'; id: string; label: string; run: () => void };
	const actions: Action[] = $derived([
		...availableHotspots(scene, game).map(
			(h): Action => ({ kind: 'hotspot', id: h.id, label: h.label, run: () => runHotspot(h) })
		),
		...availableExits(scene, game).map(
			(x): Action => ({ kind: 'exit', id: x.id, label: `→ ${x.label}`, run: () => runExit(x) })
		)
	]);

	function pushLog(lines: string[]) {
		if (lines.length) log = [...log, ...lines].slice(-6);
	}

	function applyMove(prevSceneId: string, res: { state: GameState; messages: string[] }) {
		game = res.state;
		const lines = [...res.messages];
		if (game.currentSceneId !== prevSceneId) {
			const intro = findScene(build.scenes, game.currentSceneId)?.introText;
			if (intro) lines.push(intro);
		}
		pushLog(lines);
	}

	function runExit(exit: Exit) {
		applyMove(game.currentSceneId, takeExit(game, build, exit));
	}

	function runHotspot(hotspot: Hotspot) {
		const prev = game.currentSceneId;
		const res = activateHotspot(game, build, hotspot);
		applyMove(prev, res);
		if (res.openBehaviourId) openDialogue(res.openBehaviourId);
	}

	// --- dialogue (the LLM exchange, SPEC §5) --------------------------------
	let dialogue = $state<{
		open: boolean;
		behaviourId: string;
		title: string;
		turns: ConversationTurn[];
		input: string;
		pending: boolean;
		over: boolean;
	}>({
		open: false,
		behaviourId: '',
		title: '',
		turns: [],
		input: '',
		pending: false,
		over: false
	});

	function openDialogue(behaviourId: string) {
		const behaviour = build.behaviours.find((b) => b.id === behaviourId);
		dialogue = {
			open: true,
			behaviourId,
			title: behaviour?.name ?? behaviourId,
			turns: [],
			input: '',
			pending: false,
			over: false
		};
	}

	function closeDialogue() {
		dialogue = { ...dialogue, open: false };
	}

	async function sendMessage() {
		const text = dialogue.input.trim();
		if (!text || dialogue.pending || dialogue.over) return;
		const priorHistory = dialogue.turns;
		const playerTurn: ConversationTurn = {
			role: 'player',
			text,
			behaviourId: dialogue.behaviourId
		};
		dialogue = { ...dialogue, turns: [...dialogue.turns, playerTurn], input: '', pending: true };

		try {
			const resp = await fetch('/api/converse', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					behaviourId: dialogue.behaviourId,
					playerMessage: text,
					history: priorHistory,
					sceneContext: {
						name: scene.name,
						prompt: scene.prompt,
						exits: availableExits(scene, game).map((x) => ({
							label: x.label,
							toSceneId: x.toSceneId
						})),
						inventory: game.inventory
					}
				})
			});
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
			const data: {
				reply: string;
				granted: boolean;
				appliedEffects: Effect[];
				conversationOver: boolean;
			} = await resp.json();
			const computerTurn: ConversationTurn = {
				role: 'computer',
				text: data.reply,
				behaviourId: dialogue.behaviourId
			};
			game = applyEffects(game, data.appliedEffects);
			dialogue = {
				...dialogue,
				turns: [...dialogue.turns, computerTurn],
				pending: false,
				over: data.conversationOver
			};
			if (data.appliedEffects.length) {
				pushLog([`> applied: ${data.appliedEffects.map(describeEffect).join(', ')}`]);
			}
		} catch {
			const errorTurn: ConversationTurn = {
				role: 'computer',
				text: '[ placeholder: could not reach the server — try again ]',
				behaviourId: dialogue.behaviourId
			};
			dialogue = { ...dialogue, turns: [...dialogue.turns, errorTurn], pending: false };
		}
	}

	// --- parallax look -------------------------------------------------------
	let look = $state({ x: 0, y: 0 });
	const target = { x: 0, y: 0 };

	function onKeydown(e: KeyboardEvent) {
		// While typing in the dialogue, let keys reach the input; Esc closes.
		if (dialogue.open) {
			if (e.key === 'Escape') closeDialogue();
			return;
		}
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
			default:
				if (/^[1-9]$/.test(e.key)) actions[Number(e.key) - 1]?.run();
		}
	}

	function onKeyup(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') target.x = 0;
		if (e.key === 'ArrowUp' || e.key === 'ArrowDown') target.y = 0;
	}

	onMount(() => {
		// Swap in the published Firestore build if one exists; otherwise stay on
		// the placeholder we already initialized with.
		loadActiveBuild().then(({ build: loaded, source }) => {
			buildSource = source;
			if (source === 'firestore') {
				build = loaded;
				startFrom(loaded);
			}
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

<svelte:head><title>Adventure Engine — Play (placeholder)</title></svelte:head>
<svelte:window onkeydown={onKeydown} onkeyup={onKeyup} />

<main>
	{#if buildSource === 'placeholder'}
		<p class="placeholder-banner">
			⚠ PLACEHOLDER BUILD — no published content yet; scenes, art, text &amp; story are stand-ins,
			authored by the client later.
		</p>
	{:else}
		<p class="placeholder-banner live">▶ Live build loaded from Firestore.</p>
	{/if}
	<div class="stage">
		{#key game.currentSceneId}
			{@const snap = findScene(build.scenes, game.currentSceneId)!}
			<div class="scene-holder" in:fade={{ duration: 450 }} out:fade={{ duration: 300 }}>
				<SceneRenderer scene={snap} {look} />
			</div>
		{/key}

		<div class="hud">
			<div class="log">
				{#each log as line, i (i)}<p>{line}</p>{/each}
			</div>
			<nav class="actions" aria-label="Available actions">
				{#each actions as action, i (action.kind + action.id)}
					<button type="button" class={action.kind} onclick={action.run}>
						<span class="num">{i + 1}</span>{action.label}
					</button>
				{/each}
			</nav>
			<p class="hint">arrow keys look around · number keys or Enter to act</p>
		</div>

		{#if dialogue.open}
			<div class="dialogue" role="dialog" aria-label={dialogue.title}>
				<div class="dialogue-head">
					<span>{dialogue.title}</span>
					<button type="button" class="close" onclick={closeDialogue}>esc ✕</button>
				</div>
				<div class="transcript">
					{#each dialogue.turns as turn, i (i)}
						<p class={turn.role}>
							<span class="who">{turn.role === 'player' ? 'YOU' : 'COMPUTER'}</span>
							{turn.text}
						</p>
					{:else}
						<p class="empty">[ type an argument to the placeholder computer ]</p>
					{/each}
					{#if dialogue.pending}<p class="pending">computer is thinking…</p>{/if}
					{#if dialogue.over}<p class="over">— conversation ended —</p>{/if}
				</div>
				<form
					class="composer"
					onsubmit={(e) => {
						e.preventDefault();
						sendMessage();
					}}
				>
					<input
						use:autofocus
						placeholder="[ type your argument ]"
						bind:value={dialogue.input}
						disabled={dialogue.pending || dialogue.over}
					/>
					<button
						type="submit"
						disabled={dialogue.pending || dialogue.over || !dialogue.input.trim()}
					>
						Send
					</button>
				</form>
			</div>
		{/if}
	</div>
</main>

<style>
	main {
		display: grid;
		place-items: center;
		min-height: 100dvh;
		padding: 1.5rem;
	}

	.placeholder-banner {
		width: min(100%, 1280px);
		margin: 0 0 0.75rem;
		padding: 0.5rem 0.9rem;
		font-size: 0.8rem;
		letter-spacing: 0.04em;
		color: #d8c98a;
		background: #2a2410;
		border: 1px dashed #6b5e2a;
	}
	.placeholder-banner.live {
		color: #9fc0a8;
		background: #122016;
		border-color: #2a5e3a;
	}

	.stage {
		position: relative;
		width: min(100%, 1280px);
		aspect-ratio: 16 / 9;
		border: 1px solid var(--line);
		overflow: hidden;
	}

	.scene-holder {
		position: absolute;
		inset: 0;
	}

	.hud {
		position: absolute;
		inset: auto 0 0 0;
		z-index: 60;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1rem 1.25rem 1.1rem;
		background: linear-gradient(transparent, rgba(15, 17, 19, 0.9) 40%);
	}

	.log {
		min-height: 4.5rem;
		font-size: 0.95rem;
		line-height: 1.45;
	}
	.log p {
		margin: 0;
		color: var(--accent);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	button {
		font: inherit;
		cursor: pointer;
		color: var(--ink);
		background: rgba(22, 25, 29, 0.85);
		border: 1px solid var(--line);
		padding: 0.45rem 0.8rem;
	}
	button:hover,
	button:focus-visible {
		border-color: var(--accent);
		color: var(--accent);
		outline: none;
	}
	button.exit {
		border-style: dashed;
	}

	.num {
		display: inline-block;
		margin-right: 0.5rem;
		color: var(--ink-dim);
	}

	.hint {
		margin: 0;
		font-size: 0.75rem;
		letter-spacing: 0.08em;
		color: var(--ink-dim);
	}

	.dialogue {
		position: absolute;
		z-index: 70;
		left: 50%;
		bottom: 1.25rem;
		transform: translateX(-50%);
		width: min(92%, 640px);
		max-height: 70%;
		display: flex;
		flex-direction: column;
		background: rgba(12, 14, 17, 0.96);
		border: 1px solid var(--line);
	}

	.dialogue-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--line);
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		color: var(--ink-dim);
	}

	.close {
		font: inherit;
		font-size: 0.7rem;
		cursor: pointer;
		color: var(--ink-dim);
		background: transparent;
		border: 1px solid var(--line);
		padding: 0.2rem 0.45rem;
	}

	.transcript {
		overflow-y: auto;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.9rem;
		line-height: 1.45;
	}
	.transcript p {
		margin: 0;
	}
	.transcript .who {
		display: inline-block;
		min-width: 5.5rem;
		color: var(--ink-dim);
	}
	.transcript .player {
		color: var(--ink);
	}
	.transcript .computer {
		color: var(--accent);
	}
	.transcript .empty,
	.transcript .pending,
	.transcript .over {
		color: var(--ink-dim);
		font-style: italic;
	}

	.composer {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem;
		border-top: 1px solid var(--line);
	}
	.composer input {
		flex: 1;
		font: inherit;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.45rem 0.6rem;
	}
	.composer input:focus-visible {
		outline: none;
		border-color: var(--accent);
	}
</style>
