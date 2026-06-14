<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import SceneRenderer from '$lib/components/SceneRenderer.svelte';
	import { placeholderBuild } from '$lib/game/placeholderBuild';
	import { startGame } from '$lib/engine/state';
	import {
		availableDoors,
		findScene,
		layerImagePool,
		rollGiveableItems,
		rollLayerImages
	} from '$lib/engine/graph';
	import { applyEffects } from '$lib/engine/effects';
	import { loadActiveBuild } from '$lib/content/loader';
	import { doc, onSnapshot } from 'firebase/firestore';
	import { db } from '$lib/firebase/client';
	import { MAP_OUTCOME_ID } from '$lib/llm/adjudicate';
	import { audioUnlocked, playSfx } from '$lib/sfx';
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
	// holds a boot overlay over the frame during that swap. If the real build
	// can't be loaded (network error / nothing published), `failed` shows a
	// discrete black "please restart" page — placeholder content never runs.
	let loading = $state(true);
	let failed = $state(false);
	// This experience targets Chrome/Chromium (the kiosk runs Chromium). On any
	// other engine (Firefox, Safari) show a one-time notice over the boot, which
	// any key/click dismisses. Chromium browsers expose `userAgentData`; others
	// don't, and the UA regex is a belt-and-braces fallback.
	let browserWarn = $state(false);
	function isChromium(): boolean {
		if (typeof navigator === 'undefined') return true;
		return 'userAgentData' in navigator || /\bChrom(e|ium)\//.test(navigator.userAgent);
	}
	let game = $state<GameState>(startGame(placeholderBuild).state);
	// Per-run layer-art choices ("sceneId/layerId" → image) — rolled in initFrom.
	let artPicks = $state<Record<string, string>>({});

	// Boot splash: a full-screen overlay (hardcoded BLACK while loading — it also
	// kills any colour flash before the build's settings arrive). The gif runs
	// once per experience start, AFTER the intake interview, bridging into the
	// game. Sequence: the gif plays once (static/boot.gif, authored play-once so
	// it freezes on its last frame) → holds that frame → a beat on the bare
	// window → fades into the live screen.
	// Three gifs punctuate the kiosk cycle:
	//   BOOT (page load / new cycle) → interview → INTRO → game → OUTRO (ending).
	// boot/intro play once (each authored play-once, freezing on its last frame),
	// hold that frame, take a beat on the bare window, then reveal what's next.
	// The OUTRO plays once and STAYS frozen on its last frame — that's the
	// "press any key" still; any key then starts the next cycle at BOOT.
	type SplashKind = 'boot' | 'intro' | 'outro';
	// Each slot accepts a VIDEO or a GIF in static/: the player tries
	// /<kind>.mp4 → /<kind>.webm → /<kind>.gif and shows the first that loads.
	// Prefer video (H.264 MP4): far smaller files and a real 'ended' event, so
	// no play time needs configuring. Author them play-once with no audio.
	const SPLASH_EXTS = ['mp4', 'webm', 'gif'] as const;
	// GIFs can't report when they finish — their play time is configured here
	// (videos ignore this and use the real 'ended' event).
	const SPLASH_GIF_PLAY_MS: Record<SplashKind, number> = { boot: 4500, intro: 4500, outro: 4500 };
	const SPLASH_HOLD_MS = 1000; // last frame stays up
	const SPLASH_BLACK_MS = 1000; // bare window between the media and what follows
	let splashKind = $state<SplashKind>('boot');
	let splashPhase = $state<'play' | 'black' | 'done'>('play');
	let splashTry = $state(0); // index into SPLASH_EXTS for the current kind
	let splashMediaOk = $state(true);
	let splashTimers: ReturnType<typeof setTimeout>[] = [];
	// Sound guarantee: if the browser won't allow audio yet at load (no kiosk
	// flag, no prior interaction), hold on a black "press any key to start"
	// screen — that key press is the gesture that unlocks sound, then boot rolls.
	let needsKeyToStart = $state(false);
	const splashSrc = $derived(`/${splashKind}.${SPLASH_EXTS[splashTry]}`);
	const splashIsVideo = $derived(!splashSrc.endsWith('.gif'));
	function startSplash(kind: SplashKind) {
		splashTimers.forEach(clearTimeout);
		splashKind = kind;
		splashTry = 0;
		splashMediaOk = true;
		splashPhase = 'play';
	}
	// The media finished (video 'ended' / the gif's configured play time): hold
	// the last frame, take a beat on the bare window, then reveal what's next.
	// The OUTRO never advances — it stays frozen until a key press.
	function splashMediaEnded() {
		if (splashKind === 'outro') return;
		splashTimers.forEach(clearTimeout);
		splashTimers = [
			setTimeout(() => (splashPhase = 'black'), SPLASH_HOLD_MS),
			setTimeout(() => (splashPhase = 'done'), SPLASH_HOLD_MS + SPLASH_BLACK_MS)
		];
	}
	// Skip straight past the current boot/intro splash (ESC — testing aid):
	// jump to 'done' so whatever waits on it (interview / opening greeting) fires.
	function skipSplash() {
		if (splashKind === 'outro' || splashPhase === 'done' || loading) return;
		splashTimers.forEach(clearTimeout);
		splashPhase = 'done';
	}
	// A gif reports nothing — arm its configured play time once it has loaded.
	function armGifEnd() {
		splashTimers.forEach(clearTimeout);
		splashTimers = [setTimeout(splashMediaEnded, SPLASH_GIF_PLAY_MS[splashKind])];
	}
	// Current source failed to load: try the next extension; with nothing left,
	// skip the media (boot/intro pass straight through; the outro holds the bare
	// window as the press-any-key still).
	function nextSplashSource() {
		if (splashTry + 1 < SPLASH_EXTS.length) {
			splashTry += 1;
		} else {
			splashMediaOk = false;
			splashMediaEnded();
		}
	}
	// Play WITH sound when the browser lets us (the kiosk launches Chromium with
	// --autoplay-policy=no-user-gesture-required, so it always does; a normal
	// browser allows it after the first interaction). If unmuted autoplay is
	// blocked, play silently rather than not at all. Load failures are NOT
	// handled here — play() also rejects on them, and advancing the source chain
	// from both places double-stepped it (skipping the gif fallback); the
	// element's onerror is the single owner of nextSplashSource.
	function autoplayWithSound(el: HTMLVideoElement) {
		el.muted = false;
		el.play().catch(() => {
			el.muted = true;
			el.play().catch(() => {
				/* onerror handles broken sources */
			});
		});
	}

	// --- intake questionnaire (the intro page) ---------------------------------
	// After the boot gif, before the game: a bg-coloured page where the computer
	// asks a fixed set of questions, one at a time. Text questions confirm with
	// ENTER, scale questions answer with a 1–9 key, ESC skips the rest. The
	// answers — or the fact the player skipped — become a system ground-truth
	// turn the computer keeps for the whole run.
	type IntroQuestion =
		| { prompt: string; kind: 'text' }
		| { prompt: string; kind: 'scale'; low: string; high: string };
	const INTRO_QUESTIONS: IntroQuestion[] = [
		{ prompt: 'STATE YOUR NAME', kind: 'text' },
		{ prompt: 'DESCRIBE YOUR PREFERRED CLIMATE', kind: 'text' },
		{ prompt: 'SOCIAL PREFERENCE', kind: 'scale', low: 'SOLITUDE', high: 'DENSE POPULATION' },
		{ prompt: 'GRAVITY ADAPTABILITY', kind: 'scale', low: 'LOW', high: 'HIGH' },
		{ prompt: 'ACCEPTABLE LEVEL OF PERSONAL RISK', kind: 'scale', low: 'LOW', high: 'HIGH' },
		{ prompt: 'WHAT DO YOU FEAR MOST?', kind: 'text' }
	];
	let introActive = $state(false);
	let introFading = $state(false); // bg-coloured cover between the form and the game
	const INTRO_FADE_MS = 600;
	let introStep = $state(0);
	let introAnswer = $state('');
	let introAnswers: { q: IntroQuestion; a: string }[] = [];
	let introInputEl = $state<HTMLInputElement>();
	// The intro's own terminal transcript (same Line shape + typing effect as the
	// chatbox — questions type out, answers echo, history scrolls up).
	let introLines = $state<Line[]>([]);
	let introScrollEl = $state<HTMLDivElement>();
	// The questionnaire system turn — pinned so history slicing never drops it.
	let profileTurn: ConversationTurn | null = null;

	function beginIntro() {
		introActive = true;
		introFading = false;
		introStep = 0;
		introAnswer = '';
		introAnswers = [];
		introLines = []; // seeded once the boot splash is gone (effect below)
		introQuestionLineId = -1;
	}

	// The line id of the question currently awaiting an answer — highlighted the
	// same way the chatbox highlights the latest computer reply.
	let introQuestionLineId = $state(-1);

	function pushIntro(who: Line['who'], text: string): number {
		const instant = who === 'player' || who === 'system';
		const line: Line = { id: lineSeq++, who, text, revealed: instant ? text.length : 0 };
		introLines = [...introLines, line];
		if (!instant) typeOut(line.id);
		return line.id;
	}

	function askIntroQuestion() {
		const q = INTRO_QUESTIONS[introStep];
		pushIntro('system', `${introStep + 1} OF ${INTRO_QUESTIONS.length}`);
		introQuestionLineId = pushIntro('computer', q.prompt);
		if (q.kind === 'scale') pushIntro('computer', `${q.low} [ 1 2 3 4 5 6 7 8 9 ] ${q.high}`);
		playSfx('receive'); // each question arrives like a computer reply
	}

	// Start the dialogue only once the boot splash is gone, so the player
	// actually sees the first question type out (not already finished).
	$effect(() => {
		if (introActive && !loading && splashPhase === 'done' && introLines.length === 0) {
			pushIntro('computer', 'PLEASE, ANSWER THE FOLLOWING QUESTIONS:');
			pushIntro('system', '[ ENTER confirms · ESC skips ]');
			askIntroQuestion();
		}
	});

	function introProfileText(skipped: boolean): string {
		if (!introAnswers.length)
			return 'STATE UPDATE: the player SKIPPED the intake questionnaire — no profile answers on file.';
		const parts = introAnswers.map(({ q, a }) =>
			q.kind === 'scale' ? `${q.prompt} (1=${q.low} … 9=${q.high}): ${a}` : `${q.prompt}: "${a}"`
		);
		return (
			`STATE UPDATE: intake questionnaire — the player answered: ${parts.join('; ')}.` +
			(skipped ? ' The player skipped the remaining questions.' : '') +
			' These are their own words — remember them (especially their name).'
		);
	}

	function finishIntro(skipped: boolean) {
		if (introFading) return; // already on the way out
		const turn: ConversationTurn = {
			role: 'system',
			text: introProfileText(skipped),
			behaviourId: activeBehaviourId ?? ''
		};
		profileTurn = turn;
		convo = [...convo, turn];
		// Fade to the background colour over the form, then run the INTRO gif; the
		// game (and its opening greeting) follows once it finishes.
		introFading = true;
		setTimeout(() => {
			startSplash('intro'); // the splash (gif → beat) covers the swap to the game
			introActive = false;
			introFading = false;
			pendingOpening = true;
		}, INTRO_FADE_MS + 150);
	}

	// Fires the opening greeting only once the post-interview intro gif has
	// finished, so its line types out on screen (not hidden behind the splash).
	// MUST be $state: a plain variable short-circuits the effect's first run
	// before splashPhase is read, so the effect would never re-run (no deps).
	let pendingOpening = $state(false);
	$effect(() => {
		if (pendingOpening && splashPhase === 'done' && !loading) {
			pendingOpening = false;
			vitalsStartedAt = Date.now(); // the countdown starts with the game itself
			void afterEnter();
		}
	});

	function introRecord(a: string) {
		pushIntro('player', a);
		playSfx('send'); // answering is "sending" — same cue as the chatbox
		introAnswers.push({ q: INTRO_QUESTIONS[introStep], a });
		introAnswer = '';
		if (introStep + 1 >= INTRO_QUESTIONS.length) finishIntro(false);
		else {
			introStep += 1;
			askIntroQuestion();
		}
	}

	// All intro keys arrive via the window handler (text input keys bubble up).
	function onIntroKey(e: KeyboardEvent) {
		if (introFading) return; // the form is done — ignore input during the fade
		const q = INTRO_QUESTIONS[introStep];
		if (e.key === 'Escape') {
			e.preventDefault();
			finishIntro(true);
			return;
		}
		if (q.kind === 'scale' && e.key >= '1' && e.key <= '9') {
			e.preventDefault();
			introRecord(e.key);
			return;
		}
		if (q.kind === 'text' && e.key === 'Enter') {
			e.preventDefault();
			const a = introAnswer.trim();
			// The restart cheat works from the interview too (kiosk unstick).
			if (a.toLowerCase().replace(/\s+/g, ' ') === 'sgx restart') {
				introAnswer = '';
				void restart();
				return;
			}
			if (a) introRecord(a);
		}
	}

	// Keep the answer field focused (kiosk: no mouse) for the whole questionnaire.
	$effect(() => {
		if (introActive && !loading) introInputEl?.focus();
	});
	// Keep the intro transcript pinned to the newest line.
	$effect(() => {
		if (introLines.length && introScrollEl) introScrollEl.scrollTop = introScrollEl.scrollHeight;
	});

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
		scale = Math.min(1, window.innerWidth / display.width, window.innerHeight / display.height);
	}
	// The frame's inline style: theme colours + resolution + placement. The window
	// is ALWAYS centered, nudged by the x/y offsets (screen px, negative = left/up).
	// Scaled to fit, never up past 1:1.
	// The backdrop behind the scene/blocks (inside the window) is ALWAYS the
	// palette background — invertUi only swaps colours inside the UI blocks.
	const pageBg = $derived(display.bg);
	// Everything OUTSIDE the window: the author's backdrop colour (default black).
	const backdrop = $derived(display.backdrop ?? '#000000');
	// Geometry shared by the game frame and the boot splash (which fills the same
	// screen area).
	const framePlacement = $derived.by(() => {
		const ox = display.offsetX ?? 0;
		const oy = display.offsetY ?? 0;
		return (
			`width:${display.width}px;height:${display.height}px;left:50%;top:50%;` +
			`transform:translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px)) scale(${scale});transform-origin:center`
		);
	});
	const frameStyle = $derived(`${themeStyle(display)};background:${pageBg};${framePlacement}`);
	// Refit when the resolution changes (e.g. once the live build loads).
	$effect(() => {
		void [display.width, display.height];
		computeScale();
	});
	// Font-size multiplier: rem-sized text (chat, items) scales with the root
	// font-size; the bars are px-sized constants so they can't overflow. Clamped to
	// the same range as the editor slider. Restored on unmount so the editor pages
	// aren't affected.
	$effect(() => {
		const s = clamp(display.fontScale ?? 1, 0.75, 1.5);
		document.documentElement.style.fontSize = `${s * 100}%`;
		return () => {
			document.documentElement.style.fontSize = '';
		};
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
	const sceneHasArt = (s: Scene) => s.layers.some((l) => layerImagePool(l).length > 0);

	// Items the computer may give in the current scene THIS run (rolled on entry).
	let presentGiveables = $state<string[]>([]);

	// The deck plan starts collapsed; it opens via the "0" key, by using an item
	// with id "map", or when the computer picks the __map__ outcome.
	let mapOpen = $state(false);

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

	// The most recent computer reply is highlighted (inverted colours) in the chat.
	const lastComputerId = $derived.by(() => {
		for (let i = lines.length - 1; i >= 0; i--) if (lines[i].who === 'computer') return lines[i].id;
		return -1;
	});

	// Top-view map: the current room centred, with every connected room placed
	// around it on a ring (positions are computed — nothing is authored per
	// scene). Doors are bidirectional by default; locked doors show sealed.
	const mapNodes = $derived.by(() => {
		const seen: Record<string, { id: string; visited: boolean; locked: boolean }> = {};
		for (const d of availableDoors(build.scenes, scene, game)) {
			if (d.toSceneId === scene.id) continue;
			const prev = seen[d.toSceneId];
			seen[d.toSceneId] = {
				id: d.toSceneId,
				visited: game.visitedScenes.includes(d.toSceneId),
				locked: prev ? prev.locked && d.locked : d.locked // any open door wins
			};
		}
		const conns = Object.values(seen);
		// Max 4 boxes. Every connection shows individually (each unexplored route is
		// its own "?" box). Priority when slicing: open doors before locked, visited
		// before unknown — but if any unknown exists, at least one "?" is guaranteed
		// a slot so unexplored routes are never hidden entirely.
		const sorted = conns.sort(
			(a, b) =>
				Number(a.locked) - Number(b.locked) ||
				Number(!a.visited) - Number(!b.visited) ||
				a.id.localeCompare(b.id)
		);
		const shown = sorted.slice(0, 4);
		if (sorted.some((c) => !c.visited) && !shown.some((c) => !c.visited)) {
			shown[shown.length - 1] = sorted.find((c) => !c.visited)!;
		}
		return shown.map((c, i) => {
			const a = -Math.PI / 2 + (i * 2 * Math.PI) / shown.length;
			const sin = Math.sin(a);
			return {
				...c,
				label: c.visited ? findScene(build.scenes, c.id)?.name || c.id : '?',
				x: +(110 + 78 * Math.cos(a)).toFixed(1),
				y: +(66 + 44 * sin).toFixed(1),
				// Label above the box only for top-side nodes; below otherwise — never
				// across the centre box.
				labelDy: sin < -0.5 ? -13 : 20
			};
		});
	});
	const shortName = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
	// Hint that the current room has unclaimed (rolled-present) items.
	const itemsHere = $derived(presentGiveables.some((id) => !game.inventory.includes(id)));

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
		// Lines live in the chat transcript or the intro's — ids are shared.
		const find = () => lines.find((l) => l.id === id) ?? introLines.find((l) => l.id === id);
		const target = find();
		if (!target) return;
		const step = Math.max(1, Math.ceil(target.text.length / 100));
		const tick = setInterval(() => {
			const l = find();
			if (!l) {
				clearInterval(tick);
				return;
			}
			l.revealed = Math.min(l.text.length, l.revealed + step);
			if (transcriptEl) transcriptEl.scrollTop = transcriptEl.scrollHeight;
			if (introScrollEl) introScrollEl.scrollTop = introScrollEl.scrollHeight;
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
		const doors = availableDoors(build.scenes, s, state);
		return {
			name: s.name,
			prompt: s.prompt,
			cameFrom: cameFromId ? findScene(build.scenes, cameFromId)?.name : undefined,
			// Doors are bidirectional by default. LOCKED doors never appear in `exits`
			// (no outcome is synthesized to move through them). Sealed routes split:
			// `unlockable` — the player carries a qualifying item, so the model gets
			// an unlock outcome for the explicit act of opening it — vs `lockedExits`
			// (info only: what would open it).
			exits: doors
				.filter((d) => !d.locked)
				.map((x) => ({
					label: x.label,
					toSceneId: x.toSceneId,
					back: x.toSceneId === cameFromId || undefined
				})),
			unlockable: doors
				.filter((d) => d.canUnlock)
				.map((d) => ({ label: d.label, exitId: d.exitId })),
			lockedExits: doors
				.filter((d) => d.locked && !d.canUnlock)
				.map((d) => ({ label: d.label, requires: (d.requiredItems ?? []).map(itemName) })),
			// Items carry their authored description — that's where their meaning lives.
			inventory: state.inventory.map((id) => {
				const it = build.items.find((i) => i.id === id);
				return { name: it?.name || id, description: it?.description || undefined };
			}),
			// Only offer items present this run that the player doesn't already hold.
			giveable: presentGiveables
				.filter((id) => !owned.has(id))
				.map((id) => ({
					itemId: id,
					label: itemName(id),
					description: build.items.find((i) => i.id === id)?.description || undefined
				}))
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

	// Rooms whose opening greeting has already played this run — returning to one
	// gets a short "welcome back" line instead of the full re-introduction.
	let greeted: Record<string, boolean> = {};
	// Where the player arrived from, so the computer can resolve "go back".
	let cameFromId: string | null = null;

	function initFrom(b: Build) {
		const started = startGame(b);
		game = started.state;
		// One art roll per RUN: multi-image layers keep the same variant for the
		// whole run, so leaving a room and coming back can't change its look.
		artPicks = rollLayerImages(b.scenes);
		lines = [];
		convo = []; // a fresh run starts the computer's memory clean
		profileTurn = null;
		greeted = {};
		cameFromId = null;
		mapOpen = false;
		vitalsStartedAt = Date.now(); // a fresh run starts at full(ish) vitals
		enterScene(b, started.state, started.messages);
	}

	// History for a converse request: the most recent turns, with the intake-
	// questionnaire turn pinned in front if slicing would have dropped it — the
	// computer must never forget the player's answers (or that they skipped).
	function withProfile(recent: ConversationTurn[]): ConversationTurn[] {
		return profileTurn && !recent.includes(profileTurn) ? [profileTurn, ...recent] : recent;
	}

	initFrom(placeholderBuild);

	// The computer speaks first when a scene is entered. Revisited rooms get a
	// short "welcome back" line instead of the full greeting.
	async function requestOpening() {
		const behaviour = activeBehaviourId
			? build.behaviours.find((b) => b.id === activeBehaviourId)
			: undefined;
		if (!behaviour) return;
		const revisit = !!greeted[game.currentSceneId];
		greeted[game.currentSceneId] = true;
		pending = true;
		try {
			const resp = await fetch('/api/converse', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					behaviourId: behaviour.id,
					opening: true,
					revisit,
					history: withProfile(convo.slice(-MAX_HISTORY_TURNS)),
					sceneContext: sceneContextFor(scene, game)
				})
			});
			const data = await resp.json();
			if (resp.ok && data.reply) {
				push('computer', data.reply);
				playSfx('receive');
				convo = [...convo, { role: 'computer', text: data.reply, behaviourId: behaviour.id }];
			}
		} catch {
			/* opening greeting is best-effort */
		} finally {
			pending = false;
		}
	}

	// After entering a scene: an ending plays the OUTRO gif (which freezes on its
	// last frame until any key starts the next cycle); otherwise the computer
	// greets.
	async function afterEnter() {
		const s = findScene(build.scenes, game.currentSceneId);
		if (s?.ending) {
			atEnding = true;
			startSplash('outro');
		} else {
			atEnding = false;
			await requestOpening();
		}
	}

	async function restart() {
		atEnding = false;
		initFrom(build); // picks a fresh random start, resets transcript + state
		startSplash('boot'); // a new cycle always opens with the BOOT gif
		beginIntro(); // …then the next player answers the questionnaire again
	}

	// --- cheat codes -----------------------------------------------------------
	// Operator commands typed straight into the composer, intercepted BEFORE the
	// LLM — the computer never sees them and they leave no trace in its history.
	//   sgx restart        → restart the whole experience (works even while the
	//                        computer is busy — the unstick button)
	//   sgx next room      → force a move through the first open door
	//   sgx rooms          → list every room ("here" marks the current one)
	//   sgx go to <room>   → teleport to a room by name (ignores doors & locks)
	//   sgx items          → list the items present in this room
	//   sgx get <item>     → grant an item by name
	// Extend by adding cases below.
	const matchByName = <T extends { id: string; name?: string }>(list: T[], q: string) =>
		list.find((x) => x.id.toLowerCase() === q || (x.name ?? '').toLowerCase() === q) ??
		list.find((x) => (x.name ?? '').toLowerCase().includes(q) || x.id.toLowerCase().includes(q));

	// A forced transition: real engine move + the same bookkeeping as a normal one
	// (movement STATE UPDATE, door sound, fresh greeting) so the computer keeps up.
	async function cheatMoveTo(sceneId: string) {
		const prev = game.currentSceneId;
		game = applyEffects(game, [{ type: 'goToScene', sceneId }]);
		cameFromId = prev;
		playSfx('door');
		const from = findScene(build.scenes, prev)?.name || prev;
		const to = findScene(build.scenes, game.currentSceneId)?.name || game.currentSceneId;
		convo = [
			...convo,
			{
				role: 'system',
				text: `STATE UPDATE: the player moved from "${from}" to "${to}".`,
				behaviourId: activeBehaviourId ?? ''
			}
		];
		enterScene(build, game, []);
		await afterEnter();
	}

	async function tryCheat(raw: string): Promise<boolean> {
		const cmd = raw.toLowerCase().replace(/\s+/g, ' ').trim();
		if (!cmd.startsWith('sgx')) return false;

		if (cmd === 'sgx restart') {
			await restart();
			return true;
		}

		if (cmd === 'sgx rooms') {
			// Only the rooms connected to this one (🔒 marks a sealed door).
			const doors = availableDoors(build.scenes, scene, game).map(
				(d) =>
					`${findScene(build.scenes, d.toSceneId)?.name || d.toSceneId}${d.locked ? ' 🔒' : ''}`
			);
			push(
				'system',
				doors.length
					? `[ rooms connected to ${scene.name || scene.id}: ${doors.join(' · ')} ]`
					: '[ no rooms connect to this one ]'
			);
			return true;
		}

		if (cmd === 'sgx items') {
			const here = presentGiveables.map((id) => {
				const it = build.items.find((i) => i.id === id);
				return `${it?.name || id}${game.inventory.includes(id) ? ' (held)' : ''}`;
			});
			push('system', here.length ? `[ items here: ${here.join(' · ')} ]` : '[ no items here ]');
			return true;
		}

		// State-mutating overrides wait their turn behind a pending reply.
		if (pending) {
			push('system', '[ computer busy — try the override again in a moment ]');
			return true;
		}

		if (cmd === 'sgx next room') {
			const door = availableDoors(build.scenes, scene, game).find((d) => !d.locked);
			if (!door) {
				push('system', '[ override failed — no open route from here ]');
				return true;
			}
			push('system', `[ override accepted — forcing route: ${door.label} ]`);
			await cheatMoveTo(door.toSceneId);
			return true;
		}

		if (cmd.startsWith('sgx go to ')) {
			const q = cmd.slice('sgx go to '.length).trim();
			const dest = matchByName(build.scenes, q);
			if (!dest) {
				push('system', `[ no room matches "${q}" — try "sgx rooms" ]`);
			} else if (dest.id === game.currentSceneId) {
				push('system', '[ already there ]');
			} else {
				push('system', `[ override accepted — teleporting to ${dest.name || dest.id} ]`);
				await cheatMoveTo(dest.id);
			}
			return true;
		}

		if (cmd.startsWith('sgx get ')) {
			const q = cmd.slice('sgx get '.length).trim();
			const item = matchByName(build.items, q);
			if (!item) {
				push('system', `[ no item matches "${q}" ]`);
			} else if (game.inventory.includes(item.id)) {
				push('system', `[ already holding ${item.name} ]`);
			} else {
				game = applyEffects(game, [{ type: 'addItem', itemId: item.id }]);
				playSfx('get');
				push('system', `[ +item ${item.name} ]`);
				convo = [
					...convo,
					{
						role: 'system',
						text: `STATE UPDATE: the player now holds "${item.name}".`,
						behaviourId: activeBehaviourId ?? ''
					}
				];
			}
			return true;
		}

		push(
			'system',
			'[ unknown override — known: "sgx restart" · "sgx next room" · "sgx rooms" · "sgx go to <room>" · "sgx items" · "sgx get <item>" ]'
		);
		return true;
	}

	async function sendMessage() {
		const text = inputText.trim();
		if (!text) return;
		// Cheats run before the pending guard, so "sgx restart" can always unstick.
		if (await tryCheat(text)) {
			inputText = '';
			return;
		}
		if (pending) return;
		push('player', text);
		playSfx('send');
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
					history: withProfile(prior.slice(-MAX_HISTORY_TURNS)),
					sceneContext: sceneContextFor(scene, game)
				})
			});
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
			const data: { reply: string; outcomeId: string; appliedEffects: Effect[] } =
				await resp.json();

			push('computer', data.reply);
			playSfx('receive');
			convo = [...convo, { role: 'computer', text: data.reply, behaviourId: behaviour.id }];

			// The computer can put the deck plan on screen (no engine effect involved).
			if (data.outcomeId === MAP_OUTCOME_ID) {
				mapOpen = true;
				playSfx('map');
			}

			if (data.appliedEffects.length) {
				const prev = game.currentSceneId;
				const prevScene = scene;
				// Door states before the effects land — to announce changes after.
				const doorsBefore = availableDoors(build.scenes, prevScene, game);
				const lockedBefore = new Set(doorsBefore.filter((d) => d.locked).map((d) => d.toSceneId));
				const canUnlockBefore = new Set(
					doorsBefore.filter((d) => d.canUnlock).map((d) => d.toSceneId)
				);
				game = applyEffects(game, data.appliedEffects);
				const nav = data.appliedEffects.some((e) => e.type === 'goToScene');
				// Gaining an item is a little victory — give it the fanfare.
				if (data.appliedEffects.some((e) => e.type === 'addItem')) playSfx('get');
				if (!nav) {
					push('system', `[ ${data.appliedEffects.map(describeEffect).join(', ')} ]`);
					// Engine-generated ground truth for the model: dialogue earlier in the
					// transcript may contradict the new state, so spell the change out.
					const stateNotes: string[] = [];
					for (const e of data.appliedEffects) {
						if (e.type === 'addItem')
							stateNotes.push(`the player now holds "${itemName(e.itemId)}"`);
						if (e.type === 'removeItem')
							stateNotes.push(`the player no longer holds "${itemName(e.itemId)}"`);
					}
					for (const d of availableDoors(build.scenes, prevScene, game)) {
						if (!d.locked && lockedBefore.has(d.toSceneId)) {
							push('system', `-- route unlocked: ${d.label} --`);
							playSfx('unlock');
							stateNotes.push(`the route "${d.label}" is now UNLOCKED and is an available exit`);
						} else if (d.canUnlock && !canUnlockBefore.has(d.toSceneId)) {
							// e.g. a just-granted item qualifies for a sealed door
							stateNotes.push(
								`the sealed route "${d.label}" can NOW be unlocked — the player carries what it needs`
							);
						}
					}
					if (stateNotes.length) {
						convo = [
							...convo,
							{
								role: 'system',
								text: `STATE UPDATE: ${stateNotes.join('; ')}.`,
								behaviourId: behaviour.id
							}
						];
					}
				}
				if (game.currentSceneId !== prev) {
					cameFromId = prev;
					playSfx('door'); // airlock clunk + hiss on every room transition
					// Movement event in the LLM history, so the computer carries the
					// narrative across rooms ("we came here from the cryo pod…").
					const from = findScene(build.scenes, prev)?.name || prev;
					const to = findScene(build.scenes, game.currentSceneId)?.name || game.currentSceneId;
					convo = [
						...convo,
						{
							role: 'system',
							text: `STATE UPDATE: the player moved from "${from}" to "${to}".`,
							behaviourId: behaviour.id
						}
					];
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
		// The "map" item is a player tool, not a conversation: it opens the deck plan.
		if (item.id === 'map') {
			mapOpen = !mapOpen;
			playSfx('map');
			return;
		}
		playSfx('use');
		inputText = `use the ${item.name}`;
		sendMessage();
	}
	// Number keys 1–9 use the matching slot, 0 toggles the deck plan — but only
	// when the player hasn't started typing, so normal messages (which may contain
	// digits) aren't hijacked.
	function onComposerKey(e: KeyboardEvent) {
		if (pending || inputText.length > 0) return;
		if (e.key === '0') {
			e.preventDefault();
			mapOpen = !mapOpen;
			playSfx('map');
			return;
		}
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
		// The browser notice is topmost: any key just dismisses it.
		if (browserWarn) {
			e.preventDefault();
			browserWarn = false;
			return;
		}
		// Waiting for the audio-unlocking gesture: any key starts the boot.
		if (needsKeyToStart) {
			e.preventDefault();
			needsKeyToStart = false;
			startSplash('boot');
			beginIntro();
			return;
		}
		// ESC skips the boot/intro splash video (testing aid).
		if (e.key === 'Escape' && splashKind !== 'outro' && splashPhase !== 'done') {
			e.preventDefault();
			skipSplash();
			return;
		}
		// At the outro's frozen last frame, ANY key starts the next cycle.
		if (atEnding) {
			e.preventDefault();
			void restart();
			return;
		}
		if (introActive) {
			onIntroKey(e);
			return;
		}
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

	// Kiosk focus lock: there is no mouse — the composer must always own the
	// keyboard. Focus it on load, re-focus when it re-enables after a send, and
	// snap focus back if anything ever steals it.
	let inputEl = $state<HTMLInputElement>();
	$effect(() => {
		if (!pending && !loading && !introActive) inputEl?.focus();
	});
	function refocus() {
		// Never wrestle the questionnaire for focus — its input owns the keyboard
		// while the interview is up.
		setTimeout(() => {
			if (!introActive) inputEl?.focus();
		}, 0);
	}

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
		browserWarn = !isChromium();
		const clockId = setInterval(() => (clockNow = Date.now()), 1000);
		// Nothing visual starts here: the splash stays pure black until the build
		// (palette + geometry) is in, then the BOOT gif opens the cycle and the
		// interview follows it (startSplash + beginIntro in loadBuild's then).
		let unsubLive: (() => void) | undefined;
		// Live-update: when the editor publishes a different version, reload the
		// whole page so the kiosk picks up new content (and any new app code) —
		// this is also how a failed kiosk recovers without a hand. The
		// sessionStorage guard reloads at most once per target build, so a build
		// that keeps failing to load can never cause a reload loop.
		const watchLive = (runningId: string | null) => {
			if (!reloadOnPublish) return;
			unsubLive = onSnapshot(doc(db(), 'config', 'current'), (snap) => {
				const liveId = snap.data()?.activeBuildId as string | undefined;
				if (!liveId || liveId === runningId) return;
				const KEY = 'sgx-reloaded-for';
				if (sessionStorage.getItem(KEY) === liveId) return;
				sessionStorage.setItem(KEY, liveId);
				location.reload();
			});
		};
		loadBuild()
			.then(({ build: loaded, source }) => {
				if (source === 'placeholder') {
					// Live build unavailable (network error / nothing published): never
					// run the placeholder — show the discrete fail page instead.
					failed = true;
					loading = false;
					watchLive(null);
					return;
				}
				buildSource = source;
				build = loaded;
				initFrom(loaded);
				loading = false; // reveal the resolved build
				if (audioUnlocked()) {
					startSplash('boot'); // the cycle opens with the BOOT gif…
					beginIntro(); // …then the interview (the INTRO gif follows it)
				} else {
					// No sound allowed yet: wait for a key (see needsKeyToStart above).
					needsKeyToStart = true;
				}
				watchLive(source === 'firestore' ? `build-${loaded.meta.version}` : null);
			})
			.catch(() => {
				failed = true;
				loading = false;
				watchLive(null);
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
		return () => {
			cancelAnimationFrame(raf);
			clearInterval(clockId);
			splashTimers.forEach(clearTimeout);
			unsubLive?.();
		};
	});
</script>

<svelte:head><title>Adventure Engine — Play</title></svelte:head>
<svelte:window onkeydown={onKeydown} onkeyup={onKeyup} onresize={computeScale} />

{#if browserWarn}
	<!-- Topmost, palette-independent (hardcoded colours): the build's theme may not
	     be loaded yet. Any key (see onKeydown) or a click dismisses it. -->
	<div
		class="browserwarn"
		role="button"
		tabindex="0"
		onclick={() => (browserWarn = false)}
		onkeydown={() => (browserWarn = false)}
	>
		<div class="bw-box">
			<p class="bw-title">⚠ BUILT FOR CHROME</p>
			<p>
				This experience is designed for <strong>Google Chrome / Chromium</strong>. In other browsers
				some visuals, video or audio may not work as intended.
			</p>
			<p class="bw-hint">press any key to continue</p>
		</div>
	</div>
{/if}

{#if failed}
	<!-- Discrete fail page: never placeholder content, never the palette. -->
	<main class="failpage"><span>please restart</span></main>
{:else}
	<main class="letterbox" style:background={backdrop}>
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

				<div class="mid">
					<div class="stage">
						{#key game.currentSceneId}
							{@const snap = findScene(build.scenes, game.currentSceneId)!}
							<div class="scene-holder" in:fade={{ duration: 450 }} out:fade={{ duration: 300 }}>
								{#if sceneHasArt(snap)}
									<SceneRenderer scene={snap} {look} picks={artPicks} />
								{:else}
									<div class="nosignal" aria-label="no signal">
										<div class="static"></div>
										<span class="nosignal-text">NO SIGNAL</span>
									</div>
								{/if}
							</div>
						{/key}
					</div>

					<div class="hud">
						<div class="inventory" aria-label="inventory">
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
						</div>

						<!-- Always present: collapsed = just the title bar, so players know it's there. -->
						<div class="map" aria-label="deck plan">
							<div class="map-title">DECK PLAN · [0]</div>
							{#if mapOpen}
								<svg class="map-svg" viewBox="0 0 220 140" preserveAspectRatio="xMidYMid meet">
									<!-- corridors first, under the room boxes -->
									{#each mapNodes as n (n.id)}
										<line class="ml" class:locked={n.locked} x1="110" y1="66" x2={n.x} y2={n.y} />
									{/each}
									{#each mapNodes as n (n.id)}
										<rect
											class="mr"
											class:unknown={!n.visited}
											x={n.x - 16}
											y={n.y - 10}
											width="32"
											height="20"
										/>
										<text
											class="mt"
											class:unknown={!n.visited}
											x={n.x}
											y={n.y + n.labelDy}
											text-anchor="middle">{shortName(n.label, 10)}</text
										>
										{#if n.locked}
											<!-- padlock badge, centred in the room box -->
											<g class="mlock" transform="translate({n.x - 6}, {n.y - 7.2}) scale(1.5)">
												<path d="M2 4 V2.5 A2 2 0 0 1 6 2.5 V4" />
												<rect x="0.8" y="4" width="6.4" height="5" />
											</g>
										{/if}
									{/each}
									<!-- current room: big, outline only, name inside -->
									<rect class="mcur" x="68" y="41" width="84" height="50" />
									<text class="mt cur" x="110" y="70" text-anchor="middle"
										>{shortName(scene.name, 12)}</text
									>
									{#if itemsHere}
										<circle class="map-hint" cx="146" cy="46" r="3.5">
											<title>sensors detect loose items here</title>
										</circle>
									{/if}
									{#if !mapNodes.length}
										<text class="mt unknown" x="110" y="108" text-anchor="middle"
											>no routes detected</text
										>
									{/if}
								</svg>
							{/if}
						</div>
					</div>
				</div>

				<section class="terminal">
					<div class="transcript" bind:this={transcriptEl}>
						{#each lines as line (line.id)}
							<p
								class={line.who}
								class:latest={line.who === 'computer' && line.id === lastComputerId}
							>
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
							bind:this={inputEl}
							placeholder="type to the computer…"
							bind:value={inputText}
							onkeydown={onComposerKey}
							onblur={refocus}
						/>
					</form>
				</section>

				{#if introActive}
					{@const q = INTRO_QUESTIONS[introStep]}
					<!-- Opaque, non-fading shield: the game underneath must never show
					     through while the interview (or the splash above it) fades. -->
					<div
						class="introshield"
						style:background={display.mode === 'full' ? display.bg : '#000000'}
					></div>
					<!-- Intake questionnaire: the SAME chatbox, just larger — a .terminal
					     spanning the window from bottom to top (geometry overridden, every
					     other style shared); questions type out, history scrolls up. -->
					<section class="terminal intro" in:fade={{ duration: 400 }}>
						<div class="transcript" bind:this={introScrollEl}>
							{#each introLines as line (line.id)}
								<p class={line.who} class:latest={line.id === introQuestionLineId}>
									{#if line.who === 'player'}<span class="who">&gt;</span>{/if}{line.text.slice(
										0,
										line.revealed
									)}
								</p>
							{/each}
						</div>
						<form class="composer" onsubmit={(e) => e.preventDefault()}>
							<span class="prompt">&gt;</span>
							<input
								bind:this={introInputEl}
								bind:value={introAnswer}
								use:autofocus
								onblur={() =>
									setTimeout(() => {
										if (introActive) introInputEl?.focus();
									}, 0)}
								autocomplete="off"
								spellcheck="false"
								placeholder={q.kind === 'text' ? 'type your answer…' : 'press a key, 1 to 9…'}
							/>
						</form>
					</section>
				{/if}
				{#if introFading}
					<!-- The bridge between the form and the game: fades in to the
					     background colour, then fades away over the live screen. -->
					<div
						class="introfade"
						style:background={display.mode === 'full' ? display.bg : '#000000'}
						transition:fade={{ duration: INTRO_FADE_MS }}
					></div>
				{/if}
			</div>
			<div class="crt" aria-hidden="true" style:background={crtBg}></div>
		</div>

		{#if splashPhase !== 'done' || loading}
			<!-- Hardcoded black (never the palette): covers the whole viewport from the
			     very first SSR paint, so no colour can flash before the build loads.
			     The current gif (boot / intro / outro) fills the same area the game
			     screen occupies (cropped to it, palette-tinted, under the CRT overlay),
			     fades to the bg-coloured window (CRT still on), then the splash fades
			     into what's next; the outro instead freezes on its last frame until a
			     key. Everything outside the window is the backdrop colour. -->
			<div
				class="bootsplash"
				style:background={loading || needsKeyToStart ? '#000' : backdrop}
				out:fade={{ duration: 400 }}
			>
				{#if needsKeyToStart}
					<div class="startprompt"><span>press any key to start</span></div>
				{:else if !loading}
					<!-- The window area keeps its bg colour + CRT for the WHOLE splash —
					     the gif fades out over it into the post-gif beat. -->
					<div class="bootframe" style="{framePlacement};background:{pageBg}">
						{#if splashMediaOk && splashPhase === 'play'}
							{#if splashIsVideo}
								{#key splashSrc}
									<video
										src={splashSrc}
										playsinline
										use:autoplayWithSound
										onended={splashMediaEnded}
										onerror={nextSplashSource}
										out:fade={{ duration: 500 }}
									>
										<!-- decorative ambience — no dialogue to caption -->
										<track kind="captions" />
									</video>
								{/key}
							{:else}
								<img
									src={splashSrc}
									alt={splashKind}
									onload={armGifEnd}
									onerror={nextSplashSource}
									out:fade={{ duration: 500 }}
								/>
							{/if}
						{/if}
						<div class="crt" style:background={crtBg}></div>
					</div>
				{/if}
			</div>
		{/if}
	</main>
{/if}

<style>
	/* Browser notice: topmost, hardcoded amber-on-black (palette-independent). */
	.browserwarn {
		position: fixed;
		inset: 0;
		z-index: 500;
		display: grid;
		place-items: center;
		padding: 2rem;
		background: #000;
		cursor: pointer;
		font-family: var(--font-terminal, monospace);
	}
	.bw-box {
		max-width: 30rem;
		text-align: center;
		color: #ffb000;
		line-height: 1.6;
		letter-spacing: 0.05em;
	}
	.bw-box p {
		margin: 0 0 1rem;
	}
	.bw-title {
		font-size: 1.2rem;
		letter-spacing: 0.2em;
	}
	.bw-box strong {
		color: #ffd980;
	}
	.bw-hint {
		margin-top: 1.4rem;
		font-size: 0.8rem;
		color: #8a6a18;
		letter-spacing: 0.2em;
		animation: blink 1.1s steps(1) infinite;
	}

	.failpage {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		background: #000;
	}
	.failpage span {
		font-family: var(--font-terminal);
		font-size: 1rem;
		letter-spacing: 0.2em;
		color: #555;
	}
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
		/* backdrop colour comes from the inline frameStyle (always the palette bg) */
	}
	/* Solid-bar layout: constant-height top + bottom bars (px-sized, immune to the
	   font multiplier), and a middle row where the 4:3 scene takes the full height
	   flush against the right edge while the inventory fills all leftover space on
	   the left. Spacing is px so blocks always sit tight. */
	.content {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		/* no gap: header > scene > chatbox stack flush vertically */
		padding: 12px;
	}
	.mid {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
	}
	/* Duotone modes: the UI inside .content is authored in MONOCHROME (themeVars
	   emits white-on-black) and this one filter colourizes everything — scene art
	   and UI — onto the bg→ui ramp. One surface, one colour path: nothing inside
	   the frame can be off-palette or mismatch the scene. The .crt overlay stays a
	   SIBLING (outside the filter), applied after quantization. */
	.content.duo {
		/* The backdrop is pure black: the duotone table maps luminance 0 to the
		   palette BACKGROUND regardless of invertUi — same colour as the surround,
		   so the backdrop is always the bg colour in every mode. */
		background: #000;
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

	/* Intake questionnaire: the same chatbox, just larger — a .terminal spanning
	   the whole window (inset matches the .content padding). Only the geometry is
	   overridden; surface, border, fonts, colours and behaviour are .terminal's. */
	.terminal.intro {
		position: absolute;
		inset: 12px;
		height: auto;
		z-index: 60;
	}
	/* Lines grow from the bottom (terminal-style): the auto margin soaks up the
	   free space above until the log fills the box, then scrolling takes over. */
	.terminal.intro .transcript p:first-child {
		margin-top: auto;
	}
	/* "Press any key" gate: same discrete look as the fail page — it exists only
	   to collect the gesture that unlocks audio before the boot rolls. */
	.startprompt {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
	}
	.startprompt span {
		font-family: var(--font-terminal);
		font-size: 1rem;
		letter-spacing: 0.2em;
		color: #555;
		animation: blink 1.1s steps(1) infinite;
	}

	/* Sits under the interview, over the game: bg-coloured, never transparent —
	   so the interview's fade-in can only ever reveal the background colour. */
	.introshield {
		position: absolute;
		inset: 0;
		z-index: 59;
	}
	/* The fade between the finished form and the live game (bg colour; in duotone
	   pure black maps onto it). */
	.introfade {
		position: absolute;
		inset: 0;
		z-index: 70;
	}

	/* Fullscreen boot splash: pure black while the build loads (no palette yet),
	   then the author's backdrop colour outside the bg-coloured window (inline
	   styles). The fallback stays #000 for SSR/first paint. */
	.bootsplash {
		position: fixed;
		inset: 0;
		z-index: 300;
		background: #000;
	}
	/* Same geometry as the game frame — the gif fills the screen area exactly. */
	.bootframe {
		position: absolute;
		overflow: hidden;
	}
	.bootframe img,
	.bootframe video {
		width: 100%;
		height: 100%;
		object-fit: cover;
		/* Palette-match the media: grayscale first, then the same duotone colour
		   map as the screen (smooth ramp in full/gradient mode, hard two-colour in
		   pure duotone — duoFunc decides). Black maps to the palette bg, white to ui. */
		filter: grayscale(1) url(#sgx-duotone);
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

	/* The scene: fills the whole middle row, borderless so the image blends into
	   the backdrop. The image fits INSIDE it (whole image visible, anchored RIGHT
	   — SceneRenderer layers are object-fit: contain). HUD floats over the
	   leftover space on the left. */
	.stage {
		position: relative;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		/* transparent: the backdrop behind the image is the frame's (always the
		   palette bg — in duotone the .content.duo black filters to it) */
		background: transparent;
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
		background: transparent;
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

	/* Top info bar — constant size: px font + padding so the font multiplier can
	   never overflow it. */
	.statusbar {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 14px;
		overflow: hidden;
		background: var(--overlay-bg);
		border: 1px solid var(--line);
		font-family: var(--font-ui);
		font-size: 13px;
		letter-spacing: 0.04em;
		color: var(--ink);
		text-shadow: var(--glow);
		box-shadow: 0 0 22px rgba(255, 176, 0, 0.06);
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
		font-size: 11px;
	}
	.statusbar .bld {
		color: var(--ink-dim);
		font-size: 11px;
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

	/* HUD column floating over the scene's top-left corner: inventory on top,
	   deck plan right below it. */
	.hud {
		position: absolute;
		top: 10px;
		left: 10px;
		z-index: 40;
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: flex-start;
	}

	/* Inventory: a 3×3 grid (keys 1–9; rem-sized so the font multiplier scales it). */
	.inventory {
		display: grid;
		grid-template-columns: repeat(3, 3.1rem);
		gap: 6px;
		padding: 8px;
		background: var(--overlay-bg);
		border: 1px solid var(--line);
		box-shadow: 0 0 18px rgba(255, 176, 0, 0.05);
	}

	/* Deck plan: always present right below the inventory — collapsed it's just
	   the title bar; open (0 / the map item / the computer) it expands to the
	   same width as the inventory. */
	.map {
		/* match the inventory: 3×3.1rem slots + 2×6px gaps + 2×8px padding */
		width: calc(9.3rem + 28px);
		display: flex;
		flex-direction: column;
		padding: 6px 8px;
		background: var(--overlay-bg);
		border: 1px solid var(--line);
		box-shadow: 0 0 18px rgba(255, 176, 0, 0.05);
	}
	.map-title {
		font-family: var(--font-terminal);
		font-size: 11px;
		letter-spacing: 0.14em;
		color: var(--ink-dim);
	}
	.map-svg {
		width: 100%;
		aspect-ratio: 220 / 140;
		margin-top: 2px;
	}
	.ml {
		stroke: var(--ink-dim);
		stroke-width: 1.2;
	}
	.ml.locked {
		stroke-dasharray: 4 3;
	}
	.mlock path {
		fill: none;
		stroke: var(--ink);
		stroke-width: 1.2;
	}
	.mlock rect {
		fill: var(--ink);
	}
	.mr {
		fill: var(--bg);
		stroke: var(--ink);
		stroke-width: 1.4;
	}
	.mr.unknown {
		stroke: var(--ink-dim);
		stroke-dasharray: 3 2;
	}
	.mcur {
		fill: var(--bg);
		stroke: var(--ink);
		stroke-width: 2;
	}
	.mt {
		fill: var(--ink);
		font-family: var(--font-terminal);
		font-size: 10px;
	}
	.mt.cur {
		font-weight: 700;
		font-size: 11px;
		text-transform: uppercase;
	}
	.mt.unknown {
		fill: var(--ink-dim);
	}
	.map-hint {
		fill: var(--accent);
		animation: blink 1.1s steps(1) infinite;
	}
	.slot {
		position: relative;
		aspect-ratio: 1;
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
	/* Bottom chat bar — CONSTANT height (px). The transcript flexes inside it and
	   scrolls, so larger fonts show fewer lines instead of overflowing; ~the last
	   two messages are visible at 100%. */
	.terminal {
		flex: none;
		height: 176px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 16px;
		background: var(--overlay-bg);
		border: 1px solid var(--line);
		font-family: var(--font-terminal);
		text-shadow: var(--glow);
		box-shadow: 0 0 22px rgba(255, 176, 0, 0.06);
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
	/* The most recent computer reply: inverted colours so it can't be missed. */
	.transcript p.latest {
		background: var(--ink);
		color: var(--bg);
		text-shadow: none;
		padding: 0.15rem 0.45rem;
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
