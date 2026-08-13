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

// ---- Property ----

export const property = pgTable('property', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	// e.g. "3+kk · 78 m² · bought 2019"
	sizeLabel: text('size_label').notNull().default(''),
	kind: text('kind').notNull(), // lived | rented
	currency: text('currency').notNull().default('CZK'),
	valueMinor: bigint('value_minor', { mode: 'bigint' })
		.notNull()
		.default(sql`0`),
	valuedAt: date('valued_at'),
	// what went in: deposit, fees, principal repaid — for the appreciation tile
	moneyInMinor: bigint('money_in_minor', { mode: 'bigint' })
		.notNull()
		.default(sql`0`),
	boughtYear: integer('bought_year'),
	// uploaded images on the data volume: {plan?: string, photos: string[]}
	images: jsonb('images')
		.$type<{ plan?: string; photos: string[] }>()
		.notNull()
		.default({ photos: [] }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const tenancy = pgTable('tenancy', {
	id: text('id').primaryKey(),
	propertyId: text('property_id')
		.notNull()
		.references(() => property.id, { onDelete: 'cascade' }),
	tenantName: text('tenant_name').notNull(),
	tenantContact: text('tenant_contact').notNull().default(''),
	rentMinor: bigint('rent_minor', { mode: 'bigint' })
		.notNull()
		.default(sql`0`),
	depositMinor: bigint('deposit_minor', { mode: 'bigint' })
		.notNull()
		.default(sql`0`),
	startDate: date('start_date'),
	endDate: date('end_date'),
	// the date by which a renewal notice must be given
	renewalNoticeDate: date('renewal_notice_date')
});

export const propertyBill = pgTable('property_bill', {
	id: text('id').primaryKey(),
	propertyId: text('property_id')
		.notNull()
		.references(() => property.id, { onDelete: 'cascade' }),
	label: text('label').notNull(),
	amountMinor: bigint('amount_minor', { mode: 'bigint' })
		.notNull()
		.default(sql`0`),
	sort: integer('sort').notNull().default(0)
});

// ---- Loans ----

export const loan = pgTable('loan', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	lender: text('lender').notNull().default(''),
	kind: text('kind').notNull().default('mortgage'), // mortgage | car | consumer | family
	currency: text('currency').notNull().default('CZK'),
	securedByPropertyId: text('secured_by_property_id').references(() => property.id, {
		onDelete: 'set null'
	}),
	principalMinor: bigint('principal_minor', { mode: 'bigint' }).notNull(),
	owedMinor: bigint('owed_minor', { mode: 'bigint' }).notNull(),
	owedAsOf: date('owed_as_of'),
	paymentMinor: bigint('payment_minor', { mode: 'bigint' }).notNull(),
	startDate: date('start_date'),
	endDate: date('end_date'),
	// fixed_period: rate fixed until a date, then re-fixed (mortgages)
	// fixed_term:   rate fixed for the whole life of the loan
	// floating:     rate tracks a reference
	regime: text('regime').notNull().default('fixed_period'),
	// czech mortgage interest on owner-occupied housing is tax deductible
	interestDeductible: integer('interest_deductible').notNull().default(0),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

// Interest is booked per fixation period so a later re-fix never rewrites
// history. endDate null = open-ended (fixed_term / floating current period).
export const loanFixationPeriod = pgTable(
	'loan_fixation_period',
	{
		id: text('id').primaryKey(),
		loanId: text('loan_id')
			.notNull()
			.references(() => loan.id, { onDelete: 'cascade' }),
		startDate: date('start_date').notNull(),
		endDate: date('end_date'),
		annualRatePct: numeric('annual_rate_pct', { precision: 6, scale: 3 }).notNull()
	},
	(table) => [index('loan_fixation_loan_idx').on(table.loanId)]
);

// ---- Investments (XTB report snapshots) ----

// A cash operation from the broker report; XTB assigns each a unique id, so
// re-uploading the same (or an overlapping) report is idempotent.
export const brokerOperation = pgTable('broker_operation', {
	id: text('id').primaryKey(), // XTB operation ID
	type: text('type').notNull(), // Deposit | Withdrawal | Dividend | …
	ticker: text('ticker'),
	happenedAt: timestamp('happened_at', { withTimezone: true }).notNull(),
	amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
	currency: text('currency').notNull(),
	comment: text('comment')
});

// Current holdings — a snapshot replaced wholesale by each newer report.
export const holding = pgTable('holding', {
	id: text('id').primaryKey(),
	ticker: text('ticker').notNull(),
	name: text('name').notNull(),
	category: text('category').notNull().default('STOCK'),
	units: numeric('units', { precision: 18, scale: 6 }).notNull(),
	valueMinor: bigint('value_minor', { mode: 'bigint' }).notNull(),
	currency: text('currency').notNull(),
	netProfitPct: numeric('net_profit_pct', { precision: 9, scale: 2 }),
	asOf: timestamp('as_of', { withTimezone: true }).notNull()
});

// Portfolio value over time: one row per report upload day, appended forever —
// this series is the "actual" line on the value chart.
export const portfolioSnapshot = pgTable('portfolio_snapshot', {
	day: date('day').primaryKey(),
	valueMinor: bigint('value_minor', { mode: 'bigint' }).notNull(),
	currency: text('currency').notNull()
});

// Net-worth history: upserted daily so the sidebar delta and (later) trend
// charts have real data.
export const netWorthSnapshot = pgTable('networth_snapshot', {
	day: date('day').primaryKey(),
	valueMinor: bigint('value_minor', { mode: 'bigint' }).notNull(),
	currency: text('currency').notNull()
});
