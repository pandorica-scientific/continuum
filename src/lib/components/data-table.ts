// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The shapes a `DataTable` is fed, and the two sums it does on them.
 *
 * A screen owns its columns — what they are called, how wide, when they go.
 * The table owns everything the columns have in common: the header strip,
 * the row line, the open group's ground, the summary row. Seven screens
 * drew that chrome themselves before v0.8.1, each a shade apart; this is
 * where the shade is decided once.
 */

export type Align = 'start' | 'end' | 'center';

export interface Column {
	key: string;
	label: string;
	align?: Align;
	/** A grid track: `minmax(0,1.6fr)`, `170px`, `auto`. */
	width: string;
	/** Below this viewport width the column is not drawn. Two steps only. */
	hideBelow?: 760 | 900;
}

export interface Group<Row> {
	key: string;
	open: boolean;
	rows: Row[];
}

/**
 * The columns that fit a viewport. A column hides below its own breakpoint
 * and nothing else moves. `null` is "unmeasured" — the server, or the first
 * frame — and reads as wide, because a phone briefly showing one column too
 * many is better than a monitor missing one.
 */
export function visibleColumns(columns: Column[], width: number | null): Column[] {
	if (width === null) return columns;
	return columns.filter((c) => c.hideBelow === undefined || width >= c.hideBelow);
}

export function gridTemplate(columns: Column[]): string {
	return columns.map((c) => c.width).join(' ');
}
