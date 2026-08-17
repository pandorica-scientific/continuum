import { readFileSync } from 'node:fs';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { EXPORTABLE_KEYS } from '$lib/server/config-file';
import { calendarAccount } from '$lib/server/db/schema';

/**
 * Calendar credentials must not be able to leave in a config export.
 *
 * The export reads the `settings` table through a whitelist. Home Assistant's
 * provider config lives there, so its secrets depend on someone remembering to
 * keep a key off a list. Calendar credentials are kept out by CONSTRUCTION
 * instead — they live in their own table, which the exporter never reads — and
 * these tests pin that structure so a later "tidy-up" cannot quietly undo it.
 */
describe('calendar credentials cannot be exported', () => {
	it('stores the credential on its own table, not in settings', () => {
		const columns = getTableConfig(calendarAccount).columns.map((c) => c.name);
		expect(columns).toContain('credential');
	});

	it('exports nothing that could name a calendar credential', () => {
		for (const key of EXPORTABLE_KEYS) {
			expect(key.toLowerCase()).not.toContain('credential');
			expect(key.toLowerCase()).not.toContain('calendaraccount');
			expect(key.toLowerCase()).not.toContain('token');
		}
	});

	// The whole guarantee rests on the exporter reading one table. If it ever
	// learns to read another, the whitelist stops being the boundary.
	it('reads only the settings table', () => {
		const source = readFileSync('src/lib/server/config-file.ts', 'utf8');
		const tablesRead = [...source.matchAll(/\.from\((\w+)\)/g)].map((m) => m[1]);
		expect([...new Set(tablesRead)]).toEqual(['settings']);
	});

	it('never imports a calendar table', () => {
		const source = readFileSync('src/lib/server/config-file.ts', 'utf8');
		expect(source).not.toMatch(/calendarAccount|calendarSyncLink|calendarConflict/);
	});
});

/**
 * One account syncs with exactly one remote calendar.
 *
 * Syncing a whole account would write household events into every calendar the
 * person owns. Picking one is what makes this usable — and the picker has to be
 * tied to the account it was opened from, or with two accounts connected it
 * appears on both cards and writes the wrong one.
 */
describe('choosing which calendar to sync', () => {
	const settings = readFileSync('src/routes/(app)/settings/+page.svelte', 'utf8');
	const server = readFileSync('src/routes/(app)/settings/+page.server.ts', 'utf8');

	it('scopes the picker to the account the list was fetched for', () => {
		expect(server).toContain('listedFor: id');
		expect(settings).toContain('form?.listedFor === account.id');
	});

	it('lets the calendar be changed after it has been chosen', () => {
		// The form used to be inside an {:else}, so a first pick was permanent
		// short of disconnecting the account entirely.
		expect(settings).toContain('Change calendar');
	});

	// The old cursor belongs to the old collection. Asking a different calendar
	// for changes since a token it never issued resets at best, and at worst
	// returns nothing while looking like it worked.
	it('clears the sync cursor when the calendar changes', () => {
		const action = server.slice(
			server.indexOf('chooseCalendar:'),
			server.indexOf('listRemoteCalendars:')
		);
		expect(action).toContain('cursor: null');
		expect(action).toContain('lastSyncAt: null');
	});

	it('stores the calendar name, not just its id', () => {
		expect(server).toContain('remoteCalName');
		// A CalDAV collection URL or a Google calendar id names nothing a person
		// would recognise.
		expect(settings).toContain('account.remoteCalName');
	});
});
