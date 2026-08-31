// SPDX-License-Identifier: AGPL-3.0-or-later
import * as XLSX from 'xlsx';
import { parseAmountToMinor } from '$lib/money';

// The XTB account-statement XLSX. Three sheets matter:
//  - "Open Positions":  a summary block, then instrument rows (with per-lot
//                       rows beneath them keyed by position id)
//  - "Cash Operations": every cash movement with a broker-unique ID — this is
//                       what makes re-uploads idempotent
//  - "Closed Positions": authoritative purchase and sale values, and the
//                       holding span each position occupied

import {
	registerBrokerAdapter,
	type BrokerCashOperation,
	type BrokerHolding,
	type BrokerPositionSpan,
	type BrokerReport
} from './adapter';

// The normalised shapes live in ./adapter; these aliases keep the XTB parser
// and its tests reading naturally.
type XtbHolding = BrokerHolding;
type XtbOperation = BrokerCashOperation;
type XtbPosition = BrokerPositionSpan;
type XtbReport = BrokerReport;

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
	// is set; per-lot rows leave it empty and put the position id in col 1 —
	// those lots carry the open times the value curve needs.
	const headerIndex = open.findIndex(
		(row) => row[0] === 'Product' && row[1]?.startsWith('Instrument')
	);
	const holdings: XtbHolding[] = [];
	const positions: XtbPosition[] = [];
	if (headerIndex !== -1) {
		for (const row of open.slice(headerIndex + 1)) {
			if (!row[1] || !row[2]) continue;
			if (row[3]) {
				// instrument summary row
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
			} else if (/^\d+$/.test(row[1].trim()) && row[9]) {
				// open lot: position id + open time; purchase value comes from
				// the matching Stock purchase cash operation
				positions.push({
					id: row[1].trim(),
					ticker: row[2].trim(),
					purchaseValueMinor: null,
					saleValueMinor: null,
					openedAt: row[9].replace(' ', 'T') + 'Z',
					closedAt: null
				});
			}
		}
	}

	// Closed positions: authoritative purchase/sale values and holding spans.
	// A position sold in tranches appears as several rows sharing one Position
	// ID — aggregate them (sum the values, span min open to max close) so the
	// value curve keeps the full cost basis.
	const closed = sheet('Closed Positions');
	const closedHeader = closed.findIndex(
		(row) => row[0] === 'Instrument' && row.includes('Position ID')
	);
	if (closedHeader !== -1) {
		const cols = closed[closedHeader];
		const c = (name: string) => cols.indexOf(name);
		const byId = new Map<string, XtbPosition>();
		for (const row of closed.slice(closedHeader + 1)) {
			const id = row[c('Position ID')]?.trim();
			const openTime = row[c('Open Time (UTC)')]?.trim();
			const closeTime = row[c('Close Time (UTC)')]?.trim();
			if (!id || !openTime || !closeTime) continue;
			const openedAt = openTime.replace(' ', 'T') + 'Z';
			const closedAt = closeTime.replace(' ', 'T') + 'Z';
			const purchase = toMinor(row[c('Purchase Value')] || '0', accountCurrency);
			const sale = toMinor(row[c('Sale Value')] || '0', accountCurrency);
			const existing = byId.get(id);
			if (existing) {
				existing.purchaseValueMinor = (existing.purchaseValueMinor ?? 0n) + purchase;
				existing.saleValueMinor = (existing.saleValueMinor ?? 0n) + sale;
				if (openedAt < existing.openedAt) existing.openedAt = openedAt;
				if (existing.closedAt !== null && closedAt > existing.closedAt) {
					existing.closedAt = closedAt;
				}
			} else {
				byId.set(id, {
					id,
					ticker: row[c('Ticker')]?.trim() ?? '',
					purchaseValueMinor: purchase,
					saleValueMinor: sale,
					openedAt,
					closedAt
				});
			}
		}
		positions.push(...byId.values());
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
				comment: row[c('Comment')]?.trim() || null,
				positionId: row[c('Position ID')]?.trim() || null
			});
		}
	}

	return { accountCurrency, generatedAt, summaryValueMinor, holdings, operations, positions };
}

/** Net contributions: deposits minus withdrawals (and subaccount transfers). */
export function contributions(operations: XtbOperation[]): { at: string; amountMinor: bigint }[] {
	return operations
		.filter((o) => ['Deposit', 'Withdrawal', 'Subaccount transfer'].includes(o.type))
		.map((o) => ({ at: o.happenedAt.slice(0, 10), amountMinor: o.amountMinor }))
		.sort((a, b) => (a.at < b.at ? -1 : 1));
}

// XLSX files are zip archives — the magic bytes plus the extension are a
// cheap, reliable sniff for XTB's account statement.
registerBrokerAdapter({
	id: 'xtb',
	label: 'XTB (account statement .xlsx)',
	sniff: (fileName, data) =>
		/\.xlsx$/i.test(fileName) && data.length > 2 && data[0] === 0x50 && data[1] === 0x4b,
	parse: parseXtb
});
