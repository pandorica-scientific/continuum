// SPDX-License-Identifier: AGPL-3.0-or-later
// What the reader remembers across two employers.
//
// Until v0.5.2 it kept one learned wording per person. A person with two jobs
// in a year therefore had each correction wipe the other employer's wording,
// and neither was ever present when its own slip came round again.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { extractCandidates } from '$lib/salary';
import { learnBonusLabel, learnGrossLabel, learnNetLabel } from '$lib/server/salary';
import { getSetting, setSetting } from '$lib/server/settings';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

let harness: Harness;
let testDb: TestDb;

beforeAll(async () => {
	harness = await startPostgres('salary-learning');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from settings`;
});

// The two payroll layouts, reduced to the lines that matter. Invented figures:
// the wordings are payroll boilerplate, but nobody's pay belongs in a repo.
const A = [
	'Gross salary 111 222 Income tax base 111 222',
	'Social Security 27 111,50 Net salary 80 111'
];
const B = [
	'(1) Empl. rel. 01.10.2025 Gross salary 99 444',
	'Time work: Full-time job 40:00 Net salary 70 555'
];

const candidatesA = () => extractCandidates(A, 'CZK');
const candidatesB = () => extractCandidates(B, 'CZK');

const learned = (key: string) => getSetting<Record<string, string[]>>(key, {}, testDb);

describe('learning a wording from each employer', () => {
	it('keeps both rather than letting the second wipe the first', async () => {
		await learnGrossLabel('Robert', 11122200n, candidatesA(), testDb);
		await learnGrossLabel('Robert', 9944400n, candidatesB(), testDb);
		expect((await learned('payslipGrossLabels')).robert).toEqual([
			'(1) empl. rel. 01.10.2025 gross salary',
			'gross salary'
		]);
	});

	it('does the same for net', async () => {
		await learnNetLabel('Robert', 8011100n, candidatesA(), testDb);
		await learnNetLabel('Robert', 7055500n, candidatesB(), testDb);
		expect((await learned('payslipNetLabels')).robert).toHaveLength(2);
	});

	// The newest correction goes to the front, so where two learned wordings both
	// match, the employer most recently corrected wins.
	it('puts the wording just confirmed first, and never twice', async () => {
		await learnGrossLabel('Robert', 11122200n, candidatesA(), testDb);
		await learnGrossLabel('Robert', 9944400n, candidatesB(), testDb);
		await learnGrossLabel('Robert', 11122200n, candidatesA(), testDb);
		expect((await learned('payslipGrossLabels')).robert).toEqual([
			'gross salary',
			'(1) empl. rel. 01.10.2025 gross salary'
		]);
	});

	it('holds each person apart', async () => {
		await learnGrossLabel('Robert', 11122200n, candidatesA(), testDb);
		await learnGrossLabel('Kseniya', 9944400n, candidatesB(), testDb);
		const stored = await learned('payslipGrossLabels');
		expect(stored.robert).toEqual(['gross salary']);
		expect(stored.kseniya).toEqual(['(1) empl. rel. 01.10.2025 gross salary']);
	});

	// One bare string per person is what the setting held before v0.5.2. It has
	// to keep working, and be widened by the next correction rather than lost.
	it('adopts what was learned under the old one-wording-per-person shape', async () => {
		await setSetting('payslipGrossLabels', { robert: 'gross salary' }, testDb);
		await learnGrossLabel('Robert', 9944400n, candidatesB(), testDb);
		expect((await learned('payslipGrossLabels')).robert).toEqual([
			'(1) empl. rel. 01.10.2025 gross salary',
			'gross salary'
		]);
	});
});

describe('learning which lines were a bonus', () => {
	const withBonus = extractCandidates(
		['Mimořádná odměna 25 000,00', 'Gross salary 111 222 Income tax base 111 222'],
		'CZK'
	);

	// A wording that appears nowhere on the slip in hand belongs to some other
	// payroll, and a correction here says nothing about it.
	it('keeps the other employer’s wordings', async () => {
		await setSetting('payslipBonusLabels', { robert: ['annual award'] }, testDb);
		await learnBonusLabel('Robert', 2500000n, withBonus, testDb);
		const stored = (await learned('payslipBonusLabels')).robert;
		expect(stored).toContain('annual award');
		expect(stored).toContain('mimořádná odměna');
	});

	/**
	 * The opposite case, and the reason this is not a plain merge: a wording that
	 * IS on this slip has just been restated by the correction. Keeping it would
	 * re-add next month the very line the person has said is not part of the
	 * award.
	 */
	it('replaces a wording the correction just spoke about', async () => {
		await setSetting('payslipBonusLabels', { robert: ['gross salary'] }, testDb);
		await learnBonusLabel('Robert', 2500000n, withBonus, testDb);
		expect((await learned('payslipBonusLabels')).robert).not.toContain('gross salary');
	});
});
