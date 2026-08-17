import { describe, expect, it } from 'vitest';
import { syncDue } from '$lib/server/calendar/sync';

const at = (iso: string) => new Date(iso);

describe('when an account is due to sync', () => {
	const now = at('2026-09-10T12:00:00.000Z');

	// A connected account that has never run has to go on the first tick, or it
	// sits there looking connected and doing nothing until something else moves.
	it('is due when it has never synced', () => {
		expect(syncDue(null, 15, now)).toBe(true);
	});

	it('is not due before the interval has passed', () => {
		expect(syncDue(at('2026-09-10T11:50:00.000Z'), 15, now)).toBe(false);
	});

	it('is due once the interval has passed', () => {
		expect(syncDue(at('2026-09-10T11:44:00.000Z'), 15, now)).toBe(true);
	});

	it('is due exactly on the boundary', () => {
		expect(syncDue(at('2026-09-10T11:45:00.000Z'), 15, now)).toBe(true);
	});

	// Read from the account's own timestamp rather than a timer, so a server that
	// was off for an hour syncs once on the way back up instead of waiting out a
	// fresh interval.
	it('is due after a long outage', () => {
		expect(syncDue(at('2026-09-09T12:00:00.000Z'), 15, now)).toBe(true);
	});

	it('follows the configured interval rather than a fixed one', () => {
		const lastSync = at('2026-09-10T11:30:00.000Z');
		expect(syncDue(lastSync, 15, now)).toBe(true);
		expect(syncDue(lastSync, 60, now)).toBe(false);
	});
});
