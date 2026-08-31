// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Every closed set of values a column may hold, and the only place they live.
 *
 * Each list is used three times: to type the Drizzle column, to generate the
 * CHECK constraint that enforces it in PostgreSQL, and to build whatever the
 * screens offer. They cannot drift, because there is one of them.
 *
 * They drifted before this existed. `REVIEW_STATES` in `transactions/filter.ts`
 * described itself as "the review states the schema allows" and listed three of
 * the four — so a transaction in the `filed` state, which `ingest.ts` treats as
 * terminal, could not be selected by any filter on the register. It was not
 * caught, because nothing compared the two.
 *
 * PostgreSQL `ENUM` types are deliberately NOT used. A value cannot be dropped
 * or reordered without recreating the type and every column that depends on it,
 * which is hostile to a schema meant to grow by addition. A CHECK is one DROP
 * and one ADD.
 *
 * Client-safe by construction: no imports, so this can be read by a Svelte
 * component, by `schema.ts` under drizzle-kit (which runs outside Vite and
 * cannot resolve `$lib`), and by a migration test.
 *
 * ---
 *
 * WHAT IS DELIBERATELY ABSENT, and why. A CHECK on an open set is a migration
 * every time the set grows, which is the cost this file exists to avoid.
 *
 *   account.bank, import_file.bank — `BankId` is `string` on purpose. Since
 *     routing became format-first a reader writes the FORMAT's name when the
 *     file names no issuer (`tabular`, `camt053`, `ofx`), and account creation
 *     takes `String(form.get('bank') ?? 'other')`. Constraining either would
 *     refuse the next format added.
 *   import_file.source_method — the readers' own vocabulary, which changes with
 *     parser work.
 *   category.group_key — `groupKey` is `string`; the seeded groups are a
 *     starting point, not a boundary.
 *   calendar_event.category, contact.category — user-chosen labels.
 *   broker_operation.type — the broker's vocabulary, not ours.
 */

/**
 * Everything that can be tagged, filed a document against, or linked to a
 * contact — the records that carry a row in `entity`.
 *
 * Exactly what is linked today, plus the three connectors that do the linking.
 * `category` is deliberately absent: nothing links to a category, and adding a
 * kind later is one migration, while a trigger on a table that never needed one
 * is a write on every insert forever.
 */
export const ENTITY_KINDS = [
	'person',
	'account',
	'transaction',
	'transaction_split',
	'property',
	'tenancy',
	'loan',
	'document',
	'contact',
	'tag',
	'subject',
	// A year's filing arrives as several pieces of paper — the statement, the
	// employer's income confirmation, the broker's report — so a statement has
	// to be linkable. Its attachments live in document_link like every other
	// filing rather than in a table of their own.
	'tax_statement'
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export const ENUMS = {
	'person.role': ['admin', 'member'],

	'account.kind': ['current', 'savings', 'brokerage'],

	// Where a category group sits in the waterfall. Not derivable from sort
	// order: income opens the chart, expense groups are its stages, savings
	// closes it, and a user-created group has to say which it is.
	'category_group.role': ['income', 'expense', 'savings'],

	// A person's chosen theme. Null means never chosen, which reads as dark —
	// the default — rather than as a third state.
	'person.theme': ['dark', 'light'],

	'property.kind': ['lived', 'rented'],
	'property_bill.source': ['manual', 'meter'],

	'loan.kind': ['mortgage', 'car', 'consumer', 'family'],
	'loan.regime': ['fixed_period', 'fixed_term', 'floating'],
	'loan.day_count': ['30/360', 'act/365', 'act/360'],
	'loan.accrual_style': ['payment', 'calendar'],
	'loan_event.kind': ['payment', 'extra_payment', 'refix', 'fee', 'balance'],

	// Four, not three. `filed` is written by the demo seed and treated as
	// terminal beside `confirmed` by ingest — see the note above.
	'transaction.review_state': ['auto', 'needs_review', 'confirmed', 'filed'],
	'transfer_pair.state': ['auto', 'proposed', 'confirmed', 'rejected'],

	'job.kind': ['import', 'calendar_sync', 'extract_text'],
	job_state: ['queued', 'running', 'done', 'failed'],
	'import_profile.source': ['delimited', 'xlsx'],
	'import_profile.origin': ['builtin', 'user', 'imported'],

	// 'seeded' existed while a fresh install shipped 42 starter rules; migration
	// 0033 retired it and nothing writes it now.
	'rule.provenance': ['learned', 'manual'],

	// What KIND of paper this is — orthogonal to where it is filed. Behaviour
	// hangs off type (the salary tracker reads `type='payslip'`), never off the
	// shelf, which is a row a household may rename or delete.
	//
	// NOT a CHECK any more: `document_type` is a table, seeded with these and
	// grown by the household, and `document.type` is a foreign key into it. This
	// list is what the app SHIPS and what code may refer to by name — every
	// value here exists on every instance, which is what makes reading one safe.
	'document.type': [
		'contract',
		'invoice',
		'receipt',
		'payslip',
		'bank_statement',
		// A broker's yearly report is the paper the investments tab is built on.
		// Filed as 'other' it was the one financial document the type filter could
		// not name.
		'broker_report',
		'insurance_policy',
		'claim',
		'id_document',
		'certificate',
		'medical_record',
		'tax_document',
		'technical_plan',
		'correspondence',
		'warranty',
		'manual',
		'other'
	],

	// v1 is two values and one rule: an admin sees both, a member sees `normal`
	// and cannot infer the other from a count, a search hint or a calendar feed.
	// Per-person ACLs are deferred; this column does not change if they arrive.
	'document.sensitivity': ['normal', 'restricted'],

	// How a chunk's text was obtained. Shown only under an admin disclosure —
	// a person filing paper does not care that page 3 was recognised.
	'document_text_chunk.source': ['text_layer', 'ocr', 'plain'],
	// Three verbs, three meanings — the kind lives in the word. `renews`: a
	// successor arrives on the date. `expires`: validity stops and nothing
	// replaces it. `due`: money is owed by the date. `ends` was a fourth that
	// meant exactly what `expires` means, and a picker of near-synonyms is a
	// picker nobody can answer; the upgrade folds it into `expires`.
	'document.expiry_verb': ['expires', 'renews', 'due'],

	// What an identity document IS, which `document.type` cannot say: every one
	// of these files as `type: 'id_document'`, and a wallet that cannot tell a
	// passport from a driving licence is a wallet nobody recognises their own
	// cards in. Hand-entered, always — nothing reads a document to fill it.
	// `residence_permit` shares the generic artwork rather than getting a
	// drawing of its own, because it looks different in every country that
	// issues one.
	'document_identity.kind': ['passport', 'id_card', 'driving_licence', 'residence_permit', 'other'],

	'calendar_account.provider': ['icloud', 'google'],
	'calendar_conflict.resolution': ['local-won', 'remote-won', 'wrote-back'],

	// P4 strongest, P0 nothing proven. Stable: the classes are what the proof
	// engine can conclude, not what any one reader happens to support.
	proof_class: ['P4', 'P3', 'P2', 'P1', 'P0'],

	'entity.kind': ENTITY_KINDS
} as const satisfies Record<string, readonly string[]>;

type EnumKey = keyof typeof ENUMS;
export type EnumValue<K extends EnumKey> = (typeof ENUMS)[K][number];

/**
 * A document type: one the app ships, or one the household added.
 *
 * `string & {}` keeps the seventeen as suggestions while allowing any key —
 * which is what the column holds now that `document_type` is a table. Written
 * once so the columns and the code that reads them say the same thing.
 */
export type DocumentTypeKey = EnumValue<'document.type'> | (string & {});

/**
 * Which column each list constrains.
 *
 * Separate from `ENUMS` because three of the lists are shared by more than one
 * column — a proof class is recorded on both `import_file` and `transaction`,
 * and the job state outlives the table it was named for. The constraint name is
 * derived from the column, never from the list.
 */
export const ENUM_COLUMNS: { table: string; column: string; enum: EnumKey }[] = [
	{ table: 'person', column: 'role', enum: 'person.role' },
	{ table: 'account', column: 'kind', enum: 'account.kind' },
	{ table: 'category_group', column: 'role', enum: 'category_group.role' },
	{ table: 'person', column: 'theme', enum: 'person.theme' },
	{ table: 'property', column: 'kind', enum: 'property.kind' },
	{ table: 'property_bill', column: 'source', enum: 'property_bill.source' },
	{ table: 'loan', column: 'kind', enum: 'loan.kind' },
	{ table: 'loan', column: 'regime', enum: 'loan.regime' },
	{ table: 'loan', column: 'day_count', enum: 'loan.day_count' },
	{ table: 'loan', column: 'accrual_style', enum: 'loan.accrual_style' },
	{ table: 'loan_event', column: 'kind', enum: 'loan_event.kind' },
	{ table: 'transaction', column: 'review_state', enum: 'transaction.review_state' },
	{ table: 'transaction', column: 'proof_class', enum: 'proof_class' },
	{ table: 'transfer_pair', column: 'state', enum: 'transfer_pair.state' },
	{ table: 'job', column: 'kind', enum: 'job.kind' },
	{ table: 'job', column: 'state', enum: 'job_state' },
	{ table: 'import_profile', column: 'source', enum: 'import_profile.source' },
	{ table: 'import_profile', column: 'origin', enum: 'import_profile.origin' },
	{ table: 'import_file', column: 'proof_class', enum: 'proof_class' },
	{ table: 'rule', column: 'provenance', enum: 'rule.provenance' },
	{ table: 'document', column: 'sensitivity', enum: 'document.sensitivity' },
	{ table: 'document_text_chunk', column: 'source', enum: 'document_text_chunk.source' },
	{ table: 'document', column: 'expiry_verb', enum: 'document.expiry_verb' },
	{ table: 'document_identity', column: 'kind', enum: 'document_identity.kind' },
	{ table: 'calendar_account', column: 'provider', enum: 'calendar_account.provider' },
	{ table: 'calendar_conflict', column: 'resolution', enum: 'calendar_conflict.resolution' },
	{ table: 'entity', column: 'kind', enum: 'entity.kind' }
];

/** `<table>_<column>_check` — the locked constraint name. */
export const checkName = (table: string, column: string): string => `${table}_${column}_check`;

/** Is this one of the values the column accepts? */
export function isEnumValue<K extends EnumKey>(key: K, value: unknown): value is EnumValue<K> {
	return typeof value === 'string' && (ENUMS[key] as readonly string[]).includes(value);
}

/**
 * Narrow an outside string to a column's value, or fall back.
 *
 * For boundaries where the value arrives untyped — a form field, a parser's
 * output, a URL parameter. Validating here rather than casting is the point: a
 * cast would let the CHECK constraint be the thing that discovers the bad value,
 * which turns a recoverable form error into a failed transaction.
 */
export function asEnumValue<K extends EnumKey>(
	key: K,
	value: unknown,
	fallback: EnumValue<K>
): EnumValue<K> {
	return isEnumValue(key, value) ? value : fallback;
}
