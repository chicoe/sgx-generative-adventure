// Server-only Gemini wrapper (SPEC §5). Imports `$env/dynamic/private`, which
// makes SvelteKit fail the build if this is ever pulled into the client bundle.
//
// Backend-agnostic via the @google/genai SDK:
//   - 'developer': Gemini Developer API, needs GEMINI_API_KEY (has a free tier).
//   - 'vertex':    Vertex AI, uses Application Default Credentials (no key) —
//                  automatic on Firebase App Hosting; needs a GCP project.
// Selected by GEMINI_BACKEND, else auto-detected from what's configured.
import { GoogleGenAI, Type, type Schema } from '@google/genai';
import { env } from '$env/dynamic/private';
import type { ConversationTurn, LLMBehaviour } from '../engine/types';
import { buildPrompt, type SceneContext } from './prompt';
import { llmResponseSchema, type LlmResponse } from './outcome';

const TIMEOUT_MS = 12000;
const MAX_ATTEMPTS = 2; // one retry on transient failure before the fallback
const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

type Backend = 'developer' | 'vertex';

function selectBackend(): Backend | null {
	const explicit = env.GEMINI_BACKEND?.toLowerCase();
	if (explicit === 'vertex') return 'vertex';
	if (explicit === 'developer') return env.GEMINI_API_KEY ? 'developer' : null;
	// Auto: prefer an explicit key, else Vertex if a project is configured.
	if (env.GEMINI_API_KEY) return 'developer';
	if (env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT) return 'vertex';
	return null;
}

/** Whether a usable Gemini backend is configured. When false, callers fall back. */
export function isConfigured(): boolean {
	return selectBackend() !== null;
}

function makeClient(backend: Backend): GoogleGenAI {
	if (backend === 'vertex') {
		return new GoogleGenAI({
			vertexai: true,
			project: env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT,
			location: env.GOOGLE_CLOUD_LOCATION ?? 'us-central1'
		});
	}
	return new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
}

function responseSchema(outcomeIds: string[]): Schema {
	return {
		type: Type.OBJECT,
		properties: {
			reply: { type: Type.STRING },
			outcomeId: { type: Type.STRING, enum: outcomeIds },
			reasoning: { type: Type.STRING }
		},
		required: ['reply', 'outcomeId'],
		propertyOrdering: ['reply', 'outcomeId', 'reasoning']
	};
}

/**
 * Ask the model for an in-character reply + a chosen outcomeId, constrained to
 * the behaviour's allowed ids. Throws on missing config, timeout, transport
 * error, or schema-invalid output — the endpoint converts that into the
 * deterministic fallback (SPEC §5.4).
 */
export async function generateLlmResponse(
	behaviour: LLMBehaviour,
	history: ConversationTurn[],
	playerMessage: string,
	scene?: SceneContext,
	opening = false
): Promise<LlmResponse> {
	const backend = selectBackend();
	if (!backend) throw new Error('Gemini is not configured');

	const ai = makeClient(backend);
	const model = env.GEMINI_MODEL || DEFAULT_MODEL;
	const { systemInstruction, userPrompt } = buildPrompt(
		behaviour,
		history,
		playerMessage,
		scene,
		opening
	);
	const config = {
		systemInstruction,
		responseMimeType: 'application/json',
		responseSchema: responseSchema(behaviour.allowedOutcomes.map((o) => o.id)),
		temperature: 0.8
	};

	let lastErr: unknown;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			const res = await ai.models.generateContent({
				model,
				contents: userPrompt,
				config: { ...config, abortSignal: AbortSignal.timeout(TIMEOUT_MS) }
			});
			const text = res.text;
			if (!text) throw new Error('Empty response from Gemini');
			return llmResponseSchema.parse(JSON.parse(stripFences(text)));
		} catch (err) {
			lastErr = err;
			if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 400));
		}
	}
	throw lastErr;
}

/** Tolerate ```json ... ``` fences some models add despite responseMimeType. */
function stripFences(text: string): string {
	const t = text.trim();
	return t.startsWith('```')
		? t
				.replace(/^```(?:json)?/i, '')
				.replace(/```$/, '')
				.trim()
		: t;
}
