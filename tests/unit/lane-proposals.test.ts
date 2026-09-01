// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What the lanes would claim, before anything is filed.
 *
 * Every rule here is a refusal, and each one is the same argument: a MISSING
 * link is visible and a WRONG one is not. A document nothing claimed sits in
 * the proposals list where somebody will see it; a document filed against the
 * wrong employer looks exactly like one filed against the right one, and nobody
 * re-reads a link that seems fine.
 */
import { describe, expect, it } from 'vitest';
import { proposeFor, type ProposingLane } from '$lib/organisations/proposals';
import type { LaneCandidate } from '$lib/organisations/lane-match';

const doc = (over: Partial<LaneCandidate> = {}): LaneCandidate => ({
	id: over.id ?? 'd1',
	name: over.name ?? 'Payslip 2026-08',
	type: over.type ?? 'payslip',
	tags: over.tags ?? []
});

const lane = (over: Partial<ProposingLane> = {}): ProposingLane => ({
	id: over.id ?? 'l1',
	organisationId: over.organisationId ?? 'org-a',
	conditions: over.conditions ?? [{ field: 'type', op: 'is', value: 'payslip' }],
	acceptedCount: over.acceptedCount ?? 0,
	correctedCount: over.correctedCount ?? 0,
	sortOrder: over.sortOrder ?? 0
});

describe('proposeFor', () => {
	it('proposes the one organisation whose lane claims the document', () => {
		expect(proposeFor([doc()], [lane()])).toEqual([
			{ documentId: 'd1', laneId: 'l1', organisationId: 'org-a' }
		]);
	});

	it('proposes nothing when two organisations both claim it', () => {
		// Two employers whose lanes both take a payslip. Guessing between them is
		// worse than asking: the document stays visible either way, and only one
		// of the two outcomes is quietly wrong.
		const proposals = proposeFor(
			[doc()],
			[lane({ id: 'l1', organisationId: 'org-a' }), lane({ id: 'l2', organisationId: 'org-b' })]
		);
		expect(proposals).toEqual([]);
	});

	it('is not troubled by two lanes of the same organisation', () => {
		// "Which organisation" has one answer here, which is the only question a
		// proposal asks. The earlier lane takes it, as a card partitions.
		const proposals = proposeFor(
			[doc()],
			[lane({ id: 'second', sortOrder: 10 }), lane({ id: 'first', sortOrder: 0 })]
		);
		expect(proposals).toEqual([{ documentId: 'd1', laneId: 'first', organisationId: 'org-a' }]);
	});

	it('says nothing from a lane that keeps being wrong', () => {
		// It falls silent on its own. Nobody has to notice a bad lane and disable
		// it — which is the only way a rule nobody is watching stops doing damage.
		expect(proposeFor([doc()], [lane({ acceptedCount: 1, correctedCount: 2 })])).toEqual([]);
		// Corrected as often as accepted is still trusted: one bad call does not
		// retire a lane that is otherwise right.
		expect(proposeFor([doc()], [lane({ acceptedCount: 2, correctedCount: 2 })])).toHaveLength(1);
	});

	it('says nothing from a lane that names no conditions', () => {
		// Claiming everything is right for sorting what is already filed against
		// an organisation and catastrophic for deciding what to file: the
		// no-cadence lane would take every unfiled document in the archive.
		expect(proposeFor([doc()], [lane({ conditions: [] })])).toEqual([]);
	});

	it('leaves a document no lane claims alone', () => {
		expect(proposeFor([doc({ type: 'receipt' })], [lane()])).toEqual([]);
	});

	it('proposes at most once per document', () => {
		const proposals = proposeFor(
			[doc({ id: 'a' }), doc({ id: 'b' })],
			[lane({ id: 'l1', sortOrder: 0 }), lane({ id: 'l2', sortOrder: 5 })]
		);
		expect(proposals.map((p) => p.documentId)).toEqual(['a', 'b']);
	});
});
