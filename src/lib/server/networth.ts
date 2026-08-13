import { and, asc, desc, lt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	account,
	loan,
	loanProperty,
	netWorthSnapshot,
	portfolioSnapshot,
	property
} from '$lib/server/db/schema';
import { convertMinor } from '$lib/server/fx';
import { getBaseCurrency } from '$lib/server/settings';

export interface NetWorthGroup {
	key: string;
	label: string;
	/** gross asset value in base minor units (0 for pure debt) */
	assetMinor: bigint;
	/** what is owed against this asset (0 for unencumbered assets) */
	liabilityMinor: bigint;
	colorVar: string;
	detail: string;
}

export interface NetWorth {
	baseCurrency: string;
	totalMinor: bigint;
	/** paired components: each asset beside what is owed against it */
	groups: NetWorthGroup[];
	assetsMinor: bigint;
	liabilitiesMinor: bigint;
	/** change since the first snapshot of this calendar month, if known */
	deltaThisMonthMinor: bigint | null;
}

/**
 * A true statement: gross assets (flats at value, portfolio, cash) minus
 * liabilities (mortgages, other loans) = net worth.
 */
export async function computeNetWorth(): Promise<NetWorth> {
	const baseCurrency = await getBaseCurrency();
	const [accounts, properties, loans, links, snapshots] = await Promise.all([
		db.select().from(account),
		db.select().from(property),
		db.select().from(loan),
		db.select({ loanId: loanProperty.loanId }).from(loanProperty),
		db.select().from(portfolioSnapshot).orderBy(desc(portfolioSnapshot.day)).limit(1)
	]);
	const securedLoanIds = new Set(links.map((l) => l.loanId));

	const toBase = async (amount: bigint, currency: string) =>
		(await convertMinor(amount, currency, baseCurrency)) ?? amount;

	let cash = 0n;
	for (const a of accounts) {
		if (a.kind === 'brokerage') continue;
		cash += await toBase(a.balanceMinor, a.currency);
	}

	let flatsGross = 0n;
	for (const p of properties) {
		flatsGross += await toBase(p.valueMinor, p.currency);
	}
	let mortgagesOwed = 0n;
	let otherLoans = 0n;
	for (const l of loans) {
		const owedBase = await toBase(l.owedMinor, l.currency);
		if (securedLoanIds.has(l.id)) mortgagesOwed += owedBase;
		else otherLoans += owedBase;
	}

	let portfolio = 0n;
	if (snapshots[0]) {
		portfolio = await toBase(snapshots[0].valueMinor, snapshots[0].currency);
	}

	const groups: NetWorthGroup[] = [];
	if (properties.length > 0) {
		groups.push({
			key: 'flats',
			label: 'Flats',
			assetMinor: flatsGross,
			liabilityMinor: mortgagesOwed,
			colorVar: '--blue',
			detail: `${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} at latest valuation${mortgagesOwed > 0n ? ', net of the mortgage owed' : ''}`
		});
	}
	if (snapshots[0]) {
		groups.push({
			key: 'investments',
			label: 'Investments',
			assetMinor: portfolio,
			liabilityMinor: 0n,
			colorVar: '--teal',
			detail: `broker report of ${snapshots[0].day}`
		});
	}
	groups.push({
		key: 'cash',
		label: 'Cash across accounts',
		assetMinor: cash,
		liabilityMinor: 0n,
		colorVar: '--green',
		detail: `${accounts.filter((a) => a.kind !== 'brokerage').length} accounts, statement balances`
	});
	if (otherLoans > 0n) {
		groups.push({
			key: 'loans',
			label: 'Other loans',
			assetMinor: 0n,
			liabilityMinor: otherLoans,
			colorVar: '--orange',
			detail: 'car and consumer debt'
		});
	}

	const assetsMinor = groups.reduce((s, g) => s + g.assetMinor, 0n);
	const liabilitiesMinor = groups.reduce((s, g) => s + g.liabilityMinor, 0n);
	const totalMinor = assetsMinor - liabilitiesMinor;

	// Persist today's figure and read the month baseline.
	const today = new Date().toISOString().slice(0, 10);
	await db
		.insert(netWorthSnapshot)
		.values({ day: today, valueMinor: totalMinor, currency: baseCurrency })
		.onConflictDoUpdate({
			target: netWorthSnapshot.day,
			set: { valueMinor: totalMinor, currency: baseCurrency }
		});

	const monthStart = today.slice(0, 8) + '01';
	const baseline = await db
		.select()
		.from(netWorthSnapshot)
		.where(and(lt(netWorthSnapshot.day, monthStart)))
		.orderBy(desc(netWorthSnapshot.day))
		.limit(1);
	const earliest = baseline[0]
		? baseline[0]
		: (await db.select().from(netWorthSnapshot).orderBy(asc(netWorthSnapshot.day)).limit(1))[0];
	const deltaThisMonthMinor =
		earliest && earliest.day !== today ? totalMinor - earliest.valueMinor : null;

	return { baseCurrency, totalMinor, groups, assetsMinor, liabilitiesMinor, deltaThisMonthMinor };
}
