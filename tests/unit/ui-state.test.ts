import { describe, expect, it } from 'vitest';
import { selectedDayForMonth, syncedDocumentState } from '$lib/ui/state';

describe('selectedDayForMonth', () => {
	it('clears a calendar selection that is absent from the next month', () => {
		expect(selectedDayForMonth('2026-01-31', ['2026-02-01', '2026-02-02'])).toBeNull();
	});

	it('keeps the selection when same-route data still contains that day', () => {
		expect(selectedDayForMonth('2026-02-02', ['2026-02-01', '2026-02-02'])).toBe('2026-02-02');
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
