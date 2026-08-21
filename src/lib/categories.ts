// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The category tree a fresh instance starts with: nine groups in waterfall
// order, and the leaves that hang off them.
//
// Groups used to be a constant the whole product imported, which meant a
// household whose spending did not match these nine could not say so. They are
// seeded into `category_group` on boot and read from there everywhere; this
// file is the seed, not the source of truth at runtime.

import type { EnumValue } from './enums';

export interface CategoryGroupSeed {
	key: string;
	label: string;
	/**
	 * Name of a CSS custom property, never a hex.
	 *
	 * Each token carries a hand-tuned value per theme, and the set was generated
	 * in OKLCH and validated for separation under normal, protanopic and
	 * deuteranopic vision against the card these sit on. A literal colour here
	 * would be legible in one theme and not the other.
	 */
	colorToken: string;
	role: EnumValue<'category_group.role'>;
	sort: number;
}

/**
 * Waterfall order, which is also the order colour separation was measured in:
 * "adjacent" means adjacent here. Reordering these without re-validating can
 * put two hues side by side that were only ever checked apart.
 */
export const CATEGORY_GROUP_SEED: CategoryGroupSeed[] = [
	{ key: 'income', label: 'Income', colorToken: '--series-income', role: 'income', sort: 0 },
	{ key: 'taxes', label: 'Taxes & fees', colorToken: '--series-taxes', role: 'expense', sort: 1 },
	{
		key: 'bills',
		label: 'Bills & utilities',
		colorToken: '--series-bills',
		role: 'expense',
		sort: 2
	},
	{
		key: 'subscriptions',
		label: 'Subscriptions',
		colorToken: '--series-subscriptions',
		role: 'expense',
		sort: 3
	},
	{
		key: 'health',
		label: 'Health & care',
		colorToken: '--series-health',
		role: 'expense',
		sort: 4
	},
	{
		key: 'transport',
		label: 'Transport',
		colorToken: '--series-transport',
		role: 'expense',
		sort: 5
	},
	{
		key: 'living',
		label: 'Food & lifestyle',
		colorToken: '--series-living',
		role: 'expense',
		sort: 6
	},
	{ key: 'housing', label: 'Housing', colorToken: '--series-housing', role: 'expense', sort: 7 },
	{
		key: 'savings',
		label: 'Saved & invested',
		colorToken: '--series-savings',
		role: 'savings',
		sort: 8
	}
];

/**
 * The reserve tokens, in the order they should be handed out.
 *
 * Ranked by measured separation from the nine above and from each other. The
 * first stands on its own; the next three need the series named beside them;
 * the rest are carried by their label, with colour only helping. Ten is the
 * end of it — past nineteen series, two colours are always closer than the eye
 * can separate, so a further group takes a repeated token and its label does
 * the work.
 */
export const RESERVE_COLOR_TOKENS: string[] = [
	'--series-r1',
	'--series-r2',
	'--series-r3',
	'--series-r4',
	'--series-r5',
	'--series-r6',
	'--series-r7',
	'--series-r8',
	'--series-r9',
	'--series-r10'
];

/**
 * The best colour still going spare, or null when every one is taken.
 *
 * Reserve tokens first, in their ranked order. Then any of the nine named ones
 * whose group has been deleted — a household that removes Transport frees a
 * perfectly good colour, and refusing to reuse it would report the palette as
 * exhausted while one of its best colours sat idle.
 */
export function nextFreeColorToken(taken: string[]): string | null {
	const used = new Set(taken);
	const named = CATEGORY_GROUP_SEED.map((group) => group.colorToken);
	return [...RESERVE_COLOR_TOKENS, ...named].find((token) => !used.has(token)) ?? null;
}

interface CategoryDef {
	id: string;
	groupKey: string;
	name: string;
	sort: number;
	/** Always last inside its group, whatever `sort` says. See category.isCatchAll. */
	isCatchAll?: boolean;
}

export const CATEGORY_SEED: CategoryDef[] = [
	// income
	{ id: 'salary', groupKey: 'income', name: 'Salary', sort: 0 },
	{ id: 'rent-income', groupKey: 'income', name: 'Rent received', sort: 1 },
	{ id: 'dividends', groupKey: 'income', name: 'Dividends', sort: 2 },
	// Money coming back to the household is income at the ledger level, whatever
	// prompted it — an expense claim, a refund, a shared bill settled up.
	{ id: 'reimbursements', groupKey: 'income', name: 'Reimbursements', sort: 3 },
	{ id: 'other-income', groupKey: 'income', name: 'Other income', sort: 4, isCatchAll: true },
	// taxes & fees
	{ id: 'taxes-fees', groupKey: 'taxes', name: 'Taxes & fees', sort: 0 },
	// bills & utilities — internet and phone were one leaf and could not be told
	// apart, which is one of the reported gaps.
	{ id: 'energy', groupKey: 'bills', name: 'Energy', sort: 0 },
	{ id: 'water-heating', groupKey: 'bills', name: 'Water & heating', sort: 1 },
	{ id: 'internet', groupKey: 'bills', name: 'Internet', sort: 2 },
	{ id: 'phone', groupKey: 'bills', name: 'Phone', sort: 3 },
	// subscriptions
	{ id: 'subscriptions', groupKey: 'subscriptions', name: 'Subscriptions', sort: 0 },
	// health & care
	{ id: 'pharmacy', groupKey: 'health', name: 'Pharmacy', sort: 0 },
	{ id: 'doctor-dentist', groupKey: 'health', name: 'Doctor & dentist', sort: 1 },
	// transport
	{ id: 'car-loan', groupKey: 'transport', name: 'Car loan', sort: 0 },
	{ id: 'fuel-tolls', groupKey: 'transport', name: 'Fuel & tolls', sort: 1 },
	{ id: 'car-service', groupKey: 'transport', name: 'Car service', sort: 2 },
	// food & lifestyle
	{ id: 'groceries', groupKey: 'living', name: 'Groceries', sort: 0 },
	{ id: 'eating-out', groupKey: 'living', name: 'Eating out', sort: 1 },
	{ id: 'travel', groupKey: 'living', name: 'Travel', sort: 2 },
	{ id: 'kids', groupKey: 'living', name: 'Kids', sort: 3 },
	{ id: 'everything-else', groupKey: 'living', name: 'Everything else', sort: 4, isCatchAll: true },
	// housing
	{ id: 'mortgage-main', groupKey: 'housing', name: 'Mortgage · home', sort: 0 },
	{ id: 'mortgage-rental', groupKey: 'housing', name: 'Mortgage · rental', sort: 1 },
	{ id: 'svj-insurance', groupKey: 'housing', name: 'SVJ & insurance', sort: 2 },
	// saved & invested
	{ id: 'brokerage', groupKey: 'savings', name: 'Brokerage transfers', sort: 0 },
	{ id: 'cash-buffer', groupKey: 'savings', name: 'Cash buffer', sort: 1 }
];
