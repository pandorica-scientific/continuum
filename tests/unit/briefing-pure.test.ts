// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
	aboutLine,
	briefingCaption,
	countTitle,
	daysBetween,
	laneJudgeable,
	laneShortfall,
	latestJobPerDocument,
	monthsBetween,
	settlementOverdue,
	taxYearToChase
} from '$lib/server/briefing/pure';

/**
 * The briefing's judgements that need no database.
 *
 * Each of these used to be a line inside a source — the grammar of "1 document"
 * spelled out per title, the about line assembled in place — which is why the
 * sources could disagree with each other about their own wording.
 */
describe('latestJobPerDocument', () => {
	const at = (iso: string) => new Date(iso);

	it('keeps the newest attempt whatever order the rows arrive in', () => {
		const latest = latestJobPerDocument([
			{ documentId: 'a', state: 'failed', queuedAt: at('2026-01-01T00:00:00Z') },
			{ documentId: 'a', state: 'done', queuedAt: at('2026-03-01T00:00:00Z') },
			{ documentId: 'a', state: 'running', queuedAt: at('2026-02-01T00:00:00Z') }
		]);
		expect(latest.get('a')).toBe('done');
	});

	// The whole reason the source cannot simply ask for `state = 'failed'`: a
	// document that was re-read successfully keeps the failed row for ever.
	it('lets a later success clear an earlier failure', () => {
		const latest = latestJobPerDocument([
			{ documentId: 'a', state: 'done', queuedAt: at('2026-03-01T00:00:00Z') },
			{ documentId: 'a', state: 'failed', queuedAt: at('2026-01-01T00:00:00Z') }
		]);
		expect(latest.get('a')).toBe('done');
	});

	it('keeps a failure that came after a success', () => {
		const latest = latestJobPerDocument([
			{ documentId: 'a', state: 'done', queuedAt: at('2026-01-01T00:00:00Z') },
			{ documentId: 'a', state: 'failed', queuedAt: at('2026-03-01T00:00:00Z') }
		]);
		expect(latest.get('a')).toBe('failed');
	});

	it('answers per document, not across them', () => {
		const latest = latestJobPerDocument([
			{ documentId: 'a', state: 'failed', queuedAt: at('2026-01-01T00:00:00Z') },
			{ documentId: 'b', state: 'done', queuedAt: at('2026-01-02T00:00:00Z') }
		]);
		expect([...latest]).toEqual([
			['a', 'failed'],
			['b', 'done']
		]);
	});

	it('has nothing to say about no rows', () => {
		expect(latestJobPerDocument([]).size).toBe(0);
	});
});

describe('aboutLine', () => {
	it('names the shelf alone when the document is filed against nothing', () => {
		expect(aboutLine('Tenancy', [])).toBe('Filed under Tenancy.');
	});

	it('names the one record it is about', () => {
		expect(aboutLine('Identity', ['Robert'])).toBe('Filed under Identity, about Robert.');
	});

	it('joins two records', () => {
		expect(aboutLine('Tenancy', ['Flat Karlín · Martin Dvořák', 'Mortgage ČS'])).toBe(
			'Filed under Tenancy, about Flat Karlín · Martin Dvořák and Mortgage ČS.'
		);
	});

	// A link to a record the registry could not name comes back as an empty
	// string, and "about  and Mortgage ČS" is worse than not saying so.
	it('drops a record that has no name', () => {
		expect(aboutLine('Finance', ['', 'Mortgage ČS'])).toBe(
			'Filed under Finance, about Mortgage ČS.'
		);
	});
});

describe('briefingCaption', () => {
	const cards = (...hues: string[]) => hues.map((hue) => ({ hue }));

	it('says so when nothing needs anyone', () => {
		expect(briefingCaption([], 0)).toBe('nothing needs you today');
	});

	it('counts one thing in words', () => {
		expect(briefingCaption(cards('yellow'), 1)).toBe('one thing, none of them urgent today');
	});

	it('counts a full strip in words', () => {
		expect(briefingCaption(cards('yellow', 'grey', 'blue', 'grey'), 4)).toBe(
			'four things, none of them urgent today'
		);
	});

	it('leads with the urgent ones when there are any', () => {
		expect(briefingCaption(cards('red', 'yellow', 'red'), 3)).toBe('3 things, 2 of them urgent');
	});

	// The strip shows four and offers the rest behind a button, so the sentence
	// describes what is on screen; the button carries the total.
	it('describes the cards it was given, not the total behind them', () => {
		expect(briefingCaption(cards('grey', 'grey', 'grey', 'grey'), 9)).toBe(
			'four things, none of them urgent today'
		);
	});
});

describe('countTitle', () => {
	it('uses the singular for one', () => {
		expect(countTitle(1, 'document waiting to be filed', 'documents waiting to be filed')).toBe(
			'1 document waiting to be filed'
		);
	});

	it('uses the plural for more', () => {
		expect(countTitle(4, 'document could not be read', 'documents could not be read')).toBe(
			'4 documents could not be read'
		);
	});

	it('uses the plural for none', () => {
		expect(countTitle(0, 'document', 'documents')).toBe('0 documents');
	});
});

describe('daysBetween', () => {
	it('counts forward', () => {
		expect(daysBetween('2026-09-15', '2026-09-25')).toBe(10);
	});

	it('counts backward as a negative', () => {
		expect(daysBetween('2026-09-25', '2026-09-15')).toBe(-10);
	});

	// A day either side of a daylight-saving change is still one day, and a
	// horizon counted in hours would call it 0 or 2.
	it('is not confused by a clock change', () => {
		expect(daysBetween('2026-10-24', '2026-10-25')).toBe(1);
	});

	it('is zero for the same day', () => {
		expect(daysBetween('2026-09-15', '2026-09-15')).toBe(0);
	});
});

describe('monthsBetween', () => {
	it('counts whole months', () => {
		expect(monthsBetween('2025-09-15', '2026-09-15')).toBe(12);
	});

	// The day before the anniversary is eleven months, not twelve: a valuation
	// horizon that rounded up would raise a card a month early every year.
	it('does not count a month that has not completed', () => {
		expect(monthsBetween('2025-09-15', '2026-09-14')).toBe(11);
	});

	it('counts across a year end', () => {
		expect(monthsBetween('2025-11-30', '2026-02-28')).toBe(2);
	});
});

describe('settlementOverdue', () => {
	const vested = { vestsOn: '2026-08-01', settledOn: null, forfeitedOn: null };

	it('waits out the grace period after a vest', () => {
		expect(settlementOverdue(vested, '2026-08-14', 14)).toBe(false);
		expect(settlementOverdue(vested, '2026-08-15', 14)).toBe(false);
		expect(settlementOverdue(vested, '2026-08-16', 14)).toBe(true);
	});

	it('says nothing about a tranche that has not vested yet', () => {
		expect(settlementOverdue({ ...vested, vestsOn: '2026-12-01' }, '2026-09-15', 14)).toBe(false);
	});

	it('says nothing once the settlement is recorded', () => {
		expect(settlementOverdue({ ...vested, settledOn: '2026-08-03' }, '2026-09-15', 14)).toBe(false);
	});

	// Forfeited units never arrived, so there is nothing to write down.
	it('says nothing about a forfeited tranche', () => {
		expect(settlementOverdue({ ...vested, forfeitedOn: '2026-07-01' }, '2026-09-15', 14)).toBe(
			false
		);
	});
});

describe('taxYearToChase', () => {
	it('stays quiet before the month the household set', () => {
		expect(taxYearToChase('2026-01-20', 3)).toBeNull();
		expect(taxYearToChase('2026-02-28', 3)).toBeNull();
	});

	it('asks about last year from that month on', () => {
		expect(taxYearToChase('2026-03-01', 3)).toBe(2025);
		expect(taxYearToChase('2026-12-31', 3)).toBe(2025);
	});

	it('honours a household that wants asking earlier', () => {
		expect(taxYearToChase('2026-01-20', 1)).toBe(2025);
	});
});

describe('laneShortfall', () => {
	const cells = (...states: string[]) => states.map((state) => ({ state }));

	it('counts the gaps when the latest expected period is empty', () => {
		expect(laneShortfall(cells('filed', 'gap', 'gap', 'not-arrived'))).toBe(2);
	});

	// An old hole with this month's paper filed is the shelf's business, not the
	// briefing's: the rhythm has not stopped.
	it('says nothing when the latest expected period was filed', () => {
		expect(laneShortfall(cells('gap', 'filed', 'not-arrived'))).toBe(0);
	});

	it('says nothing about a year that has not arrived', () => {
		expect(laneShortfall(cells('before', 'not-arrived', 'not-arrived'))).toBe(0);
	});

	it('says nothing about no cells at all', () => {
		expect(laneShortfall([])).toBe(0);
	});
});

describe('laneJudgeable', () => {
	const cells = (...states: string[]) => states.map((state) => ({ state }));

	it('is true once a period could have held something', () => {
		expect(laneJudgeable(cells('before', 'gap'))).toBe(true);
	});

	it('is false for a year that is entirely ahead of the household', () => {
		expect(laneJudgeable(cells('before', 'not-arrived'))).toBe(false);
	});
});
