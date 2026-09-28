// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '$lib/server/db/schema';
import { apiTables, areasWithData, describeTables, fromJson, toJson } from '$lib/server/api/tables';
import { ApiError } from '$lib/server/api/errors';

const EVERYTHING = { access: 'read', areas: null } as const;

function table(name: string) {
	const found = apiTables().get(name);
	if (!found) throw new Error(`${name} is not reachable`);
	return found;
}

function column(tableName: string, name: string) {
	const found = table(tableName).columns.find((c) => c.name === name);
	if (!found) throw new Error(`${tableName}.${name} is not reachable`);
	return found;
}

describe('which tables /api/v1/tables reaches', () => {
	it('reaches every schema table except the ones that decide who can sign in', () => {
		const all = Object.values(schema)
			.filter((t) => is(t, PgTable))
			.map((t) => getTableConfig(t as PgTable).name);
		const hidden = all.filter((name) => !apiTables().has(name)).sort();

		expect(hidden).toEqual(['api_token', 'enrollment_token', 'session', 'settings', 'setup_claim']);
	});

	// Every reachable table, named, and the area it belongs to. The reach is
	// derived from the schema, so without this a table added later would be
	// readable by every unlimited token and writable by every read-write one with
	// nobody having decided that — and would sit in `shared`, out of every
	// limited token's reach, without anybody having chosen that either. A new
	// table fails here until it is placed in tables.ts.
	it('places every reachable table in the area somebody chose for it', () => {
		const byArea: Record<string, string[]> = {};
		for (const t of apiTables().values()) (byArea[t.reach] ??= []).push(t.name);
		for (const names of Object.values(byArea)) names.sort();
		expect(byArea).toEqual({
			ledger: [
				'account',
				'bank',
				'category',
				'category_group',
				'rule',
				'rule_tag',
				'transaction',
				'transaction_fingerprint_alias',
				'transaction_split',
				'transfer_pair',
				'transfer_pair_leg'
			],
			import: ['import_file', 'import_profile'],
			investments: [
				'broker_import_state',
				'broker_operation',
				'broker_position',
				'equity_grant',
				'equity_tranche',
				'holding',
				'portfolio_snapshot',
				'security_price'
			],
			loans: ['loan', 'loan_event', 'loan_fixation_period', 'loan_property'],
			property: ['property', 'property_bill', 'property_opening', 'property_valuation', 'tenancy'],
			salary: ['engagement', 'salary_attribution', 'salary_entry'],
			tax: ['tax_filing_override', 'tax_residence', 'tax_statement', 'tax_statement_line'],
			calendar: [
				'calendar_account',
				'calendar_conflict',
				'calendar_event',
				'calendar_event_exception',
				'calendar_sync_link'
			],
			contacts: ['contact', 'contact_link'],
			documents: [
				'document',
				'document_identity',
				'document_identity_number',
				'document_link',
				'document_text',
				'document_text_chunk',
				'document_type',
				'lane',
				'shelf',
				'shelf_type',
				'subject'
			],
			trips: [
				'place',
				'sight_visit',
				'trip',
				'trip_booking',
				'trip_destination',
				'trip_idea',
				'trip_idea_heart',
				'trip_member',
				'trip_place',
				'visit',
				'visit_member'
			],
			cookbook: [
				'recipe',
				'recipe_category',
				'recipe_ingredient',
				'recipe_step',
				'recipe_tag',
				'recipe_tag_link'
			],
			collections: ['bottle', 'collection', 'tasting', 'tasting_note'],
			shared: [
				'currency',
				'currency_rate',
				'entity',
				'job',
				'net_worth_snapshot',
				'organisation',
				'person',
				'tag',
				'tag_link'
			]
		});
	});

	// Settings offers only these, so no token is limited to an area that answers
	// 403 to every call.
	it('offers a token only the areas something belongs to', () => {
		const areas = areasWithData();
		expect(areas).toContain('trips');
		expect(areas).toContain('ledger');
		// Placed by the part of the person table it reads, not by a table of its own.
		expect(areas).toContain('household');
		expect(areas).not.toContain('retirement');
		expect(areas).not.toContain('home');
	});

	it('writes to every reachable table but a connected calendar and the job queue', () => {
		const readOnly = [...apiTables().values()].filter((t) => !t.writable).map((t) => t.name);
		expect(readOnly.sort()).toEqual(['calendar_account', 'job']);
	});

	it('never exposes a password hash or a calendar credential, to read or to write', () => {
		expect(table('person').columns.map((c) => c.name)).not.toContain('password_hash');
		expect(table('calendar_account').columns.map((c) => c.name)).not.toContain('credential');
	});

	// The net under the lists in tables.ts: a column added later whose name says
	// it holds a secret fails here until somebody decides about it.
	it('hides every column whose name says it is a secret', () => {
		const secretish = /password|credential|secret|token|api_key/i;
		// Looked at and decided: the name of a colour in the design system.
		const notSecrets = new Set(['category_group.color_token']);
		const exposed = [...apiTables().values()].flatMap((t) =>
			t.columns
				.filter((c) => secretish.test(c.name))
				.map((c) => `${t.name}.${c.name}`)
				.filter((name) => !notSecrets.has(name))
		);
		expect(exposed).toEqual([]);
	});

	// A file uploaded over the API is named by the server, so the only name a
	// caller could write into one of these is another row's file — which the app
	// would delete with this row — or a path. The pattern is the net for a file
	// column added later.
	it('reads every column naming an uploaded file but never writes one', () => {
		const fileish = /stored_name|photo|image/i;
		const named = [...apiTables().values()].flatMap((t) =>
			t.columns.filter((c) => fileish.test(c.name)).map((c) => ({ name: `${t.name}.${c.name}`, c }))
		);
		expect(named.map((n) => n.name).sort()).toEqual([
			'bottle.label_photo',
			'bottle.photo',
			'contact.photo',
			'document.stored_name',
			'import_file.stored_name',
			'property.images',
			'recipe.photo',
			'trip_idea.photo'
		]);
		expect(named.filter((n) => n.c.writable).map((n) => n.name)).toEqual([]);
	});

	it('lets a person be read but not promoted or reactivated', () => {
		expect(table('person').writable).toBe(true);
		expect(column('person', 'name').writable).toBe(true);
		for (const name of ['role', 'auth_generation', 'deactivated_at']) {
			expect(column('person', name).writable).toBe(false);
		}
	});

	// What code finds a shelf or reads a document type by, and the flags the
	// screens decide deletes on.
	it('fixes a shelf key once written and never writes the system or built-in flags', () => {
		expect(column('shelf', 'key')).toMatchObject({ writable: true, updatable: false });
		expect(column('shelf', 'label')).toMatchObject({ writable: true, updatable: true });
		expect(column('shelf', 'system').writable).toBe(false);
		expect(column('document_type', 'builtin').writable).toBe(false);
	});

	it('stamps removed_at on a trip or an idea with the server clock', () => {
		expect(column('trip', 'removed_at').serverClock).toBe(true);
		expect(column('trip_idea', 'removed_at').serverClock).toBe(true);
		expect(column('trip', 'starts_on').serverClock).toBe(false);
	});

	it('keeps a connected calendar read-only', () => {
		expect(table('calendar_account').writable).toBe(false);
		expect(table('calendar_account').columns.every((c) => !c.writable)).toBe(true);
	});

	// Derived from foreign keys, so a table added later that points at a document
	// — directly, through its text or identity, or through the entity registry a
	// document belongs to — is filtered for payslips too.
	it('knows every column that can name a document, through a chain of keys', () => {
		const about = [...apiTables().values()]
			.flatMap((t) => t.documentColumns.map((c) => `${t.name}.${c.name}`))
			.sort();
		expect(about).toEqual([
			'contact_link.target_id',
			'document.id',
			'document_identity.document_id',
			'document_identity_number.document_id',
			'document_link.document_id',
			'document_link.target_id',
			'document_text.document_id',
			'document_text_chunk.document_id',
			'engagement.document_id',
			'entity.id',
			'equity_grant.document_id',
			'import_file.document_id',
			'lane.entity_id',
			'property_bill.document_id',
			'salary_entry.document_id',
			'tag_link.target_id',
			'trip_booking.document_id'
		]);
	});

	// A queued import carries its file's bytes; /api/v1/files is the way in for those.
	it('keeps the job queue read-only', () => {
		expect(table('job').writable).toBe(false);
		expect(table('job').columns.every((c) => !c.writable)).toBe(true);
	});

	it('mints a uuid key only where the key is not also a reference', () => {
		expect(table('trip').generatedKey?.name).toBe('id');
		expect(table('transaction').generatedKey?.name).toBe('id');
		// A document's text is keyed by the document it belongs to.
		expect(table('document_text').generatedKey).toBeNull();
		// Composite and text keys are always the caller's to give.
		expect(table('tag_link').generatedKey).toBeNull();
		expect(table('currency').generatedKey).toBeNull();
	});

	it('describes each table by its database names and its primary key', () => {
		const tagLink = describeTables(EVERYTHING).find((t) => t.name === 'tag_link');
		expect(tagLink?.primaryKey).toEqual(['tag_id', 'target_id']);
		const trip = describeTables(EVERYTHING).find((t) => t.name === 'trip');
		expect(trip?.columns.find((c) => c.name === 'id')).toMatchObject({
			type: 'uuid',
			nullable: false,
			hasDefault: true
		});
		expect(trip?.columns.find((c) => c.name === 'starts_on')?.type).toBe('date');
		expect(trip?.area).toBe('trips');
	});

	// A token limited to trips has no business learning the salary tables' shape.
	it('lists only the tables a limited token reaches', () => {
		const names = describeTables({ access: 'read-write', areas: ['trips'] }).map((t) => t.name);
		expect(names).toContain('trip_idea');
		expect(names).not.toContain('salary_entry');
		expect(names).not.toContain('person');
		expect(describeTables({ access: 'read', areas: [] })).toEqual([]);
	});

	// The boundary reads a table with a view by the view's area alone, which is
	// right only while the whole table is one no limited token reaches.
	it('gives a view only to a shared table', () => {
		const viewed = [...apiTables().values()].filter((t) => t.view);
		expect(viewed.map((t) => t.name)).toEqual(['person']);
		for (const t of viewed) expect(t.reach, t.name).toBe('shared');
	});

	// Who somebody is, not what Settings decides about them nor how they like
	// their screens.
	it("shows Household a person's name, birth year and citizenship, and none of it writable", () => {
		const [person] = describeTables({ access: 'read-write', areas: ['household'] });
		expect(person).toMatchObject({
			name: 'person',
			area: 'household',
			writable: false,
			primaryKey: ['id']
		});
		expect(person.columns.map((c) => c.name)).toEqual(['id', 'name', 'birth_year', 'citizenship']);
		expect(person.columns.every((c) => !c.writable && !c.updatable)).toBe(true);
		// Everything still reads the whole table, and writes the name.
		const whole = describeTables(EVERYTHING).find((t) => t.name === 'person');
		expect(whole?.area).toBe('shared');
		expect(whole?.columns.map((c) => c.name)).toContain('role');
		expect(whole?.columns.find((c) => c.name === 'name')?.writable).toBe(true);
	});
});

describe('values across the wire', () => {
	it('reads a bigint as a whole number or a string of digits, and nothing else', () => {
		const amount = column('transaction', 'amount_minor');
		expect(fromJson(amount, -12345)).toBe(-12345n);
		expect(fromJson(amount, '9007199254740991')).toBe(9007199254740991n);
		expect(fromJson(amount, '-9007199254740991')).toBe(-9007199254740991n);
		// Past the range toJson can give back: stored, it would break every read.
		expect(() => fromJson(amount, '9007199254740993')).toThrow(ApiError);
		expect(() => fromJson(amount, '-9007199254740992')).toThrow(ApiError);
		expect(() => fromJson(amount, 12.5)).toThrow(ApiError);
		expect(() => fromJson(amount, '12.50')).toThrow(ApiError);
	});

	it('reads a timestamp from an ISO string and refuses one that is not a date', () => {
		const created = column('tag', 'created_at');
		expect(fromJson(created, '2026-09-27T08:00:00.000Z')).toEqual(
			new Date('2026-09-27T08:00:00.000Z')
		);
		expect(fromJson(created, '2026-09-27T10:00+02:00')).toEqual(
			new Date('2026-09-27T08:00:00.000Z')
		);
		expect(() => fromJson(created, 'yesterday')).toThrow(/ISO 8601/);
	});

	// new Date() takes all of these, some in the server's own time zone, so the
	// same call would store different instants on different machines.
	it('refuses a timestamp without an offset or outside ISO 8601', () => {
		const created = column('tag', 'created_at');
		for (const loose of [
			'2026-09-27 08:00',
			'2026-09-27T08:00:00',
			'2026-09-27',
			'Sep 27 2026',
			'2026-02-30T08:00:00Z',
			'2026-09-27T24:00:00Z',
			'2026-09-27T08:00:00+25:00',
			1790000000000
		]) {
			expect(() => fromJson(created, loose)).toThrow(/ISO 8601/);
		}
	});

	// Postgres takes every one of these, and the app cannot read any back: 'NaN'
	// fails every sum over the column, a date in the server's own DateStyle is
	// read month-first, and '-infinity' is no day at all.
	it('refuses what Postgres would take and the app could not read', () => {
		const units = column('equity_tranche', 'units');
		for (const bad of ['NaN', 'Infinity', '-Infinity', 'nan', '', '1,5', true]) {
			expect(() => fromJson(units, bad), String(bad)).toThrow(/a number/);
		}
		expect(fromJson(units, 1.5)).toBe('1.5');
		expect(fromJson(units, '10.250000')).toBe('10.250000');

		const startsOn = column('trip', 'starts_on');
		for (const bad of [
			'03/04/2026',
			'-infinity',
			'infinity',
			'2026-02-30',
			'2026-9-27',
			20260927
		]) {
			expect(() => fromJson(startsOn, bad), String(bad)).toThrow(/ISO 8601 day/);
		}
		expect(fromJson(startsOn, '2026-09-27')).toBe('2026-09-27');
	});

	// Stored, a year below 100 comes back from the driver as 19xx.
	it('refuses a timestamp before the year the driver can read back', () => {
		const created = column('tag', 'created_at');
		expect(() => fromJson(created, '0050-01-01T00:00:00Z')).toThrow(/from the year 100/);
		expect(fromJson(created, '0100-01-01T00:00:00Z')).toEqual(new Date('0100-01-01T00:00:00Z'));
	});

	it('refuses a value of the wrong kind rather than letting Postgres coerce it', () => {
		expect(() => fromJson(column('trip', 'name'), true)).toThrow(/text/);
		expect(() => fromJson(column('trip', 'name'), 12)).toThrow(/text/);
		expect(() => fromJson(column('trip_place', 'ordinal'), true)).toThrow(/whole number/);
		expect(() => fromJson(column('trip_place', 'ordinal'), 1.5)).toThrow(/whole number/);
		expect(fromJson(column('trip_place', 'ordinal'), 3)).toBe(3);
		expect(() => fromJson(column('trip', 'id'), true)).toThrow(/a uuid/);
		expect(() => fromJson(column('trip', 'id'), 'not-a-uuid')).toThrow(/a uuid/);
	});

	// asRowId turns junk into this id so that it matches nothing; a row holding
	// it would be matched by every malformed id a form sends.
	it('refuses the all-zeros uuid', () => {
		expect(() => fromJson(column('trip', 'id'), '00000000-0000-0000-0000-000000000000')).toThrow(
			/all-zeros/
		);
	});

	// Every kind of column a reachable table has is one fromJson was taught; a
	// kind added later fails here rather than being passed through unchecked.
	it('knows every kind of column a reachable table has', () => {
		const known = new Set([
			'PgBigInt64',
			'PgBoolean',
			'PgChar',
			'PgDateString',
			'PgDoublePrecision',
			'PgInteger',
			'PgJsonb',
			'PgNumeric',
			'PgReal',
			'PgText',
			'PgTimestamp',
			'PgUUID'
		]);
		const unknown = [...apiTables().values()].flatMap((t) =>
			t.columns
				.filter((c) => !known.has(c.column.columnType))
				.map((c) => `${t.name}.${c.name}: ${c.column.columnType}`)
		);
		expect(unknown).toEqual([]);
	});

	it('passes JSON through to a jsonb column and refuses an object anywhere else', () => {
		expect(fromJson(column('trip', 'art'), { hue: 1 })).toEqual({ hue: 1 });
		expect(() => fromJson(column('trip', 'name'), { hue: 1 })).toThrow(ApiError);
	});

	it('carries null through untouched', () => {
		expect(fromJson(column('trip', 'art'), null)).toBeNull();
	});

	it('writes bigints as numbers and timestamps as ISO strings', () => {
		const row = toJson(table('tag'), {
			id: 'a',
			name: 'Holiday',
			normalisedName: 'holiday',
			createdAt: new Date('2026-09-27T08:00:00.000Z')
		});
		expect(row).toEqual({
			id: 'a',
			name: 'Holiday',
			normalised_name: 'holiday',
			created_at: '2026-09-27T08:00:00.000Z'
		});
		expect(toJson(table('transaction'), { amountMinor: -250n }).amount_minor).toBe(-250);
	});
});
