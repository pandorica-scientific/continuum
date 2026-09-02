// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { document, documentText, documentTextChunk } from '$lib/server/db/schema';

import { extractDocumentText } from '$lib/server/documents/extract';
import type { OcrProvider } from '$lib/server/documents/extract/ocr';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

/**
 * Routing is per PAGE, not per file.
 *
 * A born-digital contract with a scanned signature page is the ordinary case in
 * a household, and a whole-file decision gets it wrong in both directions: OCR
 * everything and the typed pages come back worse than they went in; trust the
 * text layer and the signed page is blank.
 *
 * The OCR engine is faked here on purpose. What is under test is the routing,
 * the chunking and the provenance — tesseract's own accuracy is proved once, in
 * `tests/unit/ocr-provider`.
 */
let harness: Harness;
let testDb: TestDb;
const DIRECTORY = resolve('scratch-workspace/extract-routing-uploads');
let previousDirectory: string | undefined;

const fixture = (name: string) => resolve('tests/fixtures/extract', name);

/** Says what it read, so a chunk's provenance can be told apart from a page's. */
const fakeOcr: OcrProvider = {
	engine: 'fake',
	engineVersion: '1',
	async recognise() {
		return { text: 'RECOGNISED SIGNATURE PAGE', meanConfidence: 88 };
	}
};

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
	await mkdir(DIRECTORY, { recursive: true });
	harness = await startPostgres('extract-routing', { max: 1 });
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

async function seedDocument(options: {
	file?: string;
	bytes?: Uint8Array;
	ext: string;
}): Promise<string> {
	const storedName = `${randomUUID()}.${options.ext.toLowerCase()}`;
	const bytes = options.file
		? new Uint8Array(await readFile(options.file))
		: (options.bytes ?? new Uint8Array());
	await writeFile(join(DIRECTORY, storedName), bytes);
	const id = uuidv7();
	await makeDocument(testDb, {
		id,
		name: storedName,
		shelfKey: 'inventory',
		type: 'other',
		ext: options.ext.toUpperCase(),
		storedName,
		addedOn: '2026-01-01'
	});
	return id;
}

const chunksFor = (id: string) =>
	testDb
		.select()
		.from(documentTextChunk)
		.where(eq(documentTextChunk.documentId, id))
		.orderBy(asc(documentTextChunk.ordinal));

const textRowFor = async (id: string) =>
	(await testDb.select().from(documentText).where(eq(documentText.documentId, id)))[0];

describe('extraction routing', () => {
	it('splits a mixed PDF by page, not by file', async () => {
		const id = await seedDocument({ file: fixture('mixed-contract.pdf'), ext: 'pdf' });
		expect(await extractDocumentText(id, testDb, { provider: fakeOcr })).toBe('extracted');

		const chunks = await chunksFor(id);
		expect(chunks.map((c) => c.source)).toEqual(['text_layer', 'text_layer', 'ocr']);
		expect(chunks.map((c) => c.pageNo)).toEqual([1, 2, 3]);
		expect(chunks[0].text).toMatch(/tenancy agreement/);
		expect(chunks[2].text).toBe('RECOGNISED SIGNATURE PAGE');
	});

	it('records which engine read it, and how sure it was', async () => {
		const id = await seedDocument({ file: fixture('mixed-contract.pdf'), ext: 'pdf' });
		await extractDocumentText(id, testDb, { provider: fakeOcr });
		const row = await textRowFor(id);
		expect(row.engine).toBe('fake');
		expect(row.engineVersion).toBe('1');
		expect(row.meanConfidence).toBeCloseTo(88, 5);
		expect(row.complete).toBe(true);
		expect(row.languages).toBe('ces+eng');
	});

	it('needs no OCR for a document that is typed throughout', async () => {
		const id = await seedDocument({ file: fixture('typed-invoice.pdf'), ext: 'pdf' });
		await extractDocumentText(id, testDb, {
			provider: {
				engine: 'fake',
				engineVersion: '1',
				async recognise() {
					throw new Error('OCR must not be reached for a typed page');
				}
			}
		});
		const chunks = await chunksFor(id);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].source).toBe('text_layer');
		// The identifier the trigram index exists for, straight from the layer.
		expect(chunks[0].text).toMatch(/10078410/);
	});

	it('reads a plain text file into plain chunks with no page numbers', async () => {
		const id = await seedDocument({
			bytes: new TextEncoder().encode('Meter reading 48211 taken on the first of March.'),
			ext: 'txt'
		});
		await extractDocumentText(id, testDb, { provider: fakeOcr });
		const chunks = await chunksFor(id);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].source).toBe('plain');
		expect(chunks[0].pageNo).toBeNull();
		expect(chunks[0].text).toMatch(/48211/);
	});

	it('writes no document_text row for a file it cannot read', async () => {
		// This is what makes "N documents don't have searchable contents" honest:
		// the absence of a row IS the count.
		const id = await seedDocument({ bytes: new Uint8Array([1, 2, 3]), ext: 'xlsx' });
		expect(await extractDocumentText(id, testDb, { provider: fakeOcr })).toBe('unreadable');
		expect(await textRowFor(id)).toBeUndefined();
	});

	it('says so rather than throwing when the upload has been lost', async () => {
		const id = await seedDocument({ bytes: new Uint8Array([1]), ext: 'pdf' });
		const [row] = await testDb
			.select({ storedName: document.storedName })
			.from(document)
			.where(eq(document.id, id));
		await rm(join(DIRECTORY, row.storedName!), { force: true });
		expect(await extractDocumentText(id, testDb, { provider: fakeOcr })).toBe('missing');
		expect(await textRowFor(id)).toBeUndefined();
	});
});
