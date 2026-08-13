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
		const vs = middle.find((c) => /^\d{1,10}$/.test(c) && c !== counterpartyAccount);

		let bankRef: string | undefined;
		let counterparty: string | undefined;
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
				continue;
			}
			if (text && !text.startsWith('CZK') && !/^Číslo instrukce/.test(text)) {
				detail.push(text);
			}
		}

		rows.push({
			bookedAt,
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
		format: 'pdf',
		accountNumber,
		currency,
		periodStart,
		periodEnd,
		openingBalanceMinor,
		closingBalanceMinor,
		rows
	};
}
