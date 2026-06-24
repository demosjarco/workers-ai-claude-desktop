import { Hono } from 'hono';
import { timing } from 'hono/timing';
import type { ContextVariables, EnvVars } from '~/types';
import api1 from '~/v1/base.js';

const app = new Hono<{ Bindings: EnvVars; Variables: ContextVariables }>();

// Variable Setup
// app.use('*', contextStorage());
// app.use('*', async (c, next) => {
// 	await next();
// });

// Debug
app.use('*', timing());

app.route('/v1', api1);

export default app;
