// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { monthlyTotals } from '$lib/server/salary/history';

const entry = (over: {
	periodMonth: string;
	currency?: string;
	grossMinor?: bigint | null;
	netMinor?: bigint | null;
	bonusMinor?: bigint | null;
}) => ({
	periodMonth: over.periodMonth,
	currency: over.currency ?? 'CZK',
	grossMinor: over.grossMinor ?? null,
	netMinor: over.netMinor ?? null,
	bonusMinor: over.bonusMinor ?? null
});

/** Face value: what conversion does is the third test's business, not the first two. */
const same = (amount: bigint) => amount;

describe('monthlyTotals', () => {
	// Two employers in one month are two rows, and what the person earned that
	// month is both of them. Taking either one would report one job and silently
	// drop the other.
	it('adds a month evidenced twice into one month', () => {
		const months = monthlyTotals(
			[
				entry({ periodMonth: '2026-07', grossMinor: 6_000_000n, netMinor: 4_260_000n }),
				entry({ periodMonth: '2026-07', grossMinor: 2_000_000n, netMinor: 1_420_000n })
			],
			same,
			'CZK'
		);
		expect(months).toEqual([
			{
				periodMonth: '2026-07',
				grossMinor: 8_000_000n,
				netMinor: 5_680_000n,
				bonusMinor: null
			}
		]);
	});

	// Null is "nobody said", and it is not zero. Summing it as zero would turn a
	// month with no net stated into a month that earned nothing net.
	it('leaves a figure nobody stated as null rather than as zero', () => {
		const [month] = monthlyTotals(
			[entry({ periodMonth: '2026-07', grossMinor: 6_000_000n })],
			same,
			'CZK'
		);
		expect(month.netMinor).toBeNull();
		expect(month.bonusMinor).toBeNull();
	});

	// A 2019 payslip restated at this morning's rate is a different number every
	// morning, so each month is converted at its OWN first day.
	it('converts each month at its own date', () => {
		const seen: { from: string; to: string; day: string }[] = [];
		const convert = (amount: bigint, from: string, to: string, day: string) => {
			seen.push({ from, to, day });
			return amount * 2n;
		};
		const months = monthlyTotals(
			[
				entry({ periodMonth: '2026-06', currency: 'EUR', netMinor: 100_000n }),
				entry({ periodMonth: '2026-07', currency: 'EUR', netMinor: 200_000n })
			],
			convert,
			'CZK'
		);
		expect(months.map((m) => m.netMinor)).toEqual([200_000n, 400_000n]);
		expect(seen).toEqual([
			{ from: 'EUR', to: 'CZK', day: '2026-06-01' },
			{ from: 'EUR', to: 'CZK', day: '2026-07-01' }
		]);
	});
});
