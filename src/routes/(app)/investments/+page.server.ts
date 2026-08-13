import { fail } from '@sveltejs/kit';
import { asc, desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { brokerOperation, holding, portfolioSnapshot } from '$lib/server/db/schema';
import { ingestXtbReport } from '$lib/server/invest/ingest';
import { annualisedReturn, buildSeries } from '$lib/server/invest/series';
import { convertMinor } from '$lib/server/fx';
import { getBaseCurrency } from '$lib/server/settings';
import { displayCurrency, formatMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const baseCurrency = await getBaseCurrency();
	const [holdings, operations, snapshots] = await Promise.all([
		db.select().from(holding).orderBy(desc(holding.valueMinor)),
		db.select().from(brokerOperation).orderBy(asc(brokerOperation.happenedAt)),
		db.select().from(portfolioSnapshot).orderBy(asc(portfolioSnapshot.day))
	]);

	const contributionOps = operations
		.filter((o) => ['Deposit', 'Withdrawal', 'Subaccount transfer'].includes(o.type))
		.map((o) => ({ at: o.happenedAt.toISOString().slice(0, 10), amountMinor: o.amountMinor }));

	const accountCurrency = holdings[0]?.currency ?? snapshots[0]?.currency ?? 'EUR';
	const latestSnapshot = snapshots[snapshots.length - 1] ?? null;
	const portfolioValue = latestSnapshot?.valueMinor ?? 0n;
	const moneyIn = contributionOps.reduce((s, c) => s + c.amountMinor, 0n);
	const gain = portfolioValue - moneyIn;
	const annualised = annualisedReturn(contributionOps, portfolioValue);

	const valueBase = await convertMinor(portfolioValue, accountCurrency, baseCurrency);

	const series = buildSeries(
		contributionOps,
		snapshots.map((s) => ({ day: s.day, valueMinor: s.valueMinor }))
	);

	const rows = [];
	for (const h of holdings) {
		const inBase = await convertMinor(h.valueMinor, h.currency, baseCurrency);
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
		holdings: rows
	};
};

export const actions: Actions = {
	upload: async ({ request }) => {
		const form = await request.formData();
		const file = form.get('report');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { message: 'Choose an XTB account-statement XLSX.' });
		}
		try {
			const result = await ingestXtbReport(new Uint8Array(await file.arrayBuffer()));
			return { result };
		} catch (err) {
			return fail(400, {
				message: err instanceof Error ? err.message : 'That file did not parse.'
			});
		}
	}
};
