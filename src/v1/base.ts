import { OpenAPIHono } from '@hono/zod-openapi';
import type { oas31 } from 'openapi3-ts';
import type { ContextVariables, EnvVars } from '~/types.js';
import models from '~/v1/models.js';

const app = new OpenAPIHono<{ Bindings: EnvVars; Variables: ContextVariables }>();

const title = 'Workers AI Claude Desktop' as const;
const description = 'Claude Desktop 3P gateway for Workers Ai Models' as const;
const contact: oas31.ContactObject = {
	url: 'https://github.com/demosjarco/workers-ai-claude-desktop/issues',
} as const;

app.doc31('/generate/openapi31', (c) => ({
	openapi: '3.1.0',
	info: {
		title,
		description,
		contact,
		version: 'v1',
	},
	servers: [
		{
			url: c.req.path
				.split('/')
				.splice(0, c.req.path.split('/').length - 2)
				.join('/'),
		},
	],
}));
app.doc('/generate/openapi', (c) => ({
	openapi: '3.0.0',
	info: {
		title,
		description,
		contact,
		version: 'v1',
	},
	servers: [
		{
			url: c.req.path
				.split('/')
				.splice(0, c.req.path.split('/').length - 2)
				.join('/'),
		},
	],
}));
app.doc('/generate/v1.waicd.cf-apig.openapi', (c) => ({
	openapi: '3.0.0',
	info: {
		title,
		description,
		contact,
		version: 'v1',
	},
	servers: [
		{
			url: 'https://waicd.demosjarco.dev',
		},
	],
}));

app.route('/models', models);

export default app;
