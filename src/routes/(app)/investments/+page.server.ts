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
import { latestPrices, priceHistory, pricedTickers, refreshPrices } from '$lib/server/prices';
import { getPriceSettings, setPriceAlias } from '$lib/server/prices/settings';
import { equityGrantRows, grantEquityValues } from '$lib/invest/equity-rows';
import { grantSummary } from '$lib/equity';
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
			// Configured, not assumed: the rate differs by country, and the exemption
			// below is a Czech rule that would be wrong elsewhere.
			getSetting<GainsPolicy>('investTax', DEFAULT_GAINS_POLICY),
			db
				.select({ id: account.id, name: account.name })
				.from(account)
				.where(eq(account.kind, 'brokerage'))
		]);

	// Filed against the one brokerage account when there is exactly one; read by
	// type otherwise, since there's no single account to key the lookup off.
	const soleBrokerageAccount = brokerageAccounts.length === 1 ? brokerageAccounts[0] : null;
	const reportsTarget = soleBrokerageAccount
		? { id: soleBrokerageAccount.id, kind: 'account' as const, label: soleBrokerageAccount.name }
		: { id: '', kind: 'account' as const, label: 'Broker reports' };
	const reports = soleBrokerageAccount
		? await documentsAbout(soleBrokerageAccount.id)
		: await brokerReports();

	const latestSnapshot = snapshots[snapshots.length - 1] ?? null;

	// Deliberately NOT converted: a disposal's gain and its tax are both facts in
	// the currency it was realised in.
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
	// A holding no feed has ever priced (the broker's own ticker for it is not
	// what a feed calls the same security — Tesla on Xetra trades as "TL0",
	// not "TSLA") keeps the dashed tail from drawing at all, silently, since
	// `markedTail` needs every holding priced before it will draw one day.
	// Named here rather than left a console warning, so there is a way to
	// answer it from the screen the chart is already on.
	let unpricedTickers: { ticker: string; currency: string }[] = [];
	if (latestSnapshot && holdings.length > 0) {
		// `priceHistory` below is deliberately floored at the last report's day —
		// it feeds the tail, which only ever draws AFTER that day. "Has this
		// ticker EVER been priced" is a different question and needs the
		// unfloored answer, or a ticker fetched only before the last report
		// (the ordinary case) would misread as never priced at all.
		const latest = await latestPrices(holdings.map((h) => h.ticker));
		unpricedTickers = holdings
			.filter((h) => !latest.has(h.ticker))
			.map((h) => ({ ticker: h.ticker, currency: h.currency }));
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
		let markedValue: number | null = null;
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
			markedValue = value;
			markedAsOf = point.day;
		}

		// The tail can fall entirely inside the month the last report landed in,
		// which is the ORDINARY case for a report uploaded this month: the loop
		// above then finds a point that IS a snapshot, leaves it alone, and the
		// dashed tail has a single point and draws nothing — while the legend
		// goes on promising one, because `markedAsOf` was set anyway.
		//
		// Monthly points cannot say "later in the same month", so the marked
		// value is appended as its own final point. Without it the tail cannot
		// appear until the calendar turns over, which is exactly when a fresh
		// report makes it least interesting.
		if (markedValue !== null && !series.some((p) => p.isMarked)) {
			const last = series[series.length - 1];
			series.push({
				month: last.month,
				moneyIn: last.moneyIn,
				bench5: last.bench5,
				bench10: last.bench10,
				actual: markedValue,
				isSnapshot: false,
				isMarked: true
			});
		}
	}

	// A ticker held in both grants and holdings shares a swatch and the same fetched close.
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

	// A second figure beside Portfolio, not inside it: money in, gain and the
	// annualised return are measured against what was paid into the broker, and
	// granted shares were not paid for.
	//
	// Every grant, vested or not, because that is the question this tile asks —
	// "what is all of this worth". Counting only what had vested made a grant
	// whose first tranche is a year out read as nothing at all. Units already
	// delivered and moved to the broker are excluded by `grantEquityValues`, so
	// they are not counted here and in the portfolio both.
	const heldEquity = grantEquityValues(grantRows, grantPrices, today);
	let equityInAccount = 0n;
	let equityUnconverted = 0;
	let equityUnits = 0;
	for (const e of heldEquity) {
		equityUnits += e.units;
		const converted = convertMinorSync(rates, e.valueMinor, e.currency, accountCurrency, e.day);
		if (converted === null) equityUnconverted += 1;
		else equityInAccount += converted;
	}
	const withEquity =
		heldEquity.length > 0 && equityUnconverted === 0
			? {
					value: formatMinor(portfolioValue + equityInAccount, accountCurrency),
					equity: formatMinor(equityInAccount, accountCurrency),
					units: equityUnits
				}
			: null;

	/**
	 * Why the tile has no figure, when it has none.
	 *
	 * `grantEquityValues` skips a grant for two unrelated reasons — no close for
	 * its ticker, and nothing left held or still to vest — and the tile used to
	 * conflate both into "no price for the grant yet". A grant that has been
	 * fully sold or moved to a broker is not waiting on a price; saying so sends
	 * somebody looking for a broken feed that is working.
	 */
	const equityAbsence: 'unpriced' | 'nothing-left' | 'unconverted' | null =
		withEquity !== null || grantRows.length === 0
			? null
			: grantRows.every((g) => !grantPrices.has(g.grant.ticker))
				? 'unpriced'
				: equityUnconverted > 0
					? 'unconverted'
					: 'nothing-left';

	/** The soonest day any grant has shares coming, for the tile to name. */
	const nextVest =
		grantRows
			.map((g) => grantSummary(g.tranches, today).nextVest?.vestsOn ?? null)
			.filter((day): day is string => day !== null)
			.sort()[0] ?? null;

	// Shared by the pie and the table: the swatch on a row IS its wedge.
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
		unpricedTickers,
		metrics: {
			portfolio: formatMinor(portfolioValue, accountCurrency),
			// Null when the broker account is already kept in the household's own
			// currency: the conversion is then the identity, and the tile printed
			// the same number twice under an "≈".
			portfolioBase:
				valueBase !== null && accountCurrency !== baseCurrency
					? formatMinor(valueBase, baseCurrency)
					: null,
			withEquity,
			equityAbsence,
			nextVest,
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
		// An estimate: knows nothing about losses carried forward, other income,
		// allowances, or anything held outside this instance.
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
	},

	/**
	 * What a feed actually calls this security, when it is not what the broker
	 * calls it — Tesla on Xetra is "TL0", not "TSLA". Saved once, tried right
	 * away rather than waiting for the next scheduled refresh, so the answer
	 * is on screen the moment it is right.
	 */
	setPriceAlias: async ({ request }) => {
		const form = await request.formData();
		let ticker: string;
		try {
			ticker = normaliseTicker(String(form.get('ticker') ?? ''));
		} catch (err) {
			return fail(400, { message: err instanceof Error ? err.message : 'Pick the ticker.' });
		}
		if (!(await pricedTickers()).some((t) => t.ticker === ticker)) {
			return fail(400, { message: `${ticker} is not a ticker this household holds.` });
		}
		const overrideBase = String(form.get('overrideBase') ?? '')
			.trim()
			.toUpperCase();
		if (!overrideBase) return fail(400, { message: 'What does a feed actually call it?' });
		await setPriceAlias(ticker, overrideBase);
		await refreshPrices();
		return { ok: true };
	}
};
