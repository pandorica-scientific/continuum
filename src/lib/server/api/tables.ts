// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Every table in the database over /api/v1/tables, read and written row by row.
 *
 * Derived from the Drizzle schema rather than listed, so reaching a table needs
 * no endpoint of its own. What is written here instead is the short list of
 * what must NOT be reachable, and why. Derived is not the same as undecided:
 * `tests/unit/api-tables.test.ts` names every reachable table, so a table added
 * to the schema fails it until somebody chooses to expose or hide it, and fails
 * it too when a new column looks like a secret or an uploaded file's name.
 *
 * Names are the database's own: `/api/v1/tables/loan_event` and `booked_on`,
 * exactly what `psql` and a backup show, so `\d loan_event` documents the call.
 *
 * A write here is a row, not an action. The database's own constraints and
 * triggers apply — foreign keys, CHECKs, entity registration — but nothing the
 * app does around a write in its own screens runs: no import deduplication, no
 * transfer pairing, no file on disk created or removed with a document row.
 */

import { and, asc, count, eq, getTableColumns, inArray, is, not, sql, type SQL } from 'drizzle-orm';
import { getTableConfig, PgTable, type PgColumn } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { db, type Queryable } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { isSafeBigint, safeInteger } from '$lib/api/serialise';
import { NO_SUCH_ROW } from '$lib/ids';
import { ENUMS } from '$lib/enums';
import {
	documentTypesOutOfReach,
	ENDPOINT_REACH,
	reaches,
	type ApiArea,
	type ApiGrant,
	type Reach
} from './areas';
import { ApiError, refusingBadRows } from './errors';

/**
 * Not reachable at all, not even to read. Each one decides who can sign in,
 * and a row written into it would outlive the token that wrote it:
 *
 * - `api_token` — a token could mint a sibling that survives its own revocation.
 * - `session` — a session row with a known token is a sign-in as anybody.
 * - `enrollment_token` — a known link sets anybody's password.
 * - `setup_claim` — clearing it reopens first-run setup to whoever asks first.
 * - `settings` — holds the Home Assistant access token beside the instance's
 *   configuration, and Settings already edits both with the checks they need.
 */
const HIDDEN_TABLES = new Set([
	'api_token',
	'session',
	'enrollment_token',
	'setup_claim',
	'settings'
]);

/**
 * Readable, never writable.
 *
 * - `calendar_account` — a connected calendar is set up in Settings, where its
 *   credential is tried before it is saved; a row written here could point the
 *   household's events at a calendar nobody chose.
 * - `job` — a queued import carries its file's bytes, and the worker stores and
 *   reads whatever it is handed. `/api/v1/files` is the one way a token puts
 *   bytes on the data volume, PDF only, and a row here would go round it.
 */
const READ_ONLY_TABLES = new Set(['calendar_account', 'job']);

/**
 * Never read and never written, as `table.column`.
 *
 * - A person's password hash and a calendar's credential, for what they are.
 * - `job.blob` — a queued import's whole file, base64: up to 32 MB in every
 *   listing of the queue, and the same statement the import files as a
 *   document once it runs.
 */
const HIDDEN_COLUMNS = new Set(['person.password_hash', 'calendar_account.credential', 'job.blob']);

/**
 * Readable, never writable, as `table.column`.
 *
 * - Who is an administrator, and whether a person may sign in at all. Changing
 *   either is a Settings action.
 * - Every column naming a file on the data volume. A file a token uploads
 *   through `/api/v1/files` is named by the server, so all a caller could write
 *   here is another row's file, which the app would then delete along with this
 *   row, or a path it would read.
 */
const READ_ONLY_COLUMNS = new Set([
	'person.role',
	'person.auth_generation',
	'person.deactivated_at',
	'document.stored_name',
	'import_file.stored_name',
	'contact.photo',
	'trip_idea.photo',
	'recipe.photo',
	'bottle.photo',
	'bottle.label_photo',
	'property.images',
	// What the app reads by name. A system shelf and a built-in document type
	// are what code files paper on and reads paper as; a flag turned off here
	// would let the next screen delete one, and turned on it would make a
	// household's own shelf or type impossible to delete there.
	'shelf.system',
	'document_type.builtin'
]);

/**
 * Written once, when the row is inserted, and fixed after — as `table.column`.
 *
 * - `shelf.key` — the name code finds a shelf by. A new shelf needs one, but
 *   the inbox with its key moved is a shelf no upload, receipt or capture can
 *   find, and no screen can put it back.
 */
const INSERT_ONLY_COLUMNS = new Set(['shelf.key']);

/**
 * Stamped with the server's clock whatever time is sent, as `table.column`.
 *
 * - `removed_at` on a trip and an idea — setting it is how a client removes
 *   one the way the app does, and the sweep deletes it a minute later. Any
 *   other time would skip that minute, or hide the record from every screen
 *   for good; null is still null, which is the undo.
 */
const SERVER_CLOCK_COLUMNS = new Set(['trip.removed_at', 'trip_idea.removed_at']);

/**
 * Rows the API may not delete, as a condition on the row, with the reason the
 * refusal gives. Each is a row the app itself depends on, and the screen that
 * deletes the others refuses this one too.
 */
const PROTECTED_ROWS: Record<string, { row: SQL; why: string }> = {
	shelf: {
		row: eq(schema.shelf.system, true),
		why: 'A system shelf is where the app files paper, so it cannot be deleted.'
	},
	document_type: {
		row: eq(schema.documentType.builtin, true),
		why: 'A built-in document type is one the app reads by name, so it cannot be deleted.'
	},
	// Who is an administrator is a Settings action, and so is removing one:
	// Settings will not remove the last, and the API does not ask.
	person: {
		row: eq(schema.person.role, 'admin'),
		why: 'An administrator is removed in Settings, not over the API.'
	}
};

/**
 * The area each reachable table belongs to, for tokens limited to some.
 *
 * Every reachable table is named here, and `tests/unit/api-tables.test.ts`
 * pins the whole map, so a table added to the schema is refused to every
 * limited token until somebody places it. `shared` is for tables that serve
 * every area at once — handing one to a token limited to trips would hand it
 * the household's people, tags or the whole document registry with it.
 */
const TABLE_REACH: Record<string, Reach> = {
	account: 'ledger',
	bank: 'ledger',
	category: 'ledger',
	category_group: 'ledger',
	rule: 'ledger',
	rule_tag: 'ledger',
	transaction: 'ledger',
	transaction_fingerprint_alias: 'ledger',
	transaction_split: 'ledger',
	transfer_pair: 'ledger',
	transfer_pair_leg: 'ledger',

	import_file: 'import',
	import_profile: 'import',

	broker_import_state: 'investments',
	broker_operation: 'investments',
	broker_position: 'investments',
	equity_grant: 'investments',
	equity_tranche: 'investments',
	holding: 'investments',
	portfolio_snapshot: 'investments',
	security_price: 'investments',

	loan: 'loans',
	loan_event: 'loans',
	loan_fixation_period: 'loans',
	loan_property: 'loans',

	property: 'property',
	property_bill: 'property',
	property_opening: 'property',
	property_valuation: 'property',
	tenancy: 'property',

	engagement: 'salary',
	salary_attribution: 'salary',
	salary_entry: 'salary',

	tax_filing_override: 'tax',
	tax_residence: 'tax',
	tax_statement: 'tax',
	tax_statement_line: 'tax',

	calendar_account: 'calendar',
	calendar_conflict: 'calendar',
	calendar_event: 'calendar',
	calendar_event_exception: 'calendar',
	calendar_sync_link: 'calendar',

	contact: 'contacts',
	contact_link: 'contacts',

	document: 'documents',
	document_identity: 'documents',
	document_identity_number: 'documents',
	document_link: 'documents',
	document_text: 'documents',
	document_text_chunk: 'documents',
	document_type: 'documents',
	lane: 'documents',
	shelf: 'documents',
	shelf_type: 'documents',
	// A car, a boiler: a card on a Documents shelf, and what its paper is filed
	// against. Nothing outside the archive reads one.
	subject: 'documents',

	place: 'trips',
	sight_visit: 'trips',
	trip: 'trips',
	trip_booking: 'trips',
	trip_destination: 'trips',
	trip_idea: 'trips',
	trip_idea_heart: 'trips',
	trip_member: 'trips',
	trip_place: 'trips',
	visit: 'trips',
	visit_member: 'trips',

	recipe: 'cookbook',
	recipe_category: 'cookbook',
	recipe_ingredient: 'cookbook',
	recipe_step: 'cookbook',
	recipe_tag: 'cookbook',
	recipe_tag_link: 'cookbook',

	bottle: 'collections',
	collection: 'collections',
	tasting: 'collections',
	tasting_note: 'collections',

	currency: 'shared',
	currency_rate: 'shared',
	entity: 'shared',
	job: 'shared',
	net_worth_snapshot: 'shared',
	organisation: 'shared',
	person: 'shared',
	tag: 'shared',
	tag_link: 'shared'
};

/**
 * The columns of a `shared` table that one area reads, and never writes, as
 * table → the area and its columns. The rest of the table, and writing to it,
 * stay with a token that reaches everything.
 *
 * - `person` to Household — who lives here: a name, a birth year and a
 *   citizenship, so the person ids a trip's members carry are somebody. Who is
 *   an administrator and who may sign in are Settings' business, and a
 *   person's screen preferences nobody else's.
 */
const AREA_VIEWS: Record<string, { area: ApiArea; columns: readonly string[] }> = {
	person: { area: 'household', columns: ['id', 'name', 'birth_year', 'citizenship'] }
};

/** Rows one call may list or insert. A household's largest table pages at this. */
const MAX_ROWS = 1000;
const DEFAULT_LIMIT = 100;

export interface ApiColumn {
	/** The database's name, which is the one the API speaks. */
	name: string;
	/** Drizzle's property name for the same column. */
	key: string;
	column: PgColumn;
	/** May be given on insert. */
	writable: boolean;
	/** May be changed afterwards: writable, and not written once only. */
	updatable: boolean;
	/** Stamped with the server's clock whatever time is sent. */
	serverClock: boolean;
}

export interface ApiTable {
	name: string;
	table: PgTable;
	columns: ApiColumn[];
	primaryKey: string[];
	writable: boolean;
	/** The one-column uuid key the API may generate when an insert leaves it out. */
	generatedKey: ApiColumn | null;
	/** `shared` for a table nobody has placed, which only an unlimited token reaches. */
	reach: Reach;
	/**
	 * The columns that can name a document, where there are any: a row about a
	 * payslip is out of reach of a token without Salary, in whichever table it
	 * sits and through whichever column it names one.
	 */
	documentColumns: ApiColumn[];
	/**
	 * The part of this table another area reads, as a table of its own: those
	 * columns only, never written, with that area as its reach. Null for a
	 * table no other area reads.
	 */
	view: ApiTable | null;
}

/**
 * Whether a column can hold a document's id: `document.id` itself, `entity.id`
 * — a document is an entity, so every link, lane and tag pointing at "any
 * record" can point at one — or a one-column foreign key to a column that
 * can. So a chunk of a document's text, which points at the text, which points
 * at the document, is found as well as the text, and a link's target as well
 * as its document. Derived, so a table added later that points at either is
 * covered without being listed.
 */
function namesDocument(table: PgTable, column: string, seen: ReadonlySet<PgTable>): boolean {
	if (table === schema.document && column === schema.document.id.name) return true;
	if (table === schema.entity && column === schema.entity.id.name) return true;
	// A table pointing at itself, such as a category's parent, would recurse
	// for ever. Seen along THIS chain only: a sibling foreign key visiting the
	// same table is a different path, and must be followed on its own.
	if (seen.has(table)) return false;
	const along = new Set([...seen, table]);
	return getTableConfig(table).foreignKeys.some((fk) => {
		const reference = fk.reference();
		return (
			reference.columns.length === 1 &&
			reference.columns[0].name === column &&
			namesDocument(reference.foreignTable, reference.foreignColumns[0].name, along)
		);
	});
}

function describe(table: PgTable): ApiTable | null {
	const config = getTableConfig(table);
	if (HIDDEN_TABLES.has(config.name)) return null;

	const writableTable = !READ_ONLY_TABLES.has(config.name);
	const columns = Object.entries(getTableColumns(table))
		.filter(([, column]) => !HIDDEN_COLUMNS.has(`${config.name}.${column.name}`))
		.map(([key, column]) => {
			const qualified = `${config.name}.${column.name}`;
			const writable = writableTable && !READ_ONLY_COLUMNS.has(qualified);
			return {
				name: column.name,
				key,
				column,
				writable,
				updatable: writable && !INSERT_ONLY_COLUMNS.has(qualified),
				serverClock: SERVER_CLOCK_COLUMNS.has(qualified)
			};
		});

	const primaryKey = config.columns.some((c) => c.primary)
		? config.columns.filter((c) => c.primary).map((c) => c.name)
		: (config.primaryKeys[0]?.columns.map((c) => c.name) ?? []);

	// A uuid key with no default is one the app mints with uuidv7() before every
	// insert, so the API does the same. Not when the key is also a foreign key —
	// `document_text.document_id` names an existing document, and a fresh uuid
	// there could only ever fail.
	const referencing = new Set(
		config.foreignKeys.flatMap((fk) => fk.reference().columns.map((c) => c.name))
	);
	const only = primaryKey.length === 1 ? columns.find((c) => c.name === primaryKey[0]) : undefined;
	const generatedKey =
		only &&
		only.column.getSQLType() === 'uuid' &&
		!only.column.hasDefault &&
		!referencing.has(only.name)
			? only
			: null;

	const whole: ApiTable = {
		name: config.name,
		table,
		columns,
		primaryKey,
		writable: writableTable,
		generatedKey,
		reach: TABLE_REACH[config.name] ?? 'shared',
		documentColumns: columns.filter((c) => namesDocument(table, c.name, new Set())),
		view: null
	};
	const view = AREA_VIEWS[config.name];
	if (view) {
		const read = (c: ApiColumn) => view.columns.includes(c.name);
		whole.view = {
			...whole,
			columns: columns.filter(read).map((c) => ({ ...c, writable: false, updatable: false })),
			writable: false,
			generatedKey: null,
			reach: view.area,
			documentColumns: whole.documentColumns.filter(read)
		};
	}
	return whole;
}

let registry: Map<string, ApiTable> | null = null;

/** Every reachable table, by its database name. */
export function apiTables(): Map<string, ApiTable> {
	if (!registry) {
		registry = new Map();
		for (const exported of Object.values(schema)) {
			if (!is(exported, PgTable)) continue;
			const described = describe(exported);
			if (described) registry.set(described.name, described);
		}
	}
	return registry;
}

/**
 * The area a table belongs to, for the boundary: `shared` for no such table,
 * the same answer as for a table nobody has placed, so no caller has to pick
 * a default of its own and none can pick a wrong one.
 */
export function tableReach(name: string): Reach {
	return apiTables().get(name)?.reach ?? 'shared';
}

/**
 * The area reading a table needs, for the boundary: its view's where it has
 * one, and its own otherwise. Only a `shared` table has a view, so a token
 * that reaches the whole table reaches the view too. Writing always needs the
 * table's own, and so does a file attached to one of its rows: Household reads
 * a person's name, not their passport scan.
 */
export function tableReadReach(name: string): Reach {
	return apiTables().get(name)?.view?.reach ?? tableReach(name);
}

/**
 * A table as this grant sees it: whole within its areas, only its view's
 * columns where the grant reaches the view alone, and null where it sees none
 * of it.
 */
function asSeenBy(grant: ApiGrant, table: ApiTable): ApiTable | null {
	if (reaches(grant, table.reach)) return table;
	if (table.view && reaches(grant, table.view.reach)) return table.view;
	return null;
}

/**
 * The areas a token can usefully be limited to: each one some table or
 * endpoint belongs to. An area with nothing of its own — Retirement adds up
 * other areas' rows, Home Assistant lives in Settings — would make a token
 * that answers 403 to every call.
 */
export function areasWithData(): ApiArea[] {
	const placed = new Set<Reach>([
		...[...apiTables().values()].flatMap((t) => (t.view ? [t.reach, t.view.reach] : [t.reach])),
		...Object.values(ENDPOINT_REACH)
	]);
	return ENUMS['api_token.area'].filter((area) => placed.has(area));
}

/**
 * What `GET /api/v1/tables` answers with: enough to write a call without
 * reading the source. Only the tables this token reaches — a token limited to
 * trips has no business learning the shape of the salary tables.
 */
export function describeTables(grant: ApiGrant) {
	return [...apiTables().values()]
		.map((t) => asSeenBy(grant, t))
		.filter((t): t is ApiTable => t !== null)
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((t) => ({
			name: t.name,
			area: t.reach,
			writable: t.writable,
			primaryKey: t.primaryKey,
			columns: t.columns.map((c) => ({
				name: c.name,
				type: c.column.getSQLType(),
				nullable: !c.column.notNull,
				hasDefault: c.column.hasDefault || c === t.generatedKey,
				writable: c.writable,
				updatable: c.updatable
			}))
		}));
}

/**
 * The table as this grant sees it. The boundary refuses a table outside the
 * token's areas before any handler runs; asked again here so that a limited
 * token is handed only the columns it reads, and a caller that skipped the
 * boundary is refused rather than served the whole table.
 */
function requireTable(grant: ApiGrant, name: string): ApiTable {
	const table = apiTables().get(name);
	if (!table) throw new ApiError(`There is no table "${name}".`, 404);
	const seen = asSeenBy(grant, table);
	if (!seen) throw new ApiError(`This token does not reach table "${name}".`, 403);
	return seen;
}

function requireWritable(grant: ApiGrant, name: string): ApiTable {
	const table = requireTable(grant, name);
	if (!table.writable) throw new ApiError(`Table "${name}" is read-only over the API.`, 405);
	return table;
}

function requireColumn(table: ApiTable, name: string): ApiColumn {
	const column = table.columns.find((c) => c.name === name);
	if (!column) throw new ApiError(`Table "${table.name}" has no column "${name}".`, 400);
	return column;
}

/** A whole number toJson can give back, as a bigint; null for anything else. */
function safeBigint(value: unknown): bigint | null {
	if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : null;
	if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return null;
	const parsed = BigInt(value);
	return isSafeBigint(parsed) ? parsed : null;
}

// Date, time to the minute or finer, and an offset. The offset is required: a
// time without one means whatever zone the server runs in, so the same call
// would store a different instant on a different machine.
const ISO_INSTANT =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The year a timestamp may start from. The driver reads a timestamp back
 * through `new Date()`, which takes a year below 100 for a two-digit one:
 * 0050 is stored, then read as 1950 — and the answer to the insert itself
 * fails with the row already written.
 */
const FIRST_READABLE_YEAR = 100;

/** Whether year, month and day name a real day; new Date() rolls 30 February over into March. */
function isCalendarDay(year: string, month: string, day: string): boolean {
	const calendar = new Date(0);
	calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
	return calendar.getUTCMonth() === Number(month) - 1 && calendar.getUTCDate() === Number(day);
}

/** An ISO 8601 instant as a Date; null for anything else, including 30 February. */
function isoInstant(value: unknown): Date | null {
	const match = typeof value === 'string' ? ISO_INSTANT.exec(value) : null;
	if (!match) return null;
	const [, year, month, day, hour, minute, second = '0', offsetHour = '0', offsetMinute = '0'] =
		match;
	if (Number(year) < FIRST_READABLE_YEAR || !isCalendarDay(year, month, day)) return null;
	if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
	if (Number(offsetHour) > 23 || Number(offsetMinute) > 59) return null;
	const parsed = new Date(value as string);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A plain decimal: digits, a point, an exponent. Never NaN or Infinity, which Postgres would take. */
const DECIMAL = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
const WHOLE = /^-?\d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One JSON value as the column's driver expects it, refusing a value of the
 * wrong kind.
 *
 * Checked here rather than left to Postgres wherever Postgres would take what
 * the app cannot read back: 'NaN' in a numeric column, which then fails every
 * sum over it, a date in the server's own DateStyle ('03/04/2026' is 4 March),
 * '-infinity', or `true` in a text column, stored as the word. What is left —
 * a CHECK, a foreign key, a value out of range — is Postgres' to refuse, and
 * its refusal becomes the 400.
 */
export function fromJson(column: ApiColumn, value: unknown): unknown {
	if (value === null) return null;
	const refuse = (what: string) =>
		new ApiError(`Column "${column.name}" takes ${what}, not ${JSON.stringify(value)}.`, 400);
	const finite = typeof value === 'number' && Number.isFinite(value);

	switch (column.column.columnType) {
		case 'PgJson':
		case 'PgJsonb':
			return value;
		case 'PgBigInt53':
		case 'PgBigInt64': {
			// Bounded by what toJson can answer with: a larger value would be
			// written, then refuse to serialise, and every later read of the table
			// would fail on it.
			const parsed = safeBigint(value);
			if (parsed === null) {
				throw refuse(
					`a whole number from -${Number.MAX_SAFE_INTEGER} to ${Number.MAX_SAFE_INTEGER}`
				);
			}
			return column.column.columnType === 'PgBigInt53' ? Number(parsed) : parsed;
		}
		case 'PgInteger':
		case 'PgSmallInt':
			if ((finite && Number.isInteger(value)) || (typeof value === 'string' && WHOLE.test(value))) {
				return value;
			}
			throw refuse('a whole number');
		case 'PgNumeric':
		case 'PgDoublePrecision':
		case 'PgReal': {
			// A numeric column's value is a decimal string to the driver; a JSON
			// number is accepted as the same digits.
			if (finite) return column.column.dataType === 'string' ? String(value) : value;
			if (typeof value === 'string' && DECIMAL.test(value)) return value;
			throw refuse('a number');
		}
		case 'PgTimestamp': {
			const parsed = isoInstant(value);
			if (!parsed) {
				throw refuse(
					`an ISO 8601 timestamp with an offset from the year ${FIRST_READABLE_YEAR} on, like 2026-09-27T08:00:00Z`
				);
			}
			return parsed;
		}
		case 'PgDate':
		case 'PgDateString': {
			const match = typeof value === 'string' ? ISO_DAY.exec(value) : null;
			if (!match || !isCalendarDay(match[1], match[2], match[3])) {
				throw refuse('an ISO 8601 day, like 2026-09-27');
			}
			return column.column.columnType === 'PgDate' ? new Date(`${value}T00:00:00Z`) : value;
		}
		case 'PgBoolean':
			if (typeof value === 'boolean') return value;
			throw refuse('true or false');
		case 'PgUUID':
			if (typeof value !== 'string' || !UUID.test(value)) throw refuse('a uuid');
			// The id `asRowId` turns junk into so that it matches nothing. A row
			// holding it would be matched by every malformed id a form sends.
			if (value === NO_SUCH_ROW) throw refuse('a uuid other than the all-zeros one');
			return value;
		case 'PgText':
		case 'PgChar':
		case 'PgVarchar':
			if (typeof value === 'string') return value;
			throw refuse('text');
		default:
			// A kind of column nobody has taught this function: refused rather than
			// passed through, and `api-tables.test.ts` names every kind a table has.
			throw new ApiError(
				`Column "${column.name}" cannot be written or filtered over the API.`,
				400
			);
	}
}

/**
 * A query-string value, which is always text, as the column's driver expects it.
 *
 * A timestamp's `+02:00` arrives as ` 02:00`, since a query string reads `+`
 * as a space; nothing else can put a space there, so it is read back as the
 * `+` it was.
 */
function fromQuery(column: ApiColumn, raw: string): unknown {
	switch (column.column.dataType) {
		case 'json':
			throw new ApiError(`Column "${column.name}" holds JSON and cannot be filtered on.`, 400);
		case 'boolean':
			if (raw === 'true' || raw === 'false') return raw === 'true';
			throw new ApiError(`Column "${column.name}" is filtered with true or false.`, 400);
		case 'date':
			return fromJson(column, raw.replace(/ (?=\d{2}:\d{2}$)/, '+'));
		default:
			return fromJson(column, raw);
	}
}

/**
 * One filter. A timestamp is compared to the millisecond: Postgres keeps
 * microseconds and an answer carries milliseconds, so a value the API handed
 * out would otherwise never find its own row again.
 */
function matches(column: ApiColumn, raw: string): SQL {
	const value = fromQuery(column, raw);
	return column.column.dataType === 'date'
		? sql`date_trunc('milliseconds', ${column.column}) = ${sql.param(value, column.column)}`
		: eq(column.column, value);
}

/**
 * One row as JSON, under the database's column names.
 *
 * Converted by the column's declared kind, never by whatever value turns up:
 * a bigint anywhere else is a JSON.stringify error during development rather
 * than a figure quietly coerced (see `$lib/api/serialise`).
 */
export function toJson(table: ApiTable, row: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const column of table.columns) {
		const value = row[column.key];
		const kind = column.column.columnType;
		out[column.name] =
			value === null || value === undefined
				? value
				: kind === 'PgBigInt64'
					? safeInteger(value as bigint)
					: kind === 'PgTimestamp'
						? (value as Date).toISOString()
						: value;
	}
	return out;
}

/** The exposed columns as a selection, so a hidden one is never even fetched. */
function selection(table: ApiTable): Record<string, PgColumn> {
	return Object.fromEntries(table.columns.map((c) => [c.key, c.column]));
}

function filtersFrom(table: ApiTable, params: URLSearchParams, skip: Set<string>): SQL[] {
	const filters: SQL[] = [];
	for (const name of new Set(params.keys())) {
		if (skip.has(name)) continue;
		const values = params.getAll(name);
		if (values.length > 1) throw new ApiError(`"${name}" is given more than once.`, 400);
		filters.push(matches(requireColumn(table, name), values[0]));
	}
	return filters;
}

function wholeParam(params: URLSearchParams, name: string, fallback: number, max: number): number {
	const raw = params.get(name);
	if (raw === null) return fallback;
	// Digits only: Number() reads '' as 0, and '0x10' and '1e2' as numbers.
	const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
	if (!Number.isSafeInteger(value) || value > max) {
		throw new ApiError(`"${name}" must be a whole number from 0 to ${max}.`, 400);
	}
	return value;
}

/**
 * The one row the query string names. PATCH and DELETE take the whole primary
 * key and nothing else, so neither can touch more than one row — a typo in a
 * filter would otherwise widen a delete to the whole table.
 */
function rowKey(table: ApiTable, params: URLSearchParams): SQL {
	const given = [...new Set(params.keys())];
	const missing = table.primaryKey.filter((name) => !params.has(name));
	const extra = given.filter((name) => !table.primaryKey.includes(name));
	if (missing.length || extra.length) {
		throw new ApiError(
			`Name the row by its primary key and nothing else: ${table.primaryKey.map((k) => `${k}=…`).join('&')}.`,
			400
		);
	}
	const where = and(...filtersFrom(table, params, new Set()));
	if (!where) throw new ApiError(`Table "${table.name}" has no primary key.`, 400);
	return where;
}

/** A JSON object's fields as Drizzle values, refusing what may not be written. */
function valuesFrom(
	table: ApiTable,
	body: unknown,
	write: 'insert' | 'update'
): Record<string, unknown> {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw new ApiError('A row is a JSON object of column names and values.', 400);
	}
	const values: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(body)) {
		const column = requireColumn(table, name);
		if (!column.writable) {
			throw new ApiError(`Column "${name}" is read-only over the API.`, 400);
		}
		if (write === 'update' && !column.updatable) {
			throw new ApiError(`Column "${name}" is set when the row is added and fixed after.`, 400);
		}
		const converted = fromJson(column, value);
		values[column.key] = column.serverClock && converted !== null ? new Date() : converted;
	}
	return values;
}

/**
 * The rows about a document this grant does not reach, left out: a token
 * without Salary sees no payslip, nor its text, its links or anything else
 * that names it. Undefined when nothing is left out.
 */
function documentScope(table: ApiTable, grant: ApiGrant): SQL | undefined {
	const outOfReach = documentTypesOutOfReach(grant).map((t) => t.type);
	if (outOfReach.length === 0) return undefined;
	const types = sql.join(
		outOfReach.map((type) => sql`${type}`),
		sql`, `
	);
	return and(
		...table.documentColumns.map(
			(column) => sql`not exists (
				select 1 from ${schema.document} out_of_reach
				where out_of_reach.id = ${column.column}
				and out_of_reach.type in (${types})
			)`
		)
	);
}

/**
 * Refuse a write that leaves a row about a document this grant does not reach:
 * a new payslip, a document retyped as one, or a link, text or booking naming
 * one. Asked of the rows as written, inside the write's transaction, so the
 * refusal rolls the write back.
 */
async function refuseOutOfReach(
	table: ApiTable,
	grant: ApiGrant,
	rows: Record<string, unknown>[],
	handle: Queryable
): Promise<void> {
	const outOfReach = documentTypesOutOfReach(grant);
	if (outOfReach.length === 0) return;
	const ids = [
		...new Set(rows.flatMap((row) => table.documentColumns.map((column) => row[column.key])))
	].filter((id): id is string => typeof id === 'string');
	if (ids.length === 0) return;
	const [found] = await handle
		.select({ type: schema.document.type })
		.from(schema.document)
		.where(
			and(
				inArray(schema.document.id, ids),
				inArray(
					schema.document.type,
					outOfReach.map((t) => t.type)
				)
			)
		)
		.limit(1);
	const refused = outOfReach.find((t) => t.type === found?.type);
	if (refused) {
		throw new ApiError(
			`This token does not reach ${refused.area}, so it cannot write a ${refused.type} or a row about one.`,
			403
		);
	}
}

export async function listRows(
	grant: ApiGrant,
	name: string,
	params: URLSearchParams,
	handle: Queryable = db
) {
	const table = requireTable(grant, name);
	const limit = wholeParam(params, 'limit', DEFAULT_LIMIT, MAX_ROWS);
	const offset = wholeParam(params, 'offset', 0, Number.MAX_SAFE_INTEGER);
	const where = and(
		...filtersFrom(table, params, new Set(['limit', 'offset'])),
		documentScope(table, grant)
	);

	// Ordered by the primary key, so paging with offset neither repeats nor
	// skips a row between two calls.
	const order = table.primaryKey.map((k) => asc(requireColumn(table, k).column));
	const [rows, [{ total }]] = await refusingBadRows(() =>
		Promise.all([
			handle
				.select(selection(table))
				.from(table.table)
				.where(where)
				.orderBy(...order)
				.limit(limit)
				.offset(offset),
			handle.select({ total: count() }).from(table.table).where(where)
		])
	);
	return { table: table.name, total, limit, offset, rows: rows.map((r) => toJson(table, r)) };
}

/** Insert one row or an array of them, as one statement: all of them or none. */
export async function insertRows(
	grant: ApiGrant,
	name: string,
	body: unknown,
	handle: Queryable = db
) {
	const table = requireWritable(grant, name);
	const bodies = Array.isArray(body) ? body : [body];
	if (bodies.length === 0 || bodies.length > MAX_ROWS) {
		throw new ApiError(`Send from 1 to ${MAX_ROWS} rows.`, 400);
	}
	const values = bodies.map((b) => {
		const row = valuesFrom(table, b, 'insert');
		const key = table.generatedKey;
		if (key && row[key.key] === undefined) row[key.key] = uuidv7();
		return row;
	});
	const rows = await handle.transaction(async (tx) => {
		const written = await refusingBadRows(() =>
			tx.insert(table.table).values(values).returning(selection(table))
		);
		await refuseOutOfReach(table, grant, written, tx);
		return written;
	});
	return rows.map((r) => toJson(table, r));
}

/** Change the columns the body names on the one row the primary key names. */
export async function updateRow(
	grant: ApiGrant,
	name: string,
	params: URLSearchParams,
	body: unknown,
	handle: Queryable = db
) {
	const table = requireWritable(grant, name);
	const where = and(rowKey(table, params), documentScope(table, grant));
	const values = valuesFrom(table, body, 'update');
	if (Object.keys(values).length === 0) throw new ApiError('Nothing to change.', 400);
	// A row's key is what everything else points at; moving it is a delete and
	// an insert, said as such.
	const moved = table.columns.find((c) => table.primaryKey.includes(c.name) && c.key in values);
	if (moved) {
		throw new ApiError(`"${moved.name}" is the primary key and cannot be changed.`, 400);
	}
	const rows = await handle.transaction(async (tx) => {
		const written = await refusingBadRows(() =>
			tx.update(table.table).set(values).where(where).returning(selection(table))
		);
		await refuseOutOfReach(table, grant, written, tx);
		return written;
	});
	if (rows.length === 0) throw new ApiError('No such row.', 404);
	return toJson(table, rows[0]);
}

/** Delete the one row the primary key names, answering with what it held. */
export async function deleteRow(
	grant: ApiGrant,
	name: string,
	params: URLSearchParams,
	handle: Queryable = db
) {
	const table = requireWritable(grant, name);
	const where = and(rowKey(table, params), documentScope(table, grant));
	const guard = PROTECTED_ROWS[table.name];
	const rows = await refusingBadRows(() =>
		handle
			.delete(table.table)
			.where(and(where, guard ? not(guard.row) : undefined))
			.returning(selection(table))
	);
	if (rows.length === 0) {
		// Asked only after nothing was deleted, so the common case costs nothing:
		// told apart from a row that is not there, because the fix differs.
		const held = guard
			? await handle
					.select({ one: sql`1` })
					.from(table.table)
					.where(and(where, guard.row))
					.limit(1)
			: [];
		if (held.length > 0) throw new ApiError(guard.why, 409);
		throw new ApiError('No such row.', 404);
	}
	return toJson(table, rows[0]);
}
