// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reading a person's role periods with an organisation.
 *
 * A ROLE is what somebody is called; a RELATIONSHIP is how long the paperwork
 * has been arriving. A lane counts from the second, a card names the first.
 */
import { asc, eq } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { engagement } from '$lib/server/db/schema';

export interface EngagementRow {
	id: string;
	personId: string;
	role: string | null;
	startsOn: string | null;
	endsOn: string | null;
	documentId: string | null;
}

/** Every role period with this organisation, oldest first; undated ones lead. */
export async function engagementsFor(
	organisationId: string,
	handle: Queryable = db
): Promise<EngagementRow[]> {
	return handle
		.select({
			id: engagement.id,
			personId: engagement.personId,
			role: engagement.role,
			startsOn: engagement.startsOn,
			endsOn: engagement.endsOn,
			documentId: engagement.documentId
		})
		.from(engagement)
		.where(eq(engagement.organisationId, organisationId))
		.orderBy(asc(engagement.startsOn), asc(engagement.id));
}

/**
 * The span of the RELATIONSHIP, not of any one role.
 *
 * Earliest start across every period — a promotion must not move the beginning
 * forward, or years of expected filings drop out of the count silently.
 *
 * `endsOn` is set only once EVERY period has closed; null means "still going".
 */
export function engagementSpan(rows: readonly EngagementRow[]): {
	startsOn: string | null;
	endsOn: string | null;
} {
	const starts = rows.map((r) => r.startsOn).filter((day): day is string => day !== null);
	const ends = rows.map((r) => r.endsOn);
	const allClosed = rows.length > 0 && ends.every((day) => day !== null);
	return {
		startsOn: starts.length > 0 ? [...starts].sort()[0] : null,
		endsOn: allClosed ? [...(ends as string[])].sort().pop()! : null
	};
}

/**
 * The role period live today, or null once every one of them has closed.
 *
 * A period with no start runs from for ever — undated does not mean absent.
 */
export function currentEngagement(
	rows: readonly EngagementRow[],
	today: string
): EngagementRow | null {
	return (
		rows.find(
			(row) =>
				(row.startsOn === null || row.startsOn <= today) &&
				(row.endsOn === null || row.endsOn >= today)
		) ?? null
	);
}
