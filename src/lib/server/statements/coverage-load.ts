// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The Statements shelf as coverage: one row per account, one year at a time.
 *
 * Its own module because it asks a question no other shelf asks — not "what is
 * filed?" but "which months are accounted for?" — and answering it needs the
 * ledger as well as the archive. An account's first TRANSACTION is evidence
 * that it existed, even in a month whose statement nobody kept, and without
 * that the ribbon would call an account's whole first year missing.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { account, document, documentLink, shelf, transaction } from '$lib/server/db/schema';
import { coverageRow, countGaps, type CoverageBox } from '$lib/statements/coverage';

export interface CoverageRow {
	accountId: string;
	label: string;
	/** The last four of the account number — how a person tells two apart. */
	sublabel: string;
	boxes: CoverageBox[];
}

export interface CoveragePayload {
	year: number;
	/**
	 * The years worth stepping through, inclusive.
	 *
	 * There is nothing to see outside them and the ribbon should not pretend
	 * otherwise: every month of a future year has not arrived yet, and every
	 * month before the first account existed is blank. Sent so the arrows can be
	 * disabled at the ends rather than walking off into empty decades.
	 */
	firstYear: number;
	lastYear: number;
	/** Gaps in THIS year. The banner's figure is the archive's — see `gapsAcrossYears`. */
	gaps: number;
	/**
	 * Documents on the shelf the ribbon cannot draw — for ANY reason.
	 *
	 * Every type, not only `bank_statement`. A broker report is deliberately not
	 * on the ribbon (it belongs to no bank account), and counting only statements
	 * left it invisible twice over: not drawn, and not mentioned. The shelf then
	 * said "5 documents" while the ribbon accounted for four, and the missing one
	 * was unfindable by looking.
	 *
	 * The invariant this keeps: everything on the shelf is either drawn here or
	 * counted here.
	 */
	unplaced: number;
	rows: CoverageRow[];
}

/**
 * `CZ65 0800 0000 1920 0014 5399` → `5399`.
 *
 * The number part only, never the bank code after the slash — the same rule
 * `account-resolution.ts` names an imported account with, so a row here reads
 * the way the account it points at does.
 */
const tail = (numbers: string[]): string =>
	(numbers[0] ?? '').split('/')[0].replace(/\D/g, '').slice(-4);

/**
 * Accounts with their earliest evidence, and every drawable statement.
 *
 * The evidence is gathered by two GROUPED scans and joined in memory, not by a
 * correlated sub-select per account. That is not a performance preference: a
 * `${account.id}` inside a raw sub-select renders as a bare `"id"`, which inside
 * `select ... from "transaction" t` binds to the TRANSACTION's own id and is
 * therefore never true. Every account came back with no evidence and the ribbon
 * drew nothing at all. Two scans cannot be ambiguous about which table a column
 * belongs to.
 */
async function readCoverage(handle: Queryable) {
	const [accounts, filed, firstTxn] = await Promise.all([
		handle
			.select({ id: account.id, name: account.name, numbers: account.numbers })
			.from(account)
			.orderBy(account.name),
		handle
			.select({
				accountId: documentLink.targetId,
				id: document.id,
				periodOn: document.periodOn,
				periodEndOn: document.periodEndOn
			})
			.from(document)
			.innerJoin(shelf, eq(shelf.id, document.shelfId))
			.innerJoin(documentLink, eq(documentLink.documentId, document.id))
			.innerJoin(account, eq(account.id, documentLink.targetId))
			.where(and(eq(shelf.key, 'statements'), sql`${document.periodOn} is not null`)),
		handle
			.select({
				accountId: transaction.accountId,
				first: sql<string | null>`min(${transaction.bookedOn})`
			})
			.from(transaction)
			.groupBy(transaction.accountId)
	]);

	// The earlier of the first statement and the first movement. An account with
	// neither has never been used, and gets no row rather than twelve gaps.
	const earliestTxn = new Map(firstTxn.map((row) => [row.accountId, row.first]));
	const earliestFiled = new Map<string, string>();
	for (const row of filed) {
		if (!row.periodOn) continue;
		const seen = earliestFiled.get(row.accountId);
		if (!seen || row.periodOn < seen) earliestFiled.set(row.accountId, row.periodOn);
	}

	const withEvidence = accounts.map((a) => {
		const candidates = [earliestFiled.get(a.id), earliestTxn.get(a.id) ?? undefined].filter(
			(day): day is string => Boolean(day)
		);
		return { ...a, firstEvidence: candidates.sort()[0] ?? null };
	});

	return { accounts: withEvidence, filed };
}

/**
 * One year of the ribbon.
 *
 * `today` is passed rather than read here so the whole thing stays testable and
 * so one request cannot straddle midnight between two of its own queries.
 */
export async function loadCoverage(
	wantedYear: number,
	today: string,
	handle: Queryable = db
): Promise<CoveragePayload> {
	const { accounts, filed } = await readCoverage(handle);

	// The years worth stepping through. Never past the current one: a future year
	// is twelve months of "not arrived yet", which is a true statement about
	// nothing. The earliest is the first year any account has evidence in.
	const thisYear = Number(today.slice(0, 4));
	const evidenceYears = accounts
		.map((a) => a.firstEvidence)
		.filter((day): day is string => day !== null)
		.map((day) => Number(day.slice(0, 4)));
	const firstYear = evidenceYears.length > 0 ? Math.min(...evidenceYears) : thisYear;
	const lastYear = thisYear;

	// Clamped here and not only in the arrows: `?year=2099` is one keystroke in
	// the address bar, and a bookmark that outlives the bounds should land on the
	// nearest real year rather than on an empty grid.
	const year = Math.min(Math.max(wantedYear, firstYear), lastYear);

	const [unplaced] = await handle
		.select({ count: sql<number>`count(*)::int` })
		.from(document)
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		.where(
			and(
				eq(shelf.key, 'statements'),
				sql`(${document.periodOn} is null or not exists (
					select 1 from document_link l join account a on a.id = l.target_id
					 where l.document_id = ${document.id}
				))`
			)
		);

	const rows: CoverageRow[] = accounts
		.filter((a) => a.firstEvidence !== null)
		.map((a) => ({
			accountId: a.id,
			label: a.name,
			sublabel: tail(a.numbers),
			boxes: coverageRow(
				filed
					.filter((f) => f.accountId === a.id && f.periodOn)
					.map((f) => ({ id: f.id, periodOn: f.periodOn as string, periodEndOn: f.periodEndOn })),
				year,
				a.firstEvidence,
				today
			)
		}));

	return {
		year,
		firstYear,
		lastYear,
		gaps: rows.reduce((total, row) => total + countGaps(row.boxes), 0),
		unplaced: unplaced?.count ?? 0,
		rows
	};
}

/**
 * Every gap the archive has, in every year an account has existed.
 *
 * The banner's figure and the ribbon header's are two different numbers and
 * neither is wrong: the header is asking about the year on screen, the banner
 * about the shelf. Counted here rather than in `shelf-stats` because a gap is a
 * fact about coverage, and answering it from document rows would be a second
 * answer to one question.
 */
export async function gapsAcrossYears(today: string, handle: Queryable = db): Promise<number> {
	const { accounts, filed } = await readCoverage(handle);
	const thisYear = Number(today.slice(0, 4));
	let total = 0;
	for (const a of accounts) {
		if (!a.firstEvidence) continue;
		const from = Number(a.firstEvidence.slice(0, 4));
		const statements = filed
			.filter((f) => f.accountId === a.id && f.periodOn)
			.map((f) => ({ id: f.id, periodOn: f.periodOn as string, periodEndOn: f.periodEndOn }));
		for (let year = from; year <= thisYear; year++) {
			total += countGaps(coverageRow(statements, year, a.firstEvidence, today));
		}
	}
	return total;
}

/** How many accounts the ribbon draws. The banner's first figure. */
export async function coverageAccountCount(handle: Queryable = db): Promise<number> {
	const { accounts } = await readCoverage(handle);
	return accounts.filter((a) => a.firstEvidence !== null).length;
}
