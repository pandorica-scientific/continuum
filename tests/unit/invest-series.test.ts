// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seriesFor } from '$lib/invest/series';
import { markedTail } from '$lib/server/invest/series';

describe('holding colours', () => {
	it('gives each holding one colour, in list order, and repeats after the palette', () => {
		const color = seriesFor(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
		expect(color('A')).toBe('--teal');
		expect(color('B')).toBe('--blue');
		expect(color('H')).toBe('--teal');
	});
	it('answers the same for the pie and the table', () => {
		const color = seriesFor(['VWCE', 'CSPX']);
		expect(color('CSPX')).toBe(color('CSPX'));
		expect(color('nowhere')).toBe('--fg3');
	});
});

describe('markedTail', () => {
	const prices = new Map([
		[
			'ACME.US',
			[
				{ day: '2026-06-02', closeMinor: 10000n, currency: 'EUR' },
				{ day: '2026-06-04', closeMinor: 11000n, currency: 'EUR' }
			]
		],
		['VWCE.DE', [{ day: '2026-06-01', closeMinor: 5000n, currency: 'EUR' }]]
	]);
	it('values units at each day, carrying a close forward across days without one', () => {
		const out = markedTail(
			{
				holdings: [
					{ ticker: 'ACME.US', units: 2 },
					{ ticker: 'VWCE.DE', units: 10 }
				],
				prices,
				lastSnapshotDay: '2026-06-01',
				today: '2026-06-05',
				convert: (m) => m
			},
			'EUR'
		);
		expect(out).toEqual([
			{ day: '2026-06-02', valueMinor: 2n * 10000n + 10n * 5000n },
			{ day: '2026-06-03', valueMinor: 2n * 10000n + 10n * 5000n },
			{ day: '2026-06-04', valueMinor: 2n * 11000n + 10n * 5000n },
			{ day: '2026-06-05', valueMinor: 2n * 11000n + 10n * 5000n }
		]);
	});
	it('starts only once every holding has a close', () => {
		const out = markedTail(
			{
				holdings: [
					{ ticker: 'ACME.US', units: 1 },
					{ ticker: 'VWCE.DE', units: 1 }
				],
				prices: new Map([
					['ACME.US', [{ day: '2026-06-03', closeMinor: 100n, currency: 'EUR' }]],
					['VWCE.DE', [{ day: '2026-06-02', closeMinor: 50n, currency: 'EUR' }]]
				]),
				lastSnapshotDay: '2026-06-01',
				today: '2026-06-03',
				convert: (m) => m
			},
			'EUR'
		);
		expect(out.map((p) => p.day)).toEqual(['2026-06-03']);
	});
	it('converts from the currency the close was quoted in, and skips a day with no rate', () => {
		const out = markedTail(
			{
				holdings: [{ ticker: 'ACME.US', units: 3 }],
				prices: new Map([['ACME.US', [{ day: '2026-06-01', closeMinor: 1000n, currency: 'USD' }]]]),
				lastSnapshotDay: '2026-06-01',
				today: '2026-06-03',
				convert: (m, from, day) => (day === '2026-06-02' ? null : from === 'USD' ? m / 2n : m)
			},
			'EUR'
		);
		expect(out).toEqual([{ day: '2026-06-03', valueMinor: 1500n }]);
	});
	it('is empty when there is nothing after the snapshot', () => {
		expect(
			markedTail(
				{
					holdings: [],
					prices,
					lastSnapshotDay: '2026-06-05',
					today: '2026-06-05',
					convert: (m) => m
				},
				'EUR'
			)
		).toEqual([]);
	});
});
