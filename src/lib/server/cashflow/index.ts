// SPDX-License-Identifier: AGPL-3.0-or-later
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { category, loan, loanEvent, transaction } from '$lib/server/db/schema';
import { LOAN_PRINCIPAL_CATEGORY } from '$lib/categories';
import { PAYMENT_KINDS } from '$lib/loans';
import { effectiveDate } from '$lib/server/transactions';
import { notOwnTransfer } from '$lib/server/transactions/transfers';
import { convertOrFace, loadRateTable, type RateTable } from '$lib/server/fx/table';
import { toMajor } from '$lib/money';
import { getBaseCurrency } from '$lib/server/settings';
import { loadSplits } from '$lib/server/splits';
import { effectiveLines } from '$lib/transactions/lines';
import {
	expenseGroups as stagesOf,
	loadCategoryGroups,
	type GroupRow
} from '$lib/server/categorize/groups';
import {
	KEPT_COLOR,
	KEPT_KEY,
	RESERVES_COLOR,
	RESERVES_KEY,
	ROUNDING,
	type FlowFigures
} from '$lib/charts/flow-graph';
import {
	periodRange,
	previousRange,
	registerHref,
	type MonthSpan,
	type Period,
	type RegisterHrefParams
} from '$lib/cashflow/period';
import { UNCATEGORISED } from '$lib/transactions/filter';

// The period vocabulary and its arithmetic are pure and are shared with the
// controls that navigate between windows, so they live in $lib/cashflow. They
// are re-exported here because every server caller already reaches for this
// module, and a second import path for the same thing is how two callers end up
// disagreeing about what a window covers.
export { periodRange };
export type { MonthSpan, Period };

export interface FlowData {
	input: FlowFigures;
	caption: string;
	/** The window these figures are for, as the controls above them show it. */
	period: Period;
	/**
	 * The month the window ends on, `YYYY-MM`, after clamping — or null on an
	 * instance holding nothing, where there is no month to step to.
	 */
	anchor: string | null;
	/** What the record covers, so the month steppers know where to stop. */
	bounds: MonthSpan | null;
	totals: { in: number; out: number; saved: number; kept: number };
	breakdown: {
		key: string;
		label: string;
		colorVar: string;
		pct: number;
		/**
		 * `key` is the leaf's own key in the aggregate, carried through because a
		 * name does not identify a leaf: two loans a household called the same
		 * thing produce two "· principal" leaves under one group, and the strip
		 * that draws them draws them keyed.
		 */
		leaves: { key: string; name: string; value: number; href: string }[];
	}[];
	/**
	 * The same window, one window earlier — what every figure above is compared
	 * against.
	 *
	 * Null on either of two counts, both of which are the same mistake: a
	 * comparison that would describe when the importing started rather than what
	 * the household did.
	 *
	 * The first is a window holding no transactions at all — which is not the
	 * same as one where everything came to zero, so it is counted in rows rather
	 * than read off the totals. The second is a window the record does not cover
	 * the whole of: a trailing year whose first eight months are before anything
	 * was imported is four months of spending, and comparing a full year against
	 * it reports the missing eight as a collapse.
	 *
	 * Its sources and leaves are not carried. A comparison is a number beside a
	 * figure, not a second chart, and nobody clicks through to a window that is
	 * not on screen.
	 */
	previous: {
		caption: string;
		totals: { in: number; out: number; saved: number; kept: number };
		/** Every stage magnitude by key, plus the signed `kept`. */
		byGroupKey: Record<string, number>;
	} | null;
}

/**
 * The finest grain the waterfall draws, keyed so everything in it has a name.
 *
 * `cat:<id>` for a filed line and `unfiled:in` / `unfiled:out` for the two
 * buckets holding what nobody has filed yet. The two halves of a loan payment
 * are leaves of their own beside them: they are not a category, and the same
 * instalment lands in two different stages.
 */
type LeafKey =
	| `cat:${string}`
	| 'unfiled:in'
	| 'unfiled:out'
	| `loan:${string}:interest`
	| `loan:${string}:principal`;

interface Leaf {
	name: string;
	/** Signed base-currency major units, so money out stays negative. */
	value: number;
	/** The group this belongs to, or null for the two unfiled buckets. */
	groupKey: string | null;
	categoryId: string | null;
	/**
	 * Where the leaf leads, for the leaves the register cannot answer for: the
	 * interest half of a payment nobody has filed has no category to narrow by,
	 * so it leads to the loan itself. Absent on every leaf a category id can
	 * link, which is now both halves of a filed instalment.
	 */
	href?: string;
}

/** A category as the record holds it. */
type CategoryRow = typeof category.$inferSelect;

/** One window of the record, as the two inclusive ISO dates it spans. */
interface DateRange {
	start: string;
	end: string;
}

/**
 * What every window is read against, loaded once for all of them.
 *
 * A window and the window it is compared with are summed from the same rate
 * table and the same category names — nothing about the record differs between
 * them — so loading it twice would be two round trips to ask the same question.
 */
interface WindowContext {
	base: string;
	rates: RateTable;
	categoryById: Map<string, CategoryRow>;
	/**
	 * The household's own groups, in waterfall order. Needed while the leaves are
	 * still being summed because the interest half of a loan payment rides the
	 * stage it was filed under, and only a group row says whether that group is
	 * a stage at all.
	 */
	groups: GroupRow[];
}

/** One window's movements, reduced to the leaves everything else is built from. */
interface Agg {
	byLeaf: Map<LeafKey, Leaf>;
	/**
	 * How many movements the window held, transfer legs excluded.
	 *
	 * Carried beside the figures because "nothing happened" and "it came to
	 * zero" are different answers, and only one of them is worth comparing
	 * against.
	 */
	rows: number;
}

/** What narrows the register down to the rows behind one figure. */
type Narrow = Omit<RegisterHrefParams, 'from' | 'to' | 'month'>;

/**
 * A figure as the arithmetic knows it: everything the chart draws except the
 * link, which only a window's own dates can write — and the window being
 * compared against has no links, because nothing on screen leads into it.
 */
type SourceFigure = Omit<FlowFigures['sources'][number], 'href'> & { narrow: Narrow };
type StageFigure = Omit<FlowFigures['stages'][number], 'href'> & { narrow: Narrow };

/** One window's figures, before anything is linked or drawn. */
interface WindowSummary {
	sources: SourceFigure[];
	stages: StageFigure[];
	totals: FlowData['totals'];
	/**
	 * Every stage's magnitude by key — expense and savings alike — plus the
	 * signed `kept`, so there is a figure here for every head the strip draws
	 * and a comparison can be looked up by the key it is drawn under.
	 */
	byGroupKey: Record<string, number>;
	/**
	 * The not-yet-categorised outflow, and the stage it rides in — null where
	 * there is none worth drawing, or no stage for it to ride in.
	 */
	unfiled: { out: number; stageKey: string | null };
}

/** What the two ends of the residual are called wherever it is named. */
const KEPT_LABEL = 'Kept in cash';
const RESERVES_LABEL = 'From reserves';

/** What a caller may say about the window beyond naming its period. */
export interface FlowOptions {
	/**
	 * The month the window ends on, `YYYY-MM`, as the URL asked for it.
	 *
	 * Null means "the newest month with data", which is what a screen loaded
	 * without an anchor wants: a household half-way through importing August
	 * sees August rather than an empty chart.
	 */
	anchor?: string | null;
}

/**
 * The month a window may actually end on.
 *
 * A URL can name any month; the record covers only some of them. Snapping to
 * the nearer end rather than falling back to the newest is what keeps the
 * steppers honest — walking off the earliest month lands on the earliest month,
 * not at the other end of the record. `YYYY-MM` sorts chronologically as text,
 * so the comparison needs no dates.
 */
function clampToSpan(month: string | null, span: MonthSpan | null): string | null {
	if (!span) return null;
	if (!month) return span.latest;
	if (month < span.earliest) return span.earliest;
	if (month > span.latest) return span.latest;
	return month;
}

/**
 * The window this one may honestly be compared against, or null.
 *
 * The previous window has to be one the record covers the whole of. A trailing
 * year anchored on the second month a household ever imported is compared
 * against twelve months of which eleven are before the record begins, and the
 * eleven months of nothing come back as a collapse in everything they earn —
 * a fact about the import, reported as a fact about the household. The window
 * is refused rather than pro-rated, because a household that imported four
 * months of one year cannot be told what the other eight held.
 *
 * There is nothing to compare on an instance with no anchor either: that is an
 * instance with nothing in it. `YYYY-MM` sorts chronologically as text, the way
 * `clampToSpan` above relies on, so the coverage test needs no dates.
 */
function comparableWindow(
	period: Period,
	anchorMonth: string | null,
	bounds: MonthSpan | null
): { start: string; end: string; caption: string } | null {
	if (!anchorMonth || !bounds) return null;
	const before = previousRange(period, anchorMonth);
	return before.start.slice(0, 7) < bounds.earliest ? null : before;
}

/**
 * The expense stage money nobody attributed rides in.
 *
 * The seeded catch-all when the household still has it, and otherwise the last
 * expense stage — any group is deletable, and money with nowhere to ride would
 * be reported as cash that was never spent. Read from the groups rather than
 * named outright in the two places that need it, so they cannot answer
 * differently: the sum and the leaf under it are the same claim.
 */
function catchAllGroup(groups: GroupRow[]): GroupRow | undefined {
	const expense = stagesOf(groups);
	return expense.find((group) => group.key === 'living') ?? expense.at(-1);
}

/** What one linked payment turns into: the loan it went to, and how it split. */
interface LoanShare {
	loanId: string;
	name: string;
	/** The fraction of the payment that was interest, between 0 and 1. */
	interest: number;
	/** Where a half with no category of its own leads: the loan's own card. */
	href: string;
}

/**
 * How each loan payment in this window split, keyed by the transaction that
 * carried it.
 *
 * The transaction is the only thing the two records have in common — the
 * register knows money left an account, the loan knows what the bank did with
 * it — so a payment nobody linked stays whole, and so does every loan with no
 * linked payment in the window.
 *
 * Read from `loan_event.interest_minor` rather than worked out here. The five
 * rules in `$lib/loans/payment-split` still decide it; they run once, when the
 * payment is recorded, because the register has to be able to express the same
 * split in SQL and cannot run an amortisation schedule per row. A null is the
 * record saying nothing honest can be said — no rate on it — and that payment
 * stays one cost on both screens.
 *
 * A ratio rather than two amounts: the line has already been converted to the
 * household's currency, and converting the loan's own minor units a second time
 * would be a second chance to disagree with the first.
 */
async function loanSharesFor(transactionIds: string[]): Promise<Map<string, LoanShare>> {
	if (transactionIds.length === 0) return new Map();
	const events = await db
		.select({
			transactionId: loanEvent.transactionId,
			amountMinor: loanEvent.amountMinor,
			interestMinor: loanEvent.interestMinor,
			loanId: loan.id,
			loanName: loan.name
		})
		.from(loanEvent)
		.innerJoin(loan, eq(loanEvent.loanId, loan.id))
		.where(
			and(inArray(loanEvent.transactionId, transactionIds), inArray(loanEvent.kind, PAYMENT_KINDS))
		)
		.orderBy(loanEvent.happenedOn, loanEvent.id);

	const shares = new Map<string, LoanShare>();
	// Which transactions have been answered for, apart from which ones split: the
	// oldest claim is the one that counts even when it has no interest on record,
	// so a younger claim must not answer in its place.
	//
	// Known limitation: one transaction referenced by two events — two loans paid
	// by a single standing order, or a payment recorded twice — keeps only that
	// oldest claim. Splitting one line between several loans needs the share each
	// of them took, which nothing records yet, and a guessed share would be a
	// worse answer than one loan's own numbers.
	const claimed = new Set<string>();
	for (const event of events) {
		// The query already excluded the unlinked events; this is what says so to
		// the type checker.
		if (event.transactionId === null || claimed.has(event.transactionId)) continue;
		claimed.add(event.transactionId);
		if (event.interestMinor === null || event.amountMinor <= 0n) continue;
		// Rule 5 of the split, applied to a figure that was stored rather than
		// derived: a statement can disagree with the schedule, and neither is
		// grounds for reporting a payment that repaid a negative amount of debt.
		// The register's own SQL clamps it the same way.
		const interest =
			event.interestMinor < 0n
				? 0n
				: event.interestMinor > event.amountMinor
					? event.amountMinor
					: event.interestMinor;
		shares.set(event.transactionId, {
			loanId: event.loanId,
			name: event.loanName,
			interest: Number(interest) / Number(event.amountMinor),
			href: `/loans#loan-${event.loanId}`
		});
	}
	return shares;
}

/**
 * One window's transactions (transfers excluded by definition), converted to
 * base-currency major units and added up by leaf.
 *
 * Split out of `flowData` so the window on screen and the window it is compared
 * against are summed by the same code rather than by two that agree today. It
 * is also the only part that touches the database per window, which is what
 * lets the two of them run at once.
 */
async function aggregateWindow(range: DateRange, ctx: WindowContext): Promise<Agg> {
	// The value date decides which month a movement belongs to when the bank
	// provides one — card payments started in June and booked in July count in
	// June, where the money actually moved. The register bounds itself on the
	// same fragment, which is the point of importing it rather than writing the
	// expression out again: two copies drifting apart is exactly how the chart
	// and the list behind it came to measure different months.
	const day = effectiveDate();
	const rows = await db
		.select()
		.from(transaction)
		.where(and(notOwnTransfer(), sql`${day} >= ${range.start}`, sql`${day} <= ${range.end}`));
	const splitsByTxn = await loadSplits(rows.map((r) => r.id));

	// A mortgage instalment is two movements sharing one amount, and the
	// principal half is filed under a category of its own — seeded into the
	// savings group, and read from the row rather than assumed to be there, so a
	// household that moved or renamed it is followed. Gated on that row existing
	// because the register's SQL has no other way to name the principal line: a
	// record that deleted the category leaves its payments whole on both screens
	// rather than splitting them on one.
	const principalCategory = ctx.categoryById.get(LOAN_PRINCIPAL_CATEGORY);
	const loanShares = principalCategory
		? await loanSharesFor(rows.map((r) => r.id))
		: new Map<string, LoanShare>();
	const catchAllKey = catchAllGroup(ctx.groups)?.key ?? null;
	// Which groups are drawn as expense stages, so the interest half can be
	// checked against them below rather than trusted to be one.
	const expenseKeys = new Set(stagesOf(ctx.groups).map((group) => group.key));

	// One aggregate for the window, keyed by leaf rather than by category id:
	// the unfiled buckets are leaves as much as a category is, and the chart and
	// the strip beneath it are then built out of the same figures.
	const byLeaf = new Map<LeafKey, Leaf>();
	const addToLeaf = (key: LeafKey, leaf: Omit<Leaf, 'value'>, major: number) => {
		const seen = byLeaf.get(key);
		if (seen) seen.value += major;
		else byLeaf.set(key, { ...leaf, value: major });
	};

	for (const t of rows) {
		const splits = splitsByTxn.get(t.id) ?? [];
		// A split made by hand is a person's own statement about where the money
		// went, and the register keeps it: its effective-line relation divides a
		// claimed instalment only when nothing else has divided it. Halving it
		// here as well would put a band at odds with the lines behind it.
		const share = splits.length === 0 ? loanShares.get(t.id) : undefined;
		// effectiveLines is the only thing that knows whether this is split, and
		// it has already netted the bank's own fee out of the first line.
		for (const line of effectiveLines(t, splits)) {
			const converted = convertOrFace(
				ctx.rates,
				line.amountMinor,
				t.currency,
				ctx.base,
				t.valueOn ?? t.bookedOn
			);
			const major = toMajor(converted, ctx.base);
			const filed = line.categoryId ? ctx.categoryById.get(line.categoryId) : undefined;
			// Where the interest half rides: the group the payment is already
			// filed under, and the catch-all when nobody has filed it. The
			// household's own group only counts if the chart draws it as an
			// expense stage — a payment filed under an income group, or under a
			// group that has since been deleted, would otherwise leave the totals
			// without leaving the account. With no stage for it at all the line
			// stays whole rather than quietly vanishing.
			const filedIn = filed?.groupKey;
			const interestKey = filedIn && expenseKeys.has(filedIn) ? filedIn : catchAllKey;
			if (share && principalCategory && interestKey) {
				// Both halves in the line's own proportion, so a split receipt and
				// a foreign-currency loan need nothing of their own — and taking
				// the principal as the remainder keeps the two summing to exactly
				// what the line was.
				const interest = major * share.interest;
				addToLeaf(
					`loan:${share.loanId}:interest`,
					{
						name: `${share.name} · interest`,
						groupKey: interestKey,
						// The category the debit was filed with, which is where the
						// register keeps this half too. Two leaves then share one
						// link and together come to what it lists — where the whole
						// instalment used to be listed under it and neither did.
						// An unfiled payment has no category to lead to, so that
						// half leads to the loan instead.
						categoryId: line.categoryId,
						href: line.categoryId ? undefined : share.href
					},
					interest
				);
				addToLeaf(
					`loan:${share.loanId}:principal`,
					{
						name: `${share.name} · principal`,
						groupKey: principalCategory.groupKey,
						categoryId: principalCategory.id
					},
					major - interest
				);
				continue;
			}
			if (filed) {
				addToLeaf(
					`cat:${filed.id}`,
					{ name: filed.name, groupKey: filed.groupKey, categoryId: filed.id },
					major
				);
			} else if (major > 0) {
				addToLeaf(
					'unfiled:in',
					{ name: 'Unfiled income', groupKey: null, categoryId: null },
					major
				);
			} else {
				addToLeaf('unfiled:out', { name: 'Unfiled', groupKey: null, categoryId: null }, major);
			}
		}
	}

	return { byLeaf, rows: rows.length };
}

/**
 * A window's leaves as the four totals and the stages they passed through.
 *
 * Pure, and run once per window, so the figures a comparison is drawn from are
 * the figures the chart is drawn from — a group head that counted savings one
 * way on screen and another way in the window behind it would report the
 * difference between two formulas as a change in what the household did.
 *
 * `categories` is here for the ORDER income sources are listed in: the leaf map
 * is keyed, and its insertion order is whatever order the bank exported.
 */
function summarise(agg: Agg, groups: GroupRow[], categories: CategoryRow[]): WindowSummary {
	const incomeKeys = new Set(groups.filter((g) => g.role === 'income').map((g) => g.key));
	// Savings groups are read from their rows rather than from the key and token
	// this used to hardcode, so a household that renames or recolours one — or
	// keeps two — sees that here.
	const savingsGroups = groups.filter((g) => g.role === 'savings');

	const groupTotal = (groupKey: string) => {
		let sum = 0;
		for (const leaf of agg.byLeaf.values()) if (leaf.groupKey === groupKey) sum += leaf.value;
		return sum;
	};

	// Money put aside is a stage like any other, and a household may keep more
	// than one place to put it — a brokerage and a pension are both savings and
	// neither is spending. Every savings-role group gets its own stage, so no
	// group falls outside both `out` and `saved` and is silently reported as
	// cash that stayed in the account.
	//
	// A group the window took money OUT of is not a stage at all. Nothing was
	// saved, so calling the magnitude "saved" would understate what was kept by
	// twice the withdrawal; the drawdown enters on the left instead, as the
	// source of spending money it actually was.
	const savingsStages: StageFigure[] = [];
	const drawdowns: SourceFigure[] = [];
	for (const g of savingsGroups) {
		const total = groupTotal(g.key);
		if (total > ROUNDING) {
			drawdowns.push({
				key: `grp:${g.key}`,
				name: g.label,
				amount: total,
				colorVar: g.colorToken,
				// What came back OUT of the group — the opposite side of the ledger
				// from the stage of the same name, which is why the link says so.
				narrow: { group: g.key, dir: 'in' }
			});
		} else {
			savingsStages.push({
				key: g.key,
				label: g.label,
				colorVar: g.colorToken,
				// savings are negative sums, like expenses: the chart wants magnitudes
				amount: Math.max(0, -total),
				role: 'savings',
				narrow: { group: g.key }
			});
		}
	}

	// Income sources: income-group leaves with nonzero sums, plus a bucket for
	// not-yet-categorised inflows so the chart never lies about the total, plus
	// any savings the window drew back down.
	const sources: SourceFigure[] = categories
		.filter((c) => incomeKeys.has(c.groupKey))
		.map((c) => ({
			key: `cat:${c.id}`,
			name: c.name,
			amount: agg.byLeaf.get(`cat:${c.id}`)?.value ?? 0,
			narrow: { category: c.id }
		}))
		.filter((s) => s.amount > ROUNDING);
	const unfiledIn = agg.byLeaf.get('unfiled:in')?.value ?? 0;
	if (unfiledIn > ROUNDING)
		sources.push({
			key: 'unfiled:in',
			name: 'Unfiled income',
			amount: unfiledIn,
			// Nothing to name it by, so it links to the absence of one — which is a
			// question the register already answers.
			narrow: { category: UNCATEGORISED, dir: 'in' }
		});
	sources.push(...drawdowns);

	const totalIn = sources.reduce((s, x) => s + x.amount, 0);

	const stages: StageFigure[] = stagesOf(groups).map((g) => ({
		key: g.key,
		label: g.label,
		colorVar: g.colorToken,
		// expenses are negative sums; the chart wants positive magnitudes
		amount: Math.max(0, -groupTotal(g.key)),
		role: 'expense',
		narrow: { group: g.key }
	}));
	// Not-yet-categorised outflows ride in the catch-all stage so the trunk never
	// overstates what survived; they show up as an explicit "Unfiled" leaf in the
	// breakdown the caller builds.
	//
	// That used to name 'living' outright. Groups are a household's own now and
	// any of them can be deleted, so `catchAllGroup` takes the last expense stage
	// when the seeded catch-all is gone — and when there are no expense stages at
	// all, the unfiled amount simply has nowhere to ride and is left out of the
	// trunk rather than silently attached to something it does not belong to.
	const catchAllKey = catchAllGroup(groups)?.key;
	const unfiledOut = -(agg.byLeaf.get('unfiled:out')?.value ?? 0);
	const ridesIn = unfiledOut > ROUNDING ? stages.find((s) => s.key === catchAllKey) : undefined;
	if (ridesIn) ridesIn.amount += unfiledOut;

	// Read before the savings stages join them: "out" is what was spent, and
	// money put aside was not spent.
	const totalOut = stages.reduce((s, x) => s + x.amount, 0);

	stages.push(...savingsStages);
	const saved = savingsStages.reduce((s, x) => s + x.amount, 0);

	// What nothing took. Negative means the window was paid for out of money the
	// household already had.
	const kept = totalIn - totalOut - saved;

	const byGroupKey: Record<string, number> = {};
	for (const stage of stages) byGroupKey[stage.key] = stage.amount;
	// Signed, unlike every stage beside it: a shortfall is a different thing from
	// a small surplus, and whatever compares two windows has to be able to tell.
	byGroupKey[KEPT_KEY] = kept;

	return {
		sources,
		stages,
		totals: { in: totalIn, out: totalOut, saved, kept },
		byGroupKey,
		unfiled: { out: unfiledOut, stageKey: ridesIn?.key ?? null }
	};
}

/**
 * Aggregate the period's transactions (transfers excluded by definition) into
 * the waterfall's shape, in base-currency major units — and the window before
 * it, so every figure can be read against what it was.
 *
 * Four totals rather than three. Money put aside is a stage the money passes
 * through like any other — it left the account — and what none of the stages
 * took is cash the household still holds. The old chart called that residual
 * "Saved & invested", which named money nobody had invested and left the
 * savings group's own leaves hanging off a node that did not exist.
 */
export async function flowData(period: Period, options: FlowOptions = {}): Promise<FlowData> {
	const base = await getBaseCurrency();
	const rates = await loadRateTable();
	// Both ends of the record in one query: the anchor is clamped to it and the
	// month steppers are disabled at it, so reading it twice is how the caption
	// and the arrow beneath it come to disagree.
	const bounds = await monthSpanWithData();
	const anchorMonth = clampToSpan(options.anchor ?? null, bounds);
	const { start, end, caption } = periodRange(period, anchorMonth);
	const before = comparableWindow(period, anchorMonth, bounds);

	// Every figure the chart draws stands for rows the register can list, so
	// every one of them carries the link that lists them. The period is pinned
	// here once: the bounds the figures were summed over, and the anchor month
	// opened, so arriving from the chart shows the month the chart is about
	// rather than the newest one the register happens to hold.
	const link = (narrow: Narrow) =>
		registerHref({ ...narrow, from: start, to: end, month: anchorMonth });

	const [categories, groups] = await Promise.all([
		db.select().from(category),
		loadCategoryGroups()
	]);
	const ctx: WindowContext = {
		base,
		rates,
		categoryById: new Map(categories.map((c) => [c.id, c])),
		groups
	};
	// The two windows at once. They read different rows and neither needs
	// anything the other produced, so the comparison costs a query rather than a
	// wait.
	const [agg, aggBefore] = await Promise.all([
		aggregateWindow({ start, end }, ctx),
		before ? aggregateWindow(before, ctx) : null
	]);

	const summary = summarise(agg, groups, categories);
	// A window with no movements at all has nothing to say. Comparing against it
	// would report the month the household started importing as a collapse in
	// everything they earn.
	const summaryBefore =
		aggBefore && aggBefore.rows > 0 ? summarise(aggBefore, groups, categories) : null;
	const previous =
		before && summaryBefore
			? {
					caption: before.caption,
					totals: summaryBefore.totals,
					byGroupKey: summaryBefore.byGroupKey
				}
			: null;

	const sources: FlowFigures['sources'] = summary.sources.map((source) => ({
		key: source.key,
		name: source.name,
		amount: source.amount,
		colorVar: source.colorVar,
		href: link(source.narrow)
	}));
	const stages: FlowFigures['stages'] = summary.stages.map((stage) => ({
		key: stage.key,
		label: stage.label,
		colorVar: stage.colorVar,
		amount: stage.amount,
		role: stage.role,
		href: link(stage.narrow)
	}));

	// A group's own leaves, in the order the categories screen lists them and as
	// magnitudes, which is what both the chart and the strip want. Only this
	// window has them: a leaf is a row somebody clicks through to, and the window
	// behind this one is not on screen to click.
	const drawn = (leaf: Leaf) => Math.abs(leaf.value) > ROUNDING;
	const leavesIn = (groupKey: string) => {
		const filed = categories
			.filter((c) => c.groupKey === groupKey)
			.map((c): [LeafKey, Leaf | undefined] => [`cat:${c.id}`, agg.byLeaf.get(`cat:${c.id}`)])
			.filter((entry): entry is [LeafKey, Leaf] => entry[1] !== undefined && drawn(entry[1]));
		// The halves of a loan payment are leaves of the group they landed in
		// too, and they are keyed by the loan rather than by a category: the
		// interest carries the category the debit was filed with, which another
		// leaf already stands for, and the principal carries the one every
		// instalment's principal shares. Keyed `cat:` they would collide.
		const halves = [...agg.byLeaf.entries()].filter(
			([key, leaf]) => key.startsWith('loan:') && leaf.groupKey === groupKey && drawn(leaf)
		);
		// The key travels with the leaf rather than being dropped here: it is the
		// only thing that tells two identically named leaves apart.
		return [...filed, ...halves].map(([key, leaf]) => ({
			key,
			name: leaf.name,
			value: Math.abs(leaf.value),
			href: leaf.href ?? link({ category: leaf.categoryId })
		}));
	};

	const { in: totalIn, kept } = summary.totals;
	const pctOf = (amount: number) => (totalIn > 0 ? Math.round((amount / totalIn) * 100) : 0);

	const breakdown = [
		...stages.map((stage) => ({
			key: stage.key,
			label: stage.label,
			colorVar: stage.colorVar,
			pct: pctOf(stage.amount),
			leaves: [
				...leavesIn(stage.key),
				...(stage.key === summary.unfiled.stageKey
					? [
							{
								key: 'unfiled:out',
								name: 'Unfiled',
								value: summary.unfiled.out,
								href: link({ category: UNCATEGORISED, dir: 'out' })
							}
						]
					: [])
			]
		})),
		// A shortfall is not a smaller surplus, so it is not drawn as one: the
		// strip names where the money came from instead of reporting a negative
		// amount of cash kept.
		kept < -ROUNDING
			? {
					key: RESERVES_KEY,
					label: RESERVES_LABEL,
					colorVar: RESERVES_COLOR,
					pct: pctOf(-kept),
					leaves: []
				}
			: { key: KEPT_KEY, label: KEPT_LABEL, colorVar: KEPT_COLOR, pct: pctOf(kept), leaves: [] }
	];

	return {
		input: {
			sources,
			stages,
			keptLabel: KEPT_LABEL,
			reservesLabel: RESERVES_LABEL,
			// The trunk is everything that came in, which is one side of the ledger
			// rather than any category or group.
			incomeHref: link({ dir: 'in' })
		},
		caption,
		period,
		anchor: anchorMonth,
		bounds,
		totals: summary.totals,
		breakdown,
		previous
	};
}

interface MonthBar {
	month: string; // YYYY-MM
	earned: number;
	spent: number;
}

/**
 * The oldest and newest months holding a transaction that is not a transfer
 * leg, as `YYYY-MM`, or null on an instance with nothing imported.
 *
 * Neither rule here is a free choice — both are the rules monthlyHistory and
 * flowData already apply. The effective date is the value date when the bank
 * prints one, and transfer legs are excluded. A month whose only movement was
 * between the household's own accounts has no spending to show, so anchoring on
 * it would reproduce the empty chart this exists to fix.
 *
 * Both ends come back from one aggregate because they are always wanted
 * together: the newest is where a screen opens, and the pair is where the month
 * steppers stop.
 */
async function monthSpanWithData(handle: Queryable = db): Promise<MonthSpan | null> {
	const day = effectiveDate();
	const [row] = await handle
		.select({
			earliest: sql<string | null>`to_char(min(${day}), 'YYYY-MM')`,
			latest: sql<string | null>`to_char(max(${day}), 'YYYY-MM')`
		})
		.from(transaction)
		.where(notOwnTransfer());
	// An instance with no rows at all still returns one row, with both ends null.
	return row?.earliest && row?.latest ? { earliest: row.earliest, latest: row.latest } : null;
}

/** The newest end of that span alone, which is where a screen opens. */
export async function latestMonthWithData(handle: Queryable = db): Promise<string | null> {
	return (await monthSpanWithData(handle))?.latest ?? null;
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
