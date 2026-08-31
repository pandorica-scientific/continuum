// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { category, categoryGroup, loanEvent } from '$lib/server/db/schema';
import { flowData } from '$lib/server/cashflow';
import { registerMonths, registerPage } from '$lib/server/transactions';
import { KEPT_COLOR, KEPT_KEY, RESERVES_KEY } from '$lib/charts/flow-graph';
import { LOAN_PRINCIPAL_CATEGORY } from '$lib/categories';
import { parseFilter, UNCATEGORISED } from '$lib/transactions/filter';
import { fromMajor, toMajor } from '$lib/money';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount, makeLoan, makeTransaction } from './fixtures';
import { rowId } from '../row-id';

/**
 * W2.1: money put aside is a stage, and the residual is cash.
 *
 * The waterfall used to end in a node labelled "Saved & invested" holding
 * income minus expenses — the money nobody had spent, whether or not any of it
 * had been invested. The savings group's own leaves were keyed by that group
 * and hung off a node keyed `kept`, so they drew nowhere at all. This is the
 * whole pipeline: transactions in, four totals out.
 *
 * `flowData` reads the module-level `db` singleton rather than taking a
 * handle, so it has to be pointed at this harness the way `deadlines.test.ts`
 * and `archive-scope.test.ts` do it.
 */
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

const ACCOUNT = rowId('cashflow-flow-account');
/** One month, so the anchored period covers exactly what is seeded. */
const MONTH = '2026-03';
/** The window that month is compared against. */
const PREVIOUS_MONTH = '2026-02';

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('cashflow-flow', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	// `loan` is in the list because the cascade reaches loan_event from the
	// transactions it links, but never the loans themselves.
	await harness.sql`truncate account, category, loan cascade`;
	// The baseline seeds the groups; only a group a test added is cleared, and
	// the truncate above has already taken the categories inside it.
	await harness.sql`delete from category_group where key = 'pension'`;
	await makeAccount(testDb, {
		id: ACCOUNT,
		name: 'Current',
		bank: 'fio',
		kind: 'current',
		currency: 'CZK'
	});
	// Three of the roles the baseline seeds: income, expense and savings. The
	// fourth is the seeded category the principal half of a loan payment is
	// filed under — both the chart and the register gate the split on it
	// existing, so a fixture that truncated it away would leave nothing to split.
	await testDb.insert(category).values([
		{ id: 'salary', groupKey: 'income', name: 'Salary' },
		{ id: 'rent', groupKey: 'housing', name: 'Rent' },
		{ id: 'brokerage', groupKey: 'savings', name: 'Brokerage' },
		{ id: LOAN_PRINCIPAL_CATEGORY, groupKey: 'savings', name: 'Loan principal' }
	]);
});

/** One movement, in the base currency so no rate is involved. */
async function record(
	name: string,
	major: number,
	categoryId: string | null,
	month: string = MONTH
): Promise<string> {
	const id = uuidv7();
	await makeTransaction(testDb, {
		id,
		accountId: ACCOUNT,
		bookedOn: `${month}-15`,
		amountMinor: fromMajor(major, 'CZK'),
		currency: 'CZK',
		categoryId,
		// Not-null and unique per account; nothing here exercises deduplication.
		dedupFingerprint: name
	});
	return id;
}

/**
 * The register link a node of this period carries.
 *
 * Written out here rather than by calling `registerHref` a second time: a test
 * that builds its expectation with the code under test asserts only that the
 * function is deterministic. The period is the one `flowData` anchors on — the
 * newest month holding data, which is the only month the fixture seeds.
 */
const link = (query: string) =>
	`/transactions?${query}&from=${MONTH}-01&to=${MONTH}-31&month=${MONTH}`;

/**
 * What the register makes of a link the chart drew.
 *
 * The href is parsed rather than rebuilt by hand: the question is whether the
 * two screens agree about the rows a band stands for, and a filter written out
 * here would let the link say one thing and the assertion another.
 */
const behind = (href: string | null | undefined) => {
	if (!href) throw new Error('that figure carried no link to follow');
	return parseFilter(new URL(href, 'http://register').searchParams, 'CZK');
};

/** A register total as the chart states the same figure: a positive magnitude. */
const spent = (totals: { currency: string; sumMinor: bigint }[]) =>
	totals.map((total) => toMajor(-total.sumMinor, total.currency));

async function seedMonth(rent: number): Promise<void> {
	await record('salary', 100_000, 'salary');
	await record('rent', rent, 'rent');
	await record('unfiled', -5_000, null);
	await record('brokerage', -20_000, 'brokerage');
}

describe('flowData', () => {
	it('counts savings as saved and the residual as cash kept', async () => {
		await seedMonth(-30_000);
		const flow = await flowData('month');

		expect(flow.totals).toEqual({ in: 100_000, out: 35_000, saved: 20_000, kept: 45_000 });
		// The identity the four totals stand or fall by: unfiled spending rides
		// the catch-all stage, so it is out rather than quietly kept.
		expect(flow.totals.in - flow.totals.out - flow.totals.saved).toBe(flow.totals.kept);
	});

	it('gives savings a stage of its own, keyed by the group', async () => {
		await seedMonth(-30_000);
		const flow = await flowData('month');

		const savings = flow.input.stages.find((stage) => stage.role === 'savings');
		expect(savings).toMatchObject({ key: 'savings', label: 'Saved & invested', amount: 20_000 });
		// The leaves have to hang off the stage's own key or they draw nowhere.
		expect(flow.breakdown.find((group) => group.key === 'savings')?.leaves).toEqual([
			{ key: 'cat:brokerage', name: 'Brokerage', value: 20_000, href: link('category=brokerage') }
		]);
	});

	it('closes the breakdown with the cash it kept', async () => {
		await seedMonth(-30_000);
		const flow = await flowData('month');

		expect(flow.input.keptLabel).toBe('Kept in cash');
		expect(flow.breakdown.at(-1)).toEqual({
			key: KEPT_KEY,
			label: 'Kept in cash',
			colorVar: KEPT_COLOR,
			pct: 45,
			leaves: []
		});
	});

	// A brokerage and a pension are both money put aside and neither is spending,
	// so counting only one of them would report the other as cash still sitting
	// in the account.
	it('gives every savings-role group a stage of its own', async () => {
		await testDb.insert(categoryGroup).values({
			key: 'pension',
			label: 'Pension',
			colorToken: '--purple',
			role: 'savings',
			sort: 9
		});
		await testDb
			.insert(category)
			.values({ id: 'pension-fund', groupKey: 'pension', name: 'Employer plan' });
		await seedMonth(-30_000);
		await record('pension', -10_000, 'pension-fund');

		const flow = await flowData('month');

		expect(flow.totals).toEqual({ in: 100_000, out: 35_000, saved: 30_000, kept: 35_000 });
		expect(flow.totals.in - flow.totals.out - flow.totals.saved).toBe(flow.totals.kept);
		expect(flow.input.stages.filter((stage) => stage.role === 'savings')).toEqual([
			{
				key: 'savings',
				label: 'Saved & invested',
				colorVar: '--series-savings',
				amount: 20_000,
				role: 'savings',
				href: link('group=savings')
			},
			{
				key: 'pension',
				label: 'Pension',
				colorVar: '--purple',
				amount: 10_000,
				role: 'savings',
				href: link('group=pension')
			}
		]);
		expect(flow.breakdown.find((group) => group.key === 'pension')).toEqual({
			key: 'pension',
			label: 'Pension',
			colorVar: '--purple',
			pct: 10,
			leaves: [
				{
					key: 'cat:pension-fund',
					name: 'Employer plan',
					value: 10_000,
					href: link('category=pension-fund')
				}
			]
		});
	});

	// Selling more than was bought over the period is not saving. Counting the
	// magnitude as "saved" understated what was kept by twice the withdrawal.
	it('turns a savings group it drew down into a source rather than a stage', async () => {
		await seedMonth(-30_000);
		await record('brokerage-sale', 30_000, 'brokerage');

		const flow = await flowData('month');

		// 100 000 earned plus the 10 000 net taken back out of the brokerage.
		expect(flow.totals).toEqual({ in: 110_000, out: 35_000, saved: 0, kept: 75_000 });
		expect(flow.totals.in - flow.totals.out - flow.totals.saved).toBe(flow.totals.kept);
		expect(flow.input.stages.filter((stage) => stage.role === 'savings')).toEqual([]);
		expect(flow.input.sources).toContainEqual({
			key: 'grp:savings',
			name: 'Saved & invested',
			amount: 10_000,
			colorVar: '--series-savings',
			href: link('group=savings&dir=in')
		});
		// Nothing was saved, so the strip has nothing to list: the source node on
		// the left is what names the drawdown.
		expect(flow.breakdown.find((group) => group.key === 'savings')).toBeUndefined();
	});

	it('reports a month it could not pay for as money taken from reserves', async () => {
		await seedMonth(-90_000);
		const flow = await flowData('month');

		expect(flow.totals).toEqual({ in: 100_000, out: 95_000, saved: 20_000, kept: -15_000 });
		expect(flow.totals.in - flow.totals.out - flow.totals.saved).toBe(flow.totals.kept);
		expect(flow.input.reservesLabel).toBe('From reserves');
		expect(flow.breakdown.at(-1)).toEqual({
			key: RESERVES_KEY,
			label: 'From reserves',
			colorVar: '--red',
			pct: 15,
			leaves: []
		});
	});
});

/**
 * W2.2: every figure on the chart is a question the register can answer.
 *
 * The whole point of the waterfall is that it is an index into the ledger, so a
 * band that names 45 000 crowns of housing has to be able to show the rows that
 * came to 45 000 crowns. Each link carries the period the chart was drawn for,
 * and opens the anchor month — the one the figures are actually about.
 */
describe('flowData click-through', () => {
	it('sends an income source to its own category, scoped to the period', async () => {
		await seedMonth(-30_000);
		const flow = await flowData('month');

		expect(flow.input.sources.find((source) => source.key === 'cat:salary')?.href).toBe(
			link('category=salary')
		);
	});

	it('sends the trunk to everything that came in', async () => {
		await seedMonth(-30_000);
		const flow = await flowData('month');

		expect(flow.input.incomeHref).toBe(link('dir=in'));
	});

	it('sends a stage to its whole group, not to one category in it', async () => {
		await seedMonth(-30_000);
		const flow = await flowData('month');

		expect(flow.input.stages.find((stage) => stage.key === 'housing')?.href).toBe(
			link('group=housing')
		);
	});

	it('sends a leaf to the category it names', async () => {
		await seedMonth(-30_000);
		const flow = await flowData('month');

		expect(flow.breakdown.find((group) => group.key === 'housing')?.leaves).toEqual([
			{ key: 'cat:rent', name: 'Rent', value: 30_000, href: link('category=rent') }
		]);
	});

	// The unfiled bucket has no category to link to, so it links to their
	// absence: the register's own sentinel, in the direction the money went.
	it('sends the unfiled leaf to the uncategorised money out', async () => {
		await seedMonth(-30_000);
		const flow = await flowData('month');

		expect(flow.breakdown.find((group) => group.key === 'living')?.leaves).toEqual([
			{
				key: 'unfiled:out',
				name: 'Unfiled',
				value: 5_000,
				href: link(`category=${UNCATEGORISED}&dir=out`)
			}
		]);
	});

	// A drawdown is money that came back OUT of the group, so the link asks for
	// what came in — the opposite direction from the stage of the same name.
	it('sends a savings drawdown to the money that came back out of it', async () => {
		await seedMonth(-30_000);
		await record('brokerage-sale', 30_000, 'brokerage');
		const flow = await flowData('month');

		expect(flow.input.sources.find((source) => source.key === 'grp:savings')?.href).toBe(
			link('group=savings&dir=in')
		);
	});

	// The period is not always the month: year-to-date spans the calendar year up
	// to the anchor, and still opens the anchor month.
	it('spans the whole year to date when that is the period', async () => {
		await seedMonth(-30_000);
		const flow = await flowData('ytd');

		expect(flow.input.stages.find((stage) => stage.key === 'housing')?.href).toBe(
			`/transactions?group=housing&from=2026-01-01&to=${MONTH}-31&month=${MONTH}`
		);
	});
});

/**
 * W3.2: a figure on its own is not a fact about a household.
 *
 * 35 000 crowns of housing is only news beside what housing cost last month, so
 * every window carries the one before it — the same window, moved — and the
 * comparison is drawn from the same aggregate the current figures are.
 */
describe('flowData against the window before', () => {
	it('sums the previous window as well as this one', async () => {
		await seedMonth(-30_000);
		await record('salary-prev', 80_000, 'salary', PREVIOUS_MONTH);
		await record('rent-prev', -25_000, 'rent', PREVIOUS_MONTH);

		const flow = await flowData('month');

		expect(flow.previous?.totals.in).toBe(80_000);
		// Group heads are compared too, so every stage the window drew is in there
		// under the key the strip above it uses.
		expect(flow.previous?.byGroupKey.housing).toBe(25_000);
	});

	// A household's first month has nothing behind it, and an empty window is not
	// a window where everything fell to zero.
	it('has nothing to compare when the window before it holds no transactions', async () => {
		await seedMonth(-30_000);

		const flow = await flowData('month');

		expect(flow.previous).toBeNull();
	});

	// Half a window is not a smaller window. A trailing year anchored on the
	// newest month is compared against the twelve months before it, and here the
	// record starts part-way through those — so the months before the first
	// import would be counted as months the household earned nothing.
	//
	// The January movement is what makes this case bite: without it the window
	// before would simply be empty, and the answer would be null for the other
	// reason.
	it('has nothing to compare when the record does not cover the whole window before', async () => {
		await seedMonth(-30_000);
		await record('salary-older', 60_000, 'salary', '2025-01');

		const flow = await flowData('12m');

		expect(flow.previous).toBeNull();
	});
});

/**
 * W4: a mortgage instalment is two different things wearing one amount.
 *
 * The interest is money the household will never see again; the principal is
 * its own money, moved out of an account and into a flat. Drawn as one band of
 * housing, the chart reported a household that saves nothing while it repays
 * the larger half of every instalment to itself.
 */
describe('flowData with a loan payment linked to it', () => {
	const loanId = rowId('cashflow-flow-loan');

	/** This month's instalment, claimed by a loan that says what it carried. */
	async function seedInstalment(): Promise<void> {
		await seedMonth(-30_000);
		const paymentId = await record('mortgage', -20_000, 'rent');
		await makeLoan(testDb, {
			id: loanId,
			name: 'Karlín',
			currency: 'CZK',
			principalMinor: fromMajor(5_000_000, 'CZK'),
			owedMinor: fromMajor(4_120_000, 'CZK'),
			owedOn: `${MONTH}-01`
		});
		await testDb.insert(loanEvent).values({
			id: uuidv7(),
			loanId,
			happenedOn: `${MONTH}-15`,
			kind: 'payment',
			amountMinor: fromMajor(20_000, 'CZK'),
			interestMinor: fromMajor(5_000, 'CZK'),
			transactionId: paymentId
		});
	}

	it('costs the interest and saves the principal', async () => {
		await seedInstalment();

		const flow = await flowData('month');

		// The whole instalment used to be housing: 55 000 out and 20 000 saved.
		// Only the 5 000 of interest is a cost; the 15 000 of principal moved to
		// the savings stage, and the identity holds either way.
		expect(flow.totals).toEqual({ in: 100_000, out: 40_000, saved: 35_000, kept: 25_000 });
		expect(flow.totals.in - flow.totals.out - flow.totals.saved).toBe(flow.totals.kept);
		// Each half is a leaf naming the loan, and each leads to the line it
		// became: the interest stays under the category the debit was filed with,
		// the principal is filed under the seeded category the register uses.
		expect(flow.breakdown.find((group) => group.key === 'housing')?.leaves).toEqual([
			{ key: 'cat:rent', name: 'Rent', value: 30_000, href: link('category=rent') },
			{
				key: `loan:${loanId}:interest`,
				name: 'Karlín · interest',
				value: 5_000,
				href: link('category=rent')
			}
		]);
		expect(flow.breakdown.find((group) => group.key === 'savings')?.leaves).toEqual([
			{ key: 'cat:brokerage', name: 'Brokerage', value: 20_000, href: link('category=brokerage') },
			{
				key: `loan:${loanId}:principal`,
				name: 'Karlín · principal',
				value: 15_000,
				href: link(`category=${LOAN_PRINCIPAL_CATEGORY}`)
			}
		]);
	});

	// The assertion the whole thing is for. A band is only an index into the
	// ledger if the rows it opens come to what the band says: the chart used to
	// draw 35 000 of housing and hand the register a link listing 50 000, because
	// the split existed on one side of that link and not the other.
	it('agrees with the register the stage links to, on both stages', async () => {
		await seedInstalment();

		const flow = await flowData('month');
		const stage = (key: string) => flow.input.stages.find((s) => s.key === key);
		const housing = stage('housing');
		const savings = stage('savings');

		expect(housing?.amount).toBe(35_000);
		expect(savings?.amount).toBe(35_000);

		const housingRows = await registerPage(behind(housing?.href), testDb);
		expect(spent(housingRows.totals)).toEqual([35_000]);
		const savingsRows = await registerPage(behind(savings?.href), testDb);
		expect(spent(savingsRows.totals)).toEqual([35_000]);

		// And the month row above the list, which is summed separately.
		const housingMonths = await registerMonths(behind(housing?.href), testDb);
		expect(housingMonths.find((m) => m.month === MONTH)?.byCurrency).toEqual([
			{
				currency: 'CZK',
				inMinor: 0n,
				outMinor: fromMajor(35_000, 'CZK'),
				sumMinor: fromMajor(-35_000, 'CZK')
			}
		]);
		const savingsMonths = await registerMonths(behind(savings?.href), testDb);
		expect(savingsMonths.find((m) => m.month === MONTH)?.byCurrency).toEqual([
			{
				currency: 'CZK',
				inMinor: 0n,
				outMinor: fromMajor(35_000, 'CZK'),
				sumMinor: fromMajor(-35_000, 'CZK')
			}
		]);
	});

	// Each half's own link is a category filter, and the rows behind it come to
	// the half rather than to the whole instalment.
	it('agrees with the register the principal leaf links to', async () => {
		await seedInstalment();

		const flow = await flowData('month');
		const principal = flow.breakdown
			.find((group) => group.key === 'savings')
			?.leaves.find((leaf) => leaf.key === `loan:${loanId}:principal`);

		expect(principal?.value).toBe(15_000);
		const rows = await registerPage(behind(principal?.href), testDb);
		expect(spent(rows.totals)).toEqual([15_000]);
	});
});
