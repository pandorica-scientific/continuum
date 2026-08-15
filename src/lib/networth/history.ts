export interface NetWorthHistoryPoint {
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
