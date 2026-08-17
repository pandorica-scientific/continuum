import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres, type Harness } from './harness';

/**
 * The tenant_contact migration, run against a real PostgreSQL.
 *
 * Asserted here rather than in a unit test because every risk in this migration
 * is a database behaviour: whether the CTE evaluates gen_random_uuid() once or
 * twice, whether the link rows point at the contacts that were actually
 * inserted, and whether a tenancy with no contact text is left alone. None of
 * that is observable without running the SQL.
 */

// An EMBEDDED server on a private port, exactly as every sibling integration
// test does it. This file used to reach for postgres://…@localhost:5432, which
// is not something CI has: the `checks` job runs `npm test` — and that includes
// tests/integration/** — with no `services:` block, so every pull request went
// red here while the only Postgres in the workflow belonged to the separate e2e
// job.

let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('tenant-contact-migration', { max: 1 });

	// The narrowest schema this migration touches. Building the whole schema here
	// would couple the test to 37 unrelated migrations.
	await harness.sql.unsafe(`
		create table property (id text primary key, name text not null);
		create table tenancy (
			id text primary key,
			property_id text not null references property(id) on delete cascade,
			tenant_name text not null,
			tenant_contact text not null default ''
		);
		create table contact (
			id text primary key,
			name text not null,
			photo text, organisation text, job_title text,
			phone text, email text, address text, notes text, category text,
			created_at timestamptz not null default now(),
			updated_at timestamptz not null default now()
		);
		create table contact_tenancy (
			contact_id text not null references contact(id) on delete cascade,
			tenancy_id text not null references tenancy(id) on delete cascade,
			primary key (contact_id, tenancy_id)
		);
	`);

	const propertyId = randomUUID();
	await harness.sql`insert into property (id, name) values (${propertyId}, 'Flat 2')`;

	await harness.sql`
		insert into tenancy (id, property_id, tenant_name, tenant_contact) values
			(${randomUUID()}, ${propertyId}, 'Řehoř Novák', '+420 777 000 111'),
			(${randomUUID()}, ${propertyId}, 'Jan Kowalski', 'jan@example.test, +48 600 100 200'),
			(${randomUUID()}, ${propertyId}, 'Empty Contact', ''),
			(${randomUUID()}, ${propertyId}, 'Blank Contact', '   ')
	`;

	await harness.applyMigrationFile('0037_tenant_contacts.sql');
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

describe('tenant_contact migration', () => {
	it('creates one contact per tenancy that had contact text', async () => {
		const rows = await harness.sql`select name, notes from contact order by name`;
		expect(rows.map((r) => r.name)).toEqual(['Jan Kowalski', 'Řehoř Novák']);
	});

	it('preserves the original text verbatim, without parsing it', async () => {
		const [row] =
			await harness.sql`select notes, phone, email from contact where name = 'Jan Kowalski'`;
		expect(row.notes).toBe('jan@example.test, +48 600 100 200');
		// Deliberately NOT split into columns — see the migration's comment.
		expect(row.phone).toBeNull();
		expect(row.email).toBeNull();
	});

	it('leaves tenancies with empty or whitespace-only contact text alone', async () => {
		const [{ n }] = await harness.sql`select count(*)::int as n from contact`;
		expect(n).toBe(2);
	});

	// The pairing is the whole point of the migration: a contact carrying a
	// tenant's only phone number, attached to nothing, is worse than the free-text
	// column it replaced. (This does not prove AS MATERIALIZED is doing the work —
	// PostgreSQL materializes this CTE regardless, and the migration says so.)
	it('links every contact to the tenancy it came from', async () => {
		const rows = await harness.sql`
			select c.name as contact_name, t.tenant_name
			from contact_tenancy ct
			join contact c on c.id = ct.contact_id
			join tenancy t on t.id = ct.tenancy_id
			order by c.name
		`;
		expect(rows).toHaveLength(2);
		for (const row of rows) expect(row.contact_name).toBe(row.tenant_name);
	});

	it('leaves no link row pointing at a contact that does not exist', async () => {
		const orphans = await harness.sql`
			select ct.contact_id from contact_tenancy ct
			left join contact c on c.id = ct.contact_id
			where c.id is null
		`;
		expect(orphans).toHaveLength(0);
	});

	it('drops the column', async () => {
		const columns = await harness.sql`
			select column_name from information_schema.columns
			where table_name = 'tenancy'
		`;
		expect(columns.map((c) => c.column_name)).not.toContain('tenant_contact');
	});
});
