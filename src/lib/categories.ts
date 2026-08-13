// The category tree the whole product shares: 6 expense groups in waterfall
// order plus income. Groups carry the series colour; the 17 leaves live in
// the breakdown strip, never as chart labels.

export interface CategoryGroup {
	key: string;
	label: string;
	/** CSS custom property name of the series colour. */
	colorVar: string;
	/** Waterfall stage order; income is not a stage. */
	order: number;
}

export const CATEGORY_GROUPS: CategoryGroup[] = [
	{ key: 'income', label: 'Income', colorVar: '--green', order: 0 },
	{ key: 'taxes', label: 'Taxes & fees', colorVar: '--red', order: 1 },
	{ key: 'bills', label: 'Bills & utilities', colorVar: '--orange', order: 2 },
	{ key: 'transport', label: 'Transport', colorVar: '--yellow', order: 3 },
	{ key: 'living', label: 'Food & lifestyle', colorVar: '--purple', order: 4 },
	{ key: 'housing', label: 'Housing', colorVar: '--blue', order: 5 },
	{ key: 'savings', label: 'Saved & invested', colorVar: '--teal', order: 6 }
];

export interface CategoryDef {
	id: string;
	groupKey: string;
	name: string;
	sort: number;
}

export const CATEGORY_SEED: CategoryDef[] = [
	// income
	{ id: 'salary', groupKey: 'income', name: 'Salary', sort: 0 },
	{ id: 'rent-income', groupKey: 'income', name: 'Rent received', sort: 1 },
	{ id: 'dividends', groupKey: 'income', name: 'Dividends', sort: 2 },
	{ id: 'other-income', groupKey: 'income', name: 'Other income', sort: 3 },
	// taxes & fees
	{ id: 'taxes-fees', groupKey: 'taxes', name: 'Taxes & fees', sort: 0 },
	// bills & utilities
	{ id: 'energy', groupKey: 'bills', name: 'Energy', sort: 0 },
	{ id: 'water-heating', groupKey: 'bills', name: 'Water & heating', sort: 1 },
	{ id: 'internet-phone', groupKey: 'bills', name: 'Internet & phone', sort: 2 },
	// transport
	{ id: 'car-loan', groupKey: 'transport', name: 'Car loan', sort: 0 },
	{ id: 'fuel-tolls', groupKey: 'transport', name: 'Fuel & tolls', sort: 1 },
	{ id: 'car-service', groupKey: 'transport', name: 'Car service', sort: 2 },
	// food & lifestyle
	{ id: 'groceries', groupKey: 'living', name: 'Groceries', sort: 0 },
	{ id: 'eating-out', groupKey: 'living', name: 'Eating out', sort: 1 },
	{ id: 'travel', groupKey: 'living', name: 'Travel', sort: 2 },
	{ id: 'kids', groupKey: 'living', name: 'Kids', sort: 3 },
	{ id: 'everything-else', groupKey: 'living', name: 'Everything else', sort: 4 },
	// housing
	{ id: 'mortgage-main', groupKey: 'housing', name: 'Mortgage · home', sort: 0 },
	{ id: 'mortgage-rental', groupKey: 'housing', name: 'Mortgage · rental', sort: 1 },
	{ id: 'svj-insurance', groupKey: 'housing', name: 'SVJ & insurance', sort: 2 },
	// saved & invested
	{ id: 'brokerage', groupKey: 'savings', name: 'Brokerage transfers', sort: 0 },
	{ id: 'cash-buffer', groupKey: 'savings', name: 'Cash buffer', sort: 1 }
];
