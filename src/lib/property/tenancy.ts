export interface TenancyDateRange {
	startDate: string | null;
	endDate: string | null;
}

export interface PropertyTenancyRange extends TenancyDateRange {
	id: string;
	propertyId: string;
}

/** Inclusive date ranges; null means unbounded on that side. */
export function tenancyRangesOverlap(a: TenancyDateRange, b: TenancyDateRange): boolean {
	return (
		(a.endDate === null || b.startDate === null || b.startDate <= a.endDate) &&
		(b.endDate === null || a.startDate === null || a.startDate <= b.endDate)
	);
}

function isActive(range: TenancyDateRange, today: string): boolean {
	return (
		(range.startDate === null || range.startDate <= today) &&
		(range.endDate === null || range.endDate >= today)
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
		const candidateStart = candidate.startDate ?? '';
		const existingStart = existing?.startDate ?? '';
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
