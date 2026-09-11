// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * How many of a bottling the household has, and how many are open.
 *
 * A `bottle` row is not one physical bottle — it is a bottling somebody owns
 * some number of. Two numbers say everything: `owned` and `opened`. The state
 * (sealed, open, finished) is read from them and is deliberately not a column,
 * because a stored state is a third number that can disagree with the other
 * two.
 *
 * Pure arithmetic, no DOM, no database: the three controls in the ownership row
 * call these, and the CHECK constraint on `bottle` is what happens when they
 * are wrong.
 *
 * Nothing here clamps for display. If the stored numbers are impossible, the
 * screen says so — a clamp hides the bug it is covering, and a cellar quietly
 * showing "2 sealed" over a row that says otherwise is worse than an odd label.
 */

export interface Counts {
	owned: number;
	opened: number;
}

/** Another sealed bottle. Buying one does not open it. */
export const add = ({ owned, opened }: Counts): Counts => ({ owned: owned + 1, opened });

/**
 * One fewer bottle — the open one first.
 *
 * Drinking the open bottle is what usually happens, so `−` finishes that before
 * it touches the sealed ones. Only once nothing is open does the sealed count
 * fall.
 */
export function remove({ owned, opened }: Counts): Counts {
	if (owned <= 0) return { owned: 0, opened: Math.max(0, opened) };
	return { owned: owned - 1, opened: opened > 0 ? opened - 1 : opened };
}

/**
 * Open one of the sealed ones.
 *
 * The only control that raises the open count, and it cannot go past what is
 * owned — which is exactly the `opened <= owned` half of the CHECK.
 */
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
 * What the two numbers mean, said the way a person would.
 *
 * At one bottle the count is noise — "Sealed" is the whole story. Above one,
 * both numbers are worth saying, because "3 sealed, 1 open" is a different
 * evening from "4 sealed".
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
