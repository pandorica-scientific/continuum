// SPDX-License-Identifier: AGPL-3.0-or-later
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SYSTEM_SHELF_KEYS } from '$lib/documents/shelves';
import { SHELF_SEED_ROWS } from '$lib/server/db/schema/documents';

/**
 * The four shelves the application writes to by name, in one place.
 *
 * They used to be spelled at each writer: `'finance'` in the salary tracker and
 * again in the tax module, `'statements'` in the importer and again in the
 * broker reader. Renaming `finance` to `income_tax` in v0.8.0 is what made that
 * expensive, and the registry is what makes the next rename a one-line change.
 */
describe('the written-to shelf keys', () => {
	it('are four, and each is seeded as a system shelf', () => {
		const seeded = new Map(SHELF_SEED_ROWS.map((s) => [s.key, s]));
		for (const key of Object.values(SYSTEM_SHELF_KEYS))
			expect(seeded.get(key)?.system, key).toBe(true);
		expect(Object.values(SYSTEM_SHELF_KEYS).sort()).toEqual([
			'inbox',
			'income_tax',
			'property',
			'statements'
		]);
	});

	it('no writer spells a shelf key', () => {
		// The literal, not the registry constant. `shelfIdByKey(SYSTEM_SHELF_KEYS.inbox)`
		// passes; `shelfIdByKey('inbox')` is what this exists to catch.
		//
		// The demo seed is exempt and named here rather than skipped silently: it
		// is a fixture that files onto shelves it is inventing content for, and
		// the keys it spells are the ones a household may rename or remove. A
		// writer doing that would be the defect; a demo doing it is the demo.
		const hits = execSync(
			`grep -rnE "shelfIdByKey\\('|systemShelfId\\('" src/lib/server src/routes || true`,
			{ encoding: 'utf8' }
		)
			.split('\n')
			.filter((line) => line && !line.startsWith('src/lib/server/system/demo.ts:'));
		expect(hits).toEqual([]);
	});

	it('the profile registry is gone', () => {
		// Its knowledge is on the shelf row now, where a shelf somebody made can
		// carry it too.
		expect(() => readFileSync('src/lib/shelf-profiles.ts')).toThrow();
	});
});
