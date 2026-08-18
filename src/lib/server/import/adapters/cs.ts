import { parseAmountToMinor } from '$lib/money';
import type { ParsedRow, ParsedStatement, PdfLine } from '../types';

const DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

function csDate(raw: string): string | null {
	const m = raw.trim().match(DATE);
	if (!m) return null;
	return `${m[3]}-${m[2]}-${m[1]}`;
}

const AMOUNT = /^[-+]?[\d\s  ]+\.\d{2}$/;

/**
 * Česká spořitelna PDF statement ("Výpis z účtu"). A movement's first line is
 *   date | type | [counter-account] | [VS] | amount
 * followed by description lines until the next dated line. Card rows carry a
 * long numeric instruction/reference line that serves as the bank reference.
 */
export function parseCsLines(lines: PdfLine[]): ParsedStatement {
	let accountNumber: string | undefined;
	let currency = 'CZK';
	let openingBalanceMinor: bigint | undefined;
	let closingBalanceMinor: bigint | undefined;
	let statedCreditTotalMinor: bigint | undefined;
	let statedDebitTotalMinor: bigint | undefined;
	let periodStart: string | undefined;
	let periodEnd: string | undefined;

	const flat = lines.map((l) => ({ ...l, text: l.cells.join(' ') }));
	for (const line of flat) {
		const acct = line.text.match(/Číslo účtu\/kód banky:\s*([\d-]+\/\d{4})/);
		if (acct) accountNumber = acct[1];
		const cur = line.text.match(/Měna účtu:\s*([A-Z]{3})/);
		if (cur) currency = cur[1];
		const period = line.text.match(
			/Období:\s*(\d{2})\.(\d{2})\.(\d{4}) - (\d{2})\.(\d{2})\.(\d{4})/
		);
		if (period) {
			periodStart = `${period[3]}-${period[2]}-${period[1]}`;
			periodEnd = `${period[6]}-${period[5]}-${period[4]}`;
		}
		const opening = line.text.match(/Počáteční zůstatek:\s*([-\d\s  ]+\.\d{2})/);
		if (opening && openingBalanceMinor === undefined)
			openingBalanceMinor = parseAmountToMinor(opening[1], currency);
		const closing = line.text.match(/Konečný zůstatek:\s*([-\d\s  ]+\.\d{2})/);
		if (closing && closingBalanceMinor === undefined)
			closingBalanceMinor = parseAmountToMinor(closing[1], currency);
		// "Celkem odešlo" is printed already negative; the statement model wants
		// both totals as positive magnitudes.
		const credits = line.text.match(/Celkem přišlo:\s*([-\d\s  ]+\.\d{2})/);
		if (credits && statedCreditTotalMinor === undefined)
			statedCreditTotalMinor = parseAmountToMinor(credits[1], currency);
		const debits = line.text.match(/Celkem odešlo:\s*([-\d\s  ]+\.\d{2})/);
		if (debits && statedDebitTotalMinor === undefined) {
			const v = parseAmountToMinor(debits[1], currency);
			statedDebitTotalMinor = v < 0n ? -v : v;
		}
	}

	// Collect movement start indices: date-led lines whose last cell is an amount.
	const rows: ParsedRow[] = [];
	const starts: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		const cells = lines[i].cells;
		if (cells.length >= 2 && csDate(cells[0]) && AMOUNT.test(cells[cells.length - 1])) {
			starts.push(i);
		}
	}

	for (let s = 0; s < starts.length; s++) {
		const i = starts[s];
		const end = s + 1 < starts.length ? starts[s + 1] : Math.min(i + 7, lines.length);
		const cells = lines[i].cells;
		const bookedAt = csDate(cells[0])!;
		const amountMinor = parseAmountToMinor(cells[cells.length - 1], currency);
		const middle = cells.slice(1, -1);
		const type = middle[0];
		const counterpartyAccount = middle.find((c) => /^[\d-]+\/\d{4}$/.test(c));

		let bankRef: string | undefined;
		let counterparty: string | undefined;
		let valueDate: string | undefined;
		const detail: string[] = [];
		for (let j = i + 1; j < end; j++) {
			const text = lines[j].cells.join(' ');
			if (/^\d{13,22}$/.test(text.trim())) {
				bankRef = text.trim();
				continue;
			}
			// Card lines: "XXXXXXXXXXXX7473 d.tran.30.05.2026 | CZ Praha ... | ALBERT ..."
			const card = lines[j].cells;
			if (card[0]?.startsWith('XXXXXXXXXXXX') && card.length >= 2) {
				counterparty = card[card.length - 1];
				const tran = card[0].match(/d\.tran\.(\d{2})\.(\d{2})\.(\d{4})/);
				if (tran) valueDate = `${tran[3]}-${tran[2]}-${tran[1]}`;
				continue;
			}
			if (text && !text.startsWith('CZK') && !/^Číslo instrukce/.test(text)) {
				detail.push(text);
			}
		}

		// A card row prints the compressed transaction date ("30052026" for
		// d.tran.30.05.2026) exactly where a transfer prints its variable
		// symbol, so a positional guess fabricates a symbol on most card
		// payments. That is not cosmetic: rules match on variableSymbol, so a
		// rule keyed to a genuine symbol that happens to look like a date would
		// silently file unrelated card payments, and the register would show a
		// payment symbol the bank never printed. Cards are excluded by type,
		// and any candidate equal to this row's own transaction date is a date
		// whatever the type says.
		const isCardRow = /\bkart/i.test(type ?? '');
		const compactValueDate = valueDate
			? `${valueDate.slice(8, 10)}${valueDate.slice(5, 7)}${valueDate.slice(0, 4)}`
			: null;
		const vs = isCardRow
			? undefined
			: middle.find((c) => /^\d{1,10}$/.test(c) && c !== compactValueDate);

		rows.push({
			bookedAt,
			valueDate,
			amountMinor,
			currency,
			counterparty: counterparty ?? (detail[0] || undefined),
			counterpartyAccount,
			variableSymbol: vs,
			description: [type, ...detail.slice(0, 2)].filter(Boolean).join(' · ') || undefined,
			bankRef
		});
	}

	return {
		bank: 'cs',
		// An adapter ran because the file identified this bank, so the issuer
		// is evidence here rather than a guess. Readers that cannot tell leave
		// it undefined; only this field may decide an account.
		issuer: 'cs',
		format: 'pdf',
		accountNumber,
		currency,
		periodStart,
		periodEnd,
		openingBalanceMinor,
		closingBalanceMinor,
		statedCreditTotalMinor,
		statedDebitTotalMinor,
		rows
	};
}
