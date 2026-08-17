import iconv from 'iconv-lite';
import { parseFio } from './adapters/fio';
import { parseRevolut } from './adapters/revolut';
import { parseMbank } from './adapters/mbank';
import { parseRbLines } from './adapters/rb';
import { parseCsLines } from './adapters/cs';
import { extractPdfLines } from './pdftext';
import { parseAbo } from './standards/abo';
import { parseMt940 } from './standards/mt940';
import { parseCamt053 } from './standards/camt053';
import { candidateGrids } from './tabular/grid';
import { chooseGrid } from './tabular/regions';
import { readTabular } from './tabular/statement';
import { decideImport, proveStatement } from './proof';
import { headersOf, matchProfile, rolesFromProfile, type ImportProfile } from './tabular/profile';
import { FORMAT_LABEL, sniffFormat, type StatementFormat } from './format';
import { assertSafeToParse } from './safety';
import type { ParsedStatement } from './types';

/**
 * A statement that prints a change in its own balance but yields no movements
 * was not read — it was misread, and silently.
 *
 * This is not hypothetical. Raiffeisenbank's January 2025 template writes its
 * dates without spaces; the adapter required them, matched no movement line,
 * and returned a statement with correct balances and zero rows. Nothing
 * complained. The file imported "successfully", its content hash was recorded,
 * and the corrected re-import would then have been refused as a duplicate —
 * losing a month of real transactions behind a clean success message.
 *
 * An empty month is legitimate, so the test is not "no rows": it is "no rows
 * while the statement's own arithmetic says money moved".
 */
function assertRowsExplainTheBalance(statement: ParsedStatement): ParsedStatement {
	const { openingBalanceMinor: opening, closingBalanceMinor: closing, rows } = statement;
	if (rows.length > 0) return statement;
	if (opening === undefined || closing === undefined) return statement;
	if (opening === closing) return statement;
	const moved = closing - opening;
	throw new Error(
		`This ${statement.bank} statement reports a balance change of ${moved < 0n ? '-' : ''}${(moved < 0n ? -moved : moved).toString().replace(/(\d{2})$/, '.$1')} ${statement.currency} but no transactions could be read from it. The layout has probably changed. The file has not been imported.`
	);
}

/**
 * Sniff the bank and format from the file body and parse it. Throws a
 * user-facing Error when nothing matches.
 */
export interface ParseOptions {
	/**
	 * Layouts this household has confirmed, fetched lazily.
	 *
	 * A function rather than an array because profiles matter only for a layout
	 * no adapter recognises — which is rare. Loading them eagerly put a query on
	 * the path of every import, including the ones that never look at a profile,
	 * and coupled the whole ingest path to a table that need not exist yet.
	 */
	profiles?: () => Promise<ImportProfile[]>;
}

export async function detectAndParseAll(
	buffer: Uint8Array,
	options: ParseOptions = {}
): Promise<ParsedStatement[]> {
	const sniff = sniffFormat(buffer);
	assertSafeToParse(buffer, sniff.format);
	const parsed = await parseByFormat(buffer, sniff.format, options);
	const statements = Array.isArray(parsed) ? parsed : [parsed];
	return statements.map(assertRowsExplainTheBalance);
}

/**
 * One statement from one file — the shape every current parser produces.
 *
 * CAMT.053 carries several `<Stmt>` blocks and a workbook can hold a sheet per
 * account, so the pipeline's real entry point is `detectAndParseAll`. This
 * wrapper exists because nothing yet produces more than one, and it refuses
 * rather than silently discarding the rest the day something does.
 */
export async function detectAndParse(buffer: Uint8Array): Promise<ParsedStatement> {
	const statements = await detectAndParseAll(buffer);
	if (statements.length > 1) {
		throw new Error(
			`That file contains ${statements.length} statements. Importing several from one file is being built.`
		);
	}
	return statements[0];
}

/**
 * Formats we can name but cannot yet read. Saying which one it is beats
 * "unrecognised": the user learns their export is understood and simply not
 * covered, which is a different problem from a corrupt file.
 */
const NOT_YET_READABLE: Partial<Record<StatementFormat, string>> = {
	xml: 'This is XML, but not a CAMT.053 statement.',
	ofx: 'OFX/QFX support is being built.',
	ods: 'OpenDocument spreadsheets are not read yet — export as CSV or XLSX.',
	xls: 'Legacy .xls workbooks are not read yet — re-save as .xlsx.',
	image: 'Reading statements from photographs and scans is being built.'
};

/** A parser may return one statement or many; callers normalise to an array. */
async function parseByFormat(
	buffer: Uint8Array,
	format: StatementFormat,
	options: ParseOptions = {}
): Promise<ParsedStatement | ParsedStatement[]> {
	const pending = NOT_YET_READABLE[format];
	if (pending) throw new Error(pending);

	if (format === 'unknown') {
		throw new Error('That file is not a statement in any format Continuum recognises.');
	}

	if (format === 'camt053') {
		// CAMT is UTF-8 by specification; the BOM is stripped by the reader.
		return parseCamt053(new TextDecoder('utf-8', { fatal: false }).decode(buffer));
	}

	if (format === 'mt940') {
		// MT940 is ASCII by specification; a bank that slips diacritics in still
		// decodes here, since win1250 agrees with ASCII on every SWIFT character.
		return parseMt940(iconv.decode(Buffer.from(buffer), 'win1250'));
	}

	if (format === 'abo') {
		// ABO is win1250 when it carries diacritics and ASCII otherwise; decoding
		// as win1250 is safe for both, since ASCII is a subset.
		return parseAbo(iconv.decode(Buffer.from(buffer), 'win1250'));
	}

	if (format === 'pdf') {
		const lines = await extractPdfLines(buffer);
		const text = lines.map((l) => l.cells.join(' ')).join('\n');
		// Sniff the issuer from the statement's own header, not from anywhere in
		// the document. Both banks print their name deep in the body — in the
		// real samples "Raiffeisenbank" first appears on line 57 and "Česká
		// spořitelna" on line 54 — so an anywhere-substring test also fires on a
		// counterparty's bank mentioned in someone else's statement. That routed
		// the file to the wrong parser, which read zero rows, minted an account
		// for a bank the user does not have, and recorded the content hash, so
		// the correct re-import was then refused as a duplicate.
		//
		// The title line and the account's BIC both sit in the first dozen lines
		// and belong to the issuer: RZBCCZPP is Raiffeisenbank, GIBACZPX is
		// Česká spořitelna. "Výpis z účtu" is not a substring of "Výpis z
		// běžného účtu", so the two titles cannot cross-match.
		const head = lines
			.slice(0, 24)
			.map((l) => l.cells.join(' '))
			.join('\n');
		if (/RZBCCZPP|Výpis z běžného účtu/.test(head)) return parseRbLines(lines);
		if (/GIBACZPX|Výpis z účtu/.test(head)) return parseCsLines(lines);

		// Header unrecognised — a template may have moved. Fall back to the bank
		// name anywhere in the file, but only when exactly one bank is named:
		// an ambiguous document is a misroute waiting to happen, and a clear
		// error beats a silent zero-row parse under the wrong bank.
		const namesRb = text.includes('Raiffeisenbank');
		const namesCs = text.includes('Česká spořitelna');
		if (namesRb && !namesCs) return parseRbLines(lines);
		if (namesCs && !namesRb) return parseCsLines(lines);
		throw new Error('PDF statement from an unrecognised bank.');
	}

	if (format === 'xlsx') {
		throw new Error('This looks like an XLSX broker report — investment import lands in Phase 2.');
	}

	const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
	const head = utf8.slice(0, 2000);

	if (head.includes('Výpis č.') && head.includes('z účtu')) return parseFio(utf8);
	if (head.startsWith('Type,Product,Started Date') || head.includes('Type,Product,Started Date')) {
		return parseRevolut(utf8);
	}
	// mBank ships windows-1250; its signature survives any decoding.
	if (head.includes('mBank') || head.includes('#Numer rachunku')) {
		return parseMbank(iconv.decode(Buffer.from(buffer), 'win1250'));
	}

	// No bank matched. Read it generically — and file it ONLY if the statement
	// proves itself. The hand-written adapters above are verified mappings, a
	// human having checked each one against real exports; an unknown layout has
	// no such warrant, so arithmetic is the only thing standing between a
	// plausible misreading and the ledger.
	const generic = await readGenerically(buffer, options.profiles);
	if (generic.statements.length > 0) return generic.statements;

	throw new Error(
		generic.reason ??
			`This is ${FORMAT_LABEL[format] === 'delimited text' ? 'a delimited text file' : `a ${FORMAT_LABEL[format]}`}, but it matches no bank Continuum knows.`
	);
}

/**
 * The generic tabular reader, behind the proof gate.
 *
 * Returns statements only when each proves itself and the reading left nothing
 * ambiguous. Otherwise it returns the reason, phrased as the specific thing
 * that could not be settled — which is what the mapping wizard will ask about
 * rather than a shrug.
 */
async function readGenerically(
	buffer: Uint8Array,
	loadProfiles?: () => Promise<ImportProfile[]>
): Promise<{ statements: ParsedStatement[]; reason?: string }> {
	const choice = chooseGrid(candidateGrids(buffer));
	if (!choice) {
		return { statements: [], reason: 'No table of dated movements could be found in that file.' };
	}
	// Only now — a file that never reaches here never pays for the lookup.
	const profiles = loadProfiles ? await loadProfiles() : [];

	const statements: ParsedStatement[] = [];
	const reasons: string[] = [];

	for (const region of choice.transactions) {
		// A remembered layout answers the questions a person already answered.
		const headers = headersOf(region);
		const match = headers.length ? matchProfile(headers, profiles) : ({ kind: 'none' } as const);
		const guided =
			match.kind === 'match'
				? {
						roles: rolesFromProfile(match.profile, headers),
						dateOrder: match.profile.mapping.dateOrder,
						decimalMark: match.profile.mapping.decimalMark,
						currency: match.profile.mapping.currency
					}
				: {};

		if (match.kind === 'drifted') {
			reasons.push(
				`the layout for ${match.profile.name} changed — ${match.added.length} column(s) appeared and ${match.removed.length} went away`
			);
		}

		const reading = readTabular(choice, region, guided);
		if (!reading.statement) {
			reasons.push(reading.questions.map((q) => q.reason).join('; '));
			continue;
		}
		const proof = proveStatement(reading.statement, {
			currency: reading.statement.currency,
			// The displayed text, not the parsed values — a scale error leaves no
			// trace once the numbers have been parsed.
			amountTexts: reading.amountTexts,
			decimalMarkSettled: reading.decimalMark !== undefined,
			dateOrderSettled: reading.dateOrder !== undefined
		});
		const decision = decideImport(proof, reading.questions.length, {
			verifiedProfile: match.kind === 'match' && match.profile.verified
		});
		if (decision.autoImport) statements.push(reading.statement);
		else reasons.push(`${decision.reason} (${proof.proofClass})`);
	}

	if (statements.length > 0) return { statements };
	return {
		statements: [],
		reason: reasons.length
			? `That layout was read, but not confidently enough to file: ${reasons[0]}.`
			: undefined
	};
}
