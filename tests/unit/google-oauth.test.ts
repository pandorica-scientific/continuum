import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchangeCode, startAuth, stateMatches } from '$lib/server/calendar/sync/google-oauth';

const REDIRECT = 'https://continuum.example.test/settings/google/callback';

afterEach(() => vi.unstubAllGlobals());

describe('starting the flow', () => {
	const started = startAuth('cid', 'secret', REDIRECT);
	const url = new URL(started.url);

	// Without access_type=offline Google returns only an access token, and the
	// connection stops working an hour later with nothing to renew it.
	it('asks for offline access so a refresh token comes back at all', () => {
		expect(url.searchParams.get('access_type')).toBe('offline');
	});

	// Without prompt=consent a SECOND authorisation returns no refresh token,
	// because Google considers one already granted — so reconnecting a broken
	// account silently produces another broken account.
	it('forces the consent screen so reconnecting works too', () => {
		expect(url.searchParams.get('prompt')).toBe('consent');
	});

	it('asks for the calendar scope and nothing else', () => {
		expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar');
	});

	it('sends the redirect it will be checked against', () => {
		expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
	});

	it('issues a state nonce', () => {
		expect(started.state.length).toBeGreaterThan(20);
		expect(url.searchParams.get('state')).toBe(started.state);
	});

	// The nonce is public the moment the browser holds it; storing only its hash
	// means there is no second copy of a secret sitting in a session.
	it('remembers only the hash of the nonce', () => {
		expect(started.pending.stateHash).not.toBe(started.state);
		expect(started.pending.stateHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('issues a different nonce every time', () => {
		expect(startAuth('cid', 'secret', REDIRECT).state).not.toBe(
			startAuth('cid', 'secret', REDIRECT).state
		);
	});
});

describe('checking the returned state', () => {
	const started = startAuth('cid', 'secret', REDIRECT);

	it('accepts the nonce it issued', () => {
		expect(stateMatches(started.state, started.pending.stateHash)).toBe(true);
	});

	// The check is what stops someone completing an authorisation on another
	// person's behalf.
	it('rejects a nonce it did not issue', () => {
		expect(stateMatches('something-else', started.pending.stateHash)).toBe(false);
	});

	it('rejects an empty or malformed expectation rather than passing it', () => {
		expect(stateMatches(started.state, '')).toBe(false);
		expect(stateMatches(started.state, 'not-hex')).toBe(false);
	});
});

describe('exchanging the code', () => {
	const pending = startAuth('cid', 'secret', REDIRECT).pending;

	function stub(status: number, body: unknown) {
		vi.stubGlobal(
			'fetch',
			async () =>
				new Response(JSON.stringify(body), {
					status,
					headers: { 'content-type': 'application/json' }
				})
		);
	}

	it('returns the refresh token', async () => {
		stub(200, { refresh_token: 'r1', access_token: 'a1' });
		expect(await exchangeCode('code', pending)).toEqual({ ok: true, refreshToken: 'r1' });
	});

	// The second most common setup failure after the publishing status, and
	// Google's own message does not say what to compare.
	it('explains a redirect_uri_mismatch rather than passing it through', async () => {
		stub(400, { error: 'redirect_uri_mismatch' });
		const result = await exchangeCode('code', pending);
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.message).toMatch(/match.*redirect/i);
	});

	// A 200 with no refresh token is the trap: it looks like success, and the
	// account would be stored and then fail an hour later.
	it('refuses a response carrying no refresh token', async () => {
		stub(200, { access_token: 'a1' });
		const result = await exchangeCode('code', pending);
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.message).toMatch(/permissions/i);
	});

	it('reports any other refusal', async () => {
		stub(400, { error: 'invalid_grant' });
		const result = await exchangeCode('code', pending);
		expect(result.ok).toBe(false);
	});
});
