// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Server-side transaction operations shared by the register and the import
// review queue. Filing lives here rather than in `categorize` because the
// learned rule has to be replayed by `pairAndCategorise`, and ingest already
// imports categorize — putting it there would close a cycle.

import { and, asc, desc, eq, gte, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { db, type Db, type Queryable } from '$lib/server/db';
import {
	account,
	category,
	currencyRate,
	transaction,
	transactionSplit,
	tagLink
} from '$lib/server/db/schema';
import { learnRule } from '$lib/server/categorize';
import {
	lockTransferPairing,
	pairAndCategorise,
	pairingWindowAround
} from '$lib/server/import/ingest';
import { applyScores, autoThreshold, loadRules } from '$lib/server/rules';
import { decideWithRules, scoreChanges } from '$lib/rules/match';
import { minorDigits } from '$lib/money';
import { attributeSalary, recordSalary, rememberAttribution } from '$lib/server/salary';
import { monthAfter, UNCATEGORISED, type RegisterFilter } from '$lib/transactions/filter';
import type { EnumValue } from '$lib/enums';
import { notOwnTransfer } from '$lib/server/transactions/transfers';

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

/** One transaction's lines after split resolution and fee allocation. */
function effectiveLineRelation(): SQL {
	const fee = sql`coalesce(${transaction.feeMinor}, 0::bigint)`;
	return sql`
		select
			(${transaction.amountMinor} - ${fee})::bigint as amount_minor,
			${transaction.categoryId}::text as category_id,
			-- uuid, not text: the two union branches have to agree, and tag_link
			-- .target_id is a uuid since 0053 so the comparison must be legal.
			null::uuid as split_id
		where not exists (
			select 1 from ${transactionSplit} any_split
			where any_split.transaction_id = ${transaction.id}
		)
		union all
		select
			(split.amount_minor - case
				when row_number() over (order by split.sort, split.id) = 1 then ${fee}
				else 0::bigint
			end)::bigint as amount_minor,
			split.category_id::text as category_id,
			split.id as split_id
		from ${transactionSplit} split
		where split.transaction_id = ${transaction.id}
	`;
}

/**
 * The effective lines selected by the line-scoped filters.
 *
 * A direct tag covers every line. A split tag covers only that split, and the
 * boolean `or` means a line carrying both scopes still appears once. Category
 * and tag predicates live in the same `where`, so they must match the same
 * effective line rather than two unrelated lines of the same transaction.
 */
function selectedEffectiveLines(filter: RegisterFilter): SQL {
	const clauses: SQL[] = [];
	if (filter.categoryId === UNCATEGORISED) clauses.push(sql`effective_line.category_id is null`);
	else if (filter.categoryId) clauses.push(sql`effective_line.category_id = ${filter.categoryId}`);

	if (filter.tagId) {
		// The id arrives from a URL parameter as a string, and tag_id is uuid since
		// 0053, so the cast is what makes the comparison legal rather than a
		// "no operator matches" at query time.
		//
		// One table for both, distinguished only by which id the link points at.
		// `tag_link.target_id` is an entity id, and a transaction and its splits are
		// separate entities, so no kind filter is needed here — the id itself is the
		// discriminator.
		clauses.push(sql`(
			exists (
				select 1 from ${tagLink} direct_tag
				where direct_tag.target_id = ${transaction.id}
				  and direct_tag.tag_id = ${filter.tagId}::uuid
			)
			or (
				effective_line.split_id is not null
				and exists (
					select 1 from ${tagLink} split_tag
					where split_tag.target_id = effective_line.split_id
					  and split_tag.tag_id = ${filter.tagId}::uuid
				)
			)
		)`);
	}

	const where = clauses.length > 0 ? sql`where ${and(...clauses)}` : sql``;
	return sql`
		select effective_line.amount_minor
		from (${effectiveLineRelation()}) effective_line
		${where}
	`;
}

/** Latest known CZK-per-unit fixing on a transaction's effective date. */
function datedCzkRate(currency: SQL, day: SQL): SQL {
	return sql`case
		when ${currency} = 'CZK' then 1::numeric
		else (
			select ${currencyRate.rate}::numeric
			from ${currencyRate}
			where ${currencyRate.code} = ${currency}
			  and ${currencyRate.day} <= ${day}
			order by ${currencyRate.day} desc
			limit 1
		)
	end`;
}

/** Magnitude of the parent transaction, rounded to base-currency minor units. */
function convertedMagnitude(filter: RegisterFilter, rowFactor?: SQL): SQL {
	const baseCurrency = filter.baseCurrency.toUpperCase();
	const baseFactor = (10 ** minorDigits(baseCurrency)).toString();
	const sourceFactor = rowFactor ?? sql`${baseFactor}::numeric`;
	const day = sql`coalesce(${transaction.valueOn}, ${transaction.bookedOn})`;
	const sourceRate = datedCzkRate(sql`${transaction.currency}`, day);
	const baseRate = datedCzkRate(sql`${baseCurrency}`, day);
	const faceValue = sql`round(
		abs(${transaction.amountMinor})::numeric * ${baseFactor}::numeric / (${sourceFactor})::numeric
	)`;

	return sql`case
		when ${transaction.currency} = ${baseCurrency} then abs(${transaction.amountMinor})::numeric
		else coalesce(
			round(
				abs(${transaction.amountMinor})::numeric
				* (${sourceRate})
				* ${baseFactor}::numeric
				/ nullif((${baseRate}) * (${sourceFactor})::numeric, 0::numeric)
			),
			${faceValue}
		)
	end`;
}

/** Transaction-scoped filter clauses, deliberately excluding line selection. */
function registerTransactionWhere(filter: RegisterFilter, rowFactor?: SQL): SQL | undefined {
	const clauses: SQL[] = [];

	if (filter.search) clauses.push(searchable(filter.search));
	if (filter.from) clauses.push(gte(transaction.bookedOn, filter.from));
	if (filter.to) clauses.push(lte(transaction.bookedOn, filter.to));
	if (filter.accountId) clauses.push(eq(transaction.accountId, filter.accountId));

	if (filter.direction === 'in') clauses.push(sql`${transaction.amountMinor} > 0`);
	else if (filter.direction === 'out') clauses.push(sql`${transaction.amountMinor} < 0`);

	// Bounds are magnitudes entered in the household base currency. Conversion
	// uses value date (falling back to booking date), like every other dated
	// ledger total. When no fixing exists, face-value scaling matches the
	// application's visible, explicitly-labelled FX fallback.
	const magnitude = convertedMagnitude(filter, rowFactor);
	if (filter.minMinor !== null)
		clauses.push(sql`${magnitude} >= ${filter.minMinor.toString()}::numeric`);
	if (filter.maxMinor !== null)
		clauses.push(sql`${magnitude} <= ${filter.maxMinor.toString()}::numeric`);

	// The expanded month. A half-open range rather than to_char, so it reads the
	// same index the from/to bounds above do — a register that had to compute a
	// string per row to find one month would scan the whole ledger to open it.
	if (filter.month) {
		clauses.push(gte(transaction.bookedOn, `${filter.month}-01`));
		clauses.push(lt(transaction.bookedOn, monthAfter(filter.month)));
	}

	if (filter.reviewState) clauses.push(eq(transaction.reviewState, filter.reviewState));

	// Own-account transfers are noise in a ledger view, as they are in cash
	// flow, so they stay out unless explicitly asked for.
	if (!filter.includeTransfers) clauses.push(notOwnTransfer());
	if (filter.sourceMethod) clauses.push(eq(transaction.sourceMethod, filter.sourceMethod));

	return clauses.length > 0 ? and(...clauses) : undefined;
}

/** The complete row predicate, including at least one selected effective line. */
function registerWhere(filter: RegisterFilter, rowFactor?: SQL): SQL {
	return and(
		registerTransactionWhere(filter, rowFactor),
		sql`exists (${selectedEffectiveLines(filter)})`
	) as SQL;
}

interface RegisterRow {
	id: string;
	bookedAt: string;
	amount: bigint;
	currency: string;
	counterparty: string | null;
	description: string | null;
	categoryId: string | null;
	categoryLabel: string | null;
	/** The enum, not a bare string: the register colours and names each state. */
	reviewState: EnumValue<'transaction.review_state'>;
	accountId: string;
	accountName: string;
	isTransfer: boolean;
	/** How it is known to be one: proved by two statements, or asserted. */
	transferKind: 'paired' | 'one-sided' | null;
	/** How this row was read, and how strongly it was proven. */
	sourceMethod: string | null;
	proofClass: string | null;
}

interface RegisterPage {
	rows: RegisterRow[];
	total: number;
	/** Signed sums over everything the filter selects, never re-denominated. */
	totals: { currency: string; sumMinor: bigint }[];
	pageCount: number;
}

/** One month of the register, as its collapsed row states it. */
interface RegisterMonth {
	/** `YYYY-MM`. */
	month: string;
	/** How many transactions it holds, over every currency. */
	count: number;
	/**
	 * What came in and what went out, per currency, both as magnitudes.
	 *
	 * Never re-denominated and never netted into one figure: two currencies in
	 * one month are two facts, and adding them would invent a third that is true
	 * in neither. `sumMinor` is what the month came to, signed.
	 */
	byCurrency: { currency: string; inMinor: bigint; outMinor: bigint; sumMinor: bigint }[];
}

/** 10^(minor digits) per row, derived from the currencies actually present. */
async function currencyRowFactor(handle: Queryable): Promise<SQL> {
	const rows = await handle.selectDistinct({ currency: transaction.currency }).from(transaction);
	if (rows.length === 0) return sql`100::bigint`;
	const whens = rows.map(
		(r) => sql`when ${r.currency} then ${(10 ** minorDigits(r.currency)).toString()}::bigint`
	);
	return sql`case ${transaction.currency} ${sql.join(whens, sql` `)} else 100::bigint end`;
}

export async function registerPage(
	filter: RegisterFilter,
	handle: Queryable = db
): Promise<RegisterPage> {
	const needsScale = filter.minMinor !== null || filter.maxMinor !== null;
	const rowFactor = needsScale ? await currencyRowFactor(handle) : undefined;
	const transactionWhere = registerTransactionWhere(filter, rowFactor);
	const where = registerWhere(filter, rowFactor);
	const selectedLines = selectedEffectiveLines(filter);

	const [rows, aggregates] = await Promise.all([
		handle
			.select({
				id: transaction.id,
				bookedOn: transaction.bookedOn,
				amountMinor: transaction.amountMinor,
				currency: transaction.currency,
				counterparty: transaction.counterparty,
				description: transaction.description,
				categoryId: transaction.categoryId,
				categoryLabel: category.name,
				reviewState: transaction.reviewState,
				accountId: transaction.accountId,
				accountName: account.name,
				transferPairId: transaction.transferPairId,
				transferToAccountId: transaction.transferToAccountId,
				sourceMethod: transaction.sourceMethod,
				proofClass: transaction.proofClass
			})
			.from(transaction)
			.innerJoin(account, eq(transaction.accountId, account.id))
			.leftJoin(category, eq(transaction.categoryId, category.id))
			.where(where)
			.orderBy(desc(transaction.bookedOn), asc(transaction.id))
			.limit(filter.pageSize)
			.offset((filter.page - 1) * filter.pageSize),
		// Only one aggregate row per currency crosses the wire, regardless of
		// ledger size. This replaces loading every matching transaction and split
		// into Node merely to count and sum them.
		handle
			.select({
				currency: transaction.currency,
				count: sql<number>`count(distinct ${transaction.id})::integer`.mapWith(Number),
				sumMinor: sql<bigint>`sum(selected_line.amount_minor)`.mapWith(transaction.amountMinor)
			})
			.from(transaction)
			.innerJoin(sql`lateral (${selectedLines}) selected_line`, sql`true`)
			.where(transactionWhere)
			.groupBy(transaction.currency)
	]);

	const total = aggregates.reduce((sum, aggregate) => sum + aggregate.count, 0);
	const totals = aggregates
		.map((aggregate) => ({ currency: aggregate.currency, sumMinor: aggregate.sumMinor }))
		.sort((a, b) => (a.currency < b.currency ? -1 : 1));

	return {
		rows: rows.map((r) => ({
			id: r.id,
			bookedAt: r.bookedOn,
			amount: r.amountMinor,
			currency: r.currency,
			counterparty: r.counterparty,
			description: r.description,
			categoryId: r.categoryId,
			categoryLabel: r.categoryLabel,
			reviewState: r.reviewState,
			accountId: r.accountId,
			accountName: r.accountName,
			sourceMethod: r.sourceMethod,
			proofClass: r.proofClass,
			isTransfer: r.transferPairId !== null || r.transferToAccountId !== null,
			// A matched pair is proved by two statements; a one-sided transfer is
			// asserted by a person. The register says which, because only one of
			// them is evidence.
			transferKind:
				r.transferPairId !== null
					? ('paired' as const)
					: r.transferToAccountId !== null
						? ('one-sided' as const)
						: null
		})),
		total,
		totals,
		pageCount: Math.max(1, Math.ceil(total / filter.pageSize))
	};
}

/**
 * Every month the filter selects, newest first, with what it came to.
 *
 * The register's collapsed rows. Summed from the same effective lines as
 * `registerPage`'s totals — split resolution, fee allocation, the category and
 * tag predicates — so a month's figures and the register's own footing agree
 * rather than being two answers to the same question.
 *
 * `filter.month` is deliberately cleared before the predicate is built: it says
 * which row is EXPANDED, and a list that showed only the row it had opened
 * would have nothing left to open. One aggregate row per month per currency
 * crosses the wire; a decade of a two-currency household is a couple of hundred
 * of them, which is why this is loaded whole rather than paged in the database.
 */
export async function registerMonths(
	filter: RegisterFilter,
	handle: Queryable = db
): Promise<RegisterMonth[]> {
	const scope: RegisterFilter = { ...filter, month: null };
	const needsScale = scope.minMinor !== null || scope.maxMinor !== null;
	const rowFactor = needsScale ? await currencyRowFactor(handle) : undefined;
	const month = sql<string>`to_char(${transaction.bookedOn}, 'YYYY-MM')`;

	const rows = await handle
		.select({
			month,
			currency: transaction.currency,
			count: sql<number>`count(distinct ${transaction.id})::integer`.mapWith(Number),
			// Magnitudes, split by sign: a month's "in" is the sum of its credits,
			// not the positive part of its net.
			inMinor: sql`sum(greatest(selected_line.amount_minor, 0::bigint))`.mapWith(
				transaction.amountMinor
			),
			outMinor: sql`sum(greatest(-selected_line.amount_minor, 0::bigint))`.mapWith(
				transaction.amountMinor
			)
		})
		.from(transaction)
		.innerJoin(sql`lateral (${selectedEffectiveLines(scope)}) selected_line`, sql`true`)
		.where(registerTransactionWhere(scope, rowFactor))
		.groupBy(month, transaction.currency)
		.orderBy(desc(month), asc(transaction.currency));

	const byMonth = new Map<string, RegisterMonth>();
	for (const row of rows) {
		if (!byMonth.has(row.month))
			byMonth.set(row.month, { month: row.month, count: 0, byCurrency: [] });
		const entry = byMonth.get(row.month)!;
		entry.count += row.count;
		entry.byCurrency.push({
			currency: row.currency,
			inMinor: row.inMinor,
			outMinor: row.outMinor,
			sumMinor: row.inMinor - row.outMinor
		});
	}
	return [...byMonth.values()];
}

type FileResult = { ok: true } | { ok: false; status: number; message: string };

/**
 * File a transaction under a category and teach the categoriser from it, so a
 * correction made in the register carries the same weight as one made in the
 * review queue.
 */
/**
 * Whether filing into this category means "this is somebody's pay".
 *
 * Matched on the seeded id rather than the label, so renaming "Salary" to
 * "Wages" keeps working — and on the id alone rather than the income ROLE,
 * because rent received and dividends are income too and are nobody's salary.
 */
async function isSalaryCategory(categoryId: string, handle: Queryable): Promise<boolean> {
	if (categoryId === 'salary') return true;
	const [row] = await handle.select().from(category).where(eq(category.id, categoryId));
	return row?.id === 'salary';
}

export async function fileTransaction(
	id: string,
	categoryId: string,
	handle: Db = db,
	/**
	 * Whose salary this is, when the screen has just asked.
	 *
	 * Only read when the category is a salary one and the account is joint. An
	 * account with an owner answers the question itself, and asking anyway would
	 * be a question with one possible answer.
	 */
	salaryFor?: { personId: string; remember?: boolean }
): Promise<FileResult> {
	if (!id || !categoryId)
		return { ok: false, status: 400, message: 'Missing transaction or category.' };

	return handle.transaction(async (tx) => {
		// This workflow invokes pairing after filing. Acquire the pairing lock
		// before the transaction row so every caller has the same lock order.
		await lockTransferPairing(tx);
		const rows = await tx.select().from(transaction).where(eq(transaction.id, id)).for('update');
		const row = rows[0];
		if (!row) return { ok: false, status: 404, message: 'Transaction not found.' };

		// Score the rules that had an opinion about this row before anything is
		// written. The lock prevents two corrections from scoring and teaching
		// independently against the same stale transaction state.
		const [rules, threshold] = await Promise.all([loadRules(tx), autoThreshold(tx)]);
		const decision = decideWithRules(
			{
				counterparty: row.counterparty,
				counterpartyAccount: row.counterpartyAccount,
				variableSymbol: row.variableSymbol,
				description: row.description,
				amountMinor: row.amountMinor,
				currency: row.currency
			},
			rules,
			threshold
		);
		await applyScores(scoreChanges(decision.matched, categoryId), tx);

		await tx
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
				amountMinor: row.amountMinor,
				currency: row.currency
			},
			categoryId,
			tx
		);
		// Only the filed row changed, so the pass has nothing to learn outside its
		// own neighbourhood — and reading the whole unpaired ledger under row
		// locks made one click of "File" wait on it.
		await pairAndCategorise(tx, pairingWindowAround([row.bookedOn]));

		// Money in, filed as salary, is salary history — the ledger already knew
		// it and the salary screen could not see it. Recorded as NET, because a
		// bank credit is what arrived after tax; a payslip fills the gross column
		// of the same month.
		if (row.amountMinor > 0n && (await isSalaryCategory(categoryId, tx))) {
			const [acct] = await tx.select().from(account).where(eq(account.id, row.accountId));
			const whose =
				salaryFor?.personId ??
				(
					await attributeSalary(
						{
							accountOwnerPersonId: acct?.ownerPersonId ?? null,
							counterparty: row.counterparty,
							accountId: row.accountId
						},
						tx as unknown as Db
					)
				).personId;

			if (whose) {
				await recordSalary(
					{
						personId: whose,
						periodMonth: row.bookedOn.slice(0, 7),
						currency: row.currency,
						netMinor: row.amountMinor,
						source: 'statement',
						transactionId: row.id
					},
					tx as unknown as Db
				);
				if (salaryFor?.remember && row.counterparty) {
					await rememberAttribution(
						{ matchKey: row.counterparty, personId: whose, accountId: row.accountId },
						tx as unknown as Db
					);
				}
			}
			// Nobody to attribute it to leaves the money filed and the salary
			// unrecorded, which is the honest outcome: guessing whose pay it is
			// would corrupt two retirement projections rather than one.
		}
		return { ok: true };
	});
}
