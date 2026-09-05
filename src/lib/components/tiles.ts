// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One figure at the top of a screen.
 *
 * The shape `MetricTile` draws, named once so a loader can return a row of
 * them and `SummaryBand` can draw the row without either knowing the other's
 * props by heart. Before this, a screen that wanted three figures either
 * hand-rolled a `.tiles` grid or grew its own band component, and the app had
 * three of those with different padding.
 */
export interface Tile {
	label: string;
	value: string;
	unit?: string;
	note?: string;
	/**
	 * A token — `var(--red)`, `var(--yellow)` — and only when the figure is a
	 * task. `0 gaps` is the state the archive is for, and a red nought is an
	 * alarm about nothing.
	 */
	color?: string;
	/**
	 * A hue token name whose wash grounds the tile — `teal`, `green`, `red`.
	 *
	 * Identity, not state: it says WHICH figure this is among four in a row.
	 * Left off, the tile sits on `--surface` like every other card.
	 */
	wash?: string;
}
