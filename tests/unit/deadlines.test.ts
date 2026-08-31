// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { ownedByLinkedRecord, type OwnerReminders } from '$lib/server/documents/deadlines';

/**
 * D7: the record owns the deadline. A document linked to a tenancy or a loan
 * whose own date equals the document's `expiresOn` is a duplicate reminder —
 * the record's item stays, the document's is skipped. Anything short of an
 * exact match on both the link and the date still reminds on its own.
 */
describe('ownedByLinkedRecord', () => {
	const doc = { id: 'doc-1', expiresOn: '2026-11-01' };

	/**
	 * A surface that raises both record-side reminders and looks far enough
	 * ahead to reach this document's date — the case where suppressing the
	 * document's copy really does remove a duplicate rather than the deadline.
	 */
	const RAISING_BOTH: OwnerReminders = {
		tenancy: { emits: true, remindsThrough: null },
		loan: { emits: true, remindsThrough: null }
	};

	it('is false when the document has no links at all', () => {
		expect(
			ownedByLinkedRecord(
				doc,
				[],
				{ tenancyEndsOn: new Map(), loanFixationEndsOn: new Map() },
				RAISING_BOTH
			)
		).toBe(false);
	});

	it('is false when the document has links to other documents, not this one', () => {
		const links = [{ documentId: 'doc-2', targetId: 'tenancy-1', kind: 'tenancy' }];
		const dates = {
			tenancyEndsOn: new Map([['tenancy-1', '2026-11-01']]),
			loanFixationEndsOn: new Map()
		};
		expect(ownedByLinkedRecord(doc, links, dates, RAISING_BOTH)).toBe(false);
	});

	it('is true when linked to a tenancy whose ends_on matches the document date exactly', () => {
		const links = [{ documentId: 'doc-1', targetId: 'tenancy-1', kind: 'tenancy' }];
		const dates = {
			tenancyEndsOn: new Map([['tenancy-1', '2026-11-01']]),
			loanFixationEndsOn: new Map()
		};
		expect(ownedByLinkedRecord(doc, links, dates, RAISING_BOTH)).toBe(true);
	});

	it('is false when linked to a tenancy whose ends_on is a different date', () => {
		const links = [{ documentId: 'doc-1', targetId: 'tenancy-1', kind: 'tenancy' }];
		const dates = {
			tenancyEndsOn: new Map([['tenancy-1', '2026-12-15']]),
			loanFixationEndsOn: new Map()
		};
		expect(ownedByLinkedRecord(doc, links, dates, RAISING_BOTH)).toBe(false);
	});

	it('is false when the linked tenancy has no ends_on at all (null date)', () => {
		const links = [{ documentId: 'doc-1', targetId: 'tenancy-1', kind: 'tenancy' }];
		const dates = {
			tenancyEndsOn: new Map([['tenancy-1', null]]),
			loanFixationEndsOn: new Map()
		};
		expect(ownedByLinkedRecord(doc, links, dates, RAISING_BOTH)).toBe(false);
	});

	it('is false when the document itself has no expiry date to compare', () => {
		const links = [{ documentId: 'doc-1', targetId: 'tenancy-1', kind: 'tenancy' }];
		const dates = {
			tenancyEndsOn: new Map([['tenancy-1', null]]),
			loanFixationEndsOn: new Map()
		};
		expect(ownedByLinkedRecord({ id: 'doc-1', expiresOn: null }, links, dates, RAISING_BOTH)).toBe(
			false
		);
	});

	it('is true when linked to a loan whose current fixation ends_on matches the document date', () => {
		const links = [{ documentId: 'doc-1', targetId: 'loan-1', kind: 'loan' }];
		const dates = {
			tenancyEndsOn: new Map(),
			loanFixationEndsOn: new Map([['loan-1', '2026-11-01']])
		};
		expect(ownedByLinkedRecord(doc, links, dates, RAISING_BOTH)).toBe(true);
	});

	// The map only ever holds the CURRENT fixation period's end date (that is
	// `loadRecordDates`'s job) — a document whose date matches a PAST,
	// already-superseded period is not a duplicate of anything current, so it
	// must still remind on its own.
	it('is false when the document date matches a past fixation period, not the current one', () => {
		const links = [{ documentId: 'doc-1', targetId: 'loan-1', kind: 'loan' }];
		const dates = {
			tenancyEndsOn: new Map(),
			// The loan re-fixed since: the current period now ends later than the
			// date on this old re-fix letter.
			loanFixationEndsOn: new Map([['loan-1', '2028-02-01']])
		};
		expect(ownedByLinkedRecord(doc, links, dates, RAISING_BOTH)).toBe(false);
	});

	it('is false when linked to a kind that is not tenancy or loan, even with a matching id coincidentally in the maps', () => {
		const links = [{ documentId: 'doc-1', targetId: 'property-1', kind: 'property' }];
		const dates = {
			tenancyEndsOn: new Map([['property-1', '2026-11-01']]),
			loanFixationEndsOn: new Map()
		};
		expect(ownedByLinkedRecord(doc, links, dates, RAISING_BOTH)).toBe(false);
	});

	it('is true when one of several links on the document matches, even if others do not', () => {
		const links = [
			{ documentId: 'doc-1', targetId: 'person-1', kind: 'person' },
			{ documentId: 'doc-1', targetId: 'tenancy-1', kind: 'tenancy' }
		];
		const dates = {
			tenancyEndsOn: new Map([['tenancy-1', '2026-11-01']]),
			loanFixationEndsOn: new Map()
		};
		expect(ownedByLinkedRecord(doc, links, dates, RAISING_BOTH)).toBe(true);
	});
	/**
	 * The fourth argument: what the CALLING surface does with the record's own
	 * date. A duplicate needs an original, and there are two ways for the
	 * original not to exist — the surface does not raise that kind of reminder
	 * at all, or its window stops short of the date.
	 */
	describe('when the owning reminder is not the one being raised', () => {
		const links = [{ documentId: 'doc-1', targetId: 'tenancy-1', kind: 'tenancy' }];
		const dates = {
			tenancyEndsOn: new Map([['tenancy-1', '2026-11-01']]),
			loanFixationEndsOn: new Map()
		};

		it('is false when the surface does not emit the tenancy’s own reminder', () => {
			// The calendar with property dates switched off. Nothing else emits
			// this date, so the document's event is the only one there is.
			const owners: OwnerReminders = {
				tenancy: { emits: false, remindsThrough: null },
				loan: { emits: true, remindsThrough: null }
			};
			expect(ownedByLinkedRecord(doc, links, dates, owners)).toBe(false);
		});

		it('is false when the date is past the horizon the owning reminder looks to', () => {
			// The Overview: its lease source stops at 120 days and this lease ends
			// later than that, so no Tenancy item was raised to be a duplicate of.
			const owners: OwnerReminders = {
				tenancy: { emits: true, remindsThrough: '2026-10-01' },
				loan: { emits: true, remindsThrough: null }
			};
			expect(ownedByLinkedRecord(doc, links, dates, owners)).toBe(false);
		});

		it('is true when the date falls on the last day the horizon reaches', () => {
			const owners: OwnerReminders = {
				tenancy: { emits: true, remindsThrough: '2026-11-01' },
				loan: { emits: true, remindsThrough: null }
			};
			expect(ownedByLinkedRecord(doc, links, dates, owners)).toBe(true);
		});

		it('reads each kind’s own answer, not one shared setting', () => {
			// A loan link, and it is the LOAN's horizon that has to be consulted:
			// the two sources look different distances ahead.
			const loanLinks = [{ documentId: 'doc-1', targetId: 'loan-1', kind: 'loan' }];
			const loanDates = {
				tenancyEndsOn: new Map(),
				loanFixationEndsOn: new Map([['loan-1', '2026-11-01']])
			};
			const owners: OwnerReminders = {
				tenancy: { emits: false, remindsThrough: '2026-01-01' },
				loan: { emits: true, remindsThrough: null }
			};
			expect(ownedByLinkedRecord(doc, loanLinks, loanDates, owners)).toBe(true);
		});
	});
});
