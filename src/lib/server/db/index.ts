// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;

/** The handle inside `db.transaction(...)`. Exported so helpers can take either. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Whichever of the two a caller happens to hold. */
export type Queryable = Db | Tx;

// Lazy so that importing server modules at build time (when DATABASE_URL is
// not set) does not open a connection or throw.
let instance: Db | null = null;

function connect(): Db {
	if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
	return drizzle(postgres(env.DATABASE_URL), { schema });
}

export const db: Db = new Proxy({} as Db, {
	get(_target, prop) {
		instance ??= connect();
		const value = Reflect.get(instance, prop) as unknown;
		return typeof value === 'function'
			? (value as (...a: unknown[]) => unknown).bind(instance)
			: value;
	}
});
