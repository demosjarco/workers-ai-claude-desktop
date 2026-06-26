import { Hono, type Context } from 'hono';
import { except } from 'hono/combine';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { timing } from 'hono/timing';
import type { ContextVariables, EnvVars } from '~/types';
import api1 from '~/v1/base.js';
import { ztJwt } from '~/ztJwt.js';

const app = new Hono<{ Bindings: EnvVars; Variables: ContextVariables }>();

// Variable Setup
// app.use('*', contextStorage());
// app.use('*', async (c, next) => {
// 	await next();
// });

// Security
app.use('*', csrf());
app.use(
	'*',
	except(
		[
			//OpenAPI Schema
			'/:version/generate/openapi',
			// OpenApi 3.1 Schema
			'/:version/generate/openapi31',
			// OpenAPI Schema for CF API Gateway
			'/:version/generate/*.waicd.cf-apig.openapi',
			// eslint-disable-next-line @typescript-eslint/no-empty-object-type
			(c: Context<{ Bindings: EnvVars; Variables: ContextVariables }, '*', {}>) => 'IGNORE_AUTH_LOCAL' in c.env && Boolean(parseInt(c.env.IGNORE_AUTH_LOCAL!, 10)) && !('GIT_HASH' in c.env),
		],
		ztJwt<{ Bindings: EnvVars; Variables: ContextVariables }>({
			clientId: (c) => c.env.ZT_CLIENT_ID,
			issuer: (c) => c.env.ZT_ISSUER,
		}),
	),
);
app.use('*', cors({ origin: '*', maxAge: 300 }));

// Debug
app.use('*', timing());

app.route('/v1', api1);

export default app;
