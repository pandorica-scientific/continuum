import { asc, desc, lt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	account,
	loan,
	loanProperty,
	netWorthSnapshot,
	portfolioSnapshot,
	property
} from '$lib/server/db/schema';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { getBaseCurrency } from '$lib/server/settings';
import { deltaSinceMonthStart } from '$lib/networth/history';

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
 *
 * Read-only. The daily snapshot is written by `recordNetWorthSnapshot` on the
 * scheduler, not here: this function runs from the (app) layout on every page,
 * again on /overview, and from `GET /api/v1/networth` — so an upsert inside it
 * meant the documented read-only API wrote on every poll.
 */
export async function computeNetWorth(): Promise<NetWorth> {
	const baseCurrency = await getBaseCurrency();
	const [rates, accounts, properties, loans, links, snapshots] = await Promise.all([
		// One table load, not a query per holding: this ran on every page view.
		loadRateTable(),
		db.select().from(account),
		db.select().from(property),
		db.select().from(loan),
		db.select({ loanId: loanProperty.loanId }).from(loanProperty),
		db.select().from(portfolioSnapshot).orderBy(desc(portfolioSnapshot.day)).limit(1)
	]);
	const securedLoanIds = new Set(links.map((l) => l.loanId));

	const today = new Date().toISOString().slice(0, 10);
	const toBase = (amount: bigint, currency: string) =>
		convertOrFace(rates, amount, currency, baseCurrency, today);

	let cash = 0n;
	for (const a of accounts) {
		if (a.kind === 'brokerage') continue;
		cash += toBase(a.balanceMinor, a.currency);
	}

	let flatsGross = 0n;
	for (const p of properties) {
		flatsGross += toBase(p.valueMinor, p.currency);
	}
	let mortgagesOwed = 0n;
	let otherLoans = 0n;
	for (const l of loans) {
		const owedBase = toBase(l.owedMinor, l.currency);
		if (securedLoanIds.has(l.id)) mortgagesOwed += owedBase;
		else otherLoans += owedBase;
	}

	let portfolio = 0n;
	if (snapshots[0]) {
		portfolio = toBase(snapshots[0].valueMinor, snapshots[0].currency);
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

	// The month opened at the close of the previous one, so read the last
	// snapshot before it began, plus the oldest on record for an install whose
	// history does not reach back that far. Today's figure is persisted by the
	// scheduler and is not its own comparison baseline. Two single indexed reads
	// rather than loading the month.
	const monthStart = today.slice(0, 8) + '01';
	const [priorMonth, oldest] = await Promise.all([
		db
			.select()
			.from(netWorthSnapshot)
			.where(lt(netWorthSnapshot.day, monthStart))
			.orderBy(desc(netWorthSnapshot.day))
			.limit(1),
		db
			.select()
			.from(netWorthSnapshot)
			.where(lt(netWorthSnapshot.day, today))
			.orderBy(asc(netWorthSnapshot.day))
			.limit(1)
	]);
	const deltaThisMonthMinor = deltaSinceMonthStart(
		totalMinor,
		baseCurrency,
		today,
		[...priorMonth, ...oldest],
		(amount, from, to, day) => convertOrFace(rates, amount, from, to, day)
	);

	return { baseCurrency, totalMinor, groups, assetsMinor, liabilitiesMinor, deltaThisMonthMinor };
}

/**
 * Record today's net worth, so the month-on-month delta has a history to read.
 * One row per day, upserted — called from the scheduler, never from a page load
 * or from the read-only API.
 */
export async function recordNetWorthSnapshot(): Promise<void> {
	const { totalMinor, baseCurrency } = await computeNetWorth();
	await db
		.insert(netWorthSnapshot)
		.values({
			day: new Date().toISOString().slice(0, 10),
			valueMinor: totalMinor,
			currency: baseCurrency
		})
		.onConflictDoUpdate({
			target: netWorthSnapshot.day,
			set: { valueMinor: totalMinor, currency: baseCurrency }
		});
}
