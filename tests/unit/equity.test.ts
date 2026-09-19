// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
	addInterval,
	expandSchedule,
	grantSummary,
	heldUnits,
	trancheState,
	type TrancheFigures
} from '$lib/equity';

const tranche = (over: Partial<TrancheFigures>): TrancheFigures => ({
	id: 't',
	vestsOn: '2026-03-01',
	units: 100,
	settledOn: null,
	deliveredUnits: null,
	withheldUnits: null,
	soldUnits: 0,
	movedUnits: 0,
	forfeitedOn: null,
	onPayslip: false,
	...over
});

describe('addInterval', () => {
	it('steps months, quarters and years, clamping the day of month', () => {
		expect(addInterval('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
		expect(addInterval('2026-03-01', 'quarterly', 2)).toBe('2026-09-01');
		expect(addInterval('2026-03-01', 'yearly', 3)).toBe('2029-03-01');
	});
});

describe('expandSchedule', () => {
	it('splits an even schedule with the remainder on the last tranche', () => {
		const out = expandSchedule(400, {
			mode: 'even',
			firstVestOn: '2026-03-01',
			count: 4,
			interval: 'yearly'
		});
		expect(out).toEqual([
			{ vestsOn: '2026-03-01', units: 100 },
			{ vestsOn: '2027-03-01', units: 100 },
			{ vestsOn: '2028-03-01', units: 100 },
			{ vestsOn: '2029-03-01', units: 100 }
		]);
		const odd = expandSchedule(10, {
			mode: 'even',
			firstVestOn: '2026-01-01',
			count: 3,
			interval: 'monthly'
		});
		expect(odd.map((t) => t.units)).toEqual([3, 3, 4]);
	});
	it('puts the cliff fraction first, then splits the rest evenly after it', () => {
		const out = expandSchedule(400, {
			mode: 'cliff',
			cliffOn: '2027-03-01',
			cliffFraction: 0.25,
			count: 3,
			interval: 'yearly'
		});
		expect(out).toEqual([
			{ vestsOn: '2027-03-01', units: 100 },
			{ vestsOn: '2028-03-01', units: 100 },
			{ vestsOn: '2029-03-01', units: 100 },
			{ vestsOn: '2030-03-01', units: 100 }
		]);
	});
	it('returns a list as typed, sorted by date', () => {
		const out = expandSchedule(30, {
			mode: 'list',
			tranches: [
				{ vestsOn: '2027-01-01', units: 20 },
				{ vestsOn: '2026-01-01', units: 10 }
			]
		});
		expect(out.map((t) => t.vestsOn)).toEqual(['2026-01-01', '2027-01-01']);
	});
	it('refuses a list whose units do not add up to the grant', () => {
		expect(() =>
			expandSchedule(30, { mode: 'list', tranches: [{ vestsOn: '2026-01-01', units: 10 }] })
		).toThrow(/add up/);
	});
});

describe('trancheState and heldUnits', () => {
	it('is vested once the date has passed or a settlement is recorded', () => {
		expect(trancheState(tranche({}), '2026-03-01')).toBe('vested');
		expect(trancheState(tranche({}), '2026-02-28')).toBe('pending');
		expect(
			trancheState(tranche({ vestsOn: '2099-01-01', settledOn: '2026-05-01' }), '2026-06-01')
		).toBe('vested');
	});
	it('is forfeited whatever the date says', () => {
		expect(trancheState(tranche({ forfeitedOn: '2026-01-01' }), '2027-01-01')).toBe('forfeited');
	});
	it('holds delivered units less sold, or scheduled units when nothing was recorded', () => {
		expect(heldUnits(tranche({}))).toBe(100);
		expect(heldUnits(tranche({ deliveredUnits: 62, withheldUnits: 38, soldUnits: 12 }))).toBe(50);
		expect(heldUnits(tranche({ forfeitedOn: '2026-01-01' }))).toBe(0);
	});
});

describe('grantSummary', () => {
	it('adds up vested, held, pending and forfeited, and names the next vest', () => {
		const s = grantSummary(
			[
				tranche({ id: 'a', vestsOn: '2026-03-01', deliveredUnits: 62, withheldUnits: 38 }),
				tranche({ id: 'b', vestsOn: '2027-03-01' }),
				tranche({ id: 'c', vestsOn: '2028-03-01' }),
				tranche({ id: 'd', vestsOn: '2029-03-01', forfeitedOn: '2026-08-01' })
			],
			'2026-09-15'
		);
		expect(s).toEqual({
			vestedUnits: 100,
			heldUnits: 62,
			pendingUnits: 200,
			forfeitedUnits: 100,
			nextVest: { vestsOn: '2027-03-01', units: 100 }
		});
	});
	it('has no next vest when everything has vested', () => {
		expect(grantSummary([tranche({})], '2030-01-01').nextVest).toBeNull();
	});
});

describe('expandSchedule refuses to lose units', () => {
	it('rejects a cliff schedule with no tranches after the cliff', () => {
		expect(() =>
			expandSchedule(400, {
				mode: 'cliff',
				cliffOn: '2026-03-01',
				cliffFraction: 0.25,
				count: 0,
				interval: 'yearly'
			})
		).toThrow(/at least one tranche/);
	});
	it('rejects a list that does not add up', () => {
		expect(() =>
			expandSchedule(400, { mode: 'list', tranches: [{ vestsOn: '2026-03-01', units: 100 }] })
		).toThrow(/add up to 100/);
	});
});
