// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { fail } from '@sveltejs/kit';
import { asc, desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { brokerOperation, brokerPosition, holding, portfolioSnapshot } from '$lib/server/db/schema';
import { ingestBrokerFile } from '$lib/server/invest/ingest';
import { annualisedReturn, buildSeries } from '$lib/server/invest/series';
import { convertMinorSync, convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { getSetting, setSetting } from '$lib/server/settings';
import { realisedGains, type GainsPolicy } from '$lib/invest/gains';
import { getBaseCurrency } from '$lib/server/settings';
import { displayCurrency, formatMinor } from '$lib/money';
import { positiveDonutSlices } from '$lib/charts/donut';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const baseCurrency = await getBaseCurrency();
	const [holdings, operations, snapshots, positions, rates, taxPolicy] = await Promise.all([
		db.select().from(holding).orderBy(desc(holding.valueMinor)),
		db.select().from(brokerOperation).orderBy(asc(brokerOperation.happenedAt)),
		db.select().from(portfolioSnapshot).orderBy(asc(portfolioSnapshot.day)),
		db.select().from(brokerPosition),
		loadRateTable(),
		// How this household is taxed on what it sells. Configured rather than
		// assumed: the rate differs by country, and the holding-period exemption
		// below is a Czech rule that would produce wrong figures anywhere else.
		getSetting<GainsPolicy>('investTax', {
			ratePct: 0,
			exemptLongHeld: false,
			exemptAfterYears: 3
		})
	]);

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

	// Allocation donut: share of portfolio by holding, series colours in order.
	const donutColors = ['--teal', '--blue', '--purple', '--orange', '--yellow', '--green', '--red'];
	const donut = positiveDonutSlices(holdings, (holding) =>
		convertOrFace(
			rates,
			holding.valueMinor,
			holding.currency,
			accountCurrency,
			holding.valuedAt.toISOString().slice(0, 10)
		)
	).map(({ item: h, pct, from, to }, i) => {
		return {
			label: h.ticker,
			name: h.name,
			pct,
			from,
			to,
			color: `var(${donutColors[i % donutColors.length]})`
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
		metrics: {
			portfolio: formatMinor(portfolioValue, accountCurrency),
			portfolioBase: valueBase !== null ? formatMinor(valueBase, baseCurrency) : null,
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
		holdings: rows
	};
};

export const actions: Actions = {
	/** How this household is taxed on what it sells. Configured, never assumed. */
	setTax: async ({ request }) => {
		const form = await request.formData();
		const ratePct = Number(String(form.get('ratePct') ?? '').replace(',', '.'));
		const years = Number(form.get('exemptAfterYears'));
		if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) {
			return fail(400, { message: 'The rate must be a percentage between 0 and 100.' });
		}
		if (!Number.isInteger(years) || years < 1 || years > 50) {
			return fail(400, { message: 'The exemption threshold must be a whole number of years.' });
		}
		await setSetting('investTax', {
			ratePct,
			exemptLongHeld: form.get('exemptLongHeld') === 'on',
			exemptAfterYears: years
		});
		return { ok: true };
	},

	upload: async ({ request }) => {
		const form = await request.formData();
		const file = form.get('report');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { message: 'Choose a broker report file.' });
		}
		try {
			const result = await ingestBrokerFile(file.name, new Uint8Array(await file.arrayBuffer()));
			return { result };
		} catch (err) {
			return fail(400, {
				message: err instanceof Error ? err.message : 'That file did not parse.'
			});
		}
	}
};
