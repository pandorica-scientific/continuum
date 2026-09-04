// SPDX-License-Identifier: AGPL-3.0-or-later
interface NetWorthHistoryPoint {
	day: string;
	valueMinor: bigint;
	currency: string;
}

export function deltaSinceMonthStart(
	currentMinor: bigint,
	currentCurrency: string,
	today: string,
	snapshots: NetWorthHistoryPoint[],
	convert: (amount: bigint, from: string, to: string, day: string) => bigint
): bigint | null {
	const monthStart = `${today.slice(0, 7)}-01`;
	const earlier = snapshots
		.filter((snapshot) => snapshot.day < today)
		.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
	// The month opened at the close of the one before it, so the baseline is the
	// last snapshot before monthStart. Reading the first snapshot *inside* the
	// month instead loses the delta entirely until the scheduler has run at
	// least once, misses the first day's own movement, and after any downtime
	// silently measures a shorter period than the label claims. An install with
	// no earlier month falls back to the oldest snapshot it has.
	const before = earlier.filter((snapshot) => snapshot.day < monthStart);
	const baseline = before.length > 0 ? before[before.length - 1] : earlier[0];
	if (!baseline) return null;
	return (
		currentMinor - convert(baseline.valueMinor, baseline.currency, currentCurrency, baseline.day)
	);
}

/**
 * How big this month's move is against the biggest month on record.
 *
 * The pill in the sidebar carries a fill, and the fill has to mean something.
 * A share of net worth is useless — a good month moves a fraction of a per
 * cent of a six-figure total, and the bar would never leave zero. A share of
 * the LARGEST monthly move the household has had is the comparison a person
 * actually makes: "is this a big month for us, or a quiet one".
 *
 * Returns 0–1, or null when there is nothing to compare against — one month of
 * history cannot say whether a month was big.
 */
export function deltaShareOfBiggest(
	currentDeltaMinor: bigint | null,
	monthlyDeltasMinor: readonly bigint[]
): number | null {
	if (currentDeltaMinor === null) return null;
	const abs = (v: bigint) => (v < 0n ? -v : v);
	const biggest = monthlyDeltasMinor.reduce((most, d) => (abs(d) > most ? abs(d) : most), 0n);
	if (biggest === 0n) return null;
	const share = Number(abs(currentDeltaMinor)) / Number(biggest);
	return Math.max(0, Math.min(1, share));
}

/**
 * Month-on-month change, from one snapshot per month in ascending order.
 *
 * The first month has nothing before it, so it produces no delta rather than a
 * delta equal to its own value — which would make the first month on record the
 * biggest one forever.
 */
export function monthlyDeltas(points: readonly { valueMinor: bigint }[]): bigint[] {
	return points.slice(1).map((point, i) => point.valueMinor - points[i].valueMinor);
}
