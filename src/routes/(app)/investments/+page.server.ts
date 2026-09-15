// SPDX-License-Identifier: AGPL-3.0-or-later
import { fail } from '@sveltejs/kit';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	account,
	brokerOperation,
	brokerPosition,
	engagement,
	holding,
	organisation,
	person,
	portfolioSnapshot,
	securityPrice
} from '$lib/server/db/schema';
import { grantsWithTranches, normaliseTicker } from '$lib/server/equity';
import { latestPrices, priceHistory, pricedTickers } from '$lib/server/prices';
import { getPriceSettings } from '$lib/server/prices/settings';
import { equityGrantRows, heldEquityValues } from '$lib/invest/equity-rows';
import { brokerReports, uploadBrokerReport } from '$lib/server/invest/reports';
import { documentsAbout } from '$lib/server/documents/targets';
import { annualisedReturn, buildSeries, markedTail } from '$lib/server/invest/series';
import { seriesFor } from '$lib/invest/series';
import { convertMinorSync, convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { getSetting } from '$lib/server/settings';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { DEFAULT_GAINS_POLICY, realisedGains, type GainsPolicy } from '$lib/invest/gains';
import { getBaseCurrency } from '$lib/server/settings';
import { displayCurrency, formatMinor, parseAmountToMinor, toMajor } from '$lib/money';
import { positiveDonutSlices } from '$lib/charts/donut';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const baseCurrency = await getBaseCurrency();
	const [holdings, operations, snapshots, positions, rates, taxPolicy, brokerageAccounts] =
		await Promise.all([
			db.select().from(holding).orderBy(desc(holding.valueMinor)),
			db.select().from(brokerOperation).orderBy(asc(brokerOperation.happenedAt)),
			db.select().from(portfolioSnapshot).orderBy(asc(portfolioSnapshot.day)),
			db.select().from(brokerPosition),
			loadRateTable(),
			// How this household is taxed on what it sells. Configured rather than
			// assumed: the rate differs by country, and the holding-period exemption
			// below is a Czech rule that would produce wrong figures anywhere else.
			getSetting<GainsPolicy>('investTax', DEFAULT_GAINS_POLICY),
			db
				.select({ id: account.id, name: account.name })
				.from(account)
				.where(eq(account.kind, 'brokerage'))
		]);

	// Reports: filed against the one brokerage account when there is exactly
	// one — the ordinary case, and the same account the accounts screen shows
	// them on too — and read by type otherwise, since there is no single
	// account to key a `documentsAbout` lookup off when none has been added
	// yet or more than one exists.
	const soleBrokerageAccount = brokerageAccounts.length === 1 ? brokerageAccounts[0] : null;
	const reportsTarget = soleBrokerageAccount
		? { id: soleBrokerageAccount.id, kind: 'account' as const, label: soleBrokerageAccount.name }
		: { id: '', kind: 'account' as const, label: 'Broker reports' };
	const reports = soleBrokerageAccount
		? await documentsAbout(soleBrokerageAccount.id)
		: await brokerReports();

	const latestSnapshot = snapshots[snapshots.length - 1] ?? null;

	// Realised this calendar year. Deliberately NOT converted: a disposal's gain
	// is a fact in the currency it was realised in, and the tax on it is charged
	// there too, so converting would produce a figure no tax office would
	// recognise. Positions in another currency are counted separately below.
	const thisYear = new Date().getUTCFullYear();
	const gains = realisedGains(positions, thisYear, taxPolicy);
	const accountCurrency =
		latestSnapshot?.currency ?? holdings[0]?.currency ?? operations.at(-1)?.currency ?? 'EUR';
	const operationValues = operations.map((operation) => {
		const day = operation.happenedAt.toISOString().slice(0, 10);
		return {
			...operation,
			amountMinor: convertOrFace(
				rates,
				operation.amountMinor,
				operation.currency,
				accountCurrency,
				day
			)
		};
	});
	const contributionOps = operationValues
		.filter((o) => ['Deposit', 'Withdrawal', 'Subaccount transfer'].includes(o.type))
		.map((o) => ({ at: o.happenedAt.toISOString().slice(0, 10), amountMinor: o.amountMinor }));

	const portfolioValue = latestSnapshot
		? convertOrFace(
				rates,
				latestSnapshot.valueMinor,
				latestSnapshot.currency,
				accountCurrency,
				latestSnapshot.day
			)
		: 0n;
	const moneyIn = contributionOps.reduce((s, c) => s + c.amountMinor, 0n);
	const gain = portfolioValue - moneyIn;
	const annualised = annualisedReturn(contributionOps, portfolioValue, accountCurrency);

	const valueBase = convertMinorSync(
		rates,
		portfolioValue,
		accountCurrency,
		baseCurrency,
		latestSnapshot?.day ?? new Date().toISOString().slice(0, 10)
	);

	const series = buildSeries(
		contributionOps,
		snapshots.map((snapshot) => ({
			day: snapshot.day,
			valueMinor: convertOrFace(
				rates,
				snapshot.valueMinor,
				snapshot.currency,
				accountCurrency,
				snapshot.day
			)
		})),
		operationValues.map((o) => ({
			at: o.happenedAt.toISOString(),
			amountMinor: o.amountMinor,
			type: o.type,
			positionId: o.positionId
		})),
		positions.map((p) => ({
			id: p.id,
			openedAt: p.openedAt.toISOString(),
			closedAt: p.closedAt ? p.closedAt.toISOString() : null,
			purchaseValueMinor:
				p.purchaseValueMinor === null
					? null
					: convertOrFace(
							rates,
							p.purchaseValueMinor,
							p.currency,
							accountCurrency,
							p.openedAt.toISOString().slice(0, 10)
						)
		})),
		accountCurrency
	);

	// After the last report, units × fetched closes, dashed on the chart.
	const today = new Date().toISOString().slice(0, 10);
	let markedAsOf: string | null = null;
	if (latestSnapshot && holdings.length > 0) {
		const history = await priceHistory(
			holdings.map((h) => h.ticker),
			latestSnapshot.day
		);
		const tail = markedTail(
			{
				holdings: holdings.map((h) => ({ ticker: h.ticker, units: Number(h.units) })),
				prices: history,
				lastSnapshotDay: latestSnapshot.day,
				today,
				convert: (amount, from, day) => convertMinorSync(rates, amount, from, accountCurrency, day)
			},
			accountCurrency
		);
		// One point per month, the month's last marked day, appended or replacing
		// the reconstructed cost point buildSeries wrote for the same month.
		for (const point of tail) {
			const month = point.day.slice(0, 7);
			const value = toMajor(point.valueMinor, accountCurrency);
			const existing = series.find((p) => p.month === month);
			if (existing && !existing.isSnapshot) {
				existing.actual = value;
				existing.isMarked = true;
			} else if (!existing) {
				const last = series[series.length - 1];
				series.push({
					month,
					moneyIn: last.moneyIn,
					bench5: last.bench5,
					bench10: last.bench10,
					actual: value,
					isSnapshot: false,
					isMarked: true
				});
			}
			markedAsOf = point.day;
		}
	}

	// Grants live beside the holdings: a ticker held in both places shares a
	// swatch, and the same fetched closes value both.
	const [grantRows, priceSettings, people, employers] = await Promise.all([
		grantsWithTranches(),
		getPriceSettings(),
		db.select({ id: person.id, name: person.name }).from(person),
		db
			.select({ id: engagement.id, name: organisation.name })
			.from(engagement)
			.innerJoin(organisation, eq(organisation.id, engagement.organisationId))
	]);
	const grantPrices = await latestPrices([...new Set(grantRows.map((g) => g.grant.ticker))]);
	const nameOf = new Map(people.map((p) => [p.id, p.name]));
	const employerOf = new Map(employers.map((e) => [e.id, e.name]));
	const equity = equityGrantRows(
		{
			grants: grantRows.map(({ grant, tranches }) => ({
				grant: {
					id: grant.id,
					ticker: grant.ticker,
					label: grant.label,
					currency: grant.currency,
					grantedOn: grant.grantedOn,
					totalUnits: grant.totalUnits,
					person: nameOf.get(grant.personId) ?? '—',
					employer: grant.engagementId ? (employerOf.get(grant.engagementId) ?? null) : null
				},
				tranches
			})),
			prices: grantPrices,
			baseCurrency,
			staleAfterDays: priceSettings.staleAfterDays,
			toBase: (amount, currency, day) =>
				convertMinorSync(rates, amount, currency, baseCurrency, day)
		},
		today
	);

	// Everything invested: the broker's portfolio plus vested shares held
	// elsewhere, in the account currency. A second figure beside Portfolio
	// rather than inside it — money in, gain and the annualised return are
	// measured against what was paid into the broker, and granted shares were
	// not paid for.
	const heldEquity = heldEquityValues(grantRows, grantPrices, today);
	let equityInAccount = 0n;
	let equityUnconverted = 0;
	for (const e of heldEquity) {
		const converted = convertMinorSync(rates, e.valueMinor, e.currency, accountCurrency, e.day);
		if (converted === null) equityUnconverted += 1;
		else equityInAccount += converted;
	}
	const withEquity =
		heldEquity.length > 0 && equityUnconverted === 0
			? {
					value: formatMinor(portfolioValue + equityInAccount, accountCurrency),
					equity: formatMinor(equityInAccount, accountCurrency)
				}
			: null;

	// One colour per holding, assigned by size and shared by the pie and the
	// table: the swatch on a row IS its wedge, so the two must agree.
	const colorFor = seriesFor([
		...holdings.map((h) => h.ticker),
		...grantRows.map((g) => g.grant.ticker)
	]);
	const donut = positiveDonutSlices(holdings, (holding) =>
		convertOrFace(
			rates,
			holding.valueMinor,
			holding.currency,
			accountCurrency,
			holding.valuedAt.toISOString().slice(0, 10)
		)
	).map(({ item: h, pct, from, to }) => {
		return {
			label: h.ticker,
			name: h.name,
			pct,
			from,
			to,
			color: `var(${colorFor(h.ticker)})`
		};
	});

	const rows = [];
	for (const h of holdings) {
		const inBase = convertMinorSync(
			rates,
			h.valueMinor,
			h.currency,
			baseCurrency,
			h.valuedAt.toISOString().slice(0, 10)
		);
		rows.push({
			id: h.id,
			ticker: h.ticker,
			colorVar: colorFor(h.ticker),
			name: h.name,
			units: Number(h.units) % 1 === 0 ? String(Number(h.units)) : Number(h.units).toFixed(4),
			value: `${formatMinor(h.valueMinor, h.currency)} ${displayCurrency(h.currency)}`,
			base: inBase !== null ? formatMinor(inBase, baseCurrency) : '—',
			gain:
				h.netProfitPct !== null
					? `${Number(h.netProfitPct) >= 0 ? '+' : ''}${Number(h.netProfitPct).toFixed(1)}%`
					: '—',
			gainColor:
				h.netProfitPct === null
					? 'var(--fg3)'
					: Number(h.netProfitPct) >= 0
						? 'var(--green)'
						: 'var(--red)'
		});
	}

	return {
		unit: displayCurrency(baseCurrency),
		accountUnit: displayCurrency(accountCurrency),
		hasData: holdings.length > 0 || operations.length > 0,
		asOf: latestSnapshot?.day ?? null,
		markedAsOf,
		metrics: {
			portfolio: formatMinor(portfolioValue, accountCurrency),
			portfolioBase: valueBase !== null ? formatMinor(valueBase, baseCurrency) : null,
			withEquity,
			equityUnpriced: grantRows.length > 0 && heldEquity.length === 0,
			moneyIn: formatMinor(moneyIn, accountCurrency),
			since: contributionOps[0]?.at.slice(0, 4) ?? null,
			gain: formatMinor(gain, accountCurrency, { signed: true }),
			gainPct:
				moneyIn > 0n
					? `${gain >= 0n ? '+' : ''}${((Number(gain) / Number(moneyIn)) * 100).toFixed(1)}%`
					: null,
			gainPositive: gain >= 0n,
			annualised:
				annualised !== null ? `${annualised >= 0 ? '+' : ''}${annualised.toFixed(1)}%` : null
		},
		// The tax on what was sold this year. Shown beside the portfolio figures
		// because that is where it is asked about, and marked an estimate on its
		// face: it knows nothing about losses carried forward from earlier years,
		// other income, allowances, or anything held outside this instance.
		tax: {
			year: thisYear,
			configured: taxPolicy.ratePct > 0,
			ratePct: taxPolicy.ratePct,
			exemptLongHeld: taxPolicy.exemptLongHeld,
			exemptAfterYears: taxPolicy.exemptAfterYears,
			disposals: gains.disposals,
			exemptDisposals: gains.exemptDisposals,
			realised: formatMinor(gains.realisedMinor, accountCurrency),
			realisedPositive: gains.realisedMinor >= 0n,
			exempt: formatMinor(gains.exemptMinor, accountCurrency),
			taxable: formatMinor(gains.taxableMinor, accountCurrency),
			estimated: formatMinor(gains.estimatedTaxMinor, accountCurrency)
		},
		series,
		donut,
		holdings: rows,
		equity,
		reportsTarget,
		reports
	};
};

export const actions: Actions = {
	/** How this household is taxed on what it sells. Configured, never assumed. */
	upload: async ({ request }) => {
		const form = await request.formData();
		const file = form.get('report');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { message: 'Choose a broker report file.' });
		}
		try {
			const result = await uploadBrokerReport(file.name, new Uint8Array(await file.arrayBuffer()));
			return { result };
		} catch (err) {
			return fail(400, {
				message: err instanceof Error ? err.message : 'That file did not parse.'
			});
		}
	},

	/**
	 * A close typed by hand, for a ticker no feed prices or a feed that is down.
	 * Outranks a fetched close for the same day, and the fetcher never overwrites it.
	 */
	setPrice: async ({ request }) => {
		const form = await request.formData();
		let ticker: string;
		try {
			ticker = normaliseTicker(String(form.get('ticker') ?? ''));
		} catch (err) {
			return fail(400, { message: err instanceof Error ? err.message : 'Pick the ticker.' });
		}
		// Only something the household owns: a price is shared by everyone, so
		// a row for an arbitrary symbol is noise at best.
		if (!(await pricedTickers()).some((t) => t.ticker === ticker)) {
			return fail(400, { message: `${ticker} is not a ticker this household holds.` });
		}
		const currency = String(form.get('currency') ?? '').toUpperCase();
		const day = String(form.get('day') ?? new Date().toISOString().slice(0, 10));
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail(400, { message: 'Pick the day.' });
		if (!(await availableCurrencies()).includes(currency)) {
			return fail(400, { message: `${currency} is not a currency this instance can convert.` });
		}
		let closeMinor: bigint;
		try {
			closeMinor = parseAmountToMinor(String(form.get('close') ?? ''), currency);
		} catch {
			return fail(400, { message: 'The price must be a number.' });
		}
		if (closeMinor <= 0n) return fail(400, { message: 'The price must be positive.' });
		await db
			.insert(securityPrice)
			.values({ ticker, day, closeMinor, currency, source: 'manual' })
			.onConflictDoUpdate({
				target: [securityPrice.ticker, securityPrice.day],
				set: { closeMinor, currency, source: 'manual' }
			});
		return { ok: true };
	}
};
