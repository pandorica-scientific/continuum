// Server-side transaction operations shared by the register and the import
// review queue. Filing lives here rather than in `categorize` because the
// learned rule has to be replayed by `pairAndCategorise`, and ingest already
// imports categorize — putting it there would close a cycle.

import { and, asc, desc, eq, gte, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { account, category, transaction } from '$lib/server/db/schema';
import { learnRule } from '$lib/server/categorize';
import { pairAndCategorise } from '$lib/server/import/ingest';
import { loadSplitsMatching } from '$lib/server/splits';
import { applyScores, autoThreshold, loadRules } from '$lib/server/rules';
import { decideWithRules, scoreChanges } from '$lib/rules/match';
import { matchingLineTotal } from '$lib/transactions/lines';
import { minorDigits } from '$lib/money';
import { UNCATEGORISED, type RegisterFilter } from '$lib/transactions/filter';

/** Rows per page. Enough that a month of a busy account fits in one or two. */
export const PAGE_SIZE = 50;

/** Text the search box matches against — what a person actually remembers. */
function searchable(term: string): SQL {
	const like = `%${term}%`;
	return or(
		sql`${transaction.counterparty} ilike ${like}`,
		sql`${transaction.description} ilike ${like}`,
		sql`${transaction.counterpartyAccount} ilike ${like}`,
		sql`${transaction.variableSymbol} ilike ${like}`,
		sql`${transaction.constantSymbol} ilike ${like}`,
		sql`${transaction.specificSymbol} ilike ${like}`
	) as SQL;
}

/**
 * The filter as a single predicate; every clause is independent of the rest.
 *
 * `rowFactor` is 10^(minor digits) for the row's own currency, as SQL. Amount
 * bounds are typed in the base currency, so the comparison cross-multiplies:
 * abs(amount)·baseFactor against bound·rowFactor — all integers, no floats,
 * and a zero-digit currency is never compared a hundred times too small.
 * Omitted, it falls back to the base factor and the factors cancel.
 */
export function registerWhere(filter: RegisterFilter, rowFactor?: SQL): SQL | undefined {
	const clauses: SQL[] = [];
	const factor = rowFactor ?? sql`${filter.baseFactor}::bigint`;

	if (filter.search) clauses.push(searchable(filter.search));
	if (filter.from) clauses.push(gte(transaction.bookedAt, filter.from));
	if (filter.to) clauses.push(lte(transaction.bookedAt, filter.to));
	if (filter.accountId) clauses.push(eq(transaction.accountId, filter.accountId));

	// A split transaction has no category of its own, so both branches have to
	// reach through to its lines.
	if (filter.categoryId === UNCATEGORISED)
		clauses.push(
			and(
				isNull(transaction.categoryId),
				sql`not exists (select 1 from transaction_split s where s.transaction_id = ${transaction.id})`
			) as SQL
		);
	else if (filter.categoryId)
		clauses.push(
			or(
				eq(transaction.categoryId, filter.categoryId),
				sql`exists (select 1 from transaction_split s
				            where s.transaction_id = ${transaction.id}
				              and s.category_id = ${filter.categoryId})`
			) as SQL
		);

	if (filter.direction === 'in') clauses.push(sql`${transaction.amount} > 0`);
	else if (filter.direction === 'out') clauses.push(sql`${transaction.amount} < 0`);

	// Bounds are magnitudes, so they read the same either side of zero.
	if (filter.minMinor !== null)
		clauses.push(
			sql`abs(${transaction.amount}) * ${filter.baseFactor}::bigint >= ${filter.minMinor.toString()}::bigint * (${factor})`
		);
	if (filter.maxMinor !== null)
		clauses.push(
			sql`abs(${transaction.amount}) * ${filter.baseFactor}::bigint <= ${filter.maxMinor.toString()}::bigint * (${factor})`
		);

	if (filter.reviewState) clauses.push(eq(transaction.reviewState, filter.reviewState));

	// Tagged directly, or through any of its split lines.
	if (filter.tagId)
		clauses.push(
			sql`(exists (select 1 from transaction_tag tt
			             where tt.transaction_id = ${transaction.id} and tt.tag_id = ${filter.tagId})
			     or exists (select 1 from transaction_split s
			                join transaction_split_tag st on st.split_id = s.id
			                where s.transaction_id = ${transaction.id} and st.tag_id = ${filter.tagId}))`
		);

	// Own-account transfers are noise in a ledger view, as they are in cash
	// flow, so they stay out unless explicitly asked for.
	if (!filter.includeTransfers) clauses.push(isNull(transaction.transferPairId));

	return clauses.length > 0 ? and(...clauses) : undefined;
}

export interface RegisterRow {
	id: string;
	bookedAt: string;
	amount: bigint;
	currency: string;
	counterparty: string | null;
	description: string | null;
	categoryId: string | null;
	categoryLabel: string | null;
	reviewState: string;
	accountId: string;
	accountName: string;
	isTransfer: boolean;
}

export interface RegisterPage {
	rows: RegisterRow[];
	total: number;
	/** Signed sums over the whole filtered set, never re-denominated. */
	totals: { currency: string; sumMinor: bigint }[];
	pageCount: number;
}

/** 10^(minor digits) per row, derived from the currencies actually present. */
async function currencyRowFactor(): Promise<SQL> {
	const rows = await db.selectDistinct({ currency: transaction.currency }).from(transaction);
	if (rows.length === 0) return sql`100::bigint`;
	const whens = rows.map(
		(r) => sql`when ${r.currency} then ${(10 ** minorDigits(r.currency)).toString()}::bigint`
	);
	return sql`case ${transaction.currency} ${sql.join(whens, sql` `)} else 100::bigint end`;
}

export async function registerPage(filter: RegisterFilter): Promise<RegisterPage> {
	const needsScale = filter.minMinor !== null || filter.maxMinor !== null;
	const where = registerWhere(filter, needsScale ? await currencyRowFactor() : undefined);

	const [rows, matching] = await Promise.all([
		db
			.select({
				id: transaction.id,
				bookedAt: transaction.bookedAt,
				amount: transaction.amount,
				feeMinor: transaction.feeMinor,
				currency: transaction.currency,
				counterparty: transaction.counterparty,
				description: transaction.description,
				categoryId: transaction.categoryId,
				categoryLabel: category.name,
				reviewState: transaction.reviewState,
				accountId: transaction.accountId,
				accountName: account.name,
				transferPairId: transaction.transferPairId
			})
			.from(transaction)
			.innerJoin(account, eq(transaction.accountId, account.id))
			.leftJoin(category, eq(transaction.categoryId, category.id))
			.where(where)
			.orderBy(desc(transaction.bookedAt), asc(transaction.id))
			.limit(PAGE_SIZE)
			.offset((filter.page - 1) * PAGE_SIZE),
		// The whole filtered set, for the totals — a split transaction only
		// contributes the lines the filter actually selected, so this cannot be
		// a SQL sum over transaction.amount.
		db
			.select({
				id: transaction.id,
				amount: transaction.amount,
				feeMinor: transaction.feeMinor,
				categoryId: transaction.categoryId,
				currency: transaction.currency
			})
			.from(transaction)
			.where(where)
	]);

	const splitsForTotals = await loadSplitsMatching(where);
	const wanted = filter.categoryId === UNCATEGORISED ? null : (filter.categoryId ?? null);
	const sumByCurrency = new Map<string, bigint>();
	for (const m of matching) {
		const value = matchingLineTotal(m, splitsForTotals.get(m.id) ?? [], wanted);
		sumByCurrency.set(m.currency, (sumByCurrency.get(m.currency) ?? 0n) + value);
	}

	const total = matching.length;
	const sums = [...sumByCurrency.entries()]
		.map(([currency, sum]) => ({ currency, sum }))
		.sort((a, b) => (a.currency < b.currency ? -1 : 1));

	return {
		rows: rows.map((r) => ({
			id: r.id,
			bookedAt: r.bookedAt,
			amount: r.amount,
			currency: r.currency,
			counterparty: r.counterparty,
			description: r.description,
			categoryId: r.categoryId,
			categoryLabel: r.categoryLabel,
			reviewState: r.reviewState,
			accountId: r.accountId,
			accountName: r.accountName,
			isTransfer: r.transferPairId !== null
		})),
		total,
		totals: sums.map((s) => ({ currency: s.currency, sumMinor: s.sum })),
		pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE))
	};
}

export type FileResult = { ok: true } | { ok: false; status: number; message: string };

/**
 * File a transaction under a category and teach the categoriser from it, so a
 * correction made in the register carries the same weight as one made in the
 * review queue.
 */
export async function fileTransaction(id: string, categoryId: string): Promise<FileResult> {
	if (!id || !categoryId)
		return { ok: false, status: 400, message: 'Missing transaction or category.' };

	const rows = await db.select().from(transaction).where(eq(transaction.id, id));
	const row = rows[0];
	if (!row) return { ok: false, status: 404, message: 'Transaction not found.' };

	// Score the rules that had an opinion about this row before anything is
	// written. The matcher is re-run against the current rules rather than
	// recorded on the transaction: both are to hand, and scoring the present
	// rule set is more useful than scoring a historical one.
	const [rules, threshold] = await Promise.all([loadRules(), autoThreshold()]);
	const decision = decideWithRules(
		{
			counterparty: row.counterparty,
			counterpartyAccount: row.counterpartyAccount,
			variableSymbol: row.variableSymbol,
			description: row.description,
			amountMinor: row.amount
		},
		rules,
		threshold
	);
	await applyScores(scoreChanges(decision.matched, categoryId));

	await db
		.update(transaction)
		.set({
			categoryId,
			suggestedCategoryId: null,
			reviewState: 'confirmed',
			reviewReason: null
		})
		.where(eq(transaction.id, id));

	await learnRule(
		{
			counterparty: row.counterparty,
			counterpartyAccount: row.counterpartyAccount,
			variableSymbol: row.variableSymbol,
			amountMinor: row.amount
		},
		categoryId
	);
	await pairAndCategorise();
	return { ok: true };
}
