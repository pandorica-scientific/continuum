// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The banks a fresh instance starts with, and nothing more.
//
// These used to be a hardcoded <option> list on the accounts screen plus a
// parallel emoji map in its loader — two places to edit, and no way for a
// household banking somewhere else to say so. They are seeded into `bank` on
// boot; adding one from the accounts screen writes a row like any other.

export interface BankSeed {
	key: string;
	label: string;
	emoji: string;
}

export const BANK_SEED: BankSeed[] = [
	{ key: 'fio', label: 'Fio banka', emoji: '🏦' },
	{ key: 'revolut', label: 'Revolut', emoji: '💠' },
	{ key: 'mbank', label: 'mBank', emoji: '🅜' },
	{ key: 'rb', label: 'Raiffeisenbank', emoji: '🟡' },
	{ key: 'cs', label: 'Česká spořitelna', emoji: '🔵' },
	// The fallback every import can always resolve to. Kept as a real row so
	// account.bank can carry a foreign key without a special case.
	{ key: 'other', label: 'Other', emoji: '💼' }
];

/**
 * A stable key for a bank name somebody typed.
 *
 * Lowercased, punctuation and diacritics reduced to hyphens: "Česká spořitelna"
 * becomes "ceska-sporitelna". Keys are what statements and import profiles are
 * matched on, so they must not change when a label is edited later.
 */
export function bankKeyFor(label: string): string {
	return label
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}
