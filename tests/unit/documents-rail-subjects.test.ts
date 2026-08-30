// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * The SUBJECTS section of the Documents rail.
 *
 * There is no browser suite in this repository, so the two things the section
 * decides are reachable without a page: `railSubjects` says which rows are
 * drawn and in what order, and `SubjectRow` is rendered to a string and read
 * for the controls a person has to be able to reach.
 */
import { describe, expect, it } from 'vitest';

import { railSubjects, type RailSubject } from '$lib/documents-view';

const subject = (over: Partial<RailSubject> = {}): RailSubject => ({
	id: over.id ?? 's1',
	name: over.name ?? 'Car',
	emoji: over.emoji ?? '🚗',
	archived: over.archived ?? false,
	household: over.household ?? false,
	count: over.count ?? 0
});

describe('railSubjects', () => {
	const home = subject({ id: 'home', name: 'Household', emoji: '🏠', household: true });
	const car = subject({ id: 'car', name: 'Car' });
	const dog = subject({ id: 'dog', name: 'dog' });
	const boat = subject({ id: 'boat', name: 'Boat', archived: true });

	it('keeps archived subjects out until the archive scope is open', () => {
		const { shown, hidden } = railSubjects([home, car, boat], false);
		expect(shown.map((s) => s.id)).toEqual(['home', 'car']);
		// The number the "Show N archived" affordance says out loud, so a subject
		// that was archived is never simply unreachable.
		expect(hidden).toBe(1);
	});

	it('shows them, last, once it is', () => {
		const { shown, hidden } = railSubjects([boat, home, car], true);
		expect(shown.map((s) => s.id)).toEqual(['home', 'car', 'boat']);
		expect(hidden).toBe(0);
	});

	it('puts the household first and sorts the rest by name, whatever the case', () => {
		const { shown } = railSubjects([dog, car, home], false);
		expect(shown.map((s) => s.id)).toEqual(['home', 'car', 'dog']);
	});

	it('leaves the list it was given alone', () => {
		const given = [dog, car, home];
		railSubjects(given, false);
		expect(given.map((s) => s.id)).toEqual(['dog', 'car', 'home']);
	});
});
