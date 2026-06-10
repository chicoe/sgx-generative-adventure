import { describe, it, expect } from 'vitest';
import {
	DEFAULT_DISPLAY,
	COLOR_PRESETS,
	mix,
	rgba,
	themeVars,
	duotoneTable,
	crtBackground
} from './theme';

describe('theme', () => {
	it('defaults to the off-black + amber look at full CRT', () => {
		expect(DEFAULT_DISPLAY.bg).toBe('#0a0805');
		expect(DEFAULT_DISPLAY.ui).toBe('#ffb000');
		expect(DEFAULT_DISPLAY.mode).toBe('full');
		expect(DEFAULT_DISPLAY.crt).toBe(1);
	});

	it('mix blends between the endpoints', () => {
		expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
		expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
		expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
	});

	it('rgba renders channels + alpha', () => {
		expect(rgba('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
	});

	it('themeVars maps the two colours onto the CSS variables', () => {
		const v = themeVars({ ...DEFAULT_DISPLAY, bg: '#000000', ui: '#ffffff', uiOpacity: 0.5 });
		expect(v['--bg']).toBe('#000000');
		expect(v['--ink']).toBe('#ffffff');
		expect(v['--overlay-bg']).toBe('rgba(0, 0, 0, 0.5)');
	});

	it('collapses to pure two colours in hard duotone (opaque, no shades, no glow)', () => {
		const pure = themeVars({
			...DEFAULT_DISPLAY,
			bg: '#000000',
			ui: '#ffffff',
			uiOpacity: 0.5,
			mode: 'duotone'
		});
		expect(pure['--overlay-bg']).toBe('rgba(0, 0, 0, 1)'); // opaque
		expect(pure['--panel']).toBe('#000000'); // no intermediate shade → bg
		expect(pure['--line']).toBe('#ffffff'); // borders → ui
		expect(pure['--ink-dim']).toBe('#ffffff'); // dim text → ui
		expect(pure['--glow']).toBe('none');
	});

	it('keeps soft shades + opacity in gradient mode', () => {
		const g = themeVars({ ...DEFAULT_DISPLAY, bg: '#000000', uiOpacity: 0.5, mode: 'gradient' });
		expect(g['--overlay-bg']).toBe('rgba(0, 0, 0, 0.5)');
		expect(g['--glow']).not.toBe('none');
	});

	it('invert UI swaps panel ↔ ink (scene colours handled separately)', () => {
		const v = themeVars({ ...DEFAULT_DISPLAY, bg: '#000000', ui: '#ffffff', invertUi: true });
		expect(v['--bg']).toBe('#ffffff'); // panels become the bright colour
		expect(v['--ink']).toBe('#000000'); // text becomes the dark colour
	});

	it('duotone modes author the UI in monochrome for the filter to colourize', () => {
		// Regression: with a low-luminance ink (Custom1 red, lum≈0.49) palette-coloured
		// UI inside the filter remapped to a different ramp point than unfiltered UI.
		// Monochrome authoring makes white land exactly on ui and black exactly on bg.
		const custom1 = { ...DEFAULT_DISPLAY, bg: '#1d0f44', ui: '#f44e38' } as const;
		const g = themeVars({ ...custom1, mode: 'gradient' });
		expect(g['--ink']).toBe('#ffffff');
		expect(g['--bg']).toBe('#000000');
		expect(g['--ink-dim']).toBe('#999999'); // 60% grey → the 60% palette blend
		const pureInv = themeVars({ ...custom1, mode: 'duotone', invertUi: true });
		expect(pureInv['--bg']).toBe('#ffffff'); // inverted: bright panels…
		expect(pureInv['--ink']).toBe('#000000'); // …dark text, still monochrome
	});

	it('CRT strength scales the glow and the scanline overlay', () => {
		expect(themeVars({ ...DEFAULT_DISPLAY, crt: 0 })['--glow']).toBe(
			'0 0 0.0px rgba(255, 176, 0, 0)'
		);
		expect(crtBackground(0)).toContain('rgba(0,0,0,0.000)');
		expect(crtBackground(1)).toContain('rgba(0,0,0,0.180)');
	});

	it('duotone endpoints map dark→bg and light→ui', () => {
		const t = duotoneTable('#000000', '#ffffff');
		expect(t.r).toBe('0 1');
		expect(t.g).toBe('0 1');
		expect(t.b).toBe('0 1');
	});

	it('ships old-machine colour presets (valid hex pairs)', () => {
		expect(COLOR_PRESETS.length).toBeGreaterThan(2);
		const hex = /^#[0-9a-f]{6}$/i;
		expect(COLOR_PRESETS.every((p) => hex.test(p.bg) && hex.test(p.ui))).toBe(true);
	});
});
