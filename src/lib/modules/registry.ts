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
	}
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

export type ModuleKey = keyof typeof MODULES;

export type ModuleToggles = Record<ModuleKey, boolean>;

interface Screen {
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
type AreaHue = 'brand' | 'teal' | 'purple' | 'blue' | 'orange' | 'indigo' | 'fg3';

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

export const DEFAULT_MODULES: ModuleToggles = Object.fromEntries(
	MODULE_KEYS.map((key) => [key, true])
) as ModuleToggles;

function matches(pathname: string, screen: Screen): boolean {
	return pathname === screen.path || pathname.startsWith(screen.path + '/');
}

/** Areas with disabled modules' screens removed; areas left with none go too. */
export function visibleAreas(modules: ModuleToggles): Area[] {
	return AREAS.map((area) => ({
		...area,
		screens: area.screens.filter((screen) => !screen.module || modules[screen.module])
	})).filter((area) => area.screens.length > 0);
}

/** The area a path belongs to, or undefined for a route outside the navigation. */
export function areaForPath(pathname: string): Area | undefined {
	return AREAS.find((area) => area.screens.some((screen) => matches(pathname, screen)));
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
	for (const area of AREAS) {
		for (const screen of area.screens) {
			if (matches(pathname, screen)) {
				return screen.module ? !modules[screen.module] : false;
			}
		}
	}
	return false;
}
