// SPDX-License-Identifier: AGPL-3.0-or-later
// What each kind of organisation is expected to send, before a household has
// touched it. Seeds, not rules — but a wrong seed is on every card made from
// the day it ships, so the shape is worth holding.
import { describe, expect, it } from 'vitest';
import { LANE_PRESETS } from '$lib/server/organisations/mutations';

describe('LANE_PRESETS', () => {
	// The complaint this release answers: an annual return is one filing per
	// person per year, not one per employer. A year worked at two companies is
	// filed once, and two cards each drawing a missing 2025 were two alarms for
	// one obligation. It lives on the tax year card instead.
	it('gives an employer no yearly lane', () => {
		expect(LANE_PRESETS.employer.some((lane) => lane.cadence === 'yearly')).toBe(false);
	});

	it('leaves an employer with payslips and a catch-all', () => {
		expect(LANE_PRESETS.employer.map((lane) => lane.label)).toEqual(['Payslips', 'Contract & HR']);
	});

	// Lanes are tried in order, so the catch-all has to be last or it claims
	// everything before the payslip lane is reached.
	it('keeps the catch-all last and unconditional', () => {
		const last = LANE_PRESETS.employer[LANE_PRESETS.employer.length - 1];
		expect(last.conditions).toEqual([]);
		expect(last.cadence).toBe('none');
	});

	// An authority really does expect one filing a year, and a household that
	// files against the tax office is not made wrong by this release.
	it('leaves an authority its yearly return', () => {
		expect(LANE_PRESETS.authority.some((lane) => lane.cadence === 'yearly')).toBe(true);
	});
});
