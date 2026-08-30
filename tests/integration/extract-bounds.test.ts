// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { documentText, documentTextChunk } from '$lib/server/db/schema';

import { continueExtraction, extractDocumentText } from '$lib/server/documents/extract';
import { DEFAULT_LIMITS } from '$lib/server/documents/extract/limits';
import type { OcrProvider } from '$lib/server/documents/extract/ocr';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

/**
 * A 600-page manual occupies the single worker in slices, not for an afternoon.
 *
 * The contract is that hitting a limit is RECORDED rather than silent:
 * `complete=false` with `pagesExtracted` is what lets the inspector say which
 * pages are searchable and offer to continue, instead of indexing a sixth of
 * the file and looking finished.
 */
let harness: Harness;
let testDb: TestDb;
const DIRECTORY = resolve('scratch-workspace/extract-bounds-uploads');
let previousDirectory: string | undefined;

const fakeOcr: OcrProvider = {
	engine: 'fake',
	engineVersion: '1',
	async recognise() {
		return { text: 'page', meanConfidence: 70 };
	}
};

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
	await mkdir(DIRECTORY, { recursive: true });
	harness = await startPostgres('extract-bounds', { max: 1 });
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
	await harness.sql`delete from document`;
});

async function seedLongScan(): Promise<string> {
	const storedName = `${randomUUID()}.pdf`;
	await writeFile(
		join(DIRECTORY, storedName),
		await readFile(resolve('tests/fixtures/extract/long-scan.pdf'))
	);
	const id = uuidv7();
	await makeDocument(testDb, {
		id,
		name: 'A very long scan',
		shelfKey: 'household',
		type: 'manual',
		ext: 'PDF',
		storedName,
		addedOn: '2026-01-01'
	});
	return id;
}

const textRowFor = async (id: string) =>
	(await testDb.select().from(documentText).where(eq(documentText.documentId, id)))[0];

async function chunkCount(id: string): Promise<number> {
	const [row] = await testDb
		.select({ n: count() })
		.from(documentTextChunk)
		.where(eq(documentTextChunk.documentId, id));
	return row.n;
}

describe('bounded extraction', () => {
	it('stops a long scan at the page limit and says so', async () => {
		const id = await seedLongScan();
		await extractDocumentText(id, testDb, { provider: fakeOcr });
		const row = await textRowFor(id);
		expect(row.complete).toBe(false);
		expect(row.pagesExtracted).toBe(DEFAULT_LIMITS.maxOcrPagesPerRun);
		expect(await chunkCount(id)).toBe(DEFAULT_LIMITS.maxOcrPagesPerRun);
	}, 120_000);

	it('continues from where it stopped rather than starting again', async () => {
		const id = await seedLongScan();
		await extractDocumentText(id, testDb, { provider: fakeOcr });
		await continueExtraction(id, testDb, { provider: fakeOcr });
		const row = await textRowFor(id);
		expect(row.pagesExtracted).toBe(2 * DEFAULT_LIMITS.maxOcrPagesPerRun);
		// Not a hundred fresh chunks with the same ordinals — the slice appends.
		expect(await chunkCount(id)).toBe(2 * DEFAULT_LIMITS.maxOcrPagesPerRun);
		expect(row.complete).toBe(false);
	}, 240_000);

	it('reports complete once the last slice lands', async () => {
		const id = await seedLongScan();
		const limits = { ...DEFAULT_LIMITS, maxOcrPagesPerRun: 200 };
		await extractDocumentText(id, testDb, { provider: fakeOcr, limits });
		await continueExtraction(id, testDb, { provider: fakeOcr, limits });
		const row = await textRowFor(id);
		expect(row.complete).toBe(true);
		expect(row.pagesExtracted).toBe(250);
		expect(await chunkCount(id)).toBe(250);
	}, 240_000);

	it('records a file too large to attempt rather than skipping it silently', async () => {
		const id = await seedLongScan();
		await extractDocumentText(id, testDb, {
			provider: fakeOcr,
			limits: { ...DEFAULT_LIMITS, maxFileBytes: 10 }
		});
		const row = await textRowFor(id);
		expect(row.complete).toBe(false);
		expect(row.pagesExtracted).toBe(0);
		expect(await chunkCount(id)).toBe(0);
	});
});
