<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import SceneRenderer from '$lib/components/SceneRenderer.svelte';
	import { placeholderBuild } from '$lib/game/placeholderBuild';
	import { startGame } from '$lib/engine/state';
	import { availableExits, findScene, rollGiveableItems } from '$lib/engine/graph';
	import { applyEffects } from '$lib/engine/effects';
	import { loadActiveBuild } from '$lib/content/loader';
	import { doc, onSnapshot } from 'firebase/firestore';
	import { db } from '$lib/firebase/client';
	import { DEFAULT_DISPLAY, themeStyle, duotoneTable, crtBackground } from '$lib/theme';
	import type { Build, ConversationTurn, Effect, GameState, Item, Scene } from '$lib/engine/types';

	// The game runtime, parameterized by where the build comes from: /play uses the
	// active published build; /testplay assembles the current (unpublished) draft.
	type BuildSource = 'firestore' | 'placeholder' | 'draft';
	let {
		loadBuild = loadActiveBuild,
		// Watch config/current and fully reload when a new version is published, so
		// the kiosk picks up updates by itself. /testplay opts out (it runs the draft).
		reloadOnPublish = true
	}: {
		loadBuild?: () => Promise<{ build: Build; source: BuildSource }>;
		reloadOnPublish?: boolean;
	} = $props();

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
	let buildSource = $state<BuildSource>('placeholder');
	// The page seeds itself with the placeholder build so SSR/first paint has
	// something to render, then swaps in the live build in onMount. `loading`
	// holds a boot overlay over the frame during that swap, so the placeholder
	// content never flashes before the real build arrives.
	let loading = $state(true);
	let game = $state<GameState>(startGame(placeholderBuild).state);

	type Line = {
		id: number;
		who: 'narration' | 'player' | 'computer' | 'system';
		text: string;
		revealed: number;
	};
	let lineSeq = 0;
	let lines = $state<Line[]>([]);
	let inputText = $state('');
	let pending = $state(false);
	let spinner = $state('|');
	// Global display settings from the active build (resolution, placement, palette,
	// opacity, full/duotone mode); fall back to the off-black + amber default.
	const display = $derived(build.meta.display ?? DEFAULT_DISPLAY);
	const duotone = $derived(duotoneTable(display.bg, display.ui));
	// 'gradient' → smooth luminance map; 'duotone' → hard two-colour (discrete).
	const duoFunc = $derived(display.mode === 'duotone' ? 'discrete' : 'table');
	const crtBg = $derived(crtBackground(display.crt));
	let scale = $state(1);
	function computeScale() {
		const availW = window.innerWidth - (display.center ? 0 : display.marginLeft);
		const availH = window.innerHeight - (display.center ? 0 : display.marginTop);
		scale = Math.min(1, availW / display.width, availH / display.height);
	}
	// The frame's inline style: theme colours + resolution + placement (centered, or
	// at the top-left offset by the margins). Scaled to fit, never up past 1:1.
	const frameStyle = $derived.by(() => {
		const place = display.center
			? `left:50%;top:50%;transform:translate(-50%,-50%) scale(${scale});transform-origin:center`
			: `left:${display.marginLeft}px;top:${display.marginTop}px;transform:scale(${scale});transform-origin:top left`;
		// A soft bg-coloured halo feathers the frame edge into the page so a kiosk
		// bezel never shows a hard seam (the page background matches it).
		const halo = `box-shadow:0 0 30px 18px ${display.bg}`;
		return `${themeStyle(display)};width:${display.width}px;height:${display.height}px;${place};${halo}`;
	});
	// Refit when the resolution/placement changes (e.g. once the live build loads).
	$effect(() => {
		void [display.width, display.height, display.center, display.marginLeft, display.marginTop];
		computeScale();
	});

	// --- title/status bar -----------------------------------------------------
	// `clockNow` ticks once a second (set in onMount) and drives the fake clock
	// and the draining vitals readout.
	let clockNow = $state(Date.now());
	let vitalsStartedAt = $state(Date.now());
	const VITALS_START = 80; // %
	const VITALS_DRAIN_MS = 300_000; // depletes to 0% over 5 minutes, then "ERROR"

	// A fictional off-world clock: a cycle of 20 arcs × 90 marks × 90 beats,
	// ticking one beat per real second (numbers run past 60, so it never reads as
	// Earth time). This is interface chrome, not story content.
	const alienTime = $derived.by(() => {
		const beats = Math.floor(clockNow / 1000);
		const p = (n: number) => String(n).padStart(2, '0');
		return `CYC ${Math.floor(beats / 162000)} · ${p(Math.floor(beats / 8100) % 20)}:${p(Math.floor(beats / 90) % 90)}:${p(beats % 90)}`;
	});
	// Drains linearly from 80% to 0 over 5 minutes; ≤0 renders as "ERROR".
	const vitalsPct = $derived(
		Math.max(0, VITALS_START * (1 - (clockNow - vitalsStartedAt) / VITALS_DRAIN_MS))
	);

	let atEnding = $state(false);
	let endingTimer: ReturnType<typeof setTimeout> | undefined;
	const ENDING_RESTART_MS = 180_000; // 3 minutes at an ending → auto restart

	// The computer the terminal is talking to (the current scene's), plus that
	// conversation's history for the LLM.
	let activeBehaviourId = $state<string | undefined>(undefined);
	let convo = $state<ConversationTurn[]>([]);
	// Rolling window of the recent transcript sent to the computer so it remembers
	// the interaction across turns AND scenes (≈20 player↔computer exchanges).
	const MAX_HISTORY_TURNS = 40;

	const scene = $derived(findScene(build.scenes, game.currentSceneId)!);

	// A scene with no usable layer art shows a "no signal" static screen (the
	// client hasn't supplied art for it yet).
	const sceneHasArt = (s: Scene) => s.layers.some((l) => l.imagePath?.trim());

	// Items the computer may give in the current scene THIS run (rolled on entry).
	let presentGiveables = $state<string[]>([]);

	// Left-hand inventory HUD: the player's items (first 9, mapped to keys 1–9).
	const itemName = (id: string) => build.items.find((i) => i.id === id)?.name ?? id;
	const imgUrl = (p: string) =>
		!p ? '' : /^(https?:)?\/\//.test(p) || p.startsWith('/') ? p : `/${p}`;
	const inventoryItems = $derived(
		game.inventory
			.map((id) => build.items.find((i) => i.id === id))
			.filter((i): i is Item => !!i)
			.slice(0, 9)
	);

	function push(who: Line['who'], text?: string | null) {
		if (!text) return;
		// Player echoes and system notes appear instantly; the computer & narration
		// "type out" character by character.
		const instant = who === 'player' || who === 'system';
		const line: Line = { id: lineSeq++, who, text, revealed: instant ? text.length : 0 };
		lines = [...lines, line].slice(-200);
		if (!instant) typeOut(line.id);
	}

	function typeOut(id: number) {
		if (typeof window === 'undefined') return; // browser only (no SSR timer leak)
		const target = lines.find((l) => l.id === id);
		if (!target) return;
		const step = Math.max(1, Math.ceil(target.text.length / 100));
		const tick = setInterval(() => {
			const l = lines.find((x) => x.id === id);
			if (!l) {
				clearInterval(tick);
				return;
			}
			l.revealed = Math.min(l.text.length, l.revealed + step);
			if (transcriptEl) transcriptEl.scrollTop = transcriptEl.scrollHeight;
			if (l.revealed >= l.text.length) clearInterval(tick);
		}, 16);
	}
	// One ship-wide computer for the whole game; per-scene flavour comes from the
	// scene's `prompt`. (Behaviour-on-hotspot was dropped.)
	function shipComputer(b: Build): string | undefined {
		return b.meta.defaultBehaviourId ?? b.behaviours[0]?.id;
	}
	function sceneContextFor(s: Scene, state: GameState) {
		const owned = new Set(state.inventory);
		return {
			name: s.name,
			prompt: s.prompt,
			exits: availableExits(s, state).map((x) => ({ label: x.label, toSceneId: x.toSceneId })),
			inventory: state.inventory,
			// Only offer items present this run that the player doesn't already hold.
			giveable: presentGiveables
				.filter((id) => !owned.has(id))
				.map((id) => ({ itemId: id, label: itemName(id) }))
		};
	}

	// Set up a scene's transcript + active computer (does NOT call the network,
	// so it is safe during SSR/init; callers trigger the opening greeting).
	function enterScene(b: Build, state: GameState, narration: string[]) {
		const s = findScene(b.scenes, state.currentSceneId);
		presentGiveables = s ? rollGiveableItems(s) : [];
		for (const t of narration) push('narration', t);
		push('narration', s?.introText);
		activeBehaviourId = shipComputer(b);
	}

	function initFrom(b: Build) {
		const started = startGame(b);
		game = started.state;
		lines = [];
		convo = []; // a fresh run starts the computer's memory clean
		vitalsStartedAt = Date.now(); // a fresh run starts at full(ish) vitals
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
					history: convo.slice(-MAX_HISTORY_TURNS),
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

	function clearEndingTimer() {
		if (endingTimer) clearTimeout(endingTimer);
		endingTimer = undefined;
	}

	// After entering a scene: an ending freezes into "THE END" and arms the auto-
	// restart timer; otherwise the computer greets.
	async function afterEnter() {
		clearEndingTimer();
		const s = findScene(build.scenes, game.currentSceneId);
		if (s?.ending) {
			atEnding = true;
			push('system', '[ THE END — type anything (or wait) to begin again ]');
			endingTimer = setTimeout(() => restart(), ENDING_RESTART_MS);
		} else {
			atEnding = false;
			await requestOpening();
		}
	}

	async function restart() {
		clearEndingTimer();
		atEnding = false;
		initFrom(build); // picks a fresh random start, resets transcript + state
		await afterEnter();
	}

	async function sendMessage() {
		const text = inputText.trim();
		if (!text || pending) return;
		// At an ending, any input begins a new run.
		if (atEnding) {
			inputText = '';
			await restart();
			return;
		}
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
					history: prior.slice(-MAX_HISTORY_TURNS),
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
					await afterEnter();
				}
			}
		} catch {
			push('system', '-- connection lost · please repeat your last transmission --');
		} finally {
			pending = false;
		}
	}

	// Inventory HUD: "use" an item by sending a plain message the computer reads.
	function useItem(item: Item) {
		if (pending) return;
		inputText = `use the ${item.name}`;
		sendMessage();
	}
	// Number keys 1–9 use the matching slot — but only when the player hasn't
	// started typing, so normal messages (which may contain digits) aren't hijacked.
	function onComposerKey(e: KeyboardEvent) {
		if (pending || inputText.length > 0) return;
		if (e.key >= '1' && e.key <= '9') {
			const item = inventoryItems[Number(e.key) - 1];
			if (item) {
				e.preventDefault();
				useItem(item);
			}
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

	// Spinning processing cursor while the computer is thinking.
	$effect(() => {
		if (!pending) return;
		const frames = ['|', '/', '-', '\\'];
		let i = 0;
		const id = setInterval(() => (spinner = frames[i++ % frames.length]), 110);
		return () => clearInterval(id);
	});

	onMount(() => {
		computeScale();
		const clockId = setInterval(() => (clockNow = Date.now()), 1000);
		let unsubLive: (() => void) | undefined;
		loadBuild()
			.then(({ build: loaded, source }) => {
				buildSource = source;
				build = loaded;
				initFrom(loaded);
				loading = false; // reveal the resolved build
				afterEnter();

				// Live-update: when the editor publishes a different version, reload the
				// whole page so the kiosk picks up new content (and any new app code).
				// The sessionStorage guard reloads at most once per target build, so a
				// build that keeps failing to load can never cause a reload loop.
				if (reloadOnPublish) {
					const runningId = source === 'firestore' ? `build-${loaded.meta.version}` : null;
					unsubLive = onSnapshot(doc(db(), 'config', 'current'), (snap) => {
						const liveId = snap.data()?.activeBuildId as string | undefined;
						if (!liveId || liveId === runningId) return;
						const KEY = 'sgx-reloaded-for';
						if (sessionStorage.getItem(KEY) === liveId) return;
						sessionStorage.setItem(KEY, liveId);
						location.reload();
					});
				}
			})
			.catch(() => (loading = false));

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
		return () => {
			cancelAnimationFrame(raf);
			clearInterval(clockId);
			clearEndingTimer();
			unsubLive?.();
		};
	});
</script>

<svelte:head><title>Adventure Engine — Play</title></svelte:head>
<svelte:window onkeydown={onKeydown} onkeyup={onKeyup} onresize={computeScale} />

<main class="letterbox" style:background={display.bg}>
	<!-- Duotone luminance map (dark → bg, light → ui) for the "old monitor" mode. -->
	<svg width="0" height="0" aria-hidden="true" style="position:absolute">
		<filter id="sgx-duotone" color-interpolation-filters="sRGB">
			<feColorMatrix
				color-interpolation-filters="sRGB"
				type="matrix"
				values="0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0 0 0 1 0"
			/>
			<feComponentTransfer color-interpolation-filters="sRGB">
				<feFuncR type={duoFunc} tableValues={duotone.r} />
				<feFuncG type={duoFunc} tableValues={duotone.g} />
				<feFuncB type={duoFunc} tableValues={duotone.b} />
			</feComponentTransfer>
		</filter>
	</svg>
	<div class="frame" style={frameStyle}>
		<div class="content" class:duo={display.mode !== 'full'}>
			<header class="statusbar">
				<div class="grp">
					<span class="sys">ARG-OS</span>
					<span class="sep">·</span>
					{#if buildSource === 'firestore'}
						<span class="bld" title="content build (builds/build-{build.meta.version})"
							>BLD {build.meta.version}</span
						>
					{:else}
						<span class="bld" class:draft={buildSource === 'draft'}
							>{buildSource === 'draft' ? 'DRAFT' : 'PLACEHOLDER'}</span
						>
					{/if}
					<span class="sep">·</span>
					<span class="clock">{alienTime}</span>
				</div>
				<div class="grp center">
					<span class="lbl">LOC</span>
					<span class="room">{scene.name}</span>
				</div>
				<div class="grp right">
					<span class="status">⚠ CRITICAL</span>
					<span class="vitals" class:low={vitalsPct <= 25}>
						VITALS {vitalsPct <= 0 ? 'ERROR' : `${Math.round(vitalsPct)}%`}
					</span>
					<span
						class="led {buildSource}"
						title={buildSource === 'firestore'
							? 'Live build (Firestore)'
							: buildSource === 'draft'
								? 'Draft — unpublished'
								: 'Placeholder build'}
					></span>
				</div>
			</header>

			<div class="stage">
				{#key game.currentSceneId}
					{@const snap = findScene(build.scenes, game.currentSceneId)!}
					<div class="scene-holder" in:fade={{ duration: 450 }} out:fade={{ duration: 300 }}>
						{#if sceneHasArt(snap)}
							<SceneRenderer scene={snap} {look} />
						{:else}
							<div class="nosignal" aria-label="no signal">
								<div class="static"></div>
								<span class="nosignal-text">NO SIGNAL</span>
							</div>
						{/if}
					</div>
				{/key}
			</div>

			<aside class="inventory" aria-label="inventory">
				{#each Array.from({ length: 9 }) as _slot, idx (idx)}
					{@const item = inventoryItems[idx]}
					<button
						type="button"
						class="slot"
						class:filled={!!item}
						tabindex="-1"
						disabled={!item || pending}
						onclick={() => item && useItem(item)}
						title={item ? `Use ${item.name} (press ${idx + 1})` : `slot ${idx + 1}`}
					>
						<span class="key">{idx + 1}</span>
						{#if item}
							{#if imgUrl(item.iconPath)}
								<img src={imgUrl(item.iconPath)} alt={item.name} />
							{:else}
								<span class="nm">{item.name}</span>
							{/if}
						{/if}
					</button>
				{/each}
			</aside>

			<section class="terminal">
				<div class="transcript" bind:this={transcriptEl}>
					{#each lines as line (line.id)}
						<p class={line.who}>
							{#if line.who === 'player'}<span class="who">&gt;</span>{/if}{line.text.slice(
								0,
								line.revealed
							)}
						</p>
					{/each}
					{#if pending}<p class="spinner">{spinner}</p>{/if}
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
						placeholder={atEnding ? 'type anything to play again…' : 'type to the computer…'}
						bind:value={inputText}
						onkeydown={onComposerKey}
						disabled={pending}
					/>
				</form>
			</section>

			{#if loading}
				<div class="boot" out:fade={{ duration: 250 }}>
					<span class="boot-name">ARG-OS</span>
					<span class="boot-sub">establishing link…<span class="bcur">█</span></span>
				</div>
			{/if}
		</div>
		<div class="crt" aria-hidden="true" style:background={crtBg}></div>
	</div>
</main>

<style>
	.letterbox {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: #000;
	}
	/* The game renders at the build's resolution; size + placement + theme colours
	   come from the inline `frameStyle` (scaled to fit, never up past 1:1). */
	.frame {
		position: absolute;
		overflow: hidden;
		background: var(--bg);
	}
	.content {
		position: absolute;
		inset: 0;
	}
	/* Duotone modes: the UI inside .content is authored in MONOCHROME (themeVars
	   emits white-on-black) and this one filter colourizes everything — scene art
	   and UI — onto the bg→ui ramp. One surface, one colour path: nothing inside
	   the frame can be off-palette or mismatch the scene. The .crt overlay stays a
	   SIBLING (outside the filter), applied after quantization. */
	.content.duo {
		background: var(--bg);
		filter: url(#sgx-duotone);
	}
	/* Semantic non-palette colours (CRITICAL red, the LED) would otherwise
	   luminance-snap unpredictably — pull them onto the monochrome ink first. */
	.content.duo .statusbar .status,
	.content.duo .statusbar .vitals.low {
		color: var(--ink);
		text-shadow: none;
		animation: none;
	}
	.content.duo .led {
		background: var(--ink);
		box-shadow: none;
	}
	.content.duo .bld {
		color: var(--ink-dim);
	}

	/* Boot overlay shown while the active build loads — hides the placeholder
	   seed until the real build is in. */
	.boot {
		position: absolute;
		inset: 0;
		z-index: 90;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: var(--bg);
	}
	.boot-name {
		font-family: var(--font-ui);
		font-weight: 700;
		letter-spacing: 0.4em;
		font-size: 1.6rem;
		color: var(--accent);
		text-shadow: var(--glow);
	}
	.boot-sub {
		font-family: var(--font-terminal);
		font-size: 0.9rem;
		color: var(--ink-dim);
	}
	.bcur {
		animation: blink 1.1s steps(1) infinite;
	}

	/* CRT scanlines + vignette + a faint phosphor flicker over the game frame.
	   The scanline/vignette background is set inline (scaled by the CRT slider). */
	.crt {
		position: absolute;
		inset: 0;
		z-index: 100;
		pointer-events: none;
		animation: crt-flicker 4s infinite;
	}
	@keyframes crt-flicker {
		0%,
		97%,
		100% {
			opacity: 1;
		}
		98% {
			opacity: 0.82;
		}
		99% {
			opacity: 0.94;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.crt {
			animation: none;
		}
	}

	/* The scene fills the whole frame; the terminal floats over it. */
	.stage {
		position: absolute;
		inset: 0;
		overflow: hidden;
		box-shadow: 0 0 60px rgba(255, 176, 0, 0.05) inset;
	}
	.scene-holder {
		position: absolute;
		inset: 0;
	}

	/* "No signal" fallback for scenes with no art yet: palette-tinted TV snow. */
	.nosignal {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: var(--bg);
		overflow: hidden;
	}
	.static {
		position: absolute;
		inset: -20%;
		background-image: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100' height='100' filter='url(%23n)'/></svg>");
		background-size: 110px 110px;
		opacity: 0.42;
		animation: snow 1.5s steps(6) infinite;
	}
	/* Under the duotone filter, faint noise sits below the luminance threshold and
	   vanishes — push it past the threshold so it resolves into two-colour static. */
	.content.duo .static {
		opacity: 0.7;
	}
	@keyframes snow {
		0% {
			background-position: 0 0;
		}
		20% {
			background-position: -45px 30px;
		}
		40% {
			background-position: 50px -25px;
		}
		60% {
			background-position: -30px -50px;
		}
		80% {
			background-position: 40px 20px;
		}
		100% {
			background-position: -20px 40px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.static {
			animation: none;
		}
	}
	.nosignal-text {
		position: relative;
		z-index: 2;
		font-family: var(--font-ui);
		letter-spacing: 0.3em;
		font-size: 1.4rem;
		color: var(--ink-dim);
		padding: 0.5rem 1.1rem;
		border: 1px solid var(--line);
		background: var(--overlay-bg);
	}

	/* Title/status bar overlay docked at the top, floating over the scene. */
	.statusbar {
		position: absolute;
		left: 1.2rem;
		right: 1.2rem;
		top: 1.2rem;
		z-index: 80;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.45rem 0.9rem;
		background: var(--overlay-bg);
		border: 1px solid var(--line);
		font-family: var(--font-ui);
		font-size: 0.78rem;
		letter-spacing: 0.04em;
		color: var(--ink);
		text-shadow: var(--glow);
		box-shadow: 0 0 22px rgba(255, 176, 0, 0.06);
		backdrop-filter: blur(2px);
	}
	.statusbar .grp {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		white-space: nowrap;
	}
	.statusbar .grp.right {
		gap: 0.8rem;
	}
	.statusbar .sys {
		font-weight: 700;
		color: var(--accent);
	}
	.statusbar .sep {
		color: var(--ink-dim);
	}
	.statusbar .lbl {
		color: var(--ink-dim);
		font-size: 0.7rem;
	}
	.statusbar .bld {
		color: var(--ink-dim);
		font-size: 0.7rem;
		letter-spacing: 0.05em;
	}
	.statusbar .bld.draft {
		color: #46b4ff;
	}
	.statusbar .room {
		text-transform: uppercase;
	}
	.statusbar .status {
		color: #ff5a3c;
		font-weight: 700;
		text-shadow: 0 0 8px rgba(255, 90, 60, 0.5);
		animation: alarm 1.1s ease-in-out infinite;
	}
	.statusbar .vitals.low {
		color: #ff5a3c;
		text-shadow: 0 0 8px rgba(255, 90, 60, 0.5);
	}
	@keyframes alarm {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.statusbar .status {
			animation: none;
		}
	}

	.led {
		display: inline-block;
		width: 0.6rem;
		height: 0.6rem;
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
	.led.draft {
		background: #46b4ff;
		box-shadow: 0 0 8px #46b4ff;
	}

	/* Left-hand inventory HUD: 3×3 slots mapped to number keys 1–9. */
	.inventory {
		position: absolute;
		left: 1.2rem;
		top: 4.4rem;
		z-index: 80;
		display: grid;
		grid-template-columns: repeat(3, 3.1rem);
		grid-auto-rows: 3.1rem;
		gap: 0.35rem;
		padding: 0.45rem;
		background: var(--overlay-bg);
		border: 1px solid var(--line);
		box-shadow: 0 0 18px rgba(255, 176, 0, 0.05);
		backdrop-filter: blur(2px);
	}
	.slot {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.15rem;
		font: inherit;
		color: var(--ink-dim);
		background: var(--overlay-bg);
		border: 1px solid var(--line);
		overflow: hidden;
	}
	.slot.filled {
		color: var(--ink);
		border-color: var(--ink-dim);
		box-shadow: 0 0 8px rgba(255, 176, 0, 0.12) inset;
		cursor: pointer;
	}
	.slot.filled:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}
	.slot:disabled {
		cursor: default;
	}
	.slot .key {
		position: absolute;
		top: 1px;
		left: 3px;
		font-size: 0.58rem;
		color: var(--ink-dim);
	}
	.slot img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}
	.slot .nm {
		font-family: var(--font-terminal);
		font-size: 0.5rem;
		line-height: 1.05;
		text-align: center;
		padding: 0.35rem 0.1rem 0.1rem;
		word-break: break-word;
	}

	/* Translucent overlay docked at the bottom, floating over the scene. */
	.terminal {
		position: absolute;
		left: 1.2rem;
		right: 1.2rem;
		bottom: 1.2rem;
		z-index: 80;
		max-height: 44%;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.8rem 1rem;
		background: var(--overlay-bg);
		border: 1px solid var(--line);
		font-family: var(--font-terminal);
		text-shadow: var(--glow);
		box-shadow: 0 0 22px rgba(255, 176, 0, 0.06);
		backdrop-filter: blur(2px);
	}
	.transcript {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.95rem;
		line-height: 1.45;
		/* Firefox / standards scrollbar. */
		scrollbar-width: thin;
		scrollbar-color: var(--ink-dim) rgba(74, 56, 20, 0.18);
	}
	/* Blocky amber scrollbar to match the CRT chrome (Chromium kiosk target). */
	.transcript::-webkit-scrollbar {
		width: 0.55rem;
	}
	.transcript::-webkit-scrollbar-track {
		background: rgba(74, 56, 20, 0.18);
		border-left: 1px solid var(--line);
	}
	.transcript::-webkit-scrollbar-thumb {
		background: var(--ink-dim);
		border: 1px solid #1a1206;
		box-shadow: 0 0 6px rgba(255, 176, 0, 0.4) inset;
	}
	.transcript::-webkit-scrollbar-thumb:hover {
		background: var(--ink);
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
	.transcript .spinner {
		color: var(--accent);
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
		animation: blink 1.1s steps(1) infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.25;
		}
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
	.composer input::placeholder {
		color: var(--ink-dim);
		opacity: 1;
	}
</style>
