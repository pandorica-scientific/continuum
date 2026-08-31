// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
	expiryTreatment,
	honestyState,
	readableSize,
	rowVariant,
	groupDocuments,
	groupSummary,
	readableDate,
	sortDocuments,
	splitSnippet,
	subLine,
	typeLabel,
	aboutOptionLabel,
	groupAboutOptions,
	type AboutOption,
	type DocRow
} from '$lib/documents/view';

const TODAY = '2026-08-28';

/** The pill hue, or null for a plain treatment — the union is narrowed once here. */
const hueOf = (t: ReturnType<typeof expiryTreatment>) => (t?.kind === 'pill' ? t.hue : null);

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
	it('reads a distant renewal as blue — an obligation stands behind the date', () => {
		expect(
			expiryTreatment({ expiresOn: '2027-01-12', expiryVerb: 'renews' }, false, TODAY, 'wide')
		).toEqual({ kind: 'pill', hue: 'blue', text: 'renews 12 Jan 2027' });
	});

	it('reads a distant expiry as purple — nothing stands behind it', () => {
		expect(
			expiryTreatment({ expiresOn: '2032-08-04', expiryVerb: 'expires' }, false, TODAY, 'wide')
		).toEqual({ kind: 'pill', hue: 'purple', text: 'expires 4 Aug 2032' });
	});

	it('turns amber inside sixty days, and the verb hue is replaced rather than tinted', () => {
		expect(
			expiryTreatment({ expiresOn: '2026-09-18', expiryVerb: 'renews' }, false, TODAY, 'wide')
		).toEqual({ kind: 'pill', hue: 'yellow', text: 'renews in 21 days' });
	});

	it('gives money owed a shorter window', () => {
		// Two months out is rarely worth amber for a bill; a month is.
		expect(
			hueOf(expiryTreatment({ expiresOn: '2026-10-10', expiryVerb: 'due' }, false, TODAY))
		).toBe('blue');
		expect(
			hueOf(expiryTreatment({ expiresOn: '2026-09-20', expiryVerb: 'due' }, false, TODAY))
		).toBe('yellow');
	});

	it('turns red once it has passed, and never claims a renewal happened', () => {
		expect(
			expiryTreatment({ expiresOn: '2026-08-22', expiryVerb: 'expires' }, false, TODAY, 'wide')
		).toEqual({ kind: 'pill', hue: 'red', text: 'expired 6 days ago' });
		expect(
			expiryTreatment({ expiresOn: '2026-08-22', expiryVerb: 'renews' }, false, TODAY)?.text
		).toBe('renewal due 6 days ago');
		expect(
			expiryTreatment({ expiresOn: '2026-08-22', expiryVerb: 'due' }, false, TODAY)?.text
		).toBe('overdue 6 days');
	});

	it('lets a lapsed expiry go back to purple after a month — the alarm has said all it can', () => {
		expect(
			expiryTreatment({ expiresOn: '2026-06-01', expiryVerb: 'expires' }, false, TODAY)
		).toEqual({ kind: 'pill', hue: 'purple', text: 'expired 1 Jun 2026' });
		// Nothing can know a replacement was filed or a bill was paid, so these
		// stay red until the date changes or the subject is archived.
		expect(
			hueOf(expiryTreatment({ expiresOn: '2026-06-01', expiryVerb: 'renews' }, false, TODAY))
		).toBe('red');
		expect(
			hueOf(expiryTreatment({ expiresOn: '2026-06-01', expiryVerb: 'due' }, false, TODAY))
		).toBe('red');
	});

	it('lifts the red on an archived subject and lets the verb hue return', () => {
		// History, not a problem. A sold car's insurance expired in April and
		// nobody needs to be told about it in red every time they open the list.
		expect(
			expiryTreatment({ expiresOn: '2026-04-18', expiryVerb: 'expires' }, true, TODAY, 'wide')
		).toEqual({ kind: 'pill', hue: 'purple', text: 'expired 18 Apr 2026' });
		expect(expiryTreatment({ expiresOn: '2026-04-18', expiryVerb: 'renews' }, true, TODAY)).toEqual(
			{ kind: 'pill', hue: 'blue', text: 'renewal was due 18 Apr 2026' }
		);
	});

	it('sheds the verb below 1200px only in the quiet state — A2', () => {
		// "due" and "renews" mean different things to do. Urgent rows are few
		// enough to afford the 12px; the quiet ones are not.
		expect(
			expiryTreatment({ expiresOn: '2027-01-12', expiryVerb: 'renews' }, false, TODAY, 'medium')
		).toEqual({ kind: 'pill', hue: 'blue', text: '12 Jan 2027' });
		expect(
			expiryTreatment({ expiresOn: '2026-09-18', expiryVerb: 'renews' }, false, TODAY, 'medium')
		).toEqual({ kind: 'pill', hue: 'yellow', text: 'renews in 21 days' });
	});

	it('says when a document with no expiry arrived, in an outline pill', () => {
		// The column reads as a column, but there is no logic behind the date, so
		// no fill: fifty filled pills saying nothing would be the loudest thing
		// on the screen.
		expect(
			expiryTreatment(
				{ expiresOn: null, expiryVerb: 'expires', addedOn: '2024-11-02' },
				false,
				TODAY
			)
		).toEqual({ kind: 'outline', text: 'added 2 Nov 2024' });
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

	it('never shows a raw type code', () => {
		expect(typeLabel('bank_statement')).toBe('Bank statement');
		expect(typeLabel('nonsense')).toBe('Other');
	});

	it('writes a date the way a Czech household reads one', () => {
		expect(readableDate('2027-01-12')).toBe('12 Jan 2027');
	});
});

describe('search presentation', () => {
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

describe('groupSummary', () => {
	it('says how many, how many need attention, and when the next one falls due', () => {
		const summary = groupSummary(
			[
				row({ id: 'a', expiresOn: '2026-08-22' }), // passed
				row({ id: 'b', expiresOn: '2026-09-18' }), // amber
				row({ id: 'c', expiresOn: '2027-03-01' }), // green
				row({ id: 'd' })
			],
			TODAY
		);
		expect(summary).toEqual({ count: 4, expired: 1, soon: 1, nextExpiry: '2026-09-18' });
	});

	it('does not count a lapsed expiry on an archived subject as expired', () => {
		// History, not a state — the same rule the row itself follows.
		const summary = groupSummary([row({ expiresOn: '2026-04-18', subjectArchived: true })], TODAY);
		expect(summary.expired).toBe(0);
		expect(summary.nextExpiry).toBeNull();
	});
});

/**
 * The "what it is about" filter.
 *
 * A flat list of names was readable while the screen named four kinds. Now that
 * every registered kind reaches it, "Alza 2026-03-04" sits beside "Robert" and
 * "Vinohrady flat" with nothing to say which is which — so the options carry
 * the heading their kind belongs to and are read under it.
 */
describe('the about filter', () => {
	const option = (over: Partial<AboutOption> = {}): AboutOption => ({
		id: over.id ?? 'e1',
		name: over.name ?? 'Robert',
		meta: over.meta,
		groupLabel: over.groupLabel ?? 'People',
		count: over.count ?? 1
	});

	it('puts each option under its own heading, in the order the registry gave them', () => {
		const grouped = groupAboutOptions([
			option({ id: 'p1', name: 'Robert', groupLabel: 'People' }),
			option({ id: 'p2', name: 'Kseniya', groupLabel: 'People' }),
			option({ id: 'l1', name: 'Vinohrady mortgage', groupLabel: 'Loans' }),
			option({ id: 't1', name: 'Alza 2026-03-04', groupLabel: 'Transactions' })
		]);
		expect(grouped.map((g) => g.label)).toEqual(['People', 'Loans', 'Transactions']);
		expect(grouped[0].options.map((o) => o.name)).toEqual(['Robert', 'Kseniya']);
		expect(grouped[2].options.map((o) => o.id)).toEqual(['t1']);
	});

	it('offers no empty heading', () => {
		expect(groupAboutOptions([])).toEqual([]);
	});

	it('reads a name with its count, and a transaction with its amount between them', () => {
		// A card payment's name is a shop and a date; two of them from the same
		// shop on the same day are told apart by the amount, which is what `meta`
		// carries for every kind whose name alone is ambiguous.
		expect(aboutOptionLabel(option({ name: 'Robert', count: 4 }))).toBe('Robert · 4');
		expect(
			aboutOptionLabel(option({ name: 'Alza 2026-03-04', meta: '−1 234,50 CZK', count: 1 }))
		).toBe('Alza 2026-03-04 · −1 234,50 CZK · 1');
	});
});
