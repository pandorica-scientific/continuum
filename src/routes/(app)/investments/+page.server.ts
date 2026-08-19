// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { fail } from '@sveltejs/kit';
import { asc, desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { brokerOperation, brokerPosition, holding, portfolioSnapshot } from '$lib/server/db/schema';
import { ingestBrokerFile } from '$lib/server/invest/ingest';
import { annualisedReturn, buildSeries } from '$lib/server/invest/series';
import { convertMinorSync, convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { getBaseCurrency } from '$lib/server/settings';
import { displayCurrency, formatMinor } from '$lib/money';
import { positiveDonutSlices } from '$lib/charts/donut';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const baseCurrency = await getBaseCurrency();
	const [holdings, operations, snapshots, positions, rates] = await Promise.all([
		db.select().from(holding).orderBy(desc(holding.valueMinor)),
		db.select().from(brokerOperation).orderBy(asc(brokerOperation.happenedAt)),
		db.select().from(portfolioSnapshot).orderBy(asc(portfolioSnapshot.day)),
		db.select().from(brokerPosition),
		loadRateTable()
	]);

	const latestSnapshot = snapshots[snapshots.length - 1] ?? null;
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
		series,
		donut,
		holdings: rows
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
			const result = await ingestBrokerFile(file.name, new Uint8Array(await file.arrayBuffer()));
			return { result };
		} catch (err) {
			return fail(400, {
				message: err instanceof Error ? err.message : 'That file did not parse.'
			});
		}
	}
};
