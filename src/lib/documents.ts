// Shelf definitions shared by the documents screen and its form.

export const SHELVES = [
	{ key: 'payslips', label: 'Payslips' },
	{ key: 'tax', label: 'Tax' },
	{ key: 'identity', label: 'Identity' },
	{ key: 'family', label: 'Family' },
	{ key: 'health', label: 'Health & wellbeing' },
	{ key: 'property', label: 'Property' },
	{ key: 'tenancy', label: 'Tenancy' },
	{ key: 'loans', label: 'Loans' },
	{ key: 'insurance', label: 'Insurance' }
] as const;

export type ShelfKey = (typeof SHELVES)[number]['key'];

export const EXPIRY_VERBS = ['expires', 'ends', 'renews', 'due'] as const;
