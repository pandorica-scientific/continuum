// SPDX-License-Identifier: AGPL-3.0-or-later
interface TenancyDateRange {
	startsOn: string | null;
	endsOn: string | null;
}

interface PropertyTenancyRange extends TenancyDateRange {
	id: string;
	propertyId: string;
}

/** Inclusive date ranges; null means unbounded on that side. */
export function tenancyRangesOverlap(a: TenancyDateRange, b: TenancyDateRange): boolean {
	return (
		(a.endsOn === null || b.startsOn === null || b.startsOn <= a.endsOn) &&
		(b.endsOn === null || a.startsOn === null || a.startsOn <= b.endsOn)
	);
}

function isActive(range: TenancyDateRange, today: string): boolean {
	return (
		(range.startsOn === null || range.startsOn <= today) &&
		(range.endsOn === null || range.endsOn >= today)
	);
}

/**
 * One current lease per property. The owner-locking writer prevents new
 * overlaps; latest start then lexical id gives deterministic behavior for
 * legacy duplicates that already exist.
 */
export function activeTenanciesByProperty<T extends PropertyTenancyRange>(
	tenancies: T[],
	today: string
): Map<string, T> {
	const active = new Map<string, T>();
	for (const candidate of tenancies) {
		if (!isActive(candidate, today)) continue;
		const existing = active.get(candidate.propertyId);
		const candidateStart = candidate.startsOn ?? '';
		const existingStart = existing?.startsOn ?? '';
		if (
			!existing ||
			candidateStart > existingStart ||
			(candidateStart === existingStart && candidate.id < existing.id)
		) {
			active.set(candidate.propertyId, candidate);
		}
	}
	return active;
}
