// SPDX-License-Identifier: AGPL-3.0-or-later
// What each kind of organisation is expected to send, before a household has
// touched it. Seeds, not rules — but a wrong seed is on every card made from
// the day it ships, so the shape is worth holding.
import { describe, expect, it } from 'vitest';
import { ENUMS } from '$lib/enums';
import { attachmentKind } from '$lib/tax';
import { matchesLane } from '$lib/organisations/lane-match';
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

describe('broker organisations', () => {
	it('is a kind an organisation may be', () => {
		expect(ENUMS['organisation.kind']).toContain('broker');
	});

	// The TAG, not the type. A broker report filed from the Tax screen is a
	// `tax_document` — `attachDocumentsToStatement` files every attachment as
	// one, and the tax year card depends on that — so a lane keyed to
	// `type = broker_report` could never claim the very paper it exists for.
	// The tag says what the paper IS; the type is pinned by what the tax year
	// card needs.
	it('seeds a yearly lane that claims broker reports by their tag', () => {
		expect(LANE_PRESETS.broker[0]).toEqual({
			label: 'Annual report',
			cadence: 'yearly',
			conditions: [{ field: 'tag', op: 'is', value: 'broker report' }]
		});
	});

	it('claims the tag the Tax screen actually applies', () => {
		expect(LANE_PRESETS.broker[0].conditions[0].value).toBe(attachmentKind('broker').tag);
	});

	it('claims a report filed from either route', () => {
		const lane = LANE_PRESETS.broker[0].conditions;
		// From the Tax screen: a tax_document carrying the attachment's tag.
		expect(
			matchesLane({ id: 'a', name: 'r', type: 'tax_document', tags: ['broker report'] }, lane)
		).toBe(true);
		// From Investments: a broker_report carrying the same tag.
		expect(
			matchesLane(
				{ id: 'b', name: 'r', type: 'broker_report', tags: ['xtb', '2026', 'broker report'] },
				lane
			)
		).toBe(true);
		// A payslip filed against the same card is not a broker's report.
		expect(matchesLane({ id: 'c', name: 'p', type: 'payslip', tags: [] }, lane)).toBe(false);
	});

	// Last and matching everything, the same shape every other kind ends with.
	it('ends with a catch-all lane so nothing on the card is homeless', () => {
		const lanes = LANE_PRESETS.broker;
		expect(lanes[lanes.length - 1].conditions).toEqual([]);
	});

	// `other` seeds nothing on purpose — a kind with no rhythm gets wrong lanes.
	it('leaves `other` seeding nothing', () => {
		expect(LANE_PRESETS.other).toEqual([]);
	});
});
