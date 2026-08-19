// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { convertMinorSync, convertOrFace, type RateTable } from '$lib/server/fx/table';

/** One account conversion for both display and arithmetic. The exact value is
 * nullable so the row can show a warning, while totals always use the same
 * face-value fallback advertised by the app-wide missing-rate banner. */
export function accountBalanceInBase(
	rates: RateTable,
	amountMinor: bigint,
	from: string,
	to: string,
	day: string
): { exactMinor: bigint | null; totalMinor: bigint } {
	return {
		exactMinor: convertMinorSync(rates, amountMinor, from, to, day),
		totalMinor: convertOrFace(rates, amountMinor, from, to, day)
	};
}
