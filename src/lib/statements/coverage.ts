// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which months an account's statements cover, and what an uncovered one means.
 *
 * Two rules carry the whole shelf, and they are deliberately not the same rule.
 * A FILED box spans, because a real statement says how far it reaches. An EMPTY
 * box never spans, because nothing says whether a hole is one missing quarterly
 * statement or three missing monthly ones — a household may upload one
 * quarterly statement with monthly ones either side of it, and a ribbon that
 * concluded "this account is quarterly" would be drawing a rhythm nobody
 * stated.
 *
 * For the same reason nothing here reads `cadence.ts`. That module answers "has
 * this account gone quiet?", which is a question about imports; this one answers
 * "is this month covered?", which is a question about paper. Borrowing the first
 * answer for the second is the same inference wearing a different hat.
 *
 * The unit is a whole MONTH throughout. Nothing is measured in days: a statement
 * running the 15th to the 14th covers two months, and a hole is a number of
 * months rather than "17 days". `document_period_first_of_month` has said the
 * same thing about `period_on` since long before this shelf existed.
 */

/** What one month of one account is. `before-account` draws nothing at all. */
export type MonthState = 'filed' | 'gap' | 'not-arrived' | 'before-account';

/** A filed statement, reduced to the two dates the ribbon reads. */
export interface CoverageStatement {
	id: string;
	/** First day covered. An undated statement does not reach here. */
	periodOn: string;
	/** Last day covered, or null for a statement covering one month. */
	periodEndOn: string | null;
}

/**
 * One drawn box. `months` is greater than 1 only for `filed`, which is the
 * merging rule stated in the type rather than only in the comments.
 */
export interface CoverageBox {
	state: MonthState;
	/**
	 * 0-based index of the first column this box occupies.
	 *
	 * A month within the drawn year, or a year within the drawn decade. The name
	 * says month because that is what it was built for and what it mostly is;
	 * the yearly band reuses the shape rather than duplicating it.
	 */
	startMonth: number;
	/** How many columns wide. Greater than 1 only for `filed`. */
	months: number;
	/** Empty unless `filed`; more than one where two statements overlap. */
	documentIds: string[];
}

/** `2026-04-15` → `2026-04`. String arithmetic, so no timezone can move a month. */
export const monthKey = (iso: string): string => iso.slice(0, 7);

/** `2026-04-15` → `2026-04-01`, which is the only day `period_on` may hold. */
export const firstOfMonth = (iso: string): string => `${monthKey(iso)}-01`;

/**
 * `2026-04-15` → `2026-04-30`.
 *
 * Day 0 of the next month is the last of this one, and `Date.UTC` keeps the
 * arithmetic off the machine's timezone — a local-time Date built from an ISO
 * day is the previous evening west of Greenwich, which would report March.
 */
export function lastOfMonth(iso: string): string {
	const year = Number(iso.slice(0, 4));
	const month = Number(iso.slice(5, 7));
	return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** `2026-04` → `2026-05`, without constructing a Date. */
function nextMonth(key: string): string {
	const year = Number(key.slice(0, 4));
	const month = Number(key.slice(5, 7));
	return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Every month a statement covers, inclusive of both ends.
 *
 * A statement running 15 April to 14 May covers April AND May: the unit is the
 * month, so a statement starting mid-month still accounts for that month.
 * Bounded at 24 months so a period stored backwards cannot spin.
 */
export function monthsCovered(statement: CoverageStatement): string[] {
	const first = monthKey(statement.periodOn);
	const last = monthKey(statement.periodEndOn ?? statement.periodOn);
	if (last < first) return [first];
	const months: string[] = [];
	for (let key = first; key <= last && months.length < 24; key = nextMonth(key)) {
		months.push(key);
	}
	return months;
}

/**
 * The twelve boxes of one account's year, left to right.
 *
 * `firstEvidence` is the earliest day the account is known to have existed — its
 * first statement or its first movement, whichever came first. Null means no
 * evidence at all, and the whole year then reads `before-account`: an account
 * nobody has imported anything for is not missing twelve statements.
 *
 * `lastEvidence`, when given, is the same idea at the other end — the day the
 * relationship itself ended (a closed engagement's last day, say). A month
 * after it reads `before-account` too: switching employer mid-year must not
 * leave the one just left expecting payslips nobody will ever file for the
 * months after you went. An account has no such date and passes null, which
 * is exactly today's behaviour unchanged.
 */
export function coverageRow(
	statements: CoverageStatement[],
	year: number,
	firstEvidence: string | null,
	today: string,
	lastEvidence: string | null = null
): CoverageBox[] {
	// Month index within THIS year to the ids covering it. A month belonging to
	// another year simply falls outside the range, which is the New Year clipping.
	const covering = new Map<number, string[]>();
	for (const statement of statements) {
		for (const key of monthsCovered(statement)) {
			if (Number(key.slice(0, 4)) !== year) continue;
			const index = Number(key.slice(5, 7)) - 1;
			covering.set(index, [...(covering.get(index) ?? []), statement.id]);
		}
	}

	const currentKey = monthKey(today);
	const evidenceKey = firstEvidence ? monthKey(firstEvidence) : null;
	const endKey = lastEvidence ? monthKey(lastEvidence) : null;

	const boxes: CoverageBox[] = [];
	for (let index = 0; index < 12; index++) {
		const key = `${year}-${String(index + 1).padStart(2, '0')}`;
		const ids = covering.get(index);

		if (ids) {
			// Merge only into a preceding filed box covered by exactly the same
			// statements. A month two statements share breaks the merge, which is
			// right: that box has two documents to offer.
			const previous = boxes[boxes.length - 1];
			const sameStatements =
				previous?.state === 'filed' &&
				previous.documentIds.length === ids.length &&
				previous.documentIds.every((id, i) => id === ids[i]);
			if (sameStatements) previous.months += 1;
			else boxes.push({ state: 'filed', startMonth: index, months: 1, documentIds: [...ids] });
			continue;
		}

		// Every empty month is its own box. See the note at the top of the file.
		const state: MonthState =
			evidenceKey === null || key < evidenceKey || (endKey !== null && key > endKey)
				? 'before-account'
				: key >= currentKey
					? 'not-arrived'
					: 'gap';
		boxes.push({ state, startMonth: index, months: 1, documentIds: [] });
	}
	return boxes;
}

/** How many years a decade band shows. Ten, which is what makes it a decade. */
export const DECADE = 10;

/** The first year of the decade band a year belongs to: 2026 → 2020. */
export const decadeStart = (year: number): number => Math.floor(year / DECADE) * DECADE;

/**
 * Every YEAR a document covers, inclusive.
 *
 * The sibling of `monthsCovered`, for paper that arrives once a year rather
 * than once a month. A broker's annual report is not a statement that failed to
 * be monthly — it is a different rhythm, and squeezing it into a twelve-month
 * grid would draw eleven gaps a year for an account that is perfectly up to
 * date.
 */
export function yearsCovered(statement: CoverageStatement): number[] {
	const first = Number(statement.periodOn.slice(0, 4));
	const last = Number((statement.periodEndOn ?? statement.periodOn).slice(0, 4));
	if (last < first) return [first];
	const years: number[] = [];
	for (let year = first; year <= last && years.length < 50; year++) years.push(year);
	return years;
}

/**
 * Which band a document is drawn in, read off the period it declares.
 *
 * Rhythm used to be decided twice and neither place asked the document: the
 * query picked it from `document.type`, and the rows picked it from
 * `account.kind`. A bank that sends a yearly summary then drew eleven false
 * gaps, and a broker that reported quarterly could not be drawn at all — its
 * paper landed in the month query and its account was excluded from the month
 * band.
 *
 * Twelve months is the line because that is where the units change: below it
 * the month band spans the document across its months, at or above it the
 * month band would need more columns than a year has.
 */
export function bandFor(statement: CoverageStatement): 'monthly' | 'yearly' {
	if (!statement.periodEndOn) return 'monthly';
	const first = monthKey(statement.periodOn);
	const last = monthKey(statement.periodEndOn);
	// Backwards is a defect upstream, and `monthsCovered` already treats it as
	// the single starting month. Same answer here rather than a second opinion.
	if (last < first) return 'monthly';
	const months =
		(Number(last.slice(0, 4)) - Number(first.slice(0, 4))) * 12 +
		(Number(last.slice(5, 7)) - Number(first.slice(5, 7))) +
		1;
	return months >= 12 ? 'yearly' : 'monthly';
}

/**
 * Which bands an account is drawn on.
 *
 * Its PAPER decides wherever it has any: an account that files quarterly gets
 * a month row and an account that files annually gets a year row, whatever
 * kind of account it happens to be. That is what lets a broker reporting
 * quarterly be drawn at all, which the old rule — month band for every
 * non-brokerage account, year band for every brokerage one — could not do.
 *
 * `expects` is the fallback and only the fallback: what this kind of account
 * is taken to send before it has sent anything. It cannot be derived, because
 * nothing in the data separates a current account with movements and no
 * statements (twelve real gaps) from a brokerage account with movements and no
 * report (one real gap, in the year band). Both are "used, nothing filed"; only
 * the kind says which question to ask.
 *
 * Transactions are deliberately NOT an input. Movement means an account is
 * used, not that paper arrives monthly — reading it as monthly evidence drew a
 * brokerage account eleven red months a year, which is the bug the kind-based
 * rule was written to fix in the first place.
 */
export function bandsForAccount(input: {
	hasMonthlyPaper: boolean;
	hasYearlyPaper: boolean;
	/** What this kind of account is asked for before it has filed anything. */
	expects: 'monthly' | 'yearly';
}): { monthly: boolean; yearly: boolean } {
	if (input.hasMonthlyPaper || input.hasYearlyPaper) {
		return { monthly: input.hasMonthlyPaper, yearly: input.hasYearlyPaper };
	}
	return { monthly: input.expects === 'monthly', yearly: input.expects === 'yearly' };
}

/**
 * One decade of an account's yearly paper, left to right.
 *
 * The same four states the month band uses and the same two rules: a filed box
 * spans the years its document covers, an empty box is always one year. The
 * only difference is the unit — which is the whole reason this exists rather
 * than the months view being asked to stretch.
 */
export function coverageDecade(
	statements: CoverageStatement[],
	firstYear: number,
	firstEvidence: string | null,
	today: string
): CoverageBox[] {
	const covering = new Map<number, string[]>();
	for (const statement of statements) {
		for (const year of yearsCovered(statement)) {
			const index = year - firstYear;
			if (index < 0 || index >= DECADE) continue;
			covering.set(index, [...(covering.get(index) ?? []), statement.id]);
		}
	}

	const thisYear = Number(today.slice(0, 4));
	const evidenceYear = firstEvidence ? Number(firstEvidence.slice(0, 4)) : null;

	const boxes: CoverageBox[] = [];
	for (let index = 0; index < DECADE; index++) {
		const year = firstYear + index;
		const ids = covering.get(index);

		if (ids) {
			const previous = boxes[boxes.length - 1];
			const sameStatements =
				previous?.state === 'filed' &&
				previous.documentIds.length === ids.length &&
				previous.documentIds.every((id, i) => id === ids[i]);
			if (sameStatements) previous.months += 1;
			else boxes.push({ state: 'filed', startMonth: index, months: 1, documentIds: [...ids] });
			continue;
		}

		const state: MonthState =
			evidenceYear === null || year < evidenceYear
				? 'before-account'
				: year >= thisYear
					? 'not-arrived'
					: 'gap';
		boxes.push({ state, startMonth: index, months: 1, documentIds: [] });
	}
	return boxes;
}

/**
 * How many gaps a year has.
 *
 * A count of MONTHS, and it needs no special case: a gap box is always one month
 * wide, so counting boxes and counting months are the same number.
 */
export function countGaps(boxes: CoverageBox[]): number {
	return boxes.filter((box) => box.state === 'gap').length;
}
