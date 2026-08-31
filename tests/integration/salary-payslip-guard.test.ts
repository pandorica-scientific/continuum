// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Who may file a payslip.
 *
 * `payslipMatchingContent` recognises a re-uploaded slip by its bytes and says
 * nothing about who is asking — deliberately, because applying the read rule
 * there would make a member's upload MISS the restricted slip it matches, mint
 * a second document and a second salary entry, and report the month's pay
 * twice. The answer is a gate at the action instead: a member files their own
 * payslips, an admin files anybody's, and nobody else's upload can rename a
 * restricted slip or move the month it evidences.
 */
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { document, documentLink, salaryEntry } from '$lib/server/db/schema';
import { recordSalary } from '$lib/server/salary';
import { hashBytes } from '$lib/server/system/files';

import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makePerson } from './fixtures';

// $env/dynamic/private snapshots process.env when Vite builds the virtual
// module, which is before this suite picks its database and upload directory.
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
const ADMIN = rowId('person-admin');
const PETRA = rowId('person-petra');
const ROBERT = rowId('person-robert');
const SLIP = rowId('doc-petra-july');
const DIRECTORY = resolve('scratch-workspace/payslip-guard-uploads');
let previousDirectory: string | undefined;
let previousUrl: string | undefined;

/** Petra's July slip, byte for byte — what a member would re-upload. */
const JULY = new TextEncoder().encode('%PDF-1.4 petra july');
const OWN = new TextEncoder().encode('%PDF-1.4 robert september');

const asPerson = (id: string, role: 'admin' | 'member') => ({
	person: { id, name: 'Someone', initials: 'S', role, theme: null }
});

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
	await mkdir(DIRECTORY, { recursive: true });
	harness = await startPostgres('salary-payslip-guard');
	// The actions reach for the module-level `db`, so pointing that at this
	// suite's server is what makes the real action reachable.
	previousUrl = process.env.DATABASE_URL;
	process.env.DATABASE_URL = harness.url;
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousDirectory === undefined) delete process.env.UPLOAD_DIR;
	else process.env.UPLOAD_DIR = previousDirectory;
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
	await rm(DIRECTORY, { recursive: true, force: true });
});

beforeEach(async () => {
	await harness.sql`delete from document_link`;
	await harness.sql`delete from salary_entry`;
	await harness.sql`delete from document`;
	await harness.sql`delete from person`;
	await makePerson(testDb, { id: ADMIN, name: 'Admin', initials: 'A', role: 'admin' });
	await makePerson(testDb, { id: PETRA, name: 'Petra', initials: 'P', role: 'member' });
	await makePerson(testDb, { id: ROBERT, name: 'Robert', initials: 'R', role: 'member' });
});

/** Petra's July payslip, restricted, with the salary month it evidences. */
async function seedRestrictedSlip(): Promise<void> {
	await makeDocument(testDb, {
		id: SLIP,
		name: 'Payslip 2026-07 · Petra',
		shelfKey: 'finance',
		type: 'payslip',
		storedName: 'petra-july.pdf',
		ext: 'PDF',
		addedOn: '2026-07-31',
		periodOn: '2026-07-01',
		sensitivity: 'restricted',
		contentHash: hashBytes(JULY)
	});
	await testDb.insert(documentLink).values({ documentId: SLIP, targetId: PETRA });
	const recorded = await recordSalary(
		{
			personId: PETRA,
			periodMonth: '2026-07',
			currency: 'CZK',
			grossMinor: 8_000_000n,
			source: 'payslip',
			documentId: SLIP
		},
		testDb
	);
	expect(recorded.ok).toBe(true);
}

type ActionResult = { status?: number; data?: { message?: string }; ok?: boolean };

async function post(
	name: 'addPayslip' | 'addPayslips',
	fields: Record<string, string>,
	files: { field: string; bytes: Uint8Array; name: string }[],
	locals: ReturnType<typeof asPerson>
): Promise<ActionResult> {
	const { actions } = await import('../../src/routes/(app)/salary/+page.server');
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	for (const file of files) {
		form.append(
			file.field,
			new File([new Uint8Array(file.bytes)], file.name, { type: 'application/pdf' })
		);
	}
	const request = new Request(`http://localhost/salary?/${name}`, { method: 'POST', body: form });
	return (await (actions[name] as unknown as (event: unknown) => Promise<unknown>)({
		request,
		locals
	})) as ActionResult;
}

const slipRow = async () => (await testDb.select().from(document).where(eq(document.id, SLIP)))[0];
const monthsFor = (personId: string) =>
	testDb.select().from(salaryEntry).where(eq(salaryEntry.personId, personId));

describe('filing a payslip for somebody else', () => {
	it('refuses a member, and leaves the restricted slip and its month exactly as they were', async () => {
		await seedRestrictedSlip();

		const outcome = await post(
			'addPayslip',
			{ personId: PETRA, currency: 'CZK', gross: '90 000', periodMonth: '2026-09' },
			[{ field: 'file', bytes: JULY, name: 'july.pdf' }],
			asPerson(ROBERT, 'member')
		);

		expect(outcome.status).toBe(403);
		expect(outcome.data?.message).toBe('You can only file your own payslips.');

		// The document the bytes matched: same name, same month, untouched.
		const row = await slipRow();
		expect(row.name).toBe('Payslip 2026-07 · Petra');
		expect(row.periodOn).toBe('2026-07-01');

		// And its salary entry, which a restatement would have moved to September.
		const months = await monthsFor(PETRA);
		expect(months).toHaveLength(1);
		expect(months[0].periodMonth).toBe('2026-07');
		expect(months[0].grossMinor).toBe(8_000_000n);
	});

	it('refuses a member on the whole-year upload too', async () => {
		await seedRestrictedSlip();

		const outcome = await post(
			'addPayslips',
			{ personId: PETRA, currency: 'CZK' },
			[{ field: 'files', bytes: JULY, name: 'july.pdf' }],
			asPerson(ROBERT, 'member')
		);

		expect(outcome.status).toBe(403);
		expect(outcome.data?.message).toBe('You can only file your own payslips.');
		expect(await monthsFor(PETRA)).toHaveLength(1);
	});

	it('lets an admin file anybody’s', async () => {
		await seedRestrictedSlip();

		const outcome = await post(
			'addPayslip',
			{ personId: PETRA, currency: 'CZK', gross: '90 000', periodMonth: '2026-09' },
			[{ field: 'file', bytes: JULY, name: 'july.pdf' }],
			asPerson(ADMIN, 'admin')
		);

		expect(outcome.status).toBeUndefined();
		expect(outcome.ok).toBe(true);
		// The same bytes, so the same document — moved to the month the admin
		// stated rather than filed a second time.
		const months = await monthsFor(PETRA);
		expect(months).toHaveLength(1);
		expect(months[0].periodMonth).toBe('2026-09');
	});
});

describe('filing your own payslip', () => {
	it('is allowed for a member', async () => {
		const outcome = await post(
			'addPayslip',
			{ personId: ROBERT, currency: 'CZK', gross: '75 000', periodMonth: '2026-09' },
			[{ field: 'file', bytes: OWN, name: 'september.pdf' }],
			asPerson(ROBERT, 'member')
		);

		expect(outcome.status).toBeUndefined();
		expect(outcome.ok).toBe(true);
		const [month] = await testDb
			.select()
			.from(salaryEntry)
			.where(and(eq(salaryEntry.personId, ROBERT), eq(salaryEntry.periodMonth, '2026-09')));
		expect(month.grossMinor).toBe(7_500_000n);
	});
});
