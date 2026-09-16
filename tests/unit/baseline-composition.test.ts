// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENTITY_KINDS, ENUMS, ENUM_COLUMNS, checkName } from '$lib/enums';
import { BASELINE_SECTIONS } from '$lib/server/db/schema/baseline';

/**
 * `drizzle/0000_baseline.sql` is composed from drizzle-kit's tables plus SQL
 * the schema modules export (triggers, CHECKs, views, seed rows) via
 * `npm run db:baseline`. These assertions catch hand-edits drifting from the
 * modules; they do not re-run the compose script itself.
 */
const BASELINE = readFileSync(resolve('drizzle/0000_baseline.sql'), 'utf8');

describe('the composed baseline', () => {
	it('says it is generated, so nobody edits it by hand', () => {
		expect(BASELINE.startsWith('-- GENERATED FILE — DO NOT EDIT.')).toBe(true);
	});

	it('carries every section the schema modules export, in order', () => {
		const found = [...BASELINE.matchAll(/^-- ---- (.+) ----$/gm)].map((match) => match[1]);
		expect(found).toEqual(BASELINE_SECTIONS.map((section) => section.title));
	});

	it('carries each section verbatim', () => {
		// Verbatim, not "contains the important bits": a block that was edited in
		// the file and not in the module is the whole failure this guards against,
		// and any weaker comparison lets a changed constant through.
		for (const section of BASELINE_SECTIONS) {
			expect(BASELINE, `section "${section.title}" differs from its module`).toContain(
				section.sql.trim()
			);
		}
	});

	it('writes a CHECK for every closed set, from the list itself', () => {
		// The lists in `$lib/enums` back the column type, the UI, and this CHECK —
		// one declaration, so a hand-copied fourth list in SQL can't drift silently.
		for (const { table, column, enum: key } of ENUM_COLUMNS) {
			const values = (ENUMS[key] as readonly string[]).map((value) => `'${value}'`).join(', ');
			expect(BASELINE).toContain(
				`ALTER TABLE ${table} ADD CONSTRAINT ${checkName(table, column)}\n\tCHECK (${column} in (${values}));`
			);
		}
	});

	it('registers exactly the entity kinds the enum names', () => {
		// The loop and the CHECK each repeat this list in SQL; only the CHECK was
		// tested, so adding a kind could silently miss the loop.
		const loop = BASELINE.match(/FOREACH t IN ARRAY ARRAY\[([^\]]+)\]/)?.[1];
		expect(loop).toBeDefined();
		const kinds = [...loop!.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
		expect(kinds).toEqual([...ENTITY_KINDS]);
	});

	it('holds one migration, because the baseline is rewritten and never added to', () => {
		// Stated here as well as in the integration suite, so the rule is visible
		// where the composition is: a second file would mean a chain, and the
		// compose script overwrites rather than appends.
		expect(BASELINE).not.toContain('0001_');
	});
});
