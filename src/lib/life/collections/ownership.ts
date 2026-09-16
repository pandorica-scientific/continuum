// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * How many of a bottling the household has, and how many are open.
 *
 * A `bottle` row is a bottling owned some number of; `owned`/`opened` are the
 * only two numbers, and state (sealed/open/finished) is derived rather than
 * stored, since a stored state could disagree with them.
 *
 * Pure arithmetic, no DOM, no database — the CHECK constraint on `bottle` is
 * what catches these being wrong. Nothing here clamps for display: an
 * impossible stored count is shown as such, not hidden.
 */

export interface Counts {
	owned: number;
	opened: number;
}

/** Another sealed bottle. Buying one does not open it. */
export const add = ({ owned, opened }: Counts): Counts => ({ owned: owned + 1, opened });

/** One fewer bottle — drains the open one first, before touching sealed count. */
export function remove({ owned, opened }: Counts): Counts {
	if (owned <= 0) return { owned: 0, opened: Math.max(0, opened) };
	return { owned: owned - 1, opened: opened > 0 ? opened - 1 : opened };
}

/** Open one of the sealed ones; cannot exceed `owned` (the CHECK's other half). */
export function openOne({ owned, opened }: Counts): Counts {
	if (opened >= owned) return { owned, opened };
	return { owned, opened: opened + 1 };
}

export type StateKind = 'finished' | 'sealed' | 'open' | 'some-open' | 'impossible';

export interface BottleState {
	kind: StateKind;
	/** What the pill says. Already plural-correct; nothing else formats it. */
	label: string;
}

/**
 * What the two numbers mean, said the way a person would. At one bottle the
 * count is noise ("Sealed"); above one, both numbers matter ("3 sealed, 1 open").
 */
export function stateOf({ owned, opened }: Counts): BottleState {
	if (opened > owned) return { kind: 'impossible', label: `${opened} open of ${owned}` };
	if (owned <= 0) return { kind: 'finished', label: 'Finished' };

	if (owned === 1) {
		return opened === 1 ? { kind: 'open', label: 'Open' } : { kind: 'sealed', label: 'Sealed' };
	}

	const sealed = owned - opened;
	if (opened === 0) return { kind: 'sealed', label: `${sealed} sealed` };
	if (sealed === 0) return { kind: 'open', label: `${opened} open` };
	return { kind: 'some-open', label: `${sealed} sealed, ${opened} open` };
}
