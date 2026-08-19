import { sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
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
// Relative, not aliased: drizzle-kit loads this file outside Vite and does not
// resolve SvelteKit's $lib.
import type { OverviewPlacement } from '../../overview/layout';
import type { EntityKind, EnumValue } from '../../enums';

// ---- The linkable-record supertype ----

/**
 * Every record that can be tagged, filed a document against, or linked to a
 * contact carries a row here.
 *
 * It exists so ONE link table can point at any kind of record and still keep a
 * real foreign key at both ends. Without it, each connector needed a table per
 * pair — `document_person`, `document_property`, `property_tag`, `loan_tag` —
 * and a new module cost three more before it held a column of its own.
 *
 * Registration is NOT done here, and must not be attempted in application code.
 * Migration 0049 puts a BEFORE INSERT trigger on each of the eleven tables, so
 * inserting a record registers it; the concrete tables also carry a generated
 * `entity_kind` column and a composite foreign key into `(id, kind)`, which is
 * what makes a mismatched kind unrepresentable rather than merely discouraged.
 *
 * Drizzle models tables, not triggers or generated columns: none of that can be
 * recreated from this declaration, `db:generate` cannot notice it going missing,
 * and `drizzle-kit push` would build a database without it. Apply migrations.
 */
export const entity = pgTable(
	'entity',
	{
		id: text('id').primaryKey(),
		kind: text('kind').$type<EntityKind>().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('entity_id_kind_key').on(table.id, table.kind),
		index('entity_kind_idx').on(table.kind)
	]
);

// ---- Household and auth ----

export const person = pgTable('person', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	initials: text('initials').notNull(),
	// Permission, not household relationship: 'admin' may manage people and API
	// tokens, 'member' may not. These are the only two valid values.
	role: text('role').$type<'admin' | 'member'>().notNull().default('member'),
	birthYear: integer('birth_year'),
	// Null between "created by an admin" and "enrolled via the one-time link".
	// A null hash can never satisfy a sign-in — see verifyPassword.
	passwordHash: text('password_hash'),
	// Captured by sessions, passkeys and ceremonies so work begun before a
	// revocation cannot create a new way in after it commits.
	authGeneration: integer('auth_generation').notNull().default(0),
	// Set to suspend sign-in without deleting a person other tables reference.
	deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
	// Each person arranges their own Overview board. Plumbing attached to the
	// profile, never a Settings entry and never in the config export. Null means
	// "never customised" and renders DEFAULT_LAYOUT; an empty array is a person
	// who removed every panel, which is a different and equally valid state.
	// validateSession selects explicit columns, so this never rides the hot path.
	overviewLayout: jsonb('overview_layout').$type<OverviewPlacement[]>(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export const session = pgTable(
	'session',
	{
		// sha256 hash of the bearer token; the raw token never touches the database
		id: text('id').primaryKey(),
		personId: text('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		authGeneration: integer('auth_generation').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
	},
	// Revoking every other session of one person reads by person_id, as does
	// deleting them when the person goes. Indexed like every comparable foreign
	// key in this schema.
	(table) => [
		index('session_person_idx').on(table.personId),
		index('session_expires_idx').on(table.expiresAt)
	]
);

// The primary key arbitrates concurrent initial setup requests in PostgreSQL.
export const setupClaim = pgTable('setup_claim', {
	claimed: boolean('claimed').primaryKey(),
	claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow()
});

// A bearer token for the read-only API. Only the hash is stored — the raw
// token is shown once at creation, exactly as session tokens are handled.
export const apiToken = pgTable('api_token', {
	// sha256 hex of the bearer token
	id: text('id').primaryKey(),
	label: text('label').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	lastUsedAt: timestamp('last_used_at', { withTimezone: true })
});

// A one-time link letting a new person set their own password, so the admin
// who created them never knows it. Only the hash is stored — the raw token
// appears once, exactly as sessions and API tokens are handled.
export const enrollmentToken = pgTable('enrollment_token', {
	// sha256 hex of the raw token
	id: text('id').primaryKey(),
	// Unique: one live link per person. createEnrollmentToken upserts against
	// this constraint, which is what makes reissuing atomic — without it two
	// racing reissues each left a spendable link behind.
	personId: text('person_id')
		.notNull()
		.unique()
		.references(() => person.id, { onDelete: 'cascade' }),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	usedAt: timestamp('used_at', { withTimezone: true })
});

// A WebAuthn challenge this server issued and has not yet spent.
//
// The challenge used to live only in an httpOnly cookie the caller hands back,
// which is not a record of anything: SvelteKit does not sign cookies, so the
// value was entirely attacker-chosen and "expectedChallenge" was whatever the
// request said it should be. One captured assertion could then be replayed into
// a fresh session forever. A row here is what makes a challenge single-use —
// verification deletes it and refuses if it was not there.
export const webauthnChallenge = pgTable(
	'webauthn_challenge',
	{
		// sha256 hex of the challenge, the way sessions and tokens are stored
		id: text('id').primaryKey(),
		address: text('address').notNull(),
		personId: text('person_id').references(() => person.id, { onDelete: 'cascade' }),
		authGeneration: integer('auth_generation'),
		authSnapshot: jsonb('auth_snapshot').$type<Record<string, number>>().notNull().default({}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
	},
	(table) => [
		index('webauthn_challenge_expires_idx').on(table.expiresAt),
		index('webauthn_challenge_address_created_idx').on(table.address, table.createdAt),
		index('webauthn_challenge_person_idx').on(table.personId)
	]
);

// A registered passkey. The public key is public by construction — the private
// half never leaves the authenticator, which is the whole point.
export const credential = pgTable(
	'credential',
	{
		// base64url credential ID as the authenticator reports it
		id: text('id').primaryKey(),
		personId: text('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		authGeneration: integer('auth_generation').notNull(),
		publicKey: text('public_key').notNull(),
		// See webauthn/counter.ts: 0 means "not reported", not "never used".
		counter: bigint('counter', { mode: 'number' }).notNull().default(0),
		transports: jsonb('transports').$type<string[]>().notNull().default([]),
		label: text('label').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		lastUsedAt: timestamp('last_used_at', { withTimezone: true })
	},
	// Listing a person's passkeys and revoking them on a password change both
	// read by person_id.
	(table) => [index('credential_person_idx').on(table.personId)]
);

// App-level configuration owned by the Settings screen (module toggles, base
// currency, household name, …). One row per key, value is JSON.
export const settings = pgTable('settings', {
	key: text('key').primaryKey(),
	value: jsonb('value').notNull()
});

// ---- Currencies ----

/**
 * Every currency a code may name, materialised from CLDR at boot by
 * `refreshCurrencies` — never seeded by hand.
 *
 * Present so the fourteen currency columns can carry a real foreign key.
 * `$lib/money` remains the source of truth about currencies; a hand-written ISO
 * 4217 list here would be a second answer free to drift from it, and the two
 * disagree about real currencies (ISO gives HUF two decimal places, CLDR gives
 * zero, and CLDR is how it is written).
 */
export const currency = pgTable('currency', {
	code: text('code').primaryKey(),
	/** Decimal places, from `minorDigits`: 0 for JPY, 2 for EUR, 3 for KWD. */
	exponent: integer('exponent').notNull(),
	name: text('name').notNull()
});

// One row per currency and day: how many base-currency minor units one unit of
// `code` was worth. Only screen-level totals ever use this.
export const currencyRate = pgTable(
	'currency_rate',
	{
		code: text('code')
			.notNull()
			.references(() => currency.code),
		day: date('day').notNull(),
		// rate as a decimal string, e.g. 24.905 CZK per 1 EUR
		rate: numeric('rate', { precision: 14, scale: 6 }).notNull()
	},
	(table) => [primaryKey({ columns: [table.code, table.day] })]
);

// ---- Accounts and transactions ----

export const account = pgTable(
	'account',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		emoji: text('emoji').notNull().default('🏦'),
		bank: text('bank').notNull(), // fio | revolut | mbank | rb | cs | other
		kind: text('kind').$type<EnumValue<'account.kind'>>().notNull().default('current'),
		currency: text('currency')
			.notNull()
			.references(() => currency.code),
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
	},
	(table) => [
		index('account_currency_idx').on(table.currency),
		index('account_owner_person_idx').on(table.ownerPersonId)
	]
);

export const importFile = pgTable(
	'import_file',
	{
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
		/**
		 * How the statement was read, and what proved it.
		 *
		 * The proof engine decided whether to file this statement and then threw its
		 * evidence away, so the ledger held numbers with no account of where they
		 * came from. Keeping it means a row that turns out to be wrong can be traced
		 * to the reading that produced it, and that "everything that came from OCR"
		 * is a query rather than a guess.
		 */
		sourceMethod: text('source_method'),
		proofClass: text('proof_class').$type<EnumValue<'proof_class'>>(),
		ledgerModel: text('ledger_model'),
		currency: text('currency').references(() => currency.code),
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
 * Work that is claimed under a lease.
 *
 * `import_job` and `calendar_account.syncing_since` were the same mechanism
 * written twice: take the work, stamp when you took it, and let a stale stamp be
 * taken over so a worker that died strands nothing. This is that mechanism once,
 * and the next integration inherits it rather than writing a third copy.
 *
 * Reading a statement is not always fast. A 140-movement statement spread over
 * eight pages is recovered from glyph coordinates by two assemblers, and every
 * candidate reading is proved before one is chosen; a photograph has to be
 * rasterised and recognised first. None of that belongs on a request the person
 * who uploaded the file is waiting behind.
 *
 * The bytes live in `blob` rather than on disk so a queued file is transactional
 * with its job: a crash between writing the file and recording the job cannot
 * leave one without the other, and nothing has to be swept up afterwards. They
 * are cleared the moment the job finishes, so this table holds only work in
 * flight — `byteSize` outlives them, so a finished upload can still say what it
 * read.
 *
 * `claimedAt` is a LEASE, not a lock. The work in the middle is CPU-bound or
 * network-bound and can run for many seconds; no database lock belongs open
 * across that. The claim itself is made atomic by an advisory lock, which is
 * what lets a crashed worker's job be picked up again rather than stranded.
 *
 * `subjectId` is what lets one table serve two trigger models. An import is
 * QUEUED and has no subject; a calendar pass is about one account, and its job
 * row exists so a second pass can tell that the first one holds it.
 */
export const job = pgTable(
	'job',
	{
		id: text('id').primaryKey(),
		kind: text('kind').$type<EnumValue<'job.kind'>>().notNull(),
		/** What the work is about, for kinds where that is the work. */
		subjectId: text('subject_id'),
		state: text('state').$type<EnumValue<'job_state'>>().notNull().default('queued'),
		filename: text('filename'),
		/** Base64 of the uploaded bytes; cleared once the job leaves the queue. */
		blob: text('blob'),
		byteSize: integer('byte_size').notNull().default(0),
		claimedAt: timestamp('claimed_at', { withTimezone: true }),
		/** So a job that dies every time can be given up on rather than retried for ever. */
		attempts: integer('attempts').notNull().default(0),
		/** The IngestResult, so the page can show what happened without re-reading. */
		result: jsonb('result'),
		error: text('error'),
		queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
		finishedAt: timestamp('finished_at', { withTimezone: true })
	},
	(table) => [
		index('job_claimable_idx').on(table.kind, table.state, table.queuedAt),
		index('job_subject_idx').on(table.subjectId)
	]
);

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
	lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
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
		importFileId: text('import_file_id').references(() => importFile.id, { onDelete: 'set null' }),
		// How this row was read and how strongly it was proven, carried on the row
		// itself so it can answer for its own origin even after the file it came
		// from has been re-parsed or superseded.
		sourceMethod: text('source_method'),
		proofClass: text('proof_class').$type<EnumValue<'proof_class'>>(),
		transferPairId: text('transfer_pair_id')
	},
	(table) => [
		index('transaction_currency_idx').on(table.currency),
		index('transaction_original_currency_idx').on(table.originalCurrency),
		uniqueIndex('transaction_dedup_idx').on(table.accountId, table.dedupFingerprint),
		index('transaction_booked_idx').on(table.bookedAt),
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
		accountId: text('account_id')
			.notNull()
			.references(() => account.id, { onDelete: 'cascade' }),
		fingerprint: text('fingerprint').notNull(),
		transactionId: text('transaction_id')
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
		id: text('id').primaryKey(),
		outTransactionId: text('out_transaction_id')
			.notNull()
			.references(() => transaction.id, { onDelete: 'cascade' }),
		inTransactionId: text('in_transaction_id')
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
		transactionId: text('transaction_id')
			.primaryKey()
			.references(() => transaction.id, { onDelete: 'cascade' }),
		pairId: text('pair_id')
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

// ---- Property ----

export const property = pgTable(
	'property',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		// e.g. "3+kk · 78 m² · bought 2019"
		sizeLabel: text('size_label').notNull().default(''),
		kind: text('kind').$type<EnumValue<'property.kind'>>().notNull(),
		currency: text('currency')
			.notNull()
			.default('CZK')
			.references(() => currency.code),
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
	},
	(table) => [
		index('property_currency_idx').on(table.currency),
		index('property_owner_person_idx').on(table.ownerPersonId)
	]
);

export const tenancy = pgTable(
	'tenancy',
	{
		id: text('id').primaryKey(),
		propertyId: text('property_id')
			.notNull()
			.references(() => property.id, { onDelete: 'cascade' }),
		tenantName: text('tenant_name').notNull(),
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
	},
	(table) => [index('tenancy_property_idx').on(table.propertyId)]
);

export const propertyBill = pgTable(
	'property_bill',
	{
		id: text('id').primaryKey(),
		propertyId: text('property_id')
			.notNull()
			.references(() => property.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		amountMinor: bigint('amount_minor', { mode: 'bigint' })
			.notNull()
			.default(sql`0`),
		sort: integer('sort').notNull().default(0),
		/**
		 * Where the amount comes from: 'meter' rows are rewritten from the smart
		 * meter reading, everything else is the household's own figure and is never
		 * touched. A typed column rather than a label match — looking for a label
		 * containing "energy" missed the app's own seeded "Electricity advance", so
		 * a second energy line appeared beside it and the property's bill total
		 * counted electricity twice, and renaming a bill to Czech did the same.
		 */
		source: text('source').$type<EnumValue<'property_bill.source'>>().notNull().default('manual'),
		// the uploaded bill itself, filed in Documents about this property
		documentId: text('document_id').references(() => document.id, { onDelete: 'set null' })
	},
	(table) => [
		uniqueIndex('property_bill_meter_property_idx')
			.on(table.propertyId)
			.where(sql`${table.source} = 'meter'`),
		index('property_bill_property_idx').on(table.propertyId),
		index('property_bill_document_idx').on(table.documentId)
	]
);

// ---- Loans ----

export const loan = pgTable(
	'loan',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		lender: text('lender').notNull().default(''),
		kind: text('kind').$type<EnumValue<'loan.kind'>>().notNull().default('mortgage'),
		currency: text('currency')
			.notNull()
			.default('CZK')
			.references(() => currency.code),
		principalMinor: bigint('principal_minor', { mode: 'bigint' }).notNull(),
		owedMinor: bigint('owed_minor', { mode: 'bigint' }).notNull(),
		owedAsOf: date('owed_as_of'),
		ownerPersonId: text('owner_person_id').references(() => person.id, { onDelete: 'set null' }),
		startDate: date('start_date'),
		endDate: date('end_date'),
		// fixed_period: rate fixed until a date, then re-fixed (mortgages)
		// fixed_term:   rate fixed for the whole life of the loan
		// floating:     rate tracks a reference
		regime: text('regime').$type<EnumValue<'loan.regime'>>().notNull().default('fixed_period'),
		// how the bank accrues interest — per loan, because banks differ:
		// 30/360 (rate ÷ 12), act/365, act/360
		dayCount: text('day_count').$type<EnumValue<'loan.day_count'>>().notNull().default('30/360'),
		// payment: accrues payment-date to payment-date on one balance
		// calendar: accrues daily over the calendar month, charged on its last
		//           day and collected with the next instalment (Česká spořitelna)
		accrualStyle: text('accrual_style')
			.$type<EnumValue<'loan.accrual_style'>>()
			.notNull()
			.default('payment'),
		// day of month the payment falls on; actual-day conventions accrue from
		// payment date to payment date
		paymentDay: integer('payment_day'),
		// czech mortgage interest on owner-occupied housing is tax deductible
		interestDeductible: integer('interest_deductible').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('loan_currency_idx').on(table.currency),
		index('loan_owner_person_idx').on(table.ownerPersonId)
	]
);

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
	(table) => [
		uniqueIndex('loan_property_idx').on(table.loanId, table.propertyId),
		index('loan_property_property_idx').on(table.propertyId)
	]
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
	(table) => [
		index('loan_event_loan_idx').on(table.loanId),
		index('loan_event_transaction_idx').on(table.transactionId)
	]
);

// ---- Documents ----

export const document = pgTable(
	'document',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		// payslips | tax | identity | family | property | tenancy | loans | insurance
		shelf: text('shelf').$type<EnumValue<'document.shelf'>>().notNull(),
		// uploaded file on the data volume; a document may be metadata-only
		storedName: text('stored_name'),
		ext: text('ext').notNull().default('PDF'),
		addedOn: date('added_on').notNull(),
		expiresOn: date('expires_on'),
		// how the expiry reads: expires | ends | renews
		expiryVerb: text('expiry_verb')
			.$type<EnumValue<'document.expiry_verb'>>()
			.notNull()
			.default('expires'),
		// money documents (payslips, bills) can carry the amount they are about
		// and the month they cover — the salary tracker derives from these
		amountMinor: bigint('amount_minor', { mode: 'bigint' }),
		amountCurrency: text('amount_currency').references(() => currency.code),
		periodMonth: text('period_month')
	},
	(table) => [
		index('document_amount_currency_idx').on(table.amountCurrency),
		index('document_shelf_idx').on(table.shelf)
	]
);

// ---- Investments (XTB report snapshots) ----

// A cash operation from the broker report; XTB assigns each a unique id, so
// re-uploading the same (or an overlapping) report is idempotent.
export const brokerOperation = pgTable(
	'broker_operation',
	{
		id: text('id').primaryKey(), // XTB operation ID
		type: text('type').notNull(), // Deposit | Withdrawal | Dividend | …
		ticker: text('ticker'),
		happenedAt: timestamp('happened_at', { withTimezone: true }).notNull(),
		amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
		currency: text('currency')
			.notNull()
			.references(() => currency.code),
		comment: text('comment'),
		// the broker position this cash movement belongs to — links purchases and
		// sells to holding periods for the reconstructed value curve
		positionId: text('position_id')
	},
	(table) => [index('broker_operation_currency_idx').on(table.currency)]
);

// A broker position's holding interval, from the report's Closed Positions
// sheet (authoritative purchase/sale values and times) and the open lots.
// This is what turns a single report into a value history.
export const brokerPosition = pgTable(
	'broker_position',
	{
		id: text('id').primaryKey(), // XTB position ID
		ticker: text('ticker').notNull(),
		purchaseValueMinor: bigint('purchase_value_minor', { mode: 'bigint' }),
		saleValueMinor: bigint('sale_value_minor', { mode: 'bigint' }),
		currency: text('currency')
			.notNull()
			.references(() => currency.code),
		openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
		closedAt: timestamp('closed_at', { withTimezone: true })
	},
	(table) => [index('broker_position_currency_idx').on(table.currency)]
);

// Current holdings — a snapshot replaced wholesale by each newer report.
export const holding = pgTable(
	'holding',
	{
		id: text('id').primaryKey(),
		ticker: text('ticker').notNull(),
		name: text('name').notNull(),
		category: text('category').notNull().default('STOCK'),
		units: numeric('units', { precision: 18, scale: 6 }).notNull(),
		valueMinor: bigint('value_minor', { mode: 'bigint' }).notNull(),
		currency: text('currency')
			.notNull()
			.references(() => currency.code),
		netProfitPct: numeric('net_profit_pct', { precision: 9, scale: 2 }),
		asOf: timestamp('as_of', { withTimezone: true }).notNull()
	},
	(table) => [index('holding_currency_idx').on(table.currency)]
);

// Portfolio value over time: one row per report upload day, appended forever —
// this series is the "actual" line on the value chart.
export const portfolioSnapshot = pgTable(
	'portfolio_snapshot',
	{
		day: date('day').primaryKey(),
		valueMinor: bigint('value_minor', { mode: 'bigint' }).notNull(),
		currency: text('currency')
			.notNull()
			.references(() => currency.code)
	},
	(table) => [index('portfolio_snapshot_currency_idx').on(table.currency)]
);

// A holdings report can legitimately contain zero rows, so freshness cannot
// be inferred from the current holding table. This singleton remembers the
// exact report timestamp and account currency independently of its contents.
export const brokerImportState = pgTable(
	'broker_import_state',
	{
		id: text('id').primaryKey(),
		latestGeneratedAt: timestamp('latest_generated_at', { withTimezone: true }).notNull(),
		currency: text('currency')
			.notNull()
			.references(() => currency.code)
	},
	(table) => [index('broker_import_state_currency_idx').on(table.currency)]
);

// Net-worth history: upserted daily so the sidebar delta and (later) trend
// charts have real data.
export const netWorthSnapshot = pgTable(
	'networth_snapshot',
	{
		day: date('day').primaryKey(),
		valueMinor: bigint('value_minor', { mode: 'bigint' }).notNull(),
		currency: text('currency')
			.notNull()
			.references(() => currency.code)
	},
	(table) => [index('networth_snapshot_currency_idx').on(table.currency)]
);

// ---- Splits and tags ----

// A transaction divided between categories. Absent for the ordinary case: an
// unsplit transaction has no rows here and keeps its own categoryId.
export const transactionSplit = pgTable(
	'transaction_split',
	{
		id: text('id').primaryKey(),
		transactionId: text('transaction_id')
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

// Cross-cutting groupings: a renovation, a holiday. Every tag has a running
// total, which is why no kind column is needed.
export const tag = pgTable('tag', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	// trimmed, lowercased, inner whitespace collapsed — carries the uniqueness
	normalisedName: text('normalised_name').notNull().unique(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

// ---- Rules ----

// An unordered rule: every condition must hold. Category is exclusive and can
// contest with another rule; tags are additive and always apply. There is
// deliberately no unique index on the conditions — two rules claiming the same
// counterparty is what makes a contested row possible.
export const rule = pgTable(
	'rule',
	{
		id: text('id').primaryKey(),
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
		ruleId: text('rule_id')
			.notNull()
			.references(() => rule.id, { onDelete: 'cascade' }),
		tagId: text('tag_id')
			.notNull()
			.references(() => tag.id, { onDelete: 'cascade' })
	},
	(table) => [
		primaryKey({ columns: [table.ruleId, table.tagId] }),
		index('rule_tag_tag_idx').on(table.tagId)
	]
);

// ---- Subjects and entity links ----

// What a document can belong to when it is not a person, flat or investment:
// the household, the car, the dog. A record created once and linked to — never
// a name retyped and hoped to match. Seeded with one row for the household.
export const subject = pgTable(
	'subject',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull().unique(),
		emoji: text('emoji').notNull().default('🏠'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	// "Car" and "car" are the same thing; two records differing only in case
	// would be the phantom-column problem sneaking back in.
	(table) => [uniqueIndex('subject_name_ci_idx').on(sql`lower(${table.name})`)]
);

// ---- Tax statements ----

// What a yearly tax statement said, per person per country. Nothing here is
// computed: no brackets, no allowances, no residency. The two canonical figures
// exist in every country, so the charts always have something to draw; anything
// a particular country itemises separately is a labelled line.
export const taxStatement = pgTable(
	'tax_statement',
	{
		id: text('id').primaryKey(),
		personId: text('person_id')
			.notNull()
			.references(() => person.id, { onDelete: 'cascade' }),
		year: integer('year').notNull(),
		// free text on purpose — a validated country list would need maintaining
		country: text('country').notNull(),
		// the statement's own currency, so a series never mixes currencies
		currency: text('currency')
			.notNull()
			.references(() => currency.code),
		grossIncomeMinor: bigint('gross_income_minor', { mode: 'bigint' }).notNull(),
		taxPaidMinor: bigint('tax_paid_minor', { mode: 'bigint' }).notNull(),
		documentId: text('document_id').references(() => document.id, { onDelete: 'set null' }),
		note: text('note'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('tax_statement_currency_idx').on(table.currency),
		uniqueIndex('tax_statement_unique_idx').on(table.personId, table.year, table.country),
		index('tax_statement_document_idx').on(table.documentId)
	]
);

export const taxStatementLine = pgTable(
	'tax_statement_line',
	{
		id: text('id').primaryKey(),
		statementId: text('statement_id')
			.notNull()
			.references(() => taxStatement.id, { onDelete: 'cascade' }),
		label: text('label').notNull(),
		amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
		sort: integer('sort').notNull().default(0)
	},
	(table) => [index('tax_statement_line_statement_idx').on(table.statementId)]
);

// ---- Calendar ----

// Events someone wrote by hand. The ledger's own events stay derived — they are
// recomputed from loans, tenancies and documents and never land in a table — so
// this holds only what a person authored.
export const calendarEvent = pgTable(
	'calendar_event',
	{
		id: text('id').primaryKey(),
		title: text('title').notNull(),
		notes: text('notes'),
		// A key from EVENT_CATEGORIES; supplies the marker emoji. Null is untagged.
		category: text('category'),
		allDay: boolean('all_day').notNull().default(false),
		startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
		endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
		// The IANA zone the event was authored in, and NOT redundant beside the two
		// timestamptz columns above. Recurrence expands against wall-clock time:
		// "every Tuesday at 09:00" has to stay 09:00 local across the March and
		// October transitions, and a series expanded purely in UTC silently drifts by
		// an hour for half the year. The instant alone cannot say which 09:00 was
		// meant, so the zone travels with the event.
		tz: text('tz').notNull(),
		// RFC 5545 rule, without the RRULE: prefix. Null means a single event.
		rrule: text('rrule'),
		createdBy: text('created_by').references(() => person.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		// The merge clock: sync compares this against the remote's modification time.
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		// A tombstone rather than a hard delete. Sync has to be able to tell "deleted
		// here, push the deletion" from "never existed", and a removed row says
		// nothing at all.
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(table) => [index('calendar_event_created_by_idx').on(table.createdBy)]
);

// One occurrence of a recurring event that was moved or cancelled.
export const calendarEventException = pgTable(
	'calendar_event_exception',
	{
		id: text('id').primaryKey(),
		eventId: text('event_id')
			.notNull()
			.references(() => calendarEvent.id, { onDelete: 'cascade' }),
		// The occurrence's ORIGINAL start, never where it was moved to. That is
		// what RFC 5545 keys on and what Google and CalDAV both expect back.
		// Storing the moved-to time instead is the bug that makes a rescheduled
		// occurrence reappear at its old slot on the next sync.
		recurrenceId: text('recurrence_id').notNull(),
		cancelled: boolean('cancelled').notNull().default(false),
		// Null means "inherit from the series" — distinct from an empty string,
		// which is an override to nothing.
		title: text('title'),
		startsAt: timestamp('starts_at', { withTimezone: true }),
		endsAt: timestamp('ends_at', { withTimezone: true }),
		notes: text('notes'),
		// The rest of what an edit can change. Without these three, a "this event
		// only" edit that retagged, un-all-dayed or re-zoned one occurrence was
		// accepted by the form, silently dropped on the way to the table, and the
		// occurrence came back rendered from the series values — so the screen
		// disagreed with what had just been saved and nothing was pushed.
		//
		// Nullable, and null means inherit, exactly as title and notes do. That is
		// what lets a later series-level change still reach an overridden
		// occurrence: only the fields the edit actually differed on are stored.
		category: text('category'),
		allDay: boolean('all_day'),
		tz: text('tz')
	},
	(t) => [uniqueIndex('calendar_event_exception_occurrence_idx').on(t.eventId, t.recurrenceId)]
);

// ---- Calendar sync ----

// A connected remote calendar.
//
// Its own table rather than a `settings` key on purpose. Home Assistant's config
// lives in settings, and config-file.ts keeps secrets out of the export with a
// whitelist — but a credential that leaks because someone forgot to maintain a
// list is a bad failure. Here it is excluded by construction.
export const calendarAccount = pgTable('calendar_account', {
	id: text('id').primaryKey(),
	provider: text('provider').$type<'icloud' | 'google'>().notNull(),
	label: text('label').notNull(),
	remoteCalId: text('remote_cal_id'),
	/** The chosen calendar's display name. Stored because the id is a CalDAV
	 *  collection URL or a Google calendar id — neither of which tells a person
	 *  which of their calendars this is. */
	remoteCalName: text('remote_cal_name'),
	/** App-specific password, or an OAuth refresh token. Never leaves this table. */
	credential: text('credential').notNull(),
	/** Opaque: a Google syncToken, a CalDAV sync-token, or a ctag. */
	cursor: text('cursor'),
	lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
	lastError: text('last_error'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

// What a local event is called on one remote, and what we last agreed on.
//
// A CACHE, not the source of truth: remote ids are derived from local keys, so
// losing this table triggers a reconcile that recomputes the same ids and
// re-attaches, rather than duplicating every event on someone's phone.
export const calendarSyncLink = pgTable(
	'calendar_sync_link',
	{
		/** An authored event's uuid, or a generated event's `gen:` key. */
		localKey: text('local_key').notNull(),
		accountId: text('account_id')
			.notNull()
			.references(() => calendarAccount.id, { onDelete: 'cascade' }),
		remoteId: text('remote_id').notNull(),
		remoteEtag: text('remote_etag'),
		/** What we last sent — the merge base. Without it there is no way to tell
		 *  which side changed, only that the two differ. */
		pushedHash: text('pushed_hash'),
		/** Remote content we last accepted. */
		seenHash: text('seen_hash'),
		/** Set when a generated event was deleted on the remote: stop pushing it
		 *  rather than re-creating it and overruling the person who deleted it. */
		suppressedAt: timestamp('suppressed_at', { withTimezone: true }),
		deletedAt: timestamp('deleted_at', { withTimezone: true })
	},
	(t) => [
		primaryKey({ columns: [t.localKey, t.accountId] }),
		// The primary key leads with local_key, so it cannot serve a lookup that
		// only knows the account — and every one of them does. A sync pass reads
		// this table by account, disconnecting an account cascades by account, and
		// both were sequential scans that grow with the whole household's history
		// rather than with one account's share of it.
		index('calendar_sync_link_account_idx').on(t.accountId)
	]
);

// A discarded version, kept so last-writer-wins is not silent.
//
// This is what makes the conflict rule acceptable rather than reckless: the
// losing edit is recorded and surfaced through the briefing, so an overwritten
// change is visible instead of simply gone.
export const calendarConflict = pgTable(
	'calendar_conflict',
	{
		id: text('id').primaryKey(),
		localKey: text('local_key').notNull(),
		accountId: text('account_id')
			.notNull()
			.references(() => calendarAccount.id, { onDelete: 'cascade' }),
		detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
		ours: jsonb('ours').notNull(),
		theirs: jsonb('theirs').notNull(),
		resolution: text('resolution').$type<'local-won' | 'remote-won' | 'wrote-back'>().notNull(),
		/** Cleared once someone has seen it, so the briefing stops raising it. */
		acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true })
	},
	(table) => [index('calendar_conflict_account_idx').on(table.accountId)]
);

// ---- Contacts ----

// The household's address book: tenants, tradespeople, bank contacts. Replaces
// tenancy.tenantContact, which was one free-text string with no structure and
// nowhere to put a second number.
export const contact = pgTable('contact', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	// A stored upload name from saveUpload(), served through /files/[name] —
	// the same convention property photos use. Never a path or a URL.
	photo: text('photo'),
	// organisation and jobTitle are kept apart rather than as one "work" string:
	// that is the vCard ORG/TITLE split, so a later CardDAV export is a mapping
	// rather than a migration, and "everyone at Česká spořitelna" stays askable.
	organisation: text('organisation'),
	jobTitle: text('job_title'),
	phone: text('phone'),
	email: text('email'),
	address: text('address'),
	notes: text('notes'),
	category: text('category'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

// ---- Links ----

/**
 * A tag on any kind of record.
 *
 * One table where there were five — document_tag, property_tag, loan_tag,
 * transaction_tag, transaction_split_tag — because the far end is an `entity`
 * rather than one named table. A new module inherits tagging without a table of
 * its own, and both ends still keep a real foreign key and a working cascade.
 *
 * Its own table rather than a shared `entity_link` with a `relation` column: a
 * tag link will want a colour or a note of its own before long, and there is
 * nowhere to put one on a table shared with document filing.
 */
export const tagLink = pgTable(
	'tag_link',
	{
		tagId: text('tag_id')
			.notNull()
			.references(() => tag.id, { onDelete: 'cascade' }),
		targetId: text('target_id')
			.notNull()
			.references(() => entity.id, { onDelete: 'cascade' })
	},
	// The primary key leads with tag_id and so cannot serve a lookup that only
	// knows the target, which is what "everything tagged like this" needs.
	(t) => [
		primaryKey({ columns: [t.tagId, t.targetId] }),
		index('tag_link_target_idx').on(t.targetId)
	]
);

/** A document filed against any kind of record. Replaces four tables. */
export const documentLink = pgTable(
	'document_link',
	{
		documentId: text('document_id')
			.notNull()
			.references(() => document.id, { onDelete: 'cascade' }),
		targetId: text('target_id')
			.notNull()
			.references(() => entity.id, { onDelete: 'cascade' })
	},
	(t) => [
		primaryKey({ columns: [t.documentId, t.targetId] }),
		index('document_link_target_idx').on(t.targetId)
	]
);

/** A contact attached to any kind of record. Replaces four tables. */
export const contactLink = pgTable(
	'contact_link',
	{
		contactId: text('contact_id')
			.notNull()
			.references(() => contact.id, { onDelete: 'cascade' }),
		targetId: text('target_id')
			.notNull()
			.references(() => entity.id, { onDelete: 'cascade' })
	},
	(t) => [
		primaryKey({ columns: [t.contactId, t.targetId] }),
		index('contact_link_target_idx').on(t.targetId)
	]
);
