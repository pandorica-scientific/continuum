// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { ENUMS } from '$lib/enums';
import {
	TEMPLATE_LABELS,
	templateDefaults,
	templateEngine,
	unitsForTemplate
} from '$lib/documents/templates';

/**
 * Seven template names, four engines.
 *
 * The plan the old `PlannedShelfLayout` type carried — gallery, timeline, kit —
 * never shipped, because each name was going to be a component of its own and
 * three more components is three more things to keep consistent. They are the
 * dossier with a different seed and a different history order, which is a
 * difference a household can see and the code barely notices.
 */
describe('shelf templates', () => {
	it('every template has an engine, a label and a unit list', () => {
		for (const template of ENUMS['shelf.template']) {
			expect(['queue', 'wallet', 'completeness', 'dossier']).toContain(templateEngine(template));
			expect(TEMPLATE_LABELS[template].length).toBeGreaterThan(0);
			expect(unitsForTemplate(template).length).toBeGreaterThan(0);
		}
	});

	it('three names are the dossier with a different start', () => {
		expect(templateEngine('kit')).toBe('dossier');
		expect(templateEngine('timeline')).toBe('dossier');
		expect(templateEngine('obligations')).toBe('dossier');

		expect(templateDefaults('kit').laneSeeds.map((s) => s.label)).toEqual([
			'Receipt',
			'Warranty',
			'Manual'
		]);
		expect(templateDefaults('kit').laneSeeds.every((s) => s.cadence === 'once')).toBe(true);
		expect(templateDefaults('timeline').historyOrder).toBe('oldest');
		expect(templateDefaults('dossier').historyOrder).toBe('newest');
		expect(templateDefaults('obligations').laneSeeds).toEqual([
			{ label: 'Insurance', cadence: 'yearly', every: 1 }
		]);
	});

	it('the three fixed engines take one unit each', () => {
		expect(unitsForTemplate('queue')).toEqual(['document']);
		expect(unitsForTemplate('wallet')).toEqual(['person']);
		expect(unitsForTemplate('completeness')).toEqual(['account']);
		expect(unitsForTemplate('dossier')).toEqual([
			'organisation',
			'property',
			'subject',
			'person'
		]);
	});

	it('every seeded lane names a whole number of periods', () => {
		// `every` is the column a CHECK holds at 1 or more; a seed that broke it
		// would fail on the insert rather than here, which is a worse place.
		for (const template of ENUMS['shelf.template'])
			for (const seed of templateDefaults(template).laneSeeds) {
				expect(Number.isInteger(seed.every)).toBe(true);
				expect(seed.every).toBeGreaterThanOrEqual(1);
			}
	});
});
