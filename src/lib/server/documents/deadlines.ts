// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Decision D7: the record owns the deadline.
 *
 * A lease's contract and a mortgage's re-fixation letter often carry the same
 * date as the tenancy or loan fixation period they came from — the demo seed
 * ships exactly that shape, filing the lease against the tenancy it is the
 * contract for. Left alone, the Overview briefing and the calendar each read
 * both tracks — the record (`tenancy.ends_on`, the loan's current
 * `loan_fixation_period.ends_on`) and the document (`document.expires_on`) —
 * and remind twice for one deadline.
 *
 * The rule: when a document is linked to a tenancy or a loan and its date
 * equals that record's own date, the document's reminder is the duplicate and
 * is skipped; the record's stays. A document dated differently — a lease
 * renewed on different terms, a letter filed before the actual re-fix — is
 * not a duplicate of anything and still reminds on its own.
 */

import { db, type Queryable } from '$lib/server/db';
import { loanFixationPeriod, tenancy } from '$lib/server/db/schema';

/** The record-side dates a document's own date is compared against. */
interface RecordDates {
	/** tenancy id -> its `ends_on`, or null when the tenancy has none set. */
	tenancyEndsOn: Map<string, string | null>;
	/** loan id -> its CURRENT fixation period's `ends_on`. */
	loanFixationEndsOn: Map<string, string | null>;
}

/** A `document_link` row, joined to the kind of thing it points at. */
export interface DocumentLinkRow {
	documentId: string;
	targetId: string;
	kind: string;
}

/**
 * Whether `doc`'s date is a duplicate of a date its linked tenancy or loan
 * already owns.
 *
 * Pure and synchronous on purpose: both the briefing and calendar surfaces
 * already load `document_link` rows and iterate documents in JavaScript, and
 * a version of this that queried per document would turn the module's "no
 * per-document queries" invariant into an easy accident later. `dates` is
 * `loadRecordDates`'s output, computed once per request in two queries.
 */
export function ownedByLinkedRecord(
	doc: { id: string; expiresOn: string | null },
	links: readonly DocumentLinkRow[],
	dates: RecordDates
): boolean {
	if (!doc.expiresOn) return false;
	for (const link of links) {
		if (link.documentId !== doc.id) continue;
		const recordEndsOn =
			link.kind === 'tenancy'
				? dates.tenancyEndsOn.get(link.targetId)
				: link.kind === 'loan'
					? dates.loanFixationEndsOn.get(link.targetId)
					: undefined;
		// A record with no date of its own (null) never counts as a match: a
		// document dated for a tenancy that has not yet been given an end date
		// is not a duplicate of "no date" — it is the only reminder there is.
		if (recordEndsOn && recordEndsOn === doc.expiresOn) return true;
	}
	return false;
}

/**
 * Every tenancy's end date, and every loan's CURRENT fixation period's end
 * date, keyed by id — the two record-side facts `ownedByLinkedRecord` needs.
 * Two queries total, not one per document or per link.
 */
export async function loadRecordDates(handle: Queryable = db): Promise<RecordDates> {
	const today = new Date().toISOString().slice(0, 10);

	const [tenancies, periods] = await Promise.all([
		handle.select({ id: tenancy.id, endsOn: tenancy.endsOn }).from(tenancy),
		handle
			.select({
				loanId: loanFixationPeriod.loanId,
				startsOn: loanFixationPeriod.startsOn,
				endsOn: loanFixationPeriod.endsOn
			})
			.from(loanFixationPeriod)
	]);

	const tenancyEndsOn = new Map(tenancies.map((t) => [t.id, t.endsOn]));

	// The CURRENT period per loan is the one with the latest starts_on that has
	// already started (or the sole, open-ended one — its starts_on is in the
	// past too). Periods for one loan never overlap, so picking by starts_on
	// alone — without also requiring ends_on > today, the way the briefing's
	// own fixation-horizon source does — is what makes an open-ended period
	// (ends_on null) resolve as current rather than being skipped.
	//
	// The same lack of an ends_on > today check means a loan whose latest period
	// has already LAPSED, with no successor entered yet, still gets that lapsed
	// period back as "current" rather than nothing. That is harmless here: this
	// map only decides whether a document's own expiry duplicates the record's
	// date, never a reminder by itself. A document whose expiry no longer
	// matches the lapsed date just keeps its own ordinary reminder instead of
	// having it suppressed as a duplicate.
	const currentByLoan = new Map<string, { startsOn: string; endsOn: string | null }>();
	for (const period of periods) {
		if (period.startsOn > today) continue;
		const current = currentByLoan.get(period.loanId);
		if (!current || period.startsOn > current.startsOn) {
			currentByLoan.set(period.loanId, period);
		}
	}
	const loanFixationEndsOn = new Map(
		[...currentByLoan].map(([loanId, period]) => [loanId, period.endsOn])
	);

	return { tenancyEndsOn, loanFixationEndsOn };
}
