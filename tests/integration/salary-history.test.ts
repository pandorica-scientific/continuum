// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rowId } from '../row-id';
import { document, documentLink, salaryEntry } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makePerson } from './fixtures';
import { latestSalaryByPerson, loadSalaryHistory } from '$lib/server/salary';
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
	await makePerson(testDb, {
		id: ROBERT,
		name: 'Robert',
		initials: 'R',
		role: 'admin',
		birthYear: 1990
	});
});

describe('loadSalaryHistory', () => {
	it('takes every figure from salary_entry, never from the document', async () => {
		// The document is the FILE: it names the month it covers and nothing about
		// money. A payslip that also carried an amount was read as gross while the
		// reader had picked net, which is why the column is gone.
		await makeDocument(testDb, {
			id: DOC,
			name: 'Payslip 2026-08 · Robert',
			shelfKey: 'finance',
			type: 'payslip',
			storedName: 'slip-aug.pdf',
			ext: 'PDF',
			addedOn: '2026-09-01',
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

		const [robert] = await loadSalaryHistory('CZK', same, null, testDb);
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
		const [robert] = await loadSalaryHistory('CZK', same, null, testDb);
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

		const [robert] = await loadSalaryHistory('CZK', same, null, testDb);
		const [year] = robert.years;
		expect(year.grossTotalMinor).toBe(gross * 2n + bonus);
		expect(year.bonusTotalMinor).toBe(bonus);
		// Two months of base at the same rate, the award taken back out.
		expect(year.baseTotalMinor).toBe(gross * 2n);
		expect(year.netTotalMinor).toBeLessThan(year.grossTotalMinor);
	});
});

describe('latestSalaryByPerson', () => {
	// What the Overview's Salary panel reports: the newest month, and the month
	// before it to compare against. Both come off the same fold the year rows
	// use, so the panel and the Salary screen cannot disagree about what July
	// earned — and a month evidenced by two employers is added up in both.
	it('gives the newest month with both jobs in it, and the month before', async () => {
		const jobA = rowId('document-slip-jul-a');
		const jobB = rowId('document-slip-jul-b');
		const financeShelf = await shelfIdByKey('finance', testDb);
		await testDb.insert(document).values(
			[jobA, jobB].map((id) => ({
				id,
				name: `Payslip 2026-07 · ${id}`,
				shelfId: financeShelf,
				type: 'payslip' as const,
				ext: 'PDF',
				addedOn: '2026-08-01',
				periodOn: '2026-07-01'
			}))
		);
		await testDb.insert(salaryEntry).values([
			{
				id: rowId('entry-latest-jun'),
				personId: ROBERT,
				periodMonth: '2026-06',
				netMinor: 6800000n,
				currency: 'CZK',
				source: 'statement'
			},
			{
				id: rowId('entry-latest-jul-a'),
				personId: ROBERT,
				periodMonth: '2026-07',
				grossMinor: 6000000n,
				netMinor: 4260000n,
				currency: 'CZK',
				source: 'payslip',
				documentId: jobA
			},
			{
				id: rowId('entry-latest-jul-b'),
				personId: ROBERT,
				periodMonth: '2026-07',
				grossMinor: 4000000n,
				netMinor: 2840000n,
				currency: 'CZK',
				source: 'payslip',
				documentId: jobB
			}
		]);

		const [robert] = await latestSalaryByPerson('CZK', same, testDb);
		expect(robert.name).toBe('Robert');
		expect(robert.latest).toMatchObject({
			periodMonth: '2026-07',
			grossMinor: 10000000n,
			netMinor: 7100000n
		});
		expect(robert.previous).toMatchObject({ periodMonth: '2026-06', netMinor: 6800000n });
	});
});
