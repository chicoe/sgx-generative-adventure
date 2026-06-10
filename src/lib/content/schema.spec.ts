import { describe, it, expect } from 'vitest';
import {
	buildSchema,
	conditionSchema,
	displaySettingsSchema,
	effectSchema,
	sceneSchema
} from './schema';
import { placeholderBuild } from '../game/placeholderBuild';

describe('content schema', () => {
	it('accepts the placeholder build (drift check vs engine types)', () => {
		expect(buildSchema.safeParse(placeholderBuild).success).toBe(true);
	});

	it('validates nested/recursive conditions', () => {
		expect(
			conditionSchema.safeParse({
				type: 'and',
				all: [
					{ type: 'hasItem', itemId: 'k' },
					{ type: 'not', cond: { type: 'flag', key: 'x', equals: true } }
				]
			}).success
		).toBe(true);
		expect(conditionSchema.safeParse({ type: 'hasItem' }).success).toBe(false);
	});

	it('accepts known effects and rejects unknown ones', () => {
		expect(effectSchema.safeParse({ type: 'setFlag', key: 'k', value: 1 }).success).toBe(true);
		expect(effectSchema.safeParse({ type: 'explode' }).success).toBe(false);
	});

	it('requires a non-empty scene id', () => {
		expect(
			sceneSchema.safeParse({ id: '', name: 'x', layers: [], hotspots: [], exits: [] }).success
		).toBe(false);
	});

	it('validates display settings (hex colours, mode, opacity range)', () => {
		const base = {
			width: 1280,
			height: 720,
			center: true,
			marginLeft: 0,
			marginTop: 0,
			bg: '#0a0805',
			ui: '#ffb000',
			mode: 'full',
			uiOpacity: 0.74,
			crt: 1
		};
		expect(displaySettingsSchema.safeParse(base).success).toBe(true);
		expect(displaySettingsSchema.safeParse({ ...base, mode: 'gradient' }).success).toBe(true);
		expect(displaySettingsSchema.safeParse({ ...base, mode: 'duotone' }).success).toBe(true);
		expect(displaySettingsSchema.safeParse({ ...base, bg: 'red' }).success).toBe(false);
		expect(displaySettingsSchema.safeParse({ ...base, mode: 'sepia' }).success).toBe(false);
		expect(displaySettingsSchema.safeParse({ ...base, uiOpacity: 2 }).success).toBe(false);
		expect(displaySettingsSchema.safeParse({ ...base, crt: 5 }).success).toBe(false);
		expect(displaySettingsSchema.safeParse({ ...base, fontScale: 1.5 }).success).toBe(true);
		expect(displaySettingsSchema.safeParse({ ...base, fontScale: 3 }).success).toBe(false);
	});
});
