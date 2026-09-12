// SPDX-License-Identifier: AGPL-3.0-or-later
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;

/** The handle inside `db.transaction(...)`. Exported so helpers can take either. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Whichever of the two a caller happens to hold. */
export type Queryable = Db | Tx;

/**
 * Run an operation in a transaction, unless one is already open.
 *
 * Every write that spans more than one statement wants this, and a caller
 * cannot know whether the handle it was given is the connection or an open
 * transaction — nesting `db.transaction` inside one would be a savepoint, which
 * is not what "make these two writes atomic" means. Asking the handle whether it
 * can start one is the whole trick.
 *
 * There were two copies of this, in `import/ingest.ts` and `tags/index.ts`,
 * neither of which is where transaction plumbing belongs.
 */
export async function inTransaction<T>(
	handle: Queryable,
	operation: (tx: Queryable) => Promise<T>
): Promise<T> {
	const candidate = handle as Db;
	if (typeof candidate.transaction === 'function') {
		return candidate.transaction((tx) => operation(tx));
	}
	return operation(handle);
}

/**
 * Where the handle comes from.
 *
 * The default is one connection for the process, built from DATABASE_URL on
 * first use. It is a seam because two different things want to replace it: a
 * deployment holding one database per household resolves a different handle
 * per request, and one running Postgres compiled to WebAssembly has no
 * DATABASE_URL at all. Neither can be expressed by editing connect().
 *
 * A resolver is called on every property access of `db`, so it MUST cache
 * whatever it returns. The default does.
 */
export type DbResolver = () => Db;

// Lazy so that importing server modules at build time (when DATABASE_URL is
// not set) does not open a connection or throw.
let instance: Db | null = null;

const defaultResolver: DbResolver = () => {
	if (!instance) {
		if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
		instance = drizzle(postgres(env.DATABASE_URL), { schema });
	}
	return instance;
};

let resolver: DbResolver = defaultResolver;

export function setDbResolver(next: DbResolver): void {
	resolver = next;
}

/** Put the process-wide default back. Exported for tests that install a fake. */
export function resetDbResolver(): void {
	resolver = defaultResolver;
}

export const db: Db = new Proxy({} as Db, {
	get(_target, prop) {
		const handle = resolver();
		const value = Reflect.get(handle, prop) as unknown;
		return typeof value === 'function'
			? (value as (...a: unknown[]) => unknown).bind(handle)
			: value;
	}
});
