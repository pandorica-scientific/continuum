// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { ENUMS } from '$lib/enums';
import { MODULE_KEYS } from '$lib/modules/registry';
import { documentTypesOutOfReach, reaches, reachOfPath } from '$lib/server/api/areas';
import { areasFromForm, describeReach } from '$lib/api/areas';

describe('the areas a token can be limited to', () => {
	// Written out in enums.ts because drizzle-kit loads that file outside Vite;
	// this is what keeps it the module list plus the ledger.
	it('are the module toggles and the ledger, nothing more or less', () => {
		expect([...ENUMS['api_token.area']].sort()).toEqual(['ledger', ...MODULE_KEYS].sort());
	});
});

describe('whether a grant reaches an area', () => {
	it('reaches everything, shared included, when it names no areas', () => {
		expect(reaches({ access: 'read', areas: null }, 'shared')).toBe(true);
		expect(reaches({ access: 'read', areas: null }, 'salary')).toBe(true);
	});

	it('reaches only its own areas, and never shared, when it names some', () => {
		const planner = { access: 'read-write', areas: ['trips'] } as const;
		expect(reaches(planner, 'trips')).toBe(true);
		expect(reaches(planner, 'salary')).toBe(false);
		expect(reaches(planner, 'shared')).toBe(false);
		expect(reaches({ access: 'read', areas: [] }, 'trips')).toBe(false);
	});
});

describe('paper that belongs to an area of its own', () => {
	it('keeps a payslip from any token without Salary, Documents or not', () => {
		const payslip = [{ type: 'payslip', area: 'salary' }];
		expect(documentTypesOutOfReach({ access: 'read', areas: ['documents'] })).toEqual(payslip);
		expect(documentTypesOutOfReach({ access: 'read', areas: ['trips'] })).toEqual(payslip);
		expect(documentTypesOutOfReach({ access: 'read', areas: ['documents', 'salary'] })).toEqual([]);
		expect(documentTypesOutOfReach({ access: 'read', areas: null })).toEqual([]);
	});
});

describe('the area a path touches', () => {
	const tables = (name: string) => (name === 'trip' ? 'trips' : undefined);

	it('is the table area for one table, and shared for a table nobody knows', () => {
		expect(reachOfPath('/api/v1/tables/trip', tables)).toBe('trips');
		expect(reachOfPath('/api/v1/tables/nope', tables)).toBe('shared');
	});

	it('is decided by the handler for the table list and files', () => {
		expect(reachOfPath('/api/v1/tables', tables)).toBeNull();
		expect(reachOfPath('/api/v1/files', tables)).toBeNull();
		expect(reachOfPath('/api/v1/files/abc', tables)).toBeNull();
	});

	it('is shared for anything nobody placed, so a later route fails closed', () => {
		expect(reachOfPath('/api/v1/accounts', tables)).toBe('ledger');
		expect(reachOfPath('/api/v1/networth', tables)).toBe('shared');
		expect(reachOfPath('/api/v1/future-resource', tables)).toBe('shared');
		expect(reachOfPath('/api/v2/tables/trip', tables)).toBe('shared');
		expect(reachOfPath('/api', tables)).toBe('shared');
	});
});

describe('the areas a Settings form asks for', () => {
	const form = (entries: [string, string][]) => {
		const data = new FormData();
		for (const [key, value] of entries) data.append(key, value);
		return data;
	};

	it('is everything unless "only these areas" is chosen', () => {
		expect(
			areasFromForm(
				form([
					['reach', 'everything'],
					['area', 'trips']
				])
			)
		).toBeNull();
	});

	it('keeps only real areas, and an empty choice stays empty', () => {
		expect(
			areasFromForm(
				form([
					['reach', 'areas'],
					['area', 'trips'],
					['area', 'shared'],
					['area', 'nonsense']
				])
			)
		).toEqual(['trips']);
		expect(areasFromForm(form([['reach', 'areas']]))).toEqual([]);
	});

	// Read as "everything", a form missing its choice would issue or widen a
	// token to the whole household; the caller refuses it instead.
	it('says neither when the form chose neither', () => {
		expect(areasFromForm(form([['area', 'trips']]))).toBeUndefined();
		expect(
			areasFromForm(
				form([
					['reach', 'all'],
					['area', 'trips']
				])
			)
		).toBeUndefined();
	});

	it("says what a token reaches in the modules' own words", () => {
		expect(describeReach(null)).toBe('everything');
		expect(describeReach([])).toBe('nothing');
		expect(describeReach(['trips', 'ledger'])).toBe('Accounts & transactions, Trips');
	});
});
