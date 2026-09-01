// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reading a person's role periods with an organisation.
 *
 * The two derived answers live here rather than in the component that draws
 * them, because both are easy to get subtly wrong and both turn on the same
 * distinction: a ROLE is what somebody is called, a RELATIONSHIP is how long
 * the paperwork has been arriving. A lane counts from the second and a card
 * names the first.
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
 * The earliest start across every period, because a promotion must not move the
 * beginning forward: a lane counting expected filings from 2021 rather than
 * 2018 would drop three years of missing paperwork out of the count without
 * anything saying so.
 *
 * `endsOn` only once EVERY period has closed. One open period means the
 * relationship is current whatever the others say, so the answer is null — and
 * null here means "still going", not "unknown".
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
 * What the person is called there today, or null once it is all history.
 *
 * A period with no start runs from for ever: an authority a household has
 * always dealt with is current, not undated-and-therefore-absent.
 */
export function currentRole(rows: readonly EngagementRow[], today: string): string | null {
	const live = rows.find(
		(row) =>
			(row.startsOn === null || row.startsOn <= today) &&
			(row.endsOn === null || row.endsOn >= today)
	);
	return live?.role ?? null;
}
