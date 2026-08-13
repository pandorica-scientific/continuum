import * as XLSX from 'xlsx';
import { parseAmountToMinor } from '$lib/money';

// The XTB account-statement XLSX. Three sheets matter:
//  - "Open Positions":  a summary block, then instrument rows (with per-lot
//                       rows beneath them keyed by position id)
//  - "Cash Operations": every cash movement with a broker-unique ID — this is
//                       what makes re-uploads idempotent
//  - "Closed Positions" (unused for now)

export interface XtbHolding {
	ticker: string;
	name: string;
	category: string;
	units: number;
	valueMinor: bigint;
	netProfitPct: number | null;
}

export interface XtbOperation {
	id: string;
	type: string;
	ticker: string | null;
	happenedAt: string; // ISO datetime
	amountMinor: bigint;
	comment: string | null;
}

export interface XtbReport {
	accountCurrency: string;
	generatedAt: string; // ISO datetime
	summaryValueMinor: bigint;
	holdings: XtbHolding[];
	operations: XtbOperation[];
}

function toMinor(raw: string, currency: string): bigint {
	return parseAmountToMinor(raw.replace(/\s/g, ''), currency);
}

export function parseXtb(buffer: Uint8Array): XtbReport {
	const wb = XLSX.read(buffer, { type: 'buffer' });
	const sheet = (name: string): string[][] => {
		const ws = wb.Sheets[name];
		if (!ws) throw new Error(`XTB report is missing the "${name}" sheet.`);
		return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as string[][];
	};

	const open = sheet('Open Positions');
	let accountCurrency = 'EUR';
	let generatedAt = new Date().toISOString();
	let summaryValueMinor = 0n;

	for (const row of open) {
		if (row[0] === 'Data as of report generated' && row[1]) {
			generatedAt = row[1].replace(' ', 'T') + 'Z';
		}
		if (row[0] === 'My Trades' && row[1] === 'Value' && row[2]) {
			accountCurrency = (row[3] || 'EUR').trim().toUpperCase();
			summaryValueMinor = toMinor(row[2], accountCurrency);
		}
	}

	// Holdings: rows below the position-table header where the Category column
	// is set — per-lot rows leave it empty and put the position id in col 1.
	const headerIndex = open.findIndex(
		(row) => row[0] === 'Product' && row[1]?.startsWith('Instrument')
	);
	const holdings: XtbHolding[] = [];
	if (headerIndex !== -1) {
		for (const row of open.slice(headerIndex + 1)) {
			if (!row[1] || !row[2]) continue;
			if (!row[3]) continue; // lot row
			const units = Number(String(row[5]).replace(/\s/g, ''));
			if (!Number.isFinite(units)) continue;
			holdings.push({
				ticker: row[2].trim(),
				name: row[1].trim(),
				category: row[3].trim(),
				units,
				valueMinor: toMinor(row[6] || '0', accountCurrency),
				netProfitPct: row[12] !== '' ? Number(String(row[12]).replace(/\s/g, '')) : null
			});
		}
	}

	// Cash operations.
	const cash = sheet('Cash Operations');
	const cashHeader = cash.findIndex((row) => row[0] === 'Type' && row.includes('ID'));
	const operations: XtbOperation[] = [];
	if (cashHeader !== -1) {
		const cols = cash[cashHeader];
		const c = (name: string) => cols.indexOf(name);
		for (const row of cash.slice(cashHeader + 1)) {
			const id = row[c('ID')]?.trim();
			const type = row[c('Type')]?.trim();
			if (!id || !type || type === 'Total') continue;
			operations.push({
				id,
				type,
				ticker: row[c('Ticker')]?.trim() || null,
				happenedAt: (row[c('Time')] || '').replace(' ', 'T') + 'Z',
				amountMinor: toMinor(row[c('Amount')] || '0', accountCurrency),
				comment: row[c('Comment')]?.trim() || null
			});
		}
	}

	return { accountCurrency, generatedAt, summaryValueMinor, holdings, operations };
}

/** Net contributions: deposits minus withdrawals (and subaccount transfers). */
export function contributions(operations: XtbOperation[]): { at: string; amountMinor: bigint }[] {
	return operations
		.filter((o) => ['Deposit', 'Withdrawal', 'Subaccount transfer'].includes(o.type))
		.map((o) => ({ at: o.happenedAt.slice(0, 10), amountMinor: o.amountMinor }))
		.sort((a, b) => (a.at < b.at ? -1 : 1));
}
