import { describe, expect, it } from 'vitest';
import { deltaSinceMonthStart } from '$lib/networth/history';

describe('deltaSinceMonthStart', () => {
	// The month opened at the close of the previous one. Measuring from the
	// first snapshot inside the month drops the first day's own movement.
	it('uses the last snapshot before the month began', () => {
		const delta = deltaSinceMonthStart(
			10_000n,
			'CZK',
			'2026-08-15',
			[
				{ day: '2026-07-31', valueMinor: 1_000n, currency: 'CZK' },
				{ day: '2026-08-10', valueMinor: 8_000n, currency: 'CZK' },
				{ day: '2026-08-01', valueMinor: 7_500n, currency: 'CZK' }
			],
			(amount) => amount
		);

		expect(delta).toBe(9_000n);
	});

	it('converts a historical snapshot from its stored currency at its own date', () => {
		const seen: string[] = [];
		const delta = deltaSinceMonthStart(
			30_000n,
			'CZK',
			'2026-08-15',
			[{ day: '2026-08-01', valueMinor: 1_000n, currency: 'EUR' }],
			(amount, from, to, day) => {
				seen.push(`${from}|${to}|${day}`);
				return amount * 25n;
			}
		);

		expect(delta).toBe(5_000n);
		expect(seen).toEqual(['EUR|CZK|2026-08-01']);
	});

	// On the 1st, and after any downtime, the month holds no snapshot yet. The
	// previous month's close is still the right baseline; returning null here
	// made the figure disappear from the sidebar and /overview instead.
	it('still reports a delta before this month has its own snapshot', () => {
		expect(
			deltaSinceMonthStart(
				10n,
				'CZK',
				'2026-08-15',
				[{ day: '2026-07-31', valueMinor: 9n, currency: 'CZK' }],
				(amount) => amount
			)
		).toBe(1n);
	});

	it('falls back to the oldest snapshot on an install with no earlier month', () => {
		expect(
			deltaSinceMonthStart(
				10_000n,
				'CZK',
				'2026-08-15',
				[{ day: '2026-08-03', valueMinor: 4_000n, currency: 'CZK' }],
				(amount) => amount
			)
		).toBe(6_000n);
	});

	it('returns null with no snapshot at all, and never compares today to itself', () => {
		expect(deltaSinceMonthStart(10n, 'CZK', '2026-08-15', [], (amount) => amount)).toBeNull();
		expect(
			deltaSinceMonthStart(
				10n,
				'CZK',
				'2026-08-15',
				[{ day: '2026-08-15', valueMinor: 9n, currency: 'CZK' }],
				(amount) => amount
			)
		).toBeNull();
	});
});
