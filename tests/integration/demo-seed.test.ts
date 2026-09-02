// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Decision D10: the demo household files real paper.
 *
 * Every document the demo seeded used to be metadata only — a name, a shelf
 * and nothing behind it — so the viewer, search-by-contents, receipts,
 * restricted documents and the archived-subject rules all rendered empty on
 * the one instance built to show them. This suite is the contract for the
 * seed that fixes that: every document has bytes on the volume, a hash OF
 * those bytes, links to whatever it is about, an extraction job waiting, and
 * not one value that came from the machine the demo happens to run on.
 *
 * The seed reads the module-level `db` singleton and the upload directory out
 * of `$env/dynamic/private`, so both are pointed at this harness the way
 * `deadlines` and `archive-scope` do it — and the same mock records WHICH
 * environment variables the seed touched, which is how "fictional data only"
 * is proved rather than asserted.
 */
import { mkdtempSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
	account,
	document,
	documentIdentity,
	documentLink,
	entity,
	importFile,
	job,
	person,
	property,
	salaryEntry,
	shelf,
	subject,
	tagLink,
	tenancy,
	transaction
} from '$lib/server/db/schema';
import { SUGGESTED_LAYOUT } from '$lib/overview/panels';
import { seedBanks, seedCategories } from '$lib/server/categorize';
import { generateEvents } from '$lib/server/calendar';
import { listSubjects } from '$lib/server/documents/subjects';
import { documentsAbout } from '$lib/server/documents/targets';
import { listOrganisations } from '$lib/server/organisations/mutations';
import { engagementSpan, engagementsFor } from '$lib/server/organisations/engagements';
import { visibleDocumentPredicate } from '$lib/server/documents/visibility';
import { hashBytes, readUpload } from '$lib/server/system/files';
import { seedDemo } from '$lib/server/system/demo';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

// Recorded, not just proxied: the ruling for D10 is that the seed reads no
// environment variable beyond the ones it has always read, and the only way to
// prove that is to watch every read as it happens.
const { envKeysRead } = vi.hoisted(() => ({ envKeysRead: new Set<string>() }));

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key) => {
			if (typeof key !== 'string') return undefined;
			envKeysRead.add(key);
			return process.env[key];
		}
	})
}));

/** A value nothing in a demo PDF may ever contain. */
const SENTINEL = 'ENV-SENTINEL-must-never-reach-a-demo-page';

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;
let previousUploadDir: string | undefined;
let uploadDir: string;
/** The environment the SEED read, snapshotted before the assertions read more. */
let seedEnvReads: Set<string>;

const asAdmin = { id: 'a', role: 'admin' as const };
const asMember = { id: 'm', role: 'member' as const };

const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	previousUploadDir = process.env.UPLOAD_DIR;
	harness = await startPostgres('demo-seed', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	// A directory of its own, so counting what the seed wrote counts nothing else.
	uploadDir = mkdtempSync(join(resolve('scratch-workspace'), 'demo-seed-uploads-'));
	process.env.UPLOAD_DIR = uploadDir;
	process.env.DEMO_SEED_SENTINEL = SENTINEL;

	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
	// What `boot()` does before it reaches the demo: the category rows the
	// seeded transactions carry a foreign key into, and the bank rows the
	// accounts name.
	await seedCategories();
	await seedBanks();

	envKeysRead.clear();
	await seedDemo();
	seedEnvReads = new Set(envKeysRead);
}, 300_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
	if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
	else process.env.UPLOAD_DIR = previousUploadDir;
	delete process.env.DEMO_SEED_SENTINEL;
	if (uploadDir) await rm(uploadDir, { recursive: true, force: true });
});

/** Every document the seed filed. */
const seededDocuments = () => testDb.select().from(document);

/** One document's text layer, read the way extraction reads it. */
async function pdfText(storedName: string): Promise<string> {
	const bytes = await readUpload(storedName);
	if (!bytes) throw new Error(`No file on the volume for ${storedName}.`);
	const mupdf = await import('mupdf');
	const pdf = mupdf.Document.openDocument(bytes, 'application/pdf');
	let text = '';
	for (let page = 0; page < pdf.countPages(); page++) {
		text += pdf.loadPage(page).toStructuredText().asText();
	}
	return text;
}

/** The documents of one type, newest first is irrelevant — there are few. */
const ofType = (docs: (typeof document.$inferSelect)[], type: string) =>
	docs.filter((d) => d.type === type);

/** What a document is filed against, as ids. */
async function targetsOf(documentId: string): Promise<string[]> {
	const rows = await testDb
		.select({ targetId: documentLink.targetId })
		.from(documentLink)
		.where(eq(documentLink.documentId, documentId));
	return rows.map((r) => r.targetId);
}

describe('the demo seed', () => {
	it('gives every document real bytes and a hash of those bytes', async () => {
		const docs = await seededDocuments();
		expect(docs.length).toBeGreaterThan(0);
		for (const doc of docs) {
			expect(doc.storedName, `${doc.name} has no file`).not.toBeNull();
			expect(doc.contentHash, `${doc.name} has no hash`).not.toBeNull();
			const bytes = await readUpload(doc.storedName!);
			expect(bytes, `${doc.name} has no bytes on the volume`).not.toBeNull();
			expect(hashBytes(bytes!)).toBe(doc.contentHash);
			// A real PDF, and a small one: the demo ships twenty-odd of these.
			expect(new TextDecoder().decode(bytes!.slice(0, 5))).toBe('%PDF-');
			expect(bytes!.length).toBeLessThan(20_000);
		}
	});

	it('queues an extraction job for every document and runs none of them', async () => {
		const docs = await seededDocuments();
		const jobs = await testDb.select().from(job).where(eq(job.kind, 'extract_text'));
		expect(jobs).toHaveLength(docs.length);
		expect(new Set(jobs.map((j) => j.subjectId))).toEqual(new Set(docs.map((d) => d.id)));
		for (const queued of jobs) expect(queued.state).toBe('queued');
	});

	it('files a document against every kind of record the model has', async () => {
		const kinds = await testDb
			.selectDistinct({ kind: entity.kind })
			.from(documentLink)
			.innerJoin(entity, eq(entity.id, documentLink.targetId));
		const found = new Set(kinds.map((k) => k.kind));
		for (const kind of ['person', 'property', 'tenancy', 'account', 'transaction', 'subject']) {
			expect(found, `nothing is filed against a ${kind}`).toContain(kind);
		}
	});

	it('records twelve payslips and links the ones a bank credit paid', async () => {
		const docs = await seededDocuments();
		const payslips = ofType(docs, 'payslip');
		expect(payslips).toHaveLength(12);

		const [jana] = await testDb.select().from(person).where(eq(person.role, 'admin'));
		for (const slip of payslips) expect(await targetsOf(slip.id)).toContain(jana.id);

		const entries = await testDb.select().from(salaryEntry);
		expect(entries.filter((e) => e.documentId !== null)).toHaveLength(12);

		// D6: a payslip whose month also holds a bank credit carries a visible
		// link to that credit. The credit has to be recorded FIRST for the slip
		// to claim its row, so this is the assertion that the seed got the order
		// right rather than leaving two rows for the month.
		const merged = entries.filter((e) => e.documentId !== null && e.transactionId !== null);
		expect(merged.length).toBeGreaterThan(0);
		for (const entry of merged) {
			expect(await targetsOf(entry.documentId!)).toContain(entry.transactionId);
		}
	});

	it('files the lease on the tenancy and reminds for it once', async () => {
		const docs = await seededDocuments();
		const [lease] = ofType(docs, 'contract');
		const [only] = await testDb.select().from(tenancy);
		expect(await targetsOf(lease.id)).toContain(only.id);
		expect(lease.expiresOn).toBe(only.endsOn);
		expect(lease.expiryVerb).toBe('renews');

		// D7: the tenancy owns the date, so the lease document adds no second
		// event of its own on the same day. Bound events only — the monthly
		// "import last month's statements" nudge is not bound to a record and
		// lands on the first of the month like every other first of the month.
		const events = await generateEvents(
			`${Number(today.slice(0, 4)) - 1}-01-01`,
			'2099-01-01',
			testDb
		);
		const onEnd = events.filter((e) => e.date === only.endsOn && e.binding !== null);
		expect(onEnd).toHaveLength(1);
		expect(onEnd[0].binding?.table).toBe('tenancy');
		expect(events.some((e) => e.binding?.rowId === lease.id)).toBe(false);
	});

	it('files a run of statements per current account, with one month missing', async () => {
		// A run rather than a single statement, and one month deliberately absent:
		// the Statements shelf exists to show a month that never arrived, and a
		// ribbon with one band on it demonstrates nothing. Every statement carries
		// the months it covers, because the demo writes no import to derive them
		// from and the ribbon reads the column rather than the name.
		const docs = await seededDocuments();
		const accounts = await testDb.select().from(account);
		const statements = ofType(docs, 'bank_statement');
		expect(statements.length).toBeGreaterThan(2);

		for (const statement of statements) {
			expect(statement.periodOn, statement.name).not.toBeNull();
			expect(statement.periodEndOn, statement.name).not.toBeNull();
		}

		const linked = new Set((await Promise.all(statements.map((s) => targetsOf(s.id)))).flat());
		for (const current of accounts.filter((a) => a.kind === 'current')) {
			expect(linked).toContain(current.id);
		}

		// The gap. Whichever account has a run of months, one of them is not
		// filed — and nothing marks it as missing, which is how a real month goes
		// astray.
		const months = statements
			.map((s) => s.periodOn)
			.filter((day): day is string => day !== null)
			.sort();
		const span =
			(Number(months[months.length - 1].slice(0, 4)) - Number(months[0].slice(0, 4))) * 12 +
			(Number(months[months.length - 1].slice(5, 7)) - Number(months[0].slice(5, 7))) +
			1;
		expect(span).toBeGreaterThan(new Set(months).size);

		const [report] = ofType(docs, 'broker_report');
		const brokerage = accounts.filter((a) => a.kind === 'brokerage');
		expect(brokerage).toHaveLength(1);
		expect(await targetsOf(report.id)).toContain(brokerage[0].id);

		// The demo writes its transactions directly rather than running an
		// import, so there is no `import_file` row for a statement to be keyed
		// to — the branch the D10 ruling names as the alternative.
		expect(await testDb.select().from(importFile)).toHaveLength(0);
	});

	it('gives the demo an employer with a promotion behind it', async () => {
		// Two role periods, one person. A single-period fixture never exercises
		// the case that matters — the span must keep reporting the ORIGINAL start
		// after a promotion, or the years before it stop being counted as missing.
		const orgs = await listOrganisations(testDb);
		const employer = orgs.find((o) => o.kind === 'employer');
		expect(employer).toBeDefined();
		expect(employer!.peopleCount, 'a promotion is not a second colleague').toBe(1);

		const roles = await engagementsFor(employer!.id, testDb);
		expect(roles).toHaveLength(2);
		const span = engagementSpan(roles);
		expect(span.endsOn, 'an open period means the employment is current').toBeNull();

		// And it reaches back past the earliest payslip, which is the whole point
		// of the fixture: a lane can only show a year with nothing filed in it if
		// the relationship began before the paper did.
		const [earliest] = await testDb
			.select({ periodOn: document.periodOn })
			.from(document)
			.where(eq(document.type, 'payslip'))
			.orderBy(asc(document.periodOn))
			.limit(1);
		expect(span.startsOn! < earliest.periodOn!).toBe(true);
	});

	it('files every payslip against that employer', async () => {
		const orgs = await listOrganisations(testDb);
		const employer = orgs.find((o) => o.kind === 'employer')!;
		const filed = await documentsAbout(employer.id, null, testDb);
		expect(filed.filter((d) => d.type === 'payslip')).toHaveLength(12);
	});

	it('gives the tax office no role and no start, which is a real case', async () => {
		// An office a household has simply always dealt with. The span has to
		// survive having nothing to measure.
		const orgs = await listOrganisations(testDb);
		const authority = orgs.find((o) => o.kind === 'authority')!;
		const roles = await engagementsFor(authority.id, testDb);
		expect(roles).toHaveLength(1);
		expect(engagementSpan(roles)).toEqual({ startsOn: null, endsOn: null });
	});

	it('files three receipts on transactions, each printing a variable symbol', async () => {
		const docs = await seededDocuments();
		const receipts = ofType(docs, 'receipt');
		expect(receipts).toHaveLength(3);

		const transactions = await testDb.select({ id: transaction.id }).from(transaction);
		const transactionIds = new Set(transactions.map((t) => t.id));
		for (const receipt of receipts) {
			const targets = await targetsOf(receipt.id);
			expect(targets.some((t) => transactionIds.has(t))).toBe(true);
			// Search-by-identifier needs something to find, and a variable symbol
			// is what a Czech receipt is looked up by.
			expect(await pdfText(receipt.storedName!)).toMatch(/VS \d{6,}/);
		}

		const shelves = await testDb.select().from(shelf);
		const keyOf = (shelfId: string) => shelves.find((s) => s.id === shelfId)?.key;
		const onShelf = receipts.map((r) => keyOf(r.shelfId)).sort();
		expect(onShelf).toEqual(['inventory', 'inbox', 'inbox']);
	});

	it('files an insurance policy that renews soon, on the flat', async () => {
		const docs = await seededDocuments();
		const [policy] = ofType(docs, 'insurance_policy');
		expect(policy.expiryVerb).toBe('renews');
		const properties = await testDb.select({ id: property.id }).from(property);
		const targets = await targetsOf(policy.id);
		expect(properties.some((p) => targets.includes(p.id))).toBe(true);
		const days = Math.round(
			(new Date(policy.expiresOn!).getTime() - new Date(today).getTime()) / 86400000
		);
		expect(days).toBeGreaterThan(30);
		expect(days).toBeLessThanOrEqual(60);
	});

	it('fills in what the two identity cards say on their faces', async () => {
		// The wallet draws its artwork, its flag and its kind from these, so a
		// demo seed that filed the paper and left the fields empty would show two
		// generic cards and demonstrate nothing.
		const rows = await testDb.select().from(documentIdentity);
		expect(rows).toHaveLength(2);

		const kinds = rows.map((r) => r.kind).sort();
		expect(kinds).toEqual(['id_card', 'passport']);
		for (const row of rows) {
			expect(row.country).toBe('CZ');
			expect(row.number).toBeTruthy();
			expect(row.issuedOn).toBeTruthy();
			expect(row.issuer).toBeTruthy();
		}
	});

	it('leaves one of the two identity documents visible to everyone', async () => {
		// A wallet worth looking at holds more than one card, and a member who
		// sees an empty Identity shelf learns nothing about what it is for.
		const docs = await seededDocuments();
		const identity = docs.filter((d) => d.type === 'id_document');
		expect(identity).toHaveLength(2);
		expect(identity.filter((d) => d.sensitivity === 'normal')).toHaveLength(1);
	});

	it('files exactly one restricted document, which a member cannot see', async () => {
		const docs = await seededDocuments();
		const restricted = docs.filter((d) => d.sensitivity === 'restricted');
		expect(restricted).toHaveLength(1);
		expect(restricted[0].type).toBe('id_document');

		const forMember = await testDb
			.select({ id: document.id })
			.from(document)
			.where(and(eq(document.id, restricted[0].id), visibleDocumentPredicate(asMember)));
		expect(forMember).toHaveLength(0);
		const forAdmin = await testDb
			.select({ id: document.id })
			.from(document)
			.where(and(eq(document.id, restricted[0].id), visibleDocumentPredicate(asAdmin)));
		expect(forAdmin).toHaveLength(1);
	});

	it('seeds an archived Car holding past-dated paper, and a Dog holding current paper', async () => {
		const subjects = await listSubjects(testDb, asAdmin);
		const car = subjects.find((s) => s.name === 'Car');
		const dog = subjects.find((s) => s.name === 'Dog');
		expect(car).toBeDefined();
		expect(dog).toBeDefined();
		expect(car!.archivedAt).not.toBeNull();
		expect(car!.activeTo).not.toBeNull();
		expect(car!.activeTo! < today).toBe(true);
		expect(dog!.archivedAt).toBeNull();

		const docs = await seededDocuments();
		const [warranty] = ofType(docs, 'warranty');
		expect(await targetsOf(warranty.id)).toContain(car!.id);
		// Past-dated on purpose: an archived subject's paper has to read as
		// history rather than as an expiry somebody forgot.
		expect(warranty.expiresOn! < today).toBe(true);

		const [certificate] = ofType(docs, 'certificate');
		expect(await targetsOf(certificate.id)).toContain(dog!.id);
		expect(certificate.expiresOn! > today).toBe(true);
	});

	it('tags a few documents, so the tags screen has paper on it', async () => {
		const docs = await seededDocuments();
		const tagged = await testDb
			.select({ targetId: tagLink.targetId })
			.from(tagLink)
			.where(
				inArray(
					tagLink.targetId,
					docs.map((d) => d.id)
				)
			);
		expect(new Set(tagged.map((t) => t.targetId)).size).toBeGreaterThanOrEqual(2);
	});

	it('prints no value that came out of the environment', async () => {
		// Every environment value long enough to be recognisable if it leaked,
		// plus a sentinel planted before the seed ran so the assertion is not
		// only as good as this machine's environment happens to be.
		const forbidden = [
			SENTINEL,
			...Object.values(process.env).filter(
				(value): value is string => typeof value === 'string' && value.length >= 8
			)
		];
		const docs = await seededDocuments();
		for (const doc of docs) {
			const text = await pdfText(doc.storedName!);
			// A text layer, so search-by-contents works with no OCR at all.
			expect(text.trim().length, `${doc.name} has no text layer`).toBeGreaterThan(20);
			for (const value of forbidden) {
				expect(text, `${doc.name} prints an environment value`).not.toContain(value);
			}
		}
	});

	it('reads only the environment the demo has always read', () => {
		expect([...seedEnvReads].sort()).toEqual(
			[...seedEnvReads].filter((key) => key === 'UPLOAD_DIR' || key === 'DATABASE_URL').sort()
		);
	});

	// A person with no stored layout is treated as somebody who has never been
	// here, and is shown the picker instead of a board. That is right for a real
	// install and wrong for the demo: the first screenshot anybody takes would
	// be of an empty grid asking them to choose.
	it('hands both demo people a board rather than the first-run picker', async () => {
		const people = await testDb.select({ layout: person.overviewLayout }).from(person);
		expect(people).toHaveLength(2);
		for (const who of people) {
			expect(who.layout).toHaveLength(4);
			expect(who.layout).toEqual(SUGGESTED_LAYOUT);
		}
	});

	it('does nothing at all on an instance that already has people', async () => {
		const before = {
			people: (await testDb.select().from(person)).length,
			documents: (await seededDocuments()).length,
			subjects: (await testDb.select().from(subject)).length,
			files: readdirSync(uploadDir).length
		};
		await seedDemo();
		expect({
			people: (await testDb.select().from(person)).length,
			documents: (await seededDocuments()).length,
			subjects: (await testDb.select().from(subject)).length,
			files: readdirSync(uploadDir).length
		}).toEqual(before);
	});
});
