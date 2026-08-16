import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { makeCalDavProvider } from '$lib/server/calendar/sync/icloud';
import type { EventSeries } from '$lib/server/calendar/series';

/**
 * Live CalDAV, against a real account.
 *
 * NEVER RUNS IN CI, and self-skips everywhere the credentials are absent — the
 * same mechanism tests/acceptance/real-files.test.ts uses for the private bank
 * statements. A live suite in CI needs secrets, is rate-limited, cannot run on a
 * pull request from a fork, and fails for reasons that have nothing to do with
 * the change under review.
 *
 * The offline half — ical.test.ts and caldav.test.ts — always runs, and is what
 * catches a regression in shared code. This suite exists for the thing fixtures
 * genuinely cannot check: whether a real server accepts what we serialise.
 *
 * To run it:
 *   CALDAV_TEST_USERNAME=you@icloud.com \
 *   CALDAV_TEST_PASSWORD=xxxx-xxxx-xxxx-xxxx \
 *   CALDAV_TEST_CALENDAR=/123456/calendars/work/ \
 *   npx vitest run tests/acceptance/calendar-live.test.ts
 *
 * It writes and then removes one event whose title says what it is. Point it at
 * a scratch calendar rather than a real one.
 */
const username = process.env.CALDAV_TEST_USERNAME;
const password = process.env.CALDAV_TEST_PASSWORD;
const calendarUrl = process.env.CALDAV_TEST_CALENDAR;
const live = Boolean(username && password);

const provider = live
	? makeCalDavProvider({
			username: username!,
			password: password!,
			host: process.env.CALDAV_TEST_HOST ?? '',
			calendarUrl: calendarUrl ?? ''
		})
	: null;

const uid = `continuum-acceptance-${randomUUID()}`;
const remoteId = uid.replace(/-/g, '').toLowerCase();

const series: EventSeries = {
	uid,
	title: 'Continuum acceptance test — safe to delete',
	notes: 'Written by the acceptance suite. It removes itself.',
	category: null,
	allDay: false,
	startsAt: '2030-01-15T09:00:00.000Z',
	endsAt: '2030-01-15T10:00:00.000Z',
	tz: 'Europe/Prague',
	rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=3',
	exceptions: [
		{
			recurrenceId: '2030-01-22T09:00:00.000Z',
			cancelled: false,
			title: 'Continuum acceptance test — moved occurrence',
			startsAt: '2030-01-23T11:00:00.000Z',
			endsAt: '2030-01-23T12:00:00.000Z',
			notes: null
		}
	],
	updatedAt: new Date().toISOString()
};

afterAll(async () => {
	// Best effort: a failed run must not leave test events in someone's calendar.
	if (provider && calendarUrl) {
		await provider.push([{ kind: 'delete', remoteId, etag: null }]).catch(() => undefined);
	}
});

describe.skipIf(!live)('live CalDAV', () => {
	it('connects with the app-specific password', async () => {
		const result = await provider!.probe();
		expect(result.ok, result.detail).toBe(true);
	});

	it('lists at least one calendar that holds events', async () => {
		const calendars = await provider!.listCalendars();
		expect(calendars.length).toBeGreaterThan(0);
		expect(calendars[0].id).toBeTruthy();
	});

	// The one thing fixtures cannot answer: does a real server accept what we
	// write, and hand back something we can read?
	it.skipIf(!calendarUrl)('round-trips a recurring series with an exception', async () => {
		const [written] = await provider!.push([{ kind: 'upsert', remoteId, series, etag: null }]);
		expect(written.ok, written.ok ? '' : written.message).toBe(true);

		const pulled = await provider!.pull(null);
		const found = pulled.changes.find((change) => change.uid === uid);
		expect(found, 'the event we just wrote came back').toBeDefined();
		expect(found!.series!.rrule).toContain('FREQ=WEEKLY');
		expect(found!.series!.exceptions).toHaveLength(1);
		expect(found!.series!.exceptions[0].title).toContain('moved occurrence');
	});

	it.skipIf(!calendarUrl)('removes what it wrote', async () => {
		const [deleted] = await provider!.push([{ kind: 'delete', remoteId, etag: null }]);
		expect(deleted.ok).toBe(true);
	});
});
