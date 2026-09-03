// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { eq } from 'drizzle-orm';
import { document, documentLink, entity, subject } from '$lib/server/db/schema';
import { createCard } from '$lib/server/documents/cards';
import { loadDossier } from '$lib/server/documents/dossier-load';
import { lanesFor } from '$lib/server/organisations/mutations';
import { addShelf, listShelves, shelfIdByKey } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount, makeDocument, makeLoan, makePerson, makeTransaction } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

/**
 * The last read path, and the one where the leak would be a number.
 *
 * A member seeing "27" beside a shelf holding the 26 documents they can open
 * has been told something exists. That is why the counts are computed in SQL
 * behind the same predicate as the rows, rather than by counting the array
 * afterwards.
 */
let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

const asAdmin = { person: { id: 'a', name: 'A', initials: 'A', role: 'admin', theme: null } };
const asMember = { person: { id: 'm', name: 'M', initials: 'M', role: 'member', theme: null } };

/**
 * One record of every kind the screen has to be able to offer or name.
 *
 * A loan and a transaction above all: the loan is pickable and the transaction
 * is not, and the two halves of this task are that both are still OFFERED by
 * the about filter while only one of them is offered by a picker.
 */
const RECORD = {
	person: uuidv7(),
	account: uuidv7(),
	transaction: uuidv7(),
	loan: uuidv7()
} as const;

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('documents-load', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;

	await makePerson(testDb, { id: RECORD.person, name: 'Robert', initials: 'R', role: 'admin' });
	await makeAccount(testDb, {
		id: RECORD.account,
		name: 'Fio current',
		bank: 'fio',
		kind: 'current',
		currency: 'CZK'
	});
	await makeTransaction(testDb, {
		id: RECORD.transaction,
		accountId: RECORD.account,
		bookedOn: '2026-03-04',
		amountMinor: -123_450n,
		currency: 'CZK',
		counterparty: 'Alza',
		dedupFingerprint: 'documents-load-alza'
	});
	await makeLoan(testDb, {
		id: RECORD.loan,
		name: 'Vinohrady mortgage',
		currency: 'CZK',
		principalMinor: 500_000_000n,
		owedMinor: 400_000_000n
	});
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await harness.sql`delete from document`;
});

async function seedShelf(key: string, counts: { normal: number; restricted: number }) {
	const shelfId = await shelfIdByKey(key, testDb);
	for (const [sensitivity, n] of [
		['normal', counts.normal],
		['restricted', counts.restricted]
	] as const) {
		for (let i = 0; i < n; i++) {
			await makeDocument(testDb, {
				id: uuidv7(),
				name: `${sensitivity} ${i}`,
				shelfId,
				type: 'other',
				sensitivity,
				addedOn: '2026-01-01'
			});
		}
	}
}

interface AboutOption {
	id: string;
	name: string;
	meta?: string;
	kind: string;
	groupLabel: string;
	count: number;
}

type LoadedDocuments = {
	shelves: { key: string; label: string; count: number }[];
	total: number;
	view: 'list' | 'shelf' | 'tags';
	layout: string | null;
	shelfLayout: string | null;
	group: string;
	defaultGroup: string;
	emptyHint: string | null;
	coverage: { year: number; gaps: number; rows: unknown[] } | null;
	filterOptions: { entities: AboutOption[]; types: { code: string; count: number }[] };
	pickableTargets: { id: string; kind: string; groupLabel: string }[];
	screen: { emoji: string; label: string; count: number; question: string };
	tiles: { label: string; value: string }[];
	queue: {
		waiting: { id: string; name: string }[];
		current: string | null;
		shelves: { key: string }[];
	} | null;
	dossier: { cards: { id: string | null; name: string }[] } | null;
};

/**
 * One of the page's actions, called the way a form posts to it.
 *
 * The screen's actions are the only place several of these rules exist, and a
 * test that reached past them into the mutation would not be testing what a
 * person can actually do.
 */
async function callAction(
	name: string,
	fields: Record<string, string | string[]>,
	locals: unknown
): Promise<unknown> {
	const { actions } = await import('../../src/routes/(app)/documents/+page.server');
	const body = new FormData();
	for (const [key, value] of Object.entries(fields))
		for (const one of Array.isArray(value) ? value : [value]) body.append(key, one);
	const request = new Request('http://localhost/documents?shelf=inbox', { method: 'POST', body });
	return (actions as Record<string, (event: unknown) => Promise<unknown>>)[name]({
		request,
		locals,
		url: new URL(request.url)
	});
}

async function loadDocuments(
	locals: unknown,
	search = '',
	params: Record<string, string> = {}
): Promise<LoadedDocuments> {
	const { load } = await import('../../src/routes/(app)/documents/+page.server');
	const url = new URL(`http://localhost/documents${search}`);
	// `search` is the older spelling and carries a whole query string; `params`
	// is the readable one. Both, so the calls already written keep working.
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (await (load as any)({ url, locals })) as LoadedDocuments;
}

describe('the documents load', () => {
	it('gives a member a rail count that has already forgotten the restricted one', async () => {
		await seedShelf('inventory', { normal: 26, restricted: 1 });
		const data = await loadDocuments(asMember);
		expect(data.shelves.find((s) => s.key === 'inventory')!.count).toBe(26);
		expect(data.shelves.find((s) => s.key === 'all')!.count).toBe(26);
		expect(data.total).toBe(26);
	});

	it('gives the admin 27', async () => {
		await seedShelf('inventory', { normal: 26, restricted: 1 });
		const data = await loadDocuments(asAdmin);
		expect(data.shelves.find((s) => s.key === 'inventory')!.count).toBe(27);
		expect(data.total).toBe(27);
	});

	it('never shows a teaser row', async () => {
		// Not a row, not a name, not a flag set on anything the member can see.
		// The document does not reach the screen at all — there is nothing to
		// dim, grey out or mark as withheld, because a placeholder IS the leak.
		await seedShelf('inventory', { normal: 1, restricted: 1 });
		const data = (await loadDocuments(asMember)) as LoadedDocuments & {
			rows: { name: string; restricted: boolean }[];
		};
		expect(data.rows).toHaveLength(1);
		expect(data.rows.every((r) => r.restricted === false)).toBe(true);
		expect(JSON.stringify(data.rows)).not.toMatch(/restricted 0/);
	});
});

/**
 * Which view the centre column draws.
 *
 * All of it is URL state, so a bookmark is a saved view and the back button
 * means what it said. The one rule worth stating out loud is that a search
 * always falls back to the list: a match is explained by a snippet, and a card
 * face has nowhere to put one.
 */
describe('the view a shelf opens in', () => {
	it('draws the wallet on Identity', async () => {
		const data = await loadDocuments(asAdmin, '?shelf=identity');
		expect(data.view).toBe('shelf');
		expect(data.layout).toBe('wallet');
	});

	it('gives back the list when asked, and says the wallet is still there', async () => {
		const data = await loadDocuments(asAdmin, '?shelf=identity&view=list');
		expect(data.view).toBe('list');
		expect(data.layout).toBeNull();
		// The toolbar needs to keep offering the switch it was just used to leave.
		expect(data.shelfLayout).toBe('wallet');
	});

	it('falls back to the list for a search', async () => {
		const data = await loadDocuments(asAdmin, '?shelf=identity&q=passport');
		expect(data.view).toBe('list');
		expect(data.layout).toBeNull();
	});

	it('opens Statements on its coverage ribbon', async () => {
		const data = await loadDocuments(asAdmin, '?shelf=statements');
		expect(data.view).toBe('shelf');
		expect(data.layout).toBe('completeness');
		expect(data.coverage).not.toBeNull();
	});

	it('opens Income & Tax on its dossier cards', async () => {
		const data = await loadDocuments(asAdmin, '?shelf=income_tax');
		expect(data.view).toBe('shelf');
		expect(data.layout).toBe('dossier');
	});

	it('opens every other shelf on its own engine, not on the list', async () => {
		// The v0.8.0 ruling: a shelf is one question, one unit, one template, and
		// the list is a view it can OPEN rather than what it is. Before this,
		// six of the eight fell through to the list because only three layouts
		// had been built.
		for (const [shelf, engine] of [
			['identity', 'wallet'],
			['health', 'dossier'],
			['inventory', 'dossier'],
			['vehicles', 'dossier']
		] as const) {
			const data = await loadDocuments(asAdmin, `?shelf=${shelf}`);
			expect(data.view, shelf).toBe('shelf');
			expect(data.layout, shelf).toBe(engine);
		}
	});

	it('opens a shelf the household made on its template, too', async () => {
		// The whole point of moving this onto the row: a Boat shelf is as good as
		// a seeded one. Before v0.8.0 a custom shelf had no profile and therefore
		// no layout at all.
		await addShelf(
			{ label: 'Boat', template: 'obligations', unit: 'subject', question: 'Is she seaworthy?' },
			testDb
		);
		const data = await loadDocuments(asAdmin, '?shelf=boat');
		expect(data.view).toBe('shelf');
		expect(data.layout).toBe('dossier');
		expect(data.emptyHint).toBe('Is she seaworthy?');
	});

	it('falls to the list for a shelf key that names nothing', async () => {
		const data = await loadDocuments(asAdmin, '?shelf=nonesuch');
		expect(data.view).toBe('list');
		expect(data.shelfLayout).toBeNull();
	});

	it('has no engine for Everything, which is not a shelf', async () => {
		for (const search of ['', '?shelf=all']) {
			const data = await loadDocuments(asAdmin, search);
			expect(data.view).toBe('list');
			expect(data.shelfLayout).toBeNull();
			expect(data.emptyHint).toBeNull();
		}
	});

	it('sends a search to the list, whichever shelf it started on', async () => {
		// A match is explained by the line it was found in, and a card face has
		// nowhere to put one.
		const data = await loadDocuments(asAdmin, '?shelf=identity&q=passport');
		expect(data.view).toBe('list');
	});
});

describe('what a shelf brings with it', () => {
	it('groups the list by type on every shelf, because the list is not the shelf', async () => {
		// One default for every shelf since v0.8.0. A per-shelf grouping for the
		// FALLBACK view was a preference nobody expressed: what a shelf is for is
		// its engine, and the list is what you open when you want the other thing.
		for (const shelf of ['income_tax', 'identity', 'inbox'])
			expect((await loadDocuments(asAdmin, `?shelf=${shelf}&view=list`)).group, shelf).toBe('type');
	});

	it('still lets the control say otherwise', async () => {
		const data = await loadDocuments(asAdmin, '?shelf=income_tax&view=list&group=entity');
		expect(data.group).toBe('entity');
		expect(data.defaultGroup).toBe('type');
	});

	it('carries the question the shelf answers, for an empty one to show', async () => {
		// Prose on the row now, not in a registry keyed by shelf — so a shelf
		// somebody made has one too.
		expect(await loadDocuments(asAdmin, '?shelf=identity')).toHaveProperty(
			'emptyHint',
			'Does everybody hold a valid document?'
		);
	});

	it('offers the types the shelf expects first', async () => {
		// Two invoices and one identity document on Identity: the filter still
		// offers both, and starts with the one the shelf is for rather than with
		// whatever happens to be most numerous.
		for (const [name, type] of [
			['Passport', 'id_document'],
			['Invoice one', 'invoice'],
			['Invoice two', 'invoice']
		] as const) {
			await makeDocument(testDb, {
				id: uuidv7(),
				name,
				shelfKey: 'identity',
				type,
				addedOn: '2026-01-01'
			});
		}

		const data = await loadDocuments(asAdmin, '?shelf=identity&view=list');
		expect(data.filterOptions.types.map((t) => t.code)).toEqual(['id_document', 'invoice']);
	});
});

/**
 * A document filed against a loan and against a transaction, which is what the
 * about filter and the capture form each have to cope with: one kind a picker
 * may offer, one kind it may not.
 */
async function fileAgainst(name: string, targetIds: readonly string[]): Promise<string> {
	const id = uuidv7();
	await makeDocument(testDb, {
		id,
		name,
		shelfKey: 'inventory',
		type: 'other',
		addedOn: '2026-01-01'
	});
	for (const targetId of targetIds) {
		await testDb.insert(documentLink).values({ documentId: id, targetId });
	}
	return id;
}

describe('the about filter', () => {
	it('offers every kind the paper points at, under the heading it belongs to', async () => {
		// A loan and a transaction, neither of which the four-kind list the screen
		// used to keep could name — so neither could be filtered by.
		await fileAgainst('Yearly mortgage statement', [RECORD.loan, RECORD.person]);
		await fileAgainst('Alza receipt', [RECORD.transaction]);

		const { entities } = (await loadDocuments(asAdmin)).filterOptions;
		const byKind = new Map(entities.map((e) => [e.kind, e]));

		expect(byKind.get('loan')?.name).toBe('Vinohrady mortgage');
		expect(byKind.get('loan')?.groupLabel).toBe('Loans');
		expect(byKind.get('loan')?.count).toBe(1);

		// A transaction is not pickable and is still filterable: a receipt is
		// found on the Documents screen exactly as often as anywhere else.
		expect(byKind.get('transaction')?.groupLabel).toBe('Transactions');
		// The name of a card payment is a shop and a date; the amount is what
		// tells two of them apart, in the currency's own symbol.
		expect(byKind.get('transaction')?.meta).toMatch(/1.234[.,]50\sKč/u);

		expect(byKind.get('person')?.groupLabel).toBe('People');
	});

	it('never offers a record nothing on the shelf points at', async () => {
		await fileAgainst('Alza receipt', [RECORD.transaction]);
		const { entities } = (await loadDocuments(asAdmin)).filterOptions;
		expect(entities.some((e) => e.id === RECORD.loan)).toBe(false);
	});
});

describe('capture', () => {
	async function capture(fields: {
		name: string;
		linkIds?: readonly string[];
		newSubject?: string;
	}): Promise<{ addedIds: string[] }> {
		const { actions } = await import('../../src/routes/(app)/documents/+page.server');
		const form = new FormData();
		form.set('name', fields.name);
		form.set('shelf', 'inventory');
		for (const id of fields.linkIds ?? []) form.append('linkIds', id);
		if (fields.newSubject) form.set('newSubject', fields.newSubject);
		const request = new Request('http://localhost/documents?/addDocument', {
			method: 'POST',
			body: form
		});
		return (await (actions.addDocument as unknown as (event: unknown) => Promise<unknown>)({
			request,
			locals: asAdmin
		})) as { addedIds: string[] };
	}

	it('files the new document against every kind the form posted', async () => {
		// One field, several kinds. The per-kind inputs the action used to read —
		// personIds, propertyIds, accountIds, subjectIds — could not carry a loan
		// at all, because no screen ever wrote a `loanIds` input.
		const { addedIds } = await capture({
			name: 'Mortgage statement',
			linkIds: [RECORD.person, RECORD.loan, RECORD.transaction]
		});
		expect(addedIds).toHaveLength(1);

		const links = await testDb
			.select({ targetId: documentLink.targetId })
			.from(documentLink)
			.where(eq(documentLink.documentId, addedIds[0]));
		expect(links.map((l) => l.targetId).sort()).toEqual(
			[RECORD.person, RECORD.loan, RECORD.transaction].sort()
		);
	});

	it('still mints a subject typed into the form beside the ids that were ticked', async () => {
		const { addedIds } = await capture({
			name: 'Boiler warranty',
			linkIds: [RECORD.person],
			newSubject: 'The boiler'
		});

		const links = await testDb
			.select({ targetId: documentLink.targetId, kind: entity.kind })
			.from(documentLink)
			.innerJoin(entity, eq(entity.id, documentLink.targetId))
			.where(eq(documentLink.documentId, addedIds[0]));
		expect(links.map((l) => l.kind).sort()).toEqual(['person', 'subject']);

		const minted = links.find((l) => l.kind === 'subject')!.targetId;
		const [row] = await testDb.select().from(subject).where(eq(subject.id, minted));
		expect(row.name).toBe('The boiler');
	});

	it('fails plainly, rather than throwing, when a posted file cannot be read', async () => {
		// A real multipart round trip through `Request` reconstructs its own File,
		// so this drives the action directly with a fake `request.formData()` —
		// the only thing the action calls on it — carrying a File whose
		// `arrayBuffer()` is broken, the way a truncated upload can be.
		const { actions } = await import('../../src/routes/(app)/documents/+page.server');
		const file = new File(['broken'], 'broken.pdf', { type: 'application/pdf' });
		file.arrayBuffer = () => Promise.reject(new Error('Corrupt upload.'));
		const form = new FormData();
		form.set('shelf', 'inventory');
		form.set('file', file);
		const request = { formData: async () => form } as unknown as Request;

		const result = await (actions.addDocument as unknown as (event: unknown) => Promise<unknown>)({
			request,
			locals: asAdmin
		});

		expect(result).toMatchObject({ status: 400, data: { message: 'Corrupt upload.' } });
	});
});

describe('the Inbox queue', () => {
	it('offers every kind a document may be filed against, and no kind it may not', async () => {
		const data = await loadDocuments(asAdmin, '', { shelf: 'inbox' });

		expect(data.pickableTargets.find((t) => t.id === RECORD.loan)?.groupLabel).toBe('Loans');
		expect(data.pickableTargets.some((t) => t.id === RECORD.account)).toBe(true);
		// A list of every transaction is a list nobody can read by eye. They reach
		// a document from their own screen instead.
		expect(data.pickableTargets.some((t) => t.kind === 'transaction')).toBe(false);
	});

	it('draws the queue on the shelf itself, oldest first', async () => {
		// The Inbox IS the queue since v0.8.0: it was a shelf that showed the
		// problem and a separate page for doing something about it.
		await makeDocument(testDb, {
			name: 'Older',
			shelfKey: 'inbox',
			type: 'other',
			addedOn: '2026-01-01'
		});
		await makeDocument(testDb, {
			name: 'Newer',
			shelfKey: 'inbox',
			type: 'other',
			addedOn: '2026-02-01'
		});
		const data = await loadDocuments(asAdmin, '', { shelf: 'inbox' });
		expect(data.layout).toBe('queue');
		expect(data.queue).not.toBeNull();
		expect(data.queue!.waiting.map((d) => d.name)).toEqual(['Older', 'Newer']);
		// The oldest is what is in front of you: a queue offering the newest
		// leaves the one that has waited longest waiting longer.
		expect(data.queue!.current).toBe(data.queue!.waiting[0].id);
		expect(data.queue!.shelves.map((s) => s.key)).not.toContain('inbox');
	});

	it('takes a document off the Inbox when it is filed', async () => {
		const id = uuidv7();
		await makeDocument(testDb, {
			id,
			name: 'Something unfiled',
			shelfKey: 'inbox',
			type: 'other',
			addedOn: '2026-01-01'
		});

		const result = (await callAction(
			'fileFromQueue',
			{ id, name: 'A boiler service', shelf: 'inventory', type: 'invoice' },
			asAdmin
		)) as { ok?: boolean };
		expect(result.ok).toBe(true);

		const [row] = await testDb
			.select({ shelfId: document.shelfId, name: document.name, type: document.type })
			.from(document)
			.where(eq(document.id, id));
		expect(row.shelfId).not.toBe(await shelfIdByKey('inbox', testDb));
		expect(row.shelfId).toBe(await shelfIdByKey('inventory', testDb));
		expect(row.name).toBe('A boiler service');
		expect(row.type).toBe('invoice');
	});

	it('files onto a card and into its lane, and closes the cell', async () => {
		const vehicles = (await listShelves(testDb)).find((s) => s.key === 'vehicles')!;
		const car = await createCard({ shelfId: vehicles.id, name: 'Octavia' }, testDb);
		const insurance = (await lanesFor(car.id, testDb)).find((l) => l.label === 'Insurance')!;
		const id = uuidv7();
		await makeDocument(testDb, {
			id,
			name: 'Insurance 2025',
			shelfKey: 'inbox',
			type: 'other',
			addedOn: '2026-01-01',
			periodOn: '2025-01-01'
		});

		const result = (await callAction(
			'fileFromQueue',
			{
				id,
				name: 'Vehicle insurance 2025',
				shelf: 'vehicles',
				cardId: car.id,
				laneId: insurance.id,
				type: 'insurance_policy'
			},
			asAdmin
		)) as { ok?: boolean };
		expect(result.ok).toBe(true);

		const [row] = await testDb
			.select({ laneId: document.laneId })
			.from(document)
			.where(eq(document.id, id));
		expect(row.laneId).toBe(insurance.id);
		// The cell it was filed for is no longer a hole. That is the whole point
		// of the third step.
		const payload = await loadDossier(
			vehicles,
			{ id: 'a', role: 'admin' },
			2026,
			testDb,
			'2026-09-02'
		);
		const drawn = payload.cards[0].lanes.find((l) => l.id === insurance.id)!;
		expect(drawn.cells.find((c) => c.key === '2025')?.state).toBe('filed');
	});

	it('makes the card on the way past', async () => {
		const id = uuidv7();
		await makeDocument(testDb, {
			id,
			name: 'A bike receipt',
			shelfKey: 'inbox',
			type: 'other',
			addedOn: '2026-01-01'
		});
		const result = (await callAction(
			'fileFromQueue',
			{ id, name: 'PCX receipt', shelf: 'vehicles', newCardName: 'Honda PCX', type: 'receipt' },
			asAdmin
		)) as { ok?: boolean };
		expect(result.ok).toBe(true);

		const [made] = await testDb.select().from(subject).where(eq(subject.name, 'Honda PCX'));
		expect(made).toBeDefined();
		// Seeded with the shelf's lanes, so the new card can be missing something
		// from the moment it exists.
		expect((await lanesFor(made.id, testDb)).map((l) => l.label)).toEqual([
			'Insurance',
			'Technical inspection',
			'Road tax'
		]);
	});
});
