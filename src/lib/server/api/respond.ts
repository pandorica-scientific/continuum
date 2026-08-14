// Shared response shape and the bearer-token gate for /api/v1.

import { verifyToken } from '$lib/server/api/tokens';
import { loginBlockedForSeconds, recordLoginFailure } from '$lib/server/auth/ratelimit';

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

/**
 * Null when the caller is authorised, otherwise the response to return.
 *
 * Failed attempts feed the same limiter the login screen uses: an endpoint that
 * lets a caller try tokens without limit is a guessing oracle. Successful calls
 * deliberately do NOT call recordLoginSuccess — that would clear the failure
 * counter for the address, letting a caller reset their guessing budget by
 * interleaving one valid request.
 */
export async function requireToken(request: Request, address: string): Promise<Response | null> {
	const wait = loginBlockedForSeconds(address);
	if (wait > 0) return apiError('Too many failed attempts.', 429);

	const header = request.headers.get('authorization') ?? '';
	const raw = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
	if (await verifyToken(raw)) return null;

	recordLoginFailure(address);
	return apiError('Unauthorised.', 401);
}
