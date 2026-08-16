import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	fromGoogleEvents,
	makeGoogleProvider,
	toGoogleEvents,
	type GoogleEvent
} from '$lib/server/calendar/sync/google';
import { calendarProviderKinds } from '$lib/server/calendar/sync/provider';
import type { EventSeries } from '$lib/server/calendar/series';

const config = {
	clientId: 'cid',
	clientSecret: 'secret',
	refreshToken: 'refresh',
	calendarUrl: 'primary'
};

const series: EventSeries = {
	uid: 'evt-1',
	title: 'Bin day',
	notes: null,
	category: null,
	allDay: false,
	startsAt: '2026-09-01T09:00:00.000Z',
	endsAt: '2026-09-01T09:30:00.000Z',
	tz: 'Europe/Prague',
	rrule: 'FREQ=WEEKLY;BYDAY=TU',
	exceptions: [
		{
			recurrenceId: '2026-09-08T09:00:00.000Z',
			cancelled: false,
			title: 'Bin day (moved)',
			startsAt: '2026-09-09T11:00:00.000Z',
			endsAt: '2026-09-09T11:30:00.000Z',
			notes: null
		},
		{ recurrenceId: '2026-09-15T09:00:00.000Z', cancelled: true }
	],
	updatedAt: '2026-09-01T00:00:00.000Z'
};

function stubFetch(
	handler: (url: string, init: RequestInit) => { status?: number; body?: unknown }
) {
	vi.stubGlobal('fetch', async (url: string | URL, init: RequestInit = {}) => {
		const result = handler(String(url), init);
		return new Response(JSON.stringify(result.body ?? {}), {
			status: result.status ?? 200,
			headers: { 'content-type': 'application/json' }
		});
	});
}

afterEach(() => vi.unstubAllGlobals());

// THE ASYMMETRY THIS ADAPTER EXISTS TO ABSORB. CalDAV keeps a recurring event
// and every override in one resource; Google gives each override its own event,
// tied to the parent by recurringEventId and originalStartTime. Keeping the
// transfer unit a whole series is what confines that difference to right here.
describe('fanning a series out to Google resources', () => {
	it('writes the master and one resource per exception', () => {
		const events = toGoogleEvents(series, 'remote-1');
		expect(events).toHaveLength(3);
		expect(events[0].id).toBe('remote-1');
		expect(events[0].recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=TU']);
	});

	it('ties every exception back to the master', () => {
		const [master, ...overrides] = toGoogleEvents(series, 'remote-1');
		for (const override of overrides) {
			expect(override.recurringEventId).toBe(master.id);
			// Our uid, in the field insert actually accepts.
			expect(override.extendedProperties?.private?.continuumUid).toBe('evt-1');
		}
	});

	// originalStartTime is where the occurrence WAS. Sending where it went instead
	// makes Google create a second event rather than move the existing one.
	it('identifies an override by its original start, not its new one', () => {
		const moved = toGoogleEvents(series, 'remote-1')[1];
		expect(moved.originalStartTime?.dateTime).toBe('2026-09-08T09:00:00.000Z');
		expect(moved.start?.dateTime).toBe('2026-09-09T11:00:00.000Z');
	});

	it('sends a cancelled occurrence as status cancelled', () => {
		const cancelled = toGoogleEvents(series, 'remote-1')[2];
		expect(cancelled.status).toBe('cancelled');
		expect(cancelled.originalStartTime?.dateTime).toBe('2026-09-15T09:00:00.000Z');
	});

	it('carries the timezone so recurrence expands on local wall-clock time', () => {
		const master = toGoogleEvents(series, 'remote-1')[0];
		expect(master.start?.timeZone).toBe('Europe/Prague');
	});

	it('writes an all-day event as a date rather than a dateTime', () => {
		const master = toGoogleEvents({ ...series, allDay: true }, 'remote-1')[0];
		expect(master.start?.date).toBe('2026-09-01');
		expect(master.start?.dateTime).toBeUndefined();
	});

	it('sends a single event as exactly one resource', () => {
		expect(toGoogleEvents({ ...series, rrule: null, exceptions: [] }, 'r')).toHaveLength(1);
	});
});

describe('all-day events', () => {
	const allDay: EventSeries = { ...series, allDay: true, rrule: null, exceptions: [] };

	// THE 400. Google and RFC 5545 both treat an all-day end date as EXCLUSIVE:
	// a one-day event on the 1st ends on the 2nd. Sending the same date for both
	// is a zero-length range, which Google refuses outright — and every event the
	// ledger generates is all-day, so it refused all of them.
	it('ends an all-day event on the following day', () => {
		const master = toGoogleEvents(allDay, 'r')[0];
		expect(master.start?.date).toBe('2026-09-01');
		expect(master.end?.date).toBe('2026-09-02');
	});

	it('keeps a multi-day event spanning the right number of days', () => {
		const master = toGoogleEvents({ ...allDay, endsAt: '2026-09-03T23:59:59.000Z' }, 'r')[0];
		expect(master.end?.date).toBe('2026-09-04');
	});

	// And back again: an exclusive end read as inclusive would shorten every
	// event by a day each time it round-tripped.
	it('round-trips without losing or gaining a day', () => {
		const back = fromGoogleEvents(toGoogleEvents(allDay, 'r'))!;
		expect(back.allDay).toBe(true);
		expect(back.startsAt.slice(0, 10)).toBe('2026-09-01');
		expect(back.endsAt.slice(0, 10)).toBe('2026-09-01');
	});

	it('survives several round trips unchanged', () => {
		let current: EventSeries = allDay;
		for (let i = 0; i < 3; i++) {
			current = fromGoogleEvents(toGoogleEvents(current, 'r'))!;
		}
		expect(current.startsAt.slice(0, 10)).toBe('2026-09-01');
		expect(current.endsAt.slice(0, 10)).toBe('2026-09-01');
	});

	// iCalUID is writable on events.import but read-only on events.insert, and
	// sending it there is a 400. Our uid travels in extendedProperties instead,
	// which insert does accept.
	it('does not send iCalUID, which insert rejects', () => {
		const master = toGoogleEvents(allDay, 'r')[0];
		expect(master.iCalUID).toBeUndefined();
		expect(master.extendedProperties?.private?.continuumUid).toBe('evt-1');
	});

	it('reads our uid back out of extendedProperties', () => {
		expect(fromGoogleEvents(toGoogleEvents(allDay, 'r'))!.uid).toBe('evt-1');
	});
});

describe('reassembling Google resources into a series', () => {
	it('folds a master and its overrides back into one series', () => {
		const events = toGoogleEvents(series, 'remote-1');
		const back = fromGoogleEvents(events);
		expect(back).not.toBeNull();
		expect(back!.uid).toBe('evt-1');
		expect(back!.rrule).toBe('FREQ=WEEKLY;BYDAY=TU');
		expect(back!.exceptions).toHaveLength(2);
	});

	it('round-trips a moved occurrence with its original identity intact', () => {
		const back = fromGoogleEvents(toGoogleEvents(series, 'remote-1'))!;
		const moved = back.exceptions.find((e) => !e.cancelled)!;
		expect(moved.recurrenceId).toBe('2026-09-08T09:00:00.000Z');
		expect(moved.startsAt).toBe('2026-09-09T11:00:00.000Z');
		expect(moved.title).toBe('Bin day (moved)');
	});

	it('round-trips a cancelled occurrence', () => {
		const back = fromGoogleEvents(toGoogleEvents(series, 'remote-1'))!;
		expect(back.exceptions.find((e) => e.cancelled)?.recurrenceId).toBe('2026-09-15T09:00:00.000Z');
	});

	it('round-trips an all-day event', () => {
		const back = fromGoogleEvents(toGoogleEvents({ ...series, allDay: true }, 'r'))!;
		expect(back.allDay).toBe(true);
	});

	it('returns null when there is no master among the resources', () => {
		const onlyOverride = toGoogleEvents(series, 'r').slice(1);
		expect(fromGoogleEvents(onlyOverride)).toBeNull();
	});
});

describe('listing calendars', () => {
	const entry = (over: Record<string, unknown> = {}) => ({
		id: 'a@group.calendar.google.com',
		summary: 'Household',
		accessRole: 'owner',
		...over
	});

	function stubList(pages: Array<{ items: unknown[]; nextPageToken?: string }>) {
		let call = 0;
		stubFetch((url) => {
			if (url.includes('oauth2')) return { body: { access_token: 'at' } };
			return { body: pages[Math.min(call++, pages.length - 1)] };
		});
	}

	// The symptom that started this: only the primary calendar showed up. A
	// calendar hidden in Google's own sidebar is omitted unless asked for — and
	// hiding one there is exactly what someone does with a calendar kept for an
	// app.
	it('asks for hidden calendars', async () => {
		let seen = '';
		stubFetch((url) => {
			if (url.includes('oauth2')) return { body: { access_token: 'at' } };
			seen = url;
			return { body: { items: [] } };
		});
		await makeGoogleProvider(config).listCalendars();
		expect(seen).toContain('showHidden=true');
	});

	it('follows pagination', async () => {
		stubList([
			{ items: [entry({ id: 'one', summary: 'One' })], nextPageToken: 'p2' },
			{ items: [entry({ id: 'two', summary: 'Two' })] }
		]);
		const calendars = await makeGoogleProvider(config).listCalendars();
		expect(calendars.map((c) => c.id)).toEqual(['one', 'two']);
	});

	// A holiday feed or someone else's shared calendar would accept being chosen
	// and then fail every single push.
	it('offers only calendars that can be written to', async () => {
		stubList([
			{
				items: [
					entry({ id: 'mine', summary: 'Household', accessRole: 'owner' }),
					entry({ id: 'theirs', summary: 'Shared with me', accessRole: 'writer' }),
					entry({ id: 'holidays', summary: 'Holidays', accessRole: 'reader' }),
					entry({ id: 'busy', summary: 'Free/busy only', accessRole: 'freeBusyReader' })
				]
			}
		]);
		const calendars = await makeGoogleProvider(config).listCalendars();
		expect(calendars.map((c) => c.id)).toEqual(['mine', 'theirs']);
	});

	it('leaves out a deleted entry', async () => {
		stubList([{ items: [entry({ id: 'gone', deleted: true }), entry({ id: 'live' })] }]);
		expect((await makeGoogleProvider(config).listCalendars()).map((c) => c.id)).toEqual(['live']);
	});

	// The point of choosing is usually to keep household events OUT of the
	// personal calendar, so the primary should not be what the dropdown lands on.
	it('puts the primary calendar last', async () => {
		stubList([
			{
				items: [
					entry({ id: 'primary', summary: 'you@example.com', primary: true }),
					entry({ id: 'household', summary: 'Household' })
				]
			}
		]);
		const calendars = await makeGoogleProvider(config).listCalendars();
		expect(calendars.map((c) => c.id)).toEqual(['household', 'primary']);
	});

	// summaryOverride is what the person actually sees in Google's sidebar.
	it('prefers the name the person gave it', async () => {
		stubList([{ items: [entry({ summary: 'Original', summaryOverride: 'Renamed' })] }]);
		expect((await makeGoogleProvider(config).listCalendars())[0].name).toBe('Renamed');
	});

	// 403 is the EXPECTED answer under calendar.app.created: reading the account's
	// calendar list is not something that scope grants. Treating it as a failure
	// made a healthy account look broken.
	it('reports no calendars rather than failing when the list is not readable', async () => {
		stubFetch((url) => {
			if (url.includes('oauth2')) return { body: { access_token: 'at' } };
			return { status: 403, body: { error: { code: 403 } } };
		});
		expect(await makeGoogleProvider(config).listCalendars()).toEqual([]);
	});

	it('still reports any other refusal', async () => {
		stubFetch((url) => {
			if (url.includes('oauth2')) return { body: { access_token: 'at' } };
			return { status: 500, body: {} };
		});
		await expect(makeGoogleProvider(config).listCalendars()).rejects.toThrow(/500/);
	});
});

describe('making a calendar to write to', () => {
	// Under calendar.app.created the account's own calendars are invisible, so
	// there is nothing to choose from until Continuum has made one. Creating it
	// is the setup step, not a fallback.
	it('creates one when the account has none yet', async () => {
		let created: Record<string, unknown> | null = null;
		stubFetch((url, init) => {
			if (url.includes('oauth2')) return { body: { access_token: 'at' } };
			if (init.method === 'POST') {
				created = JSON.parse(String(init.body));
				return { body: { id: 'made@group.calendar.google.com', summary: 'Continuum' } };
			}
			return { body: { items: [] } };
		});

		const calendar = await makeGoogleProvider(config).ensureCalendar!();
		expect(calendar).toEqual({ id: 'made@group.calendar.google.com', name: 'Continuum' });
		expect(created).toMatchObject({ summary: 'Continuum' });
	});

	// It does NOT list first. Under calendar.app.created the calendarList endpoint
	// answers 403, so listing before creating fails at step one — which is exactly
	// what left the button looking dead. Not creating twice is the caller's job,
	// guarded on the calendar id already stored against the account.
	it('creates without trying to enumerate first', async () => {
		const calls: string[] = [];
		stubFetch((url, init) => {
			if (url.includes('oauth2')) return { body: { access_token: 'at' } };
			calls.push(`${init.method ?? 'GET'} ${url}`);
			return { body: { id: 'made', summary: 'Continuum' } };
		});

		await makeGoogleProvider(config).ensureCalendar!();
		expect(calls.some((c) => c.includes('calendarList'))).toBe(false);
		expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);
	});

	it('reports a refusal rather than returning nothing', async () => {
		stubFetch((url, init) => {
			if (url.includes('oauth2')) return { body: { access_token: 'at' } };
			if (init.method === 'POST') return { status: 403, body: {} };
			return { body: { items: [] } };
		});
		await expect(makeGoogleProvider(config).ensureCalendar!()).rejects.toThrow(/403/);
	});
});

describe('pulling', () => {
	// A syncToken Google no longer honours comes back as 410 Gone. Treated as an
	// error it would stall sync permanently; it means "start over".
	it('treats 410 Gone on a syncToken as a reset', async () => {
		stubFetch((url) => {
			if (url.includes('oauth2')) return { body: { access_token: 'at' } };
			if (url.includes('syncToken')) return { status: 410, body: { error: { code: 410 } } };
			return { body: { items: [], nextSyncToken: 'fresh' } };
		});
		const result = await makeGoogleProvider(config).pull('stale');
		expect(result.reset).toBe(true);
	});

	it('groups a master and its overrides into one change', async () => {
		const items = toGoogleEvents(series, 'remote-1');
		stubFetch((url) => {
			if (url.includes('oauth2')) return { body: { access_token: 'at' } };
			return { body: { items, nextSyncToken: 'tok-2' } };
		});

		const result = await makeGoogleProvider(config).pull(null);
		expect(result.changes).toHaveLength(1);
		expect(result.changes[0].uid).toBe('evt-1');
		expect(result.changes[0].series?.exceptions).toHaveLength(2);
		expect(result.cursor).toBe('tok-2');
	});

	// A deleted event arrives as an item with status 'cancelled' and no body —
	// distinct from a cancelled OCCURRENCE, which carries a recurringEventId.
	it('reads a cancelled master as a deletion', async () => {
		stubFetch((url) => {
			if (url.includes('oauth2')) return { body: { access_token: 'at' } };
			return {
				body: {
					items: [{ id: 'remote-1', iCalUID: 'evt-1', status: 'cancelled' }],
					nextSyncToken: 'tok-3'
				}
			};
		});
		const result = await makeGoogleProvider(config).pull('tok-2');
		expect(result.changes).toHaveLength(1);
		expect(result.changes[0].series).toBeNull();
	});

	it('follows pagination before returning', async () => {
		let call = 0;
		stubFetch((url) => {
			if (url.includes('oauth2')) return { body: { access_token: 'at' } };
			call += 1;
			if (call === 1) return { body: { items: [], nextPageToken: 'page-2' } };
			return { body: { items: [], nextSyncToken: 'done' } };
		});
		const result = await makeGoogleProvider(config).pull(null);
		expect(call).toBe(2);
		expect(result.cursor).toBe('done');
	});
});

describe('authentication', () => {
	it('exchanges the refresh token for an access token', async () => {
		let body = '';
		stubFetch((url, init) => {
			if (url.includes('oauth2')) {
				body = String(init.body);
				return { body: { access_token: 'at' } };
			}
			return { body: { items: [], nextSyncToken: 't' } };
		});
		await makeGoogleProvider(config).pull(null);
		expect(body).toContain('grant_type=refresh_token');
		expect(body).toContain('refresh_token=refresh');
	});

	// invalid_grant means the token is revoked or expired. Retrying cannot fix
	// it, and a loop of retries against Google's token endpoint is how an account
	// gets rate-limited on top of being broken.
	it('gives up on invalid_grant instead of retrying', async () => {
		let attempts = 0;
		stubFetch((url) => {
			if (url.includes('oauth2')) {
				attempts += 1;
				return { status: 400, body: { error: 'invalid_grant' } };
			}
			return { body: {} };
		});
		await expect(makeGoogleProvider(config).pull(null)).rejects.toThrow(/reconnect/i);
		expect(attempts).toBe(1);
	});
});

describe('pushing', () => {
	it('supplies our own id so the remote id stays derivable', async () => {
		const seen: string[] = [];
		stubFetch((url, init) => {
			if (url.includes('oauth2')) return { body: { access_token: 'at' } };
			if (init.method === 'POST' || init.method === 'PUT') {
				seen.push(String(JSON.parse(String(init.body)).id));
			}
			return { body: { id: 'remote-1', etag: '"e1"' } };
		});
		await makeGoogleProvider(config).push([
			{ kind: 'upsert', remoteId: 'remote1', series: { ...series, exceptions: [] }, etag: null }
		]);
		expect(seen).toContain('remote1');
	});

	it('reports a 412 as a conflict', async () => {
		stubFetch((url) => {
			if (url.includes('oauth2')) return { body: { access_token: 'at' } };
			return { status: 412, body: { error: { code: 412 } } };
		});
		const [result] = await makeGoogleProvider(config).push([
			{ kind: 'upsert', remoteId: 'r', series, etag: '"v1"' }
		]);
		expect(result).toMatchObject({ ok: false, conflict: true });
	});

	it('treats deleting something already gone as success', async () => {
		stubFetch((url) => {
			if (url.includes('oauth2')) return { body: { access_token: 'at' } };
			return { status: 410, body: {} };
		});
		const [result] = await makeGoogleProvider(config).push([
			{ kind: 'delete', remoteId: 'r', etag: null }
		]);
		expect(result.ok).toBe(true);
	});
});

describe('registration', () => {
	it('registers with the fields the settings form needs', async () => {
		await import('$lib/server/calendar/sync/google');
		const kind = calendarProviderKinds().find((k) => k.id === 'google');
		expect(kind).toBeDefined();
		expect(kind!.fields.map((f) => f.key)).toEqual(['clientId', 'clientSecret']);
		expect(kind!.fields.find((f) => f.key === 'clientSecret')!.secret).toBe(true);

		// Declared as a redirect flow, so Settings offers to authorise rather than
		// to connect — and never asks anyone to fetch a refresh token by hand.
		expect(kind!.oauth).toBe(true);
		expect(kind!.fields.map((f) => f.key)).not.toContain('refreshToken');
		// The hint must warn about the publishing-status trap: left in Testing,
		// Google expires the refresh token after 7 days and sync dies weekly.
		expect(kind!.hint).toMatch(/production/i);
	});
});

// Referenced by the reassembly tests; exported so the shape is pinned.
const _typeCheck: GoogleEvent = { id: 'x' };
void _typeCheck;
