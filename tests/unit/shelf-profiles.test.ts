// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { ENUMS } from '$lib/enums';
import { LAYOUT_LABELS, SHELF_PROFILES, orderTypeOptions, shelfProfile } from '$lib/shelf-profiles';

/** The keys the baseline seeds, which is what the registry has to cover. */
const SEEDED = [
	'inbox',
	'identity',
	'family',
	'health',
	'property',
	'tenancy',
	'vehicles',
	'finance',
	'household',
	'statements'
];

describe('the shelf registry', () => {
	it('profiles every shelf a fresh install ships', () => {
		expect(Object.keys(SHELF_PROFILES).sort()).toEqual([...SEEDED].sort());
		for (const key of SEEDED) expect(shelfProfile(key)?.key).toBe(key);
	});

	it('expects only types the archive can actually hold', () => {
		// `expects` is offered by the type filter and proposed during review, so a
		// value outside the enum would be a choice that fails the CHECK on save.
		for (const profile of Object.values(SHELF_PROFILES)) {
			for (const type of profile.expects) {
				expect(ENUMS['document.type']).toContain(type);
			}
		}
	});

	it('says what a layout groups by wherever it draws one', () => {
		for (const profile of Object.values(SHELF_PROFILES)) {
			if (profile.layout !== 'list') expect(profile.about).not.toBeNull();
		}
	});

	it('draws the wallet on Identity and the list everywhere else, for now', () => {
		// Family, Health and Household have their layouts specified and not yet
		// built. This is the line that has to be edited when one lands, which is
		// the point: a shelf does not start drawing something new by accident.
		const bespoke = Object.values(SHELF_PROFILES).filter((p) => p.layout !== 'list');
		expect(bespoke.map((p) => p.key)).toEqual(['identity']);
		expect(bespoke[0].layout).toBe('wallet');
	});

	it('names every layout it can draw', () => {
		for (const profile of Object.values(SHELF_PROFILES)) {
			expect(LAYOUT_LABELS[profile.layout]).toBeTruthy();
		}
		expect(LAYOUT_LABELS.list).toBe('List');
	});

	it('says what belongs on a shelf, in a sentence', () => {
		for (const profile of Object.values(SHELF_PROFILES)) {
			expect(profile.emptyHint.length).toBeGreaterThan(10);
			expect(profile.emptyHint).toMatch(/\.$/);
		}
	});

	it('has no opinion about Everything, or about a shelf a household made', () => {
		expect(shelfProfile('all')).toBeNull();
		expect(shelfProfile('boat')).toBeNull();
		expect(shelfProfile('')).toBeNull();
	});
});

describe('orderTypeOptions', () => {
	const types = [
		{ code: 'invoice', count: 40 },
		{ code: 'id_document', count: 3 },
		{ code: 'certificate', count: 1 }
	];

	it('offers what the shelf expects first, in the order it expects them', () => {
		expect(orderTypeOptions(types, ['id_document', 'certificate']).map((t) => t.code)).toEqual([
			'id_document',
			'certificate',
			'invoice'
		]);
	});

	it('ranks the rest by how many documents each would leave', () => {
		expect(orderTypeOptions(types, []).map((t) => t.code)).toEqual([
			'invoice',
			'id_document',
			'certificate'
		]);
	});

	it('offers every type on the shelf, expected or not', () => {
		// The registry decides the ORDER and never what is allowed: a household
		// that files its car insurance under Identity still finds it in the filter.
		expect(orderTypeOptions(types, ['id_document'])).toHaveLength(types.length);
	});

	it('leaves the array it was handed alone', () => {
		const before = types.map((t) => t.code);
		orderTypeOptions(types, ['id_document']);
		expect(types.map((t) => t.code)).toEqual(before);
	});
});
