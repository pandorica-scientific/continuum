// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared response shape and the bearer-token gate for /api.

import { verifyToken } from '$lib/server/api/tokens';
import { tableReach, tableReadReach } from '$lib/server/api/tables';
import { reaches, reachOfPath, type ApiGrant } from '$lib/server/api/areas';
import { describeReach } from '$lib/api/areas';
import { blockedForSeconds, recordFailure } from '$lib/server/auth/ratelimit';
import { ApiError } from './errors';

export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			// A dashboard polling every minute should see current data, not an
			// intermediary's copy.
			'cache-control': 'no-store'
		}
	});
}

export function apiError(message: string, status: number): Response {
	return json({ error: message }, status);
}

/** A refusal the caller can act on becomes its status; anything else is a 500. */
export async function answering(work: () => Promise<Response>): Promise<Response> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof ApiError) return apiError(error.message, error.status);
		throw error;
	}
}

export function readBearerToken(request: Request): string | null {
	const header = request.headers.get('authorization') ?? '';
	const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
	return match?.[1] ?? null;
}

/**
 * The methods a read-only token may use. Everything else is a write, so a
 * method nobody thought about is refused rather than let through.
 */
const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * The path as the router matched it. SvelteKit decodes each segment before
 * routing, so `/api/v1/tables/%74rip` is the `trip` table, and the area has
 * to be read from the same spelling or it is read from a different table.
 * `%25` stays encoded, as the router leaves it.
 */
function routedPath(pathname: string): string {
	try {
		return pathname.split('%25').map(decodeURI).join('%25');
	} catch {
		return pathname;
	}
}

/**
 * Null when the caller is authorised, otherwise the response to return.
 *
 * Failed attempts are rate limited under the API's own budget, not the
 * sign-in form's, so a dashboard polling with a revoked token can't lock the
 * household out of the app. Successful calls deliberately do not clear the
 * counter, or a caller could reset their guessing budget by interleaving one
 * valid request.
 *
 * Access is decided here, at the boundary, rather than in each handler — the
 * same reason authentication is: a write endpoint added later is refused to a
 * read-only token without having to remember to ask. Reading is the same for
 * both: the two differ only in whether they may change anything. A read-only
 * token asking to write is a known token, so it is not counted as a failed
 * attempt.
 */
async function requireToken(
	pathname: string,
	request: Request,
	address: string,
	locals: { apiToken?: ApiGrant }
): Promise<Response | null> {
	const wait = blockedForSeconds('api', address);
	if (wait > 0) return apiError('Too many failed attempts.', 429);

	const raw = readBearerToken(request);
	const grant = await verifyToken(raw);
	if (grant === null) {
		recordFailure('api', address);
		return apiError('Unauthorised.', 401);
	}
	if (grant.access !== 'read-write' && !READ_METHODS.has(request.method)) {
		return apiError(
			'This token is read-only; an administrator can make it read-write in Settings → API tokens.',
			403
		);
	}
	// The same reasoning for areas: decided here, so an endpoint added later is
	// refused to a limited token without its handler having to ask. The two
	// routes that answer row by row (the table list, files) get the grant and
	// check each row themselves. A table another area reads part of is read
	// with that area and written only with the table's own.
	const reach = reachOfPath(
		routedPath(pathname),
		READ_METHODS.has(request.method) ? tableReadReach : tableReach
	);
	if (reach !== null && !reaches(grant, reach)) {
		return apiError(
			`This token reaches ${describeReach(grant.areas ?? [])} only; an administrator can widen it in Settings → API tokens.`,
			403
		);
	}
	locals.apiToken = grant;
	return null;
}

/** Every path the hook exempts from the sign-in redirect as self-authenticating. */
export function isApiPath(pathname: string): boolean {
	return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Whether a request is under the API boundary: by its path, or by the route it
 * reached. The two differ only for a path spelled with escapes — `/%61pi/v1/…`
 * is not `/api` to a prefix test, and is the `/api/v1/…` route to the router.
 * Either one is enough, so no spelling reaches an API handler past the token
 * check.
 */
export function isApiRequest(pathname: string, routeId: string | null): boolean {
	return isApiPath(pathname) || (routeId !== null && isApiPath(routeId));
}

/**
 * Apply bearer authentication once for the whole API boundary, and return null
 * for anything outside it so the caller needs no prefix test of its own.
 *
 * The boundary is `/api`, not `/api/v1`: PUBLIC_PATHS exempts the whole `/api`
 * tree from the /login redirect, so authentication has to cover exactly that
 * same prefix or a route added later ships unauthenticated.
 */
export async function authorizeApiRequest(
	pathname: string,
	routeId: string | null,
	request: Request,
	address: string,
	locals: { apiToken?: ApiGrant }
): Promise<Response | null> {
	if (!isApiRequest(pathname, routeId)) return null;
	return requireToken(pathname, request, address, locals);
}

/**
 * The grant the boundary put on `locals`, for a handler that checks row by
 * row. Throws rather than defaulting: a handler under /api reached without
 * one means the boundary did not run, and "everything" is the wrong guess.
 */
export function grantOf(locals: { apiToken?: ApiGrant }): ApiGrant {
	if (!locals.apiToken) throw new Error('An /api handler ran without the token boundary.');
	return locals.apiToken;
}
