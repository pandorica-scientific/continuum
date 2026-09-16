// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the documents rail', () => {
	const source = readFileSync('src/lib/documents/DocumentsRail.svelte', 'utf8');

	it('holds Inbox, the shelves and Everything, in that order, and nothing else', () => {
		const inbox = source.indexOf('rail-item inbox');
		const shelves = source.indexOf('>Shelves<');
		const everything = source.indexOf("s.key === 'all'");
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
		// The dialog reads the same list `addShelf` validates against.
		expect(source).toMatch(/unitsForTemplate\(newTemplate\)/);
	});

	it('is a third smaller than it was', () => {
		// A ratchet: it may fall, but a rise means a second list has crept back in.
		expect(source.split('\n').length).toBeLessThan(750);
	});
});
