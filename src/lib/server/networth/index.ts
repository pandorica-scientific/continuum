// SPDX-License-Identifier: AGPL-3.0-or-later
import { asc, desc, lt, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import {
	loanProperty,
	netWorthComponent,
	netWorthSnapshot,
	portfolioSnapshot
} from '$lib/server/db/schema';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { getBaseCurrency } from '$lib/server/settings';
import { deltaShareOfBiggest, deltaSinceMonthStart, monthlyDeltas } from '$lib/networth/history';

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
	/**
	 * How big that change is against the biggest month on record, 0–1.
	 *
	 * What the sidebar's pill fills to. Null until there are two months to
	 * compare — one month of history cannot say whether a month was big.
	 */
	deltaShare: number | null;
}

/**
 * Read-only — this runs on every page load and from `GET /api/v1/networth`,
 * so writing here would make the documented read-only API mutate on every poll.
 * Snapshots are written separately by `recordNetWorthSnapshot`.
 */
export async function computeNetWorth(handle: Queryable = db): Promise<NetWorth> {
	const baseCurrency = await getBaseCurrency(handle);
	const [rates, components, links, snapshots] = await Promise.all([
		// One table load, not per-holding.
		loadRateTable(handle),
		// One read of the view; a new asset type is a UNION branch in the migration.
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
	let equity = 0n;
	let equityTranches = 0;
	let unnamedAssets = 0n;
	let unnamedLiabilities = 0n;
	const unnamedKinds = new Set<string>();

	for (const c of components) {
		// View columns are nullable (views carry no constraints); missing values count as zero.
		const value = toBase(c.valueMinor ?? 0n, c.currency ?? baseCurrency);
		switch (c.kind) {
			case 'property':
				flatsGross += value;
				properties += 1;
				break;
			case 'account':
				// Brokerage cash is already inside the portfolio snapshot below.
				if (c.subkind === 'brokerage') break;
				cash += value;
				cashAccounts += 1;
				break;
			case 'loan':
				// Already negative in the view; carried here as a positive liability
				// beside the asset it is secured on.
				if (c.id !== null && securedLoanIds.has(c.id)) mortgagesOwed -= value;
				else otherLoans -= value;
				break;
			case 'holding':
				// Portfolio snapshot below is the broker's own daily total; summing
				// positions too would double-count.
				break;
			case 'equity':
				// Vested shares only — the view already excludes pending/forfeited.
				equity += value;
				equityTranches += 1;
				break;
			default:
				// Unnamed asset kind: still counted rather than silently dropped.
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
	if (equity > 0n) {
		groups.push({
			key: 'equity',
			label: 'Equity',
			assetMinor: equity,
			liabilityMinor: 0n,
			colorVar: '--purple',
			detail: `${equityTranches} vested ${equityTranches === 1 ? 'tranche' : 'tranches'} at the latest close`
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

	// Baseline is the last snapshot before this month, or the oldest on record
	// if history doesn't reach back that far.
	const monthStart = today.slice(0, 8) + '01';
	const [priorMonth, oldest, monthEnds] = await Promise.all([
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
			.limit(1),
		// Last snapshot per month, 13 months back (12 deltas need 13 ends).
		handle
			// `to_char`, not `substring`: `day` is a date column, and substring on a
			// date needs an explicit cast that Postgres will not infer.
			.select({
				month: sql<string>`to_char(${netWorthSnapshot.day}, 'YYYY-MM')`,
				valueMinor: sql<string>`(array_agg(${netWorthSnapshot.valueMinor} order by ${netWorthSnapshot.day} desc))[1]`
			})
			.from(netWorthSnapshot)
			.where(lt(netWorthSnapshot.day, monthStart))
			.groupBy(sql`to_char(${netWorthSnapshot.day}, 'YYYY-MM')`)
			.orderBy(sql`to_char(${netWorthSnapshot.day}, 'YYYY-MM') desc`)
			.limit(13)
	]);
	const deltaThisMonthMinor = deltaSinceMonthStart(
		totalMinor,
		baseCurrency,
		today,
		[...priorMonth, ...oldest],
		(amount, from, to, day) => convertOrFace(rates, amount, from, to, day)
	);

	// Oldest first, so a delta is this month minus the one before it.
	const history = [...monthEnds].reverse().map((row) => ({ valueMinor: BigInt(row.valueMinor) }));

	return {
		baseCurrency,
		totalMinor,
		groups,
		assetsMinor,
		liabilitiesMinor,
		deltaThisMonthMinor,
		deltaShare: deltaShareOfBiggest(deltaThisMonthMinor, monthlyDeltas(history), totalMinor)
	};
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
