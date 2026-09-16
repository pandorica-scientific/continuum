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
import { OCR_LANGUAGES, missingLanguageDataMessage, ocrAvailable } from '$lib/server/ocr';
import { languagesFor, ocrImage, ocrPdf } from './ocr';
import { FORMAT_LABEL, sniffFormat, type StatementFormat } from './format';
import { formatMinor, isCurrencyCode } from '$lib/money';
import { assertSafeToParse } from './safety';
import type { ParsedStatement, PdfLine } from './types';

/**
 * A statement that prints a balance change but yields no movements was
 * misread, not empty. An empty month is legitimate, so the test is not "no
 * rows": it is "no rows while the statement's own arithmetic says money moved".
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
 * The origin is REPLACED (not appended) with 'ocr' so `sourceMethod` stays an
 * equality filter — "everything that came from OCR" — rather than needing to
 * match compound values like `ocr-pdf-rhythm`. Which assembler ran is implied
 * by the reading; that the figures came from pixels is what's worth selecting on.
 */
const gridsFromPixels = (scanned: PdfLine[]): Grid[][] =>
	[gridsFromPdfLines(scanned), gridsFromRhythm(scanned)].map((group) =>
		group.map((grid) => ({ ...grid, origin: 'ocr' }))
	);

/**
 * Every route into the ledger meets the same arithmetic.
 *
 * A hand-written adapter is a verified mapping — the columns are known correct
 * — but that is not the same claim as "every movement on this page is in my
 * output", and only proof checks the second one.
 *
 * Only CONTRADICTED evidence throws. A statement that prints no balances at
 * all is unprovable, not wrong, and refusing it would reject formats that are
 * simply terse.
 */
function assertAgreesWithItsOwnNumbers(
	statement: ParsedStatement,
	method = 'adapter'
): ParsedStatement {
	// A currency is three letters. Anything else is a reader defect (a label,
	// heading, or metadata fragment) that must never become a stored transaction's
	// denomination, since everything downstream treats it as fact.
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
 * Matches the FULL ordered header, not a substring — "Datum" and "Objem" alone
 * would match every Czech CSV ever exported.
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
 * The signatures are substrings of ordinary text (`#Numer rachunku` is simply
 * Polish for "account number"), so a wrong adapter can claim a file and then
 * either fail outright or return zero rows with a bogus currency. When an
 * adapter claims a file and finds no movements, try reading it as an unknown
 * layout before believing there were none.
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
		// The adapter claimed the file and then couldn't read it — strong evidence
		// the signature matched something it didn't write.
		const generic = await readAsUnknownLayout();
		if (generic.statements.length > 0) return generic.statements;
		// The adapter's claim on this file was never established, so report the
		// general reader's reason rather than naming a bank that may be wrong.
		throw generic.reason ? new Error(generic.reason) : error;
	}

	const rows = statements.reduce((total, statement) => total + statement.rows.length, 0);
	if (rows > 0) return statements.map((statement) => assertAgreesWithItsOwnNumbers(statement));

	const generic = await readAsUnknownLayout();
	if (generic.statements.length > 0) return generic.statements;

	return statements.map(assertRowsExplainTheBalance);
}

/**
 * Sniff the bank and format from the file body and parse it. Throws a
 * user-facing Error when nothing matches.
 */
interface ParseOptions {
	/**
	 * Layouts this household has confirmed, fetched lazily — a function rather
	 * than an array so a file that never needs a profile never pays the query.
	 */
	profiles?: () => Promise<ImportProfile[]>;
	/**
	 * Allow reading a PDF from its pixels when the text layer cannot be proven.
	 * Off by default: rendering and recognising costs seconds per page.
	 */
	ocr?: boolean;
	/**
	 * The destination account's currency — the authority over any symbol or
	 * label found in the document. Absent only when the account doesn't exist yet.
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
	// Not "being built": QIF carries no balances to check arithmetic against,
	// so it could only ever be taken on trust, which this reader does not do.
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
		// Sniff the issuer from the statement's own header, not anywhere in the
		// document — both banks' names also appear deep in the body (e.g. as a
		// counterparty's bank), which would misroute the file to the wrong parser.
		// The title line and BIC both sit in the first dozen lines: RZBCCZPP is
		// Raiffeisenbank, GIBACZPX is Česká spořitelna.
		const head = lines
			.slice(0, 24)
			.map((l) => l.cells.join(' '))
			.join('\n');
		// Two assemblers, one arbiter: `gridsFromPdfLines` classifies lines to find
		// a movement's start; `gridsFromRhythm` finds the page's record beat
		// instead. Neither dominates, so both are offered and the proof engine
		// chooses between them.
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

		// Header unrecognised — fall back to the bank name anywhere in the file,
		// but only when exactly one bank is named, to avoid a misroute.
		const namesRb = text.includes('Raiffeisenbank');
		const namesCs = text.includes('Česká spořitelna');
		if (namesRb && !namesCs)
			return adapterOrGeneric(() => parseRbLines(lines), readPdfAsUnknownLayout);
		if (namesCs && !namesRb)
			return adapterOrGeneric(() => parseCsLines(lines), readPdfAsUnknownLayout);
		// A portfolio statement is a legitimate document that simply is not a bank
		// statement — saying so beats a useless "no transactions found".
		const holdings = looksLikeHoldings(text);
		if (holdings.isHoldings) throw new Error(holdings.reason!);

		// No bank matched. Recover a table from the page geometry and read it
		// generically, behind the same proof gate as any other unknown layout.
		const generic = await readGenerically(
			buffer,
			options.profiles,
			[gridsFromPdfLines(lines), gridsFromRhythm(lines)],
			options.currency
		);
		if (generic.statements.length > 0) return generic.statements;

		// The text layer could not be proven. Read the PAGE instead, and keep
		// whichever reconciles — never a splice of the two readings.
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
		// One group per sheet, collected rather than chosen between: a workbook may
		// hold a statement per account, and those are not competing readings of
		// the same thing.
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
			throw new Error(missingLanguageDataMessage('Reading statements from photographs'));
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
		// Refused by name rather than sent to the mapping wizard: this export
		// prints no balance at all, so it's P0 by construction and no mapping can
		// fix that — the wizard would just be a dead end.
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

	// No bank matched. Read it generically — and file it only if it proves
	// itself; an unknown layout has no verified mapping behind it, so arithmetic
	// is the only thing standing between a plausible misreading and the ledger.
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
	 * `choose` — the groups are alternative readings of one document, at most one
	 * of them right (a PDF read by two assemblers, a delimited file under two
	 * encodings).
	 *
	 * `collect` — the groups are separate parts, each potentially its own
	 * statement (a workbook with a sheet per account); picking a winner there
	 * loses an account rather than arbitrating.
	 */
	combine: 'choose' | 'collect' = 'choose'
): Promise<{ statements: ParsedStatement[]; reason?: string }> {
	// Delimited candidates are alternative decodings of the same bytes, so each
	// stands alone — letting one reading's balances judge another's rows
	// manufactures a contradiction out of two consistent readings. A PDF's two
	// assemblers both see the whole document and extract the same furniture
	// differently, so sharing evidence across them can turn a proving reading
	// into a failing one.
	const groups: Grid[][] = prebuilt ?? candidateGrids(buffer).map((grid) => [grid]);

	const readings: { statements: ParsedStatement[]; amounts: string[]; proofClass: ProofClass }[] =
		[];
	let firstReason: string | undefined;
	/**
	 * Set when some part of the document read into a statement and then failed
	 * the proof gate, as opposed to simply not being found.
	 */
	let refusedReason: string | undefined;

	// Asked once per FILE, not once per candidate grid.
	let remembered: Promise<ImportProfile[]> | undefined;
	const profilesOnce = loadProfiles ? () => (remembered ??= loadProfiles()) : undefined;

	for (const group of groups) {
		const evidence = group.flatMap((grid) => detectRegions(grid));
		for (const candidate of group) {
			const attempt = await readOneGrid([candidate], profilesOnce, evidence, accountCurrency);
			if (attempt.statements.length > 0) {
				readings.push({
					statements: attempt.statements,
					// The part that must not differ between readings: the movements
					// themselves. Text may differ between two decodings without
					// either being wrong.
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

	// A refusal outranks whatever the first candidate happened to complain about
	// — it means a statement was read completely and then failed the proof gate,
	// which is the reason that decided the outcome.
	if (readings.length === 0) return { statements: [], reason: refusedReason ?? firstReason };

	// Separate parts: every one of them belongs in the ledger.
	if (combine === 'collect') {
		// These groups are not rival accounts of one document — a workbook holds a
		// sheet per account — so filing the sheets that proved and dropping the one
		// that failed would import only part of the file. A sheet that yielded no
		// statement at all is different (summary/notes sheets are normal); only a
		// sheet that read and then failed the gate counts.
		if (refusedReason) return { statements: [], reason: refusedReason };
		return { statements: readings.flatMap((reading) => reading.statements) };
	}

	// Proof first, then coverage — sorting by row count alone can prefer a
	// reading that doesn't reconcile over one that does. Coverage still breaks
	// ties: two readings that are equally proven and equally complete but
	// disagree about the movements are genuine ambiguity for the person to
	// resolve, not a fragment vs. a complete reading.
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

		// The account outranks the document: its stated currency is the authority,
		// what the page appears to say is corroboration only.
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
			// The displayed text, not parsed values — a scale error leaves no trace
			// once the numbers have been parsed.
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
			// Proof is per region, not per file — several transaction regions is the
			// ordinary case (a multi-page statement prints furniture between pages).
			// This refuses the READING, not the file: an alternative reading of the
			// same document is still free to win. Recorded rather than returned
			// immediately, because a region that failed proof may have covered
			// figures that are wholly accounted for elsewhere — see
			// `accountsForWholeFile` for why that check comes after every region has
			// been seen.
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
 * Returns the best candidate reading whether or not it proved itself, so a
 * mapping can be built on top of it. It decides and imports nothing — every
 * value returned is a proposal for a person to correct, and whatever they
 * confirm still has to pass the same arithmetic as any other reading.
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
	 * A bank adding a column must never pass silently — matching by position
	 * would shift every role one to the right and read plausibly. Matching by
	 * label turns it into a named difference instead, pre-filled from last time.
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
	// This is the route the interface offers for a file that was refused for
	// mapping by hand, so the safety guard must sit here too, not just on the
	// first door into the parsers.
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

	// The fullest table anyone found — not the best-proven, since nothing here
	// proved itself, which is why we are asking.
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

	// A layout we nearly know: carry `matchProfile`'s diff through so the
	// answers can be pre-filled.
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

	// `headersOf` falls back to the first non-movement row, so an unrecognised
	// layout still has something to point at, keyed the same way next time.
	const headers = headersOf(best.region);

	// A drifted profile already knows most columns; only the unseen ones are
	// left for the person to answer.
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
