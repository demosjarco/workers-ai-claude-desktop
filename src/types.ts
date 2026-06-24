import type { TimingVariables } from 'hono/timing';

export interface EnvVars extends Omit<Cloudflare.Env, ''> {
	GIT_HASH?: string;
}

export interface ContextVariables extends TimingVariables {}
