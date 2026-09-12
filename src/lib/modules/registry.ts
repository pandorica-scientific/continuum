// SPDX-License-Identifier: AGPL-3.0-or-later
import type { IconName } from '$lib/icons';

// The module registry is the single source of truth for the sidebar and for
// which screens exist. Settings toggles modules on and off; a disabled module's
// screens disappear from the navigation and 404 their routes.

// One declaration per module: key, how the Settings toggle presents it, and
// (below, in AREAS) where it sits in the navigation. Adding a module means one
// entry here, one screen in an area, and its route directory — nothing else.
export const MODULES = {
	import: { emoji: '📥', label: 'Import', note: 'statement upload and the review queue' },
	property: { emoji: '🏢', label: 'Property', note: 'flats, tenancies and bills' },
	investments: { emoji: '📈', label: 'Investments', note: 'holdings from broker reports' },
	loans: { emoji: '💳', label: 'Loans', note: 'mortgages and fixation periods' },
	retirement: { emoji: '🎯', label: 'Retirement', note: 'the projection model' },
	salary: { emoji: '💼', label: 'Salary', note: 'monthly figures from payslips and the ledger' },
	home: { emoji: '🏠', label: 'Home Assistant', note: 'devices and meter readings' },
	calendar: { emoji: '📅', label: 'Calendar', note: 'generated events and the ics feed' },
	tax: { emoji: '🧾', label: 'Tax', note: 'yearly statements per person and country' },
	documents: { emoji: '🗂️', label: 'Documents', note: 'the archive with expiry dates' },
	contacts: {
		emoji: '📇',
		label: 'Contacts',
		note: 'people and companies, linked to what they touch'
	},
	// The Life area, as three toggles rather than one. A household that keeps a
	// cellar and never cooks from a screen should be able to say so, and the
	// granularity here is per-feature everywhere else.
	trips: { emoji: '🧳', label: 'Trips', note: 'ideas, trips and the map they fill in' },
	cookbook: { emoji: '🍳', label: 'Cookbook', note: 'recipes this household cooks' },
	collections: { emoji: '🍷', label: 'Collections', note: 'shelves of things you keep' }
} as const;

/**
 * Categories a hand-written calendar event may carry, each supplying a marker.
 *
 * A fixed registry rather than a free emoji field, for two reasons: the marker
 * keeps a reliable meaning, and nothing unvalidated reaches a SUMMARY line that
 * a calendar server will parse. Generated events do not use these — their marker
 * comes from the module that produced them.
 */
export const EVENT_CATEGORIES = {
	household: { label: 'Household', emoji: '🏠' },
	money: { label: 'Money', emoji: '💰' },
	travel: { label: 'Travel', emoji: '✈️' },
	health: { label: 'Health', emoji: '🏥' },
	admin: { label: 'Admin', emoji: '📋' },
	social: { label: 'Social', emoji: '🎉' }
} as const;

type EventCategoryKey = keyof typeof EVENT_CATEGORIES;
export const EVENT_CATEGORY_KEYS = Object.keys(EVENT_CATEGORIES) as EventCategoryKey[];

export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

/** The modules this product declares itself. Checked by the compiler. */
export type CoreModuleKey = keyof typeof MODULES;

/**
 * A module key.
 *
 * `keyof typeof MODULES` cannot survive a registry that grows at runtime, and
 * this is the price: a core key is still checked — a typo in `screen.module`
 * against one of the fourteen above is still a build failure — but an
 * arbitrary string no longer fails to compile where a key is expected. There
 * is no version of this that keeps both.
 */
export type ModuleKey = CoreModuleKey | (string & {});

export type ModuleToggles = Record<CoreModuleKey, boolean> & Record<string, boolean>;

export interface Screen {
	path: string;
	label: string;
	/** Shown at 26px in the screen title; ScreenHeader reads it from here so no
	 *  page has to pass its own. */
	icon: IconName;
	/** Screens without a module (Overview, Settings, the core money screens)
	 *  are always visible. */
	module?: ModuleKey;
}

/** The hues an area may take. Every one is a token in app.css, so a name that
 *  does not exist fails the build rather than rendering an invisible colour. */
type AreaHue = 'brand' | 'teal' | 'purple' | 'blue' | 'orange' | 'indigo' | 'fg3' | 'rose';

export interface Area {
	key: string;
	label: string;
	icon: IconName;
	/** Identity colour, on the sidebar row's icon and the screen-title mark.
	 *  Admin takes the muted foreground: it is chrome, not a subject. */
	hue: AreaHue;
	/** Whether importing a statement is offered from this area's screens.
	 *  Money owns the ledger and Overview is where you land, so the shortcut
	 *  belongs there; on Property or Retirement it is noise. */
	offersImport?: boolean;
	screens: Screen[];
}

/**
 * Two levels: areas in the sidebar, screens as sub-tabs under the page title.
 *
 * A flat list was tried first and abandoned — eighteen screens in one column
 * stops being legible. Seven of these rows are one click from what they hold;
 * the areas with several screens open on their first live one.
 *
 * Home and Calendar are separate rows rather than one Household area, so the
 * calendar is one click away rather than two. Retirement stands alone because
 * it answers a different question from the rest of Assets.
 *
 * Documents is its own row, after Calendar. It shared an "Admin" row with
 * Settings, which put paperwork somebody looks at often behind the same click
 * as configuration somebody looks at rarely.
 */
export const AREAS: Area[] = [
	{
		key: 'overview',
		label: 'Overview',
		icon: 'compass',
		hue: 'brand',
		offersImport: true,
		screens: [{ path: '/overview', label: 'Overview', icon: 'compass' }]
	},
	{
		key: 'money',
		label: 'Money',
		icon: 'flow',
		hue: 'teal',
		offersImport: true,
		// Cash flow, Accounts, Transactions, Rules and Tags are core: they stay
		// whatever is switched off, which is why this area can never disappear.
		screens: [
			{ path: '/cashflow', label: 'Cash flow', icon: 'flow' },
			{ path: '/accounts', label: 'Accounts', icon: 'bank' },
			{ path: '/transactions', label: 'Transactions', icon: 'ledger' },
			// Earned, then taxed on it: Salary sits before Tax for the same reason
			// the waterfall opens with income.
			{ path: '/salary', label: 'Salary', icon: 'wallet', module: 'salary' },
			{ path: '/tax', label: 'Tax', icon: 'receipt', module: 'tax' },
			{ path: '/import', label: 'Import', icon: 'inbox', module: 'import' },
			{ path: '/rules', label: 'Rules', icon: 'sliders' }
		]
	},
	{
		key: 'assets',
		label: 'Assets',
		icon: 'buildings',
		hue: 'purple',
		screens: [
			{ path: '/property', label: 'Property', icon: 'buildings', module: 'property' },
			{ path: '/investments', label: 'Investments', icon: 'chart', module: 'investments' },
			{ path: '/loans', label: 'Loans', icon: 'card', module: 'loans' }
		]
	},
	{
		key: 'retirement',
		label: 'Retirement',
		icon: 'target',
		hue: 'blue',
		screens: [{ path: '/retirement', label: 'Retirement', icon: 'target', module: 'retirement' }]
	},
	{
		key: 'home',
		label: 'Home',
		icon: 'house',
		hue: 'orange',
		screens: [{ path: '/home', label: 'Home', icon: 'house', module: 'home' }]
	},
	{
		key: 'calendar',
		label: 'Calendar & Contacts',
		icon: 'calendar',
		hue: 'indigo',
		// Contacts lives here rather than in Admin: the people you have dates with
		// and the people you call are the same people, and Admin is chrome.
		screens: [
			{ path: '/calendar', label: 'Calendar', icon: 'calendar', module: 'calendar' },
			{ path: '/contacts', label: 'Contacts', icon: 'people', module: 'contacts' }
		]
	},
	{
		key: 'documents',
		label: 'Documents',
		icon: 'folders',
		hue: 'fg3',
		screens: [{ path: '/documents', label: 'Documents', icon: 'folders', module: 'documents' }]
	},
	// Last, after Documents: the half of a household that is not the ledger.
	//
	// Map carries the `trips` module rather than one of its own, because the map
	// is what trips fill in — a map with trips switched off is an empty world
	// and a row that promises something it cannot show.
	{
		key: 'life',
		label: 'Life',
		icon: 'life',
		hue: 'rose',
		screens: [
			{ path: '/trips', label: 'Trips', icon: 'suitcase', module: 'trips' },
			{ path: '/map', label: 'Map', icon: 'globe', module: 'trips' },
			{ path: '/cookbook', label: 'Cookbook', icon: 'chefhat', module: 'cookbook' },
			{ path: '/collections', label: 'Collections', icon: 'bottle', module: 'collections' }
		]
	}
];

/**
 * Settings is reached from the gear beside the wordmark, not from the sidebar.
 *
 * It used to share an "Admin" row with Documents, which put filed paperwork —
 * something looked at often — behind the same click as the instance's
 * configuration, something looked at rarely. Documents is its own row now, and
 * Settings is chrome.
 *
 * `/settings` therefore belongs to no area, which `areaForPath` returns
 * undefined for. That is not an oversight and the navigation must tolerate it.
 */
export const SETTINGS_PATH = '/settings';

/**
 * The navigation, as something that can be added to.
 *
 * MODULES and AREAS above stay literals: they are this product's own modules
 * and areas, and declaring them inline is what keeps their keys checked by the
 * compiler. What is added here is a way for a project built on this repository
 * to append its own — an account screen, a subscription screen — without
 * editing either literal, which are among the files most likely to change in
 * any release that adds a feature.
 *
 * Everything below reads these functions rather than the literals directly, so
 * a registered module is gated, routed and rendered exactly like a core one.
 */
type ModuleDescriptor = { emoji: string; label: string; note: string };

const extraModules: Record<string, ModuleDescriptor> = {};
const extraAreas: { area: Area; position?: number }[] = [];

export function registerModule(key: string, module: ModuleDescriptor): void {
	extraModules[key] = module;
}

export function registerArea(area: Area, position?: number): void {
	extraAreas.push({ area, position });
}

/** Add a screen to an area that already exists, by area key. */
export function registerScreen(areaKey: string, screen: Screen): void {
	const area =
		AREAS.find((a) => a.key === areaKey) ?? extraAreas.find((e) => e.area.key === areaKey)?.area;
	if (!area) throw new Error(`No area '${areaKey}' to add ${screen.path} to`);
	area.screens.push(screen);
}

export function modules(): Record<string, ModuleDescriptor> {
	return { ...MODULES, ...extraModules };
}

export function areas(): Area[] {
	const all = [...AREAS];
	for (const { area, position } of extraAreas) {
		if (position === undefined) all.push(area);
		else all.splice(position, 0, area);
	}
	return all;
}

/**
 * Every module on.
 *
 * A function rather than a constant: a downstream registers its modules from
 * the extensions front door, which runs before any request but after this file
 * is first imported. An eagerly-evaluated object would freeze the defaults
 * before those registrations landed, and a downstream module would then be
 * absent from settings rather than on.
 */
export function defaultModules(): ModuleToggles {
	return Object.fromEntries(Object.keys(modules()).map((key) => [key, true])) as ModuleToggles;
}

function matches(pathname: string, screen: Screen): boolean {
	return pathname === screen.path || pathname.startsWith(screen.path + '/');
}

/** Areas with disabled modules' screens removed; areas left with none go too. */
export function visibleAreas(modules: ModuleToggles): Area[] {
	return areas()
		.map((area) => ({
			...area,
			screens: area.screens.filter((screen) => !screen.module || modules[screen.module])
		}))
		.filter((area) => area.screens.length > 0);
}

/** The area a path belongs to, or undefined for a route outside the navigation. */
export function areaForPath(pathname: string): Area | undefined {
	return areas().find((area) => area.screens.some((screen) => matches(pathname, screen)));
}

/**
 * True when the given path belongs to a module that is switched off.
 *
 * This is the route guard behind every disabled screen's 404, so its behaviour
 * is pinned by tests independently of how the navigation is arranged: an
 * unknown path is allowed and left to the router, and a screen with no module
 * is always allowed.
 */
export function pathDisabled(pathname: string, modules: ModuleToggles): boolean {
	for (const area of areas()) {
		for (const screen of area.screens) {
			if (matches(pathname, screen)) {
				return screen.module ? !modules[screen.module] : false;
			}
		}
	}
	return false;
}
