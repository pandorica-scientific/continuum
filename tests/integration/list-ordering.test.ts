import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { removeStalePostgresDirectory } from './embedded-postgres';
import { person, property } from '$lib/server/db/schema';
import { listProperties } from '$lib/server/property/queries';

// Rows created in one statement share a created_at to the microsecond, and
// `ORDER BY created_at` alone is then not a total order: PostgreSQL may return
// tied rows in any order, and an UPDATE moves a row in the heap, which changes
// it. Every screen that picks by position — the selected property, "person one"
// and "person two" in the retirement projection — silently changed subject
// after any edit. Saving a floor plan swapped the flat under the user.

const DATABASE_DIR = resolve('scratch-workspace/list-ordering-postgres');
// 55439-55445 are taken by the other integration suites, which run in
// parallel; a shared port makes whichever starts second fail.
const PORT = 55446;
const DATABASE = 'ordering';
const URL = `postgres://postgres:password@localhost:${PORT}/${DATABASE}`;

let embedded: EmbeddedPostgres;
let sql: postgres.Sql;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeAll(async () => {
	removeStalePostgresDirectory(DATABASE_DIR);
	embedded = new EmbeddedPostgres({
		databaseDir: DATABASE_DIR,
		port: PORT,
		user: 'postgres',
		password: 'password',
		persistent: false,
		onLog: () => undefined,
		onError: () => undefined
	});
	await embedded.initialise();
	await embedded.start();
	await embedded.createDatabase(DATABASE);

	sql = postgres(URL, { max: 4, onnotice: () => undefined });
	db = drizzle(sql, { schema });

	for (const name of readdirSync('drizzle')
		.filter((n) => /^\d{4}_.+\.sql$/.test(n))
		.sort()) {
		const statements = readFileSync(resolve('drizzle', name), 'utf8').split(
			'--> statement-breakpoint'
		);
		for (const statement of statements) {
			if (statement.trim()) await sql.unsafe(statement);
		}
	}
}, 120_000);

afterAll(async () => {
	await sql?.end();
	await embedded?.stop();
});

describe('lists ordered by creation time', () => {
	it('keeps properties in the same order after one of them is edited', async () => {
		// One statement, so both rows carry the same created_at — exactly what the
		// setup wizard and the demo seed produce.
		await db.insert(property).values([
			{ id: 'p-first', name: 'First', sizeLabel: '2+kk', kind: 'lived', currency: 'CZK' },
			{ id: 'p-second', name: 'Second', sizeLabel: '3+kk', kind: 'rented', currency: 'CZK' }
		]);

		// The loader's own query, so this cannot pass while production drifts.
		const read = async () => (await listProperties(db)).map((p) => p.id);

		const before = await read();
		expect(new Set(before)).toEqual(new Set(['p-first', 'p-second']));

		// Saving a floor plan is exactly this: an update to the images column.
		await sql`update property set images = '{"photos":[]}'::jsonb where id = ${before[0]}`;

		expect(await read()).toEqual(before);
	});

	it('keeps person one and person two the same people after an edit', async () => {
		await db.insert(person).values([
			{ id: 'q-one', name: 'One', initials: 'O', birthYear: 1988 },
			{ id: 'q-two', name: 'Two', initials: 'T', birthYear: 1990 }
		]);

		const read = async () =>
			(await db.select().from(person).orderBy(asc(person.createdAt), asc(person.id))).map(
				(p) => p.birthYear
			);

		const before = await read();
		await sql`update person set name = 'One edited' where id = 'q-one'`;

		// The retirement projection reads people[0] and people[1] for the two
		// birth years; swapping them silently changes the whole forecast.
		expect(await read()).toEqual(before);
	});
});
