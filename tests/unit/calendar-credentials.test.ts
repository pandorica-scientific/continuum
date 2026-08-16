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
