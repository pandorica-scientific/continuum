// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';

import { saveUploadBytes } from '$lib/server/system/files';

import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument } from './fixtures';

// $env/dynamic/private snapshots process.env when Vite builds the virtual
// module, which is before this suite picks the directory its uploads live in.
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

/**
 * A document's file is served through the DOCUMENT, not through its filename.
 *
 * `/documents/[id]/file` resolves the row before it opens anything, so an id
 * that names nothing gets a 404 rather than a stream. `/files/[name]` stays
 * what it always was — avatars and property media, which have no document row
 * at all — and must keep serving them.
 */
let harness: Harness;
let testDb: TestDb;
const DIRECTORY = resolve('scratch-workspace/document-file-route-uploads');
let previousDirectory: string | undefined;
let previousUrl: string | undefined;

const locals = { person: { id: 'a', name: 'Robert', initials: 'R', role: 'admin', theme: null } };

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	previousUrl = process.env.DATABASE_URL;
	process.env.UPLOAD_DIR = DIRECTORY;
	await mkdir(DIRECTORY, { recursive: true });
	harness = await startPostgres('document-file-route', { max: 1 });
	// The route handlers use the app's own `db`, which is the point: this suite
	// exercises the real handler rather than a copy of its query.
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
	if (previousDirectory === undefined) delete process.env.UPLOAD_DIR;
	else process.env.UPLOAD_DIR = previousDirectory;
	await rm(DIRECTORY, { recursive: true, force: true });
});

beforeEach(async () => {
	await harness.sql`delete from document`;
});

async function seedDocumentWithFile() {
	const storedName = await saveUploadBytes(
		new TextEncoder().encode('%PDF-1.4 a document'),
		'paper.pdf'
	);
	const id = uuidv7();
	await makeDocument(testDb, {
		id,
		name: 'Paper',
		shelfKey: 'inventory',
		type: 'other',
		storedName,
		addedOn: '2026-01-01'
	});
	return { id, storedName };
}

/** The route handlers themselves, called the way SvelteKit calls them. */
async function getDocumentFile(id: string, locals: unknown): Promise<number> {
	const { GET } = await import('../../src/routes/(app)/documents/[id]/file/+server');
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const response = await (GET as any)({ params: { id }, locals });
		return response.status;
	} catch (err) {
		return (err as { status: number }).status;
	}
}

async function getNamedFile(name: string, locals: unknown): Promise<number> {
	const { GET } = await import('../../src/routes/(app)/files/[name]/+server');
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const response = await (GET as any)({ params: { name }, locals });
		return response.status;
	} catch (err) {
		return (err as { status: number }).status;
	}
}

describe('GET /documents/[id]/file', () => {
	it('streams the file behind a document', async () => {
		const { id } = await seedDocumentWithFile();
		expect(await getDocumentFile(id, locals)).toBe(200);
	});

	it('answers 404 for an id that names no document', async () => {
		await seedDocumentWithFile();
		expect(await getDocumentFile(uuidv7(), locals)).toBe(404);
	});

	it('still serves a file that belongs to no document', async () => {
		// Avatars and property media have no document row and must keep working.
		const storedName = await saveUploadBytes(new TextEncoder().encode('avatar'), 'face.png');
		expect(await getNamedFile(storedName, locals)).toBe(200);
	});
});
