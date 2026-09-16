// SPDX-License-Identifier: AGPL-3.0-or-later
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SYSTEM_SHELF_KEYS } from '$lib/documents/shelves';
import { SHELF_SEED_ROWS } from '$lib/server/db/schema/documents';

// The four shelves the application writes to by name, kept in one registry so
// a rename is a one-line change instead of one at every writer.
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
		// Catches the literal, e.g. `shelfIdByKey('inbox')`; the registry constant
		// form passes. The demo seed is exempt: it invents content for shelves a
		// household may rename or remove, so spelling the key there is expected.
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
