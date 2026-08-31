// SPDX-License-Identifier: AGPL-3.0-or-later
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
 *
 * A duplicate needs an original. Every surface reads the two tracks through a
 * different window — the Overview looks 120 days ahead for a lease and 210 for
 * a document, the calendar lets a household switch the property rule off — so
 * "the record owns it" is only true where the record's own reminder is
 * actually emitted. Suppressing the document's copy of a reminder nobody is
 * going to see deletes the deadline instead of de-duplicating it, which is why
 * the caller has to say what its own side does (`OwnerReminder`) rather than
 * this module assuming both sides watch the same horizon.
 */

import { and, eq, gt } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { loan, loanFixationPeriod, tenancy } from '$lib/server/db/schema';

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
 * What the calling surface does with a record's OWN deadline — the thing the
 * document's reminder would be a duplicate of.
 *
 * Both fields exist because both are ways for the original to be missing. The
 * calendar's is a switch (a household that turned property dates off emits no
 * lease event at all); the Overview's is a horizon (its lease source stops at
 * 120 days while its document source runs to 210, so a lease five months out
 * is watched by the document track alone).
 */
export interface OwnerReminder {
	/** Whether this surface emits that record's own reminder at all. */
	emits: boolean;
	/**
	 * The last date it still reaches, or null when it has no horizon.
	 *
	 * A date rather than a number of days, so this module does no clock reading
	 * and stays a pure function of its arguments. The caller holds the horizon
	 * in days — it is the same number its own source already stops at — and
	 * turns it into a date once per request.
	 */
	remindsThrough: string | null;
}

/** One `OwnerReminder` per kind of record that can own a document's date. */
export interface OwnerReminders {
	tenancy: OwnerReminder;
	loan: OwnerReminder;
}

/**
 * Whether `doc`'s date is a duplicate of a date its linked tenancy or loan
 * already owns AND is actually reminding about.
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
	dates: RecordDates,
	owners: OwnerReminders
): boolean {
	if (!doc.expiresOn) return false;
	for (const link of links) {
		if (link.documentId !== doc.id) continue;
		if (link.kind !== 'tenancy' && link.kind !== 'loan') continue;
		const recordEndsOn =
			link.kind === 'tenancy'
				? dates.tenancyEndsOn.get(link.targetId)
				: dates.loanFixationEndsOn.get(link.targetId);
		// A record with no date of its own (null) never counts as a match: a
		// document dated for a tenancy that has not yet been given an end date
		// is not a duplicate of "no date" — it is the only reminder there is.
		if (!recordEndsOn || recordEndsOn !== doc.expiresOn) continue;

		// Same date, same record — but only a duplicate if the record's own
		// reminder is one this surface will actually show. Out of range or
		// switched off, the document's is the only notice the household gets.
		const owner = owners[link.kind];
		if (!owner.emits) continue;
		if (owner.remindsThrough !== null && recordEndsOn > owner.remindsThrough) continue;
		return true;
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
		// Joined to the loan, and narrowed by the two conditions the briefing's
		// fixation source applies before it raises anything: a paid-off loan and
		// one that is not on a fixed period raise no fixation reminder, so their
		// periods must not be here either. A date in this map suppresses a
		// document's reminder, and suppressing one on behalf of a reminder that
		// is never emitted loses the deadline altogether.
		handle
			.select({
				loanId: loanFixationPeriod.loanId,
				startsOn: loanFixationPeriod.startsOn,
				endsOn: loanFixationPeriod.endsOn
			})
			.from(loanFixationPeriod)
			.innerJoin(loan, eq(loan.id, loanFixationPeriod.loanId))
			.where(and(eq(loan.regime, 'fixed_period'), gt(loan.owedMinor, 0n)))
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
