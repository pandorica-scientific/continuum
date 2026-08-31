// SPDX-License-Identifier: AGPL-3.0-or-later
import { is, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, type Queryable } from './index';
import * as schema from './schema';
import { installFacts } from '$lib/server/system/status';

/**
 * Every column this build expects, read from the schema itself.
 *
 * This was one hand-picked column for a while — the last object the release
 * added — and a developer had to remember to re-point it every release. Nothing
 * verified the pointer, and the test that looked like it did was tautological:
 * it built a database from the baseline and then asked whether the baseline's
 * own column was there. Forget the bump and an out-of-date instance boots clean
 * and fails later on real data, which is precisely what the check exists to
 * prevent.
 *
 * Derived, there is nothing to forget. Adding a column to the Drizzle schema
 * adds it to what boot demands, in the same edit.
 *
 * WHAT THIS DOES NOT COVER: the appendix — triggers, CHECKs, the net-worth view
 * — is invisible to Drizzle and so invisible here. That is an acceptable floor
 * rather than a complete audit: those objects are created by the same migration
 * as the tables, so a database carrying every column of this release almost
 * certainly ran the whole file. The failure this guards is the one that has
 * actually happened, which is a release's new TABLES never arriving.
 */
function expectedColumns(): { table: string; column: string }[] {
	const columns: { table: string; column: string }[] = [];
	for (const exported of Object.values(schema)) {
		if (!is(exported, PgTable)) continue;
		const config = getTableConfig(exported);
		for (const column of config.columns) {
			columns.push({ table: config.name, column: column.name });
		}
	}
	return columns;
}

/**
 * Does this database actually carry the schema this build was written against?
 *
 * It has to be asked out loud because the migrator cannot answer it. `drizzle/`
 * holds a single baseline that is rewritten in place rather than added to, and
 * a database that already recorded the old baseline as applied is left
 * untouched by `migrate()` — no error, nothing to see in the log. The app then
 * runs against a schema missing whatever the release added, so opening the
 * screen that reads it fails; the first sign of it is a 500 on somebody's
 * passport, long after the restart that caused it.
 *
 * `information_schema` is the cheapest true probe there is: one round trip, no
 * data read, and it asks about the schema itself rather than about a symptom.
 * It does not migrate anything and must not — repairing a live database is the
 * operator's decision, taken with a backup in hand.
 */
export async function assertSchemaIsCurrent(handle: Queryable = db): Promise<void> {
	const found = await handle.execute(sql`
		select table_name, column_name from information_schema.columns
		where table_schema = current_schema()`);
	const present = new Set(
		[...(found as unknown as { table_name: string; column_name: string }[])].map(
			(row) => `${row.table_name}.${row.column_name}`
		)
	);

	const missing = expectedColumns()
		.filter(({ table, column }) => !present.has(`${table}.${column}`))
		.map(({ table, column }) => `${table}.${column}`);
	if (missing.length === 0) return;

	// Named from package.json rather than written out here, so the sentence
	// cannot go on naming a release this build stopped being. Three examples and
	// a count, because a list of two hundred is not a message anyone reads.
	const { version } = await installFacts();
	const examples = missing.slice(0, 3).join(', ');
	const rest = missing.length > 3 ? ` and ${missing.length - 3} more` : '';
	throw new Error(
		`This database is older than Continuum ${version} and pulling the image does not migrate it — ${examples}${rest} missing, so refusing to serve; run the SQL from the ${version} release notes (the Upgrading block in CHANGELOG.md) against a backed-up copy, or start this release on an empty database.`
	);
}

// Runs pending migrations at server start so `docker compose up` needs no
// separate migration step, then refuses to serve a database those migrations
// left behind — see `assertSchemaIsCurrent`.
export async function runMigrations(): Promise<void> {
	await migrate(db, { migrationsFolder: 'drizzle' });
	await assertSchemaIsCurrent();
}
