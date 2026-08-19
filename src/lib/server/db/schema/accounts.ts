// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * The ledger: accounts, the statements read into them, and the transactions,
 * splits, transfers and rules that come out.
 */

import { sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	date,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
// Relative, not aliased: drizzle-kit loads these files outside Vite and
// does not resolve SvelteKit's $lib.
import type { EnumValue } from '../../../enums';
import { person } from './auth';
import { tag } from './documents';
import { currency } from './money';

// ---- Accounts and transactions ----

export const account = pgTable(
	'account',
	{
		id: uuid('id').primaryKey(),
		name: text('name').notNull(),
		emoji: text('emoji').notNull().default('🏦'),
		bank: text('bank').notNull(), // fio | revolut | mbank | rb | cs | other
		kind: text('kind').$type<EnumValue<'account.kind'>>().notNull().default('current'),
		currency: text('currency')
			.notNull()
			.references(() => currency.code),
		ownerPersonId: uuid('owner_person_id').references(() => person.id, { onDelete: 'set null' }),
		// bank account number / IBAN in the form statements print it; used to
		// recognise transfers between the household's own accounts
		numbers: jsonb('numbers').$type<string[]>().notNull().default([]),
		// authoritative balance: the closing balance of the newest imported
		// statement (minor units of `currency`), not a sum over transactions
		balanceMinor: bigint('balance_minor', { mode: 'bigint' })
			.notNull()
			.default(sql`0`),
		balanceOn: date('balance_on'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('account_currency_idx').on(table.currency),
		index('account_owner_person_idx').on(table.ownerPersonId)
	]
);

export const importFile = pgTable(
	'import_file',
	{
		id: uuid('id').primaryKey(),
		filename: text('filename').notNull(),
		bank: text('bank').notNull(),
		format: text('format').notNull(),
		accountId: uuid('account_id').references(() => account.id, { onDelete: 'set null' }),
		// sha256 of the file body; the same file uploaded twice is skipped whole
		contentHash: text('content_hash').notNull().unique(),
		// the original bytes, kept on the data volume — parser improvements can
		// re-parse history instead of asking for seven years of re-uploads
		storedName: text('stored_name'),
		rowsRead: integer('rows_read').notNull().default(0),
		rowsAdded: integer('rows_added').notNull().default(0),
		rowsDuplicate: integer('rows_duplicate').notNull().default(0),
		rowsPaired: integer('rows_paired').notNull().default(0),
		/**
		 * How the statement was read, and what proved it.
		 *
		 * The proof engine decided whether to file this statement and then threw its
		 * evidence away, so the ledger held numbers with no account of where they
		 * came from. Keeping it means a row that turns out to be wrong can be traced
		 * to the reading that produced it, and that "everything that came from OCR"
		 * is a query rather than a guess.
		 */
		// NOT NULL since 0052: a statement filed with no record of what read it, or
		// of how strongly it was proven, is the one thing these columns exist to
		// prevent. The declaration said nullable while the database said otherwise
		// until the baseline made the two agree.
		sourceMethod: text('source_method').notNull(),
		proofClass: text('proof_class').$type<EnumValue<'proof_class'>>().notNull(),
		ledgerModel: text('ledger_model'),
		currency: text('currency')
			.notNull()
			.references(() => currency.code),
		openingBalanceMinor: bigint('opening_balance_minor', { mode: 'bigint' }),
		closingBalanceMinor: bigint('closing_balance_minor', { mode: 'bigint' }),
		statedCreditTotalMinor: bigint('stated_credit_total_minor', { mode: 'bigint' }),
		statedDebitTotalMinor: bigint('stated_debit_total_minor', { mode: 'bigint' }),
		statedRowCount: integer('stated_row_count'),
		/** Each check as the evidence panel shows it: name, status, detail. */
		reconciliation: jsonb('reconciliation').$type<ProofCheckRecord[] | null>(),
		uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('import_file_currency_idx').on(table.currency),
		index('import_file_account_idx').on(table.accountId)
	]
);

/** One line of a statement's evidence, as stored. */
export interface ProofCheckRecord {
	name: string;
	status: 'pass' | 'fail' | 'unavailable';
	detail: string;
}

/**
 * A remembered statement layout.
 *
 * Matched by `signature` — a hash over the header LABELS, not their positions.
 * Position-based mapping breaks silently the moment a bank inserts a column;
 * a label-based signature turns that same change into a mismatch we can ask
 * the user about.
 */
export const importProfile = pgTable('import_profile', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	bank: text('bank'),
	// 'delimited' | 'xlsx'
	source: text('source').notNull(),
	encoding: text('encoding'),
	delimiter: text('delimiter'),
	signature: text('signature').notNull(),
	headers: jsonb('headers').$type<string[]>().notNull().default([]),
	// { columns: [{header, role}], dateOrder, decimalMark, currency? } — typed
	// at the import layer, which owns the shape
	mapping: jsonb('mapping').notNull(),
	// bumped when a drifted layout is re-confirmed; earlier files keep parsing
	// under the version they were imported with
	version: integer('version').notNull().default(1),
	// a person confirmed this mapping against a preview of their own rows
	verified: boolean('verified').notNull().default(false),
	// 'builtin' | 'user' | 'imported'
	origin: text('origin').$type<EnumValue<'import_profile.origin'>>().notNull().default('user'),
	filenamePattern: text('filename_pattern'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const category = pgTable('category', {
	id: text('id').primaryKey(),
	// group drives colour and the waterfall stage: income | taxes | bills |
	// transport | living | housing | savings
	groupKey: text('group_key').notNull(),
	name: text('name').notNull(),
	sort: integer('sort').notNull().default(0)
});

export const transaction = pgTable(
	'transaction',
	{
		id: uuid('id').primaryKey(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => account.id, { onDelete: 'cascade' }),
		bookedOn: date('booked_on').notNull(),
		// the value date (valuta / data operacji / started date) when the bank
		// prints one — cashflow prefers it so month-boundary spending lands in
		// the month the money actually moved
		valueOn: date('value_on'),
		// minor units of `currency`; negative = money out. Gross of any fee.
		amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
		// separate bank fee on this movement (positive minor units)
		feeMinor: bigint('fee_minor', { mode: 'bigint' }),
		currency: text('currency')
			.notNull()
			.references(() => currency.code),
		// account balance after this movement, when the statement prints it —
		// the column that lets the ledger reconcile against the bank
		balanceAfterMinor: bigint('balance_after_minor', { mode: 'bigint' }),
		// original amount for foreign-currency card payments billed in the
		// account currency
		originalAmountMinor: bigint('original_amount_minor', { mode: 'bigint' }),
		originalCurrency: text('original_currency').references(() => currency.code),
		counterparty: text('counterparty'),
		counterpartyAccount: text('counterparty_account'),
		variableSymbol: text('variable_symbol'),
		constantSymbol: text('constant_symbol'),
		specificSymbol: text('specific_symbol'),
		description: text('description'),
		bankRef: text('bank_ref'),
		dedupFingerprint: text('dedup_fingerprint').notNull(),
		// which fingerprint algorithm produced dedupFingerprint — parser
		// changes bump this and re-parse from stored files
		fingerprintVersion: integer('fingerprint_version').notNull().default(1),
		categoryId: text('category_id').references(() => category.id, { onDelete: 'set null' }),
		// What the engine would file this as, shown in the review queue so a
		// contested or unproven row arrives with a guess rather than nothing.
		suggestedCategoryId: text('suggested_category_id').references(() => category.id, {
			onDelete: 'set null'
		}),
		// auto = categorised by rule, needs_review = ambiguous, confirmed = user decided
		reviewState: text('review_state')
			.$type<EnumValue<'transaction.review_state'>>()
			.notNull()
			.default('needs_review'),
		reviewReason: text('review_reason'),
		importFileId: uuid('import_file_id').references(() => importFile.id, { onDelete: 'set null' }),
		// How this row was read and how strongly it was proven, carried on the row
		// itself so it can answer for its own origin even after the file it came
		// from has been re-parsed or superseded.
		sourceMethod: text('source_method'),
		proofClass: text('proof_class').$type<EnumValue<'proof_class'>>(),
		transferPairId: uuid('transfer_pair_id')
	},
	(table) => [
		index('transaction_currency_idx').on(table.currency),
		index('transaction_original_currency_idx').on(table.originalCurrency),
		uniqueIndex('transaction_dedup_idx').on(table.accountId, table.dedupFingerprint),
		index('transaction_booked_on_idx').on(table.bookedOn),
		index('transaction_review_idx').on(table.reviewState),
		index('transaction_category_idx').on(table.categoryId),
		index('transaction_suggested_category_idx').on(table.suggestedCategoryId),
		index('transaction_import_file_idx').on(table.importFileId)
	]
);

// A legacy parser fingerprint can name the same movement as a current
// fingerprint even when the old stored row cannot be reconstructed exactly
// (notably Revolut v1 rows whose fee was folded into amount). Replay records
// the current fingerprint here without rewriting the user's historical row.
export const transactionFingerprintAlias = pgTable(
	'transaction_fingerprint_alias',
	{
		accountId: uuid('account_id')
			.notNull()
			.references(() => account.id, { onDelete: 'cascade' }),
		fingerprint: text('fingerprint').notNull(),
		transactionId: uuid('transaction_id')
			.notNull()
			.references(() => transaction.id, { onDelete: 'cascade' })
	},
	(table) => [
		primaryKey({ columns: [table.accountId, table.fingerprint] }),
		index('transaction_fingerprint_alias_transaction_idx').on(table.transactionId)
	]
);

// A matched pair of legs moving money between the household's own accounts.
// Confirmed/auto legs point back via transaction.transferPairId (a soft
// pointer, to avoid an FK cycle); proposed pairs exist only here until the
// user confirms them.
export const transferPair = pgTable(
	'transfer_pair',
	{
		id: uuid('id').primaryKey(),
		outTransactionId: uuid('out_transaction_id')
			.notNull()
			.references(() => transaction.id, { onDelete: 'cascade' }),
		inTransactionId: uuid('in_transaction_id')
			.notNull()
			.references(() => transaction.id, { onDelete: 'cascade' }),
		state: text('state').$type<EnumValue<'transfer_pair.state'>>().notNull().default('auto'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('transfer_pair_out_transaction_idx').on(table.outTransactionId),
		index('transfer_pair_in_transaction_idx').on(table.inTransactionId)
	]
);

// A transaction can be claimed by only one active pair, regardless of whether
// it is the outgoing or incoming leg. Migration 0027 maintains this normalized
// relation from transfer_pair with a trigger so one primary key covers the
// cross-column uniqueness that two ordinary indexes cannot express.
//
// The rows are written by the maintain_transfer_pair_legs() trigger, never by
// application code. Drizzle models tables, not triggers: this declaration
// cannot recreate it, `db:generate` cannot notice it going missing, and a
// database materialised with `drizzle-kit push` would have the table without
// the constraint it exists to enforce. Apply migrations to build the schema.
export const transferPairLeg = pgTable(
	'transfer_pair_leg',
	{
		transactionId: uuid('transaction_id')
			.primaryKey()
			.references(() => transaction.id, { onDelete: 'cascade' }),
		pairId: uuid('pair_id')
			.notNull()
			.references(() => transferPair.id, { onDelete: 'cascade' })
	},
	(table) => [index('transfer_pair_leg_pair_idx').on(table.pairId)]
);

export const markTransferRule = pgTable('mark_transfer_rule', {
	id: text('id').primaryKey(),
	counterpartyAccount: text('counterparty_account').notNull().unique(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

// ---- Splits and tags ----

// A transaction divided between categories. Absent for the ordinary case: an
// unsplit transaction has no rows here and keeps its own categoryId.
export const transactionSplit = pgTable(
	'transaction_split',
	{
		id: uuid('id').primaryKey(),
		transactionId: uuid('transaction_id')
			.notNull()
			.references(() => transaction.id, { onDelete: 'cascade' }),
		// minor units of the parent transaction's currency, same sign as the parent
		amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
		categoryId: text('category_id').references(() => category.id, { onDelete: 'set null' }),
		note: text('note'),
		sort: integer('sort').notNull().default(0)
	},
	(table) => [
		index('transaction_split_txn_idx').on(table.transactionId),
		index('transaction_split_category_idx').on(table.categoryId)
	]
);

// ---- Rules ----

// An unordered rule: every condition must hold. Category is exclusive and can
// contest with another rule; tags are additive and always apply. There is
// deliberately no unique index on the conditions — two rules claiming the same
// counterparty is what makes a contested row possible.
export const rule = pgTable(
	'rule',
	{
		id: uuid('id').primaryKey(),
		name: text('name').notNull(),
		enabled: boolean('enabled').notNull().default(true),
		// learned | manual. 'seeded' existed while a fresh install shipped 42 starter
		// rules; migration 0033 retired it and no code writes it any more.
		provenance: text('provenance')
			.$type<EnumValue<'rule.provenance'>>()
			.notNull()
			.default('learned'),
		// [{ field, op, value }], ANDed. Read only ever as a set with its rule.
		conditions: jsonb('conditions').notNull(),
		categoryId: text('category_id').references(() => category.id, { onDelete: 'set null' }),
		// Evidence, not a tuned weight: confidence is derived from these.
		acceptedCount: integer('accepted_count').notNull().default(0),
		correctedCount: integer('corrected_count').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('rule_category_idx').on(table.categoryId)]
);

export const ruleTag = pgTable(
	'rule_tag',
	{
		ruleId: uuid('rule_id')
			.notNull()
			.references(() => rule.id, { onDelete: 'cascade' }),
		tagId: uuid('tag_id')
			.notNull()
			.references(() => tag.id, { onDelete: 'cascade' })
	},
	(table) => [
		primaryKey({ columns: [table.ruleId, table.tagId] }),
		index('rule_tag_tag_idx').on(table.tagId)
	]
);
