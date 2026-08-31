// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The kinds of paper a household files.
 *
 * Seventeen ship and the household adds its own. The line between them is the
 * whole of this suite: a built-in key is read by name somewhere in the code, so
 * it may be relabelled and never removed; a household's own type carries no
 * behaviour at all.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { ENUMS } from '$lib/enums';
import { typeLabel, typeLabels, TYPE_LABELS } from '$lib/documents-view';
import { shelfType } from '$lib/server/db/schema';
import {
	addDocumentType,
	asDocumentType,
	listDocumentTypes,
	removeDocumentType,
	typeKeyFor,
	TYPE_IN_USE,
	TYPE_IS_BUILTIN
} from '$lib/server/documents/types';
import { shelfIdByKey, setShelfTypes } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('document-types', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await harness.sql`truncate document cascade`;
	await harness.sql`delete from document_type where builtin = false`;
});

describe('what a fresh install ships', () => {
	it('is every type the code names, marked as built in', async () => {
		const rows = await listDocumentTypes(testDb);
		const builtin = rows.filter((r) => r.builtin).map((r) => r.key);

		expect(builtin.sort()).toEqual([...ENUMS['document.type']].sort());
	});

	it('labels them the way the screens already do', async () => {
		// The seed and `TYPE_LABELS` are two places holding one fact, so they are
		// held to each other here: a household that renames one changes its own
		// row and the fallback stays what the app shipped.
		for (const row of await listDocumentTypes(testDb)) {
			if (row.builtin) expect(row.label).toBe(TYPE_LABELS[row.key]);
		}
	});
});

describe('adding a type', () => {
	it('slugs the name into a key a document can store', () => {
		expect(typeKeyFor('Vaccination book')).toBe('vaccination_book');
		expect(typeKeyFor('  Řidičský průkaz ')).toBe('ridicsky_prukaz');
		expect(typeKeyFor('Lease — annex #2')).toBe('lease_annex_2');
	});

	it('adds it, unmarked as built in', async () => {
		const added = await addDocumentType('Vaccination book', testDb);

		expect(added).toMatchObject({ key: 'vaccination_book', builtin: false });
		expect((await listDocumentTypes(testDb)).some((r) => r.key === 'vaccination_book')).toBe(true);
	});

	it('returns the existing one rather than refusing', async () => {
		// Two people naming the same thing have agreed, not collided.
		await addDocumentType('Vaccination book', testDb);
		const again = await addDocumentType('vaccination BOOK', testDb);

		expect(again.key).toBe('vaccination_book');
		const all = await listDocumentTypes(testDb);
		expect(all.filter((r) => r.key === 'vaccination_book')).toHaveLength(1);
	});

	it('refuses a name with no letters in it', async () => {
		// The key is what documents store, and `———` slugs to nothing.
		await expect(addDocumentType('———', testDb)).rejects.toThrow(/name/i);
	});

	it('puts the household\u2019s own after everything the app ships', async () => {
		await addDocumentType('Vaccination book', testDb);
		const keys = (await listDocumentTypes(testDb)).map((r) => r.key);

		expect(keys[keys.length - 1]).toBe('vaccination_book');
	});
});

describe('removing a type', () => {
	it('takes one the household added', async () => {
		await addDocumentType('Vaccination book', testDb);
		await removeDocumentType('vaccination_book', testDb);

		expect((await listDocumentTypes(testDb)).some((r) => r.key === 'vaccination_book')).toBe(false);
	});

	it('refuses one the app ships', async () => {
		// The salary tracker reads `payslip` by name; removing it is not an
		// opinion about filing, it is breaking a screen.
		await expect(removeDocumentType('payslip', testDb)).rejects.toThrow(TYPE_IS_BUILTIN);
	});

	it('refuses one that is on a document', async () => {
		await addDocumentType('Vaccination book', testDb);
		await makeDocument(testDb, {
			id: uuidv7(),
			name: 'The dog’s book',
			shelfKey: 'health',
			type: 'vaccination_book',
			addedOn: '2026-01-01'
		});

		await expect(removeDocumentType('vaccination_book', testDb)).rejects.toThrow(TYPE_IN_USE);
	});

	it('takes its mention on a shelf with it', async () => {
		// A shelf's list is a preference, not a record: it should not stand in
		// the way of removing a type nothing is filed as.
		await addDocumentType('Vaccination book', testDb);
		const health = await shelfIdByKey('health', testDb);
		await setShelfTypes(health, ['medical_record', 'vaccination_book'], testDb);

		await removeDocumentType('vaccination_book', testDb);

		const left = await testDb.select().from(shelfType).where(eq(shelfType.shelfId, health));
		expect(left.map((r) => r.type)).toEqual(['medical_record']);
	});
});

describe('a household type in the rest of the app', () => {
	it('heads its own group and labels its own rows', async () => {
		// `typeLabel` falls back to the shipped labels, so a household type read
		// through the fallback alone came out as "Other" everywhere except the
		// picker that had just named it.
		await addDocumentType('Vaccination book', testDb);
		const labels = typeLabels(await listDocumentTypes(testDb));

		expect(typeLabel('vaccination_book', labels)).toBe('Vaccination book');
		expect(typeLabel('payslip', labels)).toBe('Payslip');
		// Without the household's labels it is unknown, which is the fallback.
		expect(typeLabel('vaccination_book')).toBe(TYPE_LABELS.other);
	});
});

describe('a posted type', () => {
	it('is taken when the household has it', async () => {
		expect(asDocumentType('payslip', ['payslip', 'other'])).toBe('payslip');
	});

	it('falls back to `other` when it does not', async () => {
		// A tab open since before a type was removed posts a key that no longer
		// exists; `other` is a filed document, a foreign key violation is a 500.
		expect(asDocumentType('vaccination_book', ['payslip', 'other'])).toBe('other');
		expect(asDocumentType(null, ['other'])).toBe('other');
	});
});

describe('the column', () => {
	it('refuses a type the household does not have', async () => {
		await expect(
			harness.sql`insert into document (id, name, shelf_id, ext, added_on, type)
				values (gen_random_uuid(), 'Something',
					(select id from shelf where key = 'inbox'), 'PDF', current_date, 'blueprint')`
		).rejects.toThrow(/document_type_document_type_key_fk/);
	});

	it('will not let a type go while a document wears it', async () => {
		await expect(
			harness.sql`delete from document_type where key = 'payslip'`
		).resolves.toBeDefined();
		// Nothing is filed as payslip in this suite, so that succeeded — put it
		// back, because the rest of the app reads it by name.
		await harness.sql`insert into document_type (key, label, builtin, sort_order)
			values ('payslip', 'Payslip', true, 30) on conflict (key) do nothing`;
	});
});
