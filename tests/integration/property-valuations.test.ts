// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { property, propertyOpening } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeProperty } from './fixtures';
import {
	moneyInFromOpening,
	recordOpening,
	recordValuation,
	valuationHistory
} from '$lib/server/property/valuations';

let harness: Harness;
let testDb: TestDb;
const FLAT = rowId('property-1');

beforeAll(async () => {
	harness = await startPostgres('property-valuations');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from property_valuation`;
	await harness.sql`delete from property_opening`;
	await harness.sql`delete from property`;
	await makeProperty(testDb, {
		id: FLAT,
		name: 'Karlín',
		kind: 'lived',
		currency: 'CZK'
	});
});

const valuations = async () =>
	(await valuationHistory(FLAT, testDb)).map((v) => [v.valuedOn, String(v.valueMinor), v.source]);

const flat = async () => (await testDb.select().from(property).where(eq(property.id, FLAT)))[0];

describe('a property’s value over time', () => {
	it('keeps the series in date order, oldest first', async () => {
		await recordValuation(FLAT, { valuedOn: '2026-01-01', valueMinor: 700_000_00n }, testDb);
		await recordValuation(FLAT, { valuedOn: '2019-06-01', valueMinor: 420_000_00n }, testDb);
		await recordValuation(FLAT, { valuedOn: '2023-01-15', valueMinor: 610_000_00n }, testDb);

		expect((await valuations()).map((v) => v[0])).toEqual([
			'2019-06-01',
			'2023-01-15',
			'2026-01-01'
		]);
	});

	// The column is not abandoned: net worth, the tiles and the appreciation
	// figure all still read it. It now means "the most recent valuation".
	it('leaves property.value_minor as the latest valuation', async () => {
		await recordValuation(FLAT, { valuedOn: '2026-01-01', valueMinor: 700_000_00n }, testDb);
		expect(String((await flat()).valueMinor)).toBe('70000000');
		expect((await flat()).valuedOn).toBe('2026-01-01');

		// Entering HISTORY must not rewrite today's figure — which is what makes
		// recording a flat owned for years safe.
		await recordValuation(FLAT, { valuedOn: '2019-06-01', valueMinor: 420_000_00n }, testDb);
		expect(String((await flat()).valueMinor)).toBe('70000000');
		expect((await flat()).valuedOn).toBe('2026-01-01');
	});

	it('treats the same day twice as a correction, not a second opinion', async () => {
		await recordValuation(FLAT, { valuedOn: '2026-01-01', valueMinor: 700_000_00n }, testDb);
		await recordValuation(FLAT, { valuedOn: '2026-01-01', valueMinor: 740_000_00n }, testDb);
		expect(await valuations()).toEqual([['2026-01-01', '74000000', 'estimate']]);
	});

	it('refuses a bad date, a negative value, and a property that is not there', async () => {
		expect(
			await recordValuation(FLAT, { valuedOn: 'whenever', valueMinor: 1n }, testDb)
		).toMatchObject({ ok: false, status: 400 });
		expect(
			await recordValuation(FLAT, { valuedOn: '2026-01-01', valueMinor: -1n }, testDb)
		).toMatchObject({ ok: false, status: 400 });
		expect(
			await recordValuation(rowId('nope'), { valuedOn: '2026-01-01', valueMinor: 1n }, testDb)
		).toMatchObject({ ok: false, status: 404 });
	});
});

describe('the position a property was bought in', () => {
	it('computes money-in from the deposit and the costs of buying', async () => {
		expect(
			await recordOpening(
				FLAT,
				{
					purchasedOn: '2019-06-01',
					priceMinor: 420_000_00n,
					costsMinor: 15_000_00n,
					depositMinor: 84_000_00n
				},
				testDb
			)
		).toEqual({ ok: true });

		// The household's own cash, not the whole price: most of the price is the
		// bank's, and the part that becomes theirs arrives as the mortgage is
		// repaid — which the loan already records. Counting the price here would
		// double it.
		expect(String((await flat()).moneyInMinor)).toBe('9900000');
	});

	it('starts the value series where the ownership did', async () => {
		await recordOpening(
			FLAT,
			{
				purchasedOn: '2019-06-01',
				priceMinor: 420_000_00n,
				costsMinor: 0n,
				depositMinor: 0n
			},
			testDb
		);
		expect(await valuations()).toEqual([['2019-06-01', '42000000', 'purchase']]);
	});

	it('can be corrected without piling up rows', async () => {
		const input = {
			purchasedOn: '2019-06-01',
			priceMinor: 420_000_00n,
			costsMinor: 0n,
			depositMinor: 0n
		};
		await recordOpening(FLAT, input, testDb);
		await recordOpening(FLAT, { ...input, costsMinor: 15_000_00n }, testDb);

		expect(await testDb.select().from(propertyOpening)).toHaveLength(1);
		expect(await valuations()).toHaveLength(1);
		expect(String((await flat()).moneyInMinor)).toBe('1500000');
	});

	it('refuses a deposit larger than the price, and negative figures', async () => {
		expect(
			await recordOpening(
				FLAT,
				{ purchasedOn: null, priceMinor: 100n, costsMinor: 0n, depositMinor: 200n },
				testDb
			)
		).toMatchObject({ ok: false, status: 400 });
		expect(
			await recordOpening(
				FLAT,
				{ purchasedOn: null, priceMinor: -1n, costsMinor: 0n, depositMinor: 0n },
				testDb
			)
		).toMatchObject({ ok: false, status: 400 });
	});
});

describe('moneyInFromOpening', () => {
	it('is the deposit plus what buying cost', () => {
		expect(moneyInFromOpening({ depositMinor: 84_000_00n, costsMinor: 15_000_00n })).toBe(
			99_000_00n
		);
	});
});
