import { rowId } from '../row-id';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

let harness: Harness;
let testDb: TestDb;

async function count(table: string): Promise<number> {
	const rows = await harness.sql.unsafe<{ count: number }[]>(
		`select count(*)::int as count from "${table}"`
	);
	return rows[0].count;
}

async function insertAccount(
	/** Already a uuid: callers pass rowId('label'), so one place maps and one reads. */
	id: string,
	currency: string,
	numbers: string[] = [],
	bank = 'fio'
): Promise<void> {
	await testDb.insert(schema.account).values({
		id,
		name: id,
		bank,
		currency,
		numbers
	});
}

function fioStatement({
	accountNumber,
	bookedOn,
	amount,
	counterpartyAccount,
	bankRef
}: {
	accountNumber: string;
	bookedOn: string;
	amount: string;
	counterpartyAccount: string;
	bankRef: string;
}): Uint8Array {
	const [year, month, day] = bookedOn.split('-');
	const czDay = `${day}.${month}.${year}`;
	const [counterpartyNumber, counterpartyBank] = counterpartyAccount.split('/');
	// The closing balance has to follow from the movement.
	//
	// This generator used to print 0,00 both sides while emitting a real
	// transaction, which every route now rejects as a statement that disagrees
	// with itself — correctly. These fixtures exist to exercise pairing and
	// deduplication, so their arithmetic was never the point; it still has to be
	// true, or the file could not exist.
	const closing = Number(amount.replace(',', '.'));
	const czClosing = closing.toFixed(2).replace('.', ',');
	return new TextEncoder().encode(
		[
			`"Výpis č. 1/${year} z účtu ""${accountNumber}"""`,
			`"Období: ${czDay} - ${czDay}"`,
			`"Počáteční stav účtu k ${czDay}: 0,00 CZK"`,
			`"Koncový stav účtu k ${czDay}: ${czClosing} CZK"`,
			'',
			'"ID operace";"Datum";"Objem";"Měna";"Protiúčet";"Název protiúčtu";"Kód banky";"Název banky";"KS";"VS";"SS";"Poznámka";"Zpráva pro příjemce";"Typ"',
			`"${bankRef}";"${czDay}";"${amount}";"CZK";"${counterpartyNumber}";"";"${counterpartyBank}";"";"";"";"";"";"";"Bezhotovostní platba"`
		].join('\n')
	);
}

beforeAll(async () => {
	harness = await startPostgres('import-integrity');
	testDb = harness.db;
	process.env.DATABASE_URL = harness.url;
	process.env.UPLOAD_DIR = resolve('scratch-workspace/task1-import-uploads');

	await harness.applyMigrations(ALL_MIGRATIONS);
}, 30_000);

beforeEach(async () => {
	await harness.sql.unsafe(`
		drop trigger if exists task1_fail_second_transaction on "transaction";
		drop function if exists task1_fail_second_transaction();
		drop trigger if exists task1_fail_leg_update on "transaction";
		drop function if exists task1_fail_leg_update();
		drop trigger if exists task1_delay_old_import on "transaction";
		drop function if exists task1_delay_old_import();
		drop trigger if exists task1_delay_pair_insert on transfer_pair;
		drop function if exists task1_delay_pair_insert();
		drop trigger if exists task1_delay_pair_transition on transfer_pair;
		drop function if exists task1_delay_pair_transition();
		drop trigger if exists task1_delay_account_insert on account;
		drop function if exists task1_delay_account_insert();
		drop trigger if exists task1_delay_import_leg on "transaction";
		drop function if exists task1_delay_import_leg();
		drop sequence if exists task1_import_leg_arrivals;
		drop trigger if exists task1_delay_transaction_tag on tag_link;
		drop function if exists task1_delay_transaction_tag();
		drop sequence if exists task1_tag_lock_arrivals;
		-- entity too: TRUNCATE fires no row triggers, so a registration would
		-- outlive the row it belongs to and collide on a reused id.
		truncate table transfer_pair, "transaction", import_file, job,
			import_profile, account, person, settings, rule, tag, currency_rate, entity
			restart identity cascade;
	`);
});

afterAll(async () => {
	await harness?.stop();
});

/**
 * RETIRED with this suite's legacy-world tests: six cases that rebuilt the
 * schema as it stood before migration 0027 and replayed that migration against
 * deliberately broken data.
 *
 * They went because v0.3.10 collapses every migration into one baseline, so 0027
 * will not exist to replay — and because the world they built could only be
 * written through the CURRENT Drizzle schema, which since the rename names
 * columns that world does not have. Keeping them meant either editing a
 * migration that already ran to describe a schema it never saw, or maintaining a
 * second vocabulary in raw SQL for a test with a known expiry date.
 *
 * What they covered that still matters is covered live: fingerprint versioning,
 * transfer pairing, and duplicate detection are all exercised against the
 * current schema by the tests that remain in this file.
 */
describe('import database integrity', () => {
	it('rolls back the import record and all rows when a later insert fails', async () => {
		await insertAccount(rowId('fio-czk'), 'CZK', ['1234567890/2010']);
		await harness.sql.unsafe(`
			create function task1_fail_second_transaction() returns trigger language plpgsql as $$
			begin
				if (select count(*) from "transaction" where import_file_id = new.import_file_id) >= 1 then
					raise exception 'injected second-row failure';
				end if;
				return new;
			end $$;
			create trigger task1_fail_second_transaction before insert on "transaction"
			for each row execute function task1_fail_second_transaction();
		`);
		const { ingestFile } = await import('$lib/server/import/ingest');
		const buffer = new Uint8Array(await readFile(resolve('tests/fixtures/fio.csv')));

		await expect(ingestFile('atomic.txt', buffer, rowId('fio-czk'), testDb)).rejects.toThrow();
		expect(await count('import_file')).toBe(0);
		expect(await count('transaction')).toBe(0);
	});

	it('rejects a selected account with conflicting currency or statement identity', async () => {
		await insertAccount(rowId('wrong-currency'), 'EUR', ['1234567890/2010']);
		await insertAccount(rowId('wrong-number'), 'CZK', ['9999999999/2010']);
		const { ingestFile } = await import('$lib/server/import/ingest');
		const buffer = new Uint8Array(await readFile(resolve('tests/fixtures/fio.csv')));

		const currencyResult = await ingestFile(
			'currency.txt',
			buffer,
			rowId('wrong-currency'),
			testDb
		);
		expect(currencyResult.needsAccount).toBe(true);
		expect(currencyResult.error).toMatch(/currency/i);

		const identityResult = await ingestFile('identity.txt', buffer, rowId('wrong-number'), testDb);
		expect(identityResult.needsAccount).toBe(true);
		expect(identityResult.error).toMatch(/account number/i);
		expect(await count('import_file')).toBe(0);
		expect(await count('transaction')).toBe(0);
	});

	it('never auto-assigns a statement to matching number metadata from another bank', async () => {
		await insertAccount(rowId('wrong-bank'), 'CZK', ['1234567890/2010'], 'other');
		const { ingestFile } = await import('$lib/server/import/ingest');
		const buffer = new Uint8Array(await readFile(resolve('tests/fixtures/fio.csv')));

		const result = await ingestFile('bank-identity.txt', buffer, undefined, testDb);

		expect(result.error).toBeUndefined();
		const accounts = await testDb.select().from(schema.account).orderBy(schema.account.id);
		expect(accounts).toHaveLength(2);
		const imported = accounts.find((row) => row.id !== rowId('wrong-bank'));
		expect(imported).toMatchObject({ bank: 'fio', currency: 'CZK' });
		expect(
			(await testDb.select().from(schema.transaction)).every(
				(row) => row.accountId === imported?.id
			)
		).toBe(true);
	});

	it('accepts the account a person chose for a statement no adapter recognised', async () => {
		// The reader names the FORMAT it read a file as — `tabular`, `camt053` —
		// whenever no adapter claimed it, and account resolution compared that
		// against the chosen account's bank. So pointing at your own account and
		// being told "the selected account belongs to cs, but this statement
		// belongs to tabular" was the ordinary outcome for every bank without an
		// adapter, which is most of them.
		//
		// The account is the authority on which bank it is. A format name is not
		// evidence about an institution and may not overrule it.
		await insertAccount(rowId('chosen-pln'), 'PLN', [], 'cs');
		const { ingestFile } = await import('$lib/server/import/ingest');
		const buffer = new Uint8Array(
			await readFile(resolve('tests/fixtures/synthetic/csv/statement-001-comma-utf8-bom.csv'))
		);

		const result = await ingestFile('generic.csv', buffer, rowId('chosen-pln'), testDb);

		expect(result.error).toBeUndefined();
		expect(result.needsAccount).toBeUndefined();
		expect(result.rowsAdded).toBeGreaterThan(0);
		const rows = await testDb.select().from(schema.transaction);
		expect(rows.every((row) => row.accountId === rowId('chosen-pln'))).toBe(true);
	});

	it('asks rather than minting an account named after the format it was read as', async () => {
		// Nothing here identifies an account: this file prints no number the reader
		// recognises, and no adapter claimed it, so no issuer is known either.
		//
		// `bank: 'tabular'` used to be treated as the institution and carried
		// straight into `account.bank` — which names the account, picks its emoji
		// and is published through /api/v1 — so the ledger gained an account
		// called, literally, `tabular PLN`. Worse, bank+currency then MATCHED, so
		// the next unrelated bank read generically in the same currency landed in
		// that same account.
		//
		// A format name is not evidence about an institution. With nothing to
		// identify the account, the honest move is the question, because the
		// answer becomes permanent metadata.
		const { ingestFile } = await import('$lib/server/import/ingest');
		const buffer = new Uint8Array(
			await readFile(resolve('tests/fixtures/synthetic/csv/statement-001-comma-utf8-bom.csv'))
		);

		const result = await ingestFile('generic-auto.csv', buffer, undefined, testDb);

		expect(result).toMatchObject({ needsAccount: true, rowsAdded: 0 });
		expect(result.error).toMatch(/which bank issued it/i);
		expect(await count('account')).toBe(0);
		expect(await count('import_file')).toBe(0);
		expect(await count('transaction')).toBe(0);
	});

	it('requires a choice when duplicate account records share the exact identity', async () => {
		await insertAccount(rowId('duplicate-a'), 'CZK', ['1234567890/2010']);
		await insertAccount(rowId('duplicate-b'), 'CZK', ['CZ6520100000001234567890']);
		const { ingestFile } = await import('$lib/server/import/ingest');
		const buffer = new Uint8Array(await readFile(resolve('tests/fixtures/fio.csv')));

		const result = await ingestFile('ambiguous-identity.txt', buffer, undefined, testDb);

		expect(result).toMatchObject({ needsAccount: true, rowsAdded: 0 });
		expect(result.error).toMatch(/several accounts/i);
		expect(await count('import_file')).toBe(0);
		expect(await count('transaction')).toBe(0);
	});

	it('imports every statement in a file that carries several accounts', async () => {
		// A CAMT export with two accounts is one file and two statements. Each
		// resolves on its own evidence, and both must land — this is the case the
		// pipeline's array shape exists for.
		const { ingestFile } = await import('$lib/server/import/ingest');
		const camt = multiAccountCamt();
		const result = await ingestFile('camt-two-accounts.xml', camt, undefined, testDb);

		expect(result.error).toBeUndefined();
		expect(result.statements).toHaveLength(2);
		expect(result.rowsAdded).toBe(3);

		const accounts = await testDb.select().from(schema.account);
		expect(accounts).toHaveLength(2);
		expect(accounts.map((a) => a.currency).sort()).toEqual(['CZK', 'EUR']);

		// Every transaction belongs to the account of ITS OWN statement, never to
		// whichever account happened to resolve first.
		for (const outcome of result.statements ?? []) {
			const rows = await testDb
				.select()
				.from(schema.transaction)
				.where(eq(schema.transaction.accountId, outcome.accountId!));
			expect(rows).toHaveLength(outcome.rowsAdded);
			expect(rows.every((r) => r.currency === outcome.currency)).toBe(true);
		}

		// One file, one import_file row, holding the total across statements.
		expect(await count('import_file')).toBe(1);
		const [file] = await testDb.select().from(schema.importFile);
		expect(file.rowsRead).toBe(3);
	});

	it('writes nothing at all when one statement in a multi-account file cannot be placed', async () => {
		// Two accounts already share the EUR statement's identity, so that half is
		// ambiguous. Importing the CZK half anyway would record the file's content
		// hash and the corrected re-upload would be refused as a duplicate,
		// stranding the EUR statement for good. All or nothing.
		await insertAccount(rowId('camt-eur-a'), 'EUR', ['CZ2010000000002500834780'], 'camt053');
		await insertAccount(rowId('camt-eur-b'), 'EUR', ['CZ2010000000002500834780'], 'camt053');
		const { ingestFile } = await import('$lib/server/import/ingest');

		const result = await ingestFile('camt-ambiguous.xml', multiAccountCamt(), undefined, testDb);

		expect(result).toMatchObject({ needsAccount: true, rowsAdded: 0 });
		expect(await count('import_file')).toBe(0);
		expect(await count('transaction')).toBe(0);
	});

	it('learns a statement number assigned to a compatible account for later automatic imports', async () => {
		await insertAccount(rowId('manual-fio-account'), 'CZK');
		const { ingestFile } = await import('$lib/server/import/ingest');
		const source = new TextDecoder().decode(await readFile(resolve('tests/fixtures/fio.csv')));
		const first = new TextEncoder().encode(source.replace('Výpis č. 7/2026', 'Výpis č. 6/2026'));
		const second = new TextEncoder().encode(source.replace('Výpis č. 7/2026', 'Výpis č. 8/2026'));

		const assigned = await ingestFile(
			'assigned-account.txt',
			first,
			rowId('manual-fio-account'),
			testDb
		);
		const automatic = await ingestFile('automatic-account.txt', second, undefined, testDb);

		expect(assigned.error).toBeUndefined();
		expect(automatic.error).toBeUndefined();
		expect(
			await testDb
				.select({ id: schema.account.id, numbers: schema.account.numbers })
				.from(schema.account)
		).toEqual([{ id: rowId('manual-fio-account'), numbers: ['1234567890/2010'] }]);
		const importedAccounts = await testDb
			.select({ accountId: schema.importFile.accountId })
			.from(schema.importFile)
			.orderBy(schema.importFile.filename);
		expect(importedAccounts).toEqual([
			{ accountId: rowId('manual-fio-account') },
			{ accountId: rowId('manual-fio-account') }
		]);
	});

	it('serialises concurrent first imports onto one canonical account', async () => {
		await harness.sql.unsafe(`
			create function task1_delay_account_insert() returns trigger language plpgsql as $$
			begin
				perform pg_sleep(0.15);
				return new;
			end $$;
			create trigger task1_delay_account_insert before insert on account
			for each row execute function task1_delay_account_insert();
		`);
		const { ingestFile } = await import('$lib/server/import/ingest');
		const source = new TextDecoder().decode(await readFile(resolve('tests/fixtures/fio.csv')));
		const first = new TextEncoder().encode(source.replace('Výpis č. 7/2026', 'Výpis č. 6/2026'));
		const second = new TextEncoder().encode(source.replace('Výpis č. 7/2026', 'Výpis č. 8/2026'));

		const results = await Promise.all([
			ingestFile('first-account.txt', first, undefined, testDb),
			ingestFile('second-account.txt', second, undefined, testDb)
		]);

		expect(results.every((result) => result.error === undefined)).toBe(true);
		expect(await count('account')).toBe(1);
		expect(await count('import_file')).toBe(2);
		const assignedAccounts = await harness.sql<{ account_id: string }[]>`
			select distinct account_id from import_file
		`;
		expect(assignedAccounts).toHaveLength(1);
	});

	it('reads queued statements one at a time and records what happened', async () => {
		const { enqueue, queueStatus } = await import('$lib/server/import/queue');
		const { runCpuQueue } = await import('$lib/server/jobs');
		await insertAccount(rowId('fio-queue'), 'CZK', ['1234567890/2010']);
		const source = new Uint8Array(await readFile(resolve('tests/fixtures/fio.csv')));

		const id = await enqueue('fio.csv', source, rowId('fio-queue'), testDb);

		// Accepting the file writes nothing to the ledger: the upload has returned
		// and the reading has not started.
		expect(await count('transaction')).toBe(0);
		const waiting = await queueStatus(testDb);
		expect(waiting.waiting).toBe(1);
		expect(waiting.recent[0]).toMatchObject({ id, filename: 'fio.csv', state: 'queued' });

		// Two, not one: filing the statement's document queues its own text
		// extraction, and import and extraction share the one CPU slot — so the
		// same sweep that reads the statement goes on to read the filed copy too.
		expect(await runCpuQueue(testDb)).toBe(2);

		const after = await queueStatus(testDb);
		expect(after.waiting).toBe(0);
		expect(after.recent[0].state).toBe('done');
		expect(after.recent[0].result?.rowsAdded).toBe(5);
		expect(await count('transaction')).toBe(5);

		// The bytes are released once the job is finished; import_file keeps the
		// original. Named by kind: the sweep above also leaves an extract_text job
		// behind, and this is about the import job specifically.
		const [row] = await testDb.select().from(schema.job).where(eq(schema.job.kind, 'import'));
		expect(row.blob).toBeNull();
		// The size outlives the bytes, so the upload screen can still say what it read.
		expect(row.byteSize).toBeGreaterThan(0);
	}, 30_000);

	it('offers a job again when the worker holding it died, and not before', async () => {
		const { enqueue, LEASE_MS } = await import('$lib/server/import/queue');
		const { runCpuQueue } = await import('$lib/server/jobs');
		await insertAccount(rowId('fio-lease'), 'CZK', ['1234567890/2010']);
		const source = new Uint8Array(await readFile(resolve('tests/fixtures/fio.csv')));
		const id = await enqueue('fio.csv', source, rowId('fio-lease'), testDb);

		// A worker claimed this and then died: the row says running, and nothing
		// is coming back for it.
		await testDb
			.update(schema.job)
			.set({ state: 'running', claimedAt: new Date() })
			.where(eq(schema.job.id, id));

		// While the lease holds, the job is left alone — a slow read must never be
		// taken away from the worker still doing it.
		expect(await runCpuQueue(testDb)).toBe(0);
		expect(await count('transaction')).toBe(0);

		// Once it has expired, the file is read rather than stranded. Two jobs
		// again: the import itself, and the extraction its filed document queues
		// in the same shared sweep.
		await testDb
			.update(schema.job)
			.set({ claimedAt: new Date(Date.now() - LEASE_MS - 1000) })
			.where(eq(schema.job.id, id));
		expect(await runCpuQueue(testDb)).toBe(2);
		expect(await count('transaction')).toBe(5);
	}, 30_000);

	it('does not read the same file twice when two workers start at once', async () => {
		const { enqueue } = await import('$lib/server/import/queue');
		const { runCpuQueue } = await import('$lib/server/jobs');
		await insertAccount(rowId('fio-race'), 'CZK', ['1234567890/2010']);
		const source = new Uint8Array(await readFile(resolve('tests/fixtures/fio.csv')));
		await enqueue('fio.csv', source, rowId('fio-race'), testDb);

		// A second upload arriving mid-run must not start a second reader. It joins
		// the sweep already running, so both callers see the same drained count —
		// what matters is that the statement was read once, not what the two return
		// values add up to. Counting the sum instead measured the old behaviour,
		// where the second caller raced the first for the NEXT job and merely
		// happened to find none because this fixture holds a single file.
		//
		// Two, not one: filing the statement's document queues its own text
		// extraction, drained in the same sweep as the import itself.
		const [first, second] = await Promise.all([runCpuQueue(testDb), runCpuQueue(testDb)]);
		expect(first).toBe(2);
		expect(second).toBe(first);
		expect(await count('transaction')).toBe(5);
		expect(await count('import_file')).toBe(1);
	}, 30_000);

	it('imports every account in a workbook rather than one of them', async () => {
		// A workbook with a sheet per account is not several readings of one
		// statement — it is several statements. Picking a winner there is not
		// arbitration, it is losing an account: the file imported one of them,
		// recorded its content hash, and the corrected re-upload was then refused
		// as a duplicate.
		const { detectAndParseAll } = await import('$lib/server/import/detect');
		const bytes = new Uint8Array(
			await readFile(resolve('tests/fixtures/synthetic/xlsx/multi-account-ambiguous-workbook.xlsx'))
		);

		const statements = await detectAndParseAll(bytes);
		expect(statements).toHaveLength(2);
		expect(statements.map((statement) => statement.currency).sort()).toEqual(['CZK', 'EUR']);
		// The sheet that is not a statement is left out rather than guessed at.
		expect(statements.every((statement) => statement.rows.length > 0)).toBe(true);
	}, 30_000);

	it('refuses a currency that is only shaped like one', async () => {
		// Three capital letters is a shape, not a fact. `SYN-0001` is an account
		// number, and its first three characters sit beside a digit exactly as a
		// currency code would — so a workbook imported with a currency of "SYN",
		// past a guard that checked the shape and nothing else.
		const { isCurrencyCode } = await import('$lib/money');
		expect(isCurrencyCode('SYN')).toBe(false);
		expect(isCurrencyCode('PRA')).toBe(false);
		expect(isCurrencyCode('CZK')).toBe(true);
		expect(isCurrencyCode('KWD')).toBe(true);
	}, 15_000);

	it('lets a person map a layout the reader could not, and still checks the arithmetic', async () => {
		// A statement in a layout nothing recognises: headers in a language the
		// dictionary does not carry, so no column can be named by inference.
		// Whole rupiah, because IDR has no subunit — a fact the reader takes from
		// the account and applies to every figure it parses.
		const csv = [
			'Tanggal,Keterangan,Jumlah,Sisa',
			'2026-03-14,Gaji bulanan,1500000,2500000',
			'2026-03-15,Belanja harian,-320500,2179500',
			'2026-03-16,Tagihan listrik,-179500,2000000'
		].join('\n');
		const bytes = new TextEncoder().encode(csv);

		const { previewLayout } = await import('$lib/server/import/detect');
		const { confirmMapping } = await import('$lib/server/import/wizard');
		await insertAccount(rowId('bank-id'), 'IDR', [], 'tabular');

		// The reader refuses it — but it can still say what it saw, which is what
		// makes a mapping possible at all.
		const preview = await previewLayout(bytes, { currency: 'IDR' });
		expect(preview).not.toBeNull();
		expect(preview!.headers).toEqual(['Tanggal', 'Keterangan', 'Jumlah', 'Sisa']);
		expect(preview!.sample).toHaveLength(3);

		const result = await confirmMapping(
			{
				name: 'Bank Indonesia export',
				source: preview!.source,
				encoding: preview!.encoding,
				delimiter: preview!.delimiter,
				headers: preview!.headers,
				roles: ['bookingDate', 'counterparty', 'amount', 'balance'],
				dateOrder: 'year-first',
				decimalMark: '.'
			},
			{ filename: 'id.csv', bytes, accountId: rowId('bank-id') },
			testDb
		);

		expect(result.error).toBeUndefined();
		expect(result.rowsAdded).toBe(3);

		// The mapping said what the columns ARE. Whether the movements add up was
		// still decided by the balances.
		const [file] = await testDb.select().from(schema.importFile);
		expect(file.proofClass).toBe('P3');

		// And it is remembered, so the next statement from this bank arrives
		// already understood.
		const [saved] = await testDb.select().from(schema.importProfile);
		expect(saved.verified).toBe(true);
		expect(saved.headers).toEqual(['Tanggal', 'Keterangan', 'Jumlah', 'Sisa']);
	}, 30_000);

	it('asks again, pre-filled, when a remembered layout gains a column', async () => {
		// A bank adding a column is the commonest change there is, and the one a
		// positional mapping gets silently wrong: every role shifts one to the
		// right and the import still looks fine. Matching on labels turns it into
		// a question.
		const { previewLayout } = await import('$lib/server/import/detect');
		const { confirmMapping } = await import('$lib/server/import/wizard');
		const { loadProfiles } = await import('$lib/server/import/profiles');
		await insertAccount(rowId('bank-drift'), 'IDR', [], 'tabular');

		const before = new TextEncoder().encode(
			[
				'Tanggal,Keterangan,Jumlah,Sisa',
				'2026-03-14,Gaji bulanan,1500000,2500000',
				'2026-03-15,Belanja harian,-320500,2179500',
				'2026-03-16,Tagihan listrik,-179500,2000000'
			].join('\n')
		);
		const first = await confirmMapping(
			{
				name: 'Mandiri current',
				source: 'delimited',
				delimiter: ',',
				headers: ['Tanggal', 'Keterangan', 'Jumlah', 'Sisa'],
				roles: ['bookingDate', 'counterparty', 'amount', 'balance'],
				dateOrder: 'year-first',
				decimalMark: '.'
			},
			{ filename: 'before.csv', bytes: before, accountId: rowId('bank-drift') },
			testDb
		);
		expect(first.rowsAdded).toBe(3);

		// The same export, with a reference column inserted in the middle.
		const after = new TextEncoder().encode(
			[
				'Tanggal,Referensi,Keterangan,Jumlah,Sisa',
				'2026-04-14,REF-1,Gaji bulanan,1500000,2500000',
				'2026-04-15,REF-2,Belanja harian,-320500,2179500',
				'2026-04-16,REF-3,Tagihan listrik,-179500,2000000'
			].join('\n')
		);

		const preview = await previewLayout(after, {
			currency: 'IDR',
			profiles: () => loadProfiles(testDb)
		});
		expect(preview!.drift?.profileName).toBe('Mandiri current');
		expect(preview!.drift?.added).toEqual(['referensi']);

		// The columns it already knew arrive answered; only the new one is blank,
		// so confirming a changed export is a glance rather than the whole
		// questionnaire again.
		expect(preview!.roles).toEqual(['bookingDate', undefined, 'counterparty', 'amount', 'balance']);

		// Confirming replaces the old layout rather than leaving two for one bank.
		const second = await confirmMapping(
			{
				name: 'Mandiri current',
				supersedes: preview!.drift!.profileId,
				source: 'delimited',
				delimiter: ',',
				headers: preview!.headers,
				roles: ['bookingDate', 'reference', 'counterparty', 'amount', 'balance'],
				dateOrder: 'year-first',
				decimalMark: '.'
			},
			{ filename: 'after.csv', bytes: after, accountId: rowId('bank-drift') },
			testDb
		);
		expect(second.error).toBeUndefined();
		expect(second.rowsAdded).toBe(3);
		expect(await count('import_profile')).toBe(1);
	}, 30_000);

	it('refuses a confirmed mapping whose rows contradict the balances', async () => {
		// A mapping is not permission to skip the proof. Here the person names the
		// columns correctly and the file itself is inconsistent — its running
		// balance does not follow from its own movements — so it is refused
		// exactly as an inferred reading would be.
		const csv = [
			'Tanggal,Keterangan,Jumlah,Sisa',
			'2026-03-14,Gaji bulanan,1500000,2500000',
			'2026-03-15,Belanja harian,-320500,9999999',
			'2026-03-16,Tagihan listrik,-179500,1111111'
		].join('\n');
		const { confirmMapping } = await import('$lib/server/import/wizard');
		await insertAccount(rowId('bank-id2'), 'IDR', [], 'tabular');

		const result = await confirmMapping(
			{
				name: 'Broken export',
				source: 'delimited',
				delimiter: ',',
				headers: ['Tanggal', 'Keterangan', 'Jumlah', 'Sisa'],
				roles: ['bookingDate', 'counterparty', 'amount', 'balance'],
				dateOrder: 'year-first',
				decimalMark: '.'
			},
			{
				filename: 'broken.csv',
				bytes: new TextEncoder().encode(csv),
				accountId: rowId('bank-id2')
			},
			testDb
		);

		expect(result.rowsAdded).toBe(0);
		expect(result.error).toBeTruthy();
	}, 30_000);

	it('shows what a statement was checked against, in words', async () => {
		// The proof engine used to decide whether to file a statement and then
		// discard its reasoning, so "accepted" was something to take on trust.
		// These are the fields the evidence panel reads.
		const { ingestFile } = await import('$lib/server/import/ingest');
		const { PROOF_LABELS, sourceLabel } = await import('$lib/transactions/provenance');
		await insertAccount(rowId('fio-evidence'), 'CZK', ['1234567890/2010']);
		const source = new Uint8Array(await readFile(resolve('tests/fixtures/fio.csv')));

		await ingestFile('fio.csv', source, rowId('fio-evidence'), testDb);
		const [file] = await testDb.select().from(schema.importFile);

		expect(sourceLabel(file.sourceMethod)).toBe('bank format');
		expect(PROOF_LABELS[file.proofClass!]).toMatch(/opening and closing balances agree/i);

		// Only checks that said something are worth showing: "unavailable" means
		// the statement never printed that figure, which is neither evidence nor
		// a failure.
		const said = (file.reconciliation ?? []).filter((check) => check.status !== 'unavailable');
		expect(said.map((check) => check.name)).toEqual(['opening and closing', 'stated totals']);
		expect(said.every((check) => check.status === 'pass')).toBe(true);
	}, 30_000);

	it('records how each statement was read and what proved it', async () => {
		const { ingestFile } = await import('$lib/server/import/ingest');
		await insertAccount(rowId('fio-prov'), 'CZK', ['1234567890/2010']);
		const source = await readFile(resolve('tests/fixtures/fio.csv'));

		const result = await ingestFile('fio.csv', new Uint8Array(source), rowId('fio-prov'), testDb);
		expect(result.error).toBeUndefined();

		const [file] = await testDb.select().from(schema.importFile);
		// The Fio adapter is a verified mapping, and it now meets the same
		// arithmetic as everything else — this is the evidence it met.
		expect(file.sourceMethod).toBe('adapter');
		expect(file.proofClass).toBe('P2');
		expect(file.currency).toBe('CZK');
		expect(file.openingBalanceMinor).toBe(38_238n);
		expect(file.closingBalanceMinor).toBe(2_298_438n);
		expect(file.statedCreditTotalMinor).toBe(6_265_200n);
		expect(file.statedDebitTotalMinor).toBe(4_005_000n);

		// The individual checks, as an evidence panel would show them.
		const checks = file.reconciliation ?? [];
		expect(checks.map((check) => check.name)).toContain('opening and closing');
		expect(checks.find((check) => check.name === 'stated totals')?.status).toBe('pass');

		// And on every row, so a single transaction answers for its own origin.
		const rows = await testDb.select().from(schema.transaction);
		expect(rows).toHaveLength(5);
		expect(new Set(rows.map((row) => row.sourceMethod))).toEqual(new Set(['adapter']));
		expect(new Set(rows.map((row) => row.proofClass))).toEqual(new Set(['P2']));
	}, 30_000);

	it('refuses a chain whose first movement is missing, using the account as the anchor', async () => {
		// Revolut prints no opening balance, so its chain proves everything except
		// its own beginning: delete the FIRST movement and every remaining step
		// still follows, and the printed closing balance still agrees because the
		// sum and the start shift together. Only the account knows better.
		const header =
			'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance';
		const rows = [
			'Transfer,Current,2026-08-01 08:00:00,2026-08-01 08:00:00,Opening move,100.00,0.00,CZK,COMPLETED,1100.00',
			'Transfer,Current,2026-08-02 08:00:00,2026-08-02 08:00:00,Second move,50.00,0.00,CZK,COMPLETED,1150.00',
			'Transfer,Current,2026-08-03 08:00:00,2026-08-03 08:00:00,Third move,25.00,0.00,CZK,COMPLETED,1175.00'
		];
		const { ingestFile } = await import('$lib/server/import/ingest');

		await insertAccount(rowId('rev-czk'), 'CZK', [], 'revolut');
		// The account was left at 1000.00 on the day before this statement starts,
		// which is exactly the figure the complete chain begins from.
		await testDb
			.update(schema.account)
			.set({ balanceMinor: 100_000n, balanceOn: '2026-07-31' })
			.where(eq(schema.account.id, rowId('rev-czk')));

		const whole = new TextEncoder().encode([header, ...rows].join('\n'));
		const intact = await ingestFile('revolut-whole.csv', whole, rowId('rev-czk'), testDb);
		expect(intact.error).toBeUndefined();
		expect(intact.rowsAdded).toBe(3);

		// Now the same statement with its first movement removed. The chain still
		// closes on the two that remain.
		await testDb
			.update(schema.account)
			.set({ balanceMinor: 100_000n, balanceOn: '2026-07-31' })
			.where(eq(schema.account.id, rowId('rev-czk')));
		const truncated = new TextEncoder().encode([header, ...rows.slice(1)].join('\n'));
		const missing = await ingestFile('revolut-short.csv', truncated, rowId('rev-czk'), testDb);

		expect(missing.error).toMatch(/missing from the beginning/i);
		expect(missing.rowsAdded).toBe(0);
		// Nothing recorded, so the corrected file is not later refused as a duplicate.
		expect(await count('import_file')).toBe(1);
	}, 30_000);

	it('does not let a slower older statement overwrite a newer closing balance', async () => {
		await insertAccount(rowId('fio-czk'), 'CZK', ['1234567890/2010']);
		await harness.sql.unsafe(`
			create function task1_delay_old_import() returns trigger language plpgsql as $$
			begin
				if exists (
					select 1 from import_file source
					where source.id = new.import_file_id and source.filename = 'older-balance.txt'
				) and not exists (
					select 1 from "transaction" existing
					where existing.import_file_id = new.import_file_id
				) then
					perform pg_sleep(0.25);
				end if;
				return new;
			end $$;
			create trigger task1_delay_old_import before insert on "transaction"
			for each row execute function task1_delay_old_import();
		`);
		const { ingestFile } = await import('$lib/server/import/ingest');
		const source = new TextDecoder().decode(await readFile(resolve('tests/fixtures/fio.csv')));
		// Each statement has to add up on its own: the five movements come to
		// 22 602.00, so a different closing balance means a different opening one.
		// Moving only the closing figure leaves a file that contradicts itself,
		// which every route now refuses — rightly, and this test is not about
		// that.
		const older = new TextEncoder().encode(
			source
				.replace('01.07.2026 - 31.07.2026', '01.06.2026 - 30.06.2026')
				.replace(
					'Počáteční stav účtu k 01.07.2026: 382,38 CZK',
					'Počáteční stav účtu k 01.06.2026: -22502,00 CZK'
				)
				.replace(
					'Koncový stav účtu k 31.07.2026: 22984,38 CZK',
					'Koncový stav účtu k 30.06.2026: 100,00 CZK'
				)
		);
		const newer = new TextEncoder().encode(
			source
				.replace('01.07.2026 - 31.07.2026', '01.08.2026 - 31.08.2026')
				.replace(
					'Počáteční stav účtu k 01.07.2026: 382,38 CZK',
					'Počáteční stav účtu k 01.08.2026: -21603,00 CZK'
				)
				.replace(
					'Koncový stav účtu k 31.07.2026: 22984,38 CZK',
					'Koncový stav účtu k 31.08.2026: 999,00 CZK'
				)
		);

		const olderImport = ingestFile('older-balance.txt', older, rowId('fio-czk'), testDb);
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 40));
		const newerImport = ingestFile('newer-balance.txt', newer, rowId('fio-czk'), testDb);
		await Promise.all([olderImport, newerImport]);

		const [updated] = await testDb
			.select({ balance: schema.account.balanceMinor, asOf: schema.account.balanceOn })
			.from(schema.account);
		expect(updated).toEqual({ balance: 99_900n, asOf: '2026-08-31' });
	});

	it('pairs exact own-account evidence in historical statements', async () => {
		await insertAccount(rowId('historical-out-account'), 'CZK', ['11111111/0100']);
		await insertAccount(rowId('historical-in-account'), 'CZK', ['22222222/0300']);
		const { ingestFile } = await import('$lib/server/import/ingest');

		const outResult = await ingestFile(
			'historical-out.txt',
			fioStatement({
				accountNumber: '11111111/0100',
				bookedOn: '2019-04-05',
				amount: '-100.00',
				counterpartyAccount: '22222222/0300',
				bankRef: 'historical-out'
			}),
			rowId('historical-out-account'),
			testDb
		);
		const inResult = await ingestFile(
			'historical-in.txt',
			fioStatement({
				accountNumber: '22222222/0300',
				bookedOn: '2019-04-05',
				amount: '100.00',
				counterpartyAccount: '11111111/0100',
				bankRef: 'historical-in'
			}),
			rowId('historical-in-account'),
			testDb
		);

		expect([outResult.error, inResult.error]).toEqual([undefined, undefined]);
		expect(
			await testDb.select({ state: schema.transferPair.state }).from(schema.transferPair)
		).toEqual([{ state: 'auto' }]);
		const legs = await testDb
			.select({ pairId: schema.transaction.transferPairId })
			.from(schema.transaction);
		expect(legs).toHaveLength(2);
		expect(legs.every((leg) => leg.pairId !== null && leg.pairId === legs[0].pairId)).toBe(true);
	});

	it('pairs opposite transfer legs imported concurrently without a later retry', async () => {
		await insertAccount(rowId('racing-out-account'), 'CZK', ['33333333/0100']);
		await insertAccount(rowId('racing-in-account'), 'CZK', ['44444444/0300']);
		await harness.sql.unsafe(`
			create sequence task1_import_leg_arrivals;
			create function task1_delay_import_leg() returns trigger language plpgsql as $$
			declare
				arrival bigint;
			begin
				arrival := nextval('task1_import_leg_arrivals');
				if arrival = 1 then
					while (select last_value from task1_import_leg_arrivals) < 2 loop
						perform pg_sleep(0.005);
					end loop;
				end if;
				perform pg_sleep(0.15);
				return new;
			end $$;
			create trigger task1_delay_import_leg after insert on "transaction"
			for each row execute function task1_delay_import_leg();
		`);
		const { ingestFile } = await import('$lib/server/import/ingest');

		const results = await Promise.all([
			ingestFile(
				'racing-out.txt',
				fioStatement({
					accountNumber: '33333333/0100',
					bookedOn: '2026-08-05',
					amount: '-250.00',
					counterpartyAccount: '44444444/0300',
					bankRef: 'racing-out'
				}),
				rowId('racing-out-account'),
				testDb
			),
			ingestFile(
				'racing-in.txt',
				fioStatement({
					accountNumber: '44444444/0300',
					bookedOn: '2026-08-05',
					amount: '250.00',
					counterpartyAccount: '33333333/0100',
					bankRef: 'racing-in'
				}),
				rowId('racing-in-account'),
				testDb
			)
		]);

		expect(results.map((result) => result.error)).toEqual([undefined, undefined]);
		expect(
			await testDb.select({ state: schema.transferPair.state }).from(schema.transferPair)
		).toEqual([{ state: 'auto' }]);
		const legs = await testDb
			.select({ pairId: schema.transaction.transferPairId })
			.from(schema.transaction);
		expect(legs).toHaveLength(2);
		expect(legs.every((leg) => leg.pairId !== null && leg.pairId === legs[0].pairId)).toBe(true);
	});

	it('preserves a confirmed split when its opposite transfer leg arrives later', async () => {
		await insertAccount(rowId('split-out-account'), 'CZK', ['55555555/0100']);
		await insertAccount(rowId('split-in-account'), 'CZK', ['66666666/0300']);
		await testDb.insert(schema.category).values([
			{ id: rowId('split-first-category'), groupKey: 'living', name: 'Split first', sort: 1 },
			{ id: rowId('split-second-category'), groupKey: 'living', name: 'Split second', sort: 2 }
		]);
		const { ingestFile } = await import('$lib/server/import/ingest');
		const { saveSplits } = await import('$lib/server/splits');

		await ingestFile(
			'split-out.txt',
			fioStatement({
				accountNumber: '55555555/0100',
				bookedOn: '2026-08-06',
				amount: '-300.00',
				counterpartyAccount: '66666666/0300',
				bankRef: 'split-out'
			}),
			rowId('split-out-account'),
			testDb
		);
		const [out] = await testDb
			.select({ id: schema.transaction.id })
			.from(schema.transaction)
			.where(eq(schema.transaction.accountId, rowId('split-out-account')));
		await saveSplits(
			out.id,
			[
				{ amountMinor: 10_000n, categoryId: rowId('split-first-category') },
				{ amountMinor: 20_000n, categoryId: rowId('split-second-category') }
			],
			undefined,
			testDb
		);

		await ingestFile(
			'split-in.txt',
			fioStatement({
				accountNumber: '66666666/0300',
				bookedOn: '2026-08-06',
				amount: '300.00',
				counterpartyAccount: '55555555/0100',
				bankRef: 'split-in'
			}),
			rowId('split-in-account'),
			testDb
		);

		const [preserved] = await testDb
			.select({
				reviewState: schema.transaction.reviewState,
				pairId: schema.transaction.transferPairId
			})
			.from(schema.transaction)
			.where(eq(schema.transaction.id, out.id));
		expect(preserved).toEqual({ reviewState: 'confirmed', pairId: null });
		expect(await count('transaction_split')).toBe(2);
		expect(await count('transfer_pair')).toBe(0);
	});

	it('waits for a tag edit before pairing a newly imported opposite leg', async () => {
		await insertAccount(rowId('tagged-out-account'), 'CZK', ['77777777/0100']);
		await insertAccount(rowId('tagged-in-account'), 'CZK', ['88888888/0300']);
		await testDb.insert(schema.transaction).values({
			id: rowId('tagged-out'),
			accountId: rowId('tagged-out-account'),
			bookedOn: '2026-08-07',
			amountMinor: -40_000n,
			currency: 'CZK',
			counterpartyAccount: '88888888/0300',
			dedupFingerprint: rowId('tagged-out')
		});
		await harness.sql.unsafe(`
			create sequence task1_tag_lock_arrivals;
			create function task1_delay_transaction_tag() returns trigger language plpgsql as $$
			begin
				perform nextval('task1_tag_lock_arrivals');
				perform pg_sleep(0.2);
				return new;
			end $$;
			create trigger task1_delay_transaction_tag before insert on tag_link
			for each row execute function task1_delay_transaction_tag();
		`);
		const { updateTransactionTags } = await import('$lib/server/tags');
		const { ingestFile } = await import('$lib/server/import/ingest');

		const tagEdit = updateTransactionTags(rowId('tagged-out'), { add: 'Race tag' }, testDb);
		let tagLockReached = false;
		for (let attempt = 0; attempt < 100; attempt++) {
			const [arrival] = await harness.sql<{ is_called: boolean }[]>`
				select is_called from task1_tag_lock_arrivals
			`;
			if (arrival.is_called) {
				tagLockReached = true;
				break;
			}
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
		}
		expect(tagLockReached).toBe(true);
		const oppositeImport = ingestFile(
			'tagged-in.txt',
			fioStatement({
				accountNumber: '88888888/0300',
				bookedOn: '2026-08-07',
				amount: '400.00',
				counterpartyAccount: '77777777/0100',
				bankRef: 'tagged-in'
			}),
			rowId('tagged-in-account'),
			testDb
		);
		await Promise.all([tagEdit, oppositeImport]);

		expect(
			await testDb.select({ state: schema.transferPair.state }).from(schema.transferPair)
		).toEqual([{ state: 'auto' }]);
		expect(await count('tag_link')).toBe(1);
	});

	it('rolls back a proposal transition when either leg update fails', async () => {
		await insertAccount(rowId('proposal-out-account'), 'CZK');
		await insertAccount(rowId('proposal-in-account'), 'CZK');
		await testDb.insert(schema.transaction).values([
			{
				id: rowId('proposal-out'),
				accountId: rowId('proposal-out-account'),
				bookedOn: '2026-08-01',
				amountMinor: -10_000n,
				currency: 'CZK',
				dedupFingerprint: rowId('proposal-out'),
				reviewReason: 'looks like a transfer between your own accounts'
			},
			{
				id: rowId('proposal-in'),
				accountId: rowId('proposal-in-account'),
				bookedOn: '2026-08-01',
				amountMinor: 10_000n,
				currency: 'CZK',
				dedupFingerprint: rowId('proposal-in'),
				reviewReason: 'looks like a transfer between your own accounts'
			}
		]);
		await testDb.insert(schema.transferPair).values({
			id: rowId('proposal'),
			outTransactionId: rowId('proposal-out'),
			inTransactionId: rowId('proposal-in'),
			state: 'proposed'
		});
		await harness.sql.unsafe(`
			create function task1_fail_leg_update() returns trigger language plpgsql as $$
			begin
				if new.id = '${rowId('proposal-in')}' and new.transfer_pair_id is not null then
					raise exception 'injected proposal leg failure';
				end if;
				return new;
			end $$;
			create trigger task1_fail_leg_update before update on "transaction"
			for each row execute function task1_fail_leg_update();
		`);
		const { confirmTransferProposal } = await import('$lib/server/import/transfer-decisions');

		await expect(confirmTransferProposal(rowId('proposal-out'), testDb)).rejects.toThrow();

		expect(await testDb.select().from(schema.transferPair)).toMatchObject([
			{ id: rowId('proposal'), state: 'proposed' }
		]);
		const legs = await testDb
			.select({
				id: schema.transaction.id,
				pairId: schema.transaction.transferPairId,
				reviewState: schema.transaction.reviewState
			})
			.from(schema.transaction)
			.orderBy(schema.transaction.id);
		// As a SET: ids are uuids since 0053, so their order is not the fixture's.
		expect([...legs].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
			[
				{ id: rowId('proposal-in'), pairId: null, reviewState: 'needs_review' },
				{ id: rowId('proposal-out'), pairId: null, reviewState: 'needs_review' }
			].sort((a, b) => a.id.localeCompare(b.id))
		);
	});

	it('rolls back rejection when recategorising a released leg fails', async () => {
		await insertAccount(rowId('reject-out-account'), 'CZK');
		await insertAccount(rowId('reject-in-account'), 'CZK');
		await testDb.insert(schema.transaction).values([
			{
				id: rowId('reject-out'),
				accountId: rowId('reject-out-account'),
				bookedOn: '2026-08-01',
				amountMinor: -10_000n,
				currency: 'CZK',
				dedupFingerprint: rowId('reject-out'),
				reviewReason: 'looks like a transfer between your own accounts'
			},
			{
				id: rowId('reject-in'),
				accountId: rowId('reject-in-account'),
				bookedOn: '2026-08-01',
				amountMinor: 10_000n,
				currency: 'CZK',
				dedupFingerprint: rowId('reject-in'),
				reviewReason: 'looks like a transfer between your own accounts'
			}
		]);
		await testDb.insert(schema.transferPair).values({
			id: rowId('reject-pair'),
			outTransactionId: rowId('reject-out'),
			inTransactionId: rowId('reject-in'),
			state: 'proposed'
		});
		await harness.sql.unsafe(`
			create function task1_fail_leg_update() returns trigger language plpgsql as $$
			begin
				if old.review_reason = 'transfer rejected — pick a category'
					and new.review_reason is distinct from old.review_reason then
					raise exception 'injected recategorisation failure';
				end if;
				return new;
			end $$;
			create trigger task1_fail_leg_update before update on "transaction"
			for each row execute function task1_fail_leg_update();
		`);
		const { rejectTransferProposal } = await import('$lib/server/import/transfer-decisions');

		await expect(rejectTransferProposal(rowId('reject-out'), testDb)).rejects.toThrow();

		expect(await testDb.select().from(schema.transferPair)).toMatchObject([
			{ id: rowId('reject-pair'), state: 'proposed' }
		]);
		const legs = await testDb
			.select({ id: schema.transaction.id, reason: schema.transaction.reviewReason })
			.from(schema.transaction)
			.orderBy(schema.transaction.id);
		// As a SET: ids are uuids since 0053, so their order is not the fixture's.
		const byId = <T extends { id: string }>(rows: T[]) =>
			[...rows].sort((a, b) => a.id.localeCompare(b.id));
		expect(byId(legs)).toEqual(
			byId([
				{ id: rowId('reject-in'), reason: 'looks like a transfer between your own accounts' },
				{ id: rowId('reject-out'), reason: 'looks like a transfer between your own accounts' }
			])
		);
		expect(await count('transfer_pair_leg')).toBe(2);
	});

	it('allows only one concurrent decision on a proposed transfer', async () => {
		await insertAccount(rowId('decision-out-account'), 'CZK');
		await insertAccount(rowId('decision-in-account'), 'CZK');
		await testDb.insert(schema.transaction).values([
			{
				id: rowId('decision-out'),
				accountId: rowId('decision-out-account'),
				bookedOn: '2026-08-01',
				amountMinor: -10_000n,
				currency: 'CZK',
				dedupFingerprint: rowId('decision-out')
			},
			{
				id: rowId('decision-in'),
				accountId: rowId('decision-in-account'),
				bookedOn: '2026-08-01',
				amountMinor: 10_000n,
				currency: 'CZK',
				dedupFingerprint: rowId('decision-in')
			}
		]);
		await testDb.insert(schema.transferPair).values({
			id: rowId('decision-pair'),
			outTransactionId: rowId('decision-out'),
			inTransactionId: rowId('decision-in'),
			state: 'proposed'
		});
		await harness.sql.unsafe(`
			create function task1_delay_pair_transition() returns trigger language plpgsql as $$
			begin
				perform pg_sleep(0.15);
				return new;
			end $$;
			create trigger task1_delay_pair_transition before update of state on transfer_pair
			for each row when (old.state = 'proposed') execute function task1_delay_pair_transition();
		`);
		const { confirmTransferProposal, rejectTransferProposal } =
			await import('$lib/server/import/transfer-decisions');

		const results = await Promise.all([
			confirmTransferProposal(rowId('decision-out'), testDb),
			rejectTransferProposal(rowId('decision-out'), testDb)
		]);
		expect(results.filter((result) => 'ok' in result && result.ok)).toHaveLength(1);
		expect(results.filter((result) => 'status' in result && result.status === 404)).toHaveLength(1);

		const [pair] = await testDb.select().from(schema.transferPair);
		const legs = await testDb
			.select({ pairId: schema.transaction.transferPairId })
			.from(schema.transaction)
			.orderBy(schema.transaction.id);
		if (pair.state === 'confirmed') {
			expect(legs).toEqual([
				{ pairId: rowId('decision-pair') },
				{ pairId: rowId('decision-pair') }
			]);
			expect(await count('transfer_pair_leg')).toBe(2);
		} else {
			expect(pair.state).toBe('rejected');
			expect(legs).toEqual([{ pairId: null }, { pairId: null }]);
			expect(await count('transfer_pair_leg')).toBe(0);
		}
	});

	it('lets concurrent pairing claim each transaction leg at most once', async () => {
		await insertAccount(rowId('out-account'), 'CZK', ['11111111/0100']);
		await insertAccount(rowId('in-account'), 'CZK', ['22222222/0300']);
		await testDb.insert(schema.transaction).values([
			{
				id: rowId('out-leg'),
				accountId: rowId('out-account'),
				bookedOn: '2026-08-01',
				amountMinor: -10000n,
				currency: 'CZK',
				counterpartyAccount: '22222222/0300',
				dedupFingerprint: rowId('out-leg')
			},
			{
				id: rowId('in-leg'),
				accountId: rowId('in-account'),
				bookedOn: '2026-08-01',
				amountMinor: 10000n,
				currency: 'CZK',
				dedupFingerprint: rowId('in-leg')
			}
		]);
		await harness.sql.unsafe(`
			create function task1_delay_pair_insert() returns trigger language plpgsql as $$
			begin
				perform pg_sleep(0.15);
				return new;
			end $$;
			create trigger task1_delay_pair_insert before insert on transfer_pair
			for each row execute function task1_delay_pair_insert();
		`);
		const { pairAndCategorise } = await import('$lib/server/import/ingest');

		await Promise.all([pairAndCategorise(testDb), pairAndCategorise(testDb)]);

		expect(await count('transfer_pair')).toBe(1);
		const claims = await harness.sql<{ transaction_id: string; claims: number }[]>`
			select leg.transaction_id, count(*)::int as claims
			from (
				select out_transaction_id as transaction_id from transfer_pair where state <> 'rejected'
				union all
				select in_transaction_id as transaction_id from transfer_pair where state <> 'rejected'
			) leg
			group by leg.transaction_id
			order by leg.transaction_id
		`;
		// Compared as a SET: the query orders by transaction_id, and ids are uuids
		// since 0053, so their order says nothing a reader would predict.
		expect([...claims].sort((a, b) => a.transaction_id.localeCompare(b.transaction_id))).toEqual(
			[
				{ transaction_id: rowId('in-leg'), claims: 1 },
				{ transaction_id: rowId('out-leg'), claims: 1 }
			].sort((a, b) => a.transaction_id.localeCompare(b.transaction_id))
		);
	});

	it('serialises pairing before any concurrent categorisation pass', async () => {
		await testDb.insert(schema.person).values({
			id: rowId('pairing-person'),
			name: 'Robert Kiewisz',
			initials: 'RK',
			passwordHash: 'not-used'
		});
		await testDb.insert(schema.account).values([
			{
				id: rowId('locked-auto-out-account'),
				name: 'Auto out',
				bank: 'fio',
				currency: 'CZK',
				numbers: ['11111111/0100']
			},
			{
				id: rowId('locked-auto-in-account'),
				name: 'Auto in',
				bank: 'fio',
				currency: 'CZK',
				numbers: ['22222222/0300']
			},
			{
				id: rowId('locked-review-out-account'),
				name: 'Review out',
				bank: 'revolut',
				currency: 'CZK'
			},
			{
				id: rowId('locked-review-in-account'),
				name: 'Review in',
				bank: 'rb',
				currency: 'CZK'
			}
		]);
		await testDb.insert(schema.category).values({
			id: rowId('locked-rule-category'),
			groupKey: 'living',
			name: 'Must not win',
			sort: 1
		});
		await testDb.insert(schema.rule).values({
			id: rowId('locked-amount-rule'),
			name: 'Broad amount rule',
			enabled: true,
			conditions: [
				{
					field: 'amount',
					op: 'between',
					min: '5000',
					max: '25000',
					currency: 'CZK'
				}
			],
			categoryId: rowId('locked-rule-category'),
			acceptedCount: 6,
			correctedCount: 0
		});
		await testDb.insert(schema.transaction).values([
			{
				id: rowId('locked-auto-out'),
				accountId: rowId('locked-auto-out-account'),
				bookedOn: '2026-08-01',
				amountMinor: -10_000n,
				currency: 'CZK',
				counterpartyAccount: '22222222/0300',
				dedupFingerprint: rowId('locked-auto-out')
			},
			{
				id: rowId('locked-auto-in'),
				accountId: rowId('locked-auto-in-account'),
				bookedOn: '2026-08-01',
				amountMinor: 10_000n,
				currency: 'CZK',
				dedupFingerprint: rowId('locked-auto-in')
			},
			{
				id: rowId('locked-review-out'),
				accountId: rowId('locked-review-out-account'),
				bookedOn: '2026-08-02',
				amountMinor: -20_000n,
				currency: 'CZK',
				counterparty: 'Robert Kiewisz',
				dedupFingerprint: rowId('locked-review-out')
			},
			{
				id: rowId('locked-review-in'),
				accountId: rowId('locked-review-in-account'),
				bookedOn: '2026-08-02',
				amountMinor: 20_000n,
				currency: 'CZK',
				dedupFingerprint: rowId('locked-review-in')
			}
		]);
		await harness.sql.unsafe(`
			create function task1_delay_pair_insert() returns trigger language plpgsql as $$
			begin
				perform pg_sleep(0.15);
				return new;
			end $$;
			create trigger task1_delay_pair_insert before insert on transfer_pair
			for each row execute function task1_delay_pair_insert();
		`);
		const { pairAndCategorise } = await import('$lib/server/import/ingest');

		const firstPass = pairAndCategorise(testDb);
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 40));
		const secondPass = pairAndCategorise(testDb);
		await Promise.all([firstPass, secondPass]);

		const rows = await testDb
			.select({
				id: schema.transaction.id,
				categoryId: schema.transaction.categoryId,
				reviewState: schema.transaction.reviewState,
				pairId: schema.transaction.transferPairId
			})
			.from(schema.transaction)
			.orderBy(schema.transaction.id);
		// As a SET: ids are uuids since 0053, so their order is not the fixture's.
		const sorted = <T extends { id: string }>(r: T[]) =>
			[...r].sort((a, b) => a.id.localeCompare(b.id));
		expect(sorted(rows)).toEqual(
			sorted([
				{
					id: rowId('locked-auto-in'),
					categoryId: null,
					reviewState: 'auto',
					pairId: expect.any(String)
				},
				{
					id: rowId('locked-auto-out'),
					categoryId: null,
					reviewState: 'auto',
					pairId: expect.any(String)
				},
				{
					id: rowId('locked-review-in'),
					categoryId: null,
					reviewState: 'needs_review',
					pairId: null
				},
				{
					id: rowId('locked-review-out'),
					categoryId: null,
					reviewState: 'needs_review',
					pairId: null
				}
			])
		);
		const pairs = await testDb
			.select({ state: schema.transferPair.state })
			.from(schema.transferPair)
			.orderBy(schema.transferPair.state);
		expect(pairs).toEqual([{ state: 'auto' }, { state: 'proposed' }]);
	});

	it('applies a base-currency amount rule during import categorisation', async () => {
		await insertAccount(rowId('rule-account'), 'CZK');
		await testDb.insert(schema.category).values({
			id: rowId('rule-category'),
			groupKey: 'living',
			name: 'Rule category',
			sort: 1
		});
		await testDb.insert(schema.rule).values({
			id: rowId('amount-rule'),
			name: 'CZK amount rule',
			enabled: true,
			conditions: [
				{
					field: 'amount',
					op: 'between',
					min: '10000',
					max: '20000',
					currency: 'CZK'
				}
			],
			categoryId: rowId('rule-category'),
			acceptedCount: 6,
			correctedCount: 0
		});
		await testDb.insert(schema.transaction).values({
			id: rowId('rule-transaction'),
			accountId: rowId('rule-account'),
			bookedOn: '2026-08-01',
			amountMinor: -15_000n,
			currency: 'CZK',
			dedupFingerprint: rowId('rule-transaction')
		});
		const { loadRules, autoThreshold } = await import('$lib/server/rules');
		const { decideWithRules } = await import('$lib/rules/match');
		const loadedRules = await loadRules(testDb);
		expect(loadedRules).toMatchObject([
			{
				id: rowId('amount-rule'),
				enabled: true,
				conditions: [
					{
						field: 'amount',
						min: '10000',
						max: '20000',
						currency: 'CZK'
					}
				],
				categoryId: rowId('rule-category'),
				acceptedCount: 6
			}
		]);
		expect(
			decideWithRules(
				{ amountMinor: -15_000n, currency: 'CZK' },
				loadedRules,
				await autoThreshold(testDb)
			)
		).toMatchObject({ kind: 'auto', categoryId: rowId('rule-category') });
		const { pairAndCategorise } = await import('$lib/server/import/ingest');

		await pairAndCategorise(testDb);

		expect(await testDb.select().from(schema.transaction)).toMatchObject([
			{
				id: rowId('rule-transaction'),
				categoryId: rowId('rule-category'),
				reviewState: 'auto'
			}
		]);
	});

	// Filing one row used to row-lock and compare the entire unpaired ledger.
	// The window bounds that to the changed row's neighbourhood; unlike the
	// today-anchored horizon it replaces, it does not care how old the row is.
	it('bounds a pairing pass to the neighbourhood of what changed', async () => {
		const { pairingWindowAround } = await import('$lib/server/import/ingest');

		expect(pairingWindowAround(['2021-03-10'])).toEqual({
			from: '2021-03-03',
			to: '2021-03-17'
		});
		expect(pairingWindowAround(['2026-01-31', '2026-01-02'])).toEqual({
			from: '2025-12-26',
			to: '2026-02-07'
		});
		// No dates means no bound rather than an empty range that pairs nothing.
		expect(pairingWindowAround([])).toBeNull();
	});
});

/**
 * A CAMT.053 file holding two statements for two different accounts — the
 * shape a bank produces when you export "all accounts" at once.
 */
function multiAccountCamt(): Uint8Array {
	const entry = (amount: string, ind: 'CRDT' | 'DBIT', date: string, ccy: string, ref: string) => `
		<Ntry>
			<Amt Ccy="${ccy}">${amount}</Amt>
			<CdtDbtInd>${ind}</CdtDbtInd>
			<BookgDt><Dt>${date}</Dt></BookgDt>
			<ValDt><Dt>${date}</Dt></ValDt>
			<AcctSvcrRef>${ref}</AcctSvcrRef>
		</Ntry>`;
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
	<BkToCstmrStmt>
		<Stmt>
			<Id>CZK-1</Id>
			<Acct><Id><IBAN>CZ6955000000000093531803</IBAN></Id><Ccy>CZK</Ccy></Acct>
			<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="CZK">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2025-03-01</Dt></Dt></Bal>
			<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="CZK">1150.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2025-03-31</Dt></Dt></Bal>
			${entry('50.00', 'DBIT', '2025-03-03', 'CZK', 'CZK-A')}
			${entry('200.00', 'CRDT', '2025-03-04', 'CZK', 'CZK-B')}
		</Stmt>
		<Stmt>
			<Id>EUR-1</Id>
			<Acct><Id><IBAN>CZ2010000000002500834780</IBAN></Id><Ccy>EUR</Ccy></Acct>
			<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2025-03-01</Dt></Dt></Bal>
			<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">35.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2025-03-31</Dt></Dt></Bal>
			${entry('25.00', 'CRDT', '2025-03-05', 'EUR', 'EUR-A')}
		</Stmt>
	</BkToCstmrStmt>
</Document>`;
	return new TextEncoder().encode(xml);
}
