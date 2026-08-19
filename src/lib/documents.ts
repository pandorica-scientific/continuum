// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Shelf definitions shared by the documents screen and its form.

import { ENUMS } from '$lib/enums';

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

/** Derived, so the document form and the CHECK on document.expiry_verb agree. */
export const EXPIRY_VERBS = ENUMS['document.expiry_verb'];
