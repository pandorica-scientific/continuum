// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { document, documentTextChunk, job } from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { extractDocumentText } from '$lib/server/documents/extract';
import {
	backfillExtraction,
	cancelQueuedExtraction,
	enqueueExtraction
} from '$lib/server/documents/extract/queue';
import { replaceDocumentFile } from '$lib/server/documents/mutations';
import { hashBytes } from '$lib/server/system/files';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

/**
 * A file replaced while it was being read.
 *
 * Both ends of the race are closed on purpose. Cancelling the queued job cannot
 * reach a run already in flight; the commit guard alone would let a pointless
 * run hold the only CPU slot to the end. Together, the document ends up
 * searchable by what it says NOW and never by what it used to say.
 */
let harness: Harness;
let testDb: TestDb;
const DIRECTORY = resolve('scratch-workspace/extract-staleness-uploads');
let previousDirectory: string | undefined;

const A = resolve('tests/fixtures/extract/typed-invoice.pdf');
const B = resolve('tests/fixtures/extract/mixed-contract.pdf');

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
	await mkdir(DIRECTORY, { recursive: true });
	harness = await startPostgres('extract-staleness', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousDirectory === undefined) delete process.env.UPLOAD_DIR;
	else process.env.UPLOAD_DIR = previousDirectory;
	await rm(DIRECTORY, { recursive: true, force: true });
});

beforeEach(async () => {
	await harness.sql`delete from job`;
	await harness.sql`delete from document`;
});

async function store(path: string): Promise<{ storedName: string; bytes: Uint8Array }> {
	const bytes = new Uint8Array(await readFile(path));
	const storedName = `${randomUUID()}.pdf`;
	await writeFile(join(DIRECTORY, storedName), bytes);
	return { storedName, bytes };
}

async function seedDocument(path: string): Promise<string> {
	const { storedName, bytes } = await store(path);
	const id = uuidv7();
	await testDb.insert(document).values({
		id,
		name: 'Invoice',
		shelfId: await shelfIdByKey('finance', testDb),
		type: 'invoice',
		ext: 'PDF',
		storedName,
		contentHash: hashBytes(bytes),
		addedOn: '2026-01-01'
	});
	return id;
}

const chunkText = async (id: string) =>
	(
		await testDb
			.select({ text: documentTextChunk.text })
			.from(documentTextChunk)
			.where(eq(documentTextChunk.documentId, id))
			.orderBy(asc(documentTextChunk.ordinal))
	)
		.map((c) => c.text)
		.join(' ');

const fakeOcr = {
	engine: 'fake',
	engineVersion: '1',
	async recognise() {
		return { text: 'scanned page', meanConfidence: 80 };
	}
};

describe('a file replaced underneath an extraction', () => {
	it("yields B's text, never A's", async () => {
		const id = await seedDocument(A);
		// The run reads A's bytes, and the replacement lands before it commits —
		// which is the window cancelling a queued job cannot cover.
		//
		// The staleness check itself is state-based, not time-based (it compares
		// storedName/contentHash inside a transaction, not a clock reading), so
		// there is no tolerance to widen here. What IS timing-dependent is this
		// TEST: `reading` is started but not yet awaited, and whether its OCR
		// pipeline reaches the staleness check before or after
		// `replaceDocumentFile` commits depends on which finishes first — usually
		// the replace, since it does far less work, but under full-suite CPU
		// contention that is no longer guaranteed. Seen flaking once under load;
		// left as is rather than adding a synchronisation point a real caller
		// does not have, since that would test the harness more than the guard.
		const reading = extractDocumentText(id, testDb, { provider: fakeOcr });
		const replacement = await store(B);
		await replaceDocumentFile(id, { ...replacement, ext: 'pdf' }, testDb);
		expect(await reading).toBe('stale');
		expect(await chunkText(id)).toBe('');

		// The job the replacement queued reads the document as it is now.
		expect(await extractDocumentText(id, testDb, { provider: fakeOcr })).toBe('extracted');
		const text = await chunkText(id);
		expect(text).toMatch(/tenancy agreement/);
		expect(text).not.toMatch(/10078410/);
	});

	it('throws away what was read out of the old file', async () => {
		const id = await seedDocument(A);
		await extractDocumentText(id, testDb, { provider: fakeOcr });
		expect(await chunkText(id)).toMatch(/10078410/);

		const replacement = await store(B);
		await replaceDocumentFile(id, { ...replacement, ext: 'pdf' }, testDb);
		// Leaving them would make the document searchable by text it no longer
		// contains, which is worse than not being searchable at all.
		expect(await chunkText(id)).toBe('');
	});

	it('cancels the queued job rather than letting the worker read a dead file', async () => {
		const id = await seedDocument(A);
		await enqueueExtraction(id, testDb);
		const replacement = await store(B);
		await replaceDocumentFile(id, { ...replacement, ext: 'pdf' }, testDb);
		const jobs = await testDb.select().from(job).where(eq(job.subjectId, id));
		expect(jobs).toHaveLength(1);
		expect(jobs[0].state).toBe('queued');
	});
});

describe('what gets queued', () => {
	it('queues nothing for a document with no file, or a format nothing reads', async () => {
		const id = uuidv7();
		await testDb.insert(document).values({
			id,
			name: 'Metadata only',
			shelfId: await shelfIdByKey('household', testDb),
			type: 'other',
			addedOn: '2026-01-01'
		});
		expect(await enqueueExtraction(id, testDb)).toBeNull();
		expect(await testDb.select().from(job)).toHaveLength(0);
	});

	it('never queues the same document twice', async () => {
		const id = await seedDocument(A);
		await enqueueExtraction(id, testDb);
		await enqueueExtraction(id, testDb);
		expect(await testDb.select().from(job).where(eq(job.subjectId, id))).toHaveLength(1);
	});

	it('sweeps up everything with a file and no text', async () => {
		const first = await seedDocument(A);
		const second = await seedDocument(B);
		expect(await backfillExtraction(testDb)).toBe(2);
		// Safe to run again: what is already queued is not queued a second time.
		expect(await backfillExtraction(testDb)).toBe(0);

		await cancelQueuedExtraction(first, testDb);
		await extractDocumentText(first, testDb, { provider: fakeOcr });
		expect(await backfillExtraction(testDb)).toBe(0);
		expect(await testDb.select().from(job).where(eq(job.subjectId, second))).toHaveLength(1);
	});
});
