import type { Context, Env, Input } from 'hono';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { JWTPayload } from 'jose';
import * as jose from 'jose';
import * as zm from 'zod/mini';

export interface JwtVariables {
	jwtPayload: JWTPayload;
}

const ztJwtOptionsSchema = zm.object({
	headerName: zm._default(zm.string().check(zm.minLength(1)), 'Cf-Access-Jwt-Assertion'),
	cookie: zm._default(zm.string().check(zm.minLength(1)), 'CF_Authorization'),
	// SaaS/OIDC Access app's full issuer, which includes the app path (https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client-id>)
	issuer: zm.url({ protocol: /^https$/, hostname: zm.regexes.domain }),
	clientId: zm.hex().check(zm.toLowerCase(), zm.length(64)),
	httpCache: zm.lazy(() => zm.nullable(zm._default(zm.instanceof(Cache), caches.default))),
});

interface ztJwtOptionsSchemaInput<E extends Env, P extends string, I extends Input> extends Omit<zm.input<typeof ztJwtOptionsSchema>, 'issuer' | 'clientId'> {
	// Zod can't do functions directly, so we have to do this workaround
	issuer: string | ((c: Context<E, P, I>) => Promise<string> | string);
	clientId: string | ((c: Context<E, P, I>) => Promise<string> | string);
}

function unauthorizedResponse(opts: { c: Context; error: string; errDescription: string; status?: number; statusText?: string }) {
	return new Response('Unauthorized', {
		status: opts.status ?? 401,
		statusText: opts.statusText ?? 'Unauthorized',
		headers: {
			'WWW-Authenticate': `Bearer realm="${opts.c.req.url}",error="${opts.error}",error_description="${opts.errDescription}"`,
		},
	});
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const ztJwt = <E extends Env = { Variables: JwtVariables }, P extends string = any, I extends Input = {}>(_options: ztJwtOptionsSchemaInput<E, P, I>) => {
	return createMiddleware<{ Variables: JwtVariables }, P, I>((c, next) =>
		zm
			// Omit issuer and clientId so we can re-define them with the Context functions
			.extend(zm.omit(ztJwtOptionsSchema, { issuer: true, clientId: true }), {
				issuer: zm.union([
					// Carry over the original schema for direct string input
					ztJwtOptionsSchema.def.shape.issuer,
					zm
						.pipe(
							// Make sure it's a function and set correct function type
							zm.pipe(
								zm.unknown().check(zm.refine((val) => typeof val === 'function')),
								zm.transform((func) => func as (c: Context<E>) => Promise<string> | string),
							),
							// Call the function to get the value
							// @ts-expect-error Bindings loses type in generics
							zm.transform(async (func) => await func(c)),
						)
						.check(
							// Validate the result of the function with the original schema
							zm.refine((funcVal) => ztJwtOptionsSchema.def.shape.issuer.safeParseAsync(funcVal).then(({ success }) => success)),
						),
				]),
				clientId: zm.union([
					// Carry over the original schema for direct string input
					ztJwtOptionsSchema.def.shape.clientId,
					zm
						.pipe(
							// Make sure it's a function and set correct function type
							zm.pipe(
								zm.unknown().check(zm.refine((val) => typeof val === 'function')),
								zm.transform((func) => func as (c: Context<E>) => Promise<string> | string),
							),
							// Call the function to get the value
							// @ts-expect-error Bindings loses type in generics
							zm.transform(async (func) => await func(c)),
						)
						.check(
							// Validate the result of the function with the original schema
							zm.refine((funcVal) => ztJwtOptionsSchema.def.shape.clientId.safeParseAsync(funcVal).then(({ success }) => success)),
						),
				]),
			})
			.safeParseAsync(_options)
			.then(async ({ success, data: options, error: zError }) => {
				if (success) {
					const bearerToken = c.req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
					const token = c.req.header(options.headerName) ?? bearerToken ?? getCookie(c, options.cookie, 'secure');

					if (token) {
						// Fetches `fetchUrl` through the Workers Cache API, falling back to origin on a miss,
						// and throws the standard 502 if the origin call itself fails. A Workers isolate
						// doesn't reliably persist in-process memory across invocations, so this — not
						// jose's in-memory remote-JWKS cache — is what actually survives between requests.
						const cachedFetchOrThrow = async (fetchUrl: string | URL, step: string): Promise<Response> => {
							const cacheKey = new Request(fetchUrl, { signal: c.req.raw.signal });

							let response = await options.httpCache?.match(cacheKey);

							if (!response) {
								// If not in cache, get it from origin
								response = await fetch(cacheKey);

								// Must use Response constructor to inherit all of response's fields
								response = new Response(response.body, response);

								if (options.httpCache && response.ok) c.executionCtx.waitUntil(options.httpCache.put(cacheKey, response.clone()));
							}

							if (!response.ok) {
								console.error(step, `HTTP ${response.status}: ${response.statusText}`);
								throw new HTTPException(502, {
									message: 'authentication service unavailable',
									res: unauthorizedResponse({ c, error: 'invalid_request', errDescription: 'authentication service unavailable', status: 502, statusText: 'Bad Gateway' }),
								});
							}

							return response;
						};

						// OIDC discovery works the same way for both self-hosted Access apps (issuer ==
						// team root) and SaaS/OIDC Access apps (issuer == team root + /cdn-cgi/access/sso/
						// oidc/<client-id>), so there's no need to special-case the certs endpoint per app type.
						const discoveryUrl = new URL(`${options.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
						const discoveryResponse = await cachedFetchOrThrow(discoveryUrl, 'Failed to fetch OIDC discovery document');
						const { jwks_uri: jwksUri } = await discoveryResponse.json<{ jwks_uri: string }>();

						const jwksResponse = await cachedFetchOrThrow(jwksUri, 'Failed to fetch public certs');
						const JWKS = jose.createLocalJWKSet(await jwksResponse.json<jose.JSONWebKeySet>());

						await jose
							.jwtVerify(token, JWKS, { issuer: options.issuer, audience: options.clientId })
							.then(({ payload }) => c.set('jwtPayload', payload))
							.catch((e) => {
								if (e instanceof Error && e.constructor === Error) {
									throw e;
								}

								throw new HTTPException(401, {
									message: 'Unauthorized',
									res: unauthorizedResponse({
										c,
										error: 'invalid_token',
										statusText: 'Unauthorized',
										errDescription: 'token verification failure',
									}),
									cause: e,
								});
							});

						await next();
					} else {
						const errDescription = 'no authorization included in request';
						throw new HTTPException(401, { message: errDescription, res: unauthorizedResponse({ c, error: 'invalid_request', errDescription }) });
					}
				} else {
					throw new Error(zm.prettifyError(zError));
				}
			}),
	);
};
