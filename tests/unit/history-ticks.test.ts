// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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

	it('has no labels for an empty history', () => {
		expect(historyTicks([])).toEqual({ unit: 'month', labels: [] });
	});
});
