// Global display/theme settings: defaults, monitor presets, and pure colour math
// that turns the two chosen colours into the full set of CSS variables the UI
// uses. Pure (no Svelte/Firebase) so both the runtime and the editor preview can
// share it. The off-black + amber default reproduces the current look.
import type { DisplaySettings } from './engine/types';

export const DEFAULT_DISPLAY: DisplaySettings = {
	width: 1280,
	height: 720,
	center: true,
	marginLeft: 0,
	marginTop: 0,
	bg: '#0a0805',
	ui: '#ffb000',
	mode: 'full',
	uiOpacity: 0.74,
	crt: 1,
	invertUi: false
};

export interface ColorPreset {
	name: string;
	bg: string;
	ui: string;
}

// Old-machine palettes ({ background, ui/ink }). A preset only sets the two
// colours; the colour mode / CRT / etc. stay as the author has them.
export const COLOR_PRESETS: ColorPreset[] = [
	{ name: 'C64', bg: '#3a1bf2', ui: '#a8b7f8' },
	{ name: 'T5100', bg: '#624129', ui: '#cd6606' },
	{ name: 'Apple2', bg: '#2f3642', ui: '#99eea6' },
	{ name: 'XeroxAlto', bg: '#0c0c0c', ui: '#eaeaea' },
	{ name: 'Custom1', bg: '#1d0f44', ui: '#f44e38' }
];

// --- colour helpers ---------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace('#', '').trim();
	const full =
		h.length === 3
			? h
					.split('')
					.map((c) => c + c)
					.join('')
			: h.padEnd(6, '0').slice(0, 6);
	const int = parseInt(full, 16) || 0;
	return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}
const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const toHex = (r: number, g: number, b: number) =>
	'#' + [r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('');

/** Linear blend between two hex colours (t=0 → a, t=1 → b). */
export function mix(a: string, b: string, t: number): string {
	const [ar, ag, ab] = hexToRgb(a);
	const [br, bg, bb] = hexToRgb(b);
	return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** A hex colour as an `rgba(...)` string at the given alpha. */
export function rgba(hex: string, alpha: number): string {
	const [r, g, b] = hexToRgb(hex);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Endpoints for an SVG duotone filter (feFunc tableValues map dark→bg, light→ui). */
export function duotoneTable(bg: string, ui: string): { r: string; g: string; b: string } {
	const [br, bgc, bb] = hexToRgb(bg).map((c) => c / 255);
	const [ur, ug, ub] = hexToRgb(ui).map((c) => c / 255);
	return { r: `${br} ${ur}`, g: `${bgc} ${ug}`, b: `${bb} ${ub}` };
}

/** CSS custom properties that recolour the whole UI from the two chosen colours. */
export function themeVars(d: DisplaySettings): Record<string, string> {
	const crt = d.crt ?? 1;
	// Hard duotone ('duotone') is two solid colours only: collapse every shade to
	// bg or ui, opaque panels, no glow. 'full' / 'gradient' keep the soft palette.
	const pure = d.mode === 'duotone';
	// "Invert UI" swaps panel ↔ ink for a bright-panel/dark-text terminal, WITHOUT
	// touching the scene art (the scene filter still uses the real bg/ui).
	const a = d.invertUi ? d.ui : d.bg; // panel / background colour
	const b = d.invertUi ? d.bg : d.ui; // ink / foreground colour
	return {
		'--bg': a,
		'--panel': pure ? a : mix(a, b, 0.06),
		'--line': pure ? b : mix(a, b, 0.28),
		'--ink': b,
		'--ink-dim': pure ? b : mix(a, b, 0.6),
		'--accent': pure ? b : mix(b, '#ffffff', 0.25),
		'--amber': b,
		'--glow': pure ? 'none' : `0 0 ${(6 * crt).toFixed(1)}px ${rgba(b, 0.4 * crt)}`,
		'--overlay-bg': rgba(a, pure ? 1 : d.uiOpacity)
	};
}

/** Serialize themeVars to an inline `style` string. */
export function themeStyle(d: DisplaySettings): string {
	return Object.entries(themeVars(d))
		.map(([k, v]) => `${k}:${v}`)
		.join(';');
}

/** The CRT overlay (scanlines + vignette) background, scaled by strength (0..1). */
export function crtBackground(crt: number): string {
	const s = Math.max(0, Math.min(1, crt ?? 1));
	const line = (0.18 * s).toFixed(3);
	const vig = (0.55 * s).toFixed(3);
	return (
		`repeating-linear-gradient(to bottom, rgba(0,0,0,${line}) 0, rgba(0,0,0,${line}) 1px,` +
		` transparent 1px, transparent 3px),` +
		` radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,${vig}) 100%)`
	);
}
