// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The horizontal band every chart in this folder draws into, and how a
 * categorical series is spread across it.
 *
 * Three geometry modules had their own copy of this — the same two constants
 * and the same four-line function, byte for byte — which is three places for the
 * gutter to be widened in two of them. The charts share an axis gutter by
 * design: a tax chart and a cash-flow chart stacked on one screen with different
 * left margins reads as a rendering fault, not as a choice.
 */

/** The viewBox width every chart here draws into. */
export const VIEW_W = 1000;

/** The plot's horizontal extent. Everything left of X_LEFT is axis gutter. */
export const X_LEFT = 56;
export const X_RIGHT = 992;

/**
 * The centre of one slot in a categorical axis.
 *
 * Centres rather than edges, because a bar, a tick and a hover column all hang
 * off the middle of the same slot and are then offset by their own width.
 */
export function slotFor(index: number, count: number): number {
	const slot = (X_RIGHT - X_LEFT) / count;
	return X_LEFT + slot * index + slot / 2;
}
