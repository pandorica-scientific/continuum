// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { historyTicks } from '$lib/charts/ticks';

function span(start: string, count: number): string[] {
	const [y, m] = start.split('-').map(Number);
	return Array.from({ length: count }, (_, i) => {
		const total = y * 12 + (m - 1) + i;
		return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
	});
}

describe('historyTicks', () => {
	it('labels every month on a short history', () => {
		expect(historyTicks(span('2026-05', 3))).toEqual({
			unit: 'month',
			labels: ['05', '06', '07']
		});
	});

	it('still labels months just below the threshold', () => {
		const ticks = historyTicks(span('2025-01', 23));
		expect(ticks.unit).toBe('month');
		expect(ticks.labels).toHaveLength(23);
	});

	it('switches to years at the threshold', () => {
		expect(historyTicks(span('2025-01', 24))).toEqual({ unit: 'year', labels: ['2025', '2026'] });
	});

	it('lists each year once on a long history', () => {
		expect(historyTicks(span('2023-01', 40)).labels).toEqual(['2023', '2024', '2025', '2026']);
	});

	it('repeats a month label once the history passes a year', () => {
		// "01" comes round again every twelve months. The axis is keyed by
		// position for exactly this reason: keying a Svelte each block on the
		// label would throw `each_key_duplicate` and blank the whole screen.
		const ticks = historyTicks(span('2025-01', 14));
		expect(ticks.unit).toBe('month');
		expect(ticks.labels.filter((l) => l === '01')).toHaveLength(2);
	});

	it('has no labels for an empty history', () => {
		expect(historyTicks([])).toEqual({ unit: 'month', labels: [] });
	});
});
