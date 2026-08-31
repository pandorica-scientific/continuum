// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared response shape and the bearer-token gate for /api/v1.

import { verifyToken } from '$lib/server/api/tokens';
import { blockedForSeconds, recordFailure } from '$lib/server/auth/ratelimit';

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

export function readBearerToken(request: Request): string | null {
	const header = request.headers.get('authorization') ?? '';
	const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
	return match?.[1] ?? null;
}

/**
 * Null when the caller is authorised, otherwise the response to return.
 *
 * Failed attempts are rate limited: an endpoint that lets a caller try tokens
 * without limit is a guessing oracle. The budget is the API's own, not the
 * sign-in form's — a dashboard left polling with a revoked token would
 * otherwise spend the household's login attempts and lock them out of the app,
 * and behind a reverse proxy every client shares one address.
 *
 * Successful calls deliberately do NOT clear the counter: that would let a
 * caller reset their guessing budget by interleaving one valid request.
 */
async function requireToken(request: Request, address: string): Promise<Response | null> {
	const wait = blockedForSeconds('api', address);
	if (wait > 0) return apiError('Too many failed attempts.', 429);

	const raw = readBearerToken(request);
	if (await verifyToken(raw)) return null;

	recordFailure('api', address);
	return apiError('Unauthorised.', 401);
}

/** Every path the hook exempts from the sign-in redirect as self-authenticating. */
function isApiPath(pathname: string): boolean {
	return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Apply bearer authentication once for the whole API boundary, and return null
 * for anything outside it so the caller needs no prefix test of its own.
 *
 * The boundary is `/api`, not `/api/v1`. PUBLIC_PATHS exempts the whole `/api`
 * tree from the redirect to /login, so scoping authentication to the versioned
 * prefix meant an `/api/health` or an `/api/v2` added later would ship with no
 * session check and no bearer check — public and unauthenticated. Each endpoint
 * used to call requireToken itself; that per-endpoint backstop is gone, so this
 * has to cover exactly what the exemption covers.
 */
export async function authorizeApiRequest(
	pathname: string,
	request: Request,
	address: string
): Promise<Response | null> {
	if (!isApiPath(pathname)) return null;
	return requireToken(request, address);
}
