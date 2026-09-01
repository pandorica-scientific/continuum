// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which documents a lane holds.
 *
 * Pure, and worth holding by test because two of its rules are the kind that
 * look like details and are not: conditions are ANDed, and a lane naming no
 * conditions claims everything — which is what makes a no-cadence lane at the
 * end of the list mean "whatever the others did not take".
 */
import { describe, expect, it } from 'vitest';
import { matchesLane, type Condition, type LaneCandidate } from '$lib/organisations/lane-match';

const doc = (over: Partial<LaneCandidate> = {}): LaneCandidate => ({
	id: over.id ?? 'd1',
	name: over.name ?? 'A document',
	type: over.type ?? 'other',
	tags: over.tags ?? []
});

describe('matchesLane', () => {
	it('claims a document whose type the lane names', () => {
		const conditions: Condition[] = [{ field: 'type', op: 'is', value: 'payslip' }];
		expect(matchesLane(doc({ type: 'payslip' }), conditions)).toBe(true);
		expect(matchesLane(doc({ type: 'invoice' }), conditions)).toBe(false);
	});

	it('ANDs its conditions, never ORs them', () => {
		// A lane with two conditions is NARROWER than one with either, which is
		// the only reading that makes adding a second condition worth doing.
		const conditions: Condition[] = [
			{ field: 'type', op: 'is', value: 'tax_document' },
			{ field: 'tag', op: 'is', value: '2025' }
		];
		expect(matchesLane(doc({ type: 'tax_document', tags: ['2025'] }), conditions)).toBe(true);
		expect(matchesLane(doc({ type: 'tax_document', tags: ['2024'] }), conditions)).toBe(false);
		expect(matchesLane(doc({ type: 'payslip', tags: ['2025'] }), conditions)).toBe(false);
	});

	it('claims everything when it names no conditions', () => {
		// A no-cadence lane is where paper with no rhythm gathers, and "everything
		// else filed here" is exactly what it is for.
		expect(matchesLane(doc({ type: 'contract' }), [])).toBe(true);
	});

	it('matches a name case-insensitively, as a substring', () => {
		const conditions: Condition[] = [{ field: 'name', op: 'contains', value: 'zúčtování' }];
		expect(matchesLane(doc({ name: 'Roční Zúčtování 2025' }), conditions)).toBe(true);
		expect(matchesLane(doc({ name: 'Payslip' }), conditions)).toBe(false);
	});

	it('matches a tag the same way', () => {
		expect(
			matchesLane(doc({ tags: ['Employer Report'] }), [
				{ field: 'tag', op: 'contains', value: 'report' }
			])
		).toBe(true);
	});

	it('fails closed on a field it does not understand', () => {
		// Conditions are jsonb and the next release adds fields to them. A lane
		// written by a newer version must not silently claim EVERYTHING on an
		// older one — which is what an unknown condition treated as "no opinion"
		// would do.
		expect(
			matchesLane(doc({ type: 'payslip' }), [
				{ field: 'text' as never, op: 'is', value: 'anything' }
			])
		).toBe(false);
	});

	it('fails closed on malformed stored conditions', () => {
		// It comes out of jsonb, so it is whatever was written — including by an
		// older or newer version of this code.
		expect(matchesLane(doc(), 'not an array' as never)).toBe(false);
		expect(matchesLane(doc(), [{ nonsense: true } as never])).toBe(false);
	});
});
