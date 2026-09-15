// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import {
	category,
	currencyRate,
	equityGrant,
	equityTranche,
	propertyValuation,
	securityPrice,
	settings,
	taxStatement
} from '$lib/server/db/schema';
import { buildBriefing, type BriefingItem } from '$lib/server/briefing';
import { BRIEFING_SETTINGS_KEY } from '$lib/server/briefing/settings';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import {
	makeAccount,
	makeEngagement,
	makeLane,
	makeOrganisation,
	makePerson,
	makeProperty,
	makeTransaction
} from './fixtures';

/**
 * The sources that watch equity, tax, rates, accounts and valuations.
 *
 * Like `briefing-documents`, this points the module-level `db` singleton at the
 * harness: the sources read it rather than a handle they are given, and the
 * strip is only worth testing the way the Overview builds it.
 */
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
	harness = await startPostgres('briefing', { max: 1 });
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
	// `security_price`, `currency_rate` and `settings` hang off nothing, so they
	// do not go with the cascade and are named here.
	await harness.sql`truncate person, account, property, organisation, equity_grant,
		security_price, currency_rate, settings, category cascade`;
});

const today = new Date().toISOString().slice(0, 10);
const dayFromNow = (days: number) =>
	new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const kindOf = (items: BriefingItem[], kind: string) => items.filter((item) => item.kind === kind);

/** A grant of `units`, with one tranche on `vestsOn`. */
async function seedGrant(options: {
	ticker?: string;
	units?: number;
	vestsOn: string;
	settledOn?: string | null;
	forfeitedOn?: string | null;
	label?: string | null;
}): Promise<{ grantId: string; trancheId: string }> {
	const person = await makePerson(testDb, { name: 'Ada Nováková' });
	const grantId = uuidv7();
	await testDb.insert(equityGrant).values({
		id: grantId,
		personId: person.id,
		ticker: options.ticker ?? 'ACME.US',
		currency: 'CZK',
		grantedOn: '2025-01-01',
		totalUnits: String(options.units ?? 100),
		label: options.label ?? null
	});
	const trancheId = uuidv7();
	await testDb.insert(equityTranche).values({
		id: trancheId,
		grantId,
		vestsOn: options.vestsOn,
		units: String(options.units ?? 100),
		settledOn: options.settledOn ?? null,
		forfeitedOn: options.forfeitedOn ?? null
	});
	return { grantId, trancheId };
}

describe('equity vesting soon', () => {
	it('names the tranche and sends the reader to the salary screen', async () => {
		await seedGrant({ vestsOn: dayFromNow(10), units: 25, label: 'RSU 2025' });

		const { items } = await buildBriefing();
		const item = kindOf(items, 'Equity').find((i) => i.title.includes('vest on'));
		expect(item?.title).toBe(`25 ACME.US units vest on ${dayFromNow(10)}`);
		expect(item?.href).toBe('/salary');
		expect(item?.hue).toBe('grey');
		expect(item?.detail).toContain('RSU 2025');
	});

	it('turns yellow inside a week', async () => {
		await seedGrant({ vestsOn: dayFromNow(3) });

		const { items } = await buildBriefing();
		expect(kindOf(items, 'Equity').find((i) => i.title.includes('vest on'))?.hue).toBe('yellow');
	});

	// A schedule runs for years. Only the next month of it is work.
	it('says nothing about a tranche beyond the horizon', async () => {
		await seedGrant({ vestsOn: dayFromNow(90) });

		const { items } = await buildBriefing();
		expect(kindOf(items, 'Equity').find((i) => i.title.includes('vest on'))).toBeUndefined();
	});
});

describe('equity vested but never settled', () => {
	it('asks for the delivered and withheld units', async () => {
		await seedGrant({ vestsOn: dayFromNow(-40) });

		const { items } = await buildBriefing();
		const item = kindOf(items, 'Equity').find((i) => i.title.includes('never settled'));
		expect(item?.title).toBe('1 vested tranche was never settled');
		expect(item?.detail).toBe('Record the units delivered and the units withheld for tax.');
		expect(item?.href).toBe('/investments');
	});

	// The shares reach the broker days after the vest date; asking the morning
	// after would be asking about something that has not happened yet.
	it('waits out the settlement window', async () => {
		await seedGrant({ vestsOn: dayFromNow(-3) });

		const { items } = await buildBriefing();
		expect(kindOf(items, 'Equity').find((i) => i.title.includes('never settled'))).toBeUndefined();
	});

	it('says nothing once the settlement is recorded', async () => {
		await seedGrant({ vestsOn: dayFromNow(-40), settledOn: dayFromNow(-38) });

		const { items } = await buildBriefing();
		expect(kindOf(items, 'Equity').find((i) => i.title.includes('never settled'))).toBeUndefined();
	});
});

describe('a grant ticker with no price', () => {
	it('names the ticker nothing can value', async () => {
		await seedGrant({ vestsOn: dayFromNow(-400), settledOn: dayFromNow(-398) });

		const { items } = await buildBriefing();
		const item = kindOf(items, 'Equity').find((i) => i.title.includes('no recent close'));
		expect(item?.title).toBe('ACME.US has no recent close');
		expect(item?.href).toBe('/investments');
	});

	it('is satisfied by a close from today', async () => {
		await seedGrant({ vestsOn: dayFromNow(-400), settledOn: dayFromNow(-398) });
		await testDb.insert(securityPrice).values({
			ticker: 'ACME.US',
			day: today,
			closeMinor: 12_000n,
			currency: 'CZK',
			source: 'manual'
		});

		const { items } = await buildBriefing();
		expect(
			kindOf(items, 'Equity').find((i) => i.title.includes('no recent close'))
		).toBeUndefined();
	});

	// The configured tolerance, not a number of this source's own: the same rule
	// labels prices on the investments screen.
	it('raises a close older than the configured tolerance', async () => {
		await seedGrant({ vestsOn: dayFromNow(-400), settledOn: dayFromNow(-398) });
		await testDb.insert(securityPrice).values({
			ticker: 'ACME.US',
			day: dayFromNow(-30),
			closeMinor: 12_000n,
			currency: 'CZK',
			source: 'manual'
		});

		const { items } = await buildBriefing();
		expect(kindOf(items, 'Equity').find((i) => i.title.includes('no recent close'))?.title).toBe(
			'ACME.US has no recent close'
		);
	});
});

describe('an unfiled tax year', () => {
	const lastYear = Number(today.slice(0, 4)) - 1;

	/** Asked from January, so the suite does not pass or fail by the month it runs in. */
	async function askFromJanuary() {
		await testDb
			.insert(settings)
			.values({ key: BRIEFING_SETTINGS_KEY, value: { taxReminderMonth: 1 } });
	}

	it('names the person with a job and no statement', async () => {
		await askFromJanuary();
		const person = await makePerson(testDb, { name: 'Ada Nováková' });
		const employer = await makeOrganisation(testDb, { name: 'ACME s.r.o.' });
		await makeEngagement(testDb, { personId: person.id, organisationId: employer.id });

		const { items } = await buildBriefing();
		const item = kindOf(items, 'Tax')[0];
		expect(item?.title).toBe(`Ada Nováková has no ${lastYear} tax statement`);
		expect(item?.href).toBe('/tax');
	});

	it('says nothing once the year is recorded', async () => {
		await askFromJanuary();
		const person = await makePerson(testDb, { name: 'Ada Nováková' });
		const employer = await makeOrganisation(testDb, { name: 'ACME s.r.o.' });
		await makeEngagement(testDb, { personId: person.id, organisationId: employer.id });
		await testDb.insert(taxStatement).values({
			id: uuidv7(),
			personId: person.id,
			year: lastYear,
			country: 'CZ',
			currency: 'CZK',
			grossIncomeMinor: 1_200_000_00n,
			taxPaidMinor: 180_000_00n
		});

		const { items } = await buildBriefing();
		expect(kindOf(items, 'Tax')).toHaveLength(0);
	});

	// Nobody files on the second of January, and a card that cannot be cleared
	// is one people learn to read past. Skipped in December, where there is no
	// later month of the same year to set it to.
	const thisMonth = Number(today.slice(5, 7));
	it.skipIf(thisMonth === 12)('stays quiet before the month the household set', async () => {
		await testDb
			.insert(settings)
			.values({ key: BRIEFING_SETTINGS_KEY, value: { taxReminderMonth: thisMonth + 1 } });
		const person = await makePerson(testDb, { name: 'Ada Nováková' });
		const employer = await makeOrganisation(testDb, { name: 'ACME s.r.o.' });
		await makeEngagement(testDb, { personId: person.id, organisationId: employer.id });

		const { items } = await buildBriefing();
		expect(kindOf(items, 'Tax')).toHaveLength(0);
	});

	// A household member with no job has nothing this app can call missing.
	it('says nothing about a person with no engagement', async () => {
		await askFromJanuary();
		await makePerson(testDb, { name: 'Ada Nováková' });

		const { items } = await buildBriefing();
		expect(kindOf(items, 'Tax')).toHaveLength(0);
	});
});

describe('a stale exchange rate', () => {
	it('names a currency in use with no recent fixing', async () => {
		await makeAccount(testDb, { name: 'Revolut EUR', currency: 'EUR' });

		const { items } = await buildBriefing();
		const item = kindOf(items, 'Rates')[0];
		expect(item?.title).toBe('EUR has no recent exchange rate');
		expect(item?.href).toBe('/settings');
	});

	it('is satisfied by a fixing from today', async () => {
		await makeAccount(testDb, { name: 'Revolut EUR', currency: 'EUR' });
		await testDb.insert(currencyRate).values({ code: 'EUR', day: today, rate: '24.905' });

		const { items } = await buildBriefing();
		expect(kindOf(items, 'Rates')).toHaveLength(0);
	});

	// The rate table quotes CZK per unit, so CZK has no rate of its own.
	it('says nothing about the base currency', async () => {
		await makeAccount(testDb, { name: 'Fio běžný', currency: 'CZK' });

		const { items } = await buildBriefing();
		expect(kindOf(items, 'Rates')).toHaveLength(0);
	});
});

describe('an account nothing has been imported into', () => {
	it('names it and opens its ledger', async () => {
		const account = await makeAccount(testDb, {
			name: 'Fio běžný',
			balanceOn: dayFromNow(-200)
		});

		const { items } = await buildBriefing();
		const item = kindOf(items, 'Account')[0];
		expect(item?.title).toBe(`Fio běžný has had nothing new since ${dayFromNow(-200)}`);
		expect(item?.href).toBe(`/transactions?account=${account.id}`);
	});

	it('is satisfied by a recent movement', async () => {
		const account = await makeAccount(testDb, { name: 'Fio běžný', balanceOn: dayFromNow(-200) });
		await makeTransaction(testDb, { accountId: account.id, bookedOn: dayFromNow(-2) });

		const { items } = await buildBriefing();
		expect(kindOf(items, 'Account')).toHaveLength(0);
	});

	// An account with neither a statement nor a movement has never been used,
	// which is not an account falling behind.
	it('says nothing about an account that has never been used', async () => {
		await makeAccount(testDb, { name: 'Fio běžný' });

		const { items } = await buildBriefing();
		expect(kindOf(items, 'Account')).toHaveLength(0);
	});
});

describe('a property valuation going out of date', () => {
	it('names the flat and opens its tab', async () => {
		const flat = await makeProperty(testDb, { name: 'Flat Karlín' });
		await testDb.insert(propertyValuation).values({
			id: uuidv7(),
			propertyId: flat.id,
			valuedOn: dayFromNow(-500),
			valueMinor: 9_900_000_00n,
			currency: 'CZK'
		});

		const { items } = await buildBriefing();
		const item = kindOf(items, 'Property')[0];
		expect(item?.title).toBe(`Flat Karlín was last valued ${dayFromNow(-500)}`);
		expect(item?.href).toBe(`/property?p=${flat.id}`);
	});

	it('is satisfied by a valuation from this year', async () => {
		const flat = await makeProperty(testDb, { name: 'Flat Karlín' });
		await testDb.insert(propertyValuation).values({
			id: uuidv7(),
			propertyId: flat.id,
			valuedOn: dayFromNow(-60),
			valueMinor: 9_900_000_00n,
			currency: 'CZK'
		});

		const { items } = await buildBriefing();
		expect(kindOf(items, 'Property')).toHaveLength(0);
	});
});

describe('a salary credit that belongs to nobody', () => {
	/** A joint account: no owner, so nothing but an attribution can answer. */
	async function seedSalaryCredit(name: string) {
		await testDb
			.insert(category)
			.values({ id: 'salary', groupKey: 'income', name: 'Salary' })
			.onConflictDoNothing();
		const account = await makeAccount(testDb, { name, ownerPersonId: null });
		await makeTransaction(testDb, {
			accountId: account.id,
			bookedOn: today,
			amountMinor: 65_000_00n,
			counterparty: 'ACME S.R.O. 09/2026',
			categoryId: 'salary'
		});
		return account;
	}

	it('counts the credits per account and sends the reader to the salary screen', async () => {
		await seedSalaryCredit('Společný účet');

		const { items } = await buildBriefing();
		const item = kindOf(items, 'Salary')[0];
		expect(item?.title).toBe('1 salary credit in Společný účet belongs to nobody');
		expect(item?.href).toBe('/salary');
	});
});

describe('a paperwork lane that has stopped', () => {
	it('names the organisation and opens its shelf', async () => {
		const person = await makePerson(testDb, { name: 'Ada Nováková' });
		const employer = await makeOrganisation(testDb, { name: 'ACME s.r.o.' });
		// The relationship is what bounds the lane: without a start, no month is
		// missing anything.
		await makeEngagement(testDb, {
			personId: person.id,
			organisationId: employer.id,
			startsOn: dayFromNow(-400)
		});
		await makeLane(testDb, { entityId: employer.id, label: 'Payslips', cadence: 'monthly' });

		const { items } = await buildBriefing();
		const item = kindOf(items, 'Paper').find((i) => i.title.includes('is behind on'));
		expect(item?.title).toContain('ACME s.r.o. is behind on');
		expect(item?.href).toBe('/documents?shelf=income_tax');
		expect(item?.rank).toBe(35);
	});

	// A lane with no rhythm has nothing to be missing from.
	it('says nothing about a lane with no cadence', async () => {
		const person = await makePerson(testDb, { name: 'Ada Nováková' });
		const employer = await makeOrganisation(testDb, { name: 'ACME s.r.o.' });
		await makeEngagement(testDb, {
			personId: person.id,
			organisationId: employer.id,
			startsOn: dayFromNow(-400)
		});
		await makeLane(testDb, { entityId: employer.id, label: 'Contracts', cadence: 'none' });

		const { items } = await buildBriefing();
		expect(kindOf(items, 'Paper').find((i) => i.title.includes('is behind on'))).toBeUndefined();
	});
});
