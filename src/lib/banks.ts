// SPDX-License-Identifier: AGPL-3.0-or-later
// The banks a fresh instance starts with, and nothing more.
//
// Seeded into `bank` on boot; adding one from the accounts screen writes a
// row like any other.

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

	// The euro area, so an account there can be named without typing the bank
	// in first. A list, not a registry: these are the institutions a household
	// in the euro area is most likely to hold an account with, and anything
	// missing is still one "add a bank" away. Seeded with
	// `onConflictDoNothing`, so a household that has already edited or added
	// any of these keeps what they have.
	//
	// The emoji is the bank's own colour where it has an unmistakable one, and
	// a plain 🏦 where it does not. It is what shows until a logo file is
	// present, and what goes on showing for anyone who never fetches one — see
	// `assets/bank-logos/README.md`.
	{ key: 'n26', label: 'N26', emoji: '⚫' },
	{ key: 'wise', label: 'Wise', emoji: '🟢' },
	{ key: 'bunq', label: 'bunq', emoji: '🌈' },
	{ key: 'ing', label: 'ING', emoji: '🟠' },
	{ key: 'deutsche-bank', label: 'Deutsche Bank', emoji: '🔷' },
	{ key: 'commerzbank', label: 'Commerzbank', emoji: '🟡' },
	{ key: 'sparkasse', label: 'Sparkasse', emoji: '🔴' },
	{ key: 'dkb', label: 'DKB', emoji: '🔵' },
	{ key: 'bnp-paribas', label: 'BNP Paribas', emoji: '🟩' },
	{ key: 'credit-agricole', label: 'Crédit Agricole', emoji: '🟩' },
	{ key: 'societe-generale', label: 'Société Générale', emoji: '🔴' },
	{ key: 'santander', label: 'Santander', emoji: '🔴' },
	{ key: 'bbva', label: 'BBVA', emoji: '🔵' },
	{ key: 'caixabank', label: 'CaixaBank', emoji: '🔵' },
	{ key: 'unicredit', label: 'UniCredit', emoji: '🔴' },
	{ key: 'intesa', label: 'Intesa Sanpaolo', emoji: '🟢' },
	{ key: 'abn-amro', label: 'ABN AMRO', emoji: '🟢' },
	{ key: 'rabobank', label: 'Rabobank', emoji: '🟠' },
	{ key: 'kbc', label: 'KBC', emoji: '🔵' },
	{ key: 'belfius', label: 'Belfius', emoji: '🔴' },
	{ key: 'erste', label: 'Erste Bank', emoji: '🔵' },
	{ key: 'bank-of-ireland', label: 'Bank of Ireland', emoji: '🔵' },
	{ key: 'aib', label: 'AIB', emoji: '🟢' },
	{ key: 'nordea', label: 'Nordea', emoji: '🔵' },
	{ key: 'op', label: 'OP', emoji: '🟠' },
	{ key: 'pko', label: 'PKO Bank Polski', emoji: '🔵' },

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

/**
 * The order banks are offered in when somebody is choosing one.
 *
 * Alphabetical among the real institutions, with "Other" last — it is a
 * fallback rather than a bank, so it never sorts into the middle by label.
 * The "add a bank" control is not in this list; the markup renders it after
 * these options.
 *
 * `localeCompare` rather than `<`, so accented labels sort correctly.
 */
const FALLBACK_KEY = 'other';

export function orderBanksForChoosing<T extends { key: string; label: string }>(banks: T[]): T[] {
	return [...banks].sort((a, b) => {
		if (a.key === FALLBACK_KEY) return b.key === FALLBACK_KEY ? 0 : 1;
		if (b.key === FALLBACK_KEY) return -1;
		return a.label.localeCompare(b.label);
	});
}
