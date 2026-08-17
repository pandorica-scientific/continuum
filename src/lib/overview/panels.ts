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
		// One row of cards, and no more. At six rows (320px of grid plus the
		// panel's own chrome) this owned the top third of the first screen
		// whatever was in it — and what is in it is usually one line saying
		// nothing needs a decision. It sits above everything else precisely
		// because it is the first thing to read, which is the worst place to
		// spend empty space: it pushed the cash-flow chart, the reason most
		// people open the app at all, entirely below the fold.
		//
		// Four rows, which is what a full row of briefing cards actually needs:
		// at three the panel is 152px all-in, and once the header and padding
		// take their share the cards are clipped mid-sentence — a card whose
		// last line is cut off is worse than the empty space this is trimming.
		// A household with more than a row's worth can drag it taller, and that
		// choice is stored against them.
		defaultH: 4,
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
 * Briefing full width, the cash-flow chart full width, then composition and
 * upcoming side by side. The other nine panels wait in the tray: the board is
 * opt-in, and arrives when someone customises rather than when they upgrade.
 *
 * Only the ARRANGEMENT lives here. Every size is read from the panel's own
 * definition, because this list used to restate them — and the moment the
 * briefing panel's default height was reduced, the definition said three rows,
 * this said six, and the screen went on drawing six. A default board that
 * disagrees with the panels it is made of is the kind of thing that looks like
 * a rendering bug for a week.
 */
export const DEFAULT_LAYOUT: OverviewPlacement[] = (() => {
	const stack: OverviewPlacement[] = [];
	const place = (k: string, x: number, y: number): number => {
		const panel = panelDefinition(k);
		if (!panel) throw new Error(`Default layout names a panel that does not exist: ${k}`);
		stack.push({ k, x, y, w: panel.defaultW, h: panel.defaultH });
		return y + panel.defaultH;
	};

	let y = place('briefing', 0, 0);
	y = place('flow', 0, y);
	place('composition', 0, y);
	place('upcoming', 6, y);
	return stack;
})();
