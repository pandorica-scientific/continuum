// Demo mode: with DEMO=1 a pristine instance seeds itself with a fictional
// household — Jana & Petr Novák, two flats on one shared mortgage, six months
// of categorised cash flow, payslips, a portfolio snapshot — so screenshots
// and first impressions need no real data. Runs only when no person exists;
// a set-up instance is never touched.

import { randomUUID } from 'node:crypto';
import { db } from '$lib/server/db';
import { initialsFor } from '$lib/people';
import {
	account,
	brokerImportState,
	document,
	documentPerson,
	documentProperty,
	loan,
	loanFixationPeriod,
	loanProperty,
	person,
	portfolioSnapshot,
	property,
	propertyBill,
	rule,
	taxStatement,
	taxStatementLine,
	tenancy,
	transaction
} from '$lib/server/db/schema';
import { saveSplits } from '$lib/server/splits';
import { FINGERPRINT_VERSION } from '$lib/server/import/fingerprint';
import { setTransactionTags } from '$lib/server/tags';
import { hashPassword } from '$lib/server/auth';
import { setSetting } from '$lib/server/settings';

export const DEMO_PASSWORD = 'demo-demo-demo';

function monthShift(base: string, offset: number): string {
	const [y, m] = base.split('-').map(Number);
	const total = y * 12 + (m - 1) + offset;
	return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export async function seedDemo(): Promise<void> {
	await setSetting('householdName', 'Novák household (demo)');
	await setSetting('baseCurrency', 'CZK');

	const jana = randomUUID();
	const petr = randomUUID();
	const passwordHash = await hashPassword(DEMO_PASSWORD);
	await db.insert(person).values([
		{
			id: jana,
			name: 'Jana Nováková',
			initials: initialsFor('Jana Nováková'),
			role: 'admin',
			birthYear: 1990,
			passwordHash
		},
		{
			id: petr,
			name: 'Petr Novák',
			initials: initialsFor('Petr Novák'),
			role: 'member',
			birthYear: 1988,
			passwordHash
		}
	]);

	const fio = randomUUID();
	const revolut = randomUUID();
	await db.insert(account).values([
		{
			id: fio,
			name: 'Fio běžný',
			emoji: '🏦',
			bank: 'fio',
			kind: 'current',
			currency: 'CZK',
			ownerPersonId: jana,
			balanceMinor: 24350000n,
			balanceAsOf: new Date().toISOString().slice(0, 10)
		},
		{
			id: revolut,
			name: 'Revolut',
			emoji: '💳',
			bank: 'revolut',
			kind: 'current',
			currency: 'EUR',
			ownerPersonId: petr,
			balanceMinor: 310000n,
			balanceAsOf: new Date().toISOString().slice(0, 10)
		}
	]);

	// Six months of categorised, review-free cash flow.
	const thisMonth = new Date().toISOString().slice(0, 7);
	const rows: (typeof transaction.$inferInsert)[] = [];
	const add = (
		month: string,
		day: string,
		amount: bigint,
		categoryId: string,
		counterparty: string
	) =>
		rows.push({
			id: randomUUID(),
			accountId: fio,
			bookedAt: `${month}-${day}`,
			amount,
			currency: 'CZK',
			counterparty,
			dedupFingerprint: `demo-${rows.length}`,
			fingerprintVersion: FINGERPRINT_VERSION,
			categoryId,
			reviewState: 'filed'
		});
	for (let i = 5; i >= 0; i--) {
		const m = monthShift(thisMonth, -i);
		add(m, '01', 6200000n, 'salary', 'Zaměstnavatel s.r.o.');
		add(m, '02', 1650000n, 'rent-income', 'Nájemce · Karlín');
		add(m, '05', -5445600n, 'mortgage-main', 'Česká spořitelna · hypotéka');
		add(m, '06', -485000n, 'svj-insurance', 'SVJ Vinohradská');
		add(m, '08', -312000n, 'groceries', 'Albert');
		add(m, '15', -288000n, 'groceries', 'Lidl');
		add(m, '22', -274000n, 'groceries', 'Kaufland');
		add(m, '10', -240000n, 'energy', 'ČEZ Prodej');
		add(m, '11', -64900n, 'internet-phone', 'O2 Czech Republic');
		add(m, '12', -182000n, 'fuel-tolls', 'Shell');
		add(m, '18', -245000n, 'eating-out', 'Restaurace U Nováků');
		add(m, '20', -119000n, 'everything-else', 'Alza.cz');
		add(m, '25', -1000000n, 'brokerage', 'XTB deposit');
	}
	await db.insert(transaction).values(rows);

	// One Alza purchase divided between a gadget and materials for a project,
	// and a tag over the project's spending — so demo mode shows both features
	// rather than an empty tags screen.
	const alza = rows.find((r) => r.counterparty === 'Alza.cz');
	if (alza) {
		await saveSplits(alza.id, [
			{ amountMinor: 79000n, categoryId: 'everything-else', note: 'Kettle' },
			{ amountMinor: 40000n, categoryId: 'everything-else', note: 'Shelving' }
		]);
		await setTransactionTags(alza.id, ['Renovation 2026']);
	}
	const cez = rows.filter((r) => r.counterparty === 'ČEZ Prodej').slice(0, 2);
	for (const row of cez) await setTransactionTags(row.id, ['Renovation 2026']);

	// A hand-written rule that the old single-matcher categoriser could not have
	// expressed: a counterparty *and* an amount floor. It starts from no
	// evidence, so the rules screen shows it earning trust rather than assuming
	// it — unlike the seeded rules beside it.
	await db.insert(rule).values({
		id: randomUUID(),
		name: 'Big Alza purchases',
		provenance: 'manual',
		conditions: [
			{ field: 'counterparty', op: 'contains', value: 'alza' },
			{ field: 'amount', op: 'between', min: '100000', max: null, currency: 'CZK' }
		],
		categoryId: 'everything-else'
	});

	// Two flats, one mortgage over both at explicit shares.
	const flatA = randomUUID();
	const flatB = randomUUID();
	await db.insert(property).values([
		{
			id: flatA,
			name: 'Flat Vinohrady',
			sizeLabel: '3+kk · 78 m²',
			kind: 'lived',
			currency: 'CZK',
			valueMinor: 890000000n,
			valuedAt: new Date().toISOString().slice(0, 10),
			moneyInMinor: 310000000n,
			boughtYear: 2019,
			images: {
				photos: [],
				drawing: {
					cellCm: 20,
					rooms: [
						{
							name: 'Living room',
							cells: Array.from({ length: 15 * 12 }, (_, k) => [
								5 + (k % 15),
								5 + Math.floor(k / 15)
							]) as [number, number][]
						},
						{
							name: 'Bedroom',
							cells: Array.from({ length: 12 * 10 }, (_, k) => [
								22 + (k % 12),
								5 + Math.floor(k / 12)
							]) as [number, number][]
						}
					]
				}
			}
		},
		{
			id: flatB,
			name: 'Flat Karlín',
			sizeLabel: '2+kk · 54 m²',
			kind: 'rented',
			currency: 'CZK',
			valueMinor: 610000000n,
			valuedAt: new Date().toISOString().slice(0, 10),
			moneyInMinor: 180000000n,
			boughtYear: 2022
		}
	]);
	const mortgage = randomUUID();
	await db.insert(loan).values({
		id: mortgage,
		name: 'Mortgage ČS',
		lender: 'Česká spořitelna',
		kind: 'mortgage',
		currency: 'CZK',
		principalMinor: 990000000n,
		owedMinor: 927000000n,
		owedAsOf: new Date().toISOString().slice(0, 10),
		startDate: '2026-02-11',
		regime: 'fixed_period',
		dayCount: 'act/360',
		accrualStyle: 'calendar',
		paymentDay: 18,
		interestDeductible: 1
	});
	await db.insert(loanProperty).values([
		{ id: randomUUID(), loanId: mortgage, propertyId: flatA, sharePct: '62.5' },
		{ id: randomUUID(), loanId: mortgage, propertyId: flatB, sharePct: '37.5' }
	]);
	await db.insert(loanFixationPeriod).values({
		id: randomUUID(),
		loanId: mortgage,
		startDate: '2026-02-11',
		endDate: '2031-02-11',
		annualRatePct: '4.44',
		paymentMinor: 5445600n
	});

	await db.insert(tenancy).values({
		id: randomUUID(),
		propertyId: flatB,
		tenantName: 'Martin Dvořák',
		tenantContact: '+420 777 000 111',
		rentMinor: 1650000n,
		depositMinor: 3300000n,
		startDate: '2025-06-01',
		endDate: monthShift(thisMonth, 10) + '-01',
		renewalNoticeDate: monthShift(thisMonth, 7) + '-01'
	});
	await db.insert(propertyBill).values([
		{ id: randomUUID(), propertyId: flatA, label: 'SVJ fee & repair fund', amountMinor: 485000n },
		{ id: randomUUID(), propertyId: flatA, label: 'Electricity advance', amountMinor: 240000n },
		{ id: randomUUID(), propertyId: flatB, label: 'SVJ fee', amountMinor: 310000n }
	]);

	const demoPortfolioAsOf = new Date();
	await db.insert(portfolioSnapshot).values({
		day: demoPortfolioAsOf.toISOString().slice(0, 10),
		valueMinor: 41200000n,
		currency: 'CZK'
	});
	await db.insert(brokerImportState).values({
		id: 'global',
		latestGeneratedAt: demoPortfolioAsOf,
		currency: 'CZK'
	});

	// Payslips feed the salary tracker; a contract shows document linking.
	const today = new Date().toISOString().slice(0, 10);
	const payslips: (typeof document.$inferInsert)[] = [];
	for (let i = 11; i >= 0; i--) {
		const m = monthShift(thisMonth, -i - 1);
		const year = Number(m.slice(0, 4));
		const base = 5800000n + BigInt(year - 2024) * 400000n;
		payslips.push({
			id: randomUUID(),
			name: `Payslip ${m} · Jana Nováková`,
			shelf: 'payslips',
			addedOn: today,
			amountMinor: base,
			amountCurrency: 'CZK',
			periodMonth: m
		});
	}
	const contractId = randomUUID();
	payslips.push({
		id: contractId,
		name: 'Renting contract · Karlín',
		shelf: 'tenancy',
		addedOn: today,
		expiresOn: monthShift(thisMonth, 10) + '-01',
		expiryVerb: 'ends'
	});
	await db.insert(document).values(payslips);
	// Real links, not names: payslips belong to Jana, the contract to the flat.
	await db
		.insert(documentPerson)
		.values(
			payslips
				.filter((d) => d.shelf === 'payslips')
				.map((d) => ({ documentId: d.id, personId: jana }))
		)
		.onConflictDoNothing();
	await db
		.insert(documentProperty)
		.values({ documentId: contractId, propertyId: flatB })
		.onConflictDoNothing();

	// Tax statements: two Czech years for Jana (the payslips diverge from the
	// declared figure on purpose — bonuses exist), one Polish year for Petr so
	// the charts show the two-country case and a rate that is comparable
	// across currencies that are not.
	const janaCz2024 = randomUUID();
	await db.insert(taxStatement).values([
		{
			id: janaCz2024,
			personId: jana,
			year: 2024,
			country: 'CZ',
			currency: 'CZK',
			grossIncomeMinor: 129000000n,
			taxPaidMinor: 18100000n
		},
		{
			id: randomUUID(),
			personId: jana,
			year: 2025,
			country: 'CZ',
			currency: 'CZK',
			grossIncomeMinor: 138500000n,
			taxPaidMinor: 20800000n
		},
		{
			id: randomUUID(),
			personId: petr,
			year: 2025,
			country: 'PL',
			currency: 'PLN',
			grossIncomeMinor: 21600000n,
			taxPaidMinor: 2600000n
		}
	]);
	await db.insert(taxStatementLine).values({
		id: randomUUID(),
		statementId: janaCz2024,
		label: 'Social insurance',
		amountMinor: 9100000n,
		sort: 0
	});
}
