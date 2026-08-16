import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCalDavProvider } from '$lib/server/calendar/sync/icloud';
import { calendarProviderKinds } from '$lib/server/calendar/sync/provider';
import { toIcs } from '$lib/server/calendar/sync/ical';
import type { EventSeries } from '$lib/server/calendar/series';

const config = {
	username: 'someone@icloud.com',
	password: 'app-specific',
	host: 'https://caldav.example.test',
	calendarUrl: '/123/calendars/home/'
};

const series: EventSeries = {
	uid: 'evt-1',
	title: 'Dentist',
	notes: null,
	category: null,
	allDay: false,
	startsAt: '2026-09-10T09:00:00.000Z',
	endsAt: '2026-09-10T10:00:00.000Z',
	tz: 'Europe/Prague',
	rrule: null,
	exceptions: [],
	updatedAt: '2026-09-01T00:00:00.000Z'
};

/** Stub fetch with a handler over (url, init). */
function stubFetch(
	handler: (
		url: string,
		init: RequestInit
	) => { status?: number; body?: string; headers?: Record<string, string> }
) {
	vi.stubGlobal('fetch', async (url: string | URL, init: RequestInit = {}) => {
		const result = handler(String(url), init);
		return new Response(result.body ?? '', {
			status: result.status ?? 200,
			headers: result.headers ?? {}
		});
	});
}

afterEach(() => vi.unstubAllGlobals());

describe('authentication', () => {
	it('sends the app-specific password as basic auth', async () => {
		let seen = '';
		stubFetch((_url, init) => {
			seen = String((init.headers as Record<string, string>)?.Authorization ?? '');
			return { body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>' };
		});
		await makeCalDavProvider(config).probe();
		const decoded = Buffer.from(seen.replace('Basic ', ''), 'base64').toString();
		expect(decoded).toBe('someone@icloud.com:app-specific');
	});

	// The single most common setup mistake, and a bare 401 gives no hint.
	it('says what a 401 usually means', async () => {
		stubFetch(() => ({ status: 401 }));
		const result = await makeCalDavProvider(config).probe();
		expect(result.ok).toBe(false);
		expect(result.detail).toMatch(/app-specific password/i);
	});

	it('reports a connection failure rather than throwing', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new Error('getaddrinfo ENOTFOUND');
		});
		const result = await makeCalDavProvider(config).probe();
		expect(result.ok).toBe(false);
		expect(result.detail).toContain('ENOTFOUND');
	});
});

describe('discovery', () => {
	// Shaped like iCloud's actual answers. My first fixture returned only the
	// property and no resource href, which hid the bug below entirely: a
	// PROPFIND response ALWAYS opens with an href naming the resource that was
	// asked about, and only then carries the answer.
	const principalResponse = `<?xml version="1.0"?>
<multistatus xmlns="DAV:">
	<response>
		<href>/</href>
		<propstat>
			<prop><current-user-principal><href>/123456789/principal/</href></current-user-principal></prop>
			<status>HTTP/1.1 200 OK</status>
		</propstat>
	</response>
</multistatus>`;

	const homeResponse = `<?xml version="1.0"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
	<response>
		<href>/123456789/principal/</href>
		<propstat>
			<prop><C:calendar-home-set><href>/123456789/calendars/</href></C:calendar-home-set></prop>
			<status>HTTP/1.1 200 OK</status>
		</propstat>
	</response>
</multistatus>`;

	const collections = `<?xml version="1.0"?>
<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
	<response>
		<href>/123456789/calendars/</href>
		<propstat><prop><resourcetype><collection/></resourcetype></prop></propstat>
	</response>
	<response>
		<href>/123456789/calendars/home/</href>
		<propstat><prop>
			<displayname>Home</displayname>
			<resourcetype><collection/><C:calendar/></resourcetype>
			<C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
		</prop></propstat>
	</response>
	<response>
		<href>/123456789/calendars/tasks/</href>
		<propstat><prop>
			<displayname>Reminders</displayname>
			<resourcetype><collection/><C:calendar/></resourcetype>
			<C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>
		</prop></propstat>
	</response>
</multistatus>`;

	/** Answers each PROPFIND by what it asked for, as a real server does. */
	function stubDiscovery(seen: string[] = []) {
		stubFetch((url, init) => {
			seen.push(String(url));
			const body = String(init.body ?? '');
			if (body.includes('current-user-principal')) return { body: principalResponse };
			if (body.includes('calendar-home-set')) return { body: homeResponse };
			return { body: collections };
		});
		return seen;
	}

	// THE BUG THAT LEFT THE PICKER EMPTY. Reading the first href in the document
	// gets the resource we asked about — the principal — rather than the calendar
	// home. The next PROPFIND then walks the principal collection, finds no
	// calendars, and the dropdown has nothing in it.
	it('walks to the calendar home rather than back to the principal', async () => {
		const seen = stubDiscovery();
		await makeCalDavProvider(config).listCalendars();

		const last = seen[seen.length - 1];
		expect(last, 'the final PROPFIND must be against the calendar home').toContain(
			'/123456789/calendars/'
		);
		expect(last).not.toMatch(/\/principal\/$/);
	});

	it('finds the calendars', async () => {
		stubDiscovery();
		const calendars = await makeCalDavProvider(config).listCalendars();
		expect(calendars.map((c) => c.name)).toEqual(['Home']);
		expect(calendars[0].id).toBe('/123456789/calendars/home/');
	});

	// A CalDAV home holds task lists beside calendars, and the home collection
	// itself. Writing an event into either fails confusingly rather than cleanly.
	it('offers only collections that hold events', async () => {
		stubDiscovery();
		const calendars = await makeCalDavProvider(config).listCalendars();
		expect(calendars.map((c) => c.name)).not.toContain('Reminders');
		expect(calendars).toHaveLength(1);
	});

	it('says so when the server names no principal at all', async () => {
		stubFetch(() => ({ body: '<multistatus xmlns="DAV:"></multistatus>' }));
		await expect(makeCalDavProvider(config).listCalendars()).rejects.toThrow(/principal/i);
	});

	it('says so when the principal names no calendar home', async () => {
		stubFetch((_url, init) => {
			if (String(init.body ?? '').includes('current-user-principal')) {
				return { body: principalResponse };
			}
			return { body: '<multistatus xmlns="DAV:"></multistatus>' };
		});
		await expect(makeCalDavProvider(config).listCalendars()).rejects.toThrow(/calendar home/i);
	});
});

describe('pulling', () => {
	it('treats an expired sync-token as a reset rather than an error', async () => {
		stubFetch((_url, init) => {
			// 507 is how a server says the sync-token is too old to honour.
			if (init.method === 'REPORT' && String(init.body).includes('sync-collection')) {
				return { status: 507 };
			}
			return { body: '<d:multistatus xmlns:d="DAV:"></d:multistatus>' };
		});
		const result = await makeCalDavProvider(config).pull('stale-token');
		expect(result.reset).toBe(true);
	});

	// A server with no sync-collection support answers 400 to the REPORT. It is
	// not broken — it just needs the slower path.
	it('falls back to a full reconcile when sync-collection is unsupported', async () => {
		stubFetch((_url, init) => {
			const body = String(init.body ?? '');
			if (body.includes('sync-collection')) return { status: 400 };
			if (body.includes('calendar-query')) {
				return {
					body: `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
						<d:response>
							<d:href>/123/calendars/home/evt-1.ics</d:href>
							<d:propstat><d:prop>
								<d:getetag>"e1"</d:getetag>
								<c:calendar-data>${toIcs(series).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</c:calendar-data>
							</d:prop></d:propstat>
						</d:response>
					</d:multistatus>`
				};
			}
			return { body: '' };
		});

		const result = await makeCalDavProvider(config).pull('anything');
		expect(result.reset).toBe(true);
		expect(result.changes).toHaveLength(1);
		expect(result.changes[0].uid).toBe('evt-1');
		expect(result.changes[0].series?.title).toBe('Dentist');
	});

	// A deletion arrives as a 404 inside the multistatus, not as an absence.
	it('reads a deletion out of the multistatus', async () => {
		stubFetch((_url, init) => {
			if (String(init.body ?? '').includes('sync-collection')) {
				return {
					body: `<d:multistatus xmlns:d="DAV:">
						<d:response>
							<d:href>/123/calendars/home/evt-9.ics</d:href>
							<d:status>HTTP/1.1 404 Not Found</d:status>
						</d:response>
						<d:sync-token>tok-2</d:sync-token>
					</d:multistatus>`
				};
			}
			return { body: '' };
		});

		const result = await makeCalDavProvider(config).pull('tok-1');
		expect(result.reset).toBe(false);
		expect(result.changes).toHaveLength(1);
		expect(result.changes[0].series).toBeNull();
		expect(result.changes[0].uid).toBe('evt-9');
		expect(result.cursor).toBe('tok-2');
	});
});

describe('pushing', () => {
	it('guards a create with If-None-Match so a race cannot double-create', async () => {
		let headers: Record<string, string> = {};
		stubFetch((_url, init) => {
			if (init.method === 'PUT') headers = init.headers as Record<string, string>;
			return { status: 201, headers: { etag: '"new"' } };
		});
		const results = await makeCalDavProvider(config).push([
			{ kind: 'upsert', remoteId: 'abc', series, etag: null }
		]);
		expect(headers['If-None-Match']).toBe('*');
		expect(results[0]).toEqual({ ok: true, remoteId: 'abc', etag: '"new"' });
	});

	it('guards an update with If-Match', async () => {
		let headers: Record<string, string> = {};
		stubFetch((_url, init) => {
			if (init.method === 'PUT') headers = init.headers as Record<string, string>;
			return { status: 204, headers: { etag: '"v2"' } };
		});
		await makeCalDavProvider(config).push([
			{ kind: 'upsert', remoteId: 'abc', series, etag: '"v1"' }
		]);
		expect(headers['If-Match']).toBe('"v1"');
		expect(headers['If-None-Match']).toBeUndefined();
	});

	// 412 means somebody wrote first. Retrying the same body would overwrite
	// their change, so it is reported as a conflict and left to the next pull.
	it('reports a 412 as a conflict rather than a failure to retry', async () => {
		stubFetch(() => ({ status: 412 }));
		const results = await makeCalDavProvider(config).push([
			{ kind: 'upsert', remoteId: 'abc', series, etag: '"v1"' }
		]);
		expect(results[0]).toMatchObject({ ok: false, conflict: true });
	});

	it('sends the series as a calendar body', async () => {
		let body = '';
		stubFetch((_url, init) => {
			if (init.method === 'PUT') body = String(init.body);
			return { status: 201 };
		});
		await makeCalDavProvider(config).push([
			{ kind: 'upsert', remoteId: 'abc', series, etag: null }
		]);
		expect(body).toContain('BEGIN:VCALENDAR');
		expect(body).toContain('UID:evt-1');
	});

	it('treats a delete that finds nothing as success', async () => {
		stubFetch(() => ({ status: 404 }));
		const results = await makeCalDavProvider(config).push([
			{ kind: 'delete', remoteId: 'abc', etag: null }
		]);
		expect(results[0].ok).toBe(true);
	});
});

describe('registration', () => {
	it('registers itself with fields the settings form can render', async () => {
		await import('$lib/server/calendar/sync/icloud');
		const kind = calendarProviderKinds().find((k) => k.id === 'icloud');
		expect(kind).toBeDefined();
		expect(kind!.fields.map((f) => f.key)).toContain('password');
		expect(kind!.fields.find((f) => f.key === 'password')!.secret).toBe(true);
		// The hint has to say app-specific password: it is the setup step people
		// get wrong, and the resulting 401 explains nothing.
		expect(kind!.hint).toMatch(/app-specific/i);
	});
});
