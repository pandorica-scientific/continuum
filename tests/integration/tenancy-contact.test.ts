// SPDX-License-Identifier: AGPL-3.0-or-later
import { rowId } from '../row-id';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeContact, makeProperty } from './fixtures';
import { createTenancy, setPropertyFigure } from '$lib/server/property/mutations';

let harness: Harness;
let testDb: TestDb;
const PROPERTY = rowId('property-a');

async function addTenancy(
	key: string,
	tenantName: string,
	dates: { startsOn?: string | null; endsOn?: string | null } = {}
) {
	return createTenancy(
		{
			id: rowId(key),
			propertyId: PROPERTY,
			tenantName,
			rentMinor: 1_650_000n,
			depositMinor: 0n,
			startsOn: dates.startsOn ?? null,
			endsOn: dates.endsOn ?? null,
			renewalNoticeOn: null
		},
		testDb
	);
}

/** The contacts a tenancy is linked to, by name. */
async function contactsFor(key: string): Promise<string[]> {
	const links = await testDb
		.select()
		.from(schema.contactLink)
		.where(eq(schema.contactLink.targetId, rowId(key)));
	const names: string[] = [];
	for (const link of links) {
		const [row] = await testDb
			.select()
			.from(schema.contact)
			.where(eq(schema.contact.id, link.contactId));
		if (row) names.push(row.name);
	}
	return names.sort();
}

beforeAll(async () => {
	harness = await startPostgres('tenancy-contact');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`truncate property, contact cascade`;
	await makeProperty(testDb, {
		id: PROPERTY,
		name: 'Flat A',
		kind: 'rented',
		currency: 'CZK'
	});
});

describe('createTenancy', () => {
	it('creates a contact for a tenant who is not in the address book', async () => {
		const result = await addTenancy('tenancy-a', 'Martin Dvořák');
		expect(result.ok).toBe(true);

		const contacts = await testDb.select().from(schema.contact);
		expect(contacts).toHaveLength(1);
		expect(contacts[0].name).toBe('Martin Dvořák');
		expect(contacts[0].category).toBe('tenant');
		expect(await contactsFor('tenancy-a')).toEqual(['Martin Dvořák']);
	});

	it('reuses an existing contact rather than creating a second one', async () => {
		await makeContact(testDb, {
			id: rowId('contact-martin'),
			name: 'Martin Dvořák',
			phone: '+420 111 222 333'
		});

		await addTenancy('tenancy-a', 'Martin Dvořák');

		const contacts = await testDb.select().from(schema.contact);
		expect(contacts).toHaveLength(1);
		// The existing record keeps everything already known about them.
		expect(contacts[0].phone).toBe('+420 111 222 333');
		expect(await contactsFor('tenancy-a')).toEqual(['Martin Dvořák']);
	});

	it('matches an existing contact whose name differs only by diacritics or case', async () => {
		await makeContact(testDb, {
			id: rowId('contact-martin'),
			name: 'Martin Dvořák'
		});

		// Typed in a hurry, without the diacritics. A second "Martin Dvorak" in
		// the address book is exactly what was reported as missing dedup.
		await addTenancy('tenancy-a', 'martin dvorak');

		expect(await testDb.select().from(schema.contact)).toHaveLength(1);
		expect(await contactsFor('tenancy-a')).toEqual(['Martin Dvořák']);
	});

	it('accepts a lease with no end date, and a later one still cannot overlap it', async () => {
		const open = await addTenancy('tenancy-open', 'Martin Dvořák', {
			startsOn: '2026-01-01',
			endsOn: null
		});
		expect(open.ok).toBe(true);

		const clash = await addTenancy('tenancy-clash', 'Someone Else', {
			startsOn: '2026-06-01',
			endsOn: '2026-12-31'
		});
		expect(clash).toEqual({
			ok: false,
			status: 409,
			message: 'That tenancy overlaps an existing tenancy.'
		});
	});

	it('writes no contact when the tenancy itself is refused', async () => {
		await addTenancy('tenancy-open', 'Martin Dvořák', { startsOn: '2026-01-01', endsOn: null });
		await addTenancy('tenancy-clash', 'Nobody At All', {
			startsOn: '2026-06-01',
			endsOn: '2026-12-31'
		});

		// The refusal rolls back the whole transaction, so a rejected tenancy
		// cannot leave a stray contact behind in the address book.
		const names = (await testDb.select().from(schema.contact)).map((c) => c.name);
		expect(names).not.toContain('Nobody At All');
	});
});

describe('setPropertyFigure', () => {
	it('updates the estimated value and stamps when it was valued', async () => {
		const result = await setPropertyFigure(
			{ propertyId: PROPERTY, field: 'value', amount: '9 250 000', valuedOn: '2026-08-20' },
			testDb
		);
		expect(result.ok).toBe(true);

		const [row] = await testDb.select().from(schema.property);
		expect(row.valueMinor).toBe(925_000_000n);
		expect(row.valuedOn).toBe('2026-08-20');
	});

	it('updates money in without touching the valuation date', async () => {
		await setPropertyFigure(
			{ propertyId: PROPERTY, field: 'value', amount: '9 250 000', valuedOn: '2026-08-20' },
			testDb
		);
		await setPropertyFigure(
			{ propertyId: PROPERTY, field: 'moneyIn', amount: '1 500 000', valuedOn: null },
			testDb
		);

		const [row] = await testDb.select().from(schema.property);
		expect(row.moneyInMinor).toBe(150_000_000n);
		// Money in is not a valuation, so recording it must not claim the flat was
		// revalued today — that date drives what the estimate is trusted for.
		expect(row.valuedOn).toBe('2026-08-20');
	});

	it('refuses an amount that is not a number', async () => {
		const result = await setPropertyFigure(
			{ propertyId: PROPERTY, field: 'value', amount: 'about nine million', valuedOn: null },
			testDb
		);
		expect(result).toEqual({ ok: false, status: 400, message: 'That is not an amount.' });
	});

	it('refuses a negative amount', async () => {
		const result = await setPropertyFigure(
			{ propertyId: PROPERTY, field: 'value', amount: '-1', valuedOn: null },
			testDb
		);
		expect(result.ok).toBe(false);
	});

	it('reports a property that is not there', async () => {
		const result = await setPropertyFigure(
			{ propertyId: rowId('no-such-flat'), field: 'value', amount: '1', valuedOn: null },
			testDb
		);
		expect(result).toEqual({ ok: false, status: 404, message: 'Property not found.' });
	});
});
