// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The Overview panel and the Money screen show the same cash-flow figures, and
// each used to carry its own copy of the switch above them — which is how one
// of them came to offer two windows while the other offered three, and how the
// caption ended up on a different side of the row on each.
//
// Asserted against the source rather than a render, because this is a fact
// about which component the screens reach for, not about anything a browser
// does with it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markupIn } from '../svelte-markup';

const SCREENS = [
	'src/lib/overview/panels/FlowPanel.svelte',
	'src/routes/(app)/cashflow/+page.svelte'
];

describe('the cash-flow period control', () => {
	it('is the one control both screens render', () => {
		for (const path of SCREENS) {
			const source = readFileSync(path, 'utf8');
			expect(source).toContain("import PeriodControls from '$lib/charts/PeriodControls.svelte'");
			expect(markupIn(source)).toContain('<PeriodControls');
			// Not merely alongside the old one: a screen still reaching for
			// Segmented itself is a second switch waiting to drift.
			expect(source).not.toContain('Segmented.svelte');
		}
	});
});
