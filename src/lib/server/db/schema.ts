import { sql } from 'drizzle-orm';
import {
	bigint,
	date,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';

// ---- Household and auth ----

export const person = pgTable('person', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	initials: text('initials').notNull(),
	role: text('role').notNull().default('adult'),
	birthYear: integer('birth_year'),
	passwordHash: text('password_hash').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const session = pgTable('session', {
	// sha256 hash of the bearer token; the raw token never touches the database
	id: text('id').primaryKey(),
	personId: text('person_id')
		.notNull()
		.references(() => person.id, { onDelete: 'cascade' }),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
});

// App-level configuration owned by the Settings screen (module toggles, base
// currency, household name, …). One row per key, value is JSON.
export const settings = pgTable('settings', {
	key: text('key').primaryKey(),
	value: jsonb('value').notNull()
});

// ---- Currencies ----

// One row per currency and day: how many base-currency minor units one unit of
// `code` was worth. Only screen-level totals ever use this.
export const currencyRate = pgTable(
	'currency_rate',
	{
		code: text('code').notNull(),
		day: date('day').notNull(),
		// rate as a decimal string, e.g. 24.905 CZK per 1 EUR
		rate: numeric('rate', { precision: 14, scale: 6 }).notNull()
	},
	(table) => [primaryKey({ columns: [table.code, table.day] })]
);

// ---- Accounts and transactions ----

export const account = pgTable('account', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	emoji: text('emoji').notNull().default('🏦'),
	bank: text('bank').notNull(), // fio | revolut | mbank | rb | cs | other
	kind: text('kind').notNull().default('current'), // current | savings | brokerage
	currency: text('currency').notNull(),
	ownerPersonId: text('owner_person_id').references(() => person.id, { onDelete: 'set null' }),
	// bank account number / IBAN in the form statements print it; used to
	// recognise transfers between the household's own accounts
	numbers: jsonb('numbers').$type<string[]>().notNull().default([]),
	// authoritative balance: the closing balance of the newest imported
	// statement (minor units of `currency`), not a sum over transactions
	balanceMinor: bigint('balance_minor', { mode: 'bigint' })
		.notNull()
		.default(sql`0`),
	balanceAsOf: date('balance_as_of'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const importFile = pgTable('import_file', {
	id: text('id').primaryKey(),
	filename: text('filename').notNull(),
	bank: text('bank').notNull(),
	format: text('format').notNull(),
	accountId: text('account_id').references(() => account.id, { onDelete: 'set null' }),
	// sha256 of the file body; the same file uploaded twice is skipped whole
	contentHash: text('content_hash').notNull().unique(),
	rowsRead: integer('rows_read').notNull().default(0),
	rowsAdded: integer('rows_added').notNull().default(0),
	rowsDuplicate: integer('rows_duplicate').notNull().default(0),
	rowsPaired: integer('rows_paired').notNull().default(0),
	uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow()
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
		id: text('id').primaryKey(),
		accountId: text('account_id')
			.notNull()
			.references(() => account.id, { onDelete: 'cascade' }),
		bookedAt: date('booked_at').notNull(),
		// minor units of `currency`; negative = money out
		amount: bigint('amount', { mode: 'bigint' }).notNull(),
		currency: text('currency').notNull(),
		counterparty: text('counterparty'),
		counterpartyAccount: text('counterparty_account'),
		variableSymbol: text('variable_symbol'),
		description: text('description'),
		bankRef: text('bank_ref'),
		dedupFingerprint: text('dedup_fingerprint').notNull(),
		categoryId: text('category_id').references(() => category.id, { onDelete: 'set null' }),
		// auto = categorised by rule, needs_review = ambiguous, confirmed = user decided
		reviewState: text('review_state').notNull().default('needs_review'),
		reviewReason: text('review_reason'),
		importFileId: text('import_file_id').references(() => importFile.id, { onDelete: 'set null' }),
		transferPairId: text('transfer_pair_id')
	},
	(table) => [
		uniqueIndex('transaction_dedup_idx').on(table.accountId, table.dedupFingerprint),
		index('transaction_booked_idx').on(table.bookedAt),
		index('transaction_review_idx').on(table.reviewState)
	]
);

// A matched pair of legs moving money between the household's own accounts.
// Both legs point back via transaction.transferPairId.
export const transferPair = pgTable('transfer_pair', {
	id: text('id').primaryKey(),
	outTransactionId: text('out_transaction_id').notNull(),
	inTransactionId: text('in_transaction_id').notNull(),
	state: text('state').notNull().default('auto'), // auto | confirmed
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const categoryRule = pgTable(
	'category_rule',
	{
		id: text('id').primaryKey(),
		// counterparty | counterparty_account | variable_symbol
		matcherType: text('matcher_type').notNull(),
		// normalised pattern the matcher compares against
		pattern: text('pattern').notNull(),
		categoryId: text('category_id')
			.notNull()
			.references(() => category.id, { onDelete: 'cascade' }),
		provenance: text('provenance').notNull().default('learned'), // seeded | learned
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [uniqueIndex('category_rule_matcher_idx').on(table.matcherType, table.pattern)]
);

export const markTransferRule = pgTable('mark_transfer_rule', {
	id: text('id').primaryKey(),
	counterpartyAccount: text('counterparty_account').notNull().unique(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
