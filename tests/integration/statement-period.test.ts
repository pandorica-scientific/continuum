// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which months a filed statement says it covers.
 *
 * The coverage ribbon draws periods, and before this an accepted import filed
 * its document with `period_on` left null — the parser held `periodStart` and
 * `periodEnd` and dropped them. Both are OPTIONAL on `ParsedStatement` and most
 * readers never set them, so persisting what the file states is necessary and
 * not sufficient: the movements just written are the fallback, and every
 * accepted import has movements.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { document } from '$lib/server/db/schema';
import { ingestFile } from '$lib/server/import/ingest';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let db: TestDb;
let previousUrl: string | undefined;
let previousDirectory: string | undefined;
let accountId: string;
const DIRECTORY = resolve('scratch-workspace/statement-period-uploads');

const cz = (iso: string): string => {
	const [y, m, d] = iso.split('-');
	return `${d}.${m}.${y}`;
};

/**
 * A Fio export. `period` omitted leaves out the line the reader takes a stated
 * period from, which is the common case across formats — an ABO file names no
 * period at all.
 */
function fioStatement(options: {
	period?: { start: string; end: string };
	rows: string[];
}): Uint8Array {
	const lines = [`"Výpis č. 1/2026 z účtu ""2600123456/2010"""`];
	if (options.period) {
		lines.push(`"Období: ${cz(options.period.start)} - ${cz(options.period.end)}"`);
	}
	lines.push(
		`"Počáteční stav účtu k ${cz(options.rows[0])}: 0,00 CZK"`,
		// The reader refuses a statement that does not agree with its own figures,
		// so the closing balance has to be the movements added up.
		`"Koncový stav účtu k ${cz(options.rows[options.rows.length - 1])}: ${(options.rows.length * 100).toFixed(2).replace('.', ',')} CZK"`,
		'',
		'"ID operace";"Datum";"Objem";"Měna";"Protiúčet";"Název protiúčtu";"Kód banky";"Název banky";"KS";"VS";"SS";"Poznámka";"Zpráva pro příjemce";"Typ"'
	);
	options.rows.forEach((day, index) => {
		lines.push(
			`"op-${index}";"${cz(day)}";"100,00";"CZK";"9999999999";"";"0800";"";"";"";"";"";"";"Bezhotovostní platba"`
		);
	});
	return new TextEncoder().encode(lines.join('\n'));
}

/** The document an import filed, with the two dates the ribbon reads. */
async function filedStatement(filename: string) {
	const rows = await db
		.select({ id: document.id, periodOn: document.periodOn, periodEndOn: document.periodEndOn })
		.from(document)
		.where(eq(document.type, 'bank_statement'));
	expect(rows, filename).toHaveLength(1);
	return rows[0];
}

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
	await mkdir(DIRECTORY, { recursive: true });
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('statement-period', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	db = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	await rm(DIRECTORY, { recursive: true, force: true });
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
	if (previousDirectory === undefined) delete process.env.UPLOAD_DIR;
	else process.env.UPLOAD_DIR = previousDirectory;
});

beforeEach(async () => {
	await harness.sql`truncate document cascade`;
	await harness.sql`truncate import_file cascade`;
	await harness.sql`truncate account cascade`;
	// `bank: 'fio'`, because the reader refuses to file a fio statement against
	// an account belonging to another institution — the guard that stops one
	// bank's export landing in another bank's ledger.
	accountId = (await makeAccount(db, { bank: 'fio', currency: 'CZK', numbers: [] })).id;
});

describe('a statement filed by an accepted import', () => {
	it('takes the period the file states about itself', async () => {
		// A statement running the 15th to the 14th covers two months, and the
		// stated period is what says so — the movements inside it could not.
		const csv = fioStatement({
			period: { start: '2026-04-15', end: '2026-05-14' },
			rows: ['2026-04-20', '2026-05-02']
		});
		const result = await ingestFile('stated.csv', csv, accountId, db);
		expect(result.error).toBeUndefined();

		// Snapped to whole months: the shelf works in months, and `period_on` is
		// constrained to the first of one. April and May, which is what a 15th-to-
		// 14th statement actually accounts for.
		const filed = await filedStatement('stated.csv');
		expect(filed.periodOn).toBe('2026-04-01');
		expect(filed.periodEndOn).toBe('2026-05-31');
	});

	it('falls back to the movements it just imported when the file states none', async () => {
		// Month granularity is what makes this safe: a statement covering all of
		// April whose first movement is the 3rd still resolves to April.
		const csv = fioStatement({ rows: ['2026-04-03', '2026-04-27'] });
		const result = await ingestFile('unstated.csv', csv, accountId, db);
		expect(result.error).toBeUndefined();

		const filed = await filedStatement('unstated.csv');
		expect(filed.periodOn).toBe('2026-04-01');
		expect(filed.periodEndOn).toBe('2026-04-30');
	});
});
