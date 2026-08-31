// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { ENTITY_KINDS } from '$lib/enums';
import { displayCurrency } from '$lib/money';
import {
	document,
	documentLink,
	subject,
	tagLink,
	taxStatement,
	tenancy
} from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { upsertTag } from '$lib/server/tags';
import {
	attachDocument,
	candidateDocuments,
	candidateDocumentsFor,
	detachDocument,
	documentsAbout,
	documentTargetSpec,
	DOCUMENT_TARGET_KINDS,
	loadPickableTargets,
	loadTargetNames
} from '$lib/server/documents/targets';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import {
	makeAccount,
	makeContact,
	makeDocument,
	makeLoan,
	makePerson,
	makeProperty,
	makeTransaction
} from './fixtures';

/**
 * The one place that knows what a document can be filed against.
 *
 * Five screens used to carry their own four-kind list, so a kind added to the
 * database reached whichever of them somebody remembered. What is asserted here
 * is therefore coverage first — the registry against `ENTITY_KINDS` — and then
 * that every kind in it can actually name a row, because a registry entry whose
 * name expression does not run is the same outage as a missing entry.
 *
 * The read rule is not re-tested from first principles (`archive-scope` and
 * `document-visibility` hold the truth tables); what is tested here is that
 * `documentsAbout` carries BOTH predicates rather than either.
 */
let harness: Harness;
let testDb: TestDb;

const asAdmin = { id: rowId('dt-admin'), role: 'admin' } as const;
const asMember = { id: rowId('dt-member'), role: 'member' } as const;

/** One row of every kind, so a name expression is exercised against real data. */
const target = {
	person: rowId('dt-person'),
	property: rowId('dt-property'),
	tenancy: rowId('dt-tenancy'),
	account: rowId('dt-account'),
	loan: rowId('dt-loan'),
	contact: rowId('dt-contact'),
	subject: rowId('dt-subject'),
	transaction: rowId('dt-transaction'),
	tax_statement: rowId('dt-tax-statement')
} as const;

const archivedSubject = rowId('dt-subject-archived');

beforeAll(async () => {
	harness = await startPostgres('document-targets', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;

	await makePerson(testDb, { id: target.person, name: 'Jana Nováková', initials: 'JN' });
	await makeProperty(testDb, { id: target.property, name: 'Vinohrady flat', kind: 'lived' });
	await testDb
		.insert(tenancy)
		.values({ id: target.tenancy, propertyId: target.property, tenantName: 'Petr Nájemník' });
	// A current account, deliberately: the name expression covers every kind,
	// where the Documents screen used to offer brokerage accounts only.
	await makeAccount(testDb, {
		id: target.account,
		name: 'Current account',
		bank: 'other',
		kind: 'current',
		currency: 'CZK'
	});
	await makeLoan(testDb, {
		id: target.loan,
		name: 'Flat mortgage',
		principalMinor: 1_000_000n,
		owedMinor: 900_000n
	});
	await makeContact(testDb, { id: target.contact, name: 'Plumber' });
	await testDb.insert(subject).values({ id: target.subject, name: 'The car' });
	await testDb
		.insert(subject)
		.values({ id: archivedSubject, name: 'The old car', archivedAt: new Date() });
	await makeTransaction(testDb, {
		id: target.transaction,
		accountId: target.account,
		bookedOn: '2026-03-04',
		amountMinor: -123_450n,
		currency: 'CZK',
		counterparty: 'Alza',
		dedupFingerprint: 'dt-transaction'
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
});

beforeEach(async () => {
	// Documents only: the world above is what the registry names, and rebuilding
	// it per test would say nothing extra.
	await harness.sql`delete from document`;
});

interface SeedOptions {
	name: string;
	sensitivity?: 'normal' | 'restricted';
	links?: string[];
	tags?: string[];
}

async function seedDocument(options: SeedOptions): Promise<string> {
	const id = rowId(`dt-doc-${options.name}`);
	await makeDocument(testDb, {
		id,
		name: options.name,
		shelfKey: 'household',
		type: 'other',
		sensitivity: options.sensitivity ?? 'normal',
		storedName: `${id}.pdf`,
		ext: 'PDF',
		addedOn: '2026-01-01'
	});
	for (const targetId of options.links ?? []) {
		await testDb.insert(documentLink).values({ documentId: id, targetId });
	}
	for (const name of options.tags ?? []) {
		const tag = await upsertTag(name, testDb);
		await testDb.insert(tagLink).values({ tagId: tag.id, targetId: id });
	}
	return id;
}

async function linkedDocumentIds(targetId: string): Promise<string[]> {
	const rows = await testDb
		.select({ id: documentLink.documentId })
		.from(documentLink)
		.where(eq(documentLink.targetId, targetId));
	return rows.map((r) => r.id);
}

describe('the registry', () => {
	it('covers every entity kind a document can be filed against', async () => {
		// The three exceptions are not omissions: a document is not filed against
		// another document, a tag is a link of its own, and a split's paper hangs
		// on the transaction it belongs to.
		const notTargets = ['document', 'tag', 'transaction_split'];
		const expected = ENTITY_KINDS.filter((kind) => !notTargets.includes(kind)).sort();
		expect([...DOCUMENT_TARGET_KINDS].sort()).toEqual(expected);
	});

	it('registers nothing that is not an entity kind', async () => {
		for (const kind of DOCUMENT_TARGET_KINDS) {
			expect(ENTITY_KINDS, `${kind} is not an entity kind`).toContain(kind);
		}
	});

	it('says which kinds the document side may pick, and what to call each group', async () => {
		const pickable = DOCUMENT_TARGET_KINDS.filter((k) => documentTargetSpec(k).pickable);
		expect(pickable).toEqual([
			'person',
			'property',
			'tenancy',
			'account',
			'loan',
			'contact',
			'subject'
		]);
		// Transactions and tax statements are linked from their own screens, so
		// the capture dialog must not offer them.
		expect(documentTargetSpec('transaction').pickable).toBe(false);
		expect(documentTargetSpec('tax_statement').pickable).toBe(false);

		expect(DOCUMENT_TARGET_KINDS.map((k) => documentTargetSpec(k).groupLabel)).toEqual([
			'People',
			'Property',
			'Tenancies',
			'Accounts',
			'Loans',
			'Contacts',
			'Subjects',
			'Transactions',
			'Tax statements'
		]);
	});
});

describe('naming a row of every kind', () => {
	it('names one row of every registered kind', async () => {
		const names = await loadTargetNames(testDb);
		expect([...names.keys()].sort()).toEqual([...DOCUMENT_TARGET_KINDS].sort());

		for (const kind of DOCUMENT_TARGET_KINDS) {
			const row = names.get(kind)?.get(target[kind]);
			expect(row, `${kind} named nothing`).toBeDefined();
			expect(row?.kind).toBe(kind);
			expect(row?.name.trim(), `${kind} has an empty name`).not.toBe('');
		}

		expect(names.get('person')?.get(target.person)?.name).toBe('Jana Nováková');
		expect(names.get('property')?.get(target.property)?.name).toBe('Vinohrady flat');
		expect(names.get('account')?.get(target.account)?.name).toBe('Current account');
		expect(names.get('loan')?.get(target.loan)?.name).toBe('Flat mortgage');
		expect(names.get('contact')?.get(target.contact)?.name).toBe('Plumber');
		expect(names.get('subject')?.get(target.subject)?.name).toBe('The car');
	});

	it('names only the rows it was asked for', async () => {
		// The Documents screen needs names for the handful of records its links
		// point at, not for the ledger. Unfiltered, this materialised every
		// transaction the household has — and formatted each amount in JS — to
		// label the two or three on screen.
		const names = await loadTargetNames(testDb, [target.subject, target.transaction]);
		expect(names.get('subject')?.get(target.subject)?.name).toBe('The car');
		// Same kind, not asked for: the filter is per row, not per kind.
		expect(names.get('subject')?.get(archivedSubject)).toBeUndefined();
		expect(names.get('transaction')?.get(target.transaction)).toBeDefined();
		// A kind with nothing asked of it still has its map, and it is empty.
		expect([...names.keys()].sort()).toEqual([...DOCUMENT_TARGET_KINDS].sort());
		expect(names.get('person')?.size).toBe(0);
		expect(names.get('account')?.size).toBe(0);
	});

	it('asks for nothing when nothing was asked of it', async () => {
		// The Tags view draws no list, so no name is needed. An empty set means
		// no query at all rather than nine unbounded ones.
		const names = await loadTargetNames(testDb, []);
		expect([...names.keys()].sort()).toEqual([...DOCUMENT_TARGET_KINDS].sort());
		expect([...names.values()].every((byId) => byId.size === 0)).toBe(true);
	});

	it('still names everything when no filter is given', async () => {
		// `loadPickableTargets` and any caller that wants the whole list keeps
		// working: the filter is an argument, not a new default.
		const names = await loadTargetNames(testDb);
		expect(names.get('subject')?.get(archivedSubject)).toBeDefined();
		expect(names.get('subject')?.get(target.subject)).toBeDefined();
	});

	it('names a tenancy by its property and its tenant', async () => {
		// "Petr Nájemník" alone says nothing about which flat, and there may be
		// two tenancies of the same flat over time.
		const names = await loadTargetNames(testDb);
		expect(names.get('tenancy')?.get(target.tenancy)?.name).toBe('Vinohrady flat · Petr Nájemník');
	});

	it('names a transaction by counterparty and date, with its amount beside it', async () => {
		const names = await loadTargetNames(testDb);
		const row = names.get('transaction')?.get(target.transaction);
		expect(row?.name).toContain('Alza');
		expect(row?.name).toContain('2026-03-04');
		// The amount is formatted through the currency's own minor units, so the
		// separators are whatever `formatMinor` writes.
		expect(row?.meta?.replace(/\s/g, '')).toContain('1234.50');
		expect(row?.meta).toContain(displayCurrency('CZK'));
	});

	it('names a tax statement by year and country, with the filer beside it', async () => {
		const names = await loadTargetNames(testDb);
		const row = names.get('tax_statement')?.get(target.tax_statement);
		expect(row?.name).toBe('2025 Czechia');
		expect(row?.meta).toBe('Jana Nováková');
	});

	it('marks an archived subject as archived, and nothing else', async () => {
		const names = await loadTargetNames(testDb);
		expect(names.get('subject')?.get(archivedSubject)?.archived).toBe(true);
		expect(names.get('subject')?.get(target.subject)?.archived).toBe(false);
		expect(names.get('person')?.get(target.person)?.archived).toBe(false);
	});

	it('offers only the pickable kinds to a picker, in group order', async () => {
		const rows = await loadPickableTargets(testDb);
		const kinds = [...new Set(rows.map((r) => r.kind))];
		expect(kinds).toEqual([
			'person',
			'property',
			'tenancy',
			'account',
			'loan',
			'contact',
			'subject'
		]);
		expect(rows.some((r) => r.id === target.transaction)).toBe(false);
		expect(rows.some((r) => r.id === target.tax_statement)).toBe(false);
		// The archived car is still offered — archiving demotes its paper, not the
		// subject itself — but it says so, so a picker can mark it.
		expect(rows.find((r) => r.id === archivedSubject)?.archived).toBe(true);
	});
});

describe('the documents about a record', () => {
	it('returns what a card needs, in name order', async () => {
		await seedDocument({ name: 'Passport', links: [target.person], tags: ['identity'] });
		await seedDocument({ name: 'Birth certificate', links: [target.person] });

		const docs = await documentsAbout(target.person, asAdmin, testDb);
		expect(docs.map((d) => d.name)).toEqual(['Birth certificate', 'Passport']);

		const passport = docs.find((d) => d.name === 'Passport');
		expect(passport?.ext).toBe('PDF');
		expect(passport?.type).toBe('other');
		expect(passport?.shelfKey).toBe('household');
		expect(passport?.shelfLabel).toBeTruthy();
		expect(passport?.storedName).toBe(`${passport?.id}.pdf`);
		expect(passport?.addedOn).toBe('2026-01-01');
		expect(passport?.expiresOn).toBeNull();
		expect(passport?.expiryVerb).toBe('expires');
		expect(passport?.sensitivity).toBe('normal');
		expect(passport?.tags).toEqual(['identity']);
		expect(docs.find((d) => d.name === 'Birth certificate')?.tags).toEqual([]);
	});

	it('hides a restricted document from a member and shows it to an admin', async () => {
		await seedDocument({ name: 'Passport', links: [target.person] });
		await seedDocument({
			name: 'Divorce papers',
			sensitivity: 'restricted',
			links: [target.person]
		});

		const asSeenByMember = await documentsAbout(target.person, asMember, testDb);
		expect(asSeenByMember.map((d) => d.name)).toEqual(['Passport']);

		const asSeenByAdmin = await documentsAbout(target.person, asAdmin, testDb);
		expect(asSeenByAdmin.map((d) => d.name)).toEqual(['Divorce papers', 'Passport']);
		// The admin's card needs this to draw the lock; a member never receives
		// the row at all, so the flag can never be the thing that hides it.
		expect(asSeenByAdmin.find((d) => d.name === 'Divorce papers')?.sensitivity).toBe('restricted');
	});

	it('treats a null actor as a member', async () => {
		await seedDocument({
			name: 'Divorce papers',
			sensitivity: 'restricted',
			links: [target.person]
		});
		expect(await documentsAbout(target.person, null, testDb)).toEqual([]);
	});

	it('leaves out paper whose only subject is archived, unless asked for it', async () => {
		await seedDocument({ name: 'Service book', links: [target.loan, archivedSubject] });
		await seedDocument({ name: 'Loan agreement', links: [target.loan] });

		const current = await documentsAbout(target.loan, asAdmin, testDb);
		expect(current.map((d) => d.name)).toEqual(['Loan agreement']);

		const everything = await documentsAbout(target.loan, asAdmin, testDb, {
			includeArchived: true
		});
		expect(everything.map((d) => d.name)).toEqual(['Loan agreement', 'Service book']);
	});

	it('keeps a document with an active subject beside the archived one', async () => {
		// The vacuous-all trap, from this side: one archived link must not hide a
		// document that also belongs to something current.
		await seedDocument({
			name: 'Insurance policy',
			links: [target.loan, archivedSubject, target.subject]
		});
		const docs = await documentsAbout(target.loan, asAdmin, testDb);
		expect(docs.map((d) => d.name)).toEqual(['Insurance policy']);
	});

	it('returns nothing for a record nothing is filed against', async () => {
		expect(await documentsAbout(target.contact, asAdmin, testDb)).toEqual([]);
	});

	it('breaks a name tie with the id, so the order does not depend on insertion order', async () => {
		// Two documents that happen to share a name. Inserted with the larger id
		// first, so a plan that just returns heap order would show it first too —
		// only an explicit id tiebreaker guarantees the ascending id order asserted
		// below regardless of how the rows happened to land on disk.
		const idHigh = '11111111-1111-5111-8111-111111111112';
		const idLow = '11111111-1111-5111-8111-111111111111';
		const shelfId = await shelfIdByKey('household', testDb);
		for (const id of [idHigh, idLow]) {
			await makeDocument(testDb, {
				id,
				name: 'Same name',
				shelfId,
				type: 'other',
				sensitivity: 'normal',
				storedName: `${id}.pdf`,
				ext: 'PDF',
				addedOn: '2026-01-01'
			});
			await testDb.insert(documentLink).values({ documentId: id, targetId: target.person });
		}

		const docs = await documentsAbout(target.person, asAdmin, testDb);
		expect(docs.map((d) => d.id)).toEqual([idLow, idHigh]);
	});

	it('returns nothing for a target of a kind nothing may be filed against, even if a stray link exists', async () => {
		// A document is an entity too, so its id is a valid foreign key value —
		// the registry, not the schema, is what says a document is not a place to
		// file paper against. `links` here inserts the row directly, the way a
		// stray `document_link` could exist without ever going through
		// `attachDocument`'s own check.
		const other = await seedDocument({ name: 'Passport' });
		await seedDocument({ name: 'Stray receipt', links: [other] });
		expect(await documentsAbout(other, asAdmin, testDb)).toEqual([]);
	});
});

describe('attaching a document to a record', () => {
	it('attaches a visible document, and says so once whatever the repetition', async () => {
		const id = await seedDocument({ name: 'Loan agreement' });
		expect(await attachDocument(target.loan, id, asMember, testDb)).toEqual({ ok: true });
		expect(await attachDocument(target.loan, id, asMember, testDb)).toEqual({ ok: true });
		expect(await linkedDocumentIds(target.loan)).toEqual([id]);
	});

	it('refuses a document the actor may not see, and does not say it exists', async () => {
		const id = await seedDocument({ name: 'Divorce papers', sensitivity: 'restricted' });
		const refused = await attachDocument(target.person, id, asMember, testDb);
		expect(refused).toEqual({ ok: false, status: 404, message: 'That document is not there.' });
		// The same answer a missing document gets, and no link written.
		expect(await linkedDocumentIds(target.person)).toEqual([]);

		expect(await attachDocument(target.person, id, asAdmin, testDb)).toEqual({ ok: true });
	});

	it('refuses a document that is not there at all, in the same words', async () => {
		const missing = rowId('dt-no-such-document');
		const refused = await attachDocument(target.person, missing, asAdmin, testDb);
		expect(refused).toEqual({ ok: false, status: 404, message: 'That document is not there.' });
	});

	it('refuses a record that is not there', async () => {
		const id = await seedDocument({ name: 'Loan agreement' });
		const refused = await attachDocument(rowId('dt-no-such-record'), id, asAdmin, testDb);
		expect(refused.ok).toBe(false);
		expect(refused).toMatchObject({ status: 404 });
	});

	it('refuses a record of a kind nothing may be filed against', async () => {
		// A document is an entity, so the foreign key would accept it. The registry
		// is what says a document is not a place to file paper.
		const id = await seedDocument({ name: 'Loan agreement' });
		const other = await seedDocument({ name: 'Passport' });
		const refused = await attachDocument(other, id, asAdmin, testDb);
		expect(refused.ok).toBe(false);
		expect(await linkedDocumentIds(other)).toEqual([]);
	});

	it('detaches the link and keeps the document', async () => {
		const id = await seedDocument({ name: 'Loan agreement', links: [target.loan, target.person] });
		expect(await detachDocument(target.loan, id, asAdmin, testDb)).toEqual({ ok: true });
		expect(await linkedDocumentIds(target.loan)).toEqual([]);
		// The paper belongs to the household, not to the row it hung on.
		expect(await linkedDocumentIds(target.person)).toEqual([id]);
		const [row] = await testDb.select().from(document).where(eq(document.id, id));
		expect(row).toBeDefined();
	});

	it('refuses to detach a document the actor may not see', async () => {
		const id = await seedDocument({
			name: 'Divorce papers',
			sensitivity: 'restricted',
			links: [target.person]
		});
		const refused = await detachDocument(target.person, id, asMember, testDb);
		expect(refused).toEqual({ ok: false, status: 404, message: 'That document is not there.' });
		expect(await linkedDocumentIds(target.person)).toEqual([id]);
	});

	it('refuses to detach from a record that is not there, like attaching does', async () => {
		const id = await seedDocument({ name: 'Loan agreement' });
		const refused = await detachDocument(rowId('dt-no-such-record'), id, asAdmin, testDb);
		expect(refused).toEqual({ ok: false, status: 404, message: 'That record is not there.' });
	});

	it('refuses to detach from a record of a kind nothing may be filed against, like attaching does', async () => {
		const target = await seedDocument({ name: 'Loan agreement' });
		// `links: [target]` inserts the row directly, the way a stray
		// `document_link` could exist without ever going through `attachDocument`.
		const other = await seedDocument({ name: 'Passport', links: [target] });
		const refused = await detachDocument(other, target, asAdmin, testDb);
		expect(refused).toEqual({ ok: false, status: 404, message: 'That record is not there.' });
		// The stray link is left alone — this refuses the call, it does not clean
		// up data on its way past.
		expect(await linkedDocumentIds(target)).toEqual([other]);
	});
});

describe('what is left to attach', () => {
	it('offers visible documents that are not linked yet', async () => {
		const linked = await seedDocument({ name: 'Loan agreement', links: [target.loan] });
		await seedDocument({ name: 'Amortisation letter' });
		await seedDocument({ name: 'Passport' });

		const candidates = await candidateDocuments(target.loan, asAdmin, testDb);
		expect(candidates.map((c) => c.name)).toEqual(['Amortisation letter', 'Passport']);
		expect(candidates.some((c) => c.id === linked)).toBe(false);
		expect(candidates[0]).toMatchObject({ ext: 'PDF' });
		expect(candidates[0].shelfLabel).toBeTruthy();
	});

	it('never offers a member a document they may not see', async () => {
		await seedDocument({ name: 'Divorce papers', sensitivity: 'restricted' });
		await seedDocument({ name: 'Loan agreement' });

		expect((await candidateDocuments(target.loan, asMember, testDb)).map((c) => c.name)).toEqual([
			'Loan agreement'
		]);
		expect((await candidateDocuments(target.loan, asAdmin, testDb)).map((c) => c.name)).toEqual([
			'Divorce papers',
			'Loan agreement'
		]);
	});

	it('leaves archived paper out of the offer', async () => {
		await seedDocument({ name: 'Service book', links: [archivedSubject] });
		await seedDocument({ name: 'Loan agreement' });
		expect((await candidateDocuments(target.loan, asAdmin, testDb)).map((c) => c.name)).toEqual([
			'Loan agreement'
		]);
	});

	it('offers nothing when everything visible is already attached', async () => {
		await seedDocument({ name: 'Loan agreement', links: [target.loan] });
		expect(await candidateDocuments(target.loan, asAdmin, testDb)).toEqual([]);
	});

	it('breaks a name tie with the id in the candidate list too', async () => {
		const idHigh = '22222222-2222-5222-8222-222222222222';
		const idLow = '22222222-2222-5222-8222-222222222221';
		const shelfId = await shelfIdByKey('household', testDb);
		for (const id of [idHigh, idLow]) {
			await makeDocument(testDb, {
				id,
				name: 'Same name',
				shelfId,
				type: 'other',
				sensitivity: 'normal',
				storedName: `${id}.pdf`,
				ext: 'PDF',
				addedOn: '2026-01-01'
			});
		}

		const candidates = await candidateDocuments(target.loan, asAdmin, testDb);
		expect(candidates.map((c) => c.id)).toEqual([idLow, idHigh]);
	});

	it('never offers a document as a place to file another document against', async () => {
		// Without the registry check, a document's own id passes every other test
		// this function runs (no links target it, so nothing looks "attached")
		// and the whole visible library comes back as though it were a real record.
		const other = await seedDocument({ name: 'Passport' });
		await seedDocument({ name: 'Loan agreement' });
		expect(await candidateDocuments(other, asAdmin, testDb)).toEqual([]);
	});
});

/**
 * The fix for a picker that fetched the whole visible library once PER RECORD:
 * a screen with N records now runs one document query and one `document_link`
 * query for however many targets it asks about, and does the per-target
 * subtraction in JS. `candidateDocuments(targetId, …)` is a thin wrapper over
 * this for the single-record screens (property, tenancy).
 */
describe('candidateDocumentsFor, batched across several records', () => {
	it("excludes each target's own links and includes what only the other has", async () => {
		const forLoan = await seedDocument({ name: 'Loan agreement', links: [target.loan] });
		const forContact = await seedDocument({ name: 'Business card', links: [target.contact] });
		const forNeither = await seedDocument({ name: 'Passport' });

		const byTarget = await candidateDocumentsFor([target.loan, target.contact], asAdmin, testDb);

		const loanCandidates = byTarget.get(target.loan)?.map((c) => c.id) ?? [];
		expect(loanCandidates).toContain(forContact);
		expect(loanCandidates).toContain(forNeither);
		expect(loanCandidates).not.toContain(forLoan);

		const contactCandidates = byTarget.get(target.contact)?.map((c) => c.id) ?? [];
		expect(contactCandidates).toContain(forLoan);
		expect(contactCandidates).toContain(forNeither);
		expect(contactCandidates).not.toContain(forContact);
	});

	it('agrees with the single-record wrapper it now sits behind', async () => {
		await seedDocument({ name: 'Amortisation letter' });
		await seedDocument({ name: 'Loan agreement', links: [target.loan] });

		const [single, batched] = await Promise.all([
			candidateDocuments(target.loan, asAdmin, testDb),
			candidateDocumentsFor([target.loan], asAdmin, testDb)
		]);
		expect(batched.get(target.loan)?.map((c) => c.id)).toEqual(single.map((c) => c.id));
	});

	it('never offers a member a restricted document through the batched path either', async () => {
		await seedDocument({ name: 'Divorce papers', sensitivity: 'restricted' });
		await seedDocument({ name: 'Loan agreement' });

		const byTarget = await candidateDocumentsFor([target.loan, target.contact], asMember, testDb);
		expect(byTarget.get(target.loan)?.map((c) => c.name)).toEqual(['Loan agreement']);
		expect(byTarget.get(target.contact)?.map((c) => c.name)).toEqual(['Loan agreement']);
	});

	it('leaves archived paper out of every target it batches for', async () => {
		await seedDocument({ name: 'Service book', links: [archivedSubject] });
		await seedDocument({ name: 'Loan agreement' });

		const byTarget = await candidateDocumentsFor([target.loan, target.contact], asAdmin, testDb);
		expect(byTarget.get(target.loan)?.map((c) => c.name)).toEqual(['Loan agreement']);
		expect(byTarget.get(target.contact)?.map((c) => c.name)).toEqual(['Loan agreement']);
	});

	it('returns an empty map for an empty list of targets, with no query at all', async () => {
		expect(await candidateDocumentsFor([], asAdmin, testDb)).toEqual(new Map());
	});

	it('excludes a batched target that is not a fileable kind, without affecting the others', async () => {
		const other = await seedDocument({ name: 'Passport' });
		const forLoan = await seedDocument({ name: 'Loan agreement' });

		const byTarget = await candidateDocumentsFor([target.loan, other], asAdmin, testDb);
		// `other` (the Passport document) is a perfectly normal candidate to
		// attach to the loan; what is rejected is offering candidates AS IF
		// `other` were itself a valid place to file paper.
		expect(byTarget.get(target.loan)?.map((c) => c.id)).toEqual(
			expect.arrayContaining([forLoan, other])
		);
		expect(byTarget.get(other)).toEqual([]);
	});
});

describe('the name expressions the search union is built from', () => {
	it('gives every kind a `select id, name` the union can use', async () => {
		// Tier B unions these. A fragment that does not run, or that returns a
		// column under another name, breaks search for every kind at once.
		for (const kind of DOCUMENT_TARGET_KINDS) {
			const rows = (await testDb.execute(documentTargetSpec(kind).nameSql)) as unknown as {
				id: string;
				name: string;
			}[];
			expect(rows.length, `${kind} returned no rows`).toBeGreaterThan(0);
			expect(Object.keys(rows[0]).sort()).toEqual(['id', 'name']);
		}
	});
});
