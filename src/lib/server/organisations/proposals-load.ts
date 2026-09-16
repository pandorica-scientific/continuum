// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What the lanes think, before anything is filed.
 *
 * Proposals are COMPUTED, never stored — a stored proposal goes stale the
 * moment a lane is edited or the document filed by hand. What IS stored is the
 * evidence (`accepted_count`/`corrected_count`), a fact about what happened.
 */
import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import { assignLane } from '$lib/server/documents/mutations';
import { SYSTEM_SHELF_KEYS } from '$lib/documents/shelves';
import { db, type Queryable } from '$lib/server/db';
import {
	document,
	documentLink,
	documentType,
	lane as laneTable,
	organisation,
	shelf,
	tag,
	tagLink
} from '$lib/server/db/schema';
import { attachDocument } from '$lib/server/documents/targets';
import { proposeFor, type ProposingLane } from '$lib/organisations/proposals';
import type { LaneCandidate } from '$lib/organisations/lane-match';
import { recordLaneOutcome } from './mutations';

export interface ProposalRow {
	documentId: string;
	documentName: string;
	typeLabel: string;
	addedOn: string;
	laneId: string;
	organisationId: string;
	organisationName: string;
	organisationEmoji: string;
	laneLabel: string;
}

/**
 * Documents on the Income & Tax shelf that no organisation has claimed.
 *
 * Deliberately narrow: a document already filed against an organisation has
 * an answer, and proposing a second would be arguing with it.
 */
async function unclaimedDocuments(
	handle: Queryable
): Promise<(LaneCandidate & { name: string; typeLabel: string; addedOn: string })[]> {
	const rows = await handle
		.select({
			id: document.id,
			name: document.name,
			type: document.type,
			typeLabel: documentType.label,
			addedOn: document.addedOn
		})
		.from(document)
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		.innerJoin(documentType, eq(documentType.key, document.type))
		.where(
			and(
				eq(shelf.key, SYSTEM_SHELF_KEYS.incomeTax),
				notExists(
					handle
						.select({ one: sql`1` })
						.from(documentLink)
						.innerJoin(organisation, eq(organisation.id, documentLink.targetId))
						.where(eq(documentLink.documentId, document.id))
				)
			)
		);
	if (rows.length === 0) return [];

	const tagRows = await handle
		.select({ documentId: tagLink.targetId, name: tag.name })
		.from(tagLink)
		.innerJoin(tag, eq(tag.id, tagLink.tagId))
		.where(
			inArray(
				tagLink.targetId,
				rows.map((r) => r.id)
			)
		);
	const tagsByDocument = new Map<string, string[]>();
	for (const row of tagRows) {
		tagsByDocument.set(row.documentId, [...(tagsByDocument.get(row.documentId) ?? []), row.name]);
	}
	return rows.map((row) => ({ ...row, tags: tagsByDocument.get(row.id) ?? [] }));
}

/** Every proposal the lanes would make, named the way a person reads them. */
export async function loadProposals(handle: Queryable = db): Promise<ProposalRow[]> {
	const documents = await unclaimedDocuments(handle);
	if (documents.length === 0) return [];

	const lanes = await handle
		.select({
			id: laneTable.id,
			organisationId: laneTable.entityId,
			organisationName: organisation.name,
			organisationEmoji: organisation.emoji,
			label: laneTable.label,
			conditions: laneTable.conditions,
			acceptedCount: laneTable.acceptedCount,
			correctedCount: laneTable.correctedCount,
			sortOrder: laneTable.sortOrder
		})
		.from(laneTable)
		.innerJoin(organisation, eq(organisation.id, laneTable.entityId));

	const byLane = new Map(lanes.map((l) => [l.id, l]));
	const byDocument = new Map(documents.map((d) => [d.id, d]));

	return proposeFor(documents, lanes as ProposingLane[]).flatMap((proposal) => {
		const lane = byLane.get(proposal.laneId);
		const doc = byDocument.get(proposal.documentId);
		if (!lane || !doc) return [];
		return [
			{
				documentId: doc.id,
				documentName: doc.name,
				typeLabel: doc.typeLabel,
				addedOn: doc.addedOn,
				laneId: lane.id,
				organisationId: lane.organisationId,
				organisationName: lane.organisationName,
				organisationEmoji: lane.organisationEmoji,
				laneLabel: lane.label
			}
		];
	});
}

/**
 * File the document where the lane said, and record that it was right.
 *
 * Link and evidence are one fact — writing the link without the count would
 * leave an always-right lane looking as though it had never proposed anything.
 */
export async function acceptProposal(
	documentId: string,
	laneId: string,
	organisationId: string,
	handle: Queryable = db
): Promise<{ ok: boolean; message?: string }> {
	const result = await attachDocument(organisationId, documentId, handle);
	if (!result.ok) return { ok: false, message: result.message };
	// The link AND the lane — linking without assigning would leave the
	// proposed cell as a gap.
	await assignLane(documentId, laneId, handle);
	await recordLaneOutcome(laneId, 'accepted', handle);
	return { ok: true };
}

/**
 * Refuse the proposal, and record that the lane was wrong.
 *
 * No link is written. What changes is the lane's standing — enough of these
 * and it stops proposing on its own.
 */
export async function dismissProposal(laneId: string, handle: Queryable = db): Promise<void> {
	await recordLaneOutcome(laneId, 'corrected', handle);
}
