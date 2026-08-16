import { and, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { category, transaction } from '$lib/server/db/schema';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { toMajor } from '$lib/money';
import { getBaseCurrency } from '$lib/server/settings';
import { loadSplits } from '$lib/server/splits';
import { effectiveLines } from '$lib/transactions/lines';
import { CATEGORY_GROUPS } from '$lib/categories';
import type { FlowFigures } from '$lib/charts/flow-graph';

export type Period = 'ytd' | 'month';

export interface FlowData {
	input: FlowFigures;
	caption: string;
	totals: { in: number; out: number; kept: number };
	breakdown: {
		key: string;
		label: string;
		colorVar: string;
		pct: number;
		leaves: { name: string; value: number }[];
	}[];
}

function periodRange(
	period: Period,
	today = new Date()
): { start: string; end: string; caption: string } {
	const y = today.getFullYear();
	const m = today.getMonth();
	if (period === 'month') {
		const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
		const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
		return { start, end, caption: today.toLocaleString('en', { month: 'long', year: 'numeric' }) };
	}
	return {
		start: `${y}-01-01`,
		end: new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10),
		caption: `January – ${today.toLocaleString('en', { month: 'long' })} ${y}`
	};
}

/**
 * Aggregate the period's transactions (transfers excluded by definition) into
 * the waterfall's shape, in base-currency major units.
 */
export async function flowData(period: Period): Promise<FlowData> {
	const base = await getBaseCurrency();
	const rates = await loadRateTable();
	const { start, end, caption } = periodRange(period);

	// The value date decides which month a movement belongs to when the bank
	// provides one — card payments started in June and booked in July count in
	// June, where the money actually moved.
	const effectiveDate = sql`coalesce(${transaction.valueDate}, ${transaction.bookedAt})`;
	const [rows, categories] = await Promise.all([
		db
			.select()
			.from(transaction)
			.where(
				and(
					isNull(transaction.transferPairId),
					sql`${effectiveDate} >= ${start}`,
					sql`${effectiveDate} <= ${end}`
				)
			),
		db.select().from(category)
	]);
	const categoryById = new Map(categories.map((c) => [c.id, c]));
	const splitsByTxn = await loadSplits(rows.map((r) => r.id));

	// Base-currency major units per category id, plus uncategorised buckets.
	const byCategory = new Map<string, number>();
	let uncategorisedIn = 0;
	let uncategorisedOut = 0;
	for (const t of rows) {
		// effectiveLines is the only thing that knows whether this is split, and
		// it has already netted the bank's own fee out of the first line.
		for (const line of effectiveLines(t, splitsByTxn.get(t.id) ?? [])) {
			const converted = convertOrFace(
				rates,
				line.amountMinor,
				t.currency,
				base,
				t.valueDate ?? t.bookedAt
			);
			const major = toMajor(converted, base);
			if (line.categoryId) {
				byCategory.set(line.categoryId, (byCategory.get(line.categoryId) ?? 0) + major);
			} else if (major > 0) {
				uncategorisedIn += major;
			} else {
				uncategorisedOut += major;
			}
		}
	}

	const groupTotal = (groupKey: string) => {
		let sum = 0;
		for (const [id, value] of byCategory) {
			if (categoryById.get(id)?.groupKey === groupKey) sum += value;
		}
		return sum;
	};

	// Income sources: income-group leaves with nonzero sums, plus a bucket for
	// not-yet-categorised inflows so the chart never lies about the total.
	const sources = categories
		.filter((c) => c.groupKey === 'income')
		.map((c) => ({ name: c.name, amount: byCategory.get(c.id) ?? 0 }))
		.filter((s) => s.amount > 0.005);
	if (uncategorisedIn > 0.005) sources.push({ name: 'Unfiled income', amount: uncategorisedIn });

	const totalIn = sources.reduce((s, x) => s + x.amount, 0);

	const expenseGroups = CATEGORY_GROUPS.filter((g) => g.key !== 'income' && g.key !== 'savings');
	const stages = expenseGroups.map((g) => ({
		key: g.key,
		label: g.label,
		colorVar: g.colorVar,
		// expenses are negative sums; the chart wants positive magnitudes
		amount: Math.max(0, -groupTotal(g.key))
	}));
	// Not-yet-categorised outflows ride in the Food & lifestyle stage (the
	// catch-all group) so the trunk never overstates what survived; they show
	// up as an explicit "Unfiled" leaf in the breakdown below.
	const unfiledOut = -uncategorisedOut;
	if (unfiledOut > 0.005) {
		const living = stages.find((s) => s.key === 'living');
		if (living) living.amount += unfiledOut;
	}

	const totalStaged = stages.reduce((s, x) => s + x.amount, 0);
	const kept = totalIn - totalStaged;

	const breakdown = [
		...expenseGroups.map((g) => ({
			key: g.key,
			label: g.label,
			colorVar: g.colorVar,
			pct:
				totalIn > 0 ? Math.round((stages.find((s) => s.key === g.key)!.amount / totalIn) * 100) : 0,
			leaves: [
				...categories
					.filter((c) => c.groupKey === g.key)
					.map((c) => ({ name: c.name, value: Math.abs(byCategory.get(c.id) ?? 0) })),
				...(g.key === 'living' && unfiledOut > 0.005
					? [{ name: 'Unfiled', value: unfiledOut }]
					: [])
			].filter((l) => l.value > 0.005)
		})),
		{
			key: 'savings',
			label: 'Saved & invested',
			colorVar: '--teal',
			pct: totalIn > 0 ? Math.round((kept / totalIn) * 100) : 0,
			leaves: categories
				.filter((c) => c.groupKey === 'savings')
				.map((c) => ({ name: c.name, value: Math.abs(byCategory.get(c.id) ?? 0) }))
				.filter((l) => l.value > 0.005)
		}
	];

	return {
		input: { sources, stages, remainderLabel: 'Saved & invested' },
		caption,
		totals: { in: totalIn, out: totalStaged, kept },
		breakdown
	};
}

export interface MonthBar {
	month: string; // YYYY-MM
	earned: number;
	spent: number;
}

/** Earned vs spent per month over the whole record, transfers excluded. */
export async function monthlyHistory(): Promise<MonthBar[]> {
	const base = await getBaseCurrency();
	const rates = await loadRateTable();
	const rows = await db.select().from(transaction).where(isNull(transaction.transferPairId));

	const byMonth = new Map<string, { earned: number; spent: number }>();
	for (const t of rows) {
		const effective = t.valueDate ?? t.bookedAt;
		const month = effective.slice(0, 7);
		const net = t.amount - (t.feeMinor ?? 0n);
		const converted = convertOrFace(rates, net, t.currency, base, effective);
		const major = toMajor(converted, base);
		if (!byMonth.has(month)) byMonth.set(month, { earned: 0, spent: 0 });
		const bucket = byMonth.get(month)!;
		if (major > 0) bucket.earned += major;
		else bucket.spent += -major;
	}
	return [...byMonth.entries()]
		.sort((a, b) => (a[0] < b[0] ? -1 : 1))
		.map(([month, v]) => ({ month, earned: v.earned, spent: v.spent }));
}
