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

import { and, asc, count, eq, getTableColumns, inArray, is, sql, type SQL } from 'drizzle-orm';
import { getTableConfig, PgTable, type PgColumn } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';
import { db, type Queryable } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { isSafeBigint, safeInteger } from '$lib/api/serialise';
import { documentTypesOutOfReach, reaches, type ApiGrant, type Reach } from './areas';
import { ApiError } from './errors';

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

/** Never read and never written, as `table.column`. */
const HIDDEN_COLUMNS = new Set(['person.password_hash', 'calendar_account.credential']);

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
	'property.images'
]);

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
	subject: 'shared',
	tag: 'shared',
	tag_link: 'shared'
};

/** Rows one call may list or insert. A household's largest table pages at this. */
export const MAX_ROWS = 1000;
const DEFAULT_LIMIT = 100;

export interface ApiColumn {
	/** The database's name, which is the one the API speaks. */
	name: string;
	/** Drizzle's property name for the same column. */
	key: string;
	column: PgColumn;
	writable: boolean;
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
	 * The column naming the document each row is about, where there is one: a
	 * row about a payslip is out of reach of a token without Salary, in
	 * whichever table it sits.
	 */
	documentColumn: ApiColumn | null;
}

/**
 * The column naming the document a row is about: `document.id` itself, or a
 * one-column foreign key to a column that names one — so a chunk of a
 * document's text, which points at the text, which points at the document, is
 * found as well as the text. Derived, so a table added later that points at a
 * document is covered without being listed.
 */
function documentColumnName(table: PgTable, seen = new Set<PgTable>()): string | null {
	if (table === schema.document) return schema.document.id.name;
	// A table pointing at itself, such as a category's parent, would recurse for ever.
	if (seen.has(table)) return null;
	seen.add(table);
	for (const fk of getTableConfig(table).foreignKeys) {
		const reference = fk.reference();
		if (reference.columns.length !== 1) continue;
		const named = documentColumnName(reference.foreignTable, seen);
		if (named === reference.foreignColumns[0].name) return reference.columns[0].name;
	}
	return null;
}

function describe(table: PgTable): ApiTable | null {
	const config = getTableConfig(table);
	if (HIDDEN_TABLES.has(config.name)) return null;

	const writableTable = !READ_ONLY_TABLES.has(config.name);
	const columns = Object.entries(getTableColumns(table))
		.filter(([, column]) => !HIDDEN_COLUMNS.has(`${config.name}.${column.name}`))
		.map(([key, column]) => ({
			name: column.name,
			key,
			column,
			writable: writableTable && !READ_ONLY_COLUMNS.has(`${config.name}.${column.name}`)
		}));

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

	const documentColumn = documentColumnName(table);

	return {
		name: config.name,
		table,
		columns,
		primaryKey,
		writable: writableTable,
		generatedKey,
		reach: TABLE_REACH[config.name] ?? 'shared',
		documentColumn: columns.find((c) => c.name === documentColumn) ?? null
	};
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

/** The area a table belongs to, for the boundary; undefined for no such table. */
export function tableReach(name: string): Reach | undefined {
	return apiTables().get(name)?.reach;
}

/**
 * What `GET /api/v1/tables` answers with: enough to write a call without
 * reading the source. Only the tables this token reaches — a token limited to
 * trips has no business learning the shape of the salary tables.
 */
export function describeTables(grant: ApiGrant) {
	return [...apiTables().values()]
		.filter((t) => reaches(grant, t.reach))
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
				writable: c.writable
			}))
		}));
}

function requireTable(name: string): ApiTable {
	const table = apiTables().get(name);
	if (!table) throw new ApiError(`There is no table "${name}".`, 404);
	return table;
}

function requireWritable(name: string): ApiTable {
	const table = requireTable(name);
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

/** An ISO 8601 instant as a Date; null for anything else, including 30 February. */
function isoInstant(value: unknown): Date | null {
	const match = typeof value === 'string' ? ISO_INSTANT.exec(value) : null;
	if (!match) return null;
	const [, year, month, day, hour, minute, second = '0', offsetHour = '0', offsetMinute = '0'] =
		match;
	// new Date() rolls 30 February over into March rather than refusing it.
	const calendar = new Date(0);
	calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
	if (calendar.getUTCMonth() !== Number(month) - 1 || calendar.getUTCDate() !== Number(day)) {
		return null;
	}
	if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
	if (Number(offsetHour) > 23 || Number(offsetMinute) > 59) return null;
	const parsed = new Date(value as string);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * One JSON value as the column's driver expects it.
 *
 * Only what JSON cannot carry is converted — a timestamp arrives as a string
 * and a bigint as a number or a string of digits. Everything else goes to
 * Postgres as given, and its refusal becomes the 400: it knows a uuid, a date
 * and a CHECK better than a second copy of those rules here would.
 */
export function fromJson(column: ApiColumn, value: unknown): unknown {
	if (value === null) return null;
	const refuse = (what: string) =>
		new ApiError(`Column "${column.name}" takes ${what}, not ${JSON.stringify(value)}.`, 400);

	switch (column.column.dataType) {
		case 'json':
			return value;
		case 'bigint': {
			// Bounded by what toJson can answer with: a larger value would be
			// written, then refuse to serialise, and every later read of the table
			// would fail on it.
			const parsed = safeBigint(value);
			if (parsed === null) {
				throw refuse(
					`a whole number from -${Number.MAX_SAFE_INTEGER} to ${Number.MAX_SAFE_INTEGER}`
				);
			}
			return parsed;
		}
		case 'date': {
			const parsed = isoInstant(value);
			if (!parsed) throw refuse('an ISO 8601 timestamp with an offset, like 2026-09-27T08:00:00Z');
			return parsed;
		}
		case 'boolean':
			if (typeof value === 'boolean') return value;
			throw refuse('true or false');
		default:
			if (typeof value === 'object') throw refuse('a single value');
			// A numeric column's value is a decimal string to the driver; a JSON
			// number is accepted as the same digits.
			return typeof value === 'number' && column.column.dataType === 'string'
				? String(value)
				: value;
	}
}

/** A query-string value, which is always text, as the column's driver expects it. */
function fromQuery(column: ApiColumn, raw: string): unknown {
	switch (column.column.dataType) {
		case 'json':
			throw new ApiError(`Column "${column.name}" holds JSON and cannot be filtered on.`, 400);
		case 'boolean':
			if (raw === 'true' || raw === 'false') return raw === 'true';
			throw new ApiError(`Column "${column.name}" is filtered with true or false.`, 400);
		default:
			return fromJson(column, raw);
	}
}

/** One row as JSON, under the database's column names. */
export function toJson(table: ApiTable, row: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const column of table.columns) {
		const value = row[column.key];
		out[column.name] =
			value instanceof Date
				? value.toISOString()
				: typeof value === 'bigint'
					? safeInteger(value)
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
		const column = requireColumn(table, name);
		filters.push(eq(column.column, fromQuery(column, values[0])));
	}
	return filters;
}

function wholeParam(params: URLSearchParams, name: string, fallback: number, max: number): number {
	const raw = params.get(name);
	if (raw === null) return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 0 || value > max) {
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
function valuesFrom(table: ApiTable, body: unknown): Record<string, unknown> {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw new ApiError('A row is a JSON object of column names and values.', 400);
	}
	const values: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(body)) {
		const column = requireColumn(table, name);
		if (!column.writable) {
			throw new ApiError(`Column "${name}" is read-only over the API.`, 400);
		}
		values[column.key] = fromJson(column, value);
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
	if (!table.documentColumn || outOfReach.length === 0) return undefined;
	return sql`not exists (
		select 1 from ${schema.document} out_of_reach
		where out_of_reach.id = ${table.documentColumn.column}
		and out_of_reach.type in (${sql.join(
			outOfReach.map((type) => sql`${type}`),
			sql`, `
		)})
	)`;
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
	const column = table.documentColumn;
	if (!column || outOfReach.length === 0) return;
	const ids = [...new Set(rows.map((row) => row[column.key]))].filter(
		(id): id is string => typeof id === 'string'
	);
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

/**
 * Run a statement, answering Postgres' refusals as the caller's mistake.
 *
 * Integrity and data errors are about the row that was sent, so they are a
 * 400 or a 409 carrying Postgres' own words; anything else is the server's
 * fault and stays a 500 with its stack in the log.
 */
async function refusingBadRows<T>(write: () => Promise<T>): Promise<T> {
	try {
		return await write();
	} catch (error) {
		const cause = error instanceof Error ? error.cause : undefined;
		if (!(cause instanceof postgres.PostgresError)) throw error;
		const message = [cause.message, cause.detail].filter(Boolean).join(' — ');
		// 23505 duplicate key and 23503 a missing or still-referenced row: the
		// request was well formed, and conflicts with rows already there.
		if (cause.code === '23505' || cause.code === '23503') throw new ApiError(message, 409);
		// Class 22 is a value the column cannot hold; class 23 is any other
		// constraint — not null, CHECK, exclusion.
		if (cause.code.startsWith('22') || cause.code.startsWith('23')) {
			throw new ApiError(message, 400);
		}
		throw error;
	}
}

export async function listRows(
	grant: ApiGrant,
	name: string,
	params: URLSearchParams,
	handle: Queryable = db
) {
	const table = requireTable(name);
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
	const table = requireWritable(name);
	const bodies = Array.isArray(body) ? body : [body];
	if (bodies.length === 0 || bodies.length > MAX_ROWS) {
		throw new ApiError(`Send from 1 to ${MAX_ROWS} rows.`, 400);
	}
	const values = bodies.map((b) => {
		const row = valuesFrom(table, b);
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
	const table = requireWritable(name);
	const where = and(rowKey(table, params), documentScope(table, grant));
	const values = valuesFrom(table, body);
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
	const table = requireWritable(name);
	const where = and(rowKey(table, params), documentScope(table, grant));
	const rows = await refusingBadRows(() =>
		handle.delete(table.table).where(where).returning(selection(table))
	);
	if (rows.length === 0) throw new ApiError('No such row.', 404);
	return toJson(table, rows[0]);
}
