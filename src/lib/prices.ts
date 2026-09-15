// SPDX-License-Identifier: AGPL-3.0-or-later
/** Is a close dated `day` too old to trust, given the configured tolerance in days? */
export function isStale(day: string | null, today: string, staleAfterDays: number): boolean {
	if (day === null) return true;
	const ms = Date.parse(today) - Date.parse(day);
	return ms / 86_400_000 > staleAfterDays;
}
