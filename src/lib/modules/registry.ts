// The module registry is the single source of truth for the sidebar and for
// which screens exist. Settings toggles modules on and off; a disabled module's
// screens disappear from the sidebar and 404 their routes.

export const MODULE_KEYS = [
	'import',
	'property',
	'investments',
	'loans',
	'retirement',
	'home',
	'calendar',
	'documents'
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

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

export const DEFAULT_MODULES: ModuleToggles = {
	import: true,
	property: true,
	investments: true,
	loans: true,
	retirement: true,
	home: true,
	calendar: true,
	documents: true
};

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
