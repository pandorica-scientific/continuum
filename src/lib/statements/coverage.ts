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
	/** 0-based month index within the drawn year. */
	startMonth: number;
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
 */
export function coverageRow(
	statements: CoverageStatement[],
	year: number,
	firstEvidence: string | null,
	today: string
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
			evidenceKey === null || key < evidenceKey
				? 'before-account'
				: key >= currentKey
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
