// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a shelf's banner says about itself.
 *
 * Two things are held here. WHICH three figures a shelf shows, including the
 * rule that decides the third for every shelf that has not claimed it; and how
 * long the blurbs are, which is not a style rule wearing a test — see below.
 */
import { describe, expect, it } from 'vitest';
import { bannerStats, type BannerFacts } from '$lib/documents/banner';
import { SHELF_PROFILES } from '$lib/shelf-profiles';

const facts = (over: Partial<BannerFacts> = {}): BannerFacts => ({
	people: 0,
	subjects: 0,
	documents: 0,
	records: 0,
	expired: 0,
	inReminderWindow: 0,
	addresses: 0,
	recurring: 0,
	institutions: 0,
	paymentsDue: 0,
	inWarranty: 0,
	lastEntry: null,
	nextDate: null,
	anyDated: false,
	accounts: 0,
	gaps: 0,
	...over
});

describe('bannerStats', () => {
	it('gives Identity the two figures that are a task, in the hues that say so', () => {
		const [people, expired, soon] = bannerStats(
			'identity',
			facts({ people: 3, expired: 1, inReminderWindow: 1 })
		);
		expect(people).toEqual({ value: '3', label: 'people', tone: 'plain' });
		expect(expired).toEqual({ value: '1', label: 'expired, 30-day window running', tone: 'alert' });
		expect(soon).toEqual({ value: '1', label: 'inside reminder window', tone: 'warn' });
	});

	it('says no date logic applies when nothing on the shelf carries a date', () => {
		// Family's mocked third figure is this rule firing, not copy written for
		// Family: any shelf holding nothing dated says the same thing.
		const [, , third] = bannerStats('family', facts({ people: 4, records: 19, anyDated: false }));
		expect(third).toEqual({ value: '—', label: 'no date logic applies', tone: 'plain' });
	});

	it('shows the soonest date once something on the shelf is dated', () => {
		const [, , third] = bannerStats('family', facts({ anyDated: true, nextDate: '2027-01-08' }));
		expect(third).toEqual({ value: '2027-01-08', label: 'next date', tone: 'plain' });
	});

	it('gives a shelf with no profile the default trio rather than blanks', () => {
		// Tenancy, Vehicles and anything the household made.
		const trio = bannerStats(
			'a-shelf-somebody-made',
			facts({ documents: 7, subjects: 2, anyDated: false })
		);
		expect(trio.map((s) => s.value)).toEqual(['7', '2', '—']);
		expect(trio.map((s) => s.label)).toEqual(['documents', 'subjects', 'no date logic applies']);
	});

	it('names the unit a shelf without a profile actually has', () => {
		// A zero labelled "subjects" on a shelf that is about people says nothing
		// twice: no unit, and the wrong one.
		const [, concerns] = bannerStats('tenancy', facts({ documents: 3, people: 2, subjects: 0 }));
		expect(concerns).toEqual({ value: '2', label: 'people', tone: 'plain' });
	});

	it('leaves a count of nothing plain — a red nought is an alarm about nothing', () => {
		// Zero expired and zero gaps are the states this archive is FOR. A person
		// scanning a row of banners reads the colour before the number.
		const [, expired, soon] = bannerStats('identity', facts({ people: 3 }));
		expect(expired.tone).toBe('plain');
		expect(soon.tone).toBe('plain');
		expect(bannerStats('statements', facts({ gaps: 0 }))[2].tone).toBe('plain');
		// And takes the hue the moment it is real.
		expect(bannerStats('statements', facts({ gaps: 1 }))[2].tone).toBe('alert');
	});

	it('does not warn about an inspection nobody owes', () => {
		const [, , none] = bannerStats('property', facts({ addresses: 2, nextDate: null }));
		expect(none).toEqual({ value: '—', label: 'next one due', tone: 'plain' });
		const [, , due] = bannerStats('property', facts({ addresses: 2, nextDate: '2026-11-30' }));
		expect(due).toEqual({ value: '2026-11-30', label: 'next one due', tone: 'warn' });
	});

	it('does not ring an alarm about warranty cover a household still has', () => {
		// Purple, not amber: seven things under warranty is a good state, and the
		// amber channel is for something that is coming due.
		const [, cover] = bannerStats('household', facts({ subjects: 22, inWarranty: 7 }));
		expect(cover).toEqual({ value: '7', label: 'still in warranty', tone: 'note' });
	});

	it('counts gaps for Statements, in the hue that says it is a task', () => {
		const [accounts, statements, gaps] = bannerStats(
			'statements',
			facts({ accounts: 4, records: 96, gaps: 2 })
		);
		expect(accounts).toEqual({ value: '4', label: 'accounts', tone: 'plain' });
		expect(statements).toEqual({ value: '96', label: 'statements', tone: 'plain' });
		expect(gaps).toEqual({ value: '2', label: 'gaps', tone: 'alert' });
	});
});

describe('SHELF_PROFILES', () => {
	it('writes every blurb to about one length, so the banners are one height', () => {
		// Not a style rule wearing a test. The banner's height is driven by how
		// many lines the blurb wraps to, and a shelf whose copy is half as long
		// as its neighbours' stands shorter — so moving between shelves shifted
		// the toolbar and the list under the cursor. A `min-height` cannot fix
		// that: on a narrow screen every blurb wraps past the floor and they
		// diverge again by however much the copy differs. Matched length is the
		// fix, and this is what keeps it matched.
		const lengths = Object.values(SHELF_PROFILES).map((p) => p.blurb.length);
		expect(Math.min(...lengths)).toBeGreaterThanOrEqual(190);
		expect(Math.max(...lengths)).toBeLessThanOrEqual(215);
	});

	it('says what every seeded shelf is for, and what it answers', () => {
		// An empty blurb draws a banner with a hole in it, and there is no sensible
		// fallback for a shelf the registry DOES know.
		for (const profile of Object.values(SHELF_PROFILES)) {
			expect(profile.blurb.length, profile.key).toBeGreaterThan(0);
			expect(profile.answers.length, profile.key).toBeGreaterThan(0);
		}
	});
});
