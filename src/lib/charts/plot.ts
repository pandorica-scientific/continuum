// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The horizontal band every chart in this folder draws into, and how a
 * categorical series is spread across it. Shared so every chart uses the
 * same axis gutter — different left margins across stacked charts would
 * read as a rendering fault.
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
