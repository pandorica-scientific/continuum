// SPDX-License-Identifier: AGPL-3.0-or-later
// What a scan is called before anyone names it.

/**
 * A dated default, from a timestamp rather than a clock.
 *
 * Taking the time as an argument keeps this pure — testable without freezing a
 * clock — and keeps `Date` out of the rune module that calls it, where a
 * mutable instance would be a reactivity hazard rather than a convenience.
 */
export function defaultFilename(at: number): string {
	return `Scan ${new Date(at).toISOString().slice(0, 10)}`;
}
