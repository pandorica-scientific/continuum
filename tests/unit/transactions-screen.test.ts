// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The register is three tiers deep on purpose: months collapsed, a month opening
// into its transactions, a transaction opening into everything you can do to it.
// It used to be one flat run of cards with every control on every row, which
// made reading the ledger and correcting it fight each other.
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import Page from '../../src/routes/(app)/transactions/+page.svelte';

vi.mock('$app/state', () => ({
	page: { data: {}, url: new URL('http://localhost/transactions') }
}));

const filter = {
	search: null,
	from: null,
	to: null,
	accountId: null,
	categoryId: null,
	direction: 'any' as const,
	minMinor: '',
	maxMinor: '',
	baseCurrency: 'CZK',
	reviewState: null,
	tagId: null,
	includeTransfers: false,
	sourceMethod: null,
	month: null as string | null,
	page: 1,
	pageSize: 10
};

const month = (m: string, count: number) => ({
	month: m,
	label: m === '2026-07' ? 'July 2026' : 'June 2026',
	count,
	currencies: [
		{
			currency: 'Kč',
			in: '136 165,06',
			out: '23 584,00',
			net: '+112 581,06',
			negative: false,
			inPct: 100,
			outPct: 17
		}
	],
	href: `?month=${m}`
});

const row = {
	id: 't1',
	date: '2026-07-31',
	merchant: 'Salary',
	detail: 'THERMO FISHER SCIENTIFIC · payroll 2026-07',
	amount: '+135 887,00 Kč',
	negative: false,
	categoryId: 'salary',
	categoryLabel: 'Income',
	categoryToken: '--series-income',
	reviewState: 'filed' as const,
	account: 'ČS Current',
	isTransfer: false,
	transferKind: null,
	readAs: null,
	proofClass: null,
	ruleHref: '/rules?counterparty=Salary&category=salary',
	currency: 'CZK',
	amountMajor: '135 887,00',
	tags: [],
	documents: [],
	isSplit: false,
	splits: []
};

const base = {
	baseCurrency: 'Kč',
	prevHref: '?page=1',
	nextHref: '?page=2',
	filter,
	openMonth: null as string | null,
	months: [month('2026-07', 23), month('2026-06', 19)],
	rows: [] as unknown[],
	totals: [
		{ currency: 'Kč', in: '272 330,12', out: '47 168,00', net: '+225 162,12', negative: false }
	],
	total: 42,
	pageCount: 1,
	monthTotal: 0,
	pageSize: 10,
	defaultPageSize: 10,
	pageSizes: [{ size: 10, href: '?per=10', active: true }],
	knownTags: [],
	reviewStates: ['auto', 'needs_review', 'confirmed', 'filed'],
	sourceMethods: [],
	proofLabels: {},
	accounts: [],
	categories: [{ key: 'income', label: 'Income', items: [{ id: 'salary', name: 'Income' }] }]
};

// The page also receives the layout's own data (theme, modules, version …),
// which nothing on this screen reads. Casting keeps the fixture to the fields
// under test rather than restating a layout contract that is not the subject.
const draw = (data: Record<string, unknown>) =>
	render(Page, { props: { data, form: null } as never }).body;

describe('the register', () => {
	it('lists months, not transactions, before anything is opened', () => {
		const body = draw(base);
		expect(body).toContain('July 2026');
		expect(body).toMatch(/23\s+transactions/);
		// No row is loaded at all: the server does not fetch what nothing shows.
		expect(body).not.toContain('THERMO FISHER');
	});

	it('states what each month came to, in and out kept apart', () => {
		const body = draw(base);
		expect(body).toContain('136 165,06');
		expect(body).toContain('23 584,00');
		expect(body).toContain('+112 581,06');
	});

	it('foots the whole filtered record above the months', () => {
		const body = draw(base);
		expect(body).toContain('272 330,12');
		// The footing sits above the first month rather than under the last.
		expect(body.indexOf('272 330,12')).toBeLessThan(body.indexOf('July 2026'));
	});

	it('opens a month into its transactions', () => {
		const body = draw({
			...base,
			openMonth: '2026-07',
			filter: { ...filter, month: '2026-07' },
			rows: [row],
			monthTotal: 23,
			pageCount: 3
		});
		expect(body).toContain('Salary');
		expect(body).toContain('+135 887,00 Kč');
		expect(body).toContain('Income');
		// The month's own pager, independent of the one walking months.
		expect(body).toContain('Page 1 of 3');
		expect(body).toContain('1–10 of 23');
	});

	it('keeps a collapsed transaction to what it IS, not what can be done to it', () => {
		const body = draw({
			...base,
			openMonth: '2026-07',
			filter: { ...filter, month: '2026-07' },
			rows: [row],
			monthTotal: 1
		});
		// Every control lives under the row you open. A page of ten rows carrying
		// a chooser, a Save, a Split and a paperclip apiece is what this replaced.
		expect(body).not.toContain('Something else');
		expect(body).not.toContain('Make a rule');
	});

	it('says nothing matches rather than drawing an empty table', () => {
		const body = draw({ ...base, months: [], total: 0, totals: [] });
		expect(body).toContain('Nothing matches');
		expect(body).not.toContain('July 2026');
	});
});
