// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import {
	document,
	documentLink,
	documentText,
	documentTextChunk,
	job,
	subject,
	tag,
	tagLink
} from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { searchDocuments } from '$lib/server/documents/search';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

/**
 * Finding a document by whatever a person happens to remember about it.
 *
 * The two cases that decide whether this is worth having: an identifier inside
 * a scanned page — a variable symbol is not a word to any text-search
 * configuration — and a Czech word typed without its diacritics. Both sides of
 * every comparison fold through `contact_fold`, which is also how the indexes
 * are built, because a query that folds differently is a sequential scan that
 * nothing reports.
 */
let harness: Harness;
let testDb: TestDb;

const asAdmin = { id: 'a', role: 'admin' } as const;
const asMember = { id: 'm', role: 'member' } as const;

beforeAll(async () => {
	harness = await startPostgres('document-search', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from job`;
	await harness.sql`delete from document`;
	await harness.sql`delete from subject where name <> 'Household'`;
	await harness.sql`delete from tag`;
});

async function seedDocument(options: {
	name?: string;
	note?: string;
	sensitivity?: 'normal' | 'restricted';
	shelf?: string;
	type?: 'other' | 'invoice' | 'contract';
	tag?: string;
	subjectId?: string;
	storedName?: string | null;
	addedOn?: string;
}): Promise<string> {
	const id = uuidv7();
	await testDb.insert(document).values({
		id,
		name: options.name ?? `Document ${id}`,
		shelfId: await shelfIdByKey(options.shelf ?? 'household', testDb),
		type: options.type ?? 'other',
		note: options.note ?? null,
		sensitivity: options.sensitivity ?? 'normal',
		storedName: options.storedName === undefined ? `${id}.pdf` : options.storedName,
		addedOn: options.addedOn ?? '2026-01-01'
	});
	if (options.tag) {
		const tagId = uuidv7();
		await testDb
			.insert(tag)
			.values({ id: tagId, name: options.tag, normalisedName: options.tag.toLowerCase() });
		await testDb.insert(tagLink).values({ tagId, targetId: id });
	}
	if (options.subjectId) {
		await testDb.insert(documentLink).values({ documentId: id, targetId: options.subjectId });
	}
	return id;
}

async function seedText(
	documentId: string,
	text: string,
	pageNo: number | null = 1
): Promise<void> {
	await testDb
		.insert(documentText)
		.values({
			documentId,
			engine: 'fake',
			engineVersion: '1',
			languages: 'ces+eng',
			complete: true,
			pagesExtracted: 1
		})
		.onConflictDoNothing();
	await testDb
		.insert(documentTextChunk)
		.values({ documentId, ordinal: pageNo ?? 0, pageNo, source: 'ocr', text });
}

async function seedSubject(name: string, archived: boolean): Promise<string> {
	const id = uuidv7();
	await testDb.insert(subject).values({ id, name, archivedAt: archived ? new Date() : null });
	return id;
}

describe('the candidate union', () => {
	it('ranks a name match above a contents match', async () => {
		const named = await seedDocument({ name: 'Ochrana údajů' });
		const inside = await seedDocument({ name: 'Manual' });
		await seedText(inside, 'ochrana údajů na straně 4');

		const { hits } = await searchDocuments('ochrana', asAdmin, {}, testDb);
		expect(hits.map((h) => h.documentId)).toEqual([named, inside]);
		expect(hits[0].tier).toBe('A');
		expect(hits[1].tier).toBe('D');
	});

	it('returns each document once, however many tiers it hits', async () => {
		// Grouping provides structure; grouping is not sorting, and a document
		// matching on name AND contents is still one document.
		const id = await seedDocument({ name: 'Smlouva', note: 'smlouva o dílo' });
		await seedText(id, 'smlouva o dílo, strana 1');
		const { hits } = await searchDocuments('smlouva', asAdmin, {}, testDb);
		expect(hits.filter((h) => h.documentId === id)).toHaveLength(1);
		expect(hits[0].tier).toBe('A');
	});

	it('finds a document by its tag, its note and what it is about', async () => {
		const tagged = await seedDocument({ name: 'A', tag: 'renovation' });
		const noted = await seedDocument({ name: 'B', note: 'the renovation quote' });
		const car = await seedSubject('Renovation van', false);
		const linked = await seedDocument({ name: 'C', subjectId: car });

		expect(
			(await searchDocuments('renovation', asAdmin, {}, testDb)).hits.map((h) => h.tier)
		).toEqual(['A', 'B', 'C']);
		const ids = (await searchDocuments('renovation', asAdmin, {}, testDb)).hits.map(
			(h) => h.documentId
		);
		expect(new Set(ids)).toEqual(new Set([tagged, noted, linked]));
	});

	it('excludes restricted documents in SQL, not afterwards', async () => {
		const id = await seedDocument({ name: 'Sealed', sensitivity: 'restricted' });
		await seedText(id, 'confidential');
		expect((await searchDocuments('confidential', asMember, {}, testDb)).hits).toHaveLength(0);
		expect((await searchDocuments('confidential', asAdmin, {}, testDb)).hits).toHaveLength(1);
	});

	it('scopes to one shelf when the rail is on one', async () => {
		await seedDocument({ name: 'Insurance', shelf: 'finance' });
		await seedDocument({ name: 'Insurance', shelf: 'property' });
		const { hits } = await searchDocuments('insurance', asAdmin, { shelfKey: 'property' }, testDb);
		expect(hits).toHaveLength(1);
	});
});

describe('substrings and snippets', () => {
	it('finds a variable symbol inside a scanned page', async () => {
		// The case that justifies the trigram index. 10078410 is not a word to
		// any text-search configuration, so FTS alone never finds it.
		const id = await seedDocument({ name: 'Claim' });
		await seedText(id, 'Platba VS 10078410 částka 4 200 Kč za opravu', 2);
		const { hits } = await searchDocuments('10078410', asAdmin, {}, testDb);
		expect(hits[0].documentId).toBe(id);
		expect(hits[0].pageNo).toBe(2);
		expect(hits[0].snippet).toMatch(/10078410/);
		expect(hits[0].matchedIn).toBe('contents');
	});

	it('folds diacritics in both directions', async () => {
		const id = await seedDocument({ name: 'Manual' });
		await seedText(id, 'provozní režim zařízení');
		expect((await searchDocuments('rezim', asAdmin, {}, testDb)).hits[0]?.documentId).toBe(id);
		expect((await searchDocuments('režim', asAdmin, {}, testDb)).hits[0]?.documentId).toBe(id);
	});

	it('labels where the match was found', async () => {
		const noted = await seedDocument({ name: 'A', note: 'boiler serviced in March' });
		const inside = await seedDocument({ name: 'B' });
		await seedText(inside, 'boiler service report');
		const { hits } = await searchDocuments('boiler', asAdmin, {}, testDb);
		expect(hits.find((h) => h.documentId === noted)!.matchedIn).toBe('note');
		expect(hits.find((h) => h.documentId === inside)!.matchedIn).toBe('contents');
	});

	it('uses the GIN indexes rather than reading every chunk', async () => {
		const id = await seedDocument({ name: 'Contract' });
		await seedText(id, 'smlouva o dílo');
		// The planner picks a sequential scan on a tiny table however good the
		// index is, so the check is made against a planner told to prefer it.
		await harness.sql`set enable_seqscan = off`;
		const plan = await harness.sql<{ 'QUERY PLAN': string }[]>`
			explain select 1 from document_text_chunk c
			where public.contact_fold(c.text) like '%' || public.contact_fold('smlouva') || '%'`;
		await harness.sql`set enable_seqscan = on`;
		expect(plan.map((r) => r['QUERY PLAN']).join('\n')).toMatch(/dtc_trgm_idx/);
	});
});

describe('the honesty counts', () => {
	it('counts documents with a file nothing could read', async () => {
		await seedDocument({ name: 'A spreadsheet' });
		const read = await seedDocument({ name: 'A contract' });
		await seedText(read, 'contract text');
		await seedDocument({ name: 'Metadata only', storedName: null });

		const { honesty } = await searchDocuments('nothing at all', asAdmin, {}, testDb);
		expect(honesty.notSearchable).toBe(1);
	});

	it('counts what is still being prepared separately from what failed', async () => {
		const waiting = await seedDocument({ name: 'Queued' });
		await testDb
			.insert(job)
			.values({ id: uuidv7(), kind: 'extract_text', subjectId: waiting, state: 'queued' });
		const { honesty } = await searchDocuments('nothing at all', asAdmin, {}, testDb);
		expect(honesty.pending).toBe(1);
		expect(honesty.notSearchable).toBe(0);
	});

	it("does not count restricted documents in a member's honesty hint", async () => {
		// The hint is a count, and a count is the leak this whole invariant
		// exists to close.
		const archived = await seedSubject('The old car', true);
		const hidden = await seedDocument({ sensitivity: 'restricted', subjectId: archived });
		await seedText(hidden, 'polička');
		const shown = await seedDocument({ sensitivity: 'normal', subjectId: archived });
		await seedText(shown, 'polička');

		const member = await searchDocuments('polička', asMember, { includeArchived: false }, testDb);
		expect(member.hits).toHaveLength(0);
		expect(member.honesty.archivedOnly).toBe(1);

		const admin = await searchDocuments('polička', asAdmin, { includeArchived: false }, testDb);
		expect(admin.honesty.archivedOnly).toBe(2);
	});

	it('finds the archived matches once the scope is opened', async () => {
		const archived = await seedSubject('The old car', true);
		const id = await seedDocument({ name: 'Servisní kniha', subjectId: archived });
		expect((await searchDocuments('servisni', asAdmin, {}, testDb)).hits).toHaveLength(0);
		const open = await searchDocuments('servisni', asAdmin, { includeArchived: true }, testDb);
		expect(open.hits.map((h) => h.documentId)).toEqual([id]);
		expect(open.honesty.archivedOnly).toBe(0);
	});
});
