// zod schema for the model's structured response (SPEC §5.3). Pure — no SDK or
// env imports, so it is unit-testable and usable on either side of the wire.
import { z } from 'zod';

// We validate SHAPE here. Whether `outcomeId` is one of the behaviour's
// allowedOutcomes is checked in adjudicate.ts (so this schema stays static);
// the model is additionally constrained to the enum at request time in gemini.ts.
export const llmResponseSchema = z.object({
	reply: z.string().min(1),
	outcomeId: z.string().min(1),
	reasoning: z.string().optional()
});

export type LlmResponse = z.infer<typeof llmResponseSchema>;
