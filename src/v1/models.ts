import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { wrapTime } from 'hono/timing';
import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import * as zm from 'zod/mini';
import type { ContextVariables, EnvVars } from '~/types.js';

const app = new OpenAPIHono<{ Bindings: EnvVars; Variables: ContextVariables }>();

const modelCapabilities = z
	.object({
		supported: z.boolean().openapi({ description: 'Whether this capability is supported by the model.' }),
	})
	.openapi('CapabilitySupport');

const ModelInfoSchema = z
	.object({
		type: z.enum(['model']).openapi({ description: 'For Models, this is always "model".' }),
		id: z.string().openapi({ description: 'Unique model identifier.' }),
		display_name: z.string().openapi({ description: 'A human-readable name for the model.' }),
		created_at: z.iso.datetime().openapi({ description: 'RFC 3339 datetime string representing the time at which the model was released. May be set to an epoch value if the release date is unknown.' }),
		max_input_tokens: z.int().nullable().openapi({ description: 'Maximum input context window size in tokens for this model.' }),
		max_tokens: z.int().nullable().openapi({ description: 'Maximum value for the `max_tokens` parameter when using this model.' }),
		capabilities: z
			.object({
				batch: modelCapabilities,
				citations: modelCapabilities,
				code_execution: modelCapabilities,
				context_management: modelCapabilities
					.extend({
						clear_thinking_20251015: modelCapabilities.nullable(),
						clear_tool_uses_20250919: modelCapabilities.nullable(),
						compact_20260112: modelCapabilities.nullable(),
					})
					.openapi('ContextManagementCapability'),
				effort: modelCapabilities
					.extend({
						low: modelCapabilities,
						medium: modelCapabilities,
						high: modelCapabilities,
						xhigh: modelCapabilities.nullable(),
						max: modelCapabilities,
					})
					.openapi('EffortCapability'),
				image_input: modelCapabilities,
				pdf_input: modelCapabilities,
				structured_outputs: modelCapabilities,
				thinking: modelCapabilities
					.extend({
						types: z.object({
							adaptive: modelCapabilities,
							enabled: modelCapabilities,
						}),
					})
					.openapi('ThinkingCapability'),
			})
			.openapi('ModelCapabilities'),
	})
	.openapi('ModelInfo');

const output = z.object({
	data: z.array(ModelInfoSchema),
	first_id: z.string().openapi({ description: 'First ID in the `data` list. Can be used as the `before_id` for the previous page.' }),
	has_more: z.boolean().openapi({ description: 'Indicates if there are more results in the requested page direction.' }),
	last_id: z.string().openapi({ description: 'Last ID in the `data` list. Can be used as the `after_id` for the next page.' }),
});

app.openapi(
	createRoute({
		method: 'get',
		path: '/',
		request: {
			query: z
				.object({
					after_id: z
						.string()
						.startsWith('claude|')
						.refine((model) => {
							const [prefix, cipherText] = model.split('|');

							return prefix && cipherText && zm.base64url().check(zm.trim(), zm.minLength(1)).safeParse(cipherText).success;
						})
						.transform((model) => model.split('|')[1]!)
						.optional()
						.openapi({ description: 'ID of the object to use as a cursor for pagination. When provided, returns the page of results immediately after this object.' }),
					before_id: z
						.string()
						.startsWith('claude|')
						.refine((model) => {
							const [prefix, cipherText] = model.split('|');

							return prefix && cipherText && zm.base64url().check(zm.trim(), zm.minLength(1)).safeParse(cipherText).success;
						})
						.transform((model) => model.split('|')[1]!)
						.optional()
						.openapi({ description: 'ID of the object to use as a cursor for pagination. When provided, returns the page of results immediately before this object.' }),
					limit: z.coerce.number().int().min(1).max(1000).default(20).openapi({ description: 'Number of items to return per page.' }),
				})
				.openapi('ModelListParams'),
		},
		responses: {
			200: {
				content: {
					'application/json': {
						schema: output,
					},
				},
				summary: 'List available models.',
				description: 'The Models API response can be used to determine which models are available for use in the API. More recently released models are listed first.',
			},
		},
	}),
	async (c) => {
		// Have to fetch all text-gen models because binding doesn't have sorting support which would mess up pagination.
		const textGenerationModels = (await wrapTime(c, 'fetch_models', c.env.AI.models({ task: 'Text Generation' }))).filter((model) => 'created_at' in model).sort((a, b) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime());

		const query = c.req.valid('query');
		let startIndex = 0;
		let endIndex = textGenerationModels.length;

		if (query.after_id) {
			const raw = Buffer.from(query.after_id, 'base64url');
			const decipher = createDecipheriv(
				'chacha20-poly1305',
				// Key must be exactly 256 bits/32 bytes for `chacha20-poly1305`
				createHash('sha256').update(c.env.DUMMY_SECRET).digest(),
				raw.subarray(0, 96 / 8),
				{ authTagLength: 16 },
			);
			decipher.setAuthTag(raw.subarray(96 / 8, 96 / 8 + 16));
			const after_id_decrypted = Buffer.concat([decipher.update(raw.subarray(96 / 8 + 16)), decipher.final()]).toString('utf8');

			const afterIndex = textGenerationModels.findIndex((m) => m.name === after_id_decrypted || m.id === after_id_decrypted);
			if (afterIndex === -1) {
				return c.json([]);
			}
			startIndex = afterIndex + 1;
		}

		if (query.before_id) {
			const raw = Buffer.from(query.before_id, 'base64url');
			const decipher = createDecipheriv(
				'chacha20-poly1305',
				// Key must be exactly 256 bits/32 bytes for `chacha20-poly1305`
				createHash('sha256').update(c.env.DUMMY_SECRET).digest(),
				raw.subarray(0, 96 / 8),
				{ authTagLength: 16 },
			);
			decipher.setAuthTag(raw.subarray(96 / 8, 96 / 8 + 16));
			const before_id_decrypted = Buffer.concat([decipher.update(raw.subarray(96 / 8 + 16)), decipher.final()]).toString('utf8');

			const beforeIndex = textGenerationModels.findIndex((m) => m.name === before_id_decrypted || m.id === before_id_decrypted);
			if (beforeIndex === -1) {
				return c.json([]);
			}
			endIndex = beforeIndex;
		}

		const data = textGenerationModels.slice(startIndex, Math.min(startIndex + query.limit, endIndex)).map((model) => {
			const context_window_prop = model.properties.find((property) => property.property_id === 'context_window')?.value;
			const context_window = context_window_prop ? parseInt(context_window_prop, 10) : null;

			const nonce = randomBytes(96 / 8);
			const cipher = createCipheriv(
				'chacha20-poly1305',
				// Key must be exactly 256 bits/32 bytes for `chacha20-poly1305`
				createHash('sha256').update(c.env.DUMMY_SECRET).digest(),
				nonce,
				{ authTagLength: 16 },
			);
			const cipherBuffer = Buffer.concat([cipher.update(model.name, 'utf8'), cipher.final()]);

			return {
				type: 'model',
				id: `claude|${Buffer.concat([nonce, cipher.getAuthTag(), cipherBuffer]).toString('base64url')}`,
				display_name: model.name.split('/').pop() ?? model.name,
				created_at: new Date(model.created_at as string).toISOString(),
				max_input_tokens: context_window ? (!isNaN(context_window) ? context_window : null) : null,
				max_tokens: context_window ? (!isNaN(context_window) ? context_window : null) : null,
				// context_length: context_window ? (!isNaN(context_window) ? context_window : null) : null,
				capabilities: {
					batch: { supported: model.properties.find((property) => property.property_id === 'async_queue')?.value === 'true' },
					citations: { supported: false },
					code_execution: { supported: false },
					context_management: {
						supported: false,
						clear_thinking_20251015: { supported: false },
						clear_tool_uses_20250919: { supported: false },
						compact_20260112: { supported: false },
					},
					effort: {
						supported: model.properties.find((property) => property.property_id === 'reasoning')?.value === 'true',
						low: { supported: model.properties.find((property) => property.property_id === 'reasoning')?.value === 'true' },
						medium: { supported: model.properties.find((property) => property.property_id === 'reasoning')?.value === 'true' },
						high: { supported: model.properties.find((property) => property.property_id === 'reasoning')?.value === 'true' },
						xhigh: { supported: false },
						max: { supported: false },
					},
					image_input: { supported: model.properties.find((property) => property.property_id === 'vision')?.value === 'true' },
					pdf_input: { supported: false },
					structured_outputs: { supported: model.properties.find((property) => property.property_id === 'function_calling')?.value === 'true' },
					thinking: {
						supported: model.properties.find((property) => property.property_id === 'reasoning')?.value === 'true',
						types: {
							enabled: { supported: false },
							adaptive: { supported: model.properties.find((property) => property.property_id === 'reasoning')?.value === 'true' },
						},
					},
				},
			} satisfies z.input<typeof ModelInfoSchema>;
		});

		return c.json({
			data,
			first_id: data[0]!.id,
			has_more: startIndex + query.limit < endIndex,
			last_id: data[data.length - 1]!.id,
		} satisfies z.input<typeof output>);
	},
);

export default app;
