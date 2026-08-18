/**
 * Words statements use, in the languages our samples actually speak.
 *
 * Data, not logic — the whole point is that adding Portuguese or Hungarian is
 * an edit here and nothing else. Matching is accent-insensitive and
 * case-insensitive (see `normalise`), so entries are written plainly and each
 * one only has to appear once.
 *
 * Column-role terms come from real exports:
 *   Fio (cs), mBank (pl/cs), Raiffeisenbank (cs), Česká spořitelna (cs),
 *   Revolut (en), CaixaBank (es), Nickel (es), Sparkasse (de), UK/US (en).
 */

/** Lowercase and strip diacritics so "Částka" and "castka" are one key. */
export const normalise = (raw: string): string =>
	raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export type ColumnRole =
	| 'bookingDate'
	| 'valueDate'
	| 'amount'
	| 'debit'
	| 'credit'
	| 'balance'
	| 'fee'
	| 'currency'
	| 'counterparty'
	| 'counterpartyAccount'
	| 'reference'
	| 'variableSymbol'
	| 'constantSymbol'
	| 'specificSymbol'
	| 'description';

/**
 * Header terms per role. Order matters only in that longer, more specific
 * phrases should precede the generic ones they contain — "data operacji" before
 * "data" — because matching takes the first hit.
 */
export const HEADER_TERMS: Record<ColumnRole, string[]> = {
	valueDate: [
		'data operacji', // pl, mBank — the operation date
		'valuta',
		'wert',
		'wertstellung',
		'value date',
		'started date', // Revolut
		'fecha valor',
		'datum splatnosti'
	],
	bookingDate: [
		'data ksiegowania', // pl
		'zauctovano',
		'datum',
		'date',
		'fecha',
		'buchungstag',
		'completed date',
		'datum operace'
	],
	amount: [
		'castka', // cs — Částka
		'objem', // cs — Fio
		'kwota', // pl
		'betrag', // de
		'importe', // es
		'amount',
		'umsatz',
		'suma'
	],
	debit: [
		'paid out',
		'withdrawal',
		'withdrawals',
		'debit',
		'soll',
		'obciazenia',
		'cargo',
		'debe',
		'md'
	],
	credit: ['paid in', 'deposit', 'deposits', 'credit', 'haben', 'uznania', 'abono', 'haber', 'd'],
	balance: [
		'saldo po operacji', // pl, mBank
		'zustatek',
		'saldo',
		'balance',
		'bilanz',
		'kontostand',
		'stav uctu'
	],
	/**
	 * A charge stated beside the movement rather than folded into it.
	 *
	 * `ParsedRow` has carried `feeMinor` since it was written, and the proof
	 * engine has always netted it out — `amount - fee` is what a balance chain
	 * steps by. There was simply no ROLE for it, so the generic reader could
	 * never populate it, and a bank that states its fees separately had a chain
	 * that would not close by exactly the fees. That is one of the three layouts
	 * still needing a hand-written parser, and it needed a word rather than an
	 * algorithm.
	 */
	fee: [
		'fee',
		'fees',
		'poplatek',
		'poplatky',
		'oplata',
		'gebuhr',
		'gebuhren',
		'comision',
		'frais',
		'commissione',
		'avgift'
	],
	currency: ['mena', 'currency', 'waluta', 'wahrung', 'divisa', 'moneda'],
	counterparty: [
		'nazev protiuctu',
		'nadawca/odbiorca',
		'nadawca',
		'odbiorca',
		'counterparty',
		'beneficiary',
		'empfanger',
		'auftraggeber',
		'beneficiario',
		'name'
	],
	counterpartyAccount: [
		'protiucet',
		'cislo protiuctu',
		'numer konta',
		'counter account',
		'iban',
		'account number',
		'cuenta'
	],
	reference: [
		'id operace',
		'id pokynu',
		'bank reference',
		'reference',
		'referencia',
		'referenz',
		'kod transakce'
	],
	variableSymbol: ['vs', 'variabilni symbol', 'variable symbol'],
	constantSymbol: ['ks', 'konstantni symbol', 'constant symbol'],
	specificSymbol: ['ss', 'specificky symbol', 'specific symbol'],
	description: [
		'zprava pro prijemce',
		'opis operacji',
		'tytul',
		'poznamka',
		'popis',
		'description',
		'verwendungszweck',
		'concepto',
		'item',
		'typ',
		'details'
	]
};

/**
 * Words that mark a SUMMARY line — an opening balance, a turnover total, a
 * closing balance. These are evidence, never transactions, and a line carrying
 * one must never be filed as a movement however much it looks like a row.
 */
export const SUMMARY_TERMS = [
	// Czech
	'pocatecni zustatek',
	'konecny zustatek',
	'pocatecni stav',
	'koncovy stav',
	'prijmy celkem',
	'vydaje celkem',
	'poplatky celkem',
	'celkem prislo',
	'celkem odeslo',
	'suma prijmu',
	'suma vydaju',
	'obraty',
	// Polish
	'saldo poczatkowe',
	'saldo koncowe',
	'podsumowanie',
	'uznania',
	'obciazenia',
	'lacznie',
	// German
	'alter kontostand',
	'neuer kontostand',
	'summe gutschriften',
	'summe lastschriften',
	'anzahl buchungen',
	'kontostande',
	// English
	'opening balance',
	'closing balance',
	'balance brought forward',
	'balance carried forward',
	'beginning balance',
	'ending balance',
	'total paid in',
	'total paid out',
	'total deposits',
	'total withdrawals',
	'number of transactions',
	// Spanish
	'saldo inicial',
	'saldo final',
	'total abonos',
	'total cargos'
];

/**
 * Words that mark page furniture — legal notices, page numbers, contact
 * details. A region made only of these is neither evidence nor movements.
 */
export const FOOTER_TERMS = [
	'strana',
	'strona',
	'seite',
	'page',
	'pagina',
	'niniejszy dokument',
	'maschinell erstellt',
	'ohne unterschrift',
	'bez podpisu',
	'vyhotoveno',
	'this statement',
	'member fdic',
	'authorised by'
];

const matches = (haystack: string, terms: string[]) => terms.some((t) => haystack.includes(t));

export const looksLikeSummary = (text: string) => matches(normalise(text), SUMMARY_TERMS);
export const looksLikeFooter = (text: string) => matches(normalise(text), FOOTER_TERMS);

/**
 * The role a header cell names, if any. Longest match wins, so "data operacji"
 * is not swallowed by "data".
 */
export function roleOfHeader(header: string): ColumnRole | undefined {
	const text = normalise(header).replace(/^#/, '');
	if (!text) return undefined;
	let best: { role: ColumnRole; length: number } | undefined;
	for (const [role, terms] of Object.entries(HEADER_TERMS) as [ColumnRole, string[]][]) {
		for (const term of terms) {
			// Whole-word-ish: a header is a label, so an exact or prefix match is
			// meaningful while a substring inside another word is not.
			const hit = text === term || text.startsWith(`${term} `) || text.endsWith(` ${term}`);
			if (hit && (!best || term.length > best.length)) best = { role, length: term.length };
		}
	}
	return best?.role;
}
