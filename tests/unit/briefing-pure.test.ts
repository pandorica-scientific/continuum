// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import {
	aboutLine,
	briefingCaption,
	countTitle,
	latestJobPerDocument
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
