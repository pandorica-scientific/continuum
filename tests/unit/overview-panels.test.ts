import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalise } from '$lib/overview/layout';
import {
	DEFAULT_LAYOUT,
	PANELS,
	PANEL_BOUNDS,
	panelAvailable,
	panelDefinition
} from '$lib/overview/panels';
import { MODULE_KEYS, type ModuleToggles } from '$lib/modules/registry';

const allModules = (on: boolean): ModuleToggles =>
	Object.fromEntries(MODULE_KEYS.map((key) => [key, on])) as ModuleToggles;

// A panel is three things in three places — a registry entry, a component and a
// data builder. Nothing in the type system ties them together, so a fourteenth
// panel can half-exist and only show up as a blank box at runtime.
describe('the panel registry', () => {
	it('gives every panel a component file', () => {
		for (const panel of PANELS) {
			const name = panel.key[0].toUpperCase() + panel.key.slice(1);
			expect(
				existsSync(`src/lib/overview/panels/${name}Panel.svelte`),
				`${panel.key} has no ${name}Panel.svelte`
			).toBe(true);
		}
	});

	it('wires every panel into PanelContent', () => {
		const source = readFileSync('src/lib/overview/PanelContent.svelte', 'utf8');
		for (const panel of PANELS) {
			expect(source, `${panel.key} is never rendered`).toContain(`panelKey === '${panel.key}'`);
		}
	});

	it('gives every panel a data builder', () => {
		const source = readFileSync('src/lib/server/overview.ts', 'utf8');
		for (const panel of PANELS) {
			expect(source, `${panel.key} has no builder`).toMatch(new RegExp(`^\\t${panel.key}:`, 'm'));
		}
	});

	it('never names a panel twice', () => {
		expect(new Set(PANELS.map((p) => p.key)).size).toBe(PANELS.length);
	});

	it('only gates panels on modules that exist', () => {
		for (const panel of PANELS) {
			for (const module of panel.modules) {
				expect(MODULE_KEYS, `${panel.key} gates on an unknown module`).toContain(module);
			}
		}
	});

	// Every panel must be reachable, or it sits in the registry forever with no
	// way to place it.
	it('offers every panel when every module is on', () => {
		for (const panel of PANELS) {
			expect(panelAvailable(panel.key, allModules(true)), `${panel.key} is never available`).toBe(
				true
			);
		}
	});

	it('withholds module-owned panels when everything is off', () => {
		for (const panel of PANELS.filter((p) => p.modules.length > 0)) {
			expect(panelAvailable(panel.key, allModules(false))).toBe(false);
		}
	});
});

describe('the default layout', () => {
	// Nothing but this stops a mistake reaching everyone who has never
	// customised — which on upgrade is everyone.
	it('survives normalisation unchanged', () => {
		expect(normalise(DEFAULT_LAYOUT, PANEL_BOUNDS)).toEqual(DEFAULT_LAYOUT);
	});

	// The default board used to restate every panel's size. Reducing the
	// briefing panel's default height then changed the definition and not the
	// board, so the screen went on drawing the old size and looked for all the
	// world like a rendering bug. Sizes belong to the panel; only x and y belong
	// to the arrangement.
	it('takes every size from the panel it places, not from a second copy', () => {
		for (const placed of DEFAULT_LAYOUT) {
			const panel = panelDefinition(placed.k);
			expect(panel, `${placed.k} is placed but not defined`).toBeDefined();
			expect({ k: placed.k, w: placed.w, h: placed.h }).toEqual({
				k: placed.k,
				w: panel!.defaultW,
				h: panel!.defaultH
			});
		}
	});

	it('stacks without leaving a gap between the rows it fills', () => {
		const bottom = Math.max(...DEFAULT_LAYOUT.map((p) => p.y + p.h));
		const covered = new Set<number>();
		for (const p of DEFAULT_LAYOUT) for (let y = p.y; y < p.y + p.h; y++) covered.add(y);
		// Every row from the top to the tallest panel's bottom has something on
		// it: an empty band across the whole board is dead space nobody chose.
		for (let y = 0; y < bottom; y++) expect(covered.has(y), `row ${y} is empty`).toBe(true);
	});

	it('places no panel on top of another', () => {
		for (const a of DEFAULT_LAYOUT) {
			for (const b of DEFAULT_LAYOUT) {
				if (a === b) continue;
				const overlapping =
					a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
				expect(overlapping, `${a.k} overlaps ${b.k}`).toBe(false);
			}
		}
	});

	// This is the promise the release makes: upgrading changes nobody's screen.
	it('reproduces the pre-V2 Overview', () => {
		expect(DEFAULT_LAYOUT.map((p) => p.k)).toEqual(['briefing', 'flow', 'composition', 'upcoming']);
	});
});
