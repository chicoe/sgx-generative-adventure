import { describe, it, expect } from 'vitest';
import { llmResponseSchema } from './outcome';

describe('llmResponseSchema', () => {
	it('accepts a well-formed response', () => {
		const r = llmResponseSchema.parse({ reply: 'No.', outcomeId: 'deny', reasoning: 'rules' });
		expect(r.outcomeId).toBe('deny');
	});

	it('accepts without the optional reasoning', () => {
		expect(llmResponseSchema.parse({ reply: 'Ok', outcomeId: 'grant' }).reasoning).toBeUndefined();
	});

	it('rejects an empty reply', () => {
		expect(llmResponseSchema.safeParse({ reply: '', outcomeId: 'deny' }).success).toBe(false);
	});

	it('rejects a missing outcomeId', () => {
		expect(llmResponseSchema.safeParse({ reply: 'hi' }).success).toBe(false);
	});
});
