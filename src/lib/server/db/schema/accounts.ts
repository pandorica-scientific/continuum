// SPDX-License-Identifier: AGPL-3.0-or-later
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
import { document, tag } from './documents';
import { currency } from './money';

// ---- Accounts and transactions ----

/**
 * The banks an account can belong to.
 *
 * A table rather than the hardcoded `<option>` list and emoji map it replaces:
 * the five Czech banks in the code were the five the author happened to use,
 * and a household with a sixth had to pick "Other" and lose the name of their
 * own bank. Seeded with those five plus Other; anything else is added from the
 * accounts screen.
 */
export const bank = pgTable('bank', {
	key: text('key').primaryKey(),
	label: text('label').notNull(),
	emoji: text('emoji').notNull().default('🏦')
});

export const account = pgTable(
	'account',
	{
		id: uuid('id').primaryKey(),
		name: text('name').notNull(),
		emoji: text('emoji').notNull().default('🏦'),
		// Deliberately NOT a foreign key into `bank`. That table is the list the
		// picker offers and where a label and emoji are looked up — it is not the
		// set of values this column may hold. Accounts created before routing
		// became format-first carry a FORMAT name here (`tabular`, `camt053`), and
		// import-integrity pins that; constraining the column would turn those
		// rows, and any future adapter naming a new issuer, into a raw constraint
		// error at import time. Unknown keys fall back to a default emoji.
		bank: text('bank').notNull(),
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
		 * When somebody said they had finished looking at this import.
		 *
		 * Hides the row from the recent-imports list and nothing else: the record,
		 * its transactions, its stored file and its document all stay exactly where
		 * they are, and the content hash still makes a re-upload a duplicate.
		 */
		acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
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
		/**
		 * The statement filed on a shelf, as one document among all the others.
		 *
		 * An import used to keep its own copy of the file and the documents screen
		 * kept another, so the same statement existed twice with nothing tying the
		 * two together. RESTRICT rather than SET NULL: the document IS the evidence
		 * for every row this import wrote, so deleting it has to be refused rather
		 * than quietly leaving an import that can no longer show what it read.
		 *
		 * Nullable, because an import filed before the two were joined has no
		 * document to point at.
		 */
		documentId: uuid('document_id').references(() => document.id, { onDelete: 'restrict' }),
		uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('import_file_currency_idx').on(table.currency),
		index('import_file_account_idx').on(table.accountId),
		index('import_file_document_idx').on(table.documentId)
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

/**
 * The top level of the category tree: what drives a series colour and where the
 * group sits in the waterfall.
 *
 * A table rather than the constant it replaces, because a household's spending
 * does not match the seven groups somebody else chose — the reported gaps were
 * health and subscriptions, and the next household will have different ones.
 *
 * `role` is the column that cannot be left out. The waterfall is not a flat
 * ordering: income opens it, expense groups are its stages, savings closes it.
 * A group with a colour and a sort order but no role has no defined place in
 * the chart, and "income" is not merely "the group that happens to sort first".
 */
export const categoryGroup = pgTable('category_group', {
	key: text('key').primaryKey(),
	label: text('label').notNull(),
	// Name of a CSS custom property, e.g. `--series-housing`. A token rather
	// than a hex: each one carries a hand-tuned value per theme, and the set was
	// validated for separation under colour-vision deficiency. A literal colour
	// here would be legible in one theme and not the other.
	colorToken: text('color_token').notNull(),
	role: text('role').$type<EnumValue<'category_group.role'>>().notNull().default('expense'),
	sort: integer('sort').notNull().default(0)
});

export const category = pgTable(
	'category',
	{
		id: text('id').primaryKey(),
		groupKey: text('group_key')
			.notNull()
			.references(() => categoryGroup.key),
		name: text('name').notNull(),
		sort: integer('sort').notNull().default(0),
		/**
		 * A catch-all: "Everything else", "Other income". Always last inside its
		 * group, whatever `sort` says, and not draggable.
		 *
		 * A flag rather than a name match, so a household that renames "Everything
		 * else" to "Odds and ends" keeps the behaviour. Whether a category is a
		 * catch-all is a fact about how the household thinks, not about the seed.
		 */
		isCatchAll: boolean('is_catch_all').notNull().default(false)
	},
	// The foreign key into category_group needs its own index: deleting a group
	// otherwise scans every category to find out whether it may go. Every
	// foreign key carries one, and schema-invariants.test.ts holds it to that.
	(table) => [index('category_group_key_idx').on(table.groupKey)]
);

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
		/**
		 * A transfer to one of the household's own accounts that has no matching
		 * leg, asserted by a person rather than proved by two statements.
		 *
		 * Pairing needs both sides. Money moved to a savings account whose
		 * statements are never imported has one side only, so nothing matches and
		 * the row sits in the review queue looking like unexplained spending —
		 * which is what "transfer to savings account" was reported as missing.
		 *
		 * Kept separate from `transfer_pair_id` rather than folded into it: a
		 * matched pair is evidence from two statements, this is a claim by a
		 * person, and a later import that does supply the second leg should be
		 * able to tell them apart.
		 */
		transferToAccountId: uuid('transfer_to_account_id').references(() => account.id, {
			onDelete: 'set null'
		}),
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
		index('transaction_import_file_idx').on(table.importFileId),
		index('transaction_transfer_to_account_idx').on(table.transferToAccountId)
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
// it is the outgoing or incoming leg. `transferPairSql` below maintains this
// normalised relation from transfer_pair with a trigger so one primary key
// covers the cross-column uniqueness that two ordinary indexes cannot express.
//
// The rows are written by the maintain_transfer_pair_legs() trigger, never by
// application code. Drizzle models tables, not triggers: this declaration
// cannot recreate it, `db:generate` cannot notice it going missing, and a
// database materialised with `drizzle-kit push` would have the table without
// the constraint it exists to enforce. Apply migrations to build the schema.
// `npm run scan:unused` reports this as unreferenced and it must stay exported
// anyway: drizzle-kit builds the schema from what this module exports, so
// un-exporting the table would take it out of the model — and the next
// `db:generate` would emit a DROP for a table the trigger still writes to.
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
		// rules; it was retired before the v0.3.10 squash and nothing writes it now.
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

// ---- SQL drizzle-kit cannot model ----

/**
 * The date a movement is read on.
 *
 * Cash flow, the month steppers and the register all measure a window on the
 * day the money moved: the value date where the bank printed one, the booking
 * date otherwise. That is an expression, not a column, so
 * `transaction_booked_on_idx` cannot serve a bound on it and a register opening
 * one month would read the whole ledger to find it. The booked_on index stays:
 * import replay, deduplication and the statement-period checks still ask for the
 * day the bank booked.
 */
export const transactionEffectiveOnSql = `
CREATE INDEX "transaction_effective_on_idx" ON "transaction"
	(coalesce("value_on", "booked_on"));
`;

/**
 * Active pair legs are claims.
 *
 * Keeping them in a separate relation lets one unique constraint cover both the
 * outgoing and incoming columns, including the cross-column collision ordinary
 * indexes cannot prevent. The table itself is a Drizzle declaration above; what
 * cannot be is the trigger that keeps it in step, so a pair can never be active
 * without its two legs claimed.
 */
export const transferPairSql = `
CREATE FUNCTION maintain_transfer_pair_legs() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'UPDATE' AND OLD.state IN ('auto', 'proposed', 'confirmed') THEN
		DELETE FROM transfer_pair_leg WHERE pair_id = OLD.id;
	END IF;

	IF NEW.state IN ('auto', 'proposed', 'confirmed') THEN
		INSERT INTO transfer_pair_leg (transaction_id, pair_id)
		VALUES (NEW.out_transaction_id, NEW.id), (NEW.in_transaction_id, NEW.id);
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER transfer_pair_leg_claims
AFTER INSERT OR UPDATE OF state, out_transaction_id, in_transaction_id ON transfer_pair
FOR EACH ROW EXECUTE FUNCTION maintain_transfer_pair_legs();
`;

/**
 * The reference rows a foreign key points at, so an empty table does not refuse
 * every insert that follows. `seedBanks()` and `seedCategories()` rewrite them
 * idempotently on every boot, so this is a floor rather than a source of truth.
 */
export const accountsSeedSql = `
INSERT INTO "category_group" ("key", "label", "color_token", "role", "sort") VALUES
	('income',        'Income',            '--series-income',        'income',  0),
	('taxes',         'Taxes & fees',      '--series-taxes',         'expense', 1),
	('bills',         'Bills & utilities', '--series-bills',         'expense', 2),
	('subscriptions', 'Subscriptions',     '--series-subscriptions', 'expense', 3),
	('health',        'Health & care',     '--series-health',        'expense', 4),
	('transport',     'Transport',         '--series-transport',     'expense', 5),
	('living',        'Food & lifestyle',  '--series-living',        'expense', 6),
	('housing',       'Housing',           '--series-housing',       'expense', 7),
	('savings',       'Saved & invested',  '--series-savings',       'savings', 8)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "bank" ("key", "label", "emoji") VALUES
	('fio', 'Fio banka', '🏦'),
	('revolut', 'Revolut', '💠'),
	('mbank', 'mBank', '🅜'),
	('rb', 'Raiffeisenbank', '🟡'),
	('cs', 'Česká spořitelna', '🔵'),
	('other', 'Other', '💼')
ON CONFLICT ("key") DO NOTHING;
`;
