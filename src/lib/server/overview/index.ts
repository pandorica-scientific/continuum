// SPDX-License-Identifier: AGPL-3.0-or-later
// One data builder per Overview panel. Only the panels actually placed are
// computed — the loader asks for the visible keys and nothing else runs.

import { and, count, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	account,
	bank,
	brokerOperation,
	category,
	document,
	documentLink,
	importFile,
	loan,
	loanFixationPeriod,
	loanProperty,
	netWorthSnapshot,
	person,
	portfolioSnapshot,
	property,
	shelf,
	subject,
	taxStatement,
	transaction
} from '$lib/server/db/schema';
import { buildBriefing } from '$lib/server/briefing';
import { effectiveDate } from '$lib/server/transactions';
import { archiveScopePredicate } from '$lib/server/documents/visibility';
import { SYSTEM_SHELF_KEYS } from '$lib/documents/shelves';
import { systemShelfId } from '$lib/server/documents/shelves';
import { groupSummary } from '$lib/documents/view';
import { statementStatus } from '$lib/statements/cadence';
import { latestSalaryByPerson } from '$lib/server/salary/history';
import { deltaPct, deltaTone } from '$lib/charts/delta';
import { monthLabel } from '$lib/cashflow/period';
import { periodForMonth, type FixationPeriod } from '$lib/loans/amortise';
import { fixationPill } from '$lib/loans/pill';
import type { GroupMonthSpend } from '$lib/server/cashflow/spending';
import { expenseGroups, loadCategoryGroups } from '$lib/server/categorize/groups';
import { budgetRows, comparedMonth } from '$lib/budget';
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
import { compactAxis, displayCurrency, formatMinor, fromMajor, toMajor } from '$lib/money';
import { notOwnTransfer } from '$lib/server/transactions/transfers';

/** Deterministic series colours, in the order V2 assigns them. */
const SERIES = ['--blue', '--green', '--purple', '--orange', '--teal', '--yellow'];

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Shared work, computed at most once per request however many panels want it.
 *
 * `netWorth` is already computed by the (app) layout for the sidebar card, so
 * the loader hands that promise straight in rather than recomputing it.
 */
interface PanelContext {
	baseCurrency: string;
	period: Period;
	/**
	 * The month the period-scoped panels are anchored to (`YYYY-MM`): the one
	 * `?anchor` asked for, the latest with a transaction, or null.
	 *
	 * Re-anchors only the two period-scoped panels — the header caption stays on
	 * the data month, since that's what every other panel reports.
	 *
	 * Read from here so no two panels end up anchored to different months.
	 */
	anchorMonth: string | null;
	netWorth: () => Promise<NetWorth>;
	rates: () => ReturnType<typeof loadRateTable>;
	/**
	 * Every expense group's spending, month by month, over the whole record.
	 *
	 * Memoised because two panels want it (briefing's overspend card, and the
	 * month-against-its-average panel) and it's the most expensive query here.
	 */
	spending: () => Promise<GroupMonthSpend[]>;
}

type Builder = (ctx: PanelContext) => Promise<unknown>;

function money(minor: bigint, currency: string): string {
	return `${formatMinor(minor, currency)} ${displayCurrency(currency)}`;
}

/** How many shelves the Paper panel names before the rest are left to /documents. */
const TOP_SHELVES = 5;

/** Bar widths as a share of the largest row, with a visible floor. */
function share(value: number, largest: number): number {
	return largest > 0 ? Math.max(2, Math.round((value / largest) * 100)) : 2;
}

const builders: Record<string, Builder> = {
	briefing: (ctx) => buildBriefing({ spending: ctx.spending }),

	flow: (ctx) => flowData(ctx.period, { anchor: ctx.anchorMonth }),

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

		if (points.length < 2) {
			return { points: [], caption: 'Not enough history yet.', unit: '', yTicks: [], xTicks: [] };
		}

		const low = Math.min(...points.map((p) => p.value));
		const high = Math.max(...points.map((p) => p.value));
		const span = high - low || 1;
		const y = (value: number) => 100 - ((value - low) / span) * 100;

		// Floor, middle, ceiling — labelled on one shared step so "2.4M" and
		// "2.6M" read off the same scale.
		const gridValues = [low, (low + high) / 2, high];
		const gridLabels = compactAxis(
			gridValues.map((v) => fromMajor(v, ctx.baseCurrency)),
			ctx.baseCurrency
		);
		const yTicks = gridValues.map((value, i) => ({ y: y(value), label: gridLabels[i] }));

		// One label where each year begins, plus the first month when the span
		// starts mid-year, so the reader knows which stretch of time this is.
		const xTicks: { x: number; label: string }[] = [];
		points.forEach((p, i) => {
			const month = p.day.slice(0, 7);
			const previous = i > 0 ? points[i - 1].day.slice(0, 7) : null;
			if (previous === month) return;
			const x = (i / (points.length - 1)) * 100;
			if (i === 0) xTicks.push({ x, label: month });
			else if (month.endsWith('-01') && x < 92) xTicks.push({ x, label: month.slice(0, 4) });
		});

		return {
			unit: displayCurrency(ctx.baseCurrency),
			caption: `${points[0].day.slice(0, 7)} → ${points[points.length - 1].day.slice(0, 7)}`,
			first: points[0].value,
			last: points[points.length - 1].value,
			yTicks,
			xTicks,
			// Normalised to 0–100 so the component draws without knowing the scale.
			points: points.map((p, i) => ({
				x: (i / (points.length - 1)) * 100,
				y: y(p.value)
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
			// date, so the two figures cannot disagree.
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

		// One row per person: their most recent declared year, keyed on id not
		// name — two people can share a name.
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
		// The day the money moved — matches the register and cash flow, avoiding
		// a card payment reading a different date here than in the register it links to.
		const day = effectiveDate();
		const rows = await db
			.select({
				effectiveOn: sql<string>`${day}`,
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
			.where(and(notOwnTransfer(), sql`${transaction.amountMinor} <> 0`))
			.orderBy(sql`${day} desc`, desc(transaction.id))
			.limit(8);

		return {
			baseCurrency: displayCurrency(ctx.baseCurrency),
			rows: rows.map((r) => ({
				date: r.effectiveOn.slice(5),
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
		if (months.length === 0) return { months: [], peak: '0', averagePct: null };

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
			// Labels the top of the Y axis. Bars are drawn as a percentage of this,
			// so without it a tall bar carries no magnitude at all.
			peak: Math.round(peak).toLocaleString('en'),
			averagePct: earned > 0 ? Math.round((kept / earned) * 100) : null
		};
	},

	paper: async () => {
		// Archive scope on every count below, in the query rather than on the
		// rows that come back.
		const readable = archiveScopePredicate(false);

		// `systemShelfId` throws where the shelf is missing; a panel that only
		// counts has no stake in that, so swallow it.
		const inboxId = await systemShelfId(SYSTEM_SHELF_KEYS.inbox).catch(() => null);

		const [inboxRows, shelfRows, expiring, filed] = await Promise.all([
			// Deliberately WITHOUT the archive half — matches what the review
			// screen counts, since this figure links to it.
			inboxId
				? db.select({ n: count() }).from(document).where(eq(document.shelfId, inboxId))
				: Promise.resolve([]),
			db
				.select({
					id: shelf.id,
					key: shelf.key,
					label: shelf.label,
					emoji: shelf.emoji,
					n: count()
				})
				.from(document)
				.innerJoin(shelf, eq(shelf.id, document.shelfId))
				.where(readable)
				.groupBy(shelf.id, shelf.key, shelf.label, shelf.emoji),
			db
				.select({
					expiresOn: document.expiresOn,
					expiryVerb: document.expiryVerb,
					addedOn: document.addedOn,
					// A document filed against several subjects: an archived one
					// demotes it, same rule the Documents screen applies. Distinct from
					// the archive scope above, which hides only when ALL are archived.
					subjectArchived: sql<boolean>`exists (
						select 1 from ${documentLink} dl
						join ${subject} s on s.id = dl.target_id
						where dl.document_id = ${document.id} and s.archived_at is not null
					)`
				})
				.from(document)
				// Only dated paper: nothing without an expiry is soon, past, or next.
				.where(and(readable, isNotNull(document.expiresOn))),
			db
				.select({ last: sql<string | null>`max(${document.addedOn})` })
				.from(document)
				.where(inboxId ? and(readable, ne(document.shelfId, inboxId)) : readable)
		]);

		const summary = groupSummary(expiring, today());

		return {
			inbox: inboxRows[0]?.n ?? 0,
			expiring: { soon: summary.soon, expired: summary.expired, next: summary.nextExpiry },
			// The busiest five, not all of them.
			shelves: shelfRows
				// By id, not key: `inboxId` was taken by id, and must mean the same shelf.
				.filter((row) => row.id !== inboxId)
				.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
				.slice(0, TOP_SHELVES)
				.map((row) => ({
					key: row.key,
					label: row.label,
					emoji: row.emoji,
					count: row.n,
					href: `/documents?shelf=${encodeURIComponent(row.key)}`
				})),
			lastFiled: filed[0]?.last ?? null
		};
	},

	statements: async () => {
		const [accounts, uploads, banks] = await Promise.all([
			db
				.select({ id: account.id, name: account.name, emoji: account.emoji, bank: account.bank })
				.from(account)
				.orderBy(account.createdAt, account.id),
			db
				.select({ accountId: importFile.accountId, uploadedAt: importFile.uploadedAt })
				.from(importFile),
			db.select({ key: bank.key, label: bank.label }).from(bank)
		]);

		// The ACCOUNT says which bank it is with, not the statement — an import
		// takes its bank from the account. `account.bank` is not a foreign key,
		// so an unknown key falls back to itself rather than a blank.
		const bankLabel = new Map(banks.map((b) => [b.key, b.label]));

		const daysByAccount = new Map<string, string[]>();
		for (const upload of uploads) {
			if (!upload.accountId) continue;
			const days = daysByAccount.get(upload.accountId) ?? [];
			days.push(upload.uploadedAt.toISOString().slice(0, 10));
			daysByAccount.set(upload.accountId, days);
		}

		const day = today();
		return {
			// Creation order, same as the Accounts panel — two panels listing the
			// same accounts differently would be a puzzle.
			rows: accounts.map((a) => {
				const status = statementStatus(daysByAccount.get(a.id) ?? [], day);
				return {
					id: a.id,
					name: a.name,
					emoji: a.emoji || '🏦',
					bank: bankLabel.get(a.bank) ?? a.bank,
					lastOn: status.lastOn,
					daysSince: status.daysSince,
					stale: status.stale,
					hue: status.stale ? ('yellow' as const) : ('grey' as const)
				};
			})
		};
	},

	salary: async (ctx) => {
		const rates = await ctx.rates();
		const people = await latestSalaryByPerson(ctx.baseCurrency, (amount, from, to, day) =>
			convertOrFace(rates, amount, from, to, day)
		);

		return {
			rows: people.map((p) => {
				const { netMinor, grossMinor } = p.latest;
				// Arrow is on NET where stated (falls back to gross only when no net
				// was stated) — comparing net against gross would report a false pay cut.
				const onNet = netMinor !== null;
				const current = onNet ? netMinor : grossMinor;
				const before = onNet ? (p.previous?.netMinor ?? null) : (p.previous?.grossMinor ?? null);
				const pct =
					current === null || before === null
						? null
						: deltaPct(toMajor(current, ctx.baseCurrency), toMajor(before, ctx.baseCurrency));

				return {
					id: p.personId,
					name: p.name,
					month: monthLabel(p.latest.periodMonth),
					net: netMinor === null ? null : money(netMinor, ctx.baseCurrency),
					gross: grossMinor === null ? null : money(grossMinor, ctx.baseCurrency),
					deltaPct: pct,
					// Earning more is the good news here — the percentage alone can't say that.
					deltaTone: deltaTone(pct, true)
				};
			})
		};
	},

	debts: async (ctx) => {
		const [loans, allPeriods, rates] = await Promise.all([
			db.select().from(loan).orderBy(loan.createdAt, loan.id),
			db.select().from(loanFixationPeriod),
			ctx.rates()
		]);

		const day = today();
		const month = day.slice(0, 7);
		let totalOwedMinor = 0n;

		const rows = loans
			// Paid-off loans are history; this panel is about what's still owed.
			.filter((l) => l.owedMinor > 0n)
			.map((l) => {
				const periods: FixationPeriod[] = allPeriods
					.filter((p) => p.loanId === l.id)
					.map((p) => ({
						startsOn: p.startsOn,
						endsOn: p.endsOn,
						annualRatePct: Number(p.annualRatePct),
						paymentMinor: p.paymentMinor
					}));
				const current = periodForMonth(periods, month);
				// The same pill the Loans screen draws.
				const pill = fixationPill(l.regime, periods, false, day);
				totalOwedMinor += convertOrFace(
					rates,
					l.owedMinor,
					l.currency,
					ctx.baseCurrency,
					l.owedOn ?? day
				);

				return {
					id: l.id,
					name: l.name,
					// In the LOAN's own currency, matching the statement; the total
					// below is the only figure converted.
					owed: money(l.owedMinor, l.currency),
					ratePct: current ? current.annualRatePct.toFixed(2) : null,
					payment: current ? money(current.paymentMinor, l.currency) : null,
					fixationEnd: pill.label,
					hue: pill.hue,
					href: `/loans#loan-${l.id}`
				};
			});

		return { rows, totalOwed: money(totalOwedMinor, ctx.baseCurrency) };
	},

	budget: async (ctx) => {
		const unit = displayCurrency(ctx.baseCurrency);
		// The latest COMPLETE month, not necessarily the anchored one — comparing
		// a few days of the current month against full prior months would falsely
		// show every group under its average.
		const month = comparedMonth(ctx.anchorMonth, today().slice(0, 7));
		if (!month) return { month: null, unit, rows: [] };

		const [spending, groups] = await Promise.all([ctx.spending(), loadCategoryGroups()]);

		return {
			month: monthLabel(month),
			unit,
			rows: budgetRows(
				spending.map((row) => ({
					groupKey: row.groupKey,
					month: row.month,
					spent: toMajor(row.spentMinor, ctx.baseCurrency)
				})),
				// Expense stages only — income and savings aren't things a month runs over on.
				expenseGroups(groups),
				month
			)
		};
	}
};

/**
 * Build exactly the panels asked for, concurrently, and let each one fail alone.
 *
 * `Promise.all` would take the whole screen down with any single builder —
 * e.g. `energy` calling out to Home Assistant over HTTP. A failed panel now
 * renders its own failure instead.
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
