import type { TimingVariables } from 'hono/timing';
import type { JwtVariables } from '~/ztJwt.js';

export interface EnvVars extends Omit<Cloudflare.Env, ''> {
	GIT_HASH?: string;
	IGNORE_AUTH_LOCAL?: '0' | '1';

	ZT_ISSUER: string;
	ZT_CLIENT_ID: string;
}

export interface ContextVariables extends TimingVariables, JwtVariables {}
