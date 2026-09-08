// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
	countryGroups,
	NOBODY,
	sectionsByPerson,
	type AboutLink,
	type LayoutRow
} from '$lib/documents/layouts';

const ROBERT: AboutLink = { id: 'p1', kind: 'person', name: 'Robert' };
const JANA: AboutLink = { id: 'p2', kind: 'person', name: 'Jana' };
const DOG: AboutLink = { id: 's1', kind: 'subject', name: 'The dog' };
const FLAT: AboutLink = { id: 'r1', kind: 'property', name: 'Vinohrady flat' };

const row = (id: string, about: AboutLink[], over: Partial<LayoutRow> = {}): LayoutRow => ({
	id,
	name: over.name ?? `Document ${id}`,
	type: over.type ?? 'id_document',
	shelfKey: 'identity',
	shelfLabel: 'Identity',
	entities: about.map((a) => a.name),
	addedOn: over.addedOn ?? '2026-01-01',
	periodOn: over.periodOn ?? null,
	expiresOn: over.expiresOn ?? null,
	expiryVerb: over.expiryVerb ?? 'expires',
	subjectArchived: over.subjectArchived ?? false,
	ext: 'PDF',
	tags: [],
	about,
	identity: over.identity ?? null
});

describe('sectionsByPerson', () => {
	it('makes one section per person, by name', () => {
		const sections = sectionsByPerson([row('a', [ROBERT]), row('b', [JANA]), row('c', [ROBERT])]);

		expect(sections.map((s) => s.label)).toEqual(['Jana', 'Robert']);
		expect(sections.map((s) => s.items.length)).toEqual([1, 2]);
	});

	it('files a document under the first person it names, once', () => {
		// Shown under both halves of a couple, a wallet would say the household
		// owns two passports where it owns one, and the count beside the name is
		// what makes that wrong out loud.
		const sections = sectionsByPerson([row('joint', [ROBERT, JANA])]);

		expect(sections).toHaveLength(1);
		expect(sections[0].label).toBe('Robert');
	});

	it('puts the documents nobody is named on last, and names that too', () => {
		// Not hidden: a passport nobody has said belongs to anyone is exactly the
		// one somebody forgot to finish filing.
		const sections = sectionsByPerson([row('orphan', []), row('a', [ROBERT])]);

		expect(sections.map((s) => s.label)).toEqual(['Robert', NOBODY]);
		expect(sections[1].link).toBeNull();
	});

	it('ignores links that are not people', () => {
		const sections = sectionsByPerson([row('bill', [FLAT]), row('vax', [DOG])]);

		expect(sections).toHaveLength(1);
		expect(sections[0].label).toBe(NOBODY);
		expect(sections[0].items).toHaveLength(2);
	});

	it('has nothing to show for nothing', () => {
		expect(sectionsByPerson([])).toEqual([]);
	});
});

describe('countryGroups', () => {
	const issued = (id: string, country: string | null): LayoutRow =>
		row(id, [ROBERT], { identity: { kind: 'passport', country, number: null } });

	it('puts one country together, in code order', () => {
		const groups = countryGroups([issued('a', 'PL'), issued('b', 'CZ'), issued('c', 'PL')]);

		expect(groups.map((g) => g.code)).toEqual(['CZ', 'PL']);
		expect(groups.map((g) => g.items.length)).toEqual([1, 2]);
	});

	it('puts the documents naming no country last', () => {
		// The unfinished filing, after the finished ones — the same rule NOBODY
		// follows, and for the same reason: worth showing, not worth showing first.
		const groups = countryGroups([issued('a', null), issued('b', 'PL')]);

		expect(groups.map((g) => g.code)).toEqual(['PL', null]);
	});

	it('treats a document with no identity record as naming no country', () => {
		const groups = countryGroups([row('plain', [ROBERT])]);

		expect(groups).toHaveLength(1);
		expect(groups[0].code).toBeNull();
	});

	it('makes one group when the whole wallet is from one country', () => {
		// What the wallet checks to decide whether to draw country headings at all.
		expect(countryGroups([issued('a', 'CZ'), issued('b', 'CZ')])).toHaveLength(1);
	});
});
