// Demo mode: with DEMO=1 a pristine instance seeds itself with a fictional
// household — Jana & Petr Novák, two flats on one shared mortgage, six months
// of categorised cash flow, payslips, a portfolio snapshot — so screenshots
// and first impressions need no real data. Runs only when no person exists;
// a set-up instance is never touched.

import { uuidv7 } from 'uuidv7';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { initialsFor } from '$lib/people';
import {
	contact,
	contactLink,
	account,
	brokerImportState,
	brokerOperation,
	currencyRate,
	document,
	documentLink,
	loan,
	loanFixationPeriod,
	loanProperty,
	person,
	holding,
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

/**
 * Demo interior photos ship in `static/demo/` (so they land in the client build
 * and need no Dockerfile change) and are copied into the upload directory under
 * a stored UUID name — exactly the shape a real upload takes, so the gallery
 * serves them through /files/<name> and knows nothing about where they began.
 * Returns null when the asset is missing rather than failing the whole seed.
 */
async function seedDemoPhoto(file: string): Promise<string | null> {
	const dir = env.UPLOAD_DIR || 'data';
	for (const source of [join('static', 'demo', file), join('build', 'client', 'demo', file)]) {
		try {
			const bytes = await readFile(source);
			await mkdir(dir, { recursive: true });
			const name = `${uuidv7()}.jpg`;
			await writeFile(join(dir, name), bytes);
			return name;
		} catch {
			// not this location — try the next
		}
	}
	return null;
}

export async function seedDemo(): Promise<void> {
	await setSetting('householdName', 'Novák household (demo)');
	await setSetting('baseCurrency', 'CZK');

	// An opening fixing for every currency this household holds anything in.
	//
	// A real install backfills these from the Czech National Bank, but the demo
	// is often looked at on a machine with no route out, and the earliest thing
	// it seeds is a 2024 tax statement — years before any rate the app manages
	// to fetch. So every screen carried an orange banner saying the exchange
	// rate was approximate, which is true, and which says nothing about the
	// software to someone seeing it for the first time.
	//
	// One row each is enough: a rate carries forward from its first fixing, and
	// missingRateCodes only complains about a currency used BEFORE it has one.
	// Later CNB fixings land on top of these and take over from their own date.
	await db
		.insert(currencyRate)
		.values([
			{ code: 'EUR', day: '2024-01-01', rate: '24.725' },
			{ code: 'PLN', day: '2024-01-01', rate: '5.680' }
		])
		.onConflictDoNothing();

	const jana = uuidv7();
	const petr = uuidv7();
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

	const fio = uuidv7();
	const revolut = uuidv7();
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
			id: uuidv7(),
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
	// expressed: a counterparty *and* an amount floor. It starts from no evidence,
	// so the rules screen shows it earning trust rather than assuming it. Demo
	// transactions carry their categories directly, so this is the only rule a
	// demo instance begins with.
	await db.insert(rule).values({
		id: uuidv7(),
		name: 'Big Alza purchases',
		provenance: 'manual',
		conditions: [
			{ field: 'counterparty', op: 'contains', value: 'alza' },
			{ field: 'amount', op: 'between', min: '100000', max: null, currency: 'CZK' }
		],
		categoryId: 'everything-else'
	});

	// The gallery is one of the few screens that looks broken when empty.
	const flatPhotos = (
		await Promise.all(
			['flat-living.jpg', 'flat-kitchen.jpg', 'flat-bedroom.jpg'].map(seedDemoPhoto)
		)
	).filter((name): name is string => name !== null);

	// Rooms are painted cell by cell in the editor; seeding them is easier as
	// rectangles that share edges.
	const planRect = (x: number, y: number, w: number, h: number) =>
		Array.from({ length: w * h }, (_, k) => [x + (k % w), y + Math.floor(k / w)]) as [
			number,
			number
		][];

	// Two flats, one mortgage over both at explicit shares.
	const flatA = uuidv7();
	const flatB = uuidv7();
	await db.insert(property).values([
		{
			id: flatA,
			// Explicit, and earlier than Karlín: properties are listed by
			// created_at with the id as tiebreak, so inserting both in one
			// statement left the order to a random UUID — the property screen
			// opened on whichever flat won, and the demo screenshots changed
			// flat between runs. This flat was bought first (2019 vs 2022).
			createdAt: new Date(Date.now() - 60_000),
			name: 'Flat Vinohrady',
			sizeLabel: '3+kk · 78 m²',
			kind: 'lived',
			currency: 'CZK',
			valueMinor: 890000000n,
			valuedAt: new Date().toISOString().slice(0, 10),
			moneyInMinor: 310000000n,
			boughtYear: 2019,
			images: {
				photos: flatPhotos,
				// A real 3+kk at the 10 cm grid: rooms tile one 108 x 72 cell
				// rectangle with no gaps, so every wall is shared and the areas
				// add up to the 78 m² on the label rather than contradicting it.
				drawing: {
					cellCm: 10,
					rooms: [
						{ name: 'Living room & kitchen', cells: planRect(6, 1, 50, 44) },
						{ name: 'Bedroom', cells: planRect(56, 1, 30, 44) },
						{ name: "Child's room", cells: planRect(86, 1, 28, 44) },
						{ name: 'Hall', cells: planRect(6, 45, 32, 28) },
						{ name: 'Bathroom', cells: planRect(38, 45, 26, 28) },
						{ name: 'WC', cells: planRect(64, 45, 14, 28) },
						{ name: 'Storage', cells: planRect(78, 45, 14, 28) },
						{ name: 'Balcony', cells: planRect(92, 45, 22, 28) }
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
			boughtYear: 2022,
			images: {
				photos: [],
				// 2+kk, 90 x 60 cells = exactly the 54 m² on the label.
				drawing: {
					cellCm: 10,
					rooms: [
						{ name: 'Living room & kitchen', cells: planRect(15, 7, 52, 36) },
						{ name: 'Bedroom', cells: planRect(67, 7, 38, 36) },
						{ name: 'Hall', cells: planRect(15, 43, 32, 24) },
						{ name: 'Bathroom', cells: planRect(47, 43, 26, 24) },
						{ name: 'Storage', cells: planRect(73, 43, 14, 24) },
						{ name: 'Balcony', cells: planRect(87, 43, 18, 24) }
					]
				}
			}
		}
	]);
	const mortgage = uuidv7();
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
		interestDeductible: true
	});
	await db.insert(loanProperty).values([
		{ id: uuidv7(), loanId: mortgage, propertyId: flatA, sharePct: '62.5' },
		{ id: uuidv7(), loanId: mortgage, propertyId: flatB, sharePct: '37.5' }
	]);
	await db.insert(loanFixationPeriod).values({
		id: uuidv7(),
		loanId: mortgage,
		startDate: '2026-02-11',
		// Relative, and inside the horizon the briefing watches (30 months), so a
		// demo household has the one thing every mortgage-holder actually has to
		// think about ahead of time. A fixation running to a fixed 2031 was five
		// years out from every angle: nothing to decide, nothing to show, and the
		// first panel on the Overview read "nothing needs a decision right now".
		endDate: monthShift(thisMonth, 24) + '-11',
		annualRatePct: '4.44',
		paymentMinor: 5445600n
	});

	const tenancyB = uuidv7();
	await db.insert(tenancy).values({
		id: tenancyB,
		propertyId: flatB,
		tenantName: 'Martin Dvořák',
		rentMinor: 1650000n,
		depositMinor: 3300000n,
		startDate: '2025-06-01',
		// Close enough that the lease and its renewal notice are live decisions.
		// At ten months out both sat outside every window the briefing watches,
		// so the demo's tenancy was invisible on the screen that exists to
		// surface exactly this.
		endDate: monthShift(thisMonth, 3) + '-01',
		renewalNoticeDate: monthShift(thisMonth, 1) + '-01'
	});

	// The tenant, and one company the household deals with. Both carry diacritics
	// on purpose: the demo is where someone first tries the search, and folding
	// "dvorak" onto "Dvořák" is the thing worth discovering.
	const tenantContactId = uuidv7();
	await db.insert(contact).values([
		{
			id: tenantContactId,
			name: 'Martin Dvořák',
			phone: '+420 777 000 111',
			email: 'martin.dvorak@example.cz',
			notes: 'Tenant, Flat B.'
		},
		{
			id: uuidv7(),
			name: 'Jana Řehořová',
			organisation: 'Česká spořitelna',
			jobTitle: 'Mortgage adviser',
			phone: '+420 800 207 207'
		}
	]);
	await db.insert(contactLink).values({ contactId: tenantContactId, targetId: tenancyB });
	await db.insert(propertyBill).values([
		{ id: uuidv7(), propertyId: flatA, label: 'SVJ fee & repair fund', amountMinor: 485000n },
		{ id: uuidv7(), propertyId: flatA, label: 'Electricity advance', amountMinor: 240000n },
		{ id: uuidv7(), propertyId: flatB, label: 'SVJ fee', amountMinor: 310000n }
	]);

	// Three years of monthly reports rather than a single point: a 10 000 Kč
	// standing order against a market that dips as well as climbs, so the value
	// chart has a shape and the gain is measured against money actually paid in
	// instead of against zero.
	const demoPortfolioAsOf = new Date();
	const depositMinor = 1000000n;
	const snapshots: (typeof portfolioSnapshot.$inferInsert)[] = [];
	const deposits: (typeof brokerOperation.$inferInsert)[] = [];
	let portfolioMinor = 0n;
	for (let m = 35; m >= 0; m--) {
		const at = new Date(
			Date.UTC(demoPortfolioAsOf.getUTCFullYear(), demoPortfolioAsOf.getUTCMonth() - m, 1)
		);
		const drift = 1.0075 + 0.032 * Math.sin(m * 1.7) + 0.018 * Math.sin(m * 0.55);
		portfolioMinor = BigInt(Math.round(Number(portfolioMinor + depositMinor) * drift));
		snapshots.push({
			day: at.toISOString().slice(0, 10),
			valueMinor: portfolioMinor,
			currency: 'CZK'
		});
		deposits.push({
			id: `demo-deposit-${m}`,
			type: 'Deposit',
			happenedAt: at,
			amountMinor: depositMinor,
			currency: 'CZK',
			comment: 'Standing order'
		});
	}
	await db.insert(portfolioSnapshot).values(snapshots);
	await db.insert(brokerOperation).values(deposits);
	await db.insert(brokerImportState).values({
		id: 'global',
		latestGeneratedAt: demoPortfolioAsOf,
		currency: 'CZK'
	});

	// Holdings have to add up to the latest snapshot exactly, or the portfolio
	// total and the allocation donut disagree; the largest position absorbs the
	// rounding remainder.
	const allocation: {
		ticker: string;
		name: string;
		category: string;
		share: number;
		priceCzk: number;
		netProfitPct: string;
	}[] = [
		{
			ticker: 'VWCE.DE',
			name: 'Vanguard FTSE All-World UCITS ETF',
			category: 'ETF',
			share: 0.42,
			priceCzk: 3180,
			netProfitPct: '14.80'
		},
		{
			ticker: 'CSPX.UK',
			name: 'iShares Core S&P 500 UCITS ETF',
			category: 'ETF',
			share: 0.21,
			priceCzk: 14250,
			netProfitPct: '21.30'
		},
		{
			ticker: 'CEZ.CZ',
			name: 'ČEZ a.s.',
			category: 'STOCK',
			share: 0.11,
			priceCzk: 985,
			netProfitPct: '-4.20'
		},
		{
			ticker: '4GLD.DE',
			name: 'Xetra-Gold ETC',
			category: 'ETF',
			share: 0.09,
			priceCzk: 1620,
			netProfitPct: '9.40'
		},
		{
			ticker: 'KOMB.CZ',
			name: 'Komerční banka',
			category: 'STOCK',
			share: 0.09,
			priceCzk: 742,
			netProfitPct: '6.70'
		},
		{
			ticker: 'MSFT.US',
			name: 'Microsoft Corp',
			category: 'STOCK',
			share: 0.08,
			priceCzk: 9450,
			netProfitPct: '-2.60'
		}
	];
	const valued = allocation.map((a, i) => ({
		...a,
		valueMinor: i === 0 ? 0n : BigInt(Math.round(Number(portfolioMinor) * a.share))
	}));
	valued[0].valueMinor =
		portfolioMinor - valued.slice(1).reduce((sum, v) => sum + v.valueMinor, 0n);
	await db.insert(holding).values(
		valued.map((v) => ({
			id: uuidv7(),
			ticker: v.ticker,
			name: v.name,
			category: v.category,
			units: (Number(v.valueMinor) / 100 / v.priceCzk).toFixed(6),
			valueMinor: v.valueMinor,
			currency: 'CZK',
			netProfitPct: v.netProfitPct,
			asOf: demoPortfolioAsOf
		}))
	);

	// Payslips feed the salary tracker; a contract shows document linking.
	const today = new Date().toISOString().slice(0, 10);
	const payslips: (typeof document.$inferInsert)[] = [];
	for (let i = 11; i >= 0; i--) {
		const m = monthShift(thisMonth, -i - 1);
		const year = Number(m.slice(0, 4));
		const base = 5800000n + BigInt(year - 2024) * 400000n;
		payslips.push({
			id: uuidv7(),
			name: `Payslip ${m} · Jana Nováková`,
			shelf: 'payslips',
			addedOn: today,
			amountMinor: base,
			amountCurrency: 'CZK',
			// The month the payslip covers, pinned to its first day.
			periodOn: `${m}-01`
		});
	}
	const contractId = uuidv7();
	payslips.push({
		id: contractId,
		name: 'Renting contract · Karlín',
		shelf: 'tenancy',
		addedOn: today,
		// The same day the tenancy ends, because it IS that tenancy's contract.
		// The two drifting apart is how a demo ends up claiming a lease document
		// outlives the lease.
		expiresOn: monthShift(thisMonth, 3) + '-01',
		expiryVerb: 'ends'
	});
	await db.insert(document).values(payslips);
	// Real links, not names: payslips belong to Jana, the contract to the flat.
	await db
		.insert(documentLink)
		.values(
			payslips
				.filter((d) => d.shelf === 'payslips')
				.map((d) => ({ documentId: d.id, targetId: jana }))
		)
		.onConflictDoNothing();
	await db
		.insert(documentLink)
		.values({ documentId: contractId, targetId: flatB })
		.onConflictDoNothing();

	// Tax statements: two Czech years for Jana (the payslips diverge from the
	// declared figure on purpose — bonuses exist), one Polish year for Petr so
	// the charts show the two-country case and a rate that is comparable
	// across currencies that are not.
	const janaCz2024 = uuidv7();
	// Five Czech years for Jana and four Polish ones for Petr: enough points for
	// the effective-rate line to be a trend rather than a dot, with a visible
	// step where the rate changes rather than a straight climb.
	const janaCz: [number, bigint, bigint][] = [
		[2021, 96400000n, 12500000n],
		[2022, 104900000n, 13900000n],
		[2023, 117200000n, 16000000n],
		[2024, 129000000n, 18100000n],
		[2025, 138500000n, 20800000n]
	];
	const petrPl: [number, bigint, bigint][] = [
		[2022, 16800000n, 1900000n],
		[2023, 18300000n, 2100000n],
		[2024, 19900000n, 2350000n],
		[2025, 21600000n, 2600000n]
	];
	await db.insert(taxStatement).values([
		...janaCz.map(([year, grossIncomeMinor, taxPaidMinor]) => ({
			id: year === 2024 ? janaCz2024 : uuidv7(),
			personId: jana,
			year,
			country: 'CZ',
			currency: 'CZK',
			grossIncomeMinor,
			taxPaidMinor
		})),
		...petrPl.map(([year, grossIncomeMinor, taxPaidMinor]) => ({
			id: uuidv7(),
			personId: petr,
			year,
			country: 'PL',
			currency: 'PLN',
			grossIncomeMinor,
			taxPaidMinor
		}))
	]);
	await db.insert(taxStatementLine).values({
		id: uuidv7(),
		statementId: janaCz2024,
		label: 'Social insurance',
		amountMinor: 9100000n,
		sort: 0
	});
}
