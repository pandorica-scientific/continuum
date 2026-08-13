import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { contributions, parseXtb } from '$lib/server/invest/xtb';

// A synthetic workbook mirroring the real report's structure exactly.
function makeReport(): Uint8Array {
	const wb = XLSX.utils.book_new();

	const open = XLSX.utils.aoa_to_sheet([
		['Account number', '1234567'],
		['Open Positions', ''],
		['Data as of report generated', '2026-08-12 19:16:16'],
		['Product', 'Metric', 'Amount', 'Currency'],
		['My Trades', 'Value', '286746.18', 'EUR'],
		['My Trades', 'Profit', '-44176.73', 'EUR'],
		[],
		['Note', 'Summary values and open positions are shown as of the report generation time'],
		[
			'Product',
			'Instrument/Position',
			'Ticker',
			'Category',
			'Type',
			'Volume',
			'Value',
			'Current price',
			'Open price',
			'Open time (UTC)',
			'Stop Loss',
			'Take Profit',
			'Net Profit %',
			'Net Profit'
		],
		[
			'My Trades',
			'Rocket Lab',
			'RKLB.US',
			'STOCK',
			'',
			'3600',
			'251920.41',
			'',
			'96.32',
			'',
			'',
			'',
			'-16.36',
			'-49266.7'
		],
		[
			'My Trades',
			'2650670683',
			'RKLB.US',
			'',
			'BUY',
			'1600',
			'111964.63',
			'81.04',
			'100.3',
			'2026-06-22 14:09:14',
			'',
			'',
			'-20.62',
			'-29089.41'
		],
		[
			'My Trades',
			'Tesla',
			'TSLA.DE',
			'STOCK',
			'',
			'100',
			'28390',
			'',
			'237.08',
			'',
			'',
			'',
			'19.75',
			'4681.72'
		],
		[
			'My Trades',
			'1512236613',
			'TSLA.DE',
			'',
			'BUY',
			'50',
			'14195',
			'283.9',
			'245.25',
			'2024-10-29 13:28:39',
			'',
			'',
			'15.76',
			'1932.5'
		]
	]);
	XLSX.utils.book_append_sheet(wb, open, 'Open Positions');

	const cash = XLSX.utils.aoa_to_sheet([
		['Account number', '1234567'],
		['Cash Operations', ''],
		[
			'Type',
			'Instrument',
			'Ticker',
			'Category',
			'Time',
			'Amount',
			'ID',
			'Comment',
			'Product',
			'Position ID'
		],
		['Deposit', '', '', '', '2024-01-05 10:00:00', '10000', '111', 'Deposit', 'My Trades', ''],
		['Deposit', '', '', '', '2025-01-05 10:00:00', '15000', '222', 'Deposit', 'My Trades', ''],
		[
			'Withdrawal',
			'',
			'',
			'',
			'2025-06-01 10:00:00',
			'-2000',
			'333',
			'Withdrawal',
			'My Trades',
			''
		],
		[
			'Dividend',
			'Pepsi',
			'PEP.US',
			'STOCK',
			'2026-07-07 14:10:18',
			'3.87',
			'444',
			'PEP dividend',
			'My Trades',
			'123'
		],
		['Total', '', '', '', '', '26003.87', '', '', '', '']
	]);
	XLSX.utils.book_append_sheet(wb, cash, 'Cash Operations');

	const closed = XLSX.utils.aoa_to_sheet([['Account number', '1234567']]);
	XLSX.utils.book_append_sheet(wb, closed, 'Closed Positions');

	return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

describe('parseXtb', () => {
	const report = parseXtb(makeReport());

	it('reads the account currency, timestamp and summary value', () => {
		expect(report.accountCurrency).toBe('EUR');
		expect(report.generatedAt).toContain('2026-08-12');
		expect(report.summaryValueMinor).toBe(28674618n);
	});

	it('reads instrument rows and skips per-lot rows', () => {
		expect(report.holdings).toHaveLength(2);
		const rklb = report.holdings[0];
		expect(rklb.ticker).toBe('RKLB.US');
		expect(rklb.name).toBe('Rocket Lab');
		expect(rklb.units).toBe(3600);
		expect(rklb.valueMinor).toBe(25192041n);
		expect(rklb.netProfitPct).toBeCloseTo(-16.36);
	});

	it('reads cash operations with unique ids and skips the total row', () => {
		expect(report.operations).toHaveLength(4);
		expect(report.operations.map((o) => o.id)).toEqual(['111', '222', '333', '444']);
	});

	it('derives net contributions from deposits and withdrawals only', () => {
		const contrib = contributions(report.operations);
		expect(contrib).toHaveLength(3);
		const net = contrib.reduce((s, c) => s + c.amountMinor, 0n);
		expect(net).toBe(2300000n); // 10000 + 15000 − 2000 EUR
	});
});
