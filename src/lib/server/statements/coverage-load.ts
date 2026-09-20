// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The Statements shelf as coverage: one row per account or loan, one year at a
 * time.
 *
 * Its own module because it asks a question no other shelf asks — not "what is
 * filed?" but "which months are accounted for?" — and answering it needs the
 * ledger as well as the archive. An account's first TRANSACTION is evidence
 * that it existed, even in a month whose statement nobody kept, and without
 * that the ribbon would call an account's whole first year missing.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { activeAccount } from '$lib/server/accounts';
import {
	account,
	document,
	documentLink,
	documentType,
	entity,
	loan,
	shelf,
	transaction
} from '$lib/server/db/schema';
import {
	bandFor,
	bandsForAccount,
	coverageDecade,
	coverageRow,
	countGaps,
	decadeStart,
	type CoverageBox
} from '$lib/statements/coverage';

export interface CoverageRow {
	accountId: string;
	label: string;
	/** The last four of the account number — how a person tells two apart. */
	sublabel: string;
	boxes: CoverageBox[];
}

/**
 * The yearly band, under the monthly one.
 *
 * Paper that arrives once a year — a broker's annual report — has a rhythm of
 * its own, and putting it in the twelve-month grid would draw eleven gaps a
 * year for an account that is perfectly up to date. Its own table, ten years
 * wide, stepping a decade at a time.
 */
export interface CoverageDecade {
	firstYear: number;
	/** The decades worth stepping through, inclusive, as first-years. */
	earliestDecade: number;
	latestDecade: number;
	gaps: number;
	rows: CoverageRow[];
}

/**
 * What a band needs to LIST a document, for a period that holds more than one.
 *
 * A cell with two documents in it cannot open "the" document, and splitting the
 * box in half stops working at three. So a crowded period opens a list instead,
 * and this is what the list reads.
 */
export interface CoverageDocument {
	id: string;
	name: string;
	ext: string;
	/** What this household calls the type, not the key. */
	typeLabel: string;
	addedOn: string;
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
	/** The yearly band, or null where the household files no yearly paper. */
	yearly: CoverageDecade | null;
	/** Every drawn document, by id, so a crowded period can list what it holds. */
	documents: Record<string, CoverageDocument>;
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
	const [accounts, loans, statements, firstTxn] = await Promise.all([
		handle
			.select({
				id: account.id,
				name: account.name,
				kind: account.kind,
				numbers: account.numbers
			})
			.from(account)
			.where(activeAccount())
			.orderBy(account.name),
		// A loan is a thing a bank numbers and sends statements about, so it gets
		// the same ribbon. Its first evidence is its own start rather than a first
		// movement: a mortgage has no transactions of its own here.
		handle
			.select({ id: loan.id, name: loan.name, startsOn: loan.startsOn })
			.from(loan)
			.orderBy(loan.name),
		handle
			.select({
				accountId: documentLink.targetId,
				id: document.id,
				name: document.name,
				ext: document.ext,
				typeLabel: documentType.label,
				addedOn: document.addedOn,
				periodOn: document.periodOn,
				periodEndOn: document.periodEndOn
			})
			.from(document)
			.innerJoin(shelf, eq(shelf.id, document.shelfId))
			.innerJoin(documentType, eq(documentType.key, document.type))
			.innerJoin(documentLink, eq(documentLink.documentId, document.id))
			// Through the supertype rather than straight into `account`: a loan is a
			// thing a bank numbers and sends statements about too, and joining one
			// concrete table is what kept a mortgage's paper off this ribbon.
			.innerJoin(entity, eq(entity.id, documentLink.targetId))
			.where(
				and(
					eq(shelf.key, 'statements'),
					// Both types in ONE query. Which band each document draws in is
					// read off its period by `bandFor`, not off its type: a bank that
					// sends a yearly summary and a broker that reports quarterly are
					// both real, and the type cannot tell you which.
					inArray(document.type, ['bank_statement', 'broker_report']),
					inArray(entity.kind, ['account', 'loan']),
					sql`${document.periodOn} is not null`
				)
			),
		handle
			.select({
				accountId: transaction.accountId,
				first: sql<string | null>`min(${transaction.bookedOn})`
			})
			.from(transaction)
			.groupBy(transaction.accountId)
	]);

	// Split by the period each document declares, not by the type it carries.
	const asCoverage = (row: (typeof statements)[number]) => ({
		id: row.id,
		periodOn: row.periodOn as string,
		periodEndOn: row.periodEndOn
	});
	const filed = statements.filter((row) => bandFor(asCoverage(row)) === 'monthly');
	const yearly = statements.filter((row) => bandFor(asCoverage(row)) === 'yearly');

	// The earlier of the first statement and the first movement. An account with
	// neither has never been used, and gets no row rather than twelve gaps.
	const earliestTxn = new Map(firstTxn.map((row) => [row.accountId, row.first]));
	const earliestFiled = new Map<string, string>();
	for (const row of [...filed, ...yearly]) {
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

	// `starts_on` is nullable — a loan whose start nobody recorded — so it falls
	// back to the earliest statement filed against it, the same fallback a card
	// with no `since` already makes in `buildLane`. `numbers` is empty: a loan
	// has no account number to tell two apart by, and its name does that job.
	const loanRows = loans.map((l) => ({
		id: l.id,
		name: l.name,
		kind: 'loan' as const,
		numbers: [] as string[],
		firstEvidence: l.startsOn ?? earliestFiled.get(l.id) ?? null
	}));

	return { accounts: [...withEvidence, ...loanRows], filed, yearly };
}

/**
 * The one place a band membership is decided, shared by the ribbon and by the
 * two figures the banner shows.
 *
 * Three readers used to make this judgement separately — `loadCoverage`,
 * `gapsAcrossYears` and `coverageAccountCount` each spelled
 * `kind === 'brokerage'` themselves — which is three chances to disagree about
 * which accounts the shelf is even talking about.
 */
function bandReader(
	filed: { accountId: string }[],
	yearly: { accountId: string }[]
): (account: { id: string; kind: string }) => { monthly: boolean; yearly: boolean } {
	const monthlyPaper = new Set(filed.map((f) => f.accountId));
	const yearlyPaper = new Set(yearly.map((y) => y.accountId));
	return (account) =>
		bandsForAccount({
			hasMonthlyPaper: monthlyPaper.has(account.id),
			hasYearlyPaper: yearlyPaper.has(account.id),
			// The fallback, and only the fallback: a broker is asked for a year's
			// report before it has filed one, everything else for its months.
			expects: account.kind === 'brokerage' ? 'yearly' : 'monthly'
		});
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
	handle: Queryable = db,
	wantedDecade?: number
): Promise<CoveragePayload> {
	const { accounts, filed, yearly } = await readCoverage(handle);

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
					select 1 from document_link l join entity e on e.id = l.target_id
					 where l.document_id = ${document.id} and e.kind in ('account', 'loan')
				))`
			)
		);

	// Which bands each account earns a row on, from what it actually holds
	// rather than from its `kind`. See `bandsForAccount` — in particular why an
	// account with no yearly paper keeps its month row, which is what stops an
	// unfiled mortgage disappearing off this shelf entirely.
	const bandsFor = bandReader(filed, yearly);

	const rows: CoverageRow[] = accounts
		.filter((a) => a.firstEvidence !== null && bandsFor(a).monthly)
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

	// The yearly band: an account is asked about its years once it has filed
	// any, and not before. A decade of gaps for an account that has never sent
	// yearly paper is a question nobody asked.
	const yearlyAccounts = accounts.filter((a) => a.firstEvidence !== null && bandsFor(a).yearly);
	const decadesWithPaper = yearly
		.map((y) => decadeStart(Number((y.periodOn as string).slice(0, 4))))
		.sort();
	const thisDecade = decadeStart(thisYear);
	const earliestDecade = decadesWithPaper[0] ?? thisDecade;
	const decadeYear = Math.min(
		Math.max(decadeStart(wantedDecade ?? thisYear), earliestDecade),
		thisDecade
	);

	const yearlyRows: CoverageRow[] = yearlyAccounts.map((a) => ({
		accountId: a.id,
		label: a.name,
		sublabel: tail(a.numbers),
		boxes: coverageDecade(
			yearly
				.filter((y) => y.accountId === a.id && y.periodOn)
				.map((y) => ({ id: y.id, periodOn: y.periodOn as string, periodEndOn: y.periodEndOn })),
			decadeYear,
			a.firstEvidence,
			today
		)
	}));

	const documents: Record<string, CoverageDocument> = {};
	for (const row of [...filed, ...yearly]) {
		documents[row.id] = {
			id: row.id,
			name: row.name,
			ext: row.ext,
			typeLabel: row.typeLabel,
			addedOn: row.addedOn
		};
	}

	return {
		year,
		firstYear,
		lastYear,
		documents,
		gaps: rows.reduce((total, row) => total + countGaps(row.boxes), 0),
		yearly:
			yearlyRows.length === 0
				? null
				: {
						firstYear: decadeYear,
						earliestDecade,
						latestDecade: thisDecade,
						gaps: yearlyRows.reduce((total, row) => total + countGaps(row.boxes), 0),
						rows: yearlyRows
					},
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
	const { accounts, filed, yearly } = await readCoverage(handle);
	const bandsFor = bandReader(filed, yearly);
	const thisYear = Number(today.slice(0, 4));
	let total = 0;
	for (const a of accounts) {
		// Only the accounts the month band actually draws, so the banner's figure
		// counts the same holes the ribbon does.
		if (!a.firstEvidence || !bandsFor(a).monthly) continue;
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
	const { accounts, filed, yearly } = await readCoverage(handle);
	const bandsFor = bandReader(filed, yearly);
	return accounts.filter((a) => a.firstEvidence !== null && bandsFor(a).monthly).length;
}
