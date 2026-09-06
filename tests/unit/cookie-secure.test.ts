// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { cookieSecure, requestIsSecure, withRequest } from '$lib/server/auth/cookies';

describe('requestIsSecure', () => {
	it('is true only when a proxy says the browser used https', () => {
		expect(
			requestIsSecure(new Request('http://x/', { headers: { 'x-forwarded-proto': 'https' } }))
		).toBe(true);
		expect(
			requestIsSecure(new Request('http://x/', { headers: { 'x-forwarded-proto': 'http' } }))
		).toBe(false);
		// No forwarded header: the browser reached the container's port directly,
		// which is plain http whatever the instance's own address is.
		expect(requestIsSecure(new Request('http://x/', { headers: { host: '192.168.1.40' } }))).toBe(
			false
		);
	});
});

describe('cookieSecure', () => {
	it('follows the request it is called inside', async () => {
		const https = new Request('http://x/', { headers: { 'x-forwarded-proto': 'https' } });
		const lan = new Request('http://x/', { headers: { host: '192.168.1.40' } });
		expect(await withRequest(https, async () => cookieSecure())).toBe(true);
		// A LAN sign-in must not get a Secure cookie the browser will drop, even
		// while the instance also has an https address through a proxy.
		expect(await withRequest(lan, async () => cookieSecure())).toBe(false);
	});

	it('survives an await inside the request', async () => {
		const https = new Request('http://x/', { headers: { 'x-forwarded-proto': 'https' } });
		const result = await withRequest(https, async () => {
			await new Promise((r) => setTimeout(r, 1));
			return cookieSecure();
		});
		expect(result).toBe(true);
	});
});
