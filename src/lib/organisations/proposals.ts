// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which organisation a document probably belongs to.
 *
 * The same conditions a lane uses to partition what is ALREADY linked, now
 * asked a harder question: what should be linked at all. Two rules make that
 * safe, and both are refusals.
 *
 * AMBIGUITY PROPOSES NOTHING. A document matching lanes on two different
 * organisations is left alone. A missing link is visible — the document sits in
 * the proposals list, or unclaimed at the foot of a card — while a wrong one
 * looks exactly like a right one, and nobody re-reads a link that seems fine.
 *
 * A LANE WITH NO CONDITIONS PROPOSES NOTHING. Claiming everything is correct
 * for sorting what is already filed against an organisation, and catastrophic
 * for deciding what to file: the `Changes to pay` lane would take every
 * unfiled document in the archive.
 */
import { matchesLane, type LaneCandidate } from './lane-match';

export interface ProposingLane {
	id: string;
	organisationId: string;
	conditions: unknown;
	acceptedCount: number;
	correctedCount: number;
	sortOrder: number;
}

export interface Proposal {
	documentId: string;
	laneId: string;
	organisationId: string;
}

/** Trusted while corrections have not outnumbered acceptances. */
const trusted = (lane: ProposingLane): boolean => lane.correctedCount <= lane.acceptedCount;

/** A lane that names no conditions claims everything, so it may propose nothing. */
const canPropose = (lane: ProposingLane): boolean =>
	Array.isArray(lane.conditions) && lane.conditions.length > 0 && trusted(lane);

/**
 * What the lanes would claim, for documents nothing has claimed yet.
 *
 * One proposal per document at most. Two lanes of the SAME organisation is not
 * ambiguous — the answer to "which organisation" is unambiguous either way, and
 * the earlier lane in `sortOrder` takes it, exactly as a card partitions.
 */
export function proposeFor(
	documents: readonly LaneCandidate[],
	lanes: readonly ProposingLane[]
): Proposal[] {
	const usable = [...lanes].filter(canPropose).sort((a, b) => a.sortOrder - b.sortOrder);
	const proposals: Proposal[] = [];

	for (const doc of documents) {
		const hits = usable.filter((lane) => matchesLane(doc, lane.conditions));
		if (hits.length === 0) continue;
		const organisations = new Set(hits.map((lane) => lane.organisationId));
		if (organisations.size > 1) continue;
		proposals.push({
			documentId: doc.id,
			laneId: hits[0].id,
			organisationId: hits[0].organisationId
		});
	}
	return proposals;
}
