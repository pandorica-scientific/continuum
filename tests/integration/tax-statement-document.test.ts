// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Filing a tax statement and the paper it came from is one save. The point of
// these tests is the cross-link: the statement is linked to its documents, each
// is on the Finance shelf, and each is filed against the same person — which is
// what makes them appear in the household's own files rather than nowhere.
//
// A year's filing is several pieces of paper, not one, so since v0.4.3 the link
// is a document_link row against the statement's entity rather than a column on
// the statement. The old `document_id` column is dead and no longer read.
import { eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { detachDocument } from '$lib/server/documents/targets';
import { recordSalary } from '$lib/server/salary';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makePerson } from './fixtures';
import {
	attachDocumentsToStatement,
	loadStatements,
	saveStatement,
	statementDocumentName
} from '$lib/server/tax';

// The `deleteAttachment` suite calls the page's own action, which reaches for
// the module-level `db` rather than a handle it was passed — so, only for
// that suite, `db` has to resolve to this harness too.
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;
const PERSON = rowId('person-a');

const base = {
	personId: PERSON,
	year: 2025,
	country: 'CZ',
	currency: 'CZK',
	grossIncomeMinor: 1_200_000n,
	taxPaidMinor: 180_000n,
	note: null,
	lines: [],
	attachments: [],
	linkDocumentIds: [],
	// An admin saves these fixtures: linking now goes through the registry,
	// which applies the read rule to the document being named.
	actor: { id: rowId('person-a'), role: 'admin' as const }
};

const upload = {
	storedName: '11111111-1111-1111-1111-111111111111.pdf',
	ext: 'PDF',
	addedOn: '2026-08-22',
	kind: 'statement' as const
};

/** A filed attachment with a distinct stored name, so uniqueness is never luck. */
const filed = (storedName: string, kind: 'statement' | 'employer' | 'broker' | 'other') => ({
	storedName,
	ext: 'PDF',
	addedOn: '2026-08-23',
	kind
});

/** Every document linked to a statement, by name. */
async function attachedTo(statementId: string): Promise<string[]> {
	const rows = await testDb
		.select({ name: schema.document.name })
		.from(schema.documentLink)
		.innerJoin(schema.document, eq(schema.document.id, schema.documentLink.documentId))
		.where(eq(schema.documentLink.targetId, statementId));
	return rows.map((r) => r.name).sort();
}

beforeAll(async () => {
	harness = await startPostgres('tax-statement-document');
	testDb = harness.db;
	previousUrl = process.env.DATABASE_URL;
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await harness.sql`truncate table entity, person, document, tax_statement restart identity cascade`;
	await makePerson(testDb, { id: PERSON, name: 'Person A', initials: 'PA' });
});

describe('a statement that brings its own document', () => {
	it('files the upload on the Finance shelf and links the statement to it', async () => {
		expect(await saveStatement({ ...base, attachments: [upload] }, testDb)).toEqual({ ok: true });

		const [statement] = await testDb.select().from(schema.taxStatement);
		const [doc] = await testDb.select().from(schema.document);

		expect(await attachedTo(statement.id)).toEqual([statementDocumentName(2025, 'CZ')]);
		expect(doc).toMatchObject({
			shelfId: await shelfIdByKey('finance', testDb),
			type: 'tax_document',
			storedName: upload.storedName,
			ext: 'PDF',
			addedOn: upload.addedOn,
			name: statementDocumentName(2025, 'CZ')
		});
	});

	it('files it against the person whose statement it is', async () => {
		await saveStatement({ ...base, attachments: [upload] }, testDb);
		const [doc] = await testDb.select().from(schema.document);
		const [statement] = await testDb.select().from(schema.taxStatement);

		const targets = await testDb
			.select({ targetId: schema.documentLink.targetId })
			.from(schema.documentLink)
			.where(eq(schema.documentLink.documentId, doc.id));
		// Both ends: the person it belongs to, and the statement it evidences.
		expect(targets.map((t) => t.targetId).sort()).toEqual([PERSON, statement.id].sort());
	});

	it('leaves no document behind when the statement itself fails to save', async () => {
		await harness.sql.unsafe(`
			create function task_fail_tax_statement() returns trigger language plpgsql as $$
			begin raise exception 'injected tax statement failure'; end $$;
			create trigger task_fail_tax_statement before insert on tax_statement
			for each row execute function task_fail_tax_statement();
		`);

		await expect(saveStatement({ ...base, attachments: [upload] }, testDb)).rejects.toThrow();
		expect(await testDb.select().from(schema.document)).toEqual([]);

		await harness.sql.unsafe(`
			drop trigger task_fail_tax_statement on tax_statement;
			drop function task_fail_tax_statement();
		`);
	});

	it('links a document already sitting on the Finance shelf', async () => {
		await saveStatement({ ...base, attachments: [upload] }, testDb);
		const [doc] = await testDb.select().from(schema.document);
		await harness.sql`delete from document_link where target_id in (select id from tax_statement)`;

		await saveStatement({ ...base, linkDocumentIds: [doc.id] }, testDb);

		const [statement] = await testDb.select().from(schema.taxStatement);
		expect(await attachedTo(statement.id)).toEqual([statementDocumentName(2025, 'CZ')]);
		expect(await testDb.select().from(schema.document)).toHaveLength(1);
	});
});

describe('a statement that brings several documents', () => {
	it('files one document per attachment, each named for what it is', async () => {
		expect(
			await saveStatement(
				{
					...base,
					attachments: [
						filed('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf', 'statement'),
						filed('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.pdf', 'employer'),
						filed('cccccccc-cccc-cccc-cccc-cccccccccccc.pdf', 'broker')
					]
				},
				testDb
			)
		).toEqual({ ok: true });

		const docs = await testDb.select().from(schema.document);
		expect(docs.map((d) => d.name).sort()).toEqual([
			'2025 CZ broker earnings report',
			'2025 CZ employer earnings report',
			'2025 CZ tax statement'
		]);
		// Type, not shelf: a household may rename or move the shelf these sit
		// on, and the statement's attachments must still read as tax paperwork.
		for (const doc of docs) expect(doc.type).toBe('tax_document');
	});

	it('links every one of them to the statement', async () => {
		await saveStatement(
			{
				...base,
				attachments: [
					filed('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf', 'statement'),
					filed('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.pdf', 'employer')
				]
			},
			testDb
		);

		const [statement] = await testDb.select().from(schema.taxStatement);
		expect(await attachedTo(statement.id)).toHaveLength(2);
	});

	it('tags each document by its kind, so the shelf can filter across years', async () => {
		await saveStatement(
			{ ...base, attachments: [filed('cccccccc-cccc-cccc-cccc-cccccccccccc.pdf', 'broker')] },
			testDb
		);

		const [doc] = await testDb.select().from(schema.document);
		const tags = await testDb
			.select({ name: schema.tag.name })
			.from(schema.tagLink)
			.innerJoin(schema.tag, eq(schema.tag.id, schema.tagLink.tagId))
			.where(eq(schema.tagLink.targetId, doc.id));
		expect(tags.map((t) => t.name)).toEqual(['broker report']);
	});

	it('keeps two of one kind apart by appending the file they came from', async () => {
		await saveStatement(
			{
				...base,
				attachments: [
					{ ...filed('dddddddd-dddd-dddd-dddd-dddddddddddd.pdf', 'broker'), original: 'xtb.pdf' },
					{ ...filed('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee.pdf', 'broker'), original: 'degiro.pdf' }
				]
			},
			testDb
		);

		const docs = await testDb.select().from(schema.document);
		expect(docs.map((d) => d.name).sort()).toEqual([
			'2025 CZ broker earnings report',
			'2025 CZ broker earnings report · degiro.pdf'
		]);
	});

	it('checks for a collision against what is stored, not just within the batch', async () => {
		// The second broker report might arrive a week after the first.
		await saveStatement(
			{
				...base,
				attachments: [
					{ ...filed('dddddddd-dddd-dddd-dddd-dddddddddddd.pdf', 'broker'), original: 'xtb.pdf' }
				]
			},
			testDb
		);
		const [statement] = await testDb.select().from(schema.taxStatement);

		await testDb.transaction((tx) =>
			attachDocumentsToStatement(
				statement.id,
				PERSON,
				2025,
				'CZ',
				[
					{
						...filed('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee.pdf', 'broker'),
						original: 'degiro.pdf'
					}
				],
				tx
			)
		);

		expect(await attachedTo(statement.id)).toEqual([
			'2025 CZ broker earnings report',
			'2025 CZ broker earnings report · degiro.pdf'
		]);
	});
});

describe('detaching', () => {
	it('removes the link and leaves the document on the shelf', async () => {
		await saveStatement({ ...base, attachments: [upload] }, testDb);
		const [statement] = await testDb.select().from(schema.taxStatement);
		const [doc] = await testDb.select().from(schema.document);

		expect(await detachDocument(statement.id, doc.id, base.actor, testDb)).toEqual({ ok: true });

		expect(await testDb.select().from(schema.document)).toHaveLength(1);
		expect(await attachedTo(statement.id)).toEqual([]);
	});

	it('leaves the document filed against the person, so it is still findable', async () => {
		await saveStatement({ ...base, attachments: [upload] }, testDb);
		const [statement] = await testDb.select().from(schema.taxStatement);
		const [doc] = await testDb.select().from(schema.document);

		await detachDocument(statement.id, doc.id, base.actor, testDb);

		expect(
			await testDb
				.select({ targetId: schema.documentLink.targetId })
				.from(schema.documentLink)
				.where(eq(schema.documentLink.documentId, doc.id))
		).toEqual([{ targetId: PERSON }]);
	});

	it('reports a miss rather than succeeding silently on a stale page', async () => {
		await saveStatement({ ...base, attachments: [upload] }, testDb);
		const [statement] = await testDb.select().from(schema.taxStatement);

		// A person id is not a document, so the registry answers the way it
		// answers any document that is not there.
		const outcome = await detachDocument(statement.id, PERSON, base.actor, testDb);
		expect(outcome.ok).toBe(false);
	});
});

describe('deleting the statement', () => {
	it('leaves its documents standing on the Finance shelf', async () => {
		await saveStatement({ ...base, attachments: [upload] }, testDb);
		const [statement] = await testDb.select().from(schema.taxStatement);

		await testDb.delete(schema.taxStatement).where(eq(schema.taxStatement.id, statement.id));

		// The AFTER DELETE trigger retires the entity and document_link cascades
		// from there — but a document is filed paperwork, not a connector.
		expect(await testDb.select().from(schema.document)).toHaveLength(1);
		expect(await testDb.select().from(schema.documentLink)).toEqual([
			{ documentId: expect.any(String), targetId: PERSON }
		]);
	});
});

describe('loadStatements', () => {
	it('carries each statement its own attachments and nobody else s', async () => {
		await saveStatement(
			{
				...base,
				attachments: [
					filed('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf', 'statement'),
					filed('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.pdf', 'employer')
				]
			},
			testDb
		);
		await saveStatement(
			{
				...base,
				year: 2024,
				attachments: [filed('ffffffff-ffff-ffff-ffff-ffffffffffff.pdf', 'broker')]
			},
			testDb
		);

		const rows = await loadStatements(null, testDb);
		const y2025 = rows.find((r) => r.year === 2025)!;
		const y2024 = rows.find((r) => r.year === 2024)!;

		expect(y2025.attachments.map((a) => a.name).sort()).toEqual([
			'2025 CZ employer earnings report',
			'2025 CZ tax statement'
		]);
		expect(y2024.attachments.map((a) => a.name)).toEqual(['2024 CZ broker earnings report']);
	});

	it('does not mistake a document filed against a person for an attachment', async () => {
		// The far end of a document_link is any entity. A bare join would sweep
		// in every document filed against a person, a flat or a transaction.
		await makeDocument(testDb, {
			id: rowId('loose-doc'),
			name: 'Passport · Person A',
			shelfKey: 'identity',
			type: 'id_document',
			ext: 'PDF',
			addedOn: '2026-08-23'
		});
		await testDb
			.insert(schema.documentLink)
			.values({ documentId: rowId('loose-doc'), targetId: PERSON });
		await saveStatement({ ...base, attachments: [upload] }, testDb);

		const rows = await loadStatements(null, testDb);
		expect(rows[0].attachments.map((a) => a.name)).toEqual([statementDocumentName(2025, 'CZ')]);
	});
});

/**
 * Task 9's semantics, on the tax screen's own action.
 *
 * `deleteAttachment` used to call `deleteDocument` directly: a plain row
 * delete, with `salary_entry.document_id` SET NULL underneath it. That leaves
 * a stale row behind — still counted in a year's total, with nothing on
 * screen to say where it came from — for exactly the reason `removeDocument`
 * (Task 9) exists. Switching the action to it means a payslip attached here
 * is forgotten the same way one deleted from the Salary screen is.
 */
describe('deleteAttachment', () => {
	interface Locals {
		person: { id: string; name: string; initials: string; role: 'admin' | 'member'; theme: null };
	}
	const ADMIN_LOCALS: Locals = {
		person: { id: PERSON, name: 'Person A', initials: 'PA', role: 'admin', theme: null }
	};

	async function postDeleteAttachment(documentId: string) {
		const { actions } = await import('../../src/routes/(app)/tax/+page.server');
		const form = new FormData();
		form.set('documentId', documentId);
		const request = new Request('http://localhost/tax?/deleteAttachment', {
			method: 'POST',
			body: form
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (actions.deleteAttachment as any)({ request, locals: ADMIN_LOCALS });
	}

	it('takes a payslip attachment’s salary row with it, rather than leaving it orphaned', async () => {
		await saveStatement(base, testDb);
		const [statement] = await testDb.select().from(schema.taxStatement);

		const slipId = rowId('payslip-attachment');
		await makeDocument(testDb, {
			id: slipId,
			name: 'Payslip 2025-06 · Person A',
			shelfKey: 'finance',
			type: 'payslip',
			storedName: '22222222-2222-2222-2222-222222222222.pdf',
			ext: 'PDF',
			addedOn: '2026-08-23',
			periodOn: '2025-06-01'
		});
		// Filed against the statement, the way a tax attachment is — not against
		// the person, which is the usual home for a payslip.
		await testDb.insert(schema.documentLink).values({ documentId: slipId, targetId: statement.id });
		expect(
			await recordSalary(
				{
					personId: PERSON,
					periodMonth: '2025-06',
					currency: 'CZK',
					grossMinor: 6_000_000n,
					source: 'payslip',
					documentId: slipId
				},
				testDb
			)
		).toEqual({ ok: true });

		expect(await postDeleteAttachment(slipId)).toEqual({ ok: true });

		// No bank credit was ever merged into this month, so the row goes with
		// the slip entirely — a plain document delete would instead have left it
		// behind with `documentId` set to null and a stale gross figure.
		expect(
			await testDb.select().from(schema.salaryEntry).where(eq(schema.salaryEntry.personId, PERSON))
		).toEqual([]);
		expect(
			await testDb.select().from(schema.document).where(eq(schema.document.id, slipId))
		).toHaveLength(0);
	});

	it('reports a miss rather than succeeding silently, for a document that is not there', async () => {
		const result = await postDeleteAttachment(rowId('no-such-document'));
		expect(result).toMatchObject({ status: 404 });
	});
});
