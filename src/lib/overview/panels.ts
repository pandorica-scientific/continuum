// The panel registry is the single source of truth for what can go on the
// Overview board, in the same spirit as src/lib/modules/registry.ts for
// screens. It holds no data and no arithmetic: adding a fourteenth panel is one
// entry here plus one component in ./panels/, and nothing else.
//
// Emoji are a placeholder. Spec C of the V2 migration replaces them with the
// inline SVG icon set across the whole app at once.

import type { ModuleKey, ModuleToggles } from '$lib/modules/registry';
import type { OverviewPlacement, PanelBounds } from './layout';

export interface PanelDefinition {
	key: string;
	title: string;
	emoji: string;
	/** Size in columns and rows when the panel is first added. */
	defaultW: number;
	defaultH: number;
	/** Smallest the person may shrink it to. */
	minW: number;
	minH: number;
	/** Every one of these modules must be on for the panel to appear. */
	modules: ModuleKey[];
}

// V2 sets a floor of four columns by three rows for every panel. `flow` keeps
// it deliberately: below about half width the waterfall's leaf labels get
// genuinely small, which V2 records as an open question rather than a defect.
// Raising this panel's minimum is the lever if it proves unusable in practice.
const MIN_W = 4;
const MIN_H = 3;

export const PANELS: PanelDefinition[] = [
	{
		key: 'briefing',
		title: 'Needs you',
		emoji: '🔔',
		defaultW: 12,
		defaultH: 6,
		minW: MIN_W,
		minH: MIN_H,
		modules: []
	},
	{
		key: 'flow',
		title: 'Where the money goes',
		emoji: '💸',
		defaultW: 12,
		defaultH: 19,
		minW: MIN_W,
		minH: MIN_H,
		modules: []
	},
	{
		key: 'composition',
		title: 'What it is made of',
		emoji: '🧩',
		defaultW: 6,
		defaultH: 6,
		minW: MIN_W,
		minH: MIN_H,
		modules: []
	},
	{
		key: 'upcoming',
		title: 'Next 30 days',
		emoji: '📅',
		defaultW: 6,
		defaultH: 7,
		minW: MIN_W,
		minH: MIN_H,
		// Gated deliberately. The panel links to /calendar, and pathDisabled
		// makes that route 404 when the module is off — which the pre-V2 Overview
		// did unconditionally, link and all.
		modules: ['calendar']
	},
	{
		key: 'networth',
		title: 'Net worth over time',
		emoji: '📈',
		defaultW: 6,
		defaultH: 5,
		minW: MIN_W,
		minH: MIN_H,
		modules: []
	},
	{
		key: 'accounts',
		title: 'Where the cash sits',
		emoji: '🏦',
		defaultW: 6,
		defaultH: 6,
		minW: MIN_W,
		minH: MIN_H,
		modules: []
	},
	{
		key: 'equity',
		title: 'Flats against mortgages',
		emoji: '🏢',
		defaultW: 6,
		defaultH: 5,
		minW: MIN_W,
		minH: MIN_H,
		// The reason this field is a list: equity against a mortgage means
		// nothing unless both halves of the comparison exist.
		modules: ['property', 'loans']
	},
	{
		key: 'energy',
		title: 'Energy this month',
		emoji: '⚡',
		defaultW: 6,
		defaultH: 5,
		minW: MIN_W,
		minH: MIN_H,
		modules: ['home']
	},
	{
		key: 'investments',
		title: 'Portfolio',
		emoji: '📊',
		defaultW: 6,
		defaultH: 5,
		minW: MIN_W,
		minH: MIN_H,
		modules: ['investments']
	},
	{
		key: 'retirement',
		title: 'Retirement outlook',
		emoji: '🎯',
		defaultW: 6,
		defaultH: 5,
		minW: MIN_W,
		minH: MIN_H,
		modules: ['retirement']
	},
	{
		key: 'tax',
		title: 'Tax position',
		emoji: '🧾',
		defaultW: 6,
		defaultH: 6,
		minW: MIN_W,
		minH: MIN_H,
		modules: ['tax']
	},
	{
		// Named `activity`, not `transactions`. V2 records a trap worth obeying:
		// `cashSplit` was defined twice for different screens and the later
		// definition silently won, so a panel rendered names with no figures.
		key: 'activity',
		title: 'Recent activity',
		emoji: '📒',
		defaultW: 6,
		defaultH: 7,
		minW: MIN_W,
		minH: MIN_H,
		modules: []
	},
	{
		key: 'savings',
		title: 'Saved each month',
		emoji: '💰',
		defaultW: 6,
		defaultH: 5,
		minW: MIN_W,
		minH: MIN_H,
		modules: []
	}
];

export const PANEL_BY_KEY: Record<string, PanelDefinition> = Object.fromEntries(
	PANELS.map((panel) => [panel.key, panel])
);

/** Minimum sizes in the shape `normalise` wants. */
export const PANEL_BOUNDS: Record<string, PanelBounds> = Object.fromEntries(
	PANELS.map((panel) => [panel.key, { minW: panel.minW, minH: panel.minH }])
);

/** The definition for a key, or undefined — never something off Object.prototype. */
export function panelDefinition(key: string): PanelDefinition | undefined {
	return Object.hasOwn(PANEL_BY_KEY, key) ? PANEL_BY_KEY[key] : undefined;
}

export function panelAvailable(key: string, modules: ModuleToggles): boolean {
	const panel = panelDefinition(key);
	return panel ? panel.modules.every((module) => modules[module]) : false;
}

/**
 * What a person sees before they ever press Customise.
 *
 * This reproduces the pre-V2 Overview exactly — briefing full width, the
 * waterfall full width, then composition and upcoming side by side — so
 * upgrading to 0.3.5 changes nobody's screen. The other nine panels wait in the
 * tray: the board is opt-in, and arrives when someone customises rather than
 * when they upgrade.
 */
export const DEFAULT_LAYOUT: OverviewPlacement[] = [
	{ k: 'briefing', x: 0, y: 0, w: 12, h: 6 },
	{ k: 'flow', x: 0, y: 6, w: 12, h: 19 },
	{ k: 'composition', x: 0, y: 25, w: 6, h: 6 },
	{ k: 'upcoming', x: 6, y: 25, w: 6, h: 7 }
];
