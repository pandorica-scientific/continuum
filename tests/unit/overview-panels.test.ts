import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { normalise } from '$lib/overview/layout';
import {
	SUGGESTED_LAYOUT,
	PANELS,
	PANEL_BOUNDS,
	panelAvailable,
	panelDefinition
} from '$lib/overview/panels';
import { MODULE_KEYS, pathDisabled, type ModuleToggles } from '$lib/modules/registry';
import { ICONS } from '$lib/icons';

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

	// The eyebrow is an icon now, and Icon.svelte looks its name up in ICONS. A
	// name that is not there renders an empty <svg>, so a typo costs a panel its
	// eyebrow with nothing thrown and nothing logged.
	it('names an icon that exists for every panel', () => {
		for (const panel of PANELS) {
			expect(panel.icon in ICONS, `${panel.key} names an unknown icon: ${panel.icon}`).toBe(true);
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

	// The first-run picker offers all eighteen at once, and a title alone does
	// not say what "Paper" or "Statements" will actually draw. The line under it
	// is the only thing that does, so a panel added without one silently reads
	// as the odd one out on the very screen that introduces the board.
	it('gives every panel a description', () => {
		for (const panel of PANELS) {
			expect(panel.description.trim(), `${panel.key} has no description`).not.toBe('');
			// One line beside an icon: past this it wraps to three on a narrow
			// chip and the grid stops looking like a set of equals.
			expect(
				panel.description.length,
				`${panel.key} describes itself at length`
			).toBeLessThanOrEqual(90);
			// A fragment rather than a sentence, like every other caption here.
			expect(panel.description.endsWith('.'), `${panel.key} ends in a full stop`).toBe(false);
		}
	});

	// A panel's header offers "Open →", and pathDisabled is what 404s a screen
	// whose module is switched off. So any module that closes a panel's
	// destination has to be one the panel is already gated on — otherwise the
	// board keeps offering a link into a not-found page, which is exactly what
	// the pre-V2 Overview did with its unconditional calendar link.
	it('gates every panel on the modules that close its link', () => {
		for (const panel of PANELS) {
			if (!panel.href) continue;
			for (const module of MODULE_KEYS) {
				const off = { ...allModules(true), [module]: false };
				if (!pathDisabled(panel.href, off)) continue;
				expect(
					panel.modules,
					`${panel.key} links to ${panel.href}, which ${module} closes`
				).toContain(module);
			}
		}
	});
});

describe('the suggested layout', () => {
	// Nothing but this stops a mistake reaching everyone who takes the offer —
	// the picker's primary button and Reset both apply it unread.
	it('survives normalisation unchanged', () => {
		expect(normalise(SUGGESTED_LAYOUT, PANEL_BOUNDS)).toEqual(SUGGESTED_LAYOUT);
	});

	// The suggested board used to restate every panel's size. Reducing the
	// briefing panel's default height then changed the definition and not the
	// board, so the screen went on drawing the old size and looked for all the
	// world like a rendering bug. Sizes belong to the panel; only x and y belong
	// to the arrangement.
	it('takes every size from the panel it places, not from a second copy', () => {
		for (const placed of SUGGESTED_LAYOUT) {
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
		const bottom = Math.max(...SUGGESTED_LAYOUT.map((p) => p.y + p.h));
		const covered = new Set<number>();
		for (const p of SUGGESTED_LAYOUT) for (let y = p.y; y < p.y + p.h; y++) covered.add(y);
		// Every row from the top to the tallest panel's bottom has something on
		// it: an empty band across the whole board is dead space nobody chose.
		for (let y = 0; y < bottom; y++) expect(covered.has(y), `row ${y} is empty`).toBe(true);
	});

	it('places no panel on top of another', () => {
		for (const a of SUGGESTED_LAYOUT) {
			for (const b of SUGGESTED_LAYOUT) {
				if (a === b) continue;
				const overlapping =
					a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
				expect(overlapping, `${a.k} overlaps ${b.k}`).toBe(false);
			}
		}
	});

	// What "Use the suggested board" hands somebody who has just arrived: four
	// panels that answer the questions the app is opened for, and no more.
	it('is the suggested board, and only those four panels', () => {
		expect(SUGGESTED_LAYOUT.map((p) => p.k)).toEqual([
			'briefing',
			'flow',
			'composition',
			'upcoming'
		]);
	});
});

// The seven glyphs Spec C drew for the board, checked the way the scan and
// documents batches check their own.
const ADDED = ['bell', 'layers', 'coins', 'bars', 'trend', 'key', 'alert'] as const;

describe('the overview icons', () => {
	it('are all present', () => {
		expect(ADDED.filter((name) => !(name in ICONS))).toEqual([]);
	});

	it('keeps every typed primitive inside the 24 viewBox', () => {
		// Only circle/line/rect are checked. A `path` string mixes absolute
		// coordinates, relative offsets and arc flags, so scanning it for numbers
		// cannot tell a coordinate from a sweep flag.
		const outside: string[] = [];
		for (const name of ADDED) {
			for (const part of ICONS[name]) {
				if ('path' in part) continue;
				const numbers = Object.values(part)[0] as readonly number[];
				if (numbers.some((n) => n < 0 || n > 24)) outside.push(name);
			}
		}
		expect([...new Set(outside)]).toEqual([]);
	});
});
