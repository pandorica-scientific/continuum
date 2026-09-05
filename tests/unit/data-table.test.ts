// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { gridTemplate, visibleColumns, type Column } from '$lib/components/data-table';

/**
 * The geometry a DataTable computes for itself — which columns fit and what
 * grid they make. Kept out of the component so the rule "a column hides
 * below its own breakpoint and nothing else moves" is a line of arithmetic
 * with a test, not a media query per screen.
 */
const cols: Column[] = [
	{ key: 'name', label: 'Name', width: 'minmax(0,1.6fr)' },
	{ key: 'trust', label: 'Trust', width: '170px', hideBelow: 900 },
	{ key: 'kept', label: 'Kept', width: '160px', hideBelow: 760 },
	{ key: 'menu', label: '', width: '32px' }
];

describe('DataTable geometry', () => {
	it('drops columns below their breakpoint, in order', () => {
		expect(visibleColumns(cols, 1200).map((c) => c.key)).toEqual(['name', 'trust', 'kept', 'menu']);
		expect(visibleColumns(cols, 800).map((c) => c.key)).toEqual(['name', 'kept', 'menu']);
		expect(visibleColumns(cols, 500).map((c) => c.key)).toEqual(['name', 'menu']);
	});

	it('keeps every column when the width is unknown', () => {
		// Server render has no box to measure; the wide layout is the one that
		// hides nothing, so it is the one to send.
		expect(visibleColumns(cols, null)).toHaveLength(4);
	});

	it('joins widths into one grid template', () => {
		expect(gridTemplate(visibleColumns(cols, 800))).toBe('minmax(0,1.6fr) 160px 32px');
	});
});
