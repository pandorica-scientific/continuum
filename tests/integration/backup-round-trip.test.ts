// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A dump nobody has ever read back is a dump nobody knows restores.
//
// The unit suite covers ordering, the schedule policy and the directory guard —
// everything except the one thing a backup is for. Until v0.4.3 every dump
// named the generated `entity_kind` column in its COPY headers while COPY TO
// STDOUT omitted it from the rows, so every header was one column too wide and
// no backup ever taken could be loaded.
//
// So this suite calls the real dumpDatabase() and feeds what it produces back
// into a real database. Replicating its column logic here would have passed
// against the broken code.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { rowId } from '../row-id';
import * as schema from '$lib/server/db/schema';

import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makePerson } from './fixtures';

// $env/dynamic/private snapshots process.env when Vite builds the virtual
// module, which happens before this suite picks its port. A live getter is the
// only way to hand dumpDatabase the harness it is meant to dump.
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let dumpDatabase: () => Promise<string>;

const PERSON = rowId('backup-person-a');
const SUBJECT = rowId('backup-subject-a');
const DOCUMENT = rowId('backup-document-a');

beforeAll(async () => {
	harness = await startPostgres('backup-round-trip', { max: 1 });
	testDb = harness.db;
	// Read through the proxy above, so this reaches dumpDatabase.
	process.env.DATABASE_URL = harness.url;
	({ dumpDatabase } = await import('$lib/server/backup/dump'));

	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

/**
 * Apply a dump the way psql does.
 *
 * The driver cannot run `COPY … FROM stdin` with its data inline the way a psql
 * script carries it, so the blocks are split out and streamed — which is what
 * psql itself does under the covers. Everything else runs as a plain statement.
 */
async function restore(dump: string): Promise<void> {
	const lines = dump.split('\n');
	let plain: string[] = [];

	const flush = async () => {
		const statement = plain.join('\n').trim();
		plain = [];
		if (statement) await harness.sql.unsafe(statement);
	};

	for (let i = 0; i < lines.length; i++) {
		const header = lines[i].match(/^copy "([^"]+)" \((.*)\) from stdin;$/);
		if (!header) {
			plain.push(lines[i]);
			continue;
		}
		await flush();

		const rows: string[] = [];
		while (++i < lines.length && lines[i] !== '\\.') rows.push(lines[i]);

		const writable = await harness.sql`
			copy ${harness.sql(header[1])} (${harness.sql.unsafe(header[2])}) from stdin`.writable();
		if (rows.length > 0) writable.write(Buffer.from(rows.join('\n') + '\n'));
		await new Promise<void>((resolve, reject) => {
			writable.on('finish', () => resolve());
			writable.on('error', reject);
			writable.end();
		});
	}
	await flush();
}

describe('dumpDatabase', () => {
	it('never names a generated column in a COPY header', async () => {
		await makePerson(testDb, { id: PERSON, name: 'Person A', initials: 'PA' });

		const dump = await dumpDatabase();

		// Eleven tables carry a GENERATED ALWAYS entity_kind. COPY TO STDOUT
		// omits it from the data, so naming it makes the header one column wider
		// than every row it introduces — which is what made every dump
		// unrestorable before v0.4.3.
		const headers = dump.split('\n').filter((line) => line.startsWith('copy "'));
		expect(headers.length).toBeGreaterThan(0);
		for (const header of headers) {
			expect(header, header).not.toContain('"entity_kind"');
		}
	});

	it('gives every COPY header exactly as many columns as its rows have fields', async () => {
		const dump = await dumpDatabase();
		const lines = dump.split('\n');

		let checked = 0;
		for (let i = 0; i < lines.length; i++) {
			const header = lines[i].match(/^copy "([^"]+)" \((.*)\) from stdin;$/);
			if (!header) continue;
			const columns = header[2].split(', ').length;
			const firstRow = lines[i + 1];
			if (firstRow === undefined || firstRow === '\\.') continue; // empty table
			expect(firstRow.split('\t'), `${header[1]} row width`).toHaveLength(columns);
			checked++;
		}
		expect(checked).toBeGreaterThan(0);
	});

	it('reloads every row it wrote out', async () => {
		await testDb.insert(schema.subject).values({ id: SUBJECT, name: 'Car', emoji: '🚗' });
		await makeDocument(testDb, {
			id: DOCUMENT,
			name: 'Passport · Person A',
			shelfKey: 'identity',
			type: 'id_document',
			ext: 'PDF',
			addedOn: '2026-08-23'
		});

		const dump = await dumpDatabase();

		// The dump truncates before it loads, so this is the real restore path,
		// not an append onto rows that were already there.
		await restore(dump);

		const people = await testDb.select().from(schema.person);
		const subjects = await testDb.select().from(schema.subject);
		const documents = await testDb.select().from(schema.document);

		expect(people.map((p) => p.name)).toEqual(['Person A']);
		// The baseline seeds a Household subject, so this is the seeded row plus
		// the one this test added — both of which the dump has to bring back.
		expect(subjects.map((s) => s.name).sort()).toEqual(['Car', 'Household']);
		expect(documents.map((d) => d.name)).toEqual(['Passport · Person A']);
	});

	it('brings the entity rows back, so a restored record can still be linked', async () => {
		// The restore runs under session_replication_role = replica, which
		// suppresses the register triggers. Registration therefore has to come
		// from the dumped entity table itself — if it did not, every restored
		// record would be silently unlinkable.
		const dump = await dumpDatabase();
		await restore(dump);

		const orphans = await harness.sql<{ n: number }[]>`
			select count(*)::int as n
			from person p left join entity e on e.id = p.id
			where e.id is null`;
		expect(orphans[0].n).toBe(0);
	});
});
