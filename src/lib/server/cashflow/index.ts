// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { and, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { category, transaction } from '$lib/server/db/schema';
import { notOwnTransfer } from '$lib/server/transactions/transfers';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { toMajor } from '$lib/money';
import { getBaseCurrency } from '$lib/server/settings';
import { loadSplits } from '$lib/server/splits';
import { effectiveLines } from '$lib/transactions/lines';
import { expenseGroups as stagesOf, loadCategoryGroups } from '$lib/server/categorize/groups';
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

/**
 * The window a period covers, anchored on the newest month that actually holds
 * data rather than on the calendar.
 *
 * Statements arrive after a month ends, so "this month" is routinely empty and
 * both the Money screen and the Overview panel rendered nothing at all.
 * Anchoring on the data means a household mid-way through importing sees July
 * and is told, in the caption, that it is looking at July.
 *
 * `anchorMonth` is null only on an instance with no transactions, where falling
 * back to today keeps the empty state exactly as it was.
 */
export function periodRange(
	period: Period,
	anchorMonth: string | null,
	today = new Date()
): { start: string; end: string; caption: string } {
	const anchor = anchorMonth
		? new Date(Date.UTC(Number(anchorMonth.slice(0, 4)), Number(anchorMonth.slice(5, 7)) - 1, 1))
		: today;
	// UTC throughout. The previous version read the year and month in local time
	// and then built the boundaries with Date.UTC, which lands on the wrong month
	// for anyone west of UTC during the first hours of one.
	const y = anchor.getUTCFullYear();
	const m = anchor.getUTCMonth();
	const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
	const monthName = (index: number) =>
		new Date(Date.UTC(2000, index, 1)).toLocaleString('en', { month: 'long' });

	if (period === 'month') {
		return {
			start: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
			end,
			caption: `${monthName(m)} ${y}`
		};
	}
	return { start: `${y}-01-01`, end, caption: `January – ${monthName(m)} ${y}` };
}

/**
 * Aggregate the period's transactions (transfers excluded by definition) into
 * the waterfall's shape, in base-currency major units.
 */
export async function flowData(period: Period): Promise<FlowData> {
	const base = await getBaseCurrency();
	const rates = await loadRateTable();
	const { start, end, caption } = periodRange(period, await latestMonthWithData());

	// The value date decides which month a movement belongs to when the bank
	// provides one — card payments started in June and booked in July count in
	// June, where the money actually moved.
	const effectiveDate = sql`coalesce(${transaction.valueOn}, ${transaction.bookedOn})`;
	const [rows, categories] = await Promise.all([
		db
			.select()
			.from(transaction)
			.where(
				and(notOwnTransfer(), sql`${effectiveDate} >= ${start}`, sql`${effectiveDate} <= ${end}`)
			),
		db.select().from(category)
	]);
	const groups = await loadCategoryGroups();
	const incomeKeys = new Set(groups.filter((g) => g.role === 'income').map((g) => g.key));
	const savingsKeys = new Set(groups.filter((g) => g.role === 'savings').map((g) => g.key));
	const savingsGroup = groups.find((g) => g.role === 'savings') ?? null;
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
				t.valueOn ?? t.bookedOn
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
		.filter((c) => incomeKeys.has(c.groupKey))
		.map((c) => ({ name: c.name, amount: byCategory.get(c.id) ?? 0 }))
		.filter((s) => s.amount > 0.005);
	if (uncategorisedIn > 0.005) sources.push({ name: 'Unfiled income', amount: uncategorisedIn });

	const totalIn = sources.reduce((s, x) => s + x.amount, 0);

	const expenseGroups = stagesOf(groups);
	const stages = expenseGroups.map((g) => ({
		key: g.key,
		label: g.label,
		colorVar: g.colorToken,
		// expenses are negative sums; the chart wants positive magnitudes
		amount: Math.max(0, -groupTotal(g.key))
	}));
	// Not-yet-categorised outflows ride in the catch-all stage so the trunk never
	// overstates what survived; they show up as an explicit "Unfiled" leaf in the
	// breakdown below.
	//
	// That used to name 'living' outright. Groups are a household's own now and
	// any of them can be deleted, so this takes the last expense stage when the
	// seeded catch-all is gone — and when there are no expense stages at all, the
	// unfiled amount simply has nowhere to ride and is left out of the trunk
	// rather than silently attached to something it does not belong to.
	const unfiledOut = -uncategorisedOut;
	const catchAll = stages.find((s) => s.key === 'living') ?? stages[stages.length - 1];
	if (unfiledOut > 0.005 && catchAll) catchAll.amount += unfiledOut;

	const totalStaged = stages.reduce((s, x) => s + x.amount, 0);
	const kept = totalIn - totalStaged;

	const breakdown = [
		...expenseGroups.map((g) => ({
			key: g.key,
			label: g.label,
			colorVar: g.colorToken,
			pct:
				totalIn > 0 ? Math.round((stages.find((s) => s.key === g.key)!.amount / totalIn) * 100) : 0,
			leaves: [
				...categories
					.filter((c) => c.groupKey === g.key)
					.map((c) => ({ name: c.name, value: Math.abs(byCategory.get(c.id) ?? 0) })),
				...(g.key === catchAll?.key && unfiledOut > 0.005
					? [{ name: 'Unfiled', value: unfiledOut }]
					: [])
			].filter((l) => l.value > 0.005)
		})),
		// What is left after every stage. Read from the savings-role group rather
		// than the literal key and colour it used to hardcode, so a household that
		// renames or recolours it sees that here too.
		{
			key: savingsGroup?.key ?? 'savings',
			label: savingsGroup?.label ?? 'Saved & invested',
			colorVar: savingsGroup?.colorToken ?? '--series-savings',
			pct: totalIn > 0 ? Math.round((kept / totalIn) * 100) : 0,
			leaves: categories
				.filter((c) => savingsKeys.has(c.groupKey))
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

interface MonthBar {
	month: string; // YYYY-MM
	earned: number;
	spent: number;
}

/**
 * The newest month holding a transaction that is not a transfer leg, as
 * `YYYY-MM`, or null on an instance with nothing imported.
 *
 * Neither rule here is a free choice — both are the rules monthlyHistory and
 * flowData already apply. The effective date is the value date when the bank
 * prints one, and transfer legs are excluded. A month whose only movement was
 * between the household's own accounts has no spending to show, so anchoring on
 * it would reproduce the empty chart this exists to fix.
 */
export async function latestMonthWithData(handle: Queryable = db): Promise<string | null> {
	const [row] = await handle
		.select({
			month: sql<
				string | null
			>`to_char(max(coalesce(${transaction.valueOn}, ${transaction.bookedOn})), 'YYYY-MM')`
		})
		.from(transaction)
		.where(notOwnTransfer());
	return row?.month ?? null;
}

/** Earned vs spent per month over the whole record, transfers excluded. */
export async function monthlyHistory(): Promise<MonthBar[]> {
	const base = await getBaseCurrency();
	const rates = await loadRateTable();
	const rows = await db.select().from(transaction).where(notOwnTransfer());

	const byMonth = new Map<string, { earned: number; spent: number }>();
	for (const t of rows) {
		const effective = t.valueOn ?? t.bookedOn;
		const month = effective.slice(0, 7);
		const net = t.amountMinor - (t.feeMinor ?? 0n);
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
