// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './index';

// Runs pending migrations at server start so `docker compose up` needs no
// separate migration step.
export async function runMigrations(): Promise<void> {
	await migrate(db, { migrationsFolder: 'drizzle' });
}
