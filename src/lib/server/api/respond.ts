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
 * Failed attempts are rate limited under the API's own budget, not the
 * sign-in form's, so a dashboard polling with a revoked token can't lock the
 * household out of the app. Successful calls deliberately do not clear the
 * counter, or a caller could reset their guessing budget by interleaving one
 * valid request.
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
 * The boundary is `/api`, not `/api/v1`: PUBLIC_PATHS exempts the whole `/api`
 * tree from the /login redirect, so authentication has to cover exactly that
 * same prefix or a route added later ships unauthenticated.
 */
export async function authorizeApiRequest(
	pathname: string,
	request: Request,
	address: string
): Promise<Response | null> {
	if (!isApiPath(pathname)) return null;
	return requireToken(request, address);
}
