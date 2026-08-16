import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// The Google authorisation-code flow, kept apart from the adapter: the adapter
// only ever holds a refresh token, and this is the one place that obtains one.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Read and write the household's own calendars. */
export const SCOPE = 'https://www.googleapis.com/auth/calendar';

export interface PendingAuth {
	clientId: string;
	clientSecret: string;
	/** Hash of the state nonce, not the nonce — see startAuth. */
	stateHash: string;
	redirectUri: string;
}

export interface AuthStart {
	url: string;
	/** Goes in the caller's session or a short-lived cookie. */
	state: string;
	pending: PendingAuth;
}

/**
 * Where to send the browser, and what to remember while it is away.
 *
 * `access_type=offline` is what makes Google return a refresh token at all, and
 * `prompt=consent` is what makes it return one AGAIN on a re-authorisation —
 * without it a second connect yields only an access token and the account
 * silently stops working an hour later.
 *
 * Only the HASH of the state nonce is stored. The value in the URL is public
 * once the browser has it; keeping the raw nonce server-side as well would mean
 * a stored copy of a secret for no benefit.
 */
export function startAuth(clientId: string, clientSecret: string, redirectUri: string): AuthStart {
	const state = randomBytes(24).toString('base64url');
	const url = new URL(AUTH_URL);
	url.searchParams.set('client_id', clientId);
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', SCOPE);
	url.searchParams.set('access_type', 'offline');
	url.searchParams.set('prompt', 'consent');
	url.searchParams.set('state', state);

	return {
		url: url.toString(),
		state,
		pending: {
			clientId,
			clientSecret,
			stateHash: createHash('sha256').update(state).digest('hex'),
			redirectUri
		}
	};
}

/**
 * Whether a returned state matches the one we issued.
 *
 * Compared in constant time and on equal-length digests. The check itself is
 * what stops a third party completing an authorisation on someone else's
 * behalf — the classic CSRF against an OAuth callback.
 */
export function stateMatches(returned: string, expectedHash: string): boolean {
	const digest = createHash('sha256').update(returned).digest();
	const expected = Buffer.from(expectedHash, 'hex');
	if (expected.length !== digest.length) return false;
	return timingSafeEqual(digest, expected);
}

/** Exchange the authorisation code for a refresh token. */
export async function exchangeCode(
	code: string,
	pending: PendingAuth
): Promise<{ ok: true; refreshToken: string } | { ok: false; message: string }> {
	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: pending.clientId,
			client_secret: pending.clientSecret,
			redirect_uri: pending.redirectUri,
			grant_type: 'authorization_code'
		}).toString(),
		signal: AbortSignal.timeout(20_000)
	});

	const payload = (await response.json()) as { refresh_token?: string; error?: string };

	if (payload.error === 'redirect_uri_mismatch') {
		return {
			ok: false,
			message:
				'Google rejected the redirect address. It must match the authorised redirect URI exactly, including http/https and any trailing slash.'
		};
	}
	if (!response.ok) return { ok: false, message: payload.error ?? 'Google refused the code.' };

	// No refresh token usually means Google has one outstanding for this client
	// and did not re-issue it. prompt=consent above is what prevents that, so if
	// it happens the account was authorised by something else.
	if (!payload.refresh_token) {
		return {
			ok: false,
			message:
				'Google returned no refresh token. Remove Continuum at myaccount.google.com/permissions and connect again.'
		};
	}

	return { ok: true, refreshToken: payload.refresh_token };
}
