// SPDX-License-Identifier: AGPL-3.0-or-later
// /api/v1/files against a real schema: what a caller's mistake answers, who
// may list a record's paper, and what happens to a plan once it is filed.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { attachFile, listAttached, removeFile } from '$lib/server/api/files';
import { ApiError, bodyTooLarge } from '$lib/server/api/errors';
import { addIdea, removeIdea } from '$lib/server/life/trips';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocumentLink, makePerson } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let db: TestDb;
let previousUrl: string | undefined;
let previousDirectory: string | undefined;
const DIRECTORY = resolve('scratch-workspace/api-files-uploads');

const PLANNER = { access: 'read-write', areas: ['trips'] } as const;
const ARCHIVIST = { access: 'read-write', areas: ['documents'] } as const;
const PDF = new TextEncoder().encode('%PDF-1.7\n% a plan\n%%EOF\n');

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
	await mkdir(DIRECTORY, { recursive: true });
	harness = await startPostgres('api-files');
	previousUrl = process.env.DATABASE_URL;
	process.env.DATABASE_URL = harness.url;
	db = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	await rm(DIRECTORY, { recursive: true, force: true });
	if (previousDirectory === undefined) delete process.env.UPLOAD_DIR;
	else process.env.UPLOAD_DIR = previousDirectory;
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await db.execute(`truncate table trip_idea, document, person, job cascade`);
});

async function refusal(work: Promise<unknown>): Promise<ApiError> {
	const error = await work.then(
		() => null,
		(e: unknown) => e
	);
	if (!(error instanceof ApiError)) throw new Error(`expected a refusal, got ${error}`);
	return error;
}

const idea = () => addIdea({ name: 'Lofoten', emoji: '', note: '', country: 'NO', hearts: [] }, db);

describe('attaching a plan', () => {
	// Postgres refuses a NUL in text; that is the caller's to fix, not a 500.
	it('answers a name Postgres cannot store with 400, and keeps nothing', async () => {
		const ideaId = await idea();
		const refused = await refusal(
			attachFile(PLANNER, { attachTo: ideaId, name: 'Plan\u0000', file: new Blob([PDF]) }, db)
		);
		expect(refused.status).toBe(400);
		expect(await db.select().from(schema.document)).toEqual([]);
	});

	it('queues the plan to be read for search, as any other filed document', async () => {
		const ideaId = await idea();
		const file = await attachFile(
			PLANNER,
			{ attachTo: ideaId, name: 'Plan', file: new Blob([PDF]) },
			db
		);
		const jobs = await db
			.select({ kind: schema.job.kind })
			.from(schema.job)
			.where(and(eq(schema.job.subjectId, file.id), eq(schema.job.kind, 'extract_text')));
		expect(jobs).toHaveLength(1);
	});

	// Taken off the board, an idea is swept a minute later with its paper.
	it('refuses an idea waiting to be swept', async () => {
		const ideaId = await idea();
		await removeIdea(ideaId, db);
		const refused = await refusal(
			attachFile(PLANNER, { attachTo: ideaId, name: 'Plan', file: new Blob([PDF]) }, db)
		);
		expect(refused.status).toBe(404);
	});
});

describe('listing and removing', () => {
	// A Documents token can already open each piece and read every link.
	it('lists any record’s paper to a token given Documents', async () => {
		const ideaId = await idea();
		const file = await attachFile(
			PLANNER,
			{ attachTo: ideaId, name: 'Plan', file: new Blob([PDF]) },
			db
		);
		expect((await listAttached(ARCHIVIST, ideaId, db)).map((f) => f.id)).toEqual([file.id]);
	});

	// Filed against somebody as well, the plan is no longer the planner's alone.
	it('refuses to remove a document linked to a record outside the token’s areas', async () => {
		const ideaId = await idea();
		const file = await attachFile(
			PLANNER,
			{ attachTo: ideaId, name: 'Plan', file: new Blob([PDF]) },
			db
		);
		const someone = await makePerson(db);
		await makeDocumentLink(db, { documentId: file.id, targetId: someone.id });
		expect((await refusal(removeFile(PLANNER, file.id, db))).status).toBe(404);
		expect(
			await db.select().from(schema.document).where(eq(schema.document.id, file.id))
		).toHaveLength(1);

		await removeFile(ARCHIVIST, file.id, db);
		expect(await db.select().from(schema.document).where(eq(schema.document.id, file.id))).toEqual(
			[]
		);
	});
});

describe('a body over the server’s limit', () => {
	// SvelteKit's adapter fails the read with its own 413, which a parser then
	// reports as a failed parse.
	it('is told apart from a body that is merely malformed', () => {
		const adapter = Object.assign(new Error('Payload Too Large'), { status: 413 });
		expect(bodyTooLarge(adapter)).toBe(true);
		expect(bodyTooLarge(new TypeError('failed', { cause: adapter }))).toBe(true);
		expect(bodyTooLarge(new SyntaxError('Unexpected token'))).toBe(false);
	});
});
