// SPDX-License-Identifier: AGPL-3.0-or-later
// Regression: a generated column was named in the COPY header but omitted from
// COPY TO STDOUT rows, making dumps unrestorable. This suite round-trips the
// real dumpDatabase() into a real database instead of replicating its column
// logic, which could pass against broken output.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { rowId } from '../row-id';
import * as schema from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';

import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makePerson } from './fixtures';

// $env/dynamic/private snapshots process.env at build time, before this suite
// picks its port — a live getter is the only way to point dumpDatabase at it.
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
 * Apply a dump the way psql does: COPY blocks are split out and streamed,
 * since the driver cannot run `COPY … FROM stdin` with inline data. Every
 * other line runs as a plain statement.
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

		// COPY TO STDOUT omits a GENERATED ALWAYS column from the data, so naming
		// entity_kind in the header would make it one column too wide.
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
		await testDb.insert(schema.subject).values({
			id: SUBJECT,
			name: 'Car',
			emoji: '🚗',
			shelfId: await shelfIdByKey('vehicles', testDb)
		});
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
		expect(subjects.map((s) => s.name).sort()).toEqual(['Car']);
		expect(documents.map((d) => d.name)).toEqual(['Passport · Person A']);
	});

	it('brings the entity rows back, so a restored record can still be linked', async () => {
		// Restore runs under session_replication_role = replica, suppressing
		// register triggers, so registration must come from the dumped entity
		// table itself, or every restored record would be silently unlinkable.
		const dump = await dumpDatabase();
		await restore(dump);

		const orphans = await harness.sql<{ n: number }[]>`
			select count(*)::int as n
			from person p left join entity e on e.id = p.id
			where e.id is null`;
		expect(orphans[0].n).toBe(0);
	});
});
