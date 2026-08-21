// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { csrfRefusal, sameSiteFormPost } from '$lib/server/auth/csrf';

const post = (headers: Record<string, string>, method = 'POST') =>
	new Request('http://continuum.local/login', {
		method,
		headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
		body: method === 'GET' || method === 'HEAD' ? undefined : 'a=1'
	});

describe('sameSiteFormPost', () => {
	it('allows a form post whose origin matches the host it was sent to', () => {
		expect(
			sameSiteFormPost(post({ origin: 'http://continuum.local', host: 'continuum.local' }))
		).toBe(true);
	});

	// The whole point of the part: one instance, many addresses, all of them fine.
	it('allows the same address reached by IP or by name', () => {
		expect(sameSiteFormPost(post({ origin: 'http://192.168.1.40', host: '192.168.1.40' }))).toBe(
			true
		);
		expect(sameSiteFormPost(post({ origin: 'http://localhost', host: 'localhost' }))).toBe(true);
		expect(
			sameSiteFormPost(
				post({ origin: 'https://continuum.tail1234.ts.net', host: 'continuum.tail1234.ts.net' })
			)
		).toBe(true);
	});

	it('allows a port, as long as both carry it', () => {
		expect(
			sameSiteFormPost(post({ origin: 'http://localhost:4173', host: 'localhost:4173' }))
		).toBe(true);
	});

	it('refuses a cross-site form post', () => {
		expect(sameSiteFormPost(post({ origin: 'https://evil.com', host: 'continuum.local' }))).toBe(
			false
		);
	});

	it('refuses a form post carrying no origin at all', () => {
		expect(sameSiteFormPost(post({ host: 'continuum.local' }))).toBe(false);
	});

	it('prefers x-forwarded-host, which is where a proxy puts the browsed address', () => {
		expect(
			sameSiteFormPost(
				post({
					origin: 'https://continuum.tail1234.ts.net',
					host: 'localhost:3000',
					'x-forwarded-host': 'continuum.tail1234.ts.net'
				})
			)
		).toBe(true);
	});

	it('leaves safe methods alone', () => {
		expect(sameSiteFormPost(post({ origin: 'https://evil.com', host: 'x' }, 'GET'))).toBe(true);
		expect(sameSiteFormPost(post({ origin: 'https://evil.com', host: 'x' }, 'HEAD'))).toBe(true);
	});

	// A cross-origin JSON post needs CORS permission the browser will not give,
	// so it is not the hole this guards. The /api boundary has its own bearer check.
	it('leaves non-form content types alone', () => {
		const json = new Request('http://continuum.local/api/v1/x', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				origin: 'https://evil.com',
				host: 'continuum.local'
			},
			body: '{}'
		});
		expect(sameSiteFormPost(json)).toBe(true);
	});

	it('refuses a malformed origin rather than trusting it', () => {
		expect(sameSiteFormPost(post({ origin: 'not a url', host: 'continuum.local' }))).toBe(false);
	});

	it('refuses when the host header is missing, which nothing legitimate omits', () => {
		expect(sameSiteFormPost(post({ origin: 'http://continuum.local' }))).toBe(false);
	});
});

describe('csrfRefusal', () => {
	it('is a page, not a file the browser saves', async () => {
		const response = csrfRefusal(post({ origin: 'https://evil.com', host: 'continuum.local' }));
		expect(response.status).toBe(403);
		expect(response.headers.get('content-type')).toMatch(/text\/html/);
	});

	it('names both addresses, because the mismatch is the problem', async () => {
		const body = await csrfRefusal(
			post({ origin: 'http://192.168.1.40', host: 'continuum.local' })
		).text();
		expect(body).toContain('192.168.1.40');
		expect(body).toContain('continuum.local');
	});

	it('escapes what it echoes', async () => {
		const body = await csrfRefusal(
			post({ origin: 'http://x"><script>alert(1)</script>', host: 'continuum.local' })
		).text();
		expect(body).not.toContain('<script>alert(1)</script>');
		expect(body).toContain('&lt;script&gt;');
	});
});
