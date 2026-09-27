import { describe, expect, it, vi } from 'vitest';

// Access is decided at the boundary from what the token row says, so the row is
// all this suite needs to stand in for.
const GRANTS: Record<string, { access: 'read' | 'read-write'; areas: string[] | null }> = {
	reader: { access: 'read', areas: null },
	writer: { access: 'read-write', areas: null },
	// A travel planner: writes trips, reaches nothing else.
	planner: { access: 'read-write', areas: ['trips'] },
	// Limited to an empty list: reaches nothing, never everything.
	emptied: { access: 'read', areas: [] }
};

vi.mock('$lib/server/api/tokens', () => ({
	verifyToken: vi.fn(async (raw: string | null) => (raw ? (GRANTS[raw] ?? null) : null))
}));

const { authorizeApiRequest } = await import('$lib/server/api/respond');

function call(method: string, pathname: string, token: string, locals?: { apiToken?: unknown }) {
	const request = new Request(`http://continuum.test${pathname}`, {
		method,
		headers: { authorization: `Bearer ${token}` }
	});
	return authorizeApiRequest(pathname, request, '192.0.2.40', locals as never);
}

describe('what a read-only token may do', () => {
	it('reads the endpoints it always could', async () => {
		expect(await call('GET', '/api/v1/networth', 'reader')).toBeNull();
		expect(await call('HEAD', '/api/v1/accounts', 'reader')).toBeNull();
	});

	it('is refused every write, including on an endpoint added later', async () => {
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
			const refused = await call(method, '/api/v1/future-resource', 'reader');
			expect(refused?.status).toBe(403);
			expect(await refused?.json()).toMatchObject({ error: expect.stringMatching(/read-only/) });
		}
	});

	// The two kinds of token see the same data; they differ only in writing.
	it('reads every table, as a read-write token does', async () => {
		for (const pathname of ['/api/v1/tables', '/api/v1/tables/trip']) {
			expect(await call('GET', pathname, 'reader')).toBeNull();
		}
		expect((await call('POST', '/api/v1/tables/trip', 'reader'))?.status).toBe(403);
	});
});

describe('what a read-write token may do', () => {
	it('writes and reads raw tables', async () => {
		expect(await call('POST', '/api/v1/tables/trip', 'writer')).toBeNull();
		expect(await call('DELETE', '/api/v1/tables/trip', 'writer')).toBeNull();
		expect(await call('GET', '/api/v1/tables', 'writer')).toBeNull();
	});
});

describe('an unknown token', () => {
	it('is unauthorised whatever it asks for', async () => {
		expect((await call('GET', '/api/v1/networth', 'stranger'))?.status).toBe(401);
		expect((await call('POST', '/api/v1/tables/trip', 'stranger'))?.status).toBe(401);
	});
});

describe('a token limited to some areas', () => {
	it('reads and writes the tables in its areas', async () => {
		for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
			expect(await call(method, '/api/v1/tables/trip_idea', 'planner')).toBeNull();
		}
	});

	it('is refused every table outside them, including the shared ones', async () => {
		for (const pathname of [
			'/api/v1/tables/salary_entry',
			'/api/v1/tables/person',
			'/api/v1/tables/tag_link',
			'/api/v1/tables/no_such_table'
		]) {
			const refused = await call('GET', pathname, 'planner');
			expect(refused?.status, pathname).toBe(403);
			expect(await refused?.json()).toMatchObject({ error: expect.stringMatching(/trips only/) });
		}
	});

	it('is refused the curated endpoints outside its areas, and any endpoint nobody placed', async () => {
		for (const pathname of ['/api/v1/accounts', '/api/v1/networth', '/api/v1/future-resource']) {
			expect((await call('GET', pathname, 'planner'))?.status, pathname).toBe(403);
		}
	});

	// The table list and files answer row by row, so the boundary lets them
	// through and hands the handler the grant to check each row against.
	it('reaches the table list and files, carrying its grant to the handler', async () => {
		const locals: { apiToken?: unknown } = {};
		expect(await call('GET', '/api/v1/tables', 'planner', locals)).toBeNull();
		expect(locals.apiToken).toEqual(GRANTS.planner);
		expect(await call('POST', '/api/v1/files', 'planner')).toBeNull();
		expect(
			await call('DELETE', '/api/v1/files/0190a000-0000-7000-8000-000000000000', 'planner')
		).toBeNull();
	});

	it('reaches nothing with an empty list', async () => {
		expect((await call('GET', '/api/v1/tables/trip', 'emptied'))?.status).toBe(403);
		expect((await call('GET', '/api/v1/accounts', 'emptied'))?.status).toBe(403);
	});
});
