// SPDX-License-Identifier: AGPL-3.0-or-later
// The three-way merge. This is where sync correctness lives.
//
// Pure by design: no network, no database, no clock, no imports beyond a type.
// Everything genuinely risky about two-way sync is decided here, which means it
// can be exhaustively table-tested in milliseconds instead of against a real
// Google account. The adapters stay thin and I/O-shaped; this stays reasoned
// about.

import { bindingIsWritable, type OriginBinding } from '$lib/calendar/keys';

export interface MergeInput {
	/** What we last successfully sent. Null if this pair has never synced. */
	baseHash: string | null;
	/** Current local content, or null if deleted here. */
	localHash: string | null;
	/** Current remote content, or null if deleted there. */
	remoteHash: string | null;
	localUpdatedAt: string;
	remoteUpdatedAt: string;
	/** Whether the ledger generated this event rather than a person authoring it. */
	generated: boolean;
	/** Whether the remote differs from what we pushed in start/end ONLY. */
	dateOnlyChange: boolean;
	/** The date the remote moved it to, when dateOnlyChange. */
	newDate: string | null;
	binding: OriginBinding | null;
}

export type MergeOutcome =
	| { kind: 'noop' }
	| { kind: 'push' }
	| { kind: 'apply' }
	| { kind: 'push-delete' }
	| { kind: 'apply-delete' }
	| { kind: 'drop-link' }
	| { kind: 'suppress' }
	| { kind: 'conflict'; winner: 'local' | 'remote' }
	| { kind: 'write-back'; field: string; value: string };

export function merge(input: MergeInput): MergeOutcome {
	const { baseHash, localHash, remoteHash } = input;

	const localChanged = localHash !== baseHash;
	const remoteChanged = remoteHash !== baseHash;

	// Nothing anywhere, or nothing moved. Checked first so a never-synced pair
	// with nothing on either side is quiet rather than a conflict.
	if (!localChanged && !remoteChanged) return { kind: 'noop' };

	// ---- generated events -----------------------------------------------------
	// The ledger owns their content: it is recomputed from loans, tenancies and
	// documents, so "what the remote says" cannot be authoritative about it.
	if (input.generated) {
		if (remoteHash === null && baseHash !== null) {
			// Deleted on the remote after we had pushed it. Honour it: re-creating
			// the event next pass would be the app overruling a deliberate act.
			// Suppression is visible in the app and reversible from there.
			return localHash === null ? { kind: 'drop-link' } : { kind: 'suppress' };
		}
		if (localHash === null) {
			// Fell off the trailing edge of the rolling horizon. Stop tracking it and
			// LEAVE THE REMOTE COPY ALONE: the event is a mortgage payment that
			// genuinely happened, and deleting someone's history out of their own
			// calendar because our window moved is not ours to do. Pushing a deletion
			// here is what quietly erased one event per loan per month, forever.
			return { kind: 'drop-link' };
		}
		if (remoteChanged) {
			if (input.dateOnlyChange && input.newDate && bindingIsWritable(input.binding)) {
				return { kind: 'write-back', field: input.binding!.field, value: input.newDate };
			}
			// Any other remote edit — a retitled payment, an edited amount — is not
			// a fact about the ledger, so the ledger's version is re-asserted.
			return { kind: 'push' };
		}
		return { kind: 'push' };
	}

	// ---- authored events ------------------------------------------------------
	if (localHash === null && remoteHash === null) return { kind: 'drop-link' };

	if (localChanged && remoteChanged) {
		// Includes "edited here, deleted there" and "both invented it
		// independently". Both are genuinely ambiguous and go to the same rule.
		return { kind: 'conflict', winner: winnerOf(input) };
	}

	if (localChanged) return localHash === null ? { kind: 'push-delete' } : { kind: 'push' };
	return remoteHash === null ? { kind: 'apply-delete' } : { kind: 'apply' };
}

/**
 * Last writer wins, with a deterministic tie-break.
 *
 * Two clocks on two machines will sometimes read the same. Resolving a dead heat
 * arbitrarily would let the two sides hand the event back and forth on every
 * pass, so the tie always goes the same way. Local is chosen because the loser
 * is recorded and surfaced either way, and the person who is here can see it.
 */
function winnerOf(input: MergeInput): 'local' | 'remote' {
	const local = new Date(input.localUpdatedAt).getTime();
	const remote = new Date(input.remoteUpdatedAt).getTime();
	if (Number.isNaN(local)) return 'remote';
	if (Number.isNaN(remote)) return 'local';
	return remote > local ? 'remote' : 'local';
}
