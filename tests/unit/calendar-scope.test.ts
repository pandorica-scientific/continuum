import { describe, expect, it } from 'vitest';
import { planScopeChange } from '$lib/calendar/scope';

const WEEKLY = 'FREQ=WEEKLY;BYDAY=TU';
const OCCURRENCE = '2026-09-15T09:00:00.000Z';

describe('edit scope planning', () => {
	it("'this' writes one exception and leaves the series alone", () => {
		expect(planScopeChange('this', WEEKLY, OCCURRENCE)).toEqual({
			kind: 'exception',
			recurrenceId: OCCURRENCE
		});
	});

	it("'all' rewrites the series in place", () => {
		expect(planScopeChange('all', WEEKLY, OCCURRENCE)).toEqual({ kind: 'series' });
	});

	// 'following' is NOT an exception, and modelling it as one desynchronises on
	// the first pass: the remote goes on believing the original series still owns
	// every occurrence after the split, so the ones we "moved" come straight back.
	// The original is truncated and a second series starts at the split.
	it("'following' truncates the original with UNTIL and starts a new series", () => {
		const plan = planScopeChange('following', WEEKLY, OCCURRENCE);
		expect(plan).toEqual({
			kind: 'split',
			// One second before the split occurrence: UNTIL is inclusive, so using
			// the occurrence itself would leave it in the old series as well as the
			// new one — the same event twice, on the same day.
			truncatedRrule: 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20260915T085959Z',
			newSeriesStart: OCCURRENCE
		});
	});

	it("'following' replaces an UNTIL the rule already had", () => {
		const plan = planScopeChange('following', `${WEEKLY};UNTIL=20271231T090000Z`, OCCURRENCE);
		expect(plan.kind).toBe('split');
		const rule = (plan as { truncatedRrule: string }).truncatedRrule;
		expect(rule).toContain('UNTIL=20260915T085959Z');
		expect(rule).not.toContain('20271231');
	});

	// RFC 5545 forbids COUNT and UNTIL in the same rule. Truncating a counted
	// series has to drop the count, or the rule is invalid and a strict server
	// rejects the whole event.
	it("'following' drops COUNT when it adds UNTIL", () => {
		const plan = planScopeChange('following', `${WEEKLY};COUNT=10`, OCCURRENCE);
		const rule = (plan as { truncatedRrule: string }).truncatedRrule;
		expect(rule).toContain('UNTIL=');
		expect(rule).not.toContain('COUNT');
	});

	// Nothing to except and nothing to split when there is only one occurrence.
	it('treats every scope as a plain edit on a non-recurring event', () => {
		for (const scope of ['this', 'following', 'all'] as const) {
			expect(planScopeChange(scope, null, OCCURRENCE)).toEqual({ kind: 'series' });
			expect(planScopeChange(scope, '', OCCURRENCE)).toEqual({ kind: 'series' });
		}
	});

	// Splitting at the very first occurrence would leave the original series with
	// no occurrences at all — an empty husk the sync engine still has to carry.
	// Editing from the start is the same as editing the whole series.
	it('treats a split at the first occurrence as editing the whole series', () => {
		expect(planScopeChange('following', WEEKLY, OCCURRENCE, OCCURRENCE)).toEqual({
			kind: 'series'
		});
	});
});
