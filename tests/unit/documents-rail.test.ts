// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * What the rail holds, guarded at the source.
 *
 * Three sections with three pencils grew to a thousand lines, and two of them
 * listed records that have a card of their own on a shelf — the same subject in
 * two places, and the second place with no room to say anything about it. A
 * rail that reads the same on every visit is what a shelf being the screen
 * needs.
 */
describe('the documents rail', () => {
	const source = readFileSync('src/lib/documents/DocumentsRail.svelte', 'utf8');

	it('holds Inbox, the shelves and Everything, in that order, and nothing else', () => {
		const inbox = source.indexOf('rail-item inbox');
		const shelves = source.indexOf('>Shelves<');
		const everything = source.indexOf('Everything is the archive');
		expect(inbox).toBeGreaterThan(-1);
		expect(shelves).toBeGreaterThan(inbox);
		expect(everything).toBeGreaterThan(shelves);

		expect(source).not.toContain('>Subjects<');
		expect(source).not.toContain('>Organisations<');
		expect(source).not.toContain('>Roles<');
		expect(source).not.toContain('SubjectRow');
		expect(source).not.toContain('OrganisationRow');
	});

	it('a new shelf is a template, a unit and a question', () => {
		expect(source).toContain('TEMPLATE_LABELS');
		expect(source).toContain('unitsForTemplate');
		expect(source).toContain('name="template"');
		expect(source).toContain('name="unit"');
		expect(source).toContain('name="question"');
	});

	it('offers only units the chosen template can be organised by', () => {
		// A wallet of things is not a layout anybody could draw. The dialog reads
		// the same list `addShelf` refuses against, rather than a second one.
		expect(source).toMatch(/unitsForTemplate\(newTemplate\)/);
	});

	it('is a third smaller than it was', () => {
		// 1086 lines before v0.8.0, when it carried three lists with three pencils.
		// What remains is shelf editing — rename, reorder, remove, and the type
		// list — which is genuinely the rail's job and lives nowhere else. The
		// number is a ratchet: it may fall, and a change that pushes it back up
		// is putting a second list in here again.
		expect(source.split('\n').length).toBeLessThan(750);
	});
});
