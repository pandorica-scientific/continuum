import { buildBriefing } from '$lib/server/briefing';
import { next30Days } from '$lib/server/calendar';
import { flowData, type Period } from '$lib/server/cashflow';
import { computeNetWorth } from '$lib/server/networth';
import { getBaseCurrency } from '$lib/server/settings';
import { displayCurrency, formatMinor } from '$lib/money';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const period: Period = url.searchParams.get('period') === 'month' ? 'month' : 'ytd';
	const baseCurrency = await getBaseCurrency();

	const [briefing, flow, netWorth, upcoming] = await Promise.all([
		buildBriefing(),
		flowData(period),
		computeNetWorth(),
		next30Days()
	]);

	const unit = displayCurrency(netWorth.baseCurrency);
	const money = (v: bigint) => `${formatMinor(v, netWorth.baseCurrency)} ${unit}`;
	// bars scale against the largest gross exposure (asset or pure debt)
	const largestGross = netWorth.groups.reduce((max, g) => {
		const gross = g.assetMinor > g.liabilityMinor ? g.assetMinor : g.liabilityMinor;
		return gross > max ? gross : max;
	}, 1n);
	const groups = netWorth.groups.map((g) => {
		const gross = g.assetMinor > g.liabilityMinor ? g.assetMinor : g.liabilityMinor;
		const netMinor = g.assetMinor - g.liabilityMinor;
		return {
			label: g.label,
			asset: g.assetMinor > 0n ? money(g.assetMinor) : null,
			liability: g.liabilityMinor > 0n ? `− ${money(g.liabilityMinor)}` : null,
			net: money(netMinor),
			netNegative: netMinor < 0n,
			colorVar: g.colorVar,
			width: Math.max(2, Math.round((Number(gross) / Number(largestGross)) * 100)),
			owedPct:
				g.liabilityMinor > 0n && gross > 0n
					? Math.min(100, Math.round((Number(g.liabilityMinor) / Number(gross)) * 100))
					: 0,
			detail: g.detail
		};
	});
	const composition = {
		groups,
		assetsTotal: money(netWorth.assetsMinor),
		liabilitiesTotal: `− ${money(netWorth.liabilitiesMinor)}`,
		net: money(netWorth.totalMinor),
		netPositive: netWorth.totalMinor >= 0n
	};

	return { period, briefing, flow, baseCurrency, composition, upcoming };
};
