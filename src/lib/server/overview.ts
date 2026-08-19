// One data builder per Overview panel.
//
// The board only computes what it is actually showing. Thirteen panels' worth
// of queries on every load would be a serious regression from the four the
// fixed screen ran, and most people will place a handful — so the loader asks
// for the visible keys and nothing else runs. The "Add a panel" tray needs only
// titles, which come from the registry and cost nothing.

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	account,
	brokerOperation,
	category,
	loan,
	loanProperty,
	netWorthSnapshot,
	person,
	portfolioSnapshot,
	property,
	taxStatement,
	transaction
} from '$lib/server/db/schema';
import { buildBriefing } from '$lib/server/briefing';
import { next30Days } from '$lib/server/calendar';
import { flowData, monthlyHistory, type Period } from '$lib/server/cashflow';
import type { NetWorth } from '$lib/server/networth';
import { retirementInputs } from '$lib/server/retirement';
import { configuredHomeProvider } from '$lib/server/home';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { accountBalanceInBase } from '$lib/accounts/balance';
import { annualisedReturn } from '$lib/server/invest/series';
import { getRevisionedSetting } from '$lib/server/settings';
import { RETIRE_DEFAULTS, retModel, type RetireConfig } from '$lib/retire';
import { displayCurrency, formatMinor, toMajor } from '$lib/money';

/** Deterministic series colours, in the order V2 assigns them. */
const SERIES = ['--blue', '--green', '--purple', '--orange', '--teal', '--yellow'];

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Shared work, computed at most once per request however many panels want it.
 *
 * `netWorth` in particular is already computed by the (app) layout for the
 * sidebar card, so the loader hands that promise straight in rather than
 * running the whole calculation a second time.
 */
export interface PanelContext {
	baseCurrency: string;
	period: Period;
	netWorth: () => Promise<NetWorth>;
	rates: () => ReturnType<typeof loadRateTable>;
}

type Builder = (ctx: PanelContext) => Promise<unknown>;

function money(minor: bigint, currency: string): string {
	return `${formatMinor(minor, currency)} ${displayCurrency(currency)}`;
}

/** Bar widths as a share of the largest row, with a visible floor. */
function share(value: number, largest: number): number {
	return largest > 0 ? Math.max(2, Math.round((value / largest) * 100)) : 2;
}

const builders: Record<string, Builder> = {
	briefing: () => buildBriefing(),

	flow: (ctx) => flowData(ctx.period),

	composition: async (ctx) => {
		const netWorth = await ctx.netWorth();
		const unit = displayCurrency(netWorth.baseCurrency);
		const format = (v: bigint) => `${formatMinor(v, netWorth.baseCurrency)} ${unit}`;
		// Bars scale against the largest gross exposure, asset or pure debt.
		const largestGross = netWorth.groups.reduce((max, g) => {
			const gross = g.assetMinor > g.liabilityMinor ? g.assetMinor : g.liabilityMinor;
			return gross > max ? gross : max;
		}, 1n);

		return {
			groups: netWorth.groups.map((g) => {
				const gross = g.assetMinor > g.liabilityMinor ? g.assetMinor : g.liabilityMinor;
				const netMinor = g.assetMinor - g.liabilityMinor;
				return {
					label: g.label,
					asset: g.assetMinor > 0n ? format(g.assetMinor) : null,
					liability: g.liabilityMinor > 0n ? `− ${format(g.liabilityMinor)}` : null,
					net: format(netMinor),
					netNegative: netMinor < 0n,
					colorVar: g.colorVar,
					width: Math.max(2, Math.round((Number(gross) / Number(largestGross)) * 100)),
					owedPct:
						g.liabilityMinor > 0n && gross > 0n
							? Math.min(100, Math.round((Number(g.liabilityMinor) / Number(gross)) * 100))
							: 0,
					detail: g.detail
				};
			}),
			assetsTotal: format(netWorth.assetsMinor),
			liabilitiesTotal: `− ${format(netWorth.liabilitiesMinor)}`,
			net: format(netWorth.totalMinor),
			netPositive: netWorth.totalMinor >= 0n
		};
	},

	upcoming: () => next30Days(),

	networth: async (ctx) => {
		const rows = await db
			.select()
			.from(netWorthSnapshot)
			.orderBy(desc(netWorthSnapshot.day))
			.limit(360);
		const rates = await ctx.rates();
		const points = rows
			.slice()
			.reverse()
			.map((r) => ({
				day: r.day,
				value: toMajor(
					convertOrFace(rates, r.valueMinor, r.currency, ctx.baseCurrency, r.day),
					ctx.baseCurrency
				)
			}));

		if (points.length < 2) return { points: [], caption: 'Not enough history yet.', unit: '' };

		const low = Math.min(...points.map((p) => p.value));
		const high = Math.max(...points.map((p) => p.value));
		const span = high - low || 1;

		return {
			unit: displayCurrency(ctx.baseCurrency),
			caption: `${points[0].day.slice(0, 7)} → ${points[points.length - 1].day.slice(0, 7)}`,
			first: points[0].value,
			last: points[points.length - 1].value,
			// Normalised to 0–100 so the component draws without knowing the scale.
			points: points.map((p, i) => ({
				x: (i / (points.length - 1)) * 100,
				y: 100 - ((p.value - low) / span) * 100
			}))
		};
	},

	accounts: async (ctx) => {
		const [rows, rates] = await Promise.all([
			db
				.select({
					id: account.id,
					name: account.name,
					emoji: account.emoji,
					currency: account.currency,
					balanceMinor: account.balanceMinor,
					balanceAsOf: account.balanceOn
				})
				.from(account)
				.orderBy(account.createdAt, account.id),
			ctx.rates()
		]);

		const day = today();
		const balances = rows.map((r) => ({
			id: r.id,
			name: r.name,
			emoji: r.emoji || '🏦',
			// Today's basis, matching the sidebar total rather than each statement
			// date, so the two figures cannot disagree. totalMinor is the converted
			// figure with a face-value fallback; exactMinor is null when no rate
			// was found, which this panel does not distinguish.
			minor: accountBalanceInBase(rates, r.balanceMinor, r.currency, ctx.baseCurrency, day)
				.totalMinor
		}));
		const positive = balances.filter((b) => b.minor > 0n);
		const total = positive.reduce((sum, b) => sum + b.minor, 0n);
		const largest = positive.reduce((max, b) => (b.minor > max ? b.minor : max), 0n);

		return {
			total: money(total, ctx.baseCurrency),
			rows: positive.map((b, i) => ({
				id: b.id,
				name: b.name,
				emoji: b.emoji,
				value: money(b.minor, ctx.baseCurrency),
				pct: total > 0n ? Math.round((Number(b.minor) / Number(total)) * 100) : 0,
				width: share(Number(b.minor), Number(largest)),
				colorVar: SERIES[i % SERIES.length]
			}))
		};
	},

	equity: async (ctx) => {
		const [properties, loans, links, rates] = await Promise.all([
			db.select().from(property),
			db.select().from(loan),
			db.select().from(loanProperty),
			ctx.rates()
		]);
		const day = today();
		const toBase = (minor: bigint, currency: string, on = day) =>
			convertOrFace(rates, minor, currency, ctx.baseCurrency, on);

		const rows = properties.map((p) => {
			const value = toBase(p.valueMinor, p.currency, p.valuedOn ?? day);
			// A mortgage can cover more than one flat, so only its share counts here.
			const owed = links
				.filter((link) => link.propertyId === p.id)
				.reduce((sum, link) => {
					const l = loans.find((candidate) => candidate.id === link.loanId);
					if (!l) return sum;
					const shareOfLoan = Number(link.sharePct ?? 100) / 100;
					const owedBase = toBase(l.owedMinor, l.currency, l.owedOn ?? day);
					return sum + BigInt(Math.round(Number(owedBase) * shareOfLoan));
				}, 0n);
			const equity = value - owed;
			return {
				id: p.id,
				name: p.name,
				value: money(value, ctx.baseCurrency),
				owed: owed > 0n ? money(owed, ctx.baseCurrency) : null,
				equity: money(equity, ctx.baseCurrency),
				equityPct: value > 0n ? Math.max(0, Math.round((Number(equity) / Number(value)) * 100)) : 0
			};
		});

		return { rows };
	},

	energy: async () => {
		const provider = await configuredHomeProvider();
		if (!provider) return { days: [], note: 'No smart-home provider is configured.' };

		const days = await provider.energyHistory(14);
		if (days.length === 0) return { days: [], note: 'No readings in the last fortnight.' };

		const average = days.reduce((sum, d) => sum + d.kwh, 0) / days.length;
		const peak = Math.max(...days.map((d) => d.kwh), 1);

		return {
			average: average.toFixed(1),
			note: null,
			days: days.map((d) => ({
				day: d.day.slice(5),
				kwh: d.kwh.toFixed(1),
				height: Math.max(2, Math.round((d.kwh / peak) * 100)),
				// Days above the fortnight's average are the ones worth noticing.
				above: d.kwh > average
			}))
		};
	},

	investments: async (ctx) => {
		const [snapshots, operations, rates] = await Promise.all([
			db.select().from(portfolioSnapshot).orderBy(desc(portfolioSnapshot.day)).limit(1),
			db.select().from(brokerOperation),
			ctx.rates()
		]);

		const latest = snapshots[0];
		if (!latest) return { empty: true };

		const day = today();
		const value = convertOrFace(rates, latest.valueMinor, latest.currency, ctx.baseCurrency, day);
		const contributions = operations
			.filter((o) => ['Deposit', 'Withdrawal', 'Subaccount transfer'].includes(o.type))
			.map((o) => ({
				at: o.happenedAt.toISOString().slice(0, 10),
				amountMinor: convertOrFace(
					rates,
					o.amountMinor,
					o.currency,
					ctx.baseCurrency,
					o.happenedAt.toISOString().slice(0, 10)
				)
			}));
		const moneyIn = contributions.reduce((sum, c) => sum + c.amountMinor, 0n);
		const gain = value - moneyIn;
		const annualised = annualisedReturn(contributions, value, ctx.baseCurrency);

		return {
			empty: false,
			asOf: latest.day,
			value: money(value, ctx.baseCurrency),
			moneyIn: money(moneyIn, ctx.baseCurrency),
			gain: money(gain, ctx.baseCurrency),
			gainPositive: gain >= 0n,
			annualised: annualised === null ? null : `${annualised.toFixed(1)}%`
		};
	},

	retirement: async (ctx) => {
		const [inputs, stored] = await Promise.all([
			retirementInputs(ctx.baseCurrency),
			getRevisionedSetting<Partial<RetireConfig>>('retirement', {})
		]);
		const config = { ...RETIRE_DEFAULTS, ...stored.value };
		const model = retModel(inputs, config);
		const unit = displayCurrency(ctx.baseCurrency);

		if (!model.fire) {
			return {
				hue: 'red' as const,
				pill: 'not reached',
				headline: 'The target is not reached within 40 years.',
				detail: `On ${config.realReturn}% real return and ${config.swr}% withdrawal.`
			};
		}

		return {
			hue: model.fire.t === 0 ? ('green' as const) : ('yellow' as const),
			pill: model.fire.t === 0 ? 'already there' : `${model.fire.t} years`,
			headline:
				model.fire.t === 0
					? 'You could stop now on these assumptions.'
					: `On track for ${model.fire.year}, aged ${model.fire.a1} and ${model.fire.a2}.`,
			detail: `Pot ${Math.round(model.fire.total).toLocaleString('en')} ${unit} against a target that needs ${Math.round(model.fire.draw + model.fire.pension).toLocaleString('en')} ${unit} a year.`
		};
	},

	tax: async () => {
		const statements = await db
			.select({
				personId: taxStatement.personId,
				personName: person.name,
				year: taxStatement.year,
				country: taxStatement.country,
				currency: taxStatement.currency,
				grossIncomeMinor: taxStatement.grossIncomeMinor,
				taxPaidMinor: taxStatement.taxPaidMinor
			})
			.from(taxStatement)
			.leftJoin(person, eq(taxStatement.personId, person.id))
			.orderBy(desc(taxStatement.year));

		// One row per person: their most recent declared year. Keyed on the id,
		// not the name — two people sharing a name are still two people, and a
		// statement whose person row has gone still has an id of its own.
		const latest = new Map<string, (typeof statements)[number]>();
		for (const s of statements) {
			if (!latest.has(s.personId)) latest.set(s.personId, s);
		}

		return {
			rows: [...latest.values()].map((s) => ({
				id: s.personId,
				personName: s.personName ?? '—',
				year: s.year,
				country: s.country,
				gross: money(s.grossIncomeMinor, s.currency),
				taxPaid: money(s.taxPaidMinor, s.currency),
				ratePct:
					s.grossIncomeMinor > 0n
						? ((Number(s.taxPaidMinor) / Number(s.grossIncomeMinor)) * 100).toFixed(1)
						: null
			}))
		};
	},

	activity: async (ctx) => {
		const rows = await db
			.select({
				bookedOn: transaction.bookedOn,
				counterparty: transaction.counterparty,
				description: transaction.description,
				amountMinor: transaction.amountMinor,
				currency: transaction.currency,
				categoryLabel: category.name
			})
			.from(transaction)
			.leftJoin(category, eq(transaction.categoryId, category.id))
			// Transfers move money between the household's own accounts; showing
			// them here would read as spending that never happened.
			.where(and(isNull(transaction.transferPairId), sql`${transaction.amountMinor} <> 0`))
			.orderBy(desc(transaction.bookedOn), desc(transaction.id))
			.limit(8);

		return {
			baseCurrency: displayCurrency(ctx.baseCurrency),
			rows: rows.map((r) => ({
				date: r.bookedOn.slice(5),
				merchant: r.counterparty ?? r.description ?? '—',
				category: r.categoryLabel,
				amount: `${formatMinor(r.amountMinor, r.currency, { signed: true })} ${displayCurrency(r.currency)}`,
				negative: r.amountMinor < 0n
			}))
		};
	},

	savings: async () => {
		const history = await monthlyHistory();
		const months = history.slice(-12);
		if (months.length === 0) return { months: [], averagePct: null };

		const peak = Math.max(...months.map((m) => Math.abs(m.earned - m.spent)), 1);
		const rows = months.map((m) => {
			const kept = m.earned - m.spent;
			return {
				month: m.month.slice(2),
				kept: Math.round(kept).toLocaleString('en'),
				negative: kept < 0,
				height: Math.max(2, Math.round((Math.abs(kept) / peak) * 100)),
				pct: m.earned > 0 ? Math.round((kept / m.earned) * 100) : null
			};
		});
		const earned = months.reduce((sum, m) => sum + m.earned, 0);
		const kept = months.reduce((sum, m) => sum + (m.earned - m.spent), 0);

		return {
			months: rows,
			averagePct: earned > 0 ? Math.round((kept / earned) * 100) : null
		};
	}
};

/**
 * Build exactly the panels asked for, concurrently, and let each one fail alone.
 *
 * `Promise.all` would take the whole screen down with any single builder. That
 * is not hypothetical: `energy` calls out to Home Assistant over HTTP, so an
 * unplugged box turned the entire Overview into a 500 — and because the panel
 * placement persists, it stayed broken until the layout was edited by hand.
 * A panel that cannot load now renders its own failure and the board survives.
 */
export async function panelData(
	keys: string[],
	ctx: PanelContext
): Promise<Record<string, unknown>> {
	const wanted = keys.filter((key) => Object.hasOwn(builders, key));
	const built = await Promise.allSettled(wanted.map((key) => builders[key](ctx)));

	return Object.fromEntries(
		wanted.map((key, i) => {
			const outcome = built[i];
			if (outcome.status === 'fulfilled') return [key, outcome.value];
			console.error(`overview panel "${key}" failed to load:`, outcome.reason);
			return [key, { failed: true }];
		})
	);
}
