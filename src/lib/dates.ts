// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Arithmetic on plain ISO dates.
 *
 * Every date this product stores is a `YYYY-MM-DD` with no time and no zone: a
 * statement period, a document's expiry, the day a bank booked a movement. The
 * calendar is the only place a real instant appears.
 *
 * Parsed at UTC midnight deliberately. Feeding `Date.parse` a bare `2026-03-29`
 * is UTC already, but the moment anything appends a local time the spring
 * forward makes one day 23 hours long and a difference come back one short.
 * Naming the zone costs nothing and removes the class.
 */

/** Milliseconds in a day, at UTC where every day has the same number of them. */
const MS_PER_DAY = 86_400_000;

/** Whole days from one ISO date to another. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	return Math.round((b - a) / MS_PER_DAY);
}

/**
 * Today as the wall clock reads it, `YYYY-MM-DD`.
 *
 * `toISOString()` is the UTC day, which is yesterday every evening east of
 * Greenwich; a statement dated today then measured as a day in the future.
 */
export function localToday(now: Date = new Date()): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}
