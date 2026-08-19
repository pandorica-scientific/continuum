// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { asc, desc, lt } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import {
	loanProperty,
	netWorthComponent,
	netWorthSnapshot,
	portfolioSnapshot
} from '$lib/server/db/schema';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { getBaseCurrency } from '$lib/server/settings';
import { deltaSinceMonthStart } from '$lib/networth/history';

interface NetWorthGroup {
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
export async function computeNetWorth(handle: Queryable = db): Promise<NetWorth> {
	const baseCurrency = await getBaseCurrency(handle);
	const [rates, components, links, snapshots] = await Promise.all([
		// One table load, not a query per holding: this ran on every page view.
		loadRateTable(handle),
		// One read of the view, not a query per asset table. A new asset type is a
		// UNION branch in the migration; nothing here has to be told about it.
		handle.select().from(netWorthComponent),
		handle.select({ loanId: loanProperty.loanId }).from(loanProperty),
		handle.select().from(portfolioSnapshot).orderBy(desc(portfolioSnapshot.day)).limit(1)
	]);
	const securedLoanIds = new Set(links.map((l) => l.loanId));

	const today = new Date().toISOString().slice(0, 10);
	const toBase = (amount: bigint, currency: string) =>
		convertOrFace(rates, amount, currency, baseCurrency, today);

	let cash = 0n;
	let cashAccounts = 0;
	let flatsGross = 0n;
	let properties = 0;
	let mortgagesOwed = 0n;
	let otherLoans = 0n;
	let unnamedAssets = 0n;
	let unnamedLiabilities = 0n;
	const unnamedKinds = new Set<string>();

	for (const c of components) {
		// The view's columns are nullable because a view carries no constraints;
		// every row that reaches here has both, and a row that somehow does not is
		// worth nothing rather than worth guessing at.
		const value = toBase(c.valueMinor ?? 0n, c.currency ?? baseCurrency);
		switch (c.kind) {
			case 'property':
				flatsGross += value;
				properties += 1;
				break;
			case 'account':
				// A brokerage balance is cash sitting at the broker, and the broker
				// already reports it inside the portfolio value below. Counting it here
				// too is the same money twice.
				if (c.subkind === 'brokerage') break;
				cash += value;
				cashAccounts += 1;
				break;
			case 'loan':
				// Already negative in the view; the groups carry what is owed as a
				// positive liability beside the asset it is secured on.
				if (c.id !== null && securedLoanIds.has(c.id)) mortgagesOwed -= value;
				else otherLoans -= value;
				break;
			case 'holding':
				// The portfolio snapshot is the investments figure: it is the broker's
				// own total for the day, including cash and fees the holdings do not
				// show. Summing positions as well would count the portfolio twice.
				break;
			default:
				// An asset type added to the view but not yet named here. It counts —
				// which is the point of the view — and says so, rather than being
				// silently dropped into a total nobody can reconcile.
				if (value < 0n) unnamedLiabilities -= value;
				else unnamedAssets += value;
				if (c.kind) unnamedKinds.add(c.kind);
		}
	}

	let portfolio = 0n;
	if (snapshots[0]) {
		portfolio = toBase(snapshots[0].valueMinor, snapshots[0].currency);
	}

	const groups: NetWorthGroup[] = [];
	if (properties > 0) {
		groups.push({
			key: 'flats',
			label: 'Flats',
			assetMinor: flatsGross,
			liabilityMinor: mortgagesOwed,
			colorVar: '--blue',
			detail: `${properties} propert${properties === 1 ? 'y' : 'ies'} at latest valuation${mortgagesOwed > 0n ? ', net of the mortgage owed' : ''}`
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
		detail: `${cashAccounts} accounts, statement balances`
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
	if (unnamedAssets > 0n || unnamedLiabilities > 0n) {
		groups.push({
			key: 'other',
			label: 'Other',
			assetMinor: unnamedAssets,
			liabilityMinor: unnamedLiabilities,
			colorVar: '--purple',
			detail: [...unnamedKinds].sort().join(', ')
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
		handle
			.select()
			.from(netWorthSnapshot)
			.where(lt(netWorthSnapshot.day, monthStart))
			.orderBy(desc(netWorthSnapshot.day))
			.limit(1),
		handle
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
export async function recordNetWorthSnapshot(handle: Queryable = db): Promise<void> {
	const { totalMinor, baseCurrency } = await computeNetWorth(handle);
	await handle
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
