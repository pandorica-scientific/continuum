// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The three primitives every screen's top is built from.
 *
 * Source guards rather than rendered assertions: what matters about these two
 * components is that they are the ONLY way figures and a control row appear at
 * the top of a screen, which is a fact about the source. `screen-frame.test.ts`
 * is the other half — it fails any screen that draws its own.
 */
const read = (path: string) => readFileSync(path, 'utf8');

describe('the summary band', () => {
	it('is a grid of MetricTile and nothing else', () => {
		const source = read('src/lib/components/SummaryBand.svelte');
		expect(source).toContain("import MetricTile from './MetricTile.svelte'");
		expect(source).toContain('<MetricTile');
		expect(source).toMatch(/grid-template-columns:\s*repeat\(var\(--columns\), minmax\(0, 1fr\)\)/);
		expect(source).toContain('gap: var(--space-6)');
	});

	it('draws the control row at control height with two slots', () => {
		const source = read('src/lib/components/ControlRow.svelte');
		expect(source).toContain('min-height: var(--control-h)');
		expect(source).toContain('{@render left?.()}');
		expect(source).toContain('{@render right?.()}');
	});

	it('exports the tile shape MetricTile draws', () => {
		const source = read('src/lib/components/tiles.ts');
		expect(source).toContain('export interface Tile');
		for (const field of [
			'label: string',
			'value: string',
			'unit?: string',
			'note?: string',
			'color?: string'
		])
			expect(source).toContain(field);
	});
});
