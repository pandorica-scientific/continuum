import { readFileSync, readdirSync } from 'node:fs';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';

interface DrizzleSnapshot {
	tables: Record<
		string,
		{
			columns: Record<string, unknown>;
			indexes: Record<string, unknown>;
		}
	>;
}

// Derived, not pinned by name. A hardcoded filename has to be bumped by hand on
// every schema migration, and when someone forgets, this suite fails as "schema
// drift" — the wrong diagnosis, which sends the next person looking in the wrong
// place.
//
// Read from the snapshot FILES, not from the journal. Hand-written migrations
// (0033_drop_seeded_rules, 0034_person_overview_layout) carry a journal entry
// but generate no snapshot, because they change data or nothing drizzle models.
// Taking the newest journal entry would therefore name a file that does not
// exist, and this suite would die on ENOENT the first time someone writes SQL by
// hand — which is exactly when it is most needed.
function currentSnapshotName(): string {
	const snapshots = readdirSync('drizzle/meta')
		.filter((name) => /^\d{4}_snapshot\.json$/.test(name))
		.sort();
	if (snapshots.length === 0) throw new Error('No drizzle snapshot found in drizzle/meta.');
	return snapshots[snapshots.length - 1];
}

const SNAPSHOT_NAME = currentSnapshotName();

function readSnapshot(): DrizzleSnapshot {
	return JSON.parse(readFileSync(`drizzle/meta/${SNAPSHOT_NAME}`, 'utf8')) as DrizzleSnapshot;
}

describe('Drizzle migration metadata', () => {
	it('snapshots the schema introduced by the handwritten migrations', () => {
		expect(readdirSync('drizzle/meta')).toContain(SNAPSHOT_NAME);
		const snapshot = readSnapshot();

		expect(snapshot.tables['public.person'].columns).toHaveProperty('auth_generation');
		expect(snapshot.tables).toHaveProperty('public.setup_claim');
		expect(snapshot.tables).toHaveProperty('public.transaction_fingerprint_alias');
		expect(snapshot.tables).toHaveProperty('public.transfer_pair_leg');
		expect(snapshot.tables).toHaveProperty('public.broker_import_state');
		expect(snapshot.tables['public.property_bill'].indexes).toHaveProperty(
			'property_bill_meter_property_idx'
		);
	});

	// The handwritten migrations are the only thing that builds the database, so
	// nothing forces the stored snapshot to keep describing them. Comparing it
	// against the declared schema is what makes the next generation empty: drift
	// either way would otherwise surface as a surprise migration later.
	it('keeps the stored snapshot in step with the declared schema', () => {
		const snapshot = readSnapshot();
		const declared: PgTable[] = [];
		for (const exported of Object.values(schema)) {
			if (is(exported, PgTable)) declared.push(exported);
		}
		expect(declared.length).toBeGreaterThan(0);

		const declaredColumns = new Map(
			declared.map((table) => {
				const config = getTableConfig(table);
				return [
					`${config.schema ?? 'public'}.${config.name}`,
					config.columns.map((column) => column.name).sort()
				] as const;
			})
		);

		expect([...declaredColumns.keys()].sort()).toEqual(Object.keys(snapshot.tables).sort());
		for (const [name, columns] of declaredColumns) {
			expect({ [name]: Object.keys(snapshot.tables[name].columns).sort() }).toEqual({
				[name]: columns
			});
		}
	});

	it('declares the contact tables and their links', () => {
		const snapshot = readSnapshot();
		expect(snapshot.tables).toHaveProperty('public.contact');
		expect(snapshot.tables['public.contact'].columns).toHaveProperty('organisation');
		expect(snapshot.tables['public.contact'].columns).toHaveProperty('job_title');
		expect(snapshot.tables['public.contact'].columns).toHaveProperty('photo');
		for (const table of [
			'contact_tenancy',
			'contact_property',
			'contact_loan',
			'contact_account'
		]) {
			expect(snapshot.tables).toHaveProperty(`public.${table}`);
		}
	});

	it('lets the fingerprint repair stop at its first matching occurrence', () => {
		const migration = readFileSync('drizzle/0027_repair_transaction_fingerprints.sql', 'utf8');
		const candidateLookup = migration.match(
			/LEFT JOIN LATERAL \([\s\S]*?FROM generate_series\([\s\S]*?LIMIT 1[\s\S]*?\) matched ON true/
		)?.[0];

		expect(candidateLookup).toBeDefined();
		expect(candidateLookup).not.toMatch(/ORDER BY candidate/i);
	});

	// transfer_pair_leg enforces the cross-column claim rule through a trigger.
	// Drizzle models tables, not triggers, so `db:generate` cannot notice the
	// trigger disappearing; only this migration keeps the constraint alive.
	it('keeps the transfer-pair leg trigger in the migration that owns it', () => {
		const migration = readFileSync('drizzle/0027_repair_transaction_fingerprints.sql', 'utf8');

		expect(migration).toMatch(/CREATE FUNCTION maintain_transfer_pair_legs\(\)/);
		expect(migration).toMatch(/CREATE TRIGGER transfer_pair_leg_claims/);
	});
});
