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
	// the original bytes, kept on the data volume — parser improvements can
	// re-parse history instead of asking for seven years of re-uploads
	storedName: text('stored_name'),
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
		// the value date (valuta / data operacji / started date) when the bank
		// prints one — cashflow prefers it so month-boundary spending lands in
		// the month the money actually moved
		valueDate: date('value_date'),
		// minor units of `currency`; negative = money out. Gross of any fee.
		amount: bigint('amount', { mode: 'bigint' }).notNull(),
		// separate bank fee on this movement (positive minor units)
		feeMinor: bigint('fee_minor', { mode: 'bigint' }),
		currency: text('currency').notNull(),
		// account balance after this movement, when the statement prints it —
		// the column that lets the ledger reconcile against the bank
		balanceAfterMinor: bigint('balance_after_minor', { mode: 'bigint' }),
		// original amount for foreign-currency card payments billed in the
		// account currency
		originalAmountMinor: bigint('original_amount_minor', { mode: 'bigint' }),
		originalCurrency: text('original_currency'),
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
// Confirmed/auto legs point back via transaction.transferPairId (a soft
// pointer, to avoid an FK cycle); proposed pairs exist only here until the
// user confirms them.
export const transferPair = pgTable('transfer_pair', {
	id: text('id').primaryKey(),
	outTransactionId: text('out_transaction_id')
		.notNull()
		.references(() => transaction.id, { onDelete: 'cascade' }),
	inTransactionId: text('in_transaction_id')
		.notNull()
		.references(() => transaction.id, { onDelete: 'cascade' }),
	state: text('state').notNull().default('auto'), // auto | proposed | confirmed | rejected
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
	ownerPersonId: text('owner_person_id').references(() => person.id, { onDelete: 'set null' }),
	// uploaded images on the data volume, plus the drawn floor plan:
	// {plan?, photos, drawing?: {cellCm, rooms: [{name, cells: [[x,y],…]}]}}
	images: jsonb('images')
		.$type<{
			plan?: string;
			photos: string[];
			drawing?: { cellCm: number; rooms: { name: string; cells: [number, number][] }[] };
		}>()
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
	sort: integer('sort').notNull().default(0),
	// the uploaded bill itself, filed in Documents about this property
	documentId: text('document_id').references(() => document.id, { onDelete: 'set null' })
});

// ---- Loans ----

export const loan = pgTable('loan', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	lender: text('lender').notNull().default(''),
	kind: text('kind').notNull().default('mortgage'), // mortgage | car | consumer | family
	currency: text('currency').notNull().default('CZK'),
	principalMinor: bigint('principal_minor', { mode: 'bigint' }).notNull(),
	owedMinor: bigint('owed_minor', { mode: 'bigint' }).notNull(),
	owedAsOf: date('owed_as_of'),
	ownerPersonId: text('owner_person_id').references(() => person.id, { onDelete: 'set null' }),
	startDate: date('start_date'),
	endDate: date('end_date'),
	// fixed_period: rate fixed until a date, then re-fixed (mortgages)
	// fixed_term:   rate fixed for the whole life of the loan
	// floating:     rate tracks a reference
	regime: text('regime').notNull().default('fixed_period'),
	// how the bank accrues interest — per loan, because banks differ:
	// 30/360 (rate ÷ 12), act/365, act/360
	dayCount: text('day_count').notNull().default('30/360'),
	// payment: accrues payment-date to payment-date on one balance
	// calendar: accrues daily over the calendar month, charged on its last
	//           day and collected with the next instalment (Česká spořitelna)
	accrualStyle: text('accrual_style').notNull().default('payment'),
	// day of month the payment falls on; actual-day conventions accrue from
	// payment date to payment date
	paymentDay: integer('payment_day'),
	// czech mortgage interest on owner-occupied housing is tax deductible
	interestDeductible: integer('interest_deductible').notNull().default(0),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

// One mortgage agreement can secure several properties (the flats entered at
// different values with different shares owed) — the share is explicit, never
// derived. sharePct null = split proportionally to current property values.
export const loanProperty = pgTable(
	'loan_property',
	{
		id: text('id').primaryKey(),
		loanId: text('loan_id')
			.notNull()
			.references(() => loan.id, { onDelete: 'cascade' }),
		propertyId: text('property_id')
			.notNull()
			.references(() => property.id, { onDelete: 'cascade' }),
		sharePct: numeric('share_pct', { precision: 6, scale: 3 })
	},
	(table) => [uniqueIndex('loan_property_idx').on(table.loanId, table.propertyId)]
);

// Interest is booked per fixation period so a later re-fix never rewrites
// history. endDate null = open-ended (fixed_term / floating current period).
// The monthly payment lives here too: when a fixation ends the bank re-quotes
// the payment together with the rate.
export const loanFixationPeriod = pgTable(
	'loan_fixation_period',
	{
		id: text('id').primaryKey(),
		loanId: text('loan_id')
			.notNull()
			.references(() => loan.id, { onDelete: 'cascade' }),
		startDate: date('start_date').notNull(),
		endDate: date('end_date'),
		annualRatePct: numeric('annual_rate_pct', { precision: 6, scale: 3 }).notNull(),
		paymentMinor: bigint('payment_minor', { mode: 'bigint' }).notNull()
	},
	(table) => [
		index('loan_fixation_loan_idx').on(table.loanId),
		uniqueIndex('loan_fixation_start_idx').on(table.loanId, table.startDate)
	]
);

// What actually happened on a loan: payments, extra repayments, re-fixes,
// fees, and balance statements. This is the booked history the projections
// anchor to, and the natural link between a loan and the transaction that
// carried the money out of an account.
export const loanEvent = pgTable(
	'loan_event',
	{
		id: text('id').primaryKey(),
		loanId: text('loan_id')
			.notNull()
			.references(() => loan.id, { onDelete: 'cascade' }),
		happenedOn: date('happened_on').notNull(),
		// payment | extra_payment | refix | fee | balance
		kind: text('kind').notNull(),
		amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
		// interest portion of a payment, when the statement splits it
		interestMinor: bigint('interest_minor', { mode: 'bigint' }),
		note: text('note'),
		transactionId: text('transaction_id').references(() => transaction.id, {
			onDelete: 'set null'
		})
	},
	(table) => [index('loan_event_loan_idx').on(table.loanId)]
);

// ---- Documents ----

export const document = pgTable(
	'document',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		// payslips | tax | identity | family | property | tenancy | loans | insurance
		shelf: text('shelf').notNull(),
		// free-text subject; the documents screen derives its columns from the
		// subjects actually present (a third flat or a new child creates a
		// column by itself — no configuration)
		subject: text('subject').notNull().default(''),
		// uploaded file on the data volume; a document may be metadata-only
		storedName: text('stored_name'),
		ext: text('ext').notNull().default('PDF'),
		addedOn: date('added_on').notNull(),
		expiresOn: date('expires_on'),
		// how the expiry reads: expires | ends | renews
		expiryVerb: text('expiry_verb').notNull().default('expires'),
		tags: jsonb('tags').$type<string[]>().notNull().default([]),
		// money documents (payslips, bills) can carry the amount they are about
		// and the month they cover — the salary tracker derives from these
		amountMinor: bigint('amount_minor', { mode: 'bigint' }),
		amountCurrency: text('amount_currency'),
		periodMonth: text('period_month')
	},
	(table) => [index('document_shelf_idx').on(table.shelf)]
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
	comment: text('comment'),
	// the broker position this cash movement belongs to — links purchases and
	// sells to holding periods for the reconstructed value curve
	positionId: text('position_id')
});

// A broker position's holding interval, from the report's Closed Positions
// sheet (authoritative purchase/sale values and times) and the open lots.
// This is what turns a single report into a value history.
export const brokerPosition = pgTable('broker_position', {
	id: text('id').primaryKey(), // XTB position ID
	ticker: text('ticker').notNull(),
	purchaseValueMinor: bigint('purchase_value_minor', { mode: 'bigint' }),
	saleValueMinor: bigint('sale_value_minor', { mode: 'bigint' }),
	currency: text('currency').notNull(),
	openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
	closedAt: timestamp('closed_at', { withTimezone: true })
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
