import { describe, expect, it } from 'vitest';
import {
	AREAS,
	MODULE_KEYS,
	areaForPath,
	pathDisabled,
	visibleAreas,
	type ModuleToggles
} from '$lib/modules/registry';
import { ICONS } from '$lib/icons';

const modules = (overrides: Partial<ModuleToggles> = {}): ModuleToggles =>
	({
		...(Object.fromEntries(MODULE_KEYS.map((key) => [key, true])) as ModuleToggles),
		...overrides
	}) as ModuleToggles;

// pathDisabled is the route guard: it is what makes a switched-off module's
// screens 404 rather than quietly rendering. The sidebar was restructured
// underneath it, so these pin the behaviour that must not have changed.
describe('pathDisabled', () => {
	it('allows a screen whose module is on', () => {
		expect(pathDisabled('/property', modules())).toBe(false);
	});

	it('refuses a screen whose module is off', () => {
		expect(pathDisabled('/property', modules({ property: false }))).toBe(true);
	});

	it('refuses the children of a switched-off screen', () => {
		expect(pathDisabled('/property/anything', modules({ property: false }))).toBe(true);
	});

	it('always allows screens that belong to no module', () => {
		for (const path of ['/overview', '/settings', '/cashflow', '/accounts']) {
			expect(pathDisabled(path, modules({ property: false, tax: false }))).toBe(false);
		}
	});

	// A path the registry has never heard of is not the guard's business; the
	// router decides whether it exists.
	it('allows a path it does not know', () => {
		expect(pathDisabled('/files/receipt.pdf', modules())).toBe(false);
	});

	// A prefix match must not swallow a different screen that starts the same way.
	it('does not treat a longer sibling path as a child', () => {
		expect(pathDisabled('/taxes', modules({ tax: false }))).toBe(false);
	});
});

describe('the area structure', () => {
	it('puts every screen in exactly one area', () => {
		const paths = AREAS.flatMap((area) => area.screens.map((s) => s.path));
		expect(new Set(paths).size).toBe(paths.length);
	});

	it('groups the money screens together in the agreed order', () => {
		const money = AREAS.find((a) => a.key === 'money');
		expect(money?.screens.map((s) => s.path)).toEqual([
			'/cashflow',
			'/accounts',
			'/transactions',
			'/tax',
			'/import',
			'/rules',
			'/tags'
		]);
	});

	it('holds property, investments and loans under Assets', () => {
		const assets = AREAS.find((a) => a.key === 'assets');
		expect(assets?.label).toBe('Assets');
		expect(assets?.screens.map((s) => s.path)).toEqual(['/property', '/investments', '/loans']);
	});

	// Household was split so the calendar is one click away rather than two.
	it('gives Home and Calendar a sidebar row each', () => {
		expect(AREAS.find((a) => a.key === 'home')?.screens.map((s) => s.path)).toEqual(['/home']);
		expect(AREAS.find((a) => a.key === 'calendar')?.screens.map((s) => s.path)).toEqual([
			'/calendar'
		]);
	});
});

describe('areaForPath', () => {
	it('finds the area a screen belongs to', () => {
		expect(areaForPath('/loans')?.key).toBe('assets');
		expect(areaForPath('/import')?.key).toBe('money');
	});

	it('finds it from a child route too', () => {
		expect(areaForPath('/property/floor-plan')?.key).toBe('assets');
	});

	it('returns nothing for a path outside the navigation', () => {
		expect(areaForPath('/files/receipt.pdf')).toBeUndefined();
	});
});

describe('visibleAreas', () => {
	it('shows every area when every module is on', () => {
		expect(visibleAreas(modules()).map((a) => a.key)).toEqual(AREAS.map((a) => a.key));
	});

	it('drops a screen whose module is off but keeps its area alive', () => {
		const money = visibleAreas(modules({ tax: false, import: false })).find(
			(a) => a.key === 'money'
		);
		expect(money?.screens.map((s) => s.path)).toEqual([
			'/cashflow',
			'/accounts',
			'/transactions',
			'/rules',
			'/tags'
		]);
	});

	// Assets is nothing but modules, so switching all three off leaves no row.
	it('removes an area once it has no live screens', () => {
		const areas = visibleAreas(modules({ property: false, investments: false, loans: false }));
		expect(areas.map((a) => a.key)).not.toContain('assets');
	});

	it('keeps Money and Admin whatever is switched off', () => {
		const areas = visibleAreas(
			Object.fromEntries(MODULE_KEYS.map((key) => [key, false])) as ModuleToggles
		);
		expect(areas.map((a) => a.key)).toContain('money');
		expect(areas.map((a) => a.key)).toContain('admin');
		expect(areas.map((a) => a.key)).toContain('overview');
	});
});

// Icon names are strings in the registry and keys in the icon set. TypeScript
// ties them together at build time; this says so at test time as well, and
// catches an icon deleted from under a screen that still names it.
describe('the icon set', () => {
	it('has an icon for every area and every screen', () => {
		for (const area of AREAS) {
			expect(ICONS, `${area.key} names a missing icon`).toHaveProperty(area.icon);
			for (const screen of area.screens) {
				expect(ICONS, `${screen.path} names a missing icon`).toHaveProperty(screen.icon);
			}
		}
	});

	it('draws every icon from at least one primitive', () => {
		for (const [name, parts] of Object.entries(ICONS)) {
			expect(parts.length, `${name} is empty`).toBeGreaterThan(0);
		}
	});

	// The actions the shell draws itself, rather than reading from the registry.
	it('keeps the icons the shell uses by name', () => {
		for (const name of ['plus', 'clock']) {
			expect(ICONS).toHaveProperty(name);
		}
	});
});
