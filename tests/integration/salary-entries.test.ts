// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rowId } from '../row-id';
import { account, person, salaryEntry } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import {
	attributeSalary,
	attributionKey,
	recordSalary,
	rememberAttribution,
	salaryMonths
} from '$lib/server/salary';

let harness: Harness;
let testDb: TestDb;
const ROBERT = rowId('person-robert');
const KSENIYA = rowId('person-kseniya');
const JOINT = rowId('account-joint');
const HERS = rowId('account-hers');

beforeAll(async () => {
	harness = await startPostgres('salary-entries');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from salary_attribution`;
	await harness.sql`delete from salary_entry`;
	await harness.sql`delete from account`;
	await harness.sql`delete from person`;
	await testDb.insert(person).values([
		{ id: ROBERT, name: 'Robert', initials: 'R', role: 'admin' },
		{ id: KSENIYA, name: 'Kseniya', initials: 'K', role: 'member' }
	]);
	await testDb.insert(account).values([
		{ id: JOINT, name: 'Joint', bank: 'fio', kind: 'current', currency: 'CZK' },
		{
			id: HERS,
			name: 'Hers',
			bank: 'fio',
			kind: 'current',
			currency: 'CZK',
			ownerPersonId: KSENIYA
		}
	]);
});

const month = async () =>
	(await salaryMonths(ROBERT, testDb)).map((m) => ({
		gross: m.grossMinor === null ? null : String(m.grossMinor),
		net: m.netMinor === null ? null : String(m.netMinor),
		source: m.source,
		overridden: m.amountOverridden
	}));

// Gross and net are two FIELDS of one observation, not two rows. A payslip
// states gross; a bank credit is net.
describe('recording a month from both directions', () => {
	it('merges a payslip and a bank credit into one entry', async () => {
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-07',
				currency: 'CZK',
				netMinor: 52_310_00n,
				source: 'statement'
			},
			testDb
		);
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-07',
				currency: 'CZK',
				grossMinor: 68_400_00n,
				source: 'payslip'
			},
			testDb
		);

		expect(await month()).toEqual([
			{ gross: '6840000', net: '5231000', source: 'statement', overridden: false }
		]);
	});

	it('fills only what is missing, in either order', async () => {
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-07',
				currency: 'CZK',
				grossMinor: 68_400_00n,
				source: 'payslip'
			},
			testDb
		);
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-07',
				currency: 'CZK',
				netMinor: 52_310_00n,
				source: 'statement'
			},
			testDb
		);
		const [entry] = await month();
		expect(entry.gross).toBe('6840000');
		expect(entry.net).toBe('5231000');
	});

	// The flag is what makes a derived entry editable at all: without it the next
	// import would quietly undo the correction.
	it('never overwrites a figure somebody corrected by hand', async () => {
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-07',
				currency: 'CZK',
				netMinor: 50_000_00n,
				source: 'manual',
				overridden: true
			},
			testDb
		);
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth: '2026-07',
				currency: 'CZK',
				netMinor: 52_310_00n,
				source: 'statement'
			},
			testDb
		);

		const [entry] = await month();
		expect(entry.net).toBe('5000000');
		expect(entry.overridden).toBe(true);
	});

	it('refuses a month that is not one, and an entry with no figure', async () => {
		expect(
			await recordSalary(
				{ personId: ROBERT, periodMonth: 'July', currency: 'CZK', netMinor: 1n, source: 'manual' },
				testDb
			)
		).toMatchObject({ ok: false, status: 400 });
		expect(
			await recordSalary(
				{ personId: ROBERT, periodMonth: '2026-07', currency: 'CZK', source: 'manual' },
				testDb
			)
		).toMatchObject({ ok: false, status: 400 });
		expect(await testDb.select().from(salaryEntry)).toHaveLength(0);
	});
});

describe('whose salary it is', () => {
	it('is the account owner, with nothing to ask', async () => {
		expect(
			await attributeSalary(
				{ accountOwnerPersonId: KSENIYA, counterparty: 'ACME Corp', accountId: HERS },
				testDb
			)
		).toEqual({ personId: KSENIYA });
	});

	it('has to be asked for a joint account, and is remembered afterwards', async () => {
		const first = await attributeSalary(
			{ accountOwnerPersonId: null, counterparty: 'ACME Corp s.r.o.', accountId: JOINT },
			testDb
		);
		expect(first.personId).toBeNull();
		expect(first).toMatchObject({ askFor: 'acme corp s r o' });

		await rememberAttribution({ matchKey: 'ACME Corp s.r.o.', personId: ROBERT }, testDb);

		// Asked once per employer, not once per payday: the description varies
		// between months, so the key is letters and digits only.
		expect(
			await attributeSalary(
				{ accountOwnerPersonId: null, counterparty: 'ACME CORP S.R.O. 07/2026', accountId: JOINT },
				testDb
			)
		).toEqual({ personId: ROBERT });
	});

	// The case a key-only match gets wrong: both people paid by one employer.
	it('prefers an attribution naming this account over one naming none', async () => {
		await rememberAttribution({ matchKey: 'ACME', personId: ROBERT }, testDb);
		await rememberAttribution({ matchKey: 'ACME', personId: KSENIYA, accountId: JOINT }, testDb);

		expect(
			await attributeSalary(
				{ accountOwnerPersonId: null, counterparty: 'ACME', accountId: JOINT },
				testDb
			)
		).toEqual({ personId: KSENIYA });
	});

	it('has nothing to go on when the statement names no counterparty', async () => {
		expect(
			await attributeSalary(
				{ accountOwnerPersonId: null, counterparty: null, accountId: JOINT },
				testDb
			)
		).toEqual({ personId: null, askFor: null });
	});
});

describe('attributionKey', () => {
	it('survives the noise a statement carries', () => {
		expect(attributionKey('ACME Corp s.r.o.')).toBe('acme corp s r o');
		expect(attributionKey('  ACME   CORP  ')).toBe('acme corp');
		expect(attributionKey('Česká pošta')).toBe('ceska posta');
		expect(attributionKey('!!!')).toBe('');
	});
});

// The prefix rule earns its own cases: it is the difference between asking once
// per employer and asking every payday, and a careless version of it would
// attach one attribution to half the ledger.
describe('matching an employer across months', () => {
	beforeEach(async () => {
		await rememberAttribution({ matchKey: 'ACME Corp', personId: ROBERT }, testDb);
	});

	const whose = (counterparty: string) =>
		attributeSalary({ accountOwnerPersonId: null, counterparty, accountId: JOINT }, testDb);

	it('matches the same employer however the month is appended', async () => {
		expect(await whose('ACME Corp 07/2026')).toEqual({ personId: ROBERT });
		expect(await whose('ACME CORP — 08/2026 salary')).toEqual({ personId: ROBERT });
	});

	it('does not match a different employer that merely starts the same way', async () => {
		// "acme corporation" does not begin with "acme corp " — the boundary
		// matters, or every ACME-something in the ledger becomes Robert's salary.
		const result = await whose('ACME Corporation Holdings');
		expect(result.personId).toBeNull();
	});

	it('prefers the more specific key when two could match', async () => {
		await rememberAttribution({ matchKey: 'ACME Corp Prague', personId: KSENIYA }, testDb);
		expect(await whose('ACME Corp Prague 07/2026')).toEqual({ personId: KSENIYA });
		expect(await whose('ACME Corp Brno 07/2026')).toEqual({ personId: ROBERT });
	});
});
