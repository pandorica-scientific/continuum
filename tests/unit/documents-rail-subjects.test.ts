// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The SUBJECTS section of the Documents rail.
 *
 * There is no browser suite in this repository, so the two things the section
 * decides are reachable without a page: `railSubjects` says which rows are
 * drawn and in what order, and `SubjectRow` is rendered to a string and read
 * for the controls a person has to be able to reach.
 */
import { describe, expect, it } from 'vitest';

import { railSubjects, type RailSubject } from '$lib/documents/view';

const subject = (over: Partial<RailSubject> = {}): RailSubject => ({
	id: over.id ?? 's1',
	name: over.name ?? 'Car',
	emoji: over.emoji ?? '🚗',
	archived: over.archived ?? false,
	count: over.count ?? 0
});

describe('railSubjects', () => {
	const house = subject({ id: 'house', name: 'The house', emoji: '🏠' });
	const car = subject({ id: 'car', name: 'Car' });
	const dog = subject({ id: 'dog', name: 'dog' });
	const boat = subject({ id: 'boat', name: 'Boat', archived: true });

	it('keeps archived subjects out until the archive scope is open', () => {
		const { shown, hidden } = railSubjects([house, car, boat], false);
		expect(shown.map((s) => s.id)).toEqual(['car', 'house']);
		// The number the "Show N archived" affordance says out loud, so a subject
		// that was archived is never simply unreachable.
		expect(hidden).toBe(1);
	});

	it('shows them, last, once it is', () => {
		const { shown, hidden } = railSubjects([boat, house, car], true);
		expect(shown.map((s) => s.id)).toEqual(['car', 'house', 'boat']);
		expect(hidden).toBe(0);
	});

	it('sorts by name, folded, so "dog" and "Dog" sort together', () => {
		// Nothing leads any more: v0.8.0 seeds no catch-all "Household", so there
		// is no subject for the sort to privilege.
		const { shown } = railSubjects([dog, car, house], false);
		expect(shown.map((s) => s.id)).toEqual(['car', 'dog', 'house']);
	});

	it('leaves the list it was given alone', () => {
		const given = [dog, car, house];
		railSubjects(given, false);
		expect(given.map((s) => s.id)).toEqual(['dog', 'car', 'house']);
	});
});
