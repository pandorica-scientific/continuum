// SPDX-License-Identifier: AGPL-3.0-or-later
import iconv from 'iconv-lite';
import { parseFio } from './adapters/fio';
import { parseRevolut } from './adapters/revolut';
import { parseMbank } from './adapters/mbank';
import { parseRbLines } from './adapters/rb';
import { parseCsLines } from './adapters/cs';
import { extractPdfLines } from './pdftext';
import { parseAbo } from './standards/abo';
import { parseOfx } from './standards/ofx';
import { parseMt940 } from './standards/mt940';
import { parseCamt053 } from './standards/camt053';
import { candidateGrids, gridsFromWorkbook, type Grid } from './tabular/grid';
import {
	chooseGrid,
	detectRegions,
	transactionRows,
	type GridChoice,
	type Region
} from './tabular/regions';
import { readTabular } from './tabular/statement';
import {
	PROOF_RANK,
	accountsForWholeFile,
	decideImport,
	proveStatement,
	type ProofClass
} from './proof';
import { headersOf, matchProfile, rolesFromProfile, type ImportProfile } from './tabular/profile';
import type { ColumnRole } from './tabular/vocabulary';
import type { DateOrder, DecimalMark } from './tabular/determinacy';
import { gridsFromPdfLines } from './tabular/frompdf';
import { gridsFromRhythm } from './tabular/rhythm';
import { looksLikeHoldings } from './holdings';
import { OCR_LANGUAGES, languagesFor, ocrAvailable, ocrImage, ocrPdf } from './ocr';
import { FORMAT_LABEL, sniffFormat, type StatementFormat } from './format';
import { formatMinor, isCurrencyCode } from '$lib/money';
import { assertSafeToParse } from './safety';
import type { ParsedStatement, PdfLine } from './types';

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
		`This ${statement.bank} statement reports a balance change of ${formatMinor(moved, statement.currency)} but no transactions could be read from it. The layout has probably changed. The file has not been imported.`
	);
}

/**
 * Grids assembled from a reading of the PAGE, tagged as such.
 *
 * The two assemblers stamp their own origin — `pdf-geometry`, `pdf-rhythm` —
 * and an OCR reading goes through exactly those two, so a row recovered from
 * pixels reached the ledger labelled as though its table had come from the
 * text layer. `transaction.sourceMethod` exists so that "everything that came
 * from OCR" is a query rather than a guess, and the register offers precisely
 * that filter; it matched nothing, because nothing ever wrote the value.
 *
 * The origin is REPLACED rather than extended. Which assembler ran is implied
 * by the reading and is not what the column is for; that the figures came from
 * pixels is the reliability-relevant fact worth selecting on. A compound
 * `ocr-pdf-rhythm` would break the same equality filter a second time.
 */
const gridsFromPixels = (scanned: PdfLine[]): Grid[][] =>
	[gridsFromPdfLines(scanned), gridsFromRhythm(scanned)].map((group) =>
		group.map((grid) => ({ ...grid, origin: 'ocr' }))
	);

/**
 * Every route into the ledger meets the same arithmetic.
 *
 * A hand-written adapter is a VERIFIED MAPPING — a person checked these columns
 * against a real export — and that earns it the right to skip discovery. It
 * does not earn the right to skip proof. The two are different claims: "these
 * columns mean what I say" is not "every movement on this page is in my
 * output", and only the second one protects the ledger.
 *
 * Measured before this existed: deleting one movement from a Fio, mBank,
 * Revolut, MT940 or CAMT.053 statement — each of which prints its own closing
 * balance — was accepted without a word. A statement one row short of a hundred
 * reconciles against nothing, and nothing looked.
 *
 * Only CONTRADICTED evidence throws. A statement that prints no balances at all
 * is not wrong, it is unprovable, and refusing it would reject formats that are
 * simply terse.
 */
function assertAgreesWithItsOwnNumbers(
	statement: ParsedStatement,
	method = 'adapter'
): ParsedStatement {
	// A currency is three letters. Anything else is a reader defect that has
	// escaped its own module — a label, a heading, a fragment of a metadata row
	// — and it must never become the denomination of a stored transaction,
	// because everything downstream treats it as fact.
	if (!isCurrencyCode(statement.currency)) {
		throw new Error(
			`This ${statement.bank} statement was read with "${statement.currency}" as its currency, which is not a currency, so it has not been imported.`
		);
	}
	const proof = proveStatement(statement, { currency: statement.currency });
	const failed = proof.checks.filter((check) => check.status === 'fail');
	if (failed.length === 0) {
		return {
			...statement,
			provenance: {
				method,
				proofClass: proof.proofClass,
				ledgerModel: proof.chainModel,
				checks: proof.checks
			}
		};
	}
	throw new Error(
		`This ${statement.bank} statement does not agree with its own figures, so it has not been imported: ${failed
			.map((check) => check.detail)
			.join('; ')}.`
	);
}

/**
 * Fio's movement list, as opposed to its statement.
 *
 * The FULL ordered header, not a substring of it. `detect.ts` already records
 * what a loose signature costs: `#Numer rachunku` is merely Polish for "account
 * number", and it claimed 120 unrelated files in a 486-file corpus. "Datum" and
 * "Objem" would do the same to every Czech CSV ever exported.
 */
function isFioMovementList(head: string): boolean {
	const columns = [
		'Datum',
		'Objem',
		'Měna',
		'Protiúčet',
		'Kód banky',
		'Zpráva pro příjemce',
		'Poznámka',
		'Typ'
	];
	const line = head.split(/\r?\n/, 1)[0] ?? '';
	const found = line.split(';').map((cell) =>
		cell
			.replace(/^\ufeff/, '')
			.replace(/^"|"$/g, '')
			.trim()
	);
	return found.length === columns.length && columns.every((name, i) => found[i] === name);
}

/**
 * An adapter's claim on a file is a hypothesis, not a verdict.
 *
 * The signatures are substrings of ordinary text. `#Numer rachunku` is simply
 * Polish for "account number", so the mBank adapter claimed every Polish-locale
 * CSV in a 486-file corpus — 120 files — and then either died with "transaction
 * header not found" or, worse, returned a statement with ZERO rows and a
 * currency read off a metadata label. Nothing fell through to the generic
 * reader, because the adapter had already returned.
 *
 * So: when an adapter claims a file and finds no movements in it, try reading
 * it as an unknown layout before believing there were none. An empty month is
 * legitimate and rare; a misroute is neither.
 */
async function adapterOrGeneric(
	run: () => ParsedStatement | ParsedStatement[],
	readAsUnknownLayout: () => Promise<{ statements: ParsedStatement[]; reason?: string }>
): Promise<ParsedStatement[]> {
	let statements: ParsedStatement[];
	try {
		const produced = run();
		statements = Array.isArray(produced) ? produced : [produced];
	} catch (error) {
		// The adapter claimed the file and then could not read it — "transaction
		// header not found" and its kind. That is the strongest possible evidence
		// that the signature matched something it did not write, so it must not
		// end the import.
		const generic = await readAsUnknownLayout();
		if (generic.statements.length > 0) return generic.statements;
		// Nothing read it. Say what the general reader made of it rather than
		// what the adapter complained about: its claim on this file was never
		// established, so naming that bank in the error points the person who
		// uploaded it at an institution they may have nothing to do with.
		throw generic.reason ? new Error(generic.reason) : error;
	}

	const rows = statements.reduce((total, statement) => total + statement.rows.length, 0);
	if (rows > 0) return statements.map((statement) => assertAgreesWithItsOwnNumbers(statement));

	const generic = await readAsUnknownLayout();
	if (generic.statements.length > 0) return generic.statements;

	// Nothing read it. Keep the adapter's own account of itself, which knows
	// whether the balances say movements were missed.
	return statements.map(assertRowsExplainTheBalance);
}

/**
 * Sniff the bank and format from the file body and parse it. Throws a
 * user-facing Error when nothing matches.
 */
interface ParseOptions {
	/**
	 * Layouts this household has confirmed, fetched lazily.
	 *
	 * A function rather than an array because profiles matter only for a layout
	 * no adapter recognises — which is rare. Loading them eagerly put a query on
	 * the path of every import, including the ones that never look at a profile,
	 * and coupled the whole ingest path to a table that need not exist yet.
	 */
	profiles?: () => Promise<ImportProfile[]>;
	/**
	 * Allow reading a PDF from its pixels when the text layer cannot be proven.
	 *
	 * Off by default because rendering and recognising costs seconds per page,
	 * and nothing that slow belongs on a request the user is waiting on. The
	 * background reader turns it on.
	 */
	ocr?: boolean;
	/**
	 * The destination account's currency.
	 *
	 * A statement is imported INTO an account the user created and whose
	 * currency they stated, so that is the authority — never a symbol or a label
	 * found in the document. Absent only for the first import of an account that
	 * does not exist yet, which is exactly where a question belongs.
	 */
	currency?: string;
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
 * Formats we can name but cannot yet read. Saying which one it is beats
 * "unrecognised": the user learns their export is understood and simply not
 * covered, which is a different problem from a corrupt file.
 */
const NOT_YET_READABLE: Partial<Record<StatementFormat, string>> = {
	xml: 'This is XML, but not a CAMT.053 statement.',
	// Not "being built". QIF records a date, an amount, a payee and a memo, and
	// nothing else: no opening balance, no closing balance, no totals, no count.
	// There is nothing in the file for the arithmetic to check, so a QIF could
	// only ever be taken on trust — which is the one thing this reader does not
	// do. Saying so is more useful than implying it is coming.
	qif: 'A QIF file records movements but no balances, so nothing in it can be checked against anything. Export CSV, OFX, CAMT.053 or MT940 from the same bank instead — all of them carry the figures that make an import verifiable.',
	ods: 'OpenDocument spreadsheets are not read yet — export as CSV or XLSX.',
	xls: 'Legacy .xls workbooks are not read yet — re-save as .xlsx.'
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
		return parseCamt053(new TextDecoder('utf-8', { fatal: false }).decode(buffer)).map(
			(statement) => assertAgreesWithItsOwnNumbers(statement, 'standard')
		);
	}

	if (format === 'mt940') {
		// MT940 is ASCII by specification; a bank that slips diacritics in still
		// decodes here, since win1250 agrees with ASCII on every SWIFT character.
		return parseMt940(iconv.decode(Buffer.from(buffer), 'win1250')).map((statement) =>
			assertAgreesWithItsOwnNumbers(statement, 'standard')
		);
	}

	if (format === 'ofx') {
		// OFX 1.x is SGML and OFX 2.x is XML; both are ASCII-compatible, and a
		// bank that slips a diacritic into a payee name still decodes here.
		return parseOfx(iconv.decode(Buffer.from(buffer), 'win1250')).map((statement) =>
			assertAgreesWithItsOwnNumbers(statement, 'standard')
		);
	}

	if (format === 'abo') {
		// ABO is win1250 when it carries diacritics and ASCII otherwise; decoding
		// as win1250 is safe for both, since ASCII is a subset.
		return parseAbo(iconv.decode(Buffer.from(buffer), 'win1250')).map((statement) =>
			assertAgreesWithItsOwnNumbers(statement, 'standard')
		);
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
		// Two assemblers, one arbiter.
		//
		// `gridsFromPdfLines` reads a table by deciding which lines start a
		// movement; `gridsFromRhythm` never classifies a line and instead finds
		// the page's record beat. Neither dominates — the first reads a 140-row
		// CaixaBank statement the second fragments, and the second reads four
		// banks the first cannot — so both are offered as candidate readings and
		// the proof engine chooses, exactly as it chooses between encodings and
		// delimiters.
		const readPdfAsUnknownLayout = () =>
			readGenerically(
				buffer,
				options.profiles,
				[gridsFromPdfLines(lines), gridsFromRhythm(lines)],
				options.currency
			);
		if (/RZBCCZPP|Výpis z běžného účtu/.test(head))
			return adapterOrGeneric(() => parseRbLines(lines), readPdfAsUnknownLayout);
		if (/GIBACZPX|Výpis z účtu/.test(head))
			return adapterOrGeneric(() => parseCsLines(lines), readPdfAsUnknownLayout);

		// Header unrecognised — a template may have moved. Fall back to the bank
		// name anywhere in the file, but only when exactly one bank is named:
		// an ambiguous document is a misroute waiting to happen, and a clear
		// error beats a silent zero-row parse under the wrong bank.
		const namesRb = text.includes('Raiffeisenbank');
		const namesCs = text.includes('Česká spořitelna');
		if (namesRb && !namesCs)
			return adapterOrGeneric(() => parseRbLines(lines), readPdfAsUnknownLayout);
		if (namesCs && !namesRb)
			return adapterOrGeneric(() => parseCsLines(lines), readPdfAsUnknownLayout);
		// A portfolio statement is a legitimate document that simply is not a bank
		// statement. Saying so beats "no transactions found", which is true and
		// useless, and lets the caller offer to file it elsewhere.
		const holdings = looksLikeHoldings(text);
		if (holdings.isHoldings) throw new Error(holdings.reason!);

		// No bank matched. Recover a table from the page geometry and read it
		// generically — behind the same proof gate as any other unknown layout.
		const generic = await readGenerically(
			buffer,
			options.profiles,
			[gridsFromPdfLines(lines), gridsFromRhythm(lines)],
			options.currency
		);
		if (generic.statements.length > 0) return generic.statements;

		// The text layer could not be proven. Read the PAGE instead — an
		// independent look at the same pixels — and keep whichever read
		// reconciles. Never a splice of the two: a row assembled from both exists
		// in neither, and would carry the confidence of a clean read.
		if (options.ocr && ocrAvailable()) {
			const scanned = await ocrPdf(buffer, languagesFor(text));
			const fromPixels = await readGenerically(
				buffer,
				options.profiles,
				gridsFromPixels(scanned),
				options.currency
			);
			if (fromPixels.statements.length > 0) return fromPixels.statements;
			throw new Error(
				`Neither the text in this PDF nor a reading of the page itself could be checked against its balances. ${fromPixels.reason ?? generic.reason ?? ''}`.trim()
			);
		}

		throw new Error(generic.reason ?? 'This PDF is from a bank Continuum does not recognise.');
	}

	if (format === 'xlsx') {
		// A workbook is a table like any other: one grid per sheet, then the same
		// regions, determinacy and proof as a CSV.
		// One group per sheet, collected rather than chosen between: a workbook may
		// hold a statement per account, and they are not competing accounts of the
		// same thing.
		const fromSheets = await readGenerically(
			buffer,
			options.profiles,
			gridsFromWorkbook(buffer).map((sheet) => [sheet]),
			options.currency,
			'collect'
		);
		if (fromSheets.statements.length > 0) return fromSheets.statements;
		throw new Error(
			`${fromSheets.reason ?? 'No statement could be read from that workbook.'} If it is a broker report, investments read those separately.`
		);
	}

	if (format === 'image') {
		if (!options.ocr) {
			throw new Error(
				'Reading a photographed statement takes a few seconds, so it happens in the background — this file has not been read yet.'
			);
		}
		if (!ocrAvailable()) {
			throw new Error(
				'Reading statements from photographs needs the OCR language data. Run "npm run fetch:tessdata" once, or rebuild the image.'
			);
		}
		const scanned = await ocrImage(buffer, OCR_LANGUAGES);
		const fromPixels = await readGenerically(
			buffer,
			options.profiles,
			gridsFromPixels(scanned),
			options.currency
		);
		if (fromPixels.statements.length > 0) return fromPixels.statements;
		throw new Error(fromPixels.reason ?? 'No statement could be read from that photograph.');
	}

	const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
	const head = utf8.slice(0, 2000);

	const readTextAsUnknownLayout = () =>
		readGenerically(buffer, options.profiles, undefined, options.currency);

	if (head.includes('Výpis č.') && head.includes('z účtu')) {
		return adapterOrGeneric(() => parseFio(utf8), readTextAsUnknownLayout);
	}
	if (isFioMovementList(head)) {
		// Refused by name rather than offered the mapping wizard. The wizard asks
		// "what are these columns", and the columns are not the problem: this
		// export prints no balance of any kind, so nothing in it can show whether
		// every row is there. It is P0 by construction, and decideImport refuses
		// P0 even for a mapping somebody confirmed — correctly, and that rule
		// stands. Sending them to a screen where no answer can succeed is what
		// was wrong.
		throw new Error(
			'This is Fio’s “Pohyby na účtu” export. It lists movements but prints no balances, ' +
				'so nothing in it can show whether every row is there. In Internetbanking choose ' +
				'“Výpis z účtu” instead — same account, and it prints the opening and closing balances.'
		);
	}
	if (head.startsWith('Type,Product,Started Date') || head.includes('Type,Product,Started Date')) {
		return adapterOrGeneric(() => parseRevolut(utf8), readTextAsUnknownLayout);
	}
	// mBank ships windows-1250; its signature survives any decoding.
	if (head.includes('mBank') || head.includes('#Numer rachunku')) {
		return adapterOrGeneric(
			() => parseMbank(iconv.decode(Buffer.from(buffer), 'win1250')),
			readTextAsUnknownLayout
		);
	}

	// No bank matched. Read it generically — and file it ONLY if the statement
	// proves itself. The hand-written adapters above are verified mappings, a
	// human having checked each one against real exports; an unknown layout has
	// no such warrant, so arithmetic is the only thing standing between a
	// plausible misreading and the ledger.
	const generic = await readGenerically(buffer, options.profiles, undefined, options.currency);
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
	loadProfiles?: () => Promise<ImportProfile[]>,
	/**
	 * Grids recovered from somewhere other than the raw bytes, grouped by the
	 * assembler that produced them. Evidence is shared inside a group and never
	 * across one.
	 */
	prebuilt?: Grid[][],
	/** The destination account's currency, when the import names one. */
	accountCurrency?: string,
	/**
	 * What the groups ARE, which decides what to do when several of them read.
	 *
	 * `choose` — the groups are alternative readings of one document, and at most
	 * one of them is right. A PDF read by two assemblers, a delimited file under
	 * two encodings.
	 *
	 * `collect` — the groups are separate parts, each potentially its own
	 * statement. A workbook with a sheet per account is the case: picking a
	 * winner there is not arbitration, it is losing an account. That happened —
	 * a two-account workbook imported one of them, recorded the content hash, and
	 * the corrected re-upload was then refused as a duplicate.
	 */
	combine: 'choose' | 'collect' = 'choose'
): Promise<{ statements: ParsedStatement[]; reason?: string }> {
	// One group per assembly of the document.
	//
	// Delimited candidates are ALTERNATIVE decodings of the same bytes, so each
	// stands alone: at most one of them is the file, and letting one reading's
	// balances judge another's rows manufactures a contradiction out of two
	// perfectly consistent readings.
	//
	// A PDF is read by two assemblers that both see the whole document, and
	// within one assembly a balance printed on page one is legitimately
	// available to a table found on page three. Across assemblies it is not —
	// they extract the SAME furniture differently, and one of them can be wrong.
	// Sharing across them cost a five-movement statement its proof: read with its
	// own evidence it is P4 with every check passing, and read with the other
	// assembler's stated totals it is P0.
	const groups: Grid[][] = prebuilt ?? candidateGrids(buffer).map((grid) => [grid]);

	const readings: { statements: ParsedStatement[]; amounts: string[]; proofClass: ProofClass }[] =
		[];
	let firstReason: string | undefined;
	/**
	 * Set when some part of the document read into a statement and then failed
	 * the proof gate, as opposed to simply not being found.
	 */
	let refusedReason: string | undefined;

	// Asked once per FILE, not once per candidate grid. The thunk exists so a
	// file that never needs a profile never pays for the lookup; awaiting it
	// inside the per-grid loop turned that one saved query into a dozen
	// identical ones.
	let remembered: Promise<ImportProfile[]> | undefined;
	const profilesOnce = loadProfiles ? () => (remembered ??= loadProfiles()) : undefined;

	for (const group of groups) {
		const evidence = group.flatMap((grid) => detectRegions(grid));
		for (const candidate of group) {
			const attempt = await readOneGrid([candidate], profilesOnce, evidence, accountCurrency);
			if (attempt.statements.length > 0) {
				readings.push({
					statements: attempt.statements,
					// What the reading CLAIMS, reduced to the part that must not
					// differ: the movements themselves. Text may differ between two
					// decodings of the same bytes without either being wrong.
					amounts: attempt.statements
						.flatMap((statement) =>
							statement.rows.map((row) => String(row.amountMinor - (row.feeMinor ?? 0n)))
						)
						.sort(),
					proofClass: attempt.proofClass ?? 'P0'
				});
			} else {
				if (attempt.refused && !refusedReason) refusedReason = attempt.reason;
				if (!firstReason) firstReason = attempt.reason;
			}
		}
	}

	// A REFUSAL outranks whatever the first candidate happened to complain about.
	// Reporting `firstReason` told the person holding a Komerční banka statement
	// that "every day and month is 12 or lower ... nothing settles the order",
	// which was true of a fragment that lost and irrelevant to why the file was
	// turned away: the statement had been read completely and then failed the
	// proof gate. The reason shown has to be the one that decided the outcome.
	if (readings.length === 0) return { statements: [], reason: refusedReason ?? firstReason };

	// Separate parts: every one of them belongs in the ledger.
	if (combine === 'collect') {
		// Which is exactly why one of them failing cannot be shrugged off. These
		// groups are not rival accounts of one document — a workbook holds a sheet
		// per account — so filing the sheets that proved and dropping the one that
		// did not imports part of a file and records its content hash, and the
		// corrected re-upload is then refused as a duplicate. That precise failure
		// is already recorded a few lines up for a two-account workbook.
		//
		// A sheet that yielded NO statement is a different thing: workbooks carry
		// summary and notes sheets that were never movements, and refusing a file
		// over one of those would refuse most real workbooks. Only a sheet that was
		// read and then failed the gate counts.
		if (refusedReason) return { statements: [], reason: refusedReason };
		return { statements: readings.flatMap((reading) => reading.statements) };
	}

	// Proof first, then coverage — and disagreement is a question.
	//
	// This used to sort by row count alone and keep the fullest, which is a
	// heuristic deciding what the arithmetic was supposed to decide. On a
	// Raiffeisenbank statement one assembly yields 44 movements and another 43;
	// the 43 reconcile against the printed closing balance and the 44 do not, so
	// "most rows wins" prefers exactly the wrong one. Ranking by proof class
	// first puts that right, because the 44-row reading never proves itself.
	//
	// Coverage still breaks ties, and it must.
	//
	// Genuine ambiguity is the remaining case: two readings that are EQUALLY
	// COMPLETE, equally proven, and disagree about the movements. Then the file
	// really can be read more than one way and the person who owns it should
	// say which.
	//
	// Completeness is what separates that from a fragment. One real eight-page
	// statement yields a 140-row assembly and, from a different column choice, a
	// 5-row one; both close a running chain, because a chain over five rows is
	// trivially easy to close. Five rows is not a rival account of an eight-page
	// document, it is an incomplete one, and the fuller reading wins without a
	// question.
	const rank = (reading: (typeof readings)[number]) => PROOF_RANK[reading.proofClass];
	readings.sort((a, b) => rank(b) - rank(a) || b.amounts.length - a.amounts.length);
	const best = readings[0];
	const fingerprint = (reading: (typeof readings)[number]) => reading.amounts.join(',');

	const rival = readings.find(
		(reading) =>
			reading !== best &&
			rank(reading) === rank(best) &&
			reading.amounts.length === best.amounts.length &&
			fingerprint(reading) !== fingerprint(best)
	);
	if (rival) {
		return {
			statements: [],
			reason: `this file can be read two different ways, each with ${best.amounts.length} movements that agree with their own figures, so which of them it actually contains is undecided`
		};
	}
	return { statements: best.statements };
}

async function readOneGrid(
	grids: Grid[],
	loadProfiles?: () => Promise<ImportProfile[]>,
	evidenceRegions?: Region[],
	accountCurrency?: string
): Promise<{
	statements: ParsedStatement[];
	reason?: string;
	proofClass?: ProofClass;
	/**
	 * A statement WAS read here and then failed the proof gate — as distinct
	 * from "nothing that looked like a statement was found", which is an
	 * ordinary miss. Only the first is evidence that filing what did read would
	 * file part of a document.
	 */
	refused?: boolean;
}> {
	const choice = chooseGrid(grids);
	if (!choice) {
		return { statements: [], reason: 'No table of dated movements could be found in that file.' };
	}
	// Only now — a file that never reaches here never pays for the lookup.
	const profiles = loadProfiles ? await loadProfiles() : [];

	const statements: ParsedStatement[] = [];
	const reasons: string[] = [];
	let weakest: ProofClass | undefined;
	/** The first region that read and then failed the gate, decided after the loop. */
	let refusal: string | undefined;

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

		// The account outranks the document. A statement is always imported INTO
		// an account whose currency the user stated when they created it; what the
		// page appears to say is corroboration. Reading it off the page produced
		// `#Numer rachunku` — a Polish column heading — as an ISO currency code.
		const reading = readTabular(choice, region, {
			...guided,
			currency: accountCurrency ?? guided.currency,
			evidenceRegions
		});
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
		if (decision.autoImport) {
			statements.push({
				...reading.statement,
				provenance: {
					method: choice.grid.origin ?? choice.grid.source,
					proofClass: proof.proofClass,
					ledgerModel: proof.chainModel,
					checks: proof.checks
				}
			});
			// The weakest link: a reading is only as good as its least-proven part.
			if (!weakest || PROOF_RANK[proof.proofClass] < PROOF_RANK[weakest]) {
				weakest = proof.proofClass;
			}
		} else {
			// Proof is taken per region; the decision to file used to be taken per
			// FILE, and the two disagreed. `regions.ts` splits wherever the column
			// shape changes and a multi-page statement prints furniture between its
			// pages, so several transaction regions is the ordinary case, not an
			// exotic one. Three regions proving and a fourth failing therefore
			// filed three quarters of a statement and reported success — and the
			// file's content hash is recorded on success, so the corrected
			// re-upload is refused as a duplicate. `frompdf.ts` calls that the
			// worst outcome this system can produce.
			//
			// `ingest.ts` already settles the same argument for a statement that
			// cannot be assigned to an account: "Importing what resolved and asking
			// about the rest sounds friendlier, but it records the file's content
			// hash". Same argument, same answer — the inconsistency was the bug.
			//
			// This refuses the READING, not the file. Where the caller holds
			// alternative readings of one document — the two PDF assemblers, two
			// candidate encodings — the other one is still free to read the whole
			// thing cleanly and win, which is the arbitration this reader is built
			// on. What can no longer happen is a partial reading being filed as
			// though it were whole.
			//
			// Recorded rather than returned, because "a region failed" is not the
			// same question as "is anything missing". Returning here discarded
			// regions that had ALREADY accounted for every movement in the file: a
			// balance-by-date recap reads as a table of movements, fails on its own
			// arithmetic because its figures are balances, and took a complete
			// statement down with it. `accountsForWholeFile` settles it after every
			// region has been seen — see its docblock for why arithmetic can answer
			// this without recognising what the failing region was.
			refusal ??= `That layout was read, but not confidently enough to file: ${decision.reason} (${proof.proofClass}).`;
		}
	}

	// A refusal stands unless what read leaves nothing unaccounted for.
	if (refusal && !accountsForWholeFile(statements)) {
		return { statements: [], refused: true, reason: refusal };
	}

	if (statements.length > 0) return { statements, proofClass: weakest };
	return {
		statements: [],
		reason: reasons.length
			? `That layout was read, but not confidently enough to file: ${reasons[0]}.`
			: undefined
	};
}

/**
 * What the reader saw in a file it could not file.
 *
 * A refusal is the right answer when a layout cannot prove itself, but it is a
 * dead end for the person holding the statement: the reader worked out a table,
 * found columns, and then threw all of it away with the error. There was no way
 * to say "the fourth column is the amount" because nothing survived to point at.
 *
 * This returns the best candidate reading whether or not it proved itself, so a
 * mapping can be built on top of it. It decides nothing and imports nothing —
 * everything it returns is a proposal for a person to correct, and whatever
 * they confirm still has to pass the same arithmetic as any other reading.
 */
interface LayoutPreview {
	/** The header labels, which are what a profile is keyed on. */
	headers: string[];
	/** Roles the reader inferred, in header order, for the person to correct. */
	roles: (ColumnRole | undefined)[];
	/** A few body rows, so the mapping can be checked against real values. */
	sample: string[][];
	source: 'delimited' | 'xlsx';
	encoding?: string;
	delimiter?: string;
	dateOrder?: DateOrder;
	decimalMark?: DecimalMark;
	/** What stopped it, phrased for the person who uploaded the file. */
	questions: string[];
	/**
	 * The layout this nearly is, when a saved profile almost fits.
	 *
	 * A bank adding a column is the commonest change there is, and it is the one
	 * that must never pass silently — matching by position would shift every role
	 * one to the right and read plausibly. Matching by label turns it into this:
	 * a named difference, and a mapping already filled in with the answers the
	 * person gave last time, so confirming a changed export is a glance rather
	 * than the whole questionnaire again.
	 */
	drift?: {
		profileId: string;
		profileName: string;
		added: string[];
		removed: string[];
	};
}

export async function previewLayout(
	buffer: Uint8Array,
	options: ParseOptions = {}
): Promise<LayoutPreview | null> {
	const format = sniffFormat(buffer).format;
	// The same boundary the reading path crosses, for the same bytes.
	//
	// This is the ONE route the interface offers for a file that was refused,
	// and a workbook refused for expanding to 900 MB is exactly such a file: the
	// queue keeps its payload so it can be mapped by hand, and "Map its columns"
	// handed those bytes straight to SheetJS with no size, entry-count, ratio,
	// nesting or real-inflation check. The guard has to sit on every door into
	// the parsers, not on the first one.
	assertSafeToParse(buffer, format);
	const grids =
		format === 'xlsx'
			? gridsFromWorkbook(buffer)
			: format === 'pdf'
				? await (async () => {
						const lines = await extractPdfLines(buffer);
						return [...gridsFromPdfLines(lines), ...gridsFromRhythm(lines)];
					})()
				: candidateGrids(buffer);

	// The fullest table anyone found. Not the best-proven — nothing here proved
	// itself, which is why we are asking.
	let best: { choice: GridChoice; region: Region; rows: number } | undefined;
	for (const grid of grids) {
		const choice = chooseGrid([grid]);
		if (!choice) continue;
		for (const region of choice.transactions) {
			const rows = transactionRows(region).length;
			if (!best || rows > best.rows) best = { choice, region, rows };
		}
	}
	if (!best) return null;

	const reading = readTabular(best.choice, best.region, {
		currency: options.currency,
		evidenceRegions: grids.flatMap((grid) => detectRegions(grid))
	});

	// A layout we nearly know. `matchProfile` already works out exactly what
	// changed; this carries it through so the answers can be pre-filled.
	const headersForMatch = headersOf(best.region);
	const profiles = options.profiles ? await options.profiles() : [];
	const match = headersForMatch.length
		? matchProfile(headersForMatch, profiles)
		: ({ kind: 'none' } as const);
	const drift =
		match.kind === 'drifted'
			? {
					profileId: match.profile.id,
					profileName: match.profile.name,
					added: match.added,
					removed: match.removed
				}
			: undefined;
	const body = transactionRows(best.region);

	// `headersOf` falls back to the first row that is not a movement, so a
	// layout whose labels nothing recognised still has something to point at —
	// and the profile saved from it is keyed on the same labels the matcher will
	// look for next time.
	const headers = headersOf(best.region);

	// A drifted profile already knows most of these columns; only the ones it has
	// never seen are left for the person to answer.
	const remembered =
		match.kind === 'drifted' ? rolesFromProfile(match.profile, headers) : undefined;

	return {
		headers,
		roles: headers.map((_, at) => remembered?.[at] ?? reading.roles[at]),
		sample: body.slice(0, 5).map((row) => row.map((cell) => cell.text)),
		source: best.choice.grid.source,
		encoding: best.choice.grid.encoding,
		delimiter: best.choice.grid.delimiter,
		dateOrder: reading.dateOrder,
		decimalMark: reading.decimalMark,
		questions: reading.questions.map((question) => question.reason),
		drift
	};
}
