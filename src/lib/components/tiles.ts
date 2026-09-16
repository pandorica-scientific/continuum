// SPDX-License-Identifier: AGPL-3.0-or-later
/** One figure at the top of a screen, named once so a loader can return a
 *  row of them and `SummaryBand` can draw it without knowing `MetricTile`'s
 *  props by heart. */
export interface Tile {
	label: string;
	value: string;
	unit?: string;
	note?: string;
	/** A token — `var(--red)`, `var(--yellow)` — only when the figure is a task. */
	color?: string;
	/** A hue token name whose wash grounds the tile — identity, not state:
	 *  which figure this is among several in a row. */
	wash?: string;
}
