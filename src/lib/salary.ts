// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Salary tracking derived from payslips. Pure functions: amount and period
// detection over extracted text lines, and the year-by-year statistics. The
// keyword lists are format facts of real payslips (Czech and English), the
// same way bank statement markers are; everything person-specific is learned
// from corrections, never hard-coded.

import { minorDigits } from '$lib/money';

export interface AmountCandidate {
	/** the text on the line before the amount, lowercased — the amount's label */
	label: string;
	amountMinor: bigint;
}

// Net-pay wordings payslips actually print. Ordered: an earlier match wins.
const NET_PAY_KEYWORDS = [
	'k výplatě',
	'k vyplacení',
	'celkem k výplatě',
	'čistá mzda',
	'dobírka',
	'převod na účet',
	'net pay',
	'net salary',
	'take home',
	'amount paid',
	// Spanish: what is actually transferred, printed as a heading over its figure.
	'líquido total a percibir',
	'liquido total a percibir',
	'líquido a percibir',
	'liquido a percibir',
	// German. "Auszahlungsbetrag" is the amount transferred and beats every
	// "netto" wording, which can name a subtotal.
	'auszahlungsbetrag',
	'überweisungsbetrag',
	'uberweisungsbetrag',
	'gesamt-netto',
	'gesamtnetto',
	'nettoverdienst',
	'nettoentgelt',
	'nettogehalt',
	'nettolohn',
	'netto-bezug',
	'auszahlung',
	// French. NOT "net imposable" — that is the taxable base, not what is paid.
	'net à payer avant impôt sur le revenu',
	'net a payer avant impot sur le revenu',
	'net à payer',
	'net a payer',
	'salaire net',
	'net payé',
	'net paye',
	// Italian
	'netto in busta',
	'retribuzione netta',
	'netto a pagare',
	// Polish
	'kwota do wypłaty',
	'kwota do wyplaty',
	'wynagrodzenie netto',
	'do wypłaty',
	'do wyplaty',
	// Dutch
	'netto uitbetaald',
	'uit te betalen',
	'nettoloon',
	'netto loon',
	// Portuguese
	'líquido a receber',
	'liquido a receber',
	'total líquido',
	'total liquido',
	'vencimento líquido',
	'vencimento liquido',
	// Bare, and last, for the same reason "brutto" is.
	'netto'
];

// Two printing conventions, both of which real payslips use. The comma-grouped
// alternative comes first and has to: without it "45,231.00" fell through to
// the bare `\d{1,3}[.,]\d{2}` tail and matched its first four characters, so an
// English payslip was filed as 45.23 instead of 45 231 — silently, with no
// throw and no null, straight into the salary history and the tax prefill.
// NET_PAY_KEYWORDS carries "net pay", "take home" and "amount paid", so English
// payslips are an intended input and comma-grouped thousands are how they print.
const AMOUNT_RE =
	/\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d{1,3}(?:[\u00A0\u202F .]\d{3})+(?:[.,]\d{2})?|\d{4,9}(?:[.,]\d{2})?|\d{1,3}[.,]\d{2}/g;

/**
 * Parse a printed amount to minor units: "45 231,00", "45.231" and "45231.00"
 * in the European form, "45,231.00" and "1,234,567.89" in the English one.
 */
export function parsePrintedAmount(raw: string, currency: string): bigint | null {
	const cleaned = raw.replace(/[\s\u00A0\u202F]/g, '');
	const digits = minorDigits(currency);

	const toMinor = (whole: string, fraction?: string): bigint | null => {
		if (!/^\d+$/.test(whole)) return null;
		try {
			// Scaled by the currency's own minor units, not a fixed 100: the
			// amount a person types into the payslip form is parsed by
			// parseAmountToMinor, and learnAmountLabel compares the two for
			// equality — a fixed 100 here meant that comparison could never
			// match in a currency without exactly two minor units, so the
			// reader silently never learned the label.
			const scaled = BigInt(whole) * 10n ** BigInt(digits);
			if (digits === 0) return scaled;
			return scaled + BigInt((fraction ?? '').padEnd(digits, '0').slice(0, digits) || '0');
		} catch {
			return null;
		}
	};

	// Comma-grouped thousands with a dot decimal. Unambiguous: a comma followed
	// by exactly three digits is never a decimal separator.
	const english = cleaned.match(/^(\d{1,3}(?:,\d{3})+)(?:\.(\d{2}))?$/);
	if (english) return toMinor(english[1].replace(/,/g, ''), english[2]);

	// European form: a trailing ,dd or .dd is the decimal, everything else groups.
	const m = cleaned.match(/^(\d+(?:\.\d{3})*|\d+)(?:[.,](\d{2}))?$/);
	if (!m) return null;
	return toMinor(m[1].replace(/\./g, ''), m[2]);
}

/**
 * A label as it is stored and compared.
 *
 * Trailing punctuation goes, dot leaders included. A payslip that rules its
 * page with dots prints "LÍQUIDO A PERCIBIR ......................." — the
 * words are the label and the dots are the ruler, and leaving them on meant the
 * wording never matched at its end, so the tight test could not fire and a
 * digit sequence out of an IBAN answered instead.
 */
function cleanLabel(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/[.:\s\u00A0\u202F]+$/, '')
		.slice(-60);
}

/**
 * A line of a PDF, as the extractor hands it over: the cells it found and where
 * each one starts. Structurally `PdfLine` from the import reader, restated here
 * so this file stays free of server imports.
 */
export interface LabelledLine {
	cells: string[];
	/** Left edge of each cell. Without it a line has no columns to speak of. */
	xs?: number[];
}

/**
 * Is this cell a figure rather than a name for one?
 *
 * `parsed` is the cell's amount where the caller already has it — the value
 * side of `columnCandidates` parses each cell to decide whether to look at it
 * at all, and parsing the same cell again here doubled that work over every
 * numeric cell of every slip.
 */
function isAmountCell(cell: string, currency: string, parsed?: bigint | null): boolean {
	const trimmed = cell.trim();
	if (!trimmed) return true;
	if (!/\d/.test(trimmed)) return false;
	const matched = trimmed.match(AMOUNT_RE);
	if (!matched) return false;
	const amount = parsed === undefined ? parsePrintedAmount(trimmed, currency) : parsed;
	// A cell that is ONLY a figure. "184:00" and "4,82%" carry digits but are a
	// duration and a rate; a cell like "Base salary 135 000" is a label with a
	// figure in it and must not count as a heading either.
	return (
		matched.join('').length >= trimmed.replace(/[\s\u00A0\u202F]/g, '').length && amount !== null
	);
}

/** The index of the column heading standing over a value at `x`. */
function headingIndexFor(xs: readonly number[], x: number): number {
	let found = -1;
	for (let i = 0; i < xs.length; i++) {
		if (xs[i] <= x && (found === -1 || xs[i] >= xs[found])) found = i;
	}
	return found;
}

/** How far from a value its column heading may sit, in either direction. */
const HEADING_LOOKBACK = 3;

/**
 * Which rows to look at for a heading, in the order they are tried: nearest
 * above first, then nearest below. Built once — it was two arrays materialised
 * for every amount cell of every line.
 */
const HEADING_ROWS = [
	...Array.from({ length: HEADING_LOOKBACK }, (_, i) => -(i + 1)),
	...Array.from({ length: HEADING_LOOKBACK }, (_, i) => i + 1)
];

/**
 * Amounts labelled by the column heading ABOVE them rather than the text beside
 * them.
 *
 * Some payrolls print a payslip as a real table: a row of headings, and the
 * figures on the line underneath. `extractCandidates` reads a line at a time and
 * sees only "40:00 405 750 279 091" — three numbers labelled by other numbers —
 * so a whole layout was unreadable, and the same employer's older slips had to
 * be typed in by hand while its newer ones read themselves.
 *
 * A value's label is every heading cell standing over its COLUMN BAND: from
 * just after the heading belonging to the value on its left, to just before the
 * one belonging to the value on its right. That is what keeps "Gross salary"
 * and "Net salary" apart when they head neighbouring columns, while still
 * gathering "LIQUIDO TOTAL A PERCIBIR" — one phrase the extractor split into
 * three cells — into a single label.
 *
 * Heading rows made entirely of figures are skipped rather than used: a row of
 * amounts is another value row, not a name for one.
 */
export function columnCandidates(
	lines: readonly LabelledLine[],
	currency: string
): AmountCandidate[] {
	const out: AmountCandidate[] = [];

	// From the first line, not the second: a heading may sit below its figure, so
	// the very first line of a slip can carry a value with its name underneath.
	for (let i = 0; i < lines.length; i++) {
		const value = lines[i];
		const valueXs = value.xs;
		if (!valueXs || valueXs.length !== value.cells.length) continue;

		for (let j = 0; j < value.cells.length; j++) {
			const amountMinor = parsePrintedAmount(value.cells[j].trim(), currency);
			if (amountMinor === null || amountMinor <= 0n) continue;
			if (!isAmountCell(value.cells[j], currency, amountMinor)) continue;

			// The nearest line above whose own cell over this column is a name —
			// and failing that, the nearest below. Some payrolls rule the figure
			// first and name it underneath, which is the same table read upside
			// down, not a different kind of evidence.
			let heading: LabelledLine | null = null;
			let headingXs: number[] = [];
			for (const offset of HEADING_ROWS) {
				const at = i + offset;
				if (at < 0 || at >= lines.length) continue;
				const other = lines[at];
				const xs = other.xs;
				if (!xs || xs.length !== other.cells.length || xs.length === 0) continue;
				const cell = headingIndexFor(xs, valueXs[j]);
				if (cell === -1 || isAmountCell(other.cells[cell], currency)) continue;
				heading = other;
				headingXs = xs;
				break;
			}
			if (!heading) continue;

			// The band this value owns, bounded by its neighbours' headings.
			const leftNeighbour = j > 0 ? headingIndexFor(headingXs, valueXs[j - 1]) : -1;
			const rightNeighbour =
				j + 1 < valueXs.length ? headingIndexFor(headingXs, valueXs[j + 1]) : headingXs.length;
			const from = leftNeighbour + 1;
			const to = rightNeighbour === -1 ? headingXs.length : rightNeighbour;
			const label = cleanLabel(heading.cells.slice(from, Math.max(from + 1, to)).join(' '));
			if (label) out.push({ label, amountMinor });
		}
	}
	return out;
}

/** Every amount on every line, labelled by the text before it. */
export function extractCandidates(lines: string[], currency: string): AmountCandidate[] {
	const out: AmountCandidate[] = [];
	for (const line of lines) {
		for (const match of line.matchAll(AMOUNT_RE)) {
			const amountMinor = parsePrintedAmount(match[0], currency);
			if (amountMinor === null || amountMinor <= 0n) continue;
			out.push({
				label: cleanLabel(line.slice(0, match.index)),
				amountMinor
			});
		}
	}
	return out;
}

/** Fold diacritics — payslips print "K výplatě" or "K vyplate" depending on the exporter. */
function fold(text: string): string {
	return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Gross wordings payslips actually print.
 *
 * A slip states gross AND net; they are two facts, not two readings of one
 * number, which is why `salary_entry` carries a column for each. Until v0.4.6
 * only the net list existed and whatever it found was filed as gross.
 *
 * Longer wordings come first: `pickBy` returns on the first keyword with any
 * hit, and "hrubá mzda" is a substring of "hrubá mzda celkem".
 */
const GROSS_PAY_KEYWORDS = [
	'hrubá mzda celkem',
	'hrubá měsíční mzda',
	'hrubá mzda',
	'hrubý příjem',
	'total gross',
	'gross earnings',
	'gross salary',
	'gross pay',
	// Spanish. "Total devengo" is what the slip adds up as earned, and the IRPF
	// withholding base is the same figure stated again — a Spanish payslip names
	// no "gross", so one of these two is the only way in.
	'base sujeta a retención del irpf',
	'base sujeta a retencion del irpf',
	'total devengo',
	'total devengado',
	// German. Compound words, so the longest first: "gesamtbrutto" contains
	// "brutto", and a bare "brutto" at the end of a label is the last resort.
	'gesamtbrutto',
	'gesamt-brutto',
	'steuerbrutto',
	'bruttoentgelt',
	'bruttobezug',
	'bruttogehalt',
	'bruttolohn',
	'brutto-bezug',
	// French
	'rémunération brute',
	'remuneration brute',
	'salaire brut mensuel',
	'salaire brut',
	'total brut',
	'brut total',
	// Italian
	'totale competenze',
	'retribuzione lorda',
	'totale lordo',
	// Polish
	'wynagrodzenie brutto',
	'płaca brutto',
	'placa brutto',
	'razem brutto',
	// Dutch
	'totaal bruto',
	'brutoloon',
	'bruto salaris',
	// Portuguese
	'remuneração bruta',
	'remuneracao bruta',
	'vencimento bruto',
	'total bruto',
	// Bare, and last. On its own "brutto" names a base as often as a total, so
	// it only ever answers where nothing more specific did.
	'brutto',
	'lordo'
];

/**
 * Never gross, however much it looks like it.
 *
 * Czech slips print superhrubá mzda — total employment cost — above the gross
 * line, and it is larger. Excluded rather than merely ranked below gross,
 * because a slip can print the cost line and no gross line at all, and the old
 * largest-amount fallback would then have handed it over as the salary.
 */
const COST_KEYWORDS = [
	'superhrubá mzda',
	'cena práce',
	'cost of employment',
	'employer cost',
	'total cost',
	// Total employment cost sits ABOVE gross on the page and is larger than it,
	// so every language's word for it has to be excluded or it answers instead.
	'arbeitgeberbrutto',
	'arbeitgeberkosten',
	'gesamtaufwand arbeitgeber',
	'gesamtkosten',
	'coût total employeur',
	'cout total employeur',
	'coût employeur',
	'cout employeur',
	'charges patronales',
	'coste empresa',
	'coste total empresa',
	'aportación empresa',
	'aportacion empresa',
	'costo azienda',
	'totale costo aziendale',
	'koszt pracodawcy',
	'werkgeverslasten',
	'custo do empregador'
];

/**
 * A learned label with the amounts taken out of it.
 *
 * `extractPdfLines` joins a table row's cells, so a label routinely carries the
 * COLUMNS to its left — and those are figures that change every month. Learning
 * "social security of employer 46 944,93 net salary" in January produced a
 * label that read "…46 760,18 net salary" in February and could never match
 * again: every wording learned before v0.5.2 was dead the moment it was stored,
 * which is why a year of hand corrections taught the reader nothing.
 *
 * Stripping the digits leaves the words, which are what identify the line.
 * Applied to both sides of the comparison, so labels stored under the old shape
 * start matching without a migration.
 */
const AMOUNT_IN_LABEL = /\d[\d\s\u00A0\u202F.,]*\d|\d/g;

export function labelKey(label: string): string {
	return fold(label).replace(AMOUNT_IN_LABEL, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Does this label END at the keyword — is the amount the one printed next to it?
 *
 * The distinction that matters on a real payslip. `extractPdfLines` joins a
 * table row's cells with spaces, so one physical row arrives as one long line
 * carrying several amounts, and `extractCandidates` labels each amount with
 * everything before it on that line. Every column to the RIGHT of "Hrubá mzda"
 * therefore gets a label that still contains it:
 *
 *   "hrubá mzda"                                          =  70 135  ← gross
 *   "hrubá mzda 70 135 hod.vč.přesč. 176 sp zaměstnanec"   =   4 980  ← insurance
 *   "hrubá mzda 70 135 ... sp zaměstnanec 4 980 daň"       =  10 530  ← tax
 *
 * Only the first ends at the keyword.
 */
function endsAt(label: string, keyword: string): boolean {
	return fold(label).endsWith(fold(keyword));
}

/**
 * The candidate a list of wordings points at, or null.
 *
 * A learned label wins, then the amount printed NEXT TO a keyword, and only
 * then a looser match anywhere in the label. Excluded labels can never be
 * returned, whatever matched them.
 *
 * Tightness beats keyword rank: an exact hit on a later wording is a better
 * answer than a trailing-column hit on an earlier one, so both passes run over
 * the whole keyword list rather than resolving each keyword in turn.
 *
 * Within one pass the LAST match wins, because a slip that prints its
 * components before its total puts the total later.
 *
 * There is deliberately no "largest amount on the slip" fallback. It is what
 * filed net pay as gross for every slip with no matching wording, and pointed at
 * gross it would find total employment cost instead. Null is a question the form
 * can ask once and learn from; a wrong number is silent.
 */
function pickBy(
	candidates: AmountCandidate[],
	keywords: readonly string[],
	learnedLabels: readonly string[],
	exclude: readonly string[] = []
): AmountCandidate | null {
	// Folded ONCE per candidate and once per wording, rather than once per pair
	// of them. The wording lists run to fifty entries apiece across seven
	// languages and a slip offers hundreds of candidates, so folding inside the
	// match loops normalised the same strings tens of thousands of times for one
	// payslip — and the column pass roughly doubled the candidate count.
	const excluded = exclude.map(fold);
	const allowed = candidates
		.map((candidate) => ({ candidate, label: fold(candidate.label) }))
		.filter((c) => !excluded.some((k) => c.label.includes(k)));
	if (allowed.length === 0) return null;

	// Every wording learned for this person, newest first — not just the last
	// one. A person with two jobs in a year has two payroll systems printing two
	// different wordings, and one slot per person meant each correction wiped the
	// other employer's: alternating between them relearned the same two labels
	// forever, and neither was ever there when its own slip arrived.
	//
	// Keeping several is safe because a learned label only matches a label that
	// is literally on the slip — the wrong employer's simply never matches.
	if (learnedLabels.length > 0) {
		// Keyed once too — up to six learned wordings each rescanned every
		// candidate and recomputed the same key for it.
		const keys = allowed.map((c) => labelKey(c.candidate.label));
		for (const learnedLabel of learnedLabels) {
			const key = labelKey(learnedLabel);
			if (!key) continue;
			// Compared with the amounts stripped from both sides: a label that
			// carries a neighbouring column has a different number in it every
			// month. The same label can appear more than once; the last is the
			// total line.
			let learned: AmountCandidate | null = null;
			for (let i = 0; i < allowed.length; i++) {
				if (keys[i] === key) learned = allowed[i].candidate;
			}
			if (learned) return learned;
		}
	}

	const wanted = keywords.map(fold);
	// `endsAt` and a loose contains, over already-folded strings — see `endsAt`
	// for why ending at the keyword is the distinction that matters.
	for (const match of [
		(label: string, keyword: string) => label.endsWith(keyword),
		(label: string, keyword: string) => label.includes(keyword)
	]) {
		for (const keyword of wanted) {
			const hits = allowed.filter((c) => match(c.label, keyword));
			if (hits.length > 0) return hits[hits.length - 1].candidate;
		}
	}
	return null;
}

/**
 * Which line to learn a stated figure from: the one labelled most tightly.
 *
 * A joined table row offers the same amount under several labels — "gross
 * salary" and "gross salary 189 294 income tax base" are the same 189 294 read
 * from two columns. The short one names the figure; the long one names it plus
 * whatever sits to its right, and is a worse thing to remember even with the
 * amounts stripped, because it points at the wrong column the month the two
 * figures differ.
 *
 * Ties go to the earliest, which on a left-to-right row is the leftmost cell.
 */
export function tightestLabelFor(
	candidates: readonly AmountCandidate[],
	amountMinor: bigint
): AmountCandidate | null {
	let best: AmountCandidate | null = null;
	for (const candidate of candidates) {
		if (candidate.amountMinor !== amountMinor || !candidate.label) continue;
		if (!best || candidate.label.length < best.label.length) best = candidate;
	}
	return best;
}

/** A stored setting's value: one wording, several, or none yet. */
export function learnedList(stored: string | string[] | null | undefined): string[] {
	if (!stored) return [];
	return (Array.isArray(stored) ? stored : [stored]).filter(Boolean);
}

export function pickGross(
	candidates: AmountCandidate[],
	learned: string | string[] | null
): AmountCandidate | null {
	return pickBy(candidates, GROSS_PAY_KEYWORDS, learnedList(learned), COST_KEYWORDS);
}

export function pickNet(
	candidates: AmountCandidate[],
	learned: string | string[] | null
): AmountCandidate | null {
	return pickBy(candidates, NET_PAY_KEYWORDS, learnedList(learned));
}

const MONTHS: Record<string, number> = {
	// Czech month names, including the genitive forms payslips print
	leden: 1,
	ledna: 1,
	únor: 2,
	února: 2,
	březen: 3,
	března: 3,
	duben: 4,
	dubna: 4,
	květen: 5,
	května: 5,
	červen: 6,
	června: 6,
	červenec: 7,
	července: 7,
	srpen: 8,
	srpna: 8,
	září: 9,
	říjen: 10,
	října: 10,
	listopad: 11,
	listopadu: 11,
	prosinec: 12,
	prosince: 12,
	january: 1,
	february: 2,
	march: 3,
	april: 4,
	may: 5,
	june: 6,
	july: 7,
	august: 8,
	september: 9,
	october: 10,
	november: 11,
	december: 12,
	// German. Both spellings where an exporter may drop the umlaut.
	januar: 1,
	februar: 2,
	märz: 3,
	marz: 3,
	mai: 5,
	juni: 6,
	juli: 7,
	oktober: 10,
	dezember: 12,
	// French
	janvier: 1,
	février: 2,
	fevrier: 2,
	mars: 3,
	avril: 4,
	juin: 6,
	juillet: 7,
	août: 8,
	aout: 8,
	septembre: 9,
	octobre: 10,
	novembre: 11,
	décembre: 12,
	decembre: 12,
	// Spanish
	enero: 1,
	febrero: 2,
	marzo: 3,
	abril: 4,
	mayo: 5,
	junio: 6,
	julio: 7,
	agosto: 8,
	septiembre: 9,
	setiembre: 9,
	octubre: 10,
	noviembre: 11,
	diciembre: 12,
	// Italian
	gennaio: 1,
	febbraio: 2,
	maggio: 5,
	giugno: 6,
	luglio: 7,
	settembre: 9,
	ottobre: 10,
	dicembre: 12,
	// Polish, nominative and the genitive a date is written in
	styczeń: 1,
	stycznia: 1,
	luty: 2,
	lutego: 2,
	marzec: 3,
	marca: 3,
	kwiecień: 4,
	kwietnia: 4,
	maj: 5,
	maja: 5,
	czerwiec: 6,
	czerwca: 6,
	lipiec: 7,
	lipca: 7,
	sierpień: 8,
	sierpnia: 8,
	wrzesień: 9,
	września: 9,
	październik: 10,
	października: 10,
	grudzień: 12,
	grudnia: 12,
	// Dutch
	maart: 3,
	mei: 5,
	augustus: 8,
	// Portuguese
	janeiro: 1,
	fevereiro: 2,
	março: 3,
	marco: 3,
	maio: 5,
	junho: 6,
	julho: 7,
	setembro: 9,
	outubro: 10,
	novembro: 11,
	dezembro: 12
};

/** The month a payslip covers: "08/2026", "2026-08" or "srpen 2026". */
/**
 * Bonus wordings payslips actually print.
 *
 * Gross-side only, and deliberately short. A payslip itemises what makes up
 * gross; a bank credit is one net transfer with no components at all, so there
 * is no such thing as a net bonus to detect. Anything not matched here stays
 * part of the base rather than being guessed at.
 */
const BONUS_KEYWORDS = [
	'mimořádná odměna',
	'mimoradna odmena',
	'prémie',
	'premie',
	'odměna',
	'odmena',
	'13. plat',
	'13 plat',
	'performance bonus',
	'annual bonus',
	// German
	'sonderzahlung',
	'weihnachtsgeld',
	'urlaubsgeld',
	'gratifikation',
	'prämie',
	'pramie',
	// French
	'prime exceptionnelle',
	'prime annuelle',
	'13ème mois',
	'13eme mois',
	// Italian
	'tredicesima',
	'premio di risultato',
	// Polish. NOT "premia" alone as a lone word here — it is listed, but after
	// the specific wordings, the same way every other bare term is.
	'nagroda',
	'premia',
	// Spanish and Portuguese
	'paga extraordinaria',
	// Last, because it is the loosest and matches inside the specific ones above.
	'bonus'
];

/**
 * Is this learned bonus wording present on the slip in front of us?
 *
 * The same test `detectBonus` uses to decide a learned label applies, exported
 * so the learner can tell "this employer's wording, which the correction has
 * just restated" from "some other employer's, which it says nothing about".
 */
export function bonusLabelOnSlip(candidateLabel: string, learnedLabel: string): boolean {
	return endsAt(candidateLabel, learnedLabel);
}

/**
 * What of this slip's gross was a bonus, or null when it says nothing.
 *
 * Null and zero are different answers: null is "the slip did not itemise one",
 * zero would be "it stated there was none". Only the first is honest about a
 * plain slip.
 *
 * Several lines are summed — a month can carry a standing premium and a one-off
 * award separately, and reporting the first alone understates it.
 *
 * `learnedLabel` wins over the keywords, the same way the pay amount's learned
 * label does: a correction teaches the reader rather than being re-entered
 * every month.
 */
export function detectBonus(
	candidates: AmountCandidate[],
	learnedLabels: string[] | null = null
): bigint | null {
	const matches = (label: string, needle: string): boolean => {
		const haystack = fold(label);
		const target = fold(needle);
		const at = haystack.indexOf(target);
		if (at === -1) return false;
		// Whole word only: "bonusový program poplatek" is a fee, not a bonus.
		const after = haystack[at + target.length];
		return after === undefined || !/[\p{L}\p{N}]/u.test(after);
	};

	// One line can match two keywords ("mimořádná odměna" also contains
	// "odměna"); dedupe by the label it was found on so it is not counted twice.
	const sum = (hits: AmountCandidate[]): bigint => {
		const seen = new Set<string>();
		let total = 0n;
		for (const hit of hits) {
			const key = `${hit.label}|${hit.amountMinor}`;
			if (seen.has(key)) continue;
			seen.add(key);
			total += hit.amountMinor;
		}
		return total;
	};

	if (learnedLabels && learnedLabels.length > 0) {
		const exact = candidates.filter((c) => learnedLabels.some((l) => endsAt(c.label, l)));
		if (exact.length > 0) return sum(exact);
		const learned = candidates.filter((c) => learnedLabels.some((l) => matches(c.label, l)));
		if (learned.length > 0) return sum(learned);
	}

	// Tight first, for the same reason pickBy does it: on a joined table row every
	// column right of "AIP bonus" keeps a label containing it, so summing every
	// match added the tax columns to the award — 65 251 became 367 766, larger
	// than the gross it was supposedly part of.
	const tight = candidates.filter((c) => BONUS_KEYWORDS.some((k) => endsAt(c.label, k)));
	if (tight.length > 0) return sum(tight);

	const hits = candidates.filter((c) => BONUS_KEYWORDS.some((k) => matches(c.label, k)));
	if (hits.length === 0) return null;
	return sum(hits);
}

/**
 * The backstop for a slip that itemises an implausible number of awards. The
 * search below is exponential in the pool size, and the pool is normally two
 * or three lines.
 */
const SUBSET_CAP = 12;

/**
 * Which bonus lines add up to the total somebody typed.
 *
 * A correction states one number; the slip may have reached it from two lines,
 * and learning has to name both or it learns nothing. Matching a single
 * candidate on equality was the v0.4.5 contract, which meant a two-line bonus
 * could never be learned — silently, on exactly the months worth correcting.
 *
 * The search is over the BONUS-KEYWORD lines only, never every amount on the
 * slip, so a total that happens to equal gross cannot be "explained" by the
 * gross line. The smallest matching set wins: fewer labels learned means fewer
 * wrong lines swept up next month.
 */
export function bonusLabelSubset(candidates: AmountCandidate[], total: bigint): string[] | null {
	const named = candidates.filter((c) => c.label.length > 0);
	// Same tight-first rule as detectBonus. A pool holding a row's tax columns
	// lets the subset search "explain" a stated total out of the wrong lines.
	const tight = named.filter((c) => BONUS_KEYWORDS.some((k) => endsAt(c.label, k)));
	const loose = named.filter((c) => BONUS_KEYWORDS.some((k) => fold(c.label).includes(fold(k))));
	const pool = (tight.length > 0 ? tight : loose).slice(0, SUBSET_CAP);
	if (pool.length === 0) return null;

	let best: string[] | null = null;
	for (let mask = 1; mask < 1 << pool.length; mask++) {
		let sum = 0n;
		const labels: string[] = [];
		for (let i = 0; i < pool.length; i++) {
			if (mask & (1 << i)) {
				sum += pool[i].amountMinor;
				labels.push(pool[i].label);
			}
		}
		if (sum !== total) continue;
		if (best === null || labels.length < best.length) best = labels;
	}
	return best ? [...new Set(best)] : null;
}

/**
 * Words a payslip puts in front of the period it covers.
 *
 * Ranked ahead of everything else because a slip carries several dates and only
 * one of them is the month being paid: "Period:October 2025 Processed:
 * 07.11.2025" was read as November, so three months of pay were filed against
 * the month they happened to be processed in.
 */
const PERIOD_MARKERS = ['period', 'perioda', 'období', 'obdobi', 'month', 'měsíc', 'mesic'];

/** Folded once: pass 1 compares every marker against every line of the slip. */
const FOLDED_MARKERS = PERIOD_MARKERS.map((marker) => ({ marker, folded: fold(marker) }));

/**
 * Day, month, two-digit year — "01/01/23", "26.01.23", "26-01-23".
 *
 * Day first, which is what every layout this has been measured against prints.
 * A middle field above 12 is not a month in any ordering, so the pattern simply
 * cannot read one; the risk it carries is the genuinely ambiguous "03/05/23",
 * and against that it is ranked below every form that states its year in full.
 */
const SHORT_YEAR_DATE = /\b(?:0?[1-9]|[12]\d|3[01])[/.-](0[1-9]|1[0-2])[/.-](\d{2})\b/;

/**
 * The month names, compiled once.
 *
 * `monthByName` runs over every line of a slip and the table is a hundred-odd
 * names across seven languages, so building the patterns inside the loop
 * compiled some seventeen thousand regexes to read one payslip.
 *
 * An ordered list rather than one alternation: first-name-in-the-table wins is
 * not the same answer as leftmost-match-in-the-text wins, and "maj" against
 * "maja", "marzec" against "marca" are exactly where the two differ.
 */
const MONTH_PATTERNS: readonly (readonly [RegExp, number])[] = Object.entries(MONTHS).map(
	([name, month]) => [new RegExp(`(?<!\\p{L})${name}(?!\\p{L})\\s*(20\\d{2})`, 'u'), month] as const
);

/** A month named in words, followed by a four-digit year. */
function monthByName(text: string): string | null {
	const lower = text.toLowerCase();
	for (const [pattern, month] of MONTH_PATTERNS) {
		const named = lower.match(pattern);
		if (named) return `${named[1]}-${String(month).padStart(2, '0')}`;
	}
	return null;
}

/** A date that states its year in full. */
function monthByFullYear(text: string): string | null {
	const iso = text.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
	if (iso) return `${iso[1]}-${iso[2]}`;
	const dmy = text.match(/\b(?:0?[1-9]|[12]\d|3[01])-(0[1-9]|1[0-2])-(20\d{2})\b/);
	if (dmy) return `${dmy[2]}-${dmy[1]}`;
	const numeric = text.match(/\b(0?[1-9]|1[0-2])\s*[/.]\s*(20\d{2})\b/);
	if (numeric) return `${numeric[2]}-${numeric[1].padStart(2, '0')}`;
	return null;
}

/** A date with a two-digit year. */
function monthByShortYear(text: string): string | null {
	const short = text.match(SHORT_YEAR_DATE);
	return short ? `20${short[2]}-${short[1]}` : null;
}

/**
 * The month a payslip covers: "08/2026", "2026-08", "srpen 2026", "01/01/23".
 *
 * Ranked passes over the WHOLE slip, not pattern-by-pattern down each line. A
 * payslip carries several dates — when it was processed, when the job started,
 * when the money moves — and only one of them is the month being paid, so the
 * order these are tried in IS the accuracy of the result.
 *
 * Each pass runs over every line before the next begins. Interleaving them cost
 * five months of pay: a per-line loop reached a two-digit employment start date
 * near the top of the page and answered with it, while the four-digit period the
 * same slip printed further down never got looked at.
 */
export function detectPeriod(lines: string[]): string | null {
	// 1. What the slip itself calls the period. Any date form will do here —
	//    being named as the period is stronger evidence than any format.
	for (const line of lines) {
		const lower = fold(line.toLowerCase());
		for (const { marker, folded } of FOLDED_MARKERS) {
			const at = lower.indexOf(folded);
			if (at === -1) continue;
			const rest = line.slice(at + marker.length);
			const found = monthByName(rest) ?? monthByFullYear(rest) ?? monthByShortYear(rest);
			if (found) return found;
		}
	}
	// 2. Then the date forms, in order of how easily each is confused with some
	//    other date on the page: a month spelled out (a slip prints its own month
	//    in words far more often than an unrelated one), then a year stated in
	//    full, and only then a two-digit year. THIS LIST IS THE RANKING — the
	//    reason it is a list is that a fourth format must join it in the right
	//    place rather than be written as a fourth identical loop.
	for (const read of [monthByName, monthByFullYear, monthByShortYear]) {
		for (const line of lines) {
			const found = read(line);
			if (found) return found;
		}
	}
	return null;
}

/**
 * Symbols payslips print instead of an ISO code.
 *
 * A format fact of real slips, exactly like the month names above: a Czech slip
 * prints "Kč" and never "CZK", and an exporter that strips diacritics prints
 * "Kc". Deliberately short — a mark that names more than one currency ("kr" is
 * Swedish, Norwegian and Danish) teaches nothing, and a wrong currency is worse
 * than asking.
 */
const CURRENCY_MARKS: Record<string, readonly string[]> = {
	CZK: ['kč', 'kc'],
	EUR: ['€'],
	USD: ['$'],
	GBP: ['£'],
	PLN: ['zł', 'zl'],
	CHF: ['chf']
};

function escapeRe(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** How often a mark appears, as a whole word where the mark is made of letters. */
function markHits(text: string, mark: string): number {
	const letters = /\p{L}/u.test(mark);
	const pattern = letters ? `(?<!\\p{L})${escapeRe(mark)}(?!\\p{L})` : escapeRe(mark);
	return text.match(new RegExp(pattern, 'gu'))?.length ?? 0;
}

/**
 * Which currency a payslip is printed in, or null when it does not say plainly.
 *
 * The currency of a payslip is a fact about the slip. It was taken from the
 * household's base currency until v0.5.1, which is right only when the two
 * happen to agree: a Czech slip filed by a household keeping its books in euro
 * was stored as 135 887 EUR, and every conversion downstream then multiplied a
 * koruna figure by the euro rate.
 *
 * Restricted to `allowed` — the currencies the app can actually convert — so a
 * mark for a currency with no rate never becomes an answer. A tie returns null
 * rather than a guess: the form asks, and what a person states is a decision.
 */
export function detectCurrency(
	lines: readonly string[],
	allowed: readonly string[]
): string | null {
	const text = lines.join('\n').toLowerCase();
	const counts: { code: string; hits: number }[] = [];
	for (const code of allowed) {
		if (!/^[A-Za-z]{3}$/.test(code)) continue;
		let hits = markHits(text, code.toLowerCase());
		for (const mark of CURRENCY_MARKS[code.toUpperCase()] ?? []) hits += markHits(text, mark);
		if (hits > 0) counts.push({ code, hits });
	}
	if (counts.length === 0) return null;
	counts.sort((a, b) => b.hits - a.hits);
	// Two currencies named equally often is a slip that has not said which it is.
	if (counts.length > 1 && counts[1].hits === counts[0].hits) return null;
	return counts[0].code;
}

/** Where a payslip's currency came from, so a form can say which. */
export type CurrencySource = 'slip' | 'learned' | null;

/**
 * Which currency a payslip is filed in, and on whose authority.
 *
 * What the slip PRINTS beats what this person's last slip was stated to be,
 * which beats nothing at all. The order is the point: a remembered currency is
 * a good guess about a job that has not changed, and a job can change — so it
 * must never overrule a currency actually on the page.
 *
 * Null is not the household's base currency. It is the form's cue to ask, and
 * asking is what stops a guess nobody was shown from being filed as a fact.
 */
export function payslipCurrency(
	detected: string | null,
	learned: string | null
): { currency: string | null; from: CurrencySource } {
	if (detected) return { currency: detected, from: 'slip' };
	if (learned) return { currency: learned, from: 'learned' };
	return { currency: null, from: null };
}

export interface SalaryYear {
	year: number;
	/** age that year, when the birth year is known */
	age: number | null;
	/**
	 * Average monthly GROSS, over the months that have one.
	 *
	 * Gross and net are kept apart rather than averaged together, and this is the
	 * whole point of the pair. A payslip states gross; a bank credit is net. A
	 * year with payslips for four months and bank credits for twelve would
	 * otherwise average four gross figures with eight net ones and call the
	 * result a salary — a number that is neither, and lower than the truth.
	 */
	grossAvgMinor: bigint | null;
	grossMonths: number;
	/** Average monthly NET, over the months that have one. */
	netAvgMinor: bigint | null;
	netMonths: number;
	/** The year's gross months added up, and the same split base against bonus. */
	grossTotalMinor: bigint;
	bonusTotalMinor: bigint;
	baseTotalMinor: bigint;
	/** The year's net months added up — what actually landed in the account. */
	netTotalMinor: bigint;
	/**
	 * Whether the net total covers a whole year.
	 *
	 * An annual total over three months is not a small year, it is a partial
	 * one, and beside a complete year it reads as a collapse. The screen marks
	 * it rather than hiding it or quietly annualising it.
	 */
	netComplete: boolean;
	/**
	 * Year-on-year change in the BASE, apart from the change in the total.
	 *
	 * A one-off bonus moves the total up one year and down the next, which reads
	 * as a raise followed by a pay cut when neither happened. The base answers
	 * what the salary did.
	 */
	baseDeltaPct: number | null;
	/** Whichever of the two the year is best evidenced by, for the chart. */
	avgMonthlyMinor: bigint;
	/** How many months that figure came from. */
	months: number;
	/** Whether `avgMonthlyMinor` is gross. Net is not comparable to it. */
	avgIsGross: boolean;
	/** average vs the previous listed year, in percent — like against like */
	deltaPct: number | null;
}

/** One month's salary, from a payslip, a bank credit, or both. */
export interface SalaryMonth {
	periodMonth: string;
	grossMinor?: bigint | null;
	netMinor?: bigint | null;
	/** The part of gross the payslip itemised as a bonus. Gross-side only. */
	bonusMinor?: bigint | null;
}

/**
 * Average monthly salary per year, gross and net kept apart.
 *
 * Salary reaches this from two places now: a payslip, which states GROSS, and a
 * salary credit on a bank statement, which is NET. They are not competing
 * readings of one number and neither wins — a month can carry both, and a year
 * reports each over the months that actually have it.
 *
 * `avgMonthlyMinor` is the series the chart draws, and it takes whichever half
 * the year is better evidenced by, saying which via `avgIsGross`. The
 * year-on-year change is only computed between years of the SAME kind: gross
 * against net would report a pay cut where somebody simply started uploading
 * payslips.
 */
export function salaryStats(months: SalaryMonth[], birthYear: number | null): SalaryYear[] {
	const byYear = new Map<number, { gross: bigint[]; net: bigint[]; bonus: bigint }>();
	for (const month of months) {
		const year = Number(month.periodMonth.slice(0, 4));
		if (!Number.isInteger(year)) continue;
		if (!byYear.has(year)) byYear.set(year, { gross: [], net: [], bonus: 0n });
		const bucket = byYear.get(year)!;
		if (month.grossMinor !== null && month.grossMinor !== undefined) {
			bucket.gross.push(month.grossMinor);
		}
		if (month.netMinor !== null && month.netMinor !== undefined) {
			bucket.net.push(month.netMinor);
		}
		// Null is "the slip did not itemise one", which contributes nothing —
		// distinct from a slip that stated zero, which also contributes nothing
		// but means something different to the reader looking at the month.
		if (month.bonusMinor) bucket.bonus += month.bonusMinor;
	}

	const mean = (values: bigint[]): bigint | null =>
		values.length ? values.reduce((sum, v) => sum + v, 0n) / BigInt(values.length) : null;

	const rows: SalaryYear[] = [];
	for (const year of [...byYear.keys()].sort()) {
		const { gross, net, bonus } = byYear.get(year)!;
		if (gross.length === 0 && net.length === 0) continue;

		const grossTotal = gross.reduce((sum, v) => sum + v, 0n);
		const netTotal = net.reduce((sum, v) => sum + v, 0n);
		// Clamped: a misread bonus line, or a slip whose gross excludes the
		// award, must not draw a negative base.
		const baseTotal = grossTotal > bonus ? grossTotal - bonus : 0n;

		const grossAvg = mean(gross);
		const netAvg = mean(net);
		// Gross when the year has any, because it is the figure a salary is
		// normally quoted as — and the one comparable across employers.
		const avgIsGross = grossAvg !== null;
		const avg = (avgIsGross ? grossAvg : netAvg) as bigint;
		const monthCount = avgIsGross ? gross.length : net.length;

		// Like against like. The previous LISTED year may be of the other kind,
		// which is exactly the case that would invent a pay cut.
		const prev = rows[rows.length - 1];
		const comparable = prev && prev.avgIsGross === avgIsGross && prev.avgMonthlyMinor > 0n;
		// Base against base, over the same number of months, so the comparison is
		// of monthly pay rather than of how many months were recorded.
		const baseAvg = gross.length > 0 ? baseTotal / BigInt(gross.length) : null;
		const prevBaseAvg =
			prev && prev.grossMonths > 0 ? prev.baseTotalMinor / BigInt(prev.grossMonths) : null;

		rows.push({
			year,
			age: birthYear ? year - birthYear : null,
			grossAvgMinor: grossAvg,
			grossMonths: gross.length,
			netAvgMinor: netAvg,
			netMonths: net.length,
			grossTotalMinor: grossTotal,
			bonusTotalMinor: bonus,
			baseTotalMinor: baseTotal,
			netTotalMinor: netTotal,
			netComplete: net.length >= 12,
			baseDeltaPct:
				baseAvg !== null && prevBaseAvg !== null && prevBaseAvg > 0n
					? Math.round((Number(baseAvg) / Number(prevBaseAvg) - 1) * 1000) / 10
					: null,
			avgMonthlyMinor: avg,
			months: monthCount,
			avgIsGross,
			deltaPct: comparable
				? Math.round((Number(avg) / Number(prev.avgMonthlyMinor) - 1) * 1000) / 10
				: null
		});
	}
	return rows;
}

/**
 * Every person's years added into one household series.
 *
 * The Salary screen offers a "Both" view the way the Tax screen does, and the
 * arithmetic has to be done on the TOTALS rather than on the per-person
 * averages. Averaging two averages weights a person paid for two months the
 * same as one paid for twelve, and reports a household monthly figure neither
 * of them earned.
 *
 * The two comparisons are recomputed from the merged series for the same
 * reason: a delta carried over from one person's row would describe that
 * person, under a label saying it described the household.
 */
export function mergeSalaryYears(perPerson: SalaryYear[][]): SalaryYear[] {
	const byYear = new Map<number, SalaryYear[]>();
	for (const person of perPerson) {
		for (const row of person) {
			byYear.set(row.year, [...(byYear.get(row.year) ?? []), row]);
		}
	}

	const rows: SalaryYear[] = [];
	for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
		const parts = byYear.get(year)!;
		const total = (pick: (r: SalaryYear) => bigint) => parts.reduce((sum, r) => sum + pick(r), 0n);

		const grossTotal = total((r) => r.grossTotalMinor);
		const netTotal = total((r) => r.netTotalMinor);
		const bonusTotal = total((r) => r.bonusTotalMinor);
		const baseTotal = total((r) => r.baseTotalMinor);
		const grossMonths = parts.reduce((n, r) => n + r.grossMonths, 0);
		const netMonths = parts.reduce((n, r) => n + r.netMonths, 0);

		const grossAvg = grossMonths > 0 ? grossTotal / BigInt(grossMonths) : null;
		const netAvg = netMonths > 0 ? netTotal / BigInt(netMonths) : null;
		const avgIsGross = grossAvg !== null;
		const avg = (avgIsGross ? grossAvg : netAvg) ?? 0n;

		// Like against like, exactly as salaryStats does it: the previous listed
		// year may be of the other kind, which is the case that invents a pay cut.
		const prev = rows[rows.length - 1];
		const comparable = prev && prev.avgIsGross === avgIsGross && prev.avgMonthlyMinor > 0n;
		const baseAvg = grossMonths > 0 ? baseTotal / BigInt(grossMonths) : null;
		const prevBaseAvg =
			prev && prev.grossMonths > 0 ? prev.baseTotalMinor / BigInt(prev.grossMonths) : null;

		rows.push({
			year,
			// A household has no single age. The chart's age axis is a per-person
			// reading and stays absent here rather than picking somebody's.
			age: null,
			grossAvgMinor: grossAvg,
			grossMonths,
			netAvgMinor: netAvg,
			netMonths,
			grossTotalMinor: grossTotal,
			bonusTotalMinor: bonusTotal,
			baseTotalMinor: baseTotal,
			netTotalMinor: netTotal,
			// Complete only when EVERY contributor's year was: one person's partial
			// year makes the household total partial too, however many months the
			// other one covered.
			netComplete: parts.length > 0 && parts.every((r) => r.netComplete),
			baseDeltaPct:
				baseAvg !== null && prevBaseAvg !== null && prevBaseAvg > 0n
					? Math.round((Number(baseAvg) / Number(prevBaseAvg) - 1) * 1000) / 10
					: null,
			avgMonthlyMinor: avg,
			months: avgIsGross ? grossMonths : netMonths,
			avgIsGross,
			deltaPct: comparable
				? Math.round((Number(avg) / Number(prev.avgMonthlyMinor) - 1) * 1000) / 10
				: null
		});
	}
	return rows;
}

/**
 * The most recent year the BASE actually rose, or null.
 *
 * Base rather than total, because a one-off bonus lifts the total one year and
 * drops it the next — which reads as a raise followed by a pay cut when neither
 * happened. `baseDeltaPct` already has the bonus taken out.
 *
 * A fall is not an increase and neither is standing still: both return the last
 * real rise, or null. Calling the latest CHANGE an increase would put a red
 * figure under a green label.
 */
export function lastBaseIncrease(years: SalaryYear[]): { year: number; pct: number } | null {
	const risen = years.filter((y) => y.baseDeltaPct !== null && y.baseDeltaPct > 0);
	if (risen.length === 0) return null;
	const latest = risen.reduce((newest, y) => (y.year > newest.year ? y : newest));
	return { year: latest.year, pct: latest.baseDeltaPct! };
}
