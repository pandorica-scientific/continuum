// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The panel registry is the single source of truth for what can go on the
// Overview board, in the same spirit as src/lib/modules/registry.ts for
// screens. It holds no data and no arithmetic: adding another panel is one
// entry here plus one component in ./panels/, and nothing else.
//
// A panel names an icon rather than carrying a glyph of its own, so the board's
// eyebrows are drawn from the one set the rest of the app already uses.

import type { IconName } from '$lib/icons';
import type { ModuleKey, ModuleToggles } from '$lib/modules/registry';
import type { OverviewPlacement, PanelBounds } from './layout';

export interface PanelDefinition {
	key: string;
	title: string;
	icon: IconName;
	/**
	 * One line saying what the panel actually draws, for the first-run picker
	 * and nowhere else — a placed panel has its own contents to speak for it.
	 *
	 * The titles are written to sit above a panel somebody already chose, so
	 * several of them ("Paper", "Statements", "Kept each month") say almost
	 * nothing to a person meeting all eighteen at once. This is the sentence
	 * that lets them choose. Kept short and without a full stop, like every
	 * other caption on the board; a test holds both.
	 */
	description: string;
	/**
	 * Where the header's "Open →" goes. Absent for the three panels that answer
	 * a question no single screen owns — the briefing, what net worth is made of
	 * and how it moved — because a link out has to land somewhere that says more
	 * than the panel already does.
	 *
	 * A destination behind a module must be one this panel is gated on, or the
	 * board offers a link into a 404. A test holds the two together.
	 */
	href?: string;
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
		description: 'Whatever needs a decision today, and a quiet line on the days nothing does',
		icon: 'bell',
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
		description: "The month's income traced through to what it was actually spent on",
		icon: 'flow',
		href: '/cashflow',
		defaultW: 12,
		defaultH: 19,
		minW: MIN_W,
		minH: MIN_H,
		modules: []
	},
	{
		key: 'composition',
		title: 'What it is made of',
		description: 'Net worth split into cash, property and investments, against what is owed',
		icon: 'layers',
		defaultW: 6,
		defaultH: 6,
		minW: MIN_W,
		minH: MIN_H,
		modules: []
	},
	{
		key: 'upcoming',
		title: 'Next 30 days',
		description: 'Bills, renewals and dates the calendar is holding for the month ahead',
		icon: 'calendar',
		href: '/calendar',
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
		description: 'The household total month by month, and how far it has moved',
		icon: 'trend',
		defaultW: 6,
		defaultH: 5,
		minW: MIN_W,
		minH: MIN_H,
		modules: []
	},
	{
		key: 'accounts',
		title: 'Where the cash sits',
		description: 'Every account and what is in it, each as a share of the cash total',
		icon: 'bank',
		href: '/accounts',
		defaultW: 6,
		defaultH: 6,
		minW: MIN_W,
		minH: MIN_H,
		modules: []
	},
	{
		key: 'equity',
		title: 'Flats against mortgages',
		description: 'What each flat is worth against what is still owed on it',
		icon: 'buildings',
		href: '/property',
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
		description: "A bar a day of what the meters read, against the month's own average",
		icon: 'bolt',
		href: '/home',
		defaultW: 6,
		defaultH: 5,
		minW: MIN_W,
		minH: MIN_H,
		modules: ['home']
	},
	{
		key: 'investments',
		title: 'Portfolio',
		description: 'What the portfolio is worth, what went into it, and what it has gained',
		icon: 'chart',
		href: '/investments',
		defaultW: 6,
		defaultH: 5,
		minW: MIN_W,
		minH: MIN_H,
		modules: ['investments']
	},
	{
		key: 'retirement',
		title: 'Retirement outlook',
		description: 'Whether the pension is on course, in one line and one colour',
		icon: 'target',
		href: '/retirement',
		defaultW: 6,
		defaultH: 5,
		minW: MIN_W,
		minH: MIN_H,
		modules: ['retirement']
	},
	{
		key: 'tax',
		title: 'Tax position',
		description: 'What each filer earned and paid for the year, and at what rate',
		icon: 'receipt',
		href: '/tax',
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
		description: 'The last transactions to land, newest first, with what each was filed as',
		icon: 'ledger',
		href: '/transactions',
		defaultW: 6,
		defaultH: 7,
		minW: MIN_W,
		minH: MIN_H,
		modules: []
	},
	{
		key: 'savings',
		title: 'Kept each month',
		description: 'What was left over each month, and what share of income that came to',
		icon: 'coins',
		href: '/cashflow',
		defaultW: 6,
		defaultH: 5,
		minW: MIN_W,
		minH: MIN_H,
		modules: []
	},
	{
		key: 'paper',
		title: 'Paper',
		description: 'What is unfiled, what lapses soon, and which shelf the rest of it is on',
		icon: 'folders',
		href: '/documents',
		defaultW: 6,
		defaultH: 6,
		minW: MIN_W,
		minH: MIN_H,
		modules: ['documents']
	},
	{
		key: 'statements',
		title: 'Statements',
		description: 'Which accounts are up to date on statements, and which have gone quiet',
		icon: 'inbox',
		href: '/import',
		defaultW: 6,
		defaultH: 6,
		minW: MIN_W,
		minH: MIN_H,
		modules: ['import']
	},
	{
		key: 'salary',
		title: 'Salary',
		description: 'The last month each person was paid for, against the month before it',
		icon: 'wallet',
		href: '/salary',
		defaultW: 6,
		defaultH: 5,
		minW: MIN_W,
		minH: MIN_H,
		modules: ['salary']
	},
	{
		key: 'debts',
		title: 'Debts',
		description: 'Every loan, what is left on it, and when its rate stops being settled',
		icon: 'card',
		href: '/loans',
		defaultW: 6,
		defaultH: 5,
		minW: MIN_W,
		minH: MIN_H,
		modules: ['loans']
	},
	{
		// Named for the question rather than for the noun: "Budget" promises a
		// figure somebody set, and nobody set one. What this shows is the month
		// against what the months before it usually cost.
		key: 'budget',
		title: 'Month against its average',
		description: "This month's spending beside what the twelve months before it usually cost",
		icon: 'bars',
		href: '/cashflow',
		defaultW: 6,
		defaultH: 6,
		minW: MIN_W,
		minH: MIN_H,
		modules: []
	}
];

const PANEL_BY_KEY: Record<string, PanelDefinition> = Object.fromEntries(
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
 * The board offered rather than imposed: what "Use the suggested board" on the
 * first-run picker puts down, and what Reset goes back to.
 *
 * Briefing full width, the cash-flow chart full width, then composition and
 * upcoming side by side — the four that answer the questions the app is opened
 * for. Nobody is given it silently: a person with no stored arrangement gets
 * the picker and an empty board, and this is one press away from there.
 *
 * Only the ARRANGEMENT lives here. Every size is read from the panel's own
 * definition, because this list used to restate them — and the moment the
 * briefing panel's default height was reduced, the definition said three rows,
 * this said six, and the screen went on drawing six. A suggested board that
 * disagrees with the panels it is made of is the kind of thing that looks like
 * a rendering bug for a week.
 */
export const SUGGESTED_LAYOUT: OverviewPlacement[] = (() => {
	const stack: OverviewPlacement[] = [];
	const place = (k: string, x: number, y: number): number => {
		const panel = panelDefinition(k);
		if (!panel) throw new Error(`The suggested layout names a panel that does not exist: ${k}`);
		stack.push({ k, x, y, w: panel.defaultW, h: panel.defaultH });
		return y + panel.defaultH;
	};

	let y = place('briefing', 0, 0);
	y = place('flow', 0, y);
	place('composition', 0, y);
	place('upcoming', 6, y);
	return stack;
})();
