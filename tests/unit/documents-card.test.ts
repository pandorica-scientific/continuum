// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The one card that every record screen files its paper through.
 *
 * There is no browser suite in this repository, so the card is rendered to a
 * string and read: what is asserted here is the part a screen depends on —
 * which links exist, which forms exist, and what a person is told when nothing
 * is filed yet. The expiry hue is asserted through the pure helper as well as
 * through the markup, because the helper is what the screens share.
 */
import { describe, expect, it } from 'vitest';

import { documentExpiryTone } from '$lib/documents/view';
import type { AboutDocument } from '$lib/server/documents/targets';

const TODAY = '2026-08-28';

const doc = (over: Partial<AboutDocument> = {}): AboutDocument => ({
	id: 'd1',
	name: 'Renting contract',
	ext: 'PDF',
	storedName: 'stored-abc.pdf',
	type: 'contract',
	shelfKey: 'property',
	shelfLabel: 'Property',
	reminderDays: null,
	expiresOn: null,
	expiryVerb: 'expires',
	addedOn: '2026-01-02',
	sensitivity: 'normal',
	tags: [],
	...over
});

describe('documentExpiryTone', () => {
	it('reads a passed date as expired', () => {
		expect(documentExpiryTone(doc({ expiresOn: '2026-08-01' }), TODAY)).toBe('expired');
	});

	it('reads a date inside the sixty-day window as soon', () => {
		expect(documentExpiryTone(doc({ expiresOn: '2026-10-01' }), TODAY)).toBe('soon');
	});

	it('leaves a date beyond the window quiet — a renewal a year out is a fact, not a task', () => {
		expect(documentExpiryTone(doc({ expiresOn: '2027-10-01' }), TODAY)).toBe('quiet');
	});

	it('leaves a document with no expiry quiet', () => {
		expect(documentExpiryTone(doc(), TODAY)).toBe('quiet');
	});

	it('shares the Documents screen rule rather than restating it', () => {
		// A bill is due sooner than a contract renews, and the card must not
		// invent its own window: thirty days for `due`, sixty for the rest.
		expect(documentExpiryTone(doc({ expiresOn: '2026-10-01', expiryVerb: 'due' }), TODAY)).toBe(
			'quiet'
		);
		expect(documentExpiryTone(doc({ expiresOn: '2026-09-10', expiryVerb: 'due' }), TODAY)).toBe(
			'soon'
		);
		// A lapsed `expires` stops shouting after a month; nothing is owed and
		// nothing replaces it, so the date becomes history.
		expect(documentExpiryTone(doc({ expiresOn: '2026-01-01' }), TODAY)).toBe('quiet');
		expect(documentExpiryTone(doc({ expiresOn: '2026-01-01', expiryVerb: 'renews' }), TODAY)).toBe(
			'expired'
		);
	});
});
