// The module registry is the single source of truth for the sidebar and for
// which screens exist. Settings toggles modules on and off; a disabled module's
// screens disappear from the sidebar and 404 their routes.

// One declaration per module: key, how the Settings toggle presents it, and
// (below, in NAV_GROUPS) where it sits in the sidebar. Adding a module means
// one entry here, one nav item, and its route directory — nothing else.
export const MODULES = {
	import: { emoji: '📥', label: 'Import', note: 'statement upload and the review queue' },
	property: { emoji: '🏢', label: 'Property', note: 'flats, tenancies and bills' },
	investments: { emoji: '📈', label: 'Investments', note: 'holdings from broker reports' },
	loans: { emoji: '💳', label: 'Loans', note: 'mortgages and fixation periods' },
	retirement: { emoji: '🎯', label: 'Retirement', note: 'the projection model and salary history' },
	home: { emoji: '🏠', label: 'Home Assistant', note: 'devices and meter readings' },
	calendar: { emoji: '📅', label: 'Calendar', note: 'generated events and the ics feed' },
	tax: { emoji: '🧾', label: 'Tax', note: 'yearly statements per person and country' },
	documents: { emoji: '🗂️', label: 'Documents', note: 'the archive with expiry dates' }
} as const;

export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

export type ModuleKey = keyof typeof MODULES;

export type ModuleToggles = Record<ModuleKey, boolean>;

export interface NavItem {
	path: string;
	label: string;
	emoji: string;
	/** Screens without a module (Overview, Settings) are always visible. */
	module?: ModuleKey;
}

export interface NavGroup {
	label: string;
	items: NavItem[];
}

// Cash flow and Accounts are core money screens — they stay even when the
// Import module is off (accounts can be maintained by hand). The Import
// toggle governs only the statement-import screen itself.
export const NAV_GROUPS: NavGroup[] = [
	{
		label: 'Money',
		items: [
			{ path: '/overview', label: 'Overview', emoji: '🧭' },
			{ path: '/cashflow', label: 'Cash flow', emoji: '💸' },
			{ path: '/transactions', label: 'Transactions', emoji: '📒' },
			{ path: '/tags', label: 'Tags', emoji: '🏷️' },
			{ path: '/rules', label: 'Rules', emoji: '⚙️' },
			{ path: '/tax', label: 'Tax', emoji: '🧾', module: 'tax' },
			{ path: '/accounts', label: 'Accounts', emoji: '🏦' },
			{ path: '/import', label: 'Import', emoji: '📥', module: 'import' }
		]
	},
	{
		label: 'Assets',
		items: [
			{ path: '/property', label: 'Property', emoji: '🏢', module: 'property' },
			{ path: '/investments', label: 'Investments', emoji: '📈', module: 'investments' },
			{ path: '/loans', label: 'Loans', emoji: '💳', module: 'loans' },
			{ path: '/retirement', label: 'Retirement', emoji: '🎯', module: 'retirement' }
		]
	},
	{
		label: 'Household',
		items: [
			{ path: '/home', label: 'Home', emoji: '🏠', module: 'home' },
			{ path: '/calendar', label: 'Calendar', emoji: '📅', module: 'calendar' }
		]
	},
	{
		label: 'Admin',
		items: [
			{ path: '/documents', label: 'Documents', emoji: '🗂️', module: 'documents' },
			{ path: '/settings', label: 'Settings', emoji: '⚙️' }
		]
	}
];

export const DEFAULT_MODULES: ModuleToggles = Object.fromEntries(
	MODULE_KEYS.map((key) => [key, true])
) as ModuleToggles;

/** Nav groups with disabled modules' items removed; empty groups collapse away. */
export function visibleNavGroups(modules: ModuleToggles): NavGroup[] {
	return NAV_GROUPS.map((group) => ({
		label: group.label,
		items: group.items.filter((item) => !item.module || modules[item.module])
	})).filter((group) => group.items.length > 0);
}

/** True when the given path belongs to a module that is switched off. */
export function pathDisabled(pathname: string, modules: ModuleToggles): boolean {
	for (const group of NAV_GROUPS) {
		for (const item of group.items) {
			if (pathname === item.path || pathname.startsWith(item.path + '/')) {
				return item.module ? !modules[item.module] : false;
			}
		}
	}
	return false;
}
