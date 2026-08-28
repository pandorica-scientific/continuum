// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import {
	expiryTreatment,
	honestyState,
	readableSize,
	rowTags,
	rowVariant,
	groupDocuments,
	matchLabel,
	readableDate,
	sortDocuments,
	splitSnippet,
	subLine,
	typeLabel,
	type DocRow
} from '$lib/documents-view';

const TODAY = '2026-08-28';

const row = (over: Partial<DocRow> = {}): DocRow => ({
	id: over.id ?? 'd1',
	name: over.name ?? 'A document',
	type: over.type ?? 'other',
	shelfKey: over.shelfKey ?? 'household',
	shelfLabel: over.shelfLabel ?? 'Household',
	entities: over.entities ?? [],
	addedOn: over.addedOn ?? '2026-01-01',
	periodOn: over.periodOn ?? null,
	expiresOn: over.expiresOn ?? null,
	expiryVerb: over.expiryVerb ?? 'expires',
	subjectArchived: over.subjectArchived ?? false
});

describe('expiryTreatment', () => {
	it('reads a distant renewal as green — fine, and here is when', () => {
		expect(
			expiryTreatment({ expiresOn: '2027-01-12', expiryVerb: 'renews' }, false, TODAY, 'wide')
		).toEqual({ kind: 'pill', hue: 'green', text: 'renews 12 Jan 2027' });
	});

	it('turns amber inside sixty days', () => {
		expect(
			expiryTreatment({ expiresOn: '2026-09-18', expiryVerb: 'renews' }, false, TODAY, 'wide')
		).toEqual({ kind: 'pill', hue: 'yellow', text: 'renews in 21 days' });
	});

	it('turns red once it has passed', () => {
		expect(
			expiryTreatment({ expiresOn: '2026-08-22', expiryVerb: 'expires' }, false, TODAY, 'wide')
		).toEqual({ kind: 'pill', hue: 'red', text: 'expired 6 days ago' });
	});

	it('carries no red for an expiry that passed on an archived subject', () => {
		// History, not a problem. A sold car's insurance expired in April and
		// nobody needs to be told about it in red every time they open the list.
		expect(
			expiryTreatment({ expiresOn: '2026-04-18', expiryVerb: 'ends' }, true, TODAY, 'wide')
		).toEqual({ kind: 'plain', text: 'ended 2026-04-18' });
	});

	it('sheds the verb below 1200px only in the quiet state — A2', () => {
		// "due" and "renews" mean different things to do. Urgent rows are few
		// enough to afford the 12px; the quiet ones are not.
		expect(
			expiryTreatment({ expiresOn: '2027-01-12', expiryVerb: 'renews' }, false, TODAY, 'medium')
		).toEqual({ kind: 'pill', hue: 'green', text: '12 Jan 2027' });
		expect(
			expiryTreatment({ expiresOn: '2026-09-18', expiryVerb: 'renews' }, false, TODAY, 'medium')
		).toEqual({ kind: 'pill', hue: 'yellow', text: 'renews in 21 days' });
	});

	it('says nothing at all about a document with no expiry', () => {
		expect(expiryTreatment({ expiresOn: null, expiryVerb: 'expires' }, false, TODAY)).toBeNull();
	});

	it('reads the singular as a singular', () => {
		expect(expiryTreatment({ expiresOn: '2026-08-29', expiryVerb: 'due' }, false, TODAY)).toEqual({
			kind: 'pill',
			hue: 'yellow',
			text: 'due in 1 day'
		});
		expect(expiryTreatment({ expiresOn: '2026-08-28', expiryVerb: 'due' }, false, TODAY)).toEqual({
			kind: 'pill',
			hue: 'yellow',
			text: 'due today'
		});
	});
});

describe('groupDocuments', () => {
	const fixtures = [
		row({ id: '1', type: 'invoice', entities: ['Karlín'], addedOn: '2026-03-02' }),
		row({ id: '2', type: 'invoice', entities: ['Jana', 'Karlín'], addedOn: '2025-11-02' }),
		row({ id: '3', type: 'contract', expiresOn: '2026-09-10' }),
		row({ id: '4', type: 'payslip', periodOn: '2024-06-01' })
	];

	it('places a document in exactly one group', () => {
		// Grouping provides structure; grouping is not sorting.
		for (const key of ['type', 'entity', 'year', 'expiry', 'none'] as const) {
			const groups = groupDocuments(fixtures, key, TODAY);
			const ids = groups.flatMap((g) => g.items.map((i) => i.id));
			expect(new Set(ids).size, key).toBe(ids.length);
			expect(ids.length, key).toBe(fixtures.length);
		}
	});

	it('names a type group by its label, never by its code', () => {
		const groups = groupDocuments(fixtures, 'type', TODAY);
		expect(groups.map((g) => g.label)).toContain('Invoice');
		expect(groups.map((g) => g.label).join(' ')).not.toMatch(/bank_statement|_/);
	});

	it('groups a document about two entities under one of them, not both', () => {
		const groups = groupDocuments(fixtures, 'entity', TODAY);
		const counted = groups.flatMap((g) => g.items).filter((i) => i.id === '2');
		expect(counted).toHaveLength(1);
	});

	it('files an unlinked document under a group that says so', () => {
		const groups = groupDocuments([row({ id: '9' })], 'entity', TODAY);
		expect(groups[0].label).toBe('Not linked to anything');
	});

	it('reads a year from the period it covers, falling back to when it arrived', () => {
		const groups = groupDocuments(fixtures, 'year', TODAY);
		// Newest year first, and the payslip sits in the year it is ABOUT.
		expect(groups.map((g) => g.label)).toEqual(['2026', '2025', '2024']);
	});

	it('buckets expiry as expired, soon, later and none', () => {
		const groups = groupDocuments(
			[
				row({ id: 'a', expiresOn: '2026-01-01' }),
				row({ id: 'b', expiresOn: '2026-09-10' }),
				row({ id: 'c', expiresOn: '2027-09-10' }),
				row({ id: 'd' })
			],
			'expiry',
			TODAY
		);
		expect(groups.map((g) => g.label)).toEqual(['Expired', 'Next 30 days', 'Later', 'No expiry']);
	});
});

describe('sortDocuments', () => {
	const fixtures = [
		row({ id: 'a', name: 'Zebra', addedOn: '2026-01-01', expiresOn: '2026-12-01' }),
		row({ id: 'b', name: 'Alpha', addedOn: '2026-05-01' }),
		row({ id: 'c', name: 'Mid', addedOn: '2026-03-01', expiresOn: '2026-09-01' })
	];

	it('puts the newest first by default', () => {
		expect(sortDocuments(fixtures, 'newest').map((d) => d.id)).toEqual(['b', 'c', 'a']);
	});

	it('sorts by name and by soonest expiry as separate answers', () => {
		expect(sortDocuments(fixtures, 'name').map((d) => d.id)).toEqual(['b', 'c', 'a']);
		// A document with no expiry is not "furthest away" — it is a different
		// thing, and it sorts to the end rather than pretending to be in 9999.
		expect(sortDocuments(fixtures, 'expiry').map((d) => d.id)).toEqual(['c', 'a', 'b']);
	});
});

describe('the row itself', () => {
	it('reads its sub-line as shelf then what it is about', () => {
		expect(subLine(row({ shelfLabel: 'Property', entities: ['Karlín', 'Jana'] }))).toBe(
			'Property · Karlín · Jana'
		);
	});

	it('shows a few tags and counts the rest rather than hiding them', () => {
		expect(rowTags(['a', 'b', 'c', 'd', 'e'])).toEqual({ shown: ['a', 'b', 'c'], more: 2 });
		expect(rowTags(['a'])).toEqual({ shown: ['a'], more: 0 });
		expect(rowTags([])).toEqual({ shown: [], more: 0 });
	});

	it('never shows a raw type code', () => {
		expect(typeLabel('bank_statement')).toBe('Bank statement');
		expect(typeLabel('nonsense')).toBe('Other');
	});

	it('writes a date the way a Czech household reads one', () => {
		expect(readableDate('2027-01-12')).toBe('12 Jan 2027');
	});
});

describe('search presentation', () => {
	it('labels only the matches a person would not otherwise see', () => {
		expect(matchLabel('contents')).toBe('Matched in contents');
		expect(matchLabel('note')).toBe('Matched in note');
		// A name match needs no label: the match is the row.
		expect(matchLabel('name')).toBeNull();
	});

	it('highlights the term through the fold, not by exact bytes', () => {
		// A highlight that misses the word the search matched reads as a bug in
		// the search itself.
		const split = splitSnippet('provozní režim zařízení', 'rezim');
		expect(split).toEqual({ before: 'provozní ', match: 'režim', after: ' zařízení' });
	});

	it('says nothing rather than guessing when the term is not in the snippet', () => {
		expect(splitSnippet('nothing here', 'absent')).toBeNull();
		expect(splitSnippet('nothing here', '   ')).toBeNull();
	});
});

describe('result rows and honesty', () => {
	it('picks a row shape from where the match was found', () => {
		expect(rowVariant({ matchedIn: 'name' })).toBe('metadata');
		expect(rowVariant({ matchedIn: 'contents' })).toBe('content');
		expect(rowVariant({ matchedIn: 'note' })).toBe('note');
		expect(rowVariant(null)).toBe('metadata');
	});

	it('writes a size a person reads', () => {
		expect(readableSize(412 * 1024)).toBe('412 kB');
		expect(readableSize(900)).toBe('900 B');
		expect(readableSize(3_500_000)).toBe('3.3 MB');
		expect(readableSize(null)).toBeNull();
	});

	it('tells "nothing matched" apart from "nothing matched yet"', () => {
		// A person told the first when the second is true concludes the search
		// is broken, and stops using it.
		const none = { pending: 0, notSearchable: 0, archivedOnly: 0 };
		expect(honestyState('smlouva', 0, none)).toBe('empty');
		expect(honestyState('smlouva', 0, { ...none, pending: 3 })).toBe('preparing');
		expect(honestyState('smlouva', 0, { ...none, archivedOnly: 2 })).toBe('archived-only');
	});

	it('says what was not searched even when something was found', () => {
		expect(honestyState('smlouva', 4, { pending: 0, notSearchable: 9, archivedOnly: 0 })).toBe(
			'not-searchable'
		);
		expect(honestyState('smlouva', 4, { pending: 0, notSearchable: 0, archivedOnly: 0 })).toBe(
			'none'
		);
	});

	it('says nothing at all when nobody searched', () => {
		expect(honestyState('', 0, { pending: 3, notSearchable: 9, archivedOnly: 1 })).toBe('none');
	});
});
