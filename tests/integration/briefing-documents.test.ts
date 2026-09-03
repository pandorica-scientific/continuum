// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { documentLink, job, tenancy } from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { buildBriefing, type BriefingItem } from '$lib/server/briefing';
import type { Actor } from '$lib/server/documents/visibility';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makeLoan, makeProperty } from './fixtures';

/**
 * The two document sources on the Overview, and the line that names what a
 * document is about.
 *
 * The briefing sources read the module-level `db` singleton rather than a
 * handle they are given, so this suite points that singleton at the harness the
 * way `deadlines.test.ts` and `archive-scope.test.ts` do.
 */
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('briefing-documents', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	// `job` has no foreign key to `document` — its `subject_id` serves several
	// kinds of work — so it does not go with the cascade and is named here.
	await harness.sql`truncate document, job, person, property, loan cascade`;
});

const asAdmin: Actor = { id: uuidv7(), role: 'admin' };
const asMember: Actor = { id: uuidv7(), role: 'member' };

/** Far enough out to sit inside the document horizon, near enough to be on the strip. */
const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

async function seedDocument(options: {
	name: string;
	shelfKey: string;
	sensitivity?: 'normal' | 'restricted';
	expiresOn?: string;
}): Promise<string> {
	const id = uuidv7();
	await makeDocument(testDb, {
		id,
		name: options.name,
		shelfId: await shelfIdByKey(options.shelfKey, testDb),
		type: 'other',
		sensitivity: options.sensitivity ?? 'normal',
		storedName: `${id}.pdf`,
		ext: 'PDF',
		addedOn: '2026-01-01',
		expiresOn: options.expiresOn ?? null,
		expiryVerb: 'expires'
	});
	return id;
}

async function seedExtraction(
	documentId: string,
	state: 'queued' | 'running' | 'done' | 'failed',
	queuedAt: Date,
	error?: string
): Promise<void> {
	await testDb.insert(job).values({
		id: uuidv7(),
		kind: 'extract_text',
		subjectId: documentId,
		state,
		queuedAt,
		error: error ?? null
	});
}

const backlogItem = (items: BriefingItem[]) =>
	items.find((item) => item.title.includes('waiting to be filed'));
const unreadableItem = (items: BriefingItem[]) =>
	items.find((item) => item.title.includes('could not be read'));

describe('the inbox backlog', () => {
	it('counts a restricted document for an admin and not for a member', async () => {
		await seedDocument({ name: 'Passport scan', shelfKey: 'inbox' });
		await seedDocument({ name: 'Divorce papers', shelfKey: 'inbox', sensitivity: 'restricted' });

		const member = await buildBriefing(asMember);
		expect(backlogItem(member.items)?.title).toBe('1 document waiting to be filed');

		const admin = await buildBriefing(asAdmin);
		expect(backlogItem(admin.items)?.title).toBe('2 documents waiting to be filed');
	});

	// The backlog is a shelf, not a state: a document filed on finance has been
	// dealt with, and counting it would make the number never reach zero.
	it('does not count a document that has already been filed', async () => {
		await seedDocument({ name: 'Payslip · March', shelfKey: 'income_tax' });

		const { items } = await buildBriefing(asAdmin);
		expect(backlogItem(items)).toBeUndefined();
	});

	it('sends the reader to the review flow', async () => {
		await seedDocument({ name: 'Passport scan', shelfKey: 'inbox' });

		const { items } = await buildBriefing(asAdmin);
		expect(backlogItem(items)?.href).toBe('/documents?shelf=inbox');
	});
});

describe('extraction failures', () => {
	it('raises the one document whose reading failed, and opens it', async () => {
		const id = await seedDocument({ name: 'Mortgage agreement', shelfKey: 'income_tax' });
		await seedExtraction(id, 'failed', new Date('2026-02-01T00:00:00Z'), 'mupdf: cannot open file');

		const { items } = await buildBriefing(asAdmin);
		const item = unreadableItem(items);
		expect(item?.title).toBe('1 document could not be read');
		expect(item?.href).toBe(`/documents?doc=${id}`);
		expect(item?.detail).toBe('mupdf: cannot open file');
	});

	// The failed row stays in the table for ever. Only the newest attempt says
	// whether the document has text today.
	it('says nothing about a failure a later run cleared', async () => {
		const id = await seedDocument({ name: 'Mortgage agreement', shelfKey: 'income_tax' });
		await seedExtraction(id, 'failed', new Date('2026-01-01T00:00:00Z'), 'mupdf: cannot open file');
		await seedExtraction(id, 'done', new Date('2026-03-01T00:00:00Z'));

		const { items } = await buildBriefing(asAdmin);
		expect(unreadableItem(items)).toBeUndefined();
	});

	it('stops naming one document once there are two of them', async () => {
		const first = await seedDocument({ name: 'Mortgage agreement', shelfKey: 'income_tax' });
		const second = await seedDocument({ name: 'Lease · Karlín', shelfKey: 'property' });
		await seedExtraction(first, 'failed', new Date('2026-02-01T00:00:00Z'), 'mupdf: cannot open');
		await seedExtraction(second, 'failed', new Date('2026-02-02T00:00:00Z'));

		const { items } = await buildBriefing(asAdmin);
		const item = unreadableItem(items);
		expect(item?.title).toBe('2 documents could not be read');
		expect(item?.href).toBe('/documents');
	});

	it('keeps a restricted document out of a member’s strip', async () => {
		const id = await seedDocument({
			name: 'Divorce papers',
			shelfKey: 'inventory',
			sensitivity: 'restricted'
		});
		await seedExtraction(id, 'failed', new Date('2026-02-01T00:00:00Z'));

		const { items } = await buildBriefing(asMember);
		expect(unreadableItem(items)).toBeUndefined();
	});
});

describe('a document’s about line', () => {
	// Person and property were the only two kinds the line could name, so a
	// lease filed against the tenancy it is the contract for read "Filed under
	// Tenancy." and stopped — the registry knows all nine.
	it('names a tenancy and a loan', async () => {
		const propertyId = uuidv7();
		await makeProperty(testDb, { id: propertyId, name: 'Flat Karlín', kind: 'rented' });
		const tenancyId = uuidv7();
		await testDb.insert(tenancy).values({
			id: tenancyId,
			propertyId,
			tenantName: 'Martin Dvořák',
			startsOn: '2025-06-01'
		});
		const loanId = uuidv7();
		await makeLoan(testDb, {
			id: loanId,
			name: 'Mortgage ČS',
			// Floating and so never a fixation reminder of its own, which keeps
			// this about D7's neighbours rather than about D7.
			regime: 'floating',
			principalMinor: 9_900_000n,
			owedMinor: 9_270_000n
		});

		const documentId = await seedDocument({
			name: 'Renting contract · Karlín',
			shelfKey: 'property',
			expiresOn: soon
		});
		await testDb.insert(documentLink).values([
			{ documentId, targetId: tenancyId },
			{ documentId, targetId: loanId }
		]);

		const { items } = await buildBriefing(asAdmin);
		const item = items.find((i) => i.kind === 'Document');
		expect(item?.detail).toContain('Filed under Property, about ');
		expect(item?.detail).toContain('Flat Karlín · Martin Dvořák');
		expect(item?.detail).toContain('Mortgage ČS');
		expect(item?.href).toBe(`/documents?doc=${documentId}`);
	});
});
