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

	it('forces panels opaque in hard duotone, honours opacity otherwise', () => {
		expect(
			themeVars({ ...DEFAULT_DISPLAY, bg: '#000000', uiOpacity: 0.5, mode: 'duotone' })[
				'--overlay-bg'
			]
		).toBe('rgba(0, 0, 0, 1)');
		expect(
			themeVars({ ...DEFAULT_DISPLAY, bg: '#000000', uiOpacity: 0.5, mode: 'gradient' })[
				'--overlay-bg'
			]
		).toBe('rgba(0, 0, 0, 0.5)');
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

	it('ships old-monitor presets defaulting to the gradient duotone', () => {
		expect(COLOR_PRESETS.length).toBeGreaterThan(2);
		expect(COLOR_PRESETS.some((p) => p.mode === 'gradient')).toBe(true);
	});
});
