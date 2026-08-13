import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './index';

// Runs pending migrations at server start so `docker compose up` needs no
// separate migration step.
export async function runMigrations(): Promise<void> {
	await migrate(db, { migrationsFolder: 'drizzle' });
}
