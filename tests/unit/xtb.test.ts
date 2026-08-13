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
		[
			'Stock purchase',
			'Tesla',
			'TSLA.DE',
			'STOCK',
			'2024-10-29 13:28:39',
			'-14195',
			'555',
			'OPEN BUY',
			'My Trades',
			'1512236613'
		],
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

	const closed = XLSX.utils.aoa_to_sheet([
		['Account number', '1234567'],
		['Closed Positions', ''],
		[
			'Instrument',
			'Ticker',
			'Category',
			'Type',
			'Volume',
			'Open Price',
			'Open Time (UTC)',
			'Close Price',
			'Close Time (UTC)',
			'Product',
			'Profit/Loss',
			'Gross Profit',
			'Purchase Value',
			'Sale Value',
			'Stop Loss',
			'Take Profit',
			'Commission',
			'Margin',
			'Swap',
			'Rollover',
			'Open Conversion Rate',
			'Close Conversion Rate',
			'Close Origin',
			'Position ID',
			'Comment'
		],
		[
			'Rocket Lab',
			'RKLB.US',
			'STOCK',
			'BUY',
			'202',
			'83.7',
			'2024-06-01 10:00:00',
			'133',
			'2025-05-20 15:57:13',
			'My Trades',
			'8647.23',
			'8694.62',
			'14307.68',
			'23002.30',
			'',
			'',
			'-47.39',
			'',
			'',
			'',
			'0.84',
			'0.85',
			'iOS',
			'111000111',
			''
		]
	]);
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

	it('reads cash operations with unique ids, position links, and skips the total row', () => {
		expect(report.operations).toHaveLength(5);
		expect(report.operations.map((o) => o.id)).toEqual(['111', '555', '222', '333', '444']);
		const purchase = report.operations.find((o) => o.id === '555')!;
		expect(purchase.positionId).toBe('1512236613');
	});

	it('reads holding intervals: closed positions and open lots', () => {
		const closed = report.positions.find((p) => p.id === '111000111')!;
		expect(closed.purchaseValueMinor).toBe(1430768n);
		expect(closed.saleValueMinor).toBe(2300230n);
		expect(closed.openedAt).toContain('2024-06-01');
		expect(closed.closedAt).toContain('2025-05-20');
		const openLots = report.positions.filter((p) => p.closedAt === null);
		expect(openLots.map((p) => p.id)).toEqual(['2650670683', '1512236613']);
	});

	it('derives net contributions from deposits and withdrawals only', () => {
		const contrib = contributions(report.operations);
		expect(contrib).toHaveLength(3);
		const net = contrib.reduce((s, c) => s + c.amountMinor, 0n);
		expect(net).toBe(2300000n); // 10000 + 15000 − 2000 EUR
	});
});

describe('costValueSeries via buildSeries', () => {
	it('reconstructs value between snapshots: cash + open book + realised gains', async () => {
		const { buildSeries } = await import('$lib/server/invest/series');
		// Jan: deposit 10 000. Feb: buy position A for 4 000 (cash 6 000, book
		// 4 000 → value still 10 000). Apr: sell A for 5 000 (realised +1 000 →
		// value 11 000). Jun: snapshot says market value 12 000.
		const series = buildSeries(
			[{ at: '2026-01-05', amountMinor: 1000000n }],
			[{ day: '2026-06-15', valueMinor: 1200000n }],
			[
				{ at: '2026-01-05T10:00:00Z', amountMinor: 1000000n, type: 'Deposit', positionId: null },
				{
					at: '2026-02-10T10:00:00Z',
					amountMinor: -400000n,
					type: 'Stock purchase',
					positionId: 'A'
				},
				{ at: '2026-04-10T10:00:00Z', amountMinor: 500000n, type: 'Stock sell', positionId: 'A' }
			],
			[
				{
					id: 'A',
					openedAt: '2026-02-10T10:00:00Z',
					closedAt: '2026-04-10T10:00:00Z',
					purchaseValueMinor: 400000n
				}
			]
		);
		const byMonth = new Map(series.map((p) => [p.month, p.actual]));
		expect(byMonth.get('2026-01')).toBe(10000);
		expect(byMonth.get('2026-02')).toBe(10000); // buying moves nothing at cost
		expect(byMonth.get('2026-03')).toBe(10000);
		expect(byMonth.get('2026-04')).toBe(11000); // realised gain lands
		expect(byMonth.get('2026-06')).toBe(12000); // snapshot overrides
	});
});
