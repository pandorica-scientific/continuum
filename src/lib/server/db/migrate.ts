// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, type Queryable } from './index';
import { installFacts } from '$lib/server/system/status';

/**
 * The column this release adds that nothing before it had.
 *
 * Named once, because the boot check below and the sentence it throws have to
 * be talking about the same column.
 */
const RELEASE_COLUMN = { table: 'import_file', column: 'document_id' } as const;

/**
 * Does this database actually carry the schema this build was written against?
 *
 * It has to be asked out loud because the migrator cannot answer it. `drizzle/`
 * holds a single baseline that is rewritten in place rather than added to, and
 * a database that already recorded the old baseline as applied is left
 * untouched by `migrate()` — no error, nothing to see in the log. The app then
 * runs against a schema that has no `import_file.document_id`, still has the
 * columns this release dropped, and still refuses `broker_report`; the first
 * sign of it is a 500 on somebody's statement import, long after the restart
 * that caused it.
 *
 * `information_schema` is the cheapest true probe there is: one round trip, no
 * data read, and it asks about the schema itself rather than about a symptom.
 * It does not migrate anything and must not — repairing a live database is the
 * operator's decision, taken with a backup in hand.
 */
export async function assertSchemaIsCurrent(handle: Queryable = db): Promise<void> {
	const found = await handle.execute(sql`
		select 1 from information_schema.columns
		where table_schema = current_schema()
		  and table_name = ${RELEASE_COLUMN.table}
		  and column_name = ${RELEASE_COLUMN.column}`);
	if ([...(found as unknown as unknown[])].length > 0) return;

	// Named from package.json rather than written out here, so the sentence
	// cannot go on naming a release this build stopped being.
	const { version } = await installFacts();
	throw new Error(
		`This database is older than Continuum ${version} and pulling the image does not migrate it — ${RELEASE_COLUMN.table}.${RELEASE_COLUMN.column} is missing, so refusing to serve; run the SQL from the ${version} release notes (the Upgrading block in CHANGELOG.md) against a backed-up copy, or start this release on an empty database.`
	);
}

// Runs pending migrations at server start so `docker compose up` needs no
// separate migration step, then refuses to serve a database those migrations
// left behind — see `assertSchemaIsCurrent`.
export async function runMigrations(): Promise<void> {
	await migrate(db, { migrationsFolder: 'drizzle' });
	await assertSchemaIsCurrent();
}
