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

// Derived, not hardcoded, so a forgotten bump doesn't get misdiagnosed as schema drift.
// Reads the snapshot FILES, not the journal: a hand-written migration has a journal
// entry but no snapshot, so the newest journal entry can name a file that doesn't exist.
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
		// One link table per connector since 0050, not one per pair. A contact
		// reaches a tenancy, a property, a loan or an account through the same
		// table, and which kind it is comes from `entity`.
		for (const table of ['contact_link', 'document_link', 'tag_link', 'entity']) {
			expect(snapshot.tables).toHaveProperty(`public.${table}`);
		}
	});

	it('declares calendar_event with its timezone column and the exception table', () => {
		const snapshot = readSnapshot();
		const event = snapshot.tables['public.calendar_event'];
		expect(event).toBeDefined();
		// tz is not redundant beside a timestamptz: RRULE expansion is
		// timezone-dependent, and a series expanded in UTC drifts an hour across
		// DST for half the year. Losing this column is a silent correctness bug.
		expect(event.columns).toHaveProperty('tz');
		expect(event.columns).toHaveProperty('rrule');
		expect(event.columns).toHaveProperty('deleted_at');
		expect(snapshot.tables).toHaveProperty('public.calendar_event_exception');
		expect(snapshot.tables['public.calendar_event_exception'].columns).toHaveProperty(
			'recurrence_id'
		);
	});

	it('declares the calendar sync tables', () => {
		const snapshot = readSnapshot();
		// pushed_hash is the merge base. Without it there is no way to tell which
		// side of a difference changed — only that the two differ.
		expect(snapshot.tables['public.calendar_sync_link'].columns).toHaveProperty('pushed_hash');
		expect(snapshot.tables['public.calendar_sync_link'].columns).toHaveProperty('suppressed_at');
		expect(snapshot.tables['public.calendar_account'].columns).toHaveProperty('cursor');
		expect(snapshot.tables['public.calendar_account'].columns).toHaveProperty('credential');
		expect(snapshot.tables).toHaveProperty('public.calendar_conflict');
	});

	// transfer_pair_leg enforces the cross-column claim rule through a trigger.
	// Drizzle models tables, not triggers, so `db:generate` cannot notice the
	// trigger disappearing; only the baseline keeps the constraint alive.
	it('keeps the transfer-pair leg trigger in the baseline that owns it', () => {
		const baseline = readFileSync('drizzle/0000_baseline.sql', 'utf8');

		expect(baseline).toMatch(/CREATE FUNCTION maintain_transfer_pair_legs\(\)/);
		expect(baseline).toMatch(/CREATE TRIGGER transfer_pair_leg_claims/);
	});
});
