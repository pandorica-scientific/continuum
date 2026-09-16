// One embedded Postgres, started the same way for every integration suite, so
// every suite runs against the same schema rather than its own drifted copy.

import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { refreshCurrencies } from '$lib/server/db/currency-refresh';
import * as schema from '$lib/server/db/schema';
import { removeStalePostgresDirectory } from './embedded-postgres';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/** Which migration files a suite wants, by filename. */
export type MigrationFilter = (name: string) => boolean;

/** Today's schema. What a suite testing BEHAVIOUR should use. */
export const ALL_MIGRATIONS: MigrationFilter = () => true;

/** Every migration file, in the order the migrator would apply them. */
export function migrationFiles(): string[] {
	return readdirSync('drizzle')
		.filter((name) => /^\d{4}_.+\.sql$/.test(name))
		.sort();
}

/**
 * One migration split the way drizzle's migrator splits it.
 *
 * Statement by statement rather than as one string, so a suite exercising a
 * migration sees the same failure the real migrator would — a file that only
 * works when its statements arrive together is broken in production and passing
 * here.
 */
export function statements(sqlText: string): string[] {
	return sqlText
		.split('--> statement-breakpoint')
		.filter((part) =>
			part.split('\n').some((line) => line.trim() && !line.trim().startsWith('--'))
		);
}

/** A port nobody is listening on, asked for rather than assigned by hand. */
async function freePort(): Promise<number> {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (typeof address === 'string' || address === null) {
				server.close(() => reject(new Error('Could not determine a free port.')));
				return;
			}
			server.close(() => resolvePort(address.port));
		});
	});
}

export interface Harness {
	db: TestDb;
	sql: postgres.Sql;
	url: string;
	/** The database name, for a suite that inspects pg_stat_activity by datname. */
	database: string;
	/**
	 * A SECOND connection to the same database.
	 *
	 * For the suites that test locking and serialisation: one connection holds a
	 * row while another tries to take it, which cannot be observed down a single
	 * pooled client. The caller ends it.
	 */
	connect(options?: postgres.Options<Record<string, never>>): postgres.Sql;
	/**
	 * A SEPARATE, empty database on the same server, and a client for it.
	 *
	 * For suites that build a second world — a schema as it was several
	 * migrations ago — beside the current one. `drop` removes it again.
	 */
	createDatabase(name: string): Promise<{ sql: postgres.Sql; db: TestDb; drop(): Promise<void> }>;
	/** Run raw SQL, statement by statement the way the migrator would. */
	apply(sqlText: string): Promise<void>;
	/** Run one file from drizzle/, by filename. */
	applyMigrationFile(name: string): Promise<void>;
	/** Run the migrations a filter keeps, in order. */
	applyMigrations(keep?: MigrationFilter): Promise<void>;
	stop(): Promise<void>;
}

/**
 * Start a private Postgres for one suite.
 *
 * `name` names the scratch directory and the database, so a leftover data
 * directory says which suite left it.
 */
export async function startPostgres(
	name: string,
	options: { max?: number } = {}
): Promise<Harness> {
	const databaseDir = resolve(`scratch-workspace/${name}-postgres`);
	const database = `continuum_${name.replace(/-/g, '_')}`;
	const port = await freePort();

	removeStalePostgresDirectory(databaseDir);
	const embedded = new EmbeddedPostgres({
		databaseDir,
		port,
		user: 'postgres',
		password: 'password',
		persistent: false,
		onLog: () => undefined,
		onError: () => undefined
	});
	await embedded.initialise();
	await embedded.start();
	await embedded.createDatabase(database);

	const url = `postgres://postgres:password@127.0.0.1:${port}/${database}`;
	const sql = postgres(url, { max: options.max ?? 5, onnotice: () => undefined });
	const db = drizzle(sql, { schema });

	const apply = async (sqlText: string) => {
		for (const statement of statements(sqlText)) await sql.unsafe(statement);
	};

	return {
		db,
		sql,
		url,
		database,
		connect: (options?: postgres.Options<Record<string, never>>) =>
			postgres(url, { onnotice: () => undefined, ...options }),
		async createDatabase(other: string) {
			await embedded.createDatabase(other);
			const otherSql = postgres(`postgres://postgres:password@127.0.0.1:${port}/${other}`, {
				max: 1,
				onnotice: () => undefined
			});
			return {
				sql: otherSql,
				db: drizzle(otherSql, { schema }),
				async drop() {
					await otherSql.end();
					await embedded.dropDatabase(other);
				}
			};
		},
		apply,
		applyMigrationFile: (file: string) => apply(readFileSync(resolve('drizzle', file), 'utf8')),
		async applyMigrations(keep: MigrationFilter = ALL_MIGRATIONS) {
			for (const file of migrationFiles().filter(keep)) {
				await apply(readFileSync(resolve('drizzle', file), 'utf8'));
			}
			// What `boot()` does immediately after `runMigrations()`: the baseline
			// only seeds the currency codes it needs, so a suite writing a different
			// rate would otherwise fail on an empty table rather than on its own test.
			await refreshCurrencies(db);
		},
		async stop() {
			await sql?.end();
			await embedded?.stop();
		}
	};
}
