import { describe, expect, it } from 'vitest';
import { selectedDayForMonth, syncedDocumentState } from '$lib/ui/state';

describe('selectedDayForMonth', () => {
	const february = ['2026-02-01', '2026-02-02', '2026-02-03'];

	it('keeps the selection when same-route data still contains that day', () => {
		expect(selectedDayForMonth('2026-02-02', february)).toBe('2026-02-02');
	});

	// The agenda shows one day, never a whole month: a month-long list scrolls
	// past whatever is actually next, so nobody reads it.
	it('falls to today when the selection is absent from the new month', () => {
		expect(selectedDayForMonth('2026-01-31', february, '2026-02-03')).toBe('2026-02-03');
	});

	it('opens on today when nothing is selected yet', () => {
		expect(selectedDayForMonth(null, february, '2026-02-02')).toBe('2026-02-02');
	});

	// Paging to another month: today is not in it, so the month opens on its
	// first day rather than on nothing at all.
	it('falls to the first of the month when today is elsewhere', () => {
		expect(selectedDayForMonth(null, february, '2026-07-14')).toBe('2026-02-01');
	});

	it('never returns nothing while the month has days', () => {
		expect(selectedDayForMonth(null, february)).toBe('2026-02-01');
	});

	it('returns nothing only when there are no days at all', () => {
		expect(selectedDayForMonth(null, [], '2026-02-01')).toBeNull();
	});
});

describe('syncedDocumentState', () => {
	it('adopts query and prefill data after history navigation', () => {
		expect(syncedDocumentState({ query: 'passport', prefillOpen: true })).toEqual({
			query: 'passport',
			adding: true
		});
	});
});
