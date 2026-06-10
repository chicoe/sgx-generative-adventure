// zod schemas for every content type (SPEC §4), mirroring engine/types.ts.
// Used to validate Firestore documents and editor drafts. Pure (zod only, no
// Svelte/Firebase) so it stays in the unit-testable core alongside the engine.
//
// types.ts is the hand-written source of truth for the TS types (the engine
// must stay zod-free); these schemas are kept parallel and drift-checked by a
// test that parses the real placeholderBuild.
import { z } from 'zod';
import type { Condition } from '../engine/types';

export const flagValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
	z.union([
		z.object({ type: z.literal('hasItem'), itemId: z.string().min(1) }),
		z.object({ type: z.literal('flag'), key: z.string().min(1), equals: flagValueSchema }),
		z.object({ type: z.literal('and'), all: z.array(conditionSchema) }),
		z.object({ type: z.literal('or'), any: z.array(conditionSchema) }),
		z.object({ type: z.literal('not'), cond: conditionSchema })
	])
);

export const effectSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('setFlag'), key: z.string().min(1), value: flagValueSchema }),
	z.object({ type: z.literal('addItem'), itemId: z.string().min(1) }),
	z.object({ type: z.literal('removeItem'), itemId: z.string().min(1) }),
	z.object({ type: z.literal('goToScene'), sceneId: z.string().min(1) }),
	z.object({ type: z.literal('showText'), text: z.string() })
]);

export const filterSpecSchema = z.object({
	css: z.string().optional(),
	blendMode: z.string().optional(),
	overlay: z.string().optional()
});

export const sceneLayerSchema = z.object({
	id: z.string().min(1),
	imagePath: z.string(),
	z: z.number(),
	parallaxFactor: z.number()
});

export const hotspotSchema = z.object({
	id: z.string().min(1),
	label: z.string(),
	effects: z.array(effectSchema).optional(),
	goToSceneId: z.string().optional(),
	behaviourId: z.string().optional(),
	condition: conditionSchema.optional()
});

export const exitSchema = z.object({
	id: z.string().min(1),
	toSceneId: z.string().min(1),
	label: z.string(),
	condition: conditionSchema.optional()
});

export const giveableItemSchema = z.object({
	itemId: z.string().min(1),
	chance: z.number().min(0).max(1)
});

export const sceneSchema = z.object({
	id: z.string().min(1),
	name: z.string(),
	layers: z.array(sceneLayerSchema),
	filter: filterSpecSchema.optional(),
	hotspots: z.array(hotspotSchema),
	exits: z.array(exitSchema),
	onEnter: z.array(effectSchema).optional(),
	introText: z.string().optional(),
	prompt: z.string().optional(),
	giveableItems: z.array(giveableItemSchema).optional(),
	start: z.boolean().optional(),
	ending: z.boolean().optional()
});

export const itemSchema = z.object({
	id: z.string().min(1),
	name: z.string(),
	iconPath: z.string(),
	description: z.string()
});

export const outcomeSchema = z.object({
	id: z.string().min(1),
	label: z.string(),
	granted: z.boolean(),
	effects: z.array(effectSchema)
});

export const llmBehaviourSchema = z.object({
	id: z.string().min(1),
	name: z.string(),
	systemPrompt: z.string(),
	goal: z.string(),
	guardrails: z.array(z.string()),
	allowedOutcomes: z.array(outcomeSchema).min(1),
	maxTurns: z.number().optional(),
	onGrantedEffects: z.array(effectSchema),
	onDeniedEffects: z.array(effectSchema).optional()
});

export const displaySettingsSchema = z.object({
	width: z.number().int().min(160).max(7680),
	height: z.number().int().min(160).max(4320),
	center: z.boolean(),
	marginLeft: z.number().int().min(0).max(4320),
	marginTop: z.number().int().min(0).max(4320),
	bg: z.string().regex(/^#[0-9a-fA-F]{6}$/),
	ui: z.string().regex(/^#[0-9a-fA-F]{6}$/),
	mode: z.enum(['full', 'gradient', 'duotone']),
	uiOpacity: z.number().min(0).max(1),
	crt: z.number().min(0).max(1),
	invertUi: z.boolean().optional()
});

export const buildMetaSchema = z.object({
	version: z.number(),
	publishedAt: z.string(),
	startSceneId: z.string().min(1),
	defaultBehaviourId: z.string().optional(),
	display: displaySettingsSchema.optional()
});

export const buildSchema = z.object({
	meta: buildMetaSchema,
	scenes: z.array(sceneSchema),
	items: z.array(itemSchema),
	behaviours: z.array(llmBehaviourSchema)
});
