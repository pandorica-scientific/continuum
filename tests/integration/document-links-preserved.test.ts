// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { documentLink, taxStatement } from '$lib/server/db/schema';

import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount, makeDocument, makePerson, makeProperty, makeTransaction } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

/**
 * The most serious thing a save could do: forget.
 *
 * The inspector deleted every `document_link` a document had and re-inserted
 * what the form posted, and the form's picker offered people, property and
 * subjects. So a receipt's transaction, a tax attachment's statement and a
 * statement's account were destroyed by opening the document and pressing Save
 * — silently, with nothing on screen to say a link had been there.
 *
 * These go through the page's own `load` and its own `updateDocument`, because
 * both halves are the bug: the picker could not offer those kinds, AND the save
 * removed what the picker did not post. Posting a hand-written list of ids here
 * would test the half that was never broken.
 */
let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

const asAdmin = {
	person: { id: rowId('dlp-admin'), name: 'A', initials: 'A', role: 'admin', theme: null }
};

const target = {
	person: rowId('dlp-person'),
	otherPerson: rowId('dlp-person-2'),
	property: rowId('dlp-property'),
	account: rowId('dlp-account'),
	transaction: rowId('dlp-transaction'),
	tax_statement: rowId('dlp-tax-statement')
} as const;

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('document-links-preserved', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;

	await makePerson(testDb, { id: target.person, name: 'Jana Nováková', initials: 'JN' });
	await makePerson(testDb, { id: target.otherPerson, name: 'Petr Novák', initials: 'PN' });
	await makeProperty(testDb, { id: target.property, name: 'Vinohrady flat', kind: 'lived' });
	// A CURRENT account, deliberately: the Documents screen used to load
	// brokerage accounts only, so a bank statement's own account had no name and
	// no chip — which is exactly how its link got thrown away.
	await makeAccount(testDb, {
		id: target.account,
		name: 'Current account',
		bank: 'other',
		kind: 'current',
		currency: 'CZK'
	});
	await makeTransaction(testDb, {
		id: target.transaction,
		accountId: target.account,
		bookedOn: '2026-03-04',
		amountMinor: -123_450n,
		currency: 'CZK',
		counterparty: 'Alza',
		dedupFingerprint: 'dlp-transaction'
	});
	await testDb.insert(taxStatement).values({
		id: target.tax_statement,
		personId: target.person,
		year: 2025,
		country: 'Czechia',
		currency: 'CZK',
		grossIncomeMinor: 0n,
		taxPaidMinor: 0n
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

const DOC = rowId('dlp-doc');

async function seedDocument(name: string, links: string[]): Promise<string> {
	await makeDocument(testDb, {
		id: DOC,
		name,
		shelfKey: 'inventory',
		type: 'other',
		storedName: `${DOC}.pdf`,
		ext: 'PDF',
		addedOn: '2026-01-01'
	});
	for (const targetId of links) {
		await testDb.insert(documentLink).values({ documentId: DOC, targetId });
	}
	return DOC;
}

interface InspectorLink {
	id: string;
	kind: string;
	name: string;
	meta?: string;
	groupLabel: string;
	pickable: boolean;
}

interface LoadedScreen {
	selected: { links: InspectorLink[] } | null;
	prefill: { targets: InspectorLink[] };
	pickableTargets: InspectorLink[];
}

async function openScreen(search: string): Promise<LoadedScreen> {
	const { load } = await import('../../src/routes/(app)/documents/+page.server');
	return (await (load as unknown as (event: unknown) => Promise<unknown>)({
		url: new URL(`http://localhost/documents${search}`),
		locals: asAdmin
	})) as LoadedScreen;
}

/** What the inspector is handed when the document is open beside the list. */
async function openInspector(documentId: string): Promise<InspectorLink[]> {
	return (await openScreen(`?doc=${documentId}`)).selected?.links ?? [];
}

/**
 * The ids the inspector's form actually posts.
 *
 * One input per chip, and a chip needs a name — a nameless link renders
 * nothing, so nothing goes back for it. That is not a detail of the test: it is
 * how a bank statement's own account, which the screen could not name, left the
 * form empty-handed and was deleted by the save that followed.
 */
async function postedLinkIds(documentId: string): Promise<string[]> {
	return (await openInspector(documentId)).filter((link) => link.name).map((link) => link.id);
}

/**
 * A real Save: the form the inspector posts, through the real action.
 *
 * `linkIds` is every chip the inspector rendered — the ticked pickable ones and
 * the hidden input behind each read-only one — which is what makes the diff on
 * the far side exact.
 */
async function save(documentId: string, linkIds: string[]): Promise<void> {
	const { actions } = await import('../../src/routes/(app)/documents/+page.server');
	const form = new FormData();
	form.set('id', documentId);
	form.set('name', 'A document');
	form.set('type', 'other');
	for (const value of linkIds) form.append('linkIds', value);
	const request = new Request('http://localhost/documents?/updateDocument', {
		method: 'POST',
		body: form
	});
	await (actions.updateDocument as unknown as (event: unknown) => Promise<unknown>)({
		request,
		locals: asAdmin
	});
}

async function linkedTargets(documentId: string): Promise<string[]> {
	const rows = await testDb
		.select({ targetId: documentLink.targetId })
		.from(documentLink)
		.where(eq(documentLink.documentId, documentId));
	return rows.map((r) => r.targetId).sort();
}

describe('the inspector', () => {
	it('is handed every link the document has, named and grouped', async () => {
		const id = await seedDocument('Receipt', [
			target.person,
			target.account,
			target.transaction,
			target.tax_statement
		]);
		const links = await openInspector(id);
		expect(links.map((l) => l.id).sort()).toEqual(
			[target.person, target.account, target.transaction, target.tax_statement].sort()
		);
		// A chip with no name is a chip nobody can act on, and the save that
		// follows would have nothing to post.
		expect(links.every((l) => l.name.length > 0)).toBe(true);
		expect(links.find((l) => l.kind === 'transaction')?.pickable).toBe(false);
		expect(links.find((l) => l.kind === 'tax_statement')?.pickable).toBe(false);
		expect(links.find((l) => l.kind === 'account')?.pickable).toBe(true);
		expect(links.find((l) => l.kind === 'account')?.groupLabel).toBe('Accounts');
	});

	it('still names its links when the Tags view is what the centre column shows', async () => {
		// The panel is a URL, and it survives switching the centre column to Tags.
		// Names are read only for what is on screen, and this IS on screen — a
		// Save from a panel holding unnamed links would delete them.
		const id = await seedDocument('Alza receipt', [target.transaction, target.person]);
		const data = await openScreen(`?view=tags&doc=${id}`);
		expect(data.selected?.links.map((l) => l.id).sort()).toEqual(
			[target.transaction, target.person].sort()
		);
		expect(data.selected?.links.every((l) => l.name.length > 0)).toBe(true);
	});

	it('offers every kind the document side may pick, ordinary accounts included', async () => {
		const pickable = (await openScreen('')).pickableTargets;
		expect(pickable.find((t) => t.id === target.account)?.groupLabel).toBe('Accounts');
		// The kinds a document is filed against from their own screen are not on
		// offer here: a list of every transaction is a list nobody can read.
		expect(pickable.some((t) => t.kind === 'transaction')).toBe(false);
		expect(pickable.some((t) => t.kind === 'tax_statement')).toBe(false);
	});
});

describe('a contextual add', () => {
	it('resolves a target by kind and id', async () => {
		const { targets } = (await openScreen(`?add=1&targetKind=account&targetId=${target.account}`))
			.prefill;
		expect(targets.map((t) => t.id)).toEqual([target.account]);
		expect(targets[0].name).toBe('Current account');
	});

	it('still understands the older personId and propertyId spellings', async () => {
		// Links to these are already out in the app — the property screen writes
		// one — so the aliases are kept and mapped onto the registry.
		const { targets } = (
			await openScreen(`?add=1&personId=${target.person}&propertyId=${target.property}`)
		).prefill;
		expect(targets.map((t) => t.kind).sort()).toEqual(['person', 'property']);
	});

	it('ignores an id that names nothing', async () => {
		// A hidden input built from an unresolved id would post the capture form
		// straight into a foreign key violation.
		const { targets } = (
			await openScreen(`?add=1&targetKind=person&targetId=${rowId('dlp-nobody')}`)
		).prefill;
		expect(targets).toEqual([]);
	});
});

describe('saving a document', () => {
	it('keeps the transaction a receipt evidences', async () => {
		const id = await seedDocument('Alza receipt', [target.transaction, target.person]);
		await save(id, await postedLinkIds(id));
		expect(await linkedTargets(id)).toEqual([target.transaction, target.person].sort());
	});

	it('keeps the statement a tax attachment belongs to', async () => {
		const id = await seedDocument('Mortgage interest certificate', [
			target.tax_statement,
			target.person
		]);
		await save(id, await postedLinkIds(id));
		expect(await linkedTargets(id)).toEqual([target.tax_statement, target.person].sort());
	});

	it('keeps the account a bank statement came from', async () => {
		// Not a brokerage account: a current account's statements are paper too.
		const id = await seedDocument('March statement', [target.account]);
		await save(id, await postedLinkIds(id));
		expect(await linkedTargets(id)).toEqual([target.account]);
	});

	it('removes only the person that was unticked', async () => {
		const id = await seedDocument('Household letter', [
			target.transaction,
			target.person,
			target.otherPerson
		]);
		const posted = (await postedLinkIds(id)).filter((linkId) => linkId !== target.otherPerson);
		await save(id, posted);
		expect(await linkedTargets(id)).toEqual([target.transaction, target.person].sort());
	});

	it('removes a link the form left out — that is the contract', async () => {
		// The form carries the whole set, so leaving one out is a decision. What
		// changed is that the form can now carry every kind, not that a save has
		// stopped removing things.
		const id = await seedDocument('Household letter', [target.person, target.property]);
		await save(id, []);
		expect(await linkedTargets(id)).toEqual([]);
	});

	it('leaves alone a link to something the screen cannot draw', async () => {
		// `document_link` points at `entity`, which has kinds that are not places
		// to file paper — another document among them. No chip can be drawn for
		// one, so it is never on the form; the diff must not read that silence as
		// a removal. Same failure as the receipt's transaction, different key.
		const other = rowId('dlp-other-doc');
		await makeDocument(testDb, {
			id: other,
			name: 'Something else',
			shelfKey: 'inventory',
			type: 'other',
			addedOn: '2026-01-01'
		});
		const id = await seedDocument('Household letter', [target.person, other]);
		await save(id, await postedLinkIds(id));
		expect(await linkedTargets(id)).toEqual([target.person, other].sort());
	});

	it('adds a link the form gained', async () => {
		const id = await seedDocument('Household letter', [target.person]);
		await save(id, [target.person, target.property]);
		expect(await linkedTargets(id)).toEqual([target.person, target.property].sort());
	});
});
