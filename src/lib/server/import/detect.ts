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
import { candidateGrids, gridsFromWorkbook, type Grid } from './tabular/grid';
import { chooseGrid, detectRegions, type Region } from './tabular/regions';
import { readTabular } from './tabular/statement';
import { PROOF_RANK, decideImport, proveStatement, type ProofClass } from './proof';
import { headersOf, matchProfile, rolesFromProfile, type ImportProfile } from './tabular/profile';
import { gridsFromPdfLines } from './tabular/frompdf';
import { gridsFromRhythm } from './tabular/rhythm';
import { looksLikeHoldings } from './holdings';
import { OCR_LANGUAGES, languagesFor, ocrAvailable, ocrImage, ocrPdf } from './ocr';
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
	if (!/^[A-Z]{3}$/.test(statement.currency)) {
		throw new Error(
			`This ${statement.bank} statement was read with "${statement.currency}" as its currency, which is not a currency code, so it has not been imported.`
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
		throw error;
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
				[gridsFromPdfLines(scanned), gridsFromRhythm(scanned)],
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
		const fromSheets = await readGenerically(
			buffer,
			options.profiles,
			[gridsFromWorkbook(buffer)],
			options.currency
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
			[gridsFromPdfLines(scanned), gridsFromRhythm(scanned)],
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
	accountCurrency?: string
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

	for (const group of groups) {
		const evidence = group.flatMap((grid) => detectRegions(grid));
		for (const candidate of group) {
			const attempt = await readOneGrid([candidate], loadProfiles, evidence, accountCurrency);
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
			} else if (!firstReason) firstReason = attempt.reason;
		}
	}

	if (readings.length === 0) return { statements: [], reason: firstReason };

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
): Promise<{ statements: ParsedStatement[]; reason?: string; proofClass?: ProofClass }> {
	const choice = chooseGrid(grids);
	if (!choice) {
		return { statements: [], reason: 'No table of dated movements could be found in that file.' };
	}
	// Only now — a file that never reaches here never pays for the lookup.
	const profiles = loadProfiles ? await loadProfiles() : [];

	const statements: ParsedStatement[] = [];
	const reasons: string[] = [];
	let weakest: ProofClass | undefined;

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
		} else reasons.push(`${decision.reason} (${proof.proofClass})`);
	}

	if (statements.length > 0) return { statements, proofClass: weakest };
	return {
		statements: [],
		reason: reasons.length
			? `That layout was read, but not confidently enough to file: ${reasons[0]}.`
			: undefined
	};
}
