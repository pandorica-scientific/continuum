// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { rowId } from '../row-id';
import {
	documentLink,
	salaryEntry,
	tagLink,
	taxStatement,
	transactionSplit
} from '$lib/server/db/schema';

import { buildBriefing } from '$lib/server/briefing';
import { buildIcs, generateEvents } from '$lib/server/calendar';
import { loadSalaryHistory } from '$lib/server/salary';
import { loadStatements } from '$lib/server/tax';
import { loadTransactionDocuments } from '$lib/server/transactions/documents';
import { upsertTag } from '$lib/server/tags';
import { loadTagsScreen } from '$lib/server/tags/screen';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import {
	makeAccount,
	makeDocument,
	makeLoan,
	makePerson,
	makeProperty,
	makeTransaction
} from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

/**
 * Restricted paper reaches no briefing, no calendar and no feed.
 *
 * The calendar rule is absolute rather than role-dependent, and that is not an
 * oversight: a generated event syncs to iCloud, where there is no session and
 * no role to filter by. Filtering at generation time by who happens to be
 * looking would be false safety. The briefing DOES filter per viewer, because
 * the briefing is rendered inside the session boundary.
 */
let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

const asAdmin = { id: 'a', role: 'admin' } as const;
const asMember = { id: 'm', role: 'member' } as const;

/** Far enough out to be a briefing item, close enough to be in range. */
const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('restricted-read-paths', { max: 1 });
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
	// Every fixture below is built inside the test that needs it, so the world
	// starts empty each time. A count is one of the things these tests assert
	// on, and a leftover row from the test before would move it.
	await harness.sql`truncate account, document, person, property, tag cascade`;
});

async function seedDocument(options: {
	name: string;
	sensitivity: 'normal' | 'restricted';
	expiresOn?: string;
	/** The module read paths select by type, so a fixture has to be able to say. */
	type?: 'other' | 'payslip' | 'tax_document';
	/** The stored file, which is what a paperclip on a screen actually links to. */
	storedName?: string;
}) {
	const id = uuidv7();
	await makeDocument(testDb, {
		id,
		name: options.name,
		shelfKey: 'household',
		type: options.type ?? 'other',
		sensitivity: options.sensitivity,
		storedName: options.storedName ?? null,
		ext: 'PDF',
		expiresOn: options.expiresOn ?? null,
		expiryVerb: 'expires',
		addedOn: '2026-01-01'
	});
	return id;
}

describe('the briefing', () => {
	it("leaves a restricted document out of a member's briefing", async () => {
		await seedDocument({ name: 'Divorce papers', sensitivity: 'restricted', expiresOn: soon });
		const { items } = await buildBriefing(asMember);
		expect(items.map((i) => i.title).join(' ')).not.toMatch(/Divorce/);
	});

	it('shows it to an admin', async () => {
		await seedDocument({ name: 'Divorce papers', sensitivity: 'restricted', expiresOn: soon });
		const { items } = await buildBriefing(asAdmin);
		expect(items.map((i) => i.title).join(' ')).toMatch(/Divorce/);
	});

	it('shows a normal document to both', async () => {
		await seedDocument({ name: 'Passport', sensitivity: 'normal', expiresOn: soon });
		for (const actor of [asMember, asAdmin]) {
			const { items } = await buildBriefing(actor);
			expect(items.map((i) => i.title).join(' ')).toMatch(/Passport/);
		}
	});
});

describe('calendar generation', () => {
	it('generates no event for a restricted document, for anyone', async () => {
		// Not a role filter: a synced event lands on a device outside the session
		// boundary entirely, where there is no role to filter by.
		await seedDocument({ name: 'Divorce papers', sensitivity: 'restricted', expiresOn: soon });
		const events = await generateEvents('2020-01-01', '2099-01-01', testDb);
		expect(events.some((e) => e.binding?.table === 'document')).toBe(false);
	});

	it('still generates one for a normal document', async () => {
		await seedDocument({ name: 'Passport', sensitivity: 'normal', expiresOn: soon });
		const events = await generateEvents('2020-01-01', '2099-01-01', testDb);
		expect(events.some((e) => e.binding?.table === 'document')).toBe(true);
	});

	it('keeps restricted paper out of the published feed', async () => {
		// The feed reads generated events, so it inherits the rule — which is
		// worth proving rather than assuming, because the feed is the one door
		// with no session behind it at all.
		await seedDocument({ name: 'Divorce papers', sensitivity: 'restricted', expiresOn: soon });
		await seedDocument({ name: 'Passport', sensitivity: 'normal', expiresOn: soon });
		const ics = await buildIcs();
		expect(ics).not.toMatch(/Divorce/);
		expect(ics).toMatch(/Passport/);
	});
});

// ---------------------------------------------------------------------------
// The module read paths.
//
// D2 is "only the paper is hidden": on every screen a member reaches, the
// restricted document's row, its name and its paperclip are simply not there,
// while the module's own figures — a salary entry's gross and net, a tag's
// total — are untouched. Each describe below is one of the screens that used
// to answer the question for itself.

const PERSON = rowId('restricted-person');
const PROPERTY = rowId('restricted-property');
const ACCOUNT = rowId('restricted-account');
const BROKERAGE_ACCOUNT = rowId('restricted-brokerage-account');
const TXN = rowId('restricted-txn');
const STATEMENT = rowId('restricted-statement');

/** Face value: conversion is exercised elsewhere and 1:1 keeps figures readable. */
const same = (amount: bigint) => amount;

/** A session as a route loader sees it, from the actor these tests are written in. */
function localsFor(actor: { id: string; role: 'admin' | 'member' }) {
	return {
		person: {
			// A real uuid: the loader looks the person up by id, and 'a' is not one.
			id: rowId(`restricted-${actor.role}`),
			name: actor.role,
			initials: actor.role[0].toUpperCase(),
			role: actor.role,
			theme: null
		}
	};
}

async function seedPerson() {
	await makePerson(testDb, {
		id: PERSON,
		name: 'Robert',
		initials: 'R',
		role: 'admin',
		birthYear: 1990
	});
}

describe('salary history', () => {
	/** One month, evidenced by one payslip of the given sensitivity. */
	async function seedMonth(sensitivity: 'normal' | 'restricted') {
		await seedPerson();
		const documentId = await seedDocument({
			name: 'Payslip 2026-08 · Robert',
			sensitivity,
			type: 'payslip',
			storedName: 'slip-aug.pdf'
		});
		await testDb.insert(documentLink).values({ documentId, targetId: PERSON });
		await testDb.insert(salaryEntry).values({
			id: rowId('restricted-salary-entry'),
			personId: PERSON,
			periodMonth: '2026-08',
			grossMinor: 10000000n,
			netMinor: 7140000n,
			bonusMinor: null,
			currency: 'CZK',
			source: 'payslip',
			documentId
		});
		return documentId;
	}

	it('keeps the month and its figures for a member, and takes only the paperclip', async () => {
		// The whole of D2 in one assertion: what the household earned in August is
		// not a secret, and hiding the row to hide the slip would have deleted a
		// month from the year totals.
		await seedMonth('restricted');
		const [robert] = await loadSalaryHistory('CZK', same, asMember, testDb);

		expect(robert.payslips).toHaveLength(1);
		expect(robert.payslips[0].grossMinor).toBe(10000000n);
		expect(robert.payslips[0].netMinor).toBe(7140000n);
		expect(robert.years[0].grossTotalMinor).toBe(10000000n);
		// No file, and no document id either: an id in the payload is still the
		// household being told the document is there.
		expect(robert.payslips[0].file).toBeNull();
		expect(robert.payslips[0].documentId).toBeNull();
	});

	it('gives an admin the file behind the same month', async () => {
		const documentId = await seedMonth('restricted');
		const [robert] = await loadSalaryHistory('CZK', same, asAdmin, testDb);

		expect(robert.payslips[0].file).toBe('slip-aug.pdf');
		expect(robert.payslips[0].documentId).toBe(documentId);
	});

	it('gives both the file behind a normal payslip', async () => {
		const documentId = await seedMonth('normal');
		for (const actor of [asMember, asAdmin]) {
			const [robert] = await loadSalaryHistory('CZK', same, actor, testDb);
			expect(robert.payslips[0].file).toBe('slip-aug.pdf');
			expect(robert.payslips[0].documentId).toBe(documentId);
		}
	});
});

describe('tax attachments', () => {
	async function seedStatement(sensitivity: 'normal' | 'restricted') {
		await seedPerson();
		await testDb.insert(taxStatement).values({
			id: STATEMENT,
			personId: PERSON,
			year: 2025,
			country: 'CZ',
			currency: 'CZK',
			grossIncomeMinor: 100000000n,
			taxPaidMinor: 15000000n,
			note: null
		});
		const documentId = await seedDocument({
			name: '2025 CZ tax statement',
			sensitivity,
			type: 'tax_document',
			storedName: 'tax-2025.pdf'
		});
		await testDb.insert(documentLink).values({ documentId, targetId: STATEMENT });
		return documentId;
	}

	it('leaves a restricted attachment off a member’s statement', async () => {
		await seedStatement('restricted');
		const [row] = await loadStatements(asMember, testDb);
		// The statement itself stays: what was declared and what was paid are the
		// module's own figures, and D2 hides the paper, not the record.
		expect(row.year).toBe(2025);
		expect(row.grossIncomeMinor).toBe(100000000n);
		expect(row.attachments).toEqual([]);
	});

	it('shows it to an admin', async () => {
		await seedStatement('restricted');
		const [row] = await loadStatements(asAdmin, testDb);
		expect(row.attachments.map((a) => a.name)).toEqual(['2025 CZ tax statement']);
	});

	it('shows a normal attachment to both', async () => {
		await seedStatement('normal');
		for (const actor of [asMember, asAdmin]) {
			const [row] = await loadStatements(actor, testDb);
			expect(row.attachments.map((a) => a.name)).toEqual(['2025 CZ tax statement']);
		}
	});
});

describe('the tax document picker', () => {
	/** The Tax screen's own loader, which is where the picker's list is built. */
	async function loadTax(actor: { id: string; role: 'admin' | 'member' }) {
		const { load } = await import('../../src/routes/(app)/tax/+page.server');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (await (load as any)({
			url: new URL('http://localhost/tax'),
			locals: localsFor(actor)
		})) as { taxDocs: { id: string; name: string }[] };
	}

	it('does not offer a member a restricted document to link', async () => {
		// Offering it would be the leak twice over: the name is in the list, and
		// picking it would file paper the person cannot open.
		await seedDocument({
			name: 'Divorce settlement',
			sensitivity: 'restricted',
			type: 'tax_document'
		});
		const { taxDocs } = await loadTax(asMember);
		expect(taxDocs.map((d) => d.name)).toEqual([]);
	});

	it('offers it to an admin', async () => {
		await seedDocument({
			name: 'Divorce settlement',
			sensitivity: 'restricted',
			type: 'tax_document'
		});
		const { taxDocs } = await loadTax(asAdmin);
		expect(taxDocs.map((d) => d.name)).toEqual(['Divorce settlement']);
	});

	it('offers a normal document to both', async () => {
		await seedDocument({
			name: '2025 CZ tax statement',
			sensitivity: 'normal',
			type: 'tax_document'
		});
		for (const actor of [asMember, asAdmin]) {
			const { taxDocs } = await loadTax(actor);
			expect(taxDocs.map((d) => d.name)).toEqual(['2025 CZ tax statement']);
		}
	});
});

describe('the property page', () => {
	async function seedFlatDocument(sensitivity: 'normal' | 'restricted') {
		await makeProperty(testDb, { id: PROPERTY, name: 'Flat', kind: 'lived', currency: 'CZK' });
		const documentId = await seedDocument({
			name: 'Divorce settlement',
			sensitivity,
			storedName: 'settlement.pdf'
		});
		await testDb.insert(documentLink).values({ documentId, targetId: PROPERTY });
		return documentId;
	}

	async function loadProperty(actor: { id: string; role: 'admin' | 'member' }) {
		const { load } = await import('../../src/routes/(app)/property/+page.server');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (await (load as any)({
			url: new URL('http://localhost/property'),
			locals: localsFor(actor)
		})) as {
			detail: { documents: { name: string }[] } | null;
			knownTags: { id: string; name: string }[];
		};
	}

	it('leaves a restricted document off a member’s property card', async () => {
		await seedFlatDocument('restricted');
		const { detail } = await loadProperty(asMember);
		expect(detail?.documents.map((d) => d.name)).toEqual([]);
	});

	it('shows it to an admin', async () => {
		await seedFlatDocument('restricted');
		const { detail } = await loadProperty(asAdmin);
		expect(detail?.documents.map((d) => d.name)).toEqual(['Divorce settlement']);
	});

	it('shows a normal document to both', async () => {
		await seedFlatDocument('normal');
		for (const actor of [asMember, asAdmin]) {
			const { detail } = await loadProperty(actor);
			expect(detail?.documents.map((d) => d.name)).toEqual(['Divorce settlement']);
		}
	});

	// The tag field on a flat used to offer no suggestions at all (`known={[]}`
	// in the markup), unlike the same field on the Loans screen — typing
	// "Renovation" on one screen and "renovation" on the other would have made
	// two tags out of one project.
	it('offers the tag field every known tag, the way the Loans screen does', async () => {
		await makeProperty(testDb, { id: PROPERTY, name: 'Flat', kind: 'lived', currency: 'CZK' });
		await upsertTag('Renovation', testDb);
		const { knownTags } = await loadProperty(asMember);
		expect(knownTags.map((t) => t.name)).toContain('Renovation');
	});
});

describe('the investments page', () => {
	// The sole-account path — decision D8: a report is filed against the one
	// brokerage account when there is exactly one, and read back through the
	// same `documentsAbout` predicate every other card in the app uses.
	async function seedReport(sensitivity: 'normal' | 'restricted') {
		await makeAccount(testDb, {
			id: BROKERAGE_ACCOUNT,
			name: 'XTB',
			bank: 'other',
			kind: 'brokerage',
			currency: 'EUR'
		});
		const documentId = await seedDocument({
			name: 'XTB report 2026-07-08',
			sensitivity,
			type: 'other',
			storedName: 'xtb-2026-07-08.xlsx'
		});
		await testDb.insert(documentLink).values({ documentId, targetId: BROKERAGE_ACCOUNT });
		return documentId;
	}

	async function loadInvestments(actor: { id: string; role: 'admin' | 'member' }) {
		const { load } = await import('../../src/routes/(app)/investments/+page.server');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (await (load as any)({
			url: new URL('http://localhost/investments'),
			locals: localsFor(actor)
		})) as { reports: { name: string }[] };
	}

	it('leaves a restricted report off a member’s Reports card', async () => {
		await seedReport('restricted');
		const { reports } = await loadInvestments(asMember);
		expect(reports.map((d) => d.name)).toEqual([]);
	});

	it('shows it to an admin', async () => {
		await seedReport('restricted');
		const { reports } = await loadInvestments(asAdmin);
		expect(reports.map((d) => d.name)).toEqual(['XTB report 2026-07-08']);
	});

	it('shows a normal report to both', async () => {
		await seedReport('normal');
		for (const actor of [asMember, asAdmin]) {
			const { reports } = await loadInvestments(actor);
			expect(reports.map((d) => d.name)).toEqual(['XTB report 2026-07-08']);
		}
	});
});

describe('transaction receipts', () => {
	async function seedReceipt(sensitivity: 'normal' | 'restricted') {
		await makeAccount(testDb, {
			id: ACCOUNT,
			name: 'Current',
			bank: 'fio',
			kind: 'current',
			currency: 'CZK'
		});
		await makeTransaction(testDb, {
			id: TXN,
			accountId: ACCOUNT,
			bookedOn: '2026-07-20',
			amountMinor: -45000n,
			currency: 'CZK',
			dedupFingerprint: 'restricted-txn'
		});
		const documentId = await seedDocument({
			name: 'Clinic invoice',
			sensitivity,
			storedName: 'invoice.pdf'
		});
		await testDb.insert(documentLink).values({ documentId, targetId: TXN });
		return documentId;
	}

	it('hangs no restricted receipt on a member’s row', async () => {
		await seedReceipt('restricted');
		const found = await loadTransactionDocuments([TXN], asMember, testDb);
		expect(found.get(TXN)).toBeUndefined();
	});

	it('hangs it on an admin’s row', async () => {
		await seedReceipt('restricted');
		const found = await loadTransactionDocuments([TXN], asAdmin, testDb);
		expect(found.get(TXN)?.map((d) => d.name)).toEqual(['Clinic invoice']);
	});

	it('hangs a normal receipt on both', async () => {
		await seedReceipt('normal');
		for (const actor of [asMember, asAdmin]) {
			const found = await loadTransactionDocuments([TXN], actor, testDb);
			expect(found.get(TXN)?.map((d) => d.name)).toEqual(['Clinic invoice']);
		}
	});
});

describe('the tags view', () => {
	/** One tag on two documents, one of them of the given sensitivity. */
	async function seedTagged(sensitivity: 'normal' | 'restricted') {
		const { id: tagId } = await upsertTag('renovation', testDb);
		const open = await seedDocument({ name: 'Builder quote', sensitivity: 'normal' });
		const closed = await seedDocument({ name: 'Divorce settlement', sensitivity });
		await testDb.insert(tagLink).values([
			{ tagId, targetId: open },
			{ tagId, targetId: closed }
		]);
		return tagId;
	}

	it('leaves a restricted document out of a member’s tag, count and all', async () => {
		await seedTagged('restricted');
		const { tags } = await loadTagsScreen(asMember);
		const [renovation] = tags;
		expect(renovation.documents.map((d) => d.name)).toEqual(['Builder quote']);
		// The count is the leak this assertion exists for: "2 tagged" beside one
		// document a person can open tells them the second one is there.
		expect(renovation.tagged).toBe(1);
	});

	it('shows it to an admin, and counts it', async () => {
		await seedTagged('restricted');
		const { tags } = await loadTagsScreen(asAdmin);
		const [renovation] = tags;
		expect(renovation.documents.map((d) => d.name).sort()).toEqual([
			'Builder quote',
			'Divorce settlement'
		]);
		expect(renovation.tagged).toBe(2);
	});

	it('counts two normal documents for both', async () => {
		await seedTagged('normal');
		for (const actor of [asMember, asAdmin]) {
			const { tags } = await loadTagsScreen(actor);
			expect(tags[0].documents).toHaveLength(2);
			expect(tags[0].tagged).toBe(2);
		}
	});

	// Loans were the one taggable kind the view never listed: `updateLoanTags`
	// on the Loans screen could tag one, and it would vanish from here as if the
	// tag had gone nowhere.
	it('lists a tagged loan alongside documents and properties', async () => {
		const { id: tagId } = await upsertTag('mortgage-project', testDb);
		const loanId = uuidv7();
		await makeLoan(testDb, {
			id: loanId,
			name: 'Family mortgage',
			principalMinor: 5_000_000n,
			owedMinor: 4_000_000n
		});
		await testDb.insert(tagLink).values({ tagId, targetId: loanId });

		const { tags } = await loadTagsScreen(asMember);
		const [tagged] = tags;
		expect(tagged.loans.map((l) => l.name)).toEqual(['Family mortgage']);
	});

	// The count used to come from a raw tag_link count, which included rows the
	// item list never showed (a whole tagged transaction, a tagged split) — so
	// "2 tagged" could sit over a list of one, or none. It has to equal exactly
	// what got listed: this document, this property and this loan, no more.
	it('counts exactly the documents, properties and loans it lists — no more, no less', async () => {
		const { id: tagId } = await upsertTag('big-project', testDb);
		const documentId = await seedDocument({ name: 'Plans', sensitivity: 'normal' });
		const propertyId = uuidv7();
		await makeProperty(testDb, {
			id: propertyId,
			name: 'Vinohrady flat',
			kind: 'lived'
		});
		const loanId = uuidv7();
		await makeLoan(testDb, {
			id: loanId,
			name: 'Renovation loan',
			principalMinor: 100_000n,
			owedMinor: 90_000n
		});
		await testDb.insert(tagLink).values([
			{ tagId, targetId: documentId },
			{ tagId, targetId: propertyId },
			{ tagId, targetId: loanId }
		]);

		const { tags } = await loadTagsScreen(asMember);
		const [tagged] = tags;
		expect(tagged.tagged).toBe(3);
		expect(tagged.documents.length + tagged.properties.length + tagged.loans.length).toBe(
			tagged.tagged
		);
	});

	// A tag can sit on one split line with no document, property or loan beside
	// it at all — a project that is only ever a slice of a bigger receipt. It
	// must not disappear from the count as if it had nothing left tagged.
	it('shows a tag applied only to a transaction split as a line count, not an empty row', async () => {
		const { id: tagId } = await upsertTag('split-only', testDb);
		const accountId = uuidv7();
		await makeAccount(testDb, {
			id: accountId,
			name: 'Current',
			bank: 'fio',
			kind: 'current',
			currency: 'CZK'
		});
		const txnId = uuidv7();
		await makeTransaction(testDb, {
			id: txnId,
			accountId,
			bookedOn: '2026-04-02',
			amountMinor: -1000n,
			currency: 'CZK',
			dedupFingerprint: 'split-only-fixture'
		});
		const splitId = uuidv7();
		await testDb.insert(transactionSplit).values({
			id: splitId,
			transactionId: txnId,
			amountMinor: -1000n,
			sort: 0
		});
		await testDb.insert(tagLink).values({ tagId, targetId: splitId });

		const { tags } = await loadTagsScreen(asMember);
		const [tagged] = tags;
		expect(tagged.tagged).toBe(0);
		expect(tagged.documents).toHaveLength(0);
		expect(tagged.properties).toHaveLength(0);
		expect(tagged.loans).toHaveLength(0);
		expect(tagged.splitLines).toBe(1);
	});

	// A tag applied only to a whole transaction (the ordinary path —
	// `setTransactionTags`/`updateTransactionTags`, exactly what the demo seed
	// uses) is a carrier the item list has no card for either. It used to
	// vanish from `tagged` entirely — 0 tagged, no chips, `splitLines` also 0 —
	// which read as if the tag were unused when the delete would in fact untag
	// this transaction.
	it('counts a tag applied only to a whole transaction as an unlisted carrier, not a vanished one', async () => {
		const { id: tagId } = await upsertTag('whole-txn', testDb);
		const accountId = uuidv7();
		await makeAccount(testDb, {
			id: accountId,
			name: 'Current',
			bank: 'fio',
			kind: 'current',
			currency: 'CZK'
		});
		const txnId = uuidv7();
		await makeTransaction(testDb, {
			id: txnId,
			accountId,
			bookedOn: '2026-04-02',
			amountMinor: -1000n,
			currency: 'CZK',
			dedupFingerprint: 'whole-txn-fixture'
		});
		await testDb.insert(tagLink).values({ tagId, targetId: txnId });

		const { tags } = await loadTagsScreen(asMember);
		const [tagged] = tags;
		expect(tagged.tagged).toBe(0);
		expect(tagged.transactions).toBe(1);
		expect(tagged.documents).toHaveLength(0);
		expect(tagged.properties).toHaveLength(0);
		expect(tagged.loans).toHaveLength(0);
		expect(tagged.splitLines).toBe(0);
		// The delete-reach total — every carrier the delete removes, not just
		// the listed ones — is what `TagsPanel`'s confirmation is built from.
		expect(tagged.tagged + tagged.transactions + tagged.splitLines).toBe(1);
	});

	// A realistic mix: one listed document, two whole-transaction tags and one
	// split tag. The headline stays "listed items only"; the two unlisted kinds
	// are reported so the delete total (what a member is told before they
	// commit to it) accounts for every row the delete actually removes.
	it('counts documents, whole transactions and split lines separately, and totals all of them for the delete reach', async () => {
		const { id: tagId } = await upsertTag('mixed-carriers', testDb);
		const documentId = await seedDocument({ name: 'Plans', sensitivity: 'normal' });
		const accountId = uuidv7();
		await makeAccount(testDb, {
			id: accountId,
			name: 'Current',
			bank: 'fio',
			kind: 'current',
			currency: 'CZK'
		});
		const [txn1, txn2, splitParent] = [uuidv7(), uuidv7(), uuidv7()];
		await makeTransaction(testDb, {
			id: txn1,
			accountId,
			bookedOn: '2026-04-02',
			amountMinor: -1000n,
			currency: 'CZK',
			dedupFingerprint: 'mixed-txn-1'
		});
		await makeTransaction(testDb, {
			id: txn2,
			accountId,
			bookedOn: '2026-04-03',
			amountMinor: -2000n,
			currency: 'CZK',
			dedupFingerprint: 'mixed-txn-2'
		});
		await makeTransaction(testDb, {
			id: splitParent,
			accountId,
			bookedOn: '2026-04-04',
			amountMinor: -500n,
			currency: 'CZK',
			dedupFingerprint: 'mixed-split-parent'
		});
		const splitId = uuidv7();
		await testDb.insert(transactionSplit).values({
			id: splitId,
			transactionId: splitParent,
			amountMinor: -500n,
			sort: 0
		});
		await testDb.insert(tagLink).values([
			{ tagId, targetId: documentId },
			{ tagId, targetId: txn1 },
			{ tagId, targetId: txn2 },
			{ tagId, targetId: splitId }
		]);

		const { tags } = await loadTagsScreen(asMember);
		const [tagged] = tags;
		expect(tagged.tagged).toBe(1);
		expect(tagged.transactions).toBe(2);
		expect(tagged.splitLines).toBe(1);
		expect(tagged.tagged + tagged.transactions + tagged.splitLines).toBe(4);
	});
});
