<script lang="ts">
	import { onMount } from 'svelte';
	import { loadDraft, setDisplay } from '$lib/content/draft';
	import { draftStatus } from '$lib/content/draftStatus.svelte';
	import {
		DEFAULT_DISPLAY,
		COLOR_PRESETS,
		themeStyle,
		duotoneTable,
		crtBackground
	} from '$lib/theme';
	import type { DisplaySettings } from '$lib/engine/types';

	let display = $state<DisplaySettings>({ ...DEFAULT_DISPLAY });
	let busy = $state(false);
	let message = $state('');

	onMount(() =>
		loadDraft()
			.then((d) => {
				if (d?.meta.display) display = { ...DEFAULT_DISPLAY, ...d.meta.display };
			})
			.catch((e) => (message = String(e)))
	);

	function applyPreset(p: (typeof COLOR_PRESETS)[number]) {
		display.bg = p.bg;
		display.ui = p.ui;
	}

	async function save() {
		busy = true;
		message = '';
		try {
			await setDisplay({
				...$state.snapshot(display),
				width: Math.round(display.width) || DEFAULT_DISPLAY.width,
				height: Math.round(display.height) || DEFAULT_DISPLAY.height,
				offsetX: Math.round(display.offsetX ?? 0) || 0,
				offsetY: Math.round(display.offsetY ?? 0) || 0,
				// Legacy placement fields are dropped on save (undefined-safe writer).
				center: undefined,
				marginLeft: undefined,
				marginTop: undefined
			});
			draftStatus.markDirty();
			message = 'Saved to the draft. Publish to apply it to the live game.';
		} catch (e) {
			message = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	// --- preview geometry (proportional, on a 1920×1080 reference screen) -------
	const REF_W = 1920;
	const REF_H = 1080;
	const PREVIEW_W = 460;
	const k = PREVIEW_W / REF_W;
	const previewH = REF_H * k;

	const fit = $derived(Math.min(1, REF_W / (display.width || 1), REF_H / (display.height || 1)));
	const fw = $derived(display.width * fit * k);
	const fh = $derived(display.height * fit * k);
	const fleft = $derived((PREVIEW_W - fw) / 2 + (display.offsetX ?? 0) * k);
	const ftop = $derived((previewH - fh) / 2 + (display.offsetY ?? 0) * k);
	const dt = $derived(duotoneTable(display.bg, display.ui));
	const duoFunc = $derived(display.mode === 'duotone' ? 'discrete' : 'table');
	const pcrtBg = $derived(crtBackground(display.crt));
</script>

<h1>Display</h1>
<p class="note">Global look — applies to the whole game once published.</p>
{#if message}<p class="msg">{message}</p>{/if}

<div class="grid">
	<div class="form">
		<fieldset>
			<legend>resolution (px)</legend>
			<div class="row">
				<label class="num">width <input type="number" min="160" bind:value={display.width} /></label
				>
				<label class="num"
					>height <input type="number" min="160" bind:value={display.height} /></label
				>
			</div>
		</fieldset>

		<fieldset>
			<legend>placement</legend>
			<div class="row">
				<label class="num">x offset <input type="number" bind:value={display.offsetX} /></label>
				<label class="num">y offset <input type="number" bind:value={display.offsetY} /></label>
			</div>
			<span class="muted small"
				>always centered; the offsets nudge the window in px (negative = left / up)</span
			>
		</fieldset>

		<fieldset>
			<legend>palette</legend>
			<div class="row">
				<label class="color"
					>background <input type="color" bind:value={display.bg} /><code>{display.bg}</code></label
				>
				<label class="color"
					>ui / ink <input type="color" bind:value={display.ui} /><code>{display.ui}</code></label
				>
				<label class="color"
					>backdrop <input type="color" bind:value={display.backdrop} /><code
						>{display.backdrop}</code
					></label
				>
			</div>
			<span class="muted small">backdrop = everything outside the game window</span>
			<div class="presets">
				{#each COLOR_PRESETS as p (p.name)}
					<button
						type="button"
						class="preset"
						style="--pb:{p.bg};--pu:{p.ui}"
						onclick={() => applyPreset(p)}
					>
						<span class="sw"></span>{p.name}
					</button>
				{/each}
			</div>
			<label class="chk"
				><input type="checkbox" bind:checked={display.invertUi} /> invert UI colours (bright panels, dark
				text — scene art unchanged)</label
			>
		</fieldset>

		<fieldset>
			<legend>colour mode</legend>
			<label class="chk"
				><input type="radio" value="full" bind:group={display.mode} /> full colour (scene art in colour,
				UI in the palette)</label
			>
			<label class="chk"
				><input type="radio" value="gradient" bind:group={display.mode} /> duotone — scale (smooth shades
				between the two colours)</label
			>
			<label class="chk"
				><input type="radio" value="duotone" bind:group={display.mode} /> duotone — pure (only the two
				colours, hard)</label
			>
		</fieldset>

		<!-- UI opacity is retired (solid-bar layout); the stored value persists. -->

		<fieldset>
			<legend>CRT effect — {Math.round(display.crt * 100)}%</legend>
			<input
				type="range"
				min="0"
				max="100"
				step="1"
				value={Math.round(display.crt * 100)}
				oninput={(e) => (display.crt = e.currentTarget.valueAsNumber / 100)}
			/>
			<span class="muted small">scanlines, vignette &amp; phosphor glow</span>
		</fieldset>

		<fieldset>
			<legend>font size — {Math.round((display.fontScale ?? 1) * 100)}%</legend>
			<input
				type="range"
				min="75"
				max="150"
				step="5"
				value={Math.round((display.fontScale ?? 1) * 100)}
				oninput={(e) => (display.fontScale = e.currentTarget.valueAsNumber / 100)}
			/>
			<span class="muted small"
				>scales the chat &amp; item text (the info bar stays constant); capped so nothing overflows</span
			>
		</fieldset>

		<fieldset>
			<legend>countdown (predicted survival)</legend>
			<label class="num"
				>minutes <input
					type="number"
					min="1"
					max="60"
					step="1"
					value={Math.round((display.survivalSeconds ?? 360) / 60)}
					oninput={(e) =>
						(display.survivalSeconds = Math.max(
							60,
							Math.min(3600, Math.round(e.currentTarget.valueAsNumber || 0) * 60)
						))}
				/></label
			>
			<span class="muted small"
				>how long the survival timer runs before a fatal event; the midpoint heads-up alert scales
				with this (the 2-min &amp; 30-sec warnings stay absolute)</span
			>
		</fieldset>

		<div class="actions">
			<button type="button" class="primary" onclick={save} disabled={busy}>Save</button>
		</div>
	</div>

	<div class="preview">
		<h2>
			Preview <span class="muted">({display.width} × {display.height}, on a 1080p screen)</span>
		</h2>
		<div
			class="screen"
			style="width:{PREVIEW_W}px;height:{previewH}px;background:{display.backdrop ?? '#000000'}"
		>
			<div
				class="pframe"
				style="{themeStyle(display)};background:{display.bg};--pfs:{display.fontScale ??
					1};width:{fw}px;height:{fh}px;left:{fleft}px;top:{ftop}px"
			>
				<div class="pcontent" class:duo={display.mode !== 'full'}>
					<div class="pscene"></div>
					<div class="pstatus">ARG-OS v0.5.2 · CRITICAL</div>
					<div class="pterm">&gt; ARGOS ready_</div>
				</div>
				<div class="pcrt" style:background={pcrtBg}></div>
			</div>
		</div>
		<p class="muted small">
			Save writes to the draft; the live game changes only after you publish.
		</p>
	</div>
</div>

<!-- duotone luminance map (dark → bg, light → ui) -->
<svg width="0" height="0" aria-hidden="true" style="position:absolute">
	<filter id="sgx-duotone-preview" color-interpolation-filters="sRGB">
		<feColorMatrix
			color-interpolation-filters="sRGB"
			type="matrix"
			values="0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0 0 0 1 0"
		/>
		<feComponentTransfer color-interpolation-filters="sRGB">
			<feFuncR type={duoFunc} tableValues={dt.r} />
			<feFuncG type={duoFunc} tableValues={dt.g} />
			<feFuncB type={duoFunc} tableValues={dt.b} />
		</feComponentTransfer>
	</filter>
</svg>

<style>
	h1 {
		margin: 0 0 0.5rem;
	}
	h2 {
		margin: 0 0 0.6rem;
		font-size: 1rem;
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
	.small {
		font-size: 0.75rem;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 1.4rem;
		align-items: start;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		max-width: 34rem;
	}
	fieldset {
		border: 1px solid var(--line);
		margin: 0;
		padding: 0.5rem 0.7rem 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	legend {
		color: var(--ink-dim);
		font-size: 0.8rem;
		padding: 0 0.4rem;
	}
	.row {
		display: flex;
		gap: 0.8rem;
		flex-wrap: wrap;
	}
	label {
		font-size: 0.78rem;
		color: var(--ink-dim);
	}
	.num {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.num input {
		width: 6rem;
	}
	.color {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.chk {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: var(--ink);
	}
	input,
	code {
		font: inherit;
		color: var(--ink);
	}
	input[type='number'] {
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.3rem 0.45rem;
	}
	input[type='color'] {
		width: 2.4rem;
		height: 1.8rem;
		padding: 0;
		background: none;
		border: 1px solid var(--line);
	}
	input[type='range'] {
		width: 100%;
		accent-color: var(--accent);
	}
	code {
		font-size: 0.75rem;
		color: var(--ink-dim);
	}
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.preset {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font: inherit;
		font-size: 0.75rem;
		cursor: pointer;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.25rem 0.5rem;
	}
	.preset:hover {
		border-color: var(--accent);
	}
	.preset .sw {
		width: 1.1rem;
		height: 1.1rem;
		border: 1px solid var(--line);
		background: linear-gradient(135deg, var(--pb) 0 50%, var(--pu) 50% 100%);
	}
	.actions {
		margin-top: 0.3rem;
	}
	button {
		font: inherit;
		cursor: pointer;
		color: var(--ink);
		background: #0c0e11;
		border: 1px solid var(--line);
		padding: 0.4rem 0.8rem;
	}
	button:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}
	button:disabled {
		opacity: 0.5;
	}
	.primary {
		border-color: var(--accent);
	}

	/* --- preview --- */
	.preview {
		position: sticky;
		top: 1rem;
	}
	.screen {
		position: relative;
		overflow: hidden;
		background: #000;
		border: 1px solid var(--line);
		box-shadow: inset 0 0 0 1px #000;
	}
	.pframe {
		position: absolute;
		overflow: hidden;
		/* backdrop colour comes from the inline style (always the palette bg) */
	}
	.pscene {
		position: absolute;
		inset: 0;
		background:
			radial-gradient(circle at 30% 30%, #6fb0e0, transparent 55%),
			radial-gradient(circle at 75% 65%, #e0a040, transparent 50%),
			linear-gradient(160deg, #243044, #5a3a2a 60%, #101418);
	}
	.pcontent {
		position: absolute;
		inset: 0;
	}
	/* Matches the runtime: in duotone modes the whole content (monochrome-authored
	   UI + scene) is colourized by the one filter. */
	.pcontent.duo {
		/* pure black filters to the palette background regardless of invertUi */
		background: #000;
		filter: url(#sgx-duotone-preview);
	}
	.pcrt {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 2;
	}
	.pstatus {
		position: absolute;
		left: 6%;
		right: 6%;
		top: 6%;
		padding: 2px 5px;
		font-size: calc(8px * var(--pfs, 1));
		color: var(--ink);
		background: var(--overlay-bg);
		border: 1px solid var(--line);
		white-space: nowrap;
		overflow: hidden;
	}
	.pterm {
		position: absolute;
		left: 6%;
		right: 6%;
		bottom: 6%;
		height: 34%;
		padding: 3px 5px;
		font-size: calc(9px * var(--pfs, 1));
		color: var(--ink);
		background: var(--overlay-bg);
		border: 1px solid var(--line);
	}
</style>
