import { describe, expect, it } from 'vitest';
import { authorizeApiRequest, readBearerToken } from '$lib/server/api/respond';

describe('API route-boundary authorization', () => {
	it('fails closed for a newly added /api/v1 endpoint', async () => {
		const request = new Request('http://continuum.test/api/v1/future-resource');
		const refused = await authorizeApiRequest('/api/v1/future-resource', request, '192.0.2.10');

		expect(refused?.status).toBe(401);
		expect(await refused?.json()).toEqual({ error: 'Unauthorised.' });
	});

	// PUBLIC_PATHS exempts the whole '/api' tree from the sign-in redirect, so
	// authentication has to cover the same tree. Scoped to '/api/v1', a health
	// check or a v2 added later would answer anyone with no check at all.
	it('fails closed across the whole /api tree, not just the versioned prefix', async () => {
		for (const pathname of ['/api', '/api/health', '/api/v2/accounts', '/api/internal/debug']) {
			const request = new Request(`http://continuum.test${pathname}`);
			const refused = await authorizeApiRequest(pathname, request, '192.0.2.12');

			expect(refused?.status).toBe(401);
		}
	});

	it('does not apply the API bearer gate to public calendar or enrollment routes', async () => {
		for (const pathname of ['/ics/calendar-token', '/enroll/enrollment-token']) {
			const request = new Request(`http://continuum.test${pathname}`);
			expect(await authorizeApiRequest(pathname, request, '192.0.2.11')).toBeNull();
		}
	});

	it('parses the Bearer authentication scheme case-insensitively', () => {
		for (const scheme of ['Bearer', 'bearer', 'BEARER', 'bEaReR']) {
			const request = new Request('http://continuum.test/api/v1/accounts', {
				headers: { authorization: `${scheme} secret-token` }
			});
			expect(readBearerToken(request)).toBe('secret-token');
		}
	});

	it('rejects a different scheme or an empty bearer value', () => {
		for (const authorization of ['Basic secret-token', 'Bearer', 'Bearer   ']) {
			const request = new Request('http://continuum.test/api/v1/accounts', {
				headers: { authorization }
			});
			expect(readBearerToken(request)).toBeNull();
		}
	});
});
