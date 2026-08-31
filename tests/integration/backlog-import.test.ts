// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { document, job, shelf, tag, tagLink } from '$lib/server/db/schema';
import { DEFAULT_MAPPING, importDirectory, ruleFor } from '../../scripts/import-documents.mjs';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

/**
 * A backlog of scanned paper, filed by what the folders were called.
 *
 * The two rules that decide whether this is safe to run: a file already in the
 * archive is recognised by its bytes rather than by its name, and a path nobody
 * mapped goes to the INBOX. Guessing produces an archive that looks filed and
 * is not, which is worse than one that admits what it does not know.
 */
let harness: Harness;
let testDb: TestDb;
const ROOT = resolve('scratch-workspace/backlog-import-fixture');
const UPLOADS = resolve('scratch-workspace/backlog-import-uploads');

beforeAll(async () => {
	harness = await startPostgres('backlog-import', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;

	await mkdir(join(ROOT, 'faktury/2024'), { recursive: true });
	await mkdir(join(ROOT, 'auto/pojisteni'), { recursive: true });
	await mkdir(join(ROOT, 'scans/unsorted/2019'), { recursive: true });
	await writeFile(join(ROOT, 'faktury/2024/elektrina.pdf'), 'invoice bytes');
	await writeFile(join(ROOT, 'auto/pojisteni/2019.pdf'), 'policy bytes');
	await writeFile(join(ROOT, 'scans/unsorted/2019/thing.pdf'), 'unknown bytes');
	// Not a document format: left where it is rather than filed as "other".
	await writeFile(join(ROOT, 'scans/notes.docx'), 'ignored');
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	await rm(ROOT, { recursive: true, force: true });
	await rm(UPLOADS, { recursive: true, force: true });
});

beforeEach(async () => {
	await harness.sql`delete from job`;
	await harness.sql`delete from document`;
	await harness.sql`delete from tag`;
});

const run = () =>
	importDirectory({
		directory: ROOT,
		mapping: DEFAULT_MAPPING,
		sql: harness.sql,
		uploadDir: UPLOADS
	});

const documentCount = async () => (await testDb.select({ n: count() }).from(document))[0].n;

async function shelfKeyOf(name: string): Promise<string> {
	const [row] = await testDb
		.select({ key: shelf.key })
		.from(document)
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		.where(eq(document.name, name));
	return row.key;
}

describe('the backlog import', () => {
	it('files a file already in the archive exactly once', async () => {
		const first = await run();
		expect(first.filed).toBe(3);
		expect(await documentCount()).toBe(3);

		// The bytes are what recognise it: a second pass over a growing folder
		// imports what is new and nothing else.
		const second = await run();
		expect(second.filed).toBe(0);
		expect(second.skipped).toBe(3);
		expect(await documentCount()).toBe(3);
	});

	it('sends an unmapped path to the inbox rather than guessing', async () => {
		await run();
		expect(await shelfKeyOf('thing')).toBe('inbox');
	});

	it('files a mapped path where the folder says, with the type it implies', async () => {
		await run();
		expect(await shelfKeyOf('elektrina')).toBe('finance');
		const [row] = await testDb.select().from(document).where(eq(document.name, 'elektrina'));
		expect(row.type).toBe('invoice');
		expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('lets the deepest folder win, because it is the more specific answer', async () => {
		// `auto/pojisteni/2019.pdf` is an insurance policy about a car, not
		// "something in the car folder".
		expect(ruleFor(join('auto', 'pojisteni', '2019.pdf'), DEFAULT_MAPPING)?.type).toBe(
			'insurance_policy'
		);
		await run();
		expect(await shelfKeyOf('2019')).toBe('property');
		const tags = await testDb
			.select({ name: tag.name })
			.from(tagLink)
			.innerJoin(tag, eq(tag.id, tagLink.tagId));
		expect(tags.map((t) => t.name)).toContain('insurance');
	});

	it('queues each import for extraction rather than reading it inline', async () => {
		// A backlog of six hundred scans is exactly what the single CPU slot
		// protects the web server from.
		await run();
		const jobs = await testDb.select().from(job).where(eq(job.kind, 'extract_text'));
		expect(jobs).toHaveLength(3);
		expect(jobs.every((j) => j.state === 'queued')).toBe(true);
	});

	it('leaves formats it cannot file alone', async () => {
		await run();
		const names = (await testDb.select({ name: document.name }).from(document)).map((d) => d.name);
		expect(names).not.toContain('notes');
	});
});
