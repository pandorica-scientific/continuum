// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rowId } from '../row-id';
import { document, documentLink, person, salaryEntry } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { loadSalaryHistory } from '$lib/server/salary';
import { shelfIdByKey } from '$lib/server/documents/shelves';

let harness: Harness;
let testDb: TestDb;
const ROBERT = rowId('person-robert');
const DOC = rowId('document-slip-aug');

// Face value: conversion is exercised elsewhere, and a 1:1 rate keeps the
// figures under test readable.
const same = (amount: bigint) => amount;

beforeAll(async () => {
	harness = await startPostgres('salary-history');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from document_link`;
	await harness.sql`delete from salary_entry`;
	await harness.sql`delete from document`;
	await harness.sql`delete from person`;
	await testDb
		.insert(person)
		.values([{ id: ROBERT, name: 'Robert', initials: 'R', role: 'admin', birthYear: 1990 }]);
});

describe('loadSalaryHistory', () => {
	it('takes every figure from salary_entry, never from the document', async () => {
		// The document carries the pre-v0.4.6 net-shaped amount. It must be
		// ignored: reading it as gross is the defect this release exists to fix.
		await testDb.insert(document).values({
			id: DOC,
			name: 'Payslip 2026-08 · Robert',
			shelfId: await shelfIdByKey('finance', testDb),
			type: 'payslip',
			storedName: 'slip-aug.pdf',
			ext: 'PDF',
			addedOn: '2026-09-01',
			amountMinor: 7140000n,
			currency: 'CZK',
			periodOn: '2026-08-01'
		});
		await testDb.insert(documentLink).values({ documentId: DOC, targetId: ROBERT });
		await testDb.insert(salaryEntry).values({
			id: rowId('entry-aug'),
			personId: ROBERT,
			periodMonth: '2026-08',
			grossMinor: 10000000n,
			netMinor: 7140000n,
			bonusMinor: 2500000n,
			currency: 'CZK',
			source: 'payslip',
			documentId: DOC
		});

		const [robert] = await loadSalaryHistory('CZK', same, testDb);
		const [year] = robert.years;
		expect(year.grossTotalMinor).toBe(10000000n);
		expect(year.netTotalMinor).toBe(7140000n);
		expect(year.bonusTotalMinor).toBe(2500000n);
		expect(year.baseTotalMinor).toBe(7500000n);
		expect(robert.payslips[0]).toMatchObject({
			periodMonth: '2026-08',
			grossMinor: 10000000n,
			netMinor: 7140000n,
			bonusMinor: 2500000n,
			file: 'slip-aug.pdf'
		});
	});

	it('reports a month evidenced only by a bank credit', async () => {
		await testDb.insert(salaryEntry).values({
			id: rowId('entry-jul'),
			personId: ROBERT,
			periodMonth: '2026-07',
			grossMinor: null,
			netMinor: 6800000n,
			currency: 'CZK',
			source: 'statement'
		});
		const [robert] = await loadSalaryHistory('CZK', same, testDb);
		expect(robert.years[0].grossMonths).toBe(0);
		expect(robert.years[0].netMonths).toBe(1);
		expect(robert.payslips).toHaveLength(0);
	});

	it('reports a December thirteenth-salary as bonus, not as a raise', async () => {
		// The shape the demo household seeds: eleven plain months and a December
		// carrying half a month again as an award. Base must stay flat across it,
		// because a one-off that moved the base would read as a raise followed by
		// a pay cut when neither happened.
		const gross = 5800000n;
		const bonus = gross / 2n;
		const rows = [
			{ month: '2026-11', grossMinor: gross, bonusMinor: null },
			{ month: '2026-12', grossMinor: gross + bonus, bonusMinor: bonus }
		];
		await testDb.insert(salaryEntry).values(
			rows.map((r, i) => ({
				id: rowId(`entry-demo-${i}`),
				personId: ROBERT,
				periodMonth: r.month,
				grossMinor: r.grossMinor,
				netMinor: r.grossMinor - (r.grossMinor * 29n) / 100n,
				bonusMinor: r.bonusMinor,
				currency: 'CZK',
				source: 'payslip' as const
			}))
		);

		const [robert] = await loadSalaryHistory('CZK', same, testDb);
		const [year] = robert.years;
		expect(year.grossTotalMinor).toBe(gross * 2n + bonus);
		expect(year.bonusTotalMinor).toBe(bonus);
		// Two months of base at the same rate, the award taken back out.
		expect(year.baseTotalMinor).toBe(gross * 2n);
		expect(year.netTotalMinor).toBeLessThan(year.grossTotalMinor);
	});
});
