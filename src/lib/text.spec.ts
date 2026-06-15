import { describe, it, expect } from 'vitest';
import { textVariants, pickTextVariant } from './text';

describe('textVariants', () => {
	it('returns the whole text when there is no separator', () => {
		expect(textVariants('one line\ntwo line')).toEqual(['one line\ntwo line']);
	});

	it('splits on a dashes-only line and trims blanks', () => {
		expect(textVariants('A\n---\nB\n----\n  C  ')).toEqual(['A', 'B', 'C']);
	});

	it('ignores empty segments (e.g. leading/trailing separators)', () => {
		expect(textVariants('---\nonly\n---')).toEqual(['only']);
	});

	it('is empty for undefined / blank', () => {
		expect(textVariants(undefined)).toEqual([]);
		expect(textVariants('   ')).toEqual([]);
	});

	it('does NOT split on dashes inside a line', () => {
		expect(textVariants('a -- b')).toEqual(['a -- b']);
	});
});

describe('pickTextVariant', () => {
	it('picks by the injected rng', () => {
		const t = 'A\n---\nB\n---\nC';
		expect(pickTextVariant(t, () => 0)).toBe('A');
		expect(pickTextVariant(t, () => 0.5)).toBe('B');
		expect(pickTextVariant(t, () => 0.999)).toBe('C');
	});

	it('returns the text unchanged when there are no variants', () => {
		expect(pickTextVariant('just one')).toBe('just one');
		expect(pickTextVariant(undefined)).toBe('');
	});
});
