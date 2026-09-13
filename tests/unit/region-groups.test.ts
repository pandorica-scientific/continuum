// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which pieces a country is drawn in.
 *
 * Natural Earth's admin-1 file is not one administrative level. Germany gets
 * its sixteen Länder; France gets ninety-six départements, Italy a hundred and
 * ten province, the United Kingdom two hundred and thirty-two districts. The
 * build dissolves the local ones onto the region they belong to, and this pins
 * the two decisions in that: which regions get regrouped afterwards, and which
 * are not drawn at all.
 */
import { describe, expect, it } from 'vitest';
import { REGION_ADMIN_OVERRIDES, REGION_GROUPS, regionGroupFor } from '$lib/life/geo/aliases';

describe('regionGroupFor', () => {
	it('leaves a region alone when the country needs no regrouping', () => {
		// France's régions ARE the administrative regions; the dissolve is enough.
		expect(regionGroupFor('France', 'Nouvelle-Aquitaine')).toBe('Nouvelle-Aquitaine');
		expect(regionGroupFor('Italy', 'Lombardia')).toBe('Lombardia');
		expect(regionGroupFor('Germany', 'Bayern')).toBe('Bayern');
	});

	// Natural Earth splits Scotland into the four NUTS-2 regions used for
	// European statistics. Nobody has been to "Highlands and Islands" as
	// distinct from Scotland, and a scratch map that asked them to would be
	// wrong about what the country is.
	it('folds the Scottish and Welsh statistical regions back into their countries', () => {
		for (const part of ['Eastern', 'Highlands and Islands', 'North Eastern', 'South Western']) {
			expect(regionGroupFor('United Kingdom', part)).toBe('Scotland');
		}
		for (const part of ['East Wales', 'West Wales and the Valleys']) {
			expect(regionGroupFor('United Kingdom', part)).toBe('Wales');
		}
	});

	it('names the English regions the way a person would', () => {
		expect(regionGroupFor('United Kingdom', 'East')).toBe('East of England');
		expect(regionGroupFor('United Kingdom', 'Greater London')).toBe('London');
		// The other seven are already named as anybody would say them.
		expect(regionGroupFor('United Kingdom', 'South West')).toBe('South West');
	});

	it('draws the United Kingdom in twelve pieces', () => {
		const ne = [
			'East',
			'East Midlands',
			'East Wales',
			'Eastern',
			'Greater London',
			'Highlands and Islands',
			'North East',
			'North Eastern',
			'North West',
			'Northern Ireland',
			'South East',
			'South West',
			'South Western',
			'West Midlands',
			'West Wales and the Valleys',
			'Yorkshire and the Humber'
		];
		const drawn = new Set(ne.map((region) => regionGroupFor('United Kingdom', region)));
		expect(drawn.size).toBe(12);
		expect(drawn).toContain('Scotland');
		expect(drawn).toContain('Wales');
		expect(drawn).toContain('Northern Ireland');
	});

	// Ceuta and Melilla are autonomous CITIES rather than communities, and at 12
	// and 19 square kilometres they are smaller than the brush that would
	// scratch them. Null is the only thing in this table that removes territory.
	it('drops the two Spanish enclaves, leaving the seventeen communities', () => {
		expect(regionGroupFor('Spain', 'Ceuta')).toBeNull();
		expect(regionGroupFor('Spain', 'Melilla')).toBeNull();
		expect(regionGroupFor('Spain', 'Andalucía')).toBe('Andalucía');
	});

	it('draws Spain in seventeen pieces', () => {
		const ne = [
			'Andalucía',
			'Aragón',
			'Asturias',
			'Canary Is.',
			'Cantabria',
			'Castilla y León',
			'Castilla-La Mancha',
			'Cataluña',
			'Ceuta',
			'Extremadura',
			'Foral de Navarra',
			'Galicia',
			'Islas Baleares',
			'La Rioja',
			'Madrid',
			'Melilla',
			'Murcia',
			'País Vasco',
			'Valenciana'
		];
		const drawn = ne.map((region) => regionGroupFor('Spain', region)).filter((one) => one !== null);
		expect(drawn.length).toBe(17);
	});

	it('knows nothing about a country with no entry', () => {
		expect(regionGroupFor('Thailand', 'Northern')).toBe('Northern');
		expect(REGION_GROUPS['Thailand']).toBeUndefined();
	});
});

// Natural Earth records de facto control, so both arrive under Russia. This is
// the table that moves them, and it is worth a test of its own because the
// consequence of it silently lapsing is a political claim on a map.
describe('sovereignty overrides', () => {
	it('puts Crimea and Sevastopol under Ukraine', () => {
		const rule = REGION_ADMIN_OVERRIDES.find((one) => one.from === 'Russia');
		expect(rule?.to).toBe('Ukraine');
		expect(rule?.names).toContain('Crimea');
		expect(rule?.names).toContain('Sevastopol');
	});
});
