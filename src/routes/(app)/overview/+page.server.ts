import { buildBriefing } from '$lib/server/briefing';
import { flowData, type Period } from '$lib/server/cashflow';
import { computeNetWorth } from '$lib/server/networth';
import { getBaseCurrency } from '$lib/server/settings';
import { displayCurrency, formatMinor } from '$lib/money';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const period: Period = url.searchParams.get('period') === 'month' ? 'month' : 'ytd';
	const baseCurrency = await getBaseCurrency();

	const [briefing, flow, netWorth] = await Promise.all([
		buildBriefing(),
		flowData(period),
		computeNetWorth()
	]);

	const largest = netWorth.components.reduce(
		(max, c) => (c.valueMinor > max ? c.valueMinor : max),
		1n
	);
	const composition = netWorth.components.map((c) => ({
		label: c.label,
		value: `${formatMinor(c.valueMinor, netWorth.baseCurrency)} ${displayCurrency(netWorth.baseCurrency)}`,
		colorVar: c.valueMinor < 0n ? '--red' : c.colorVar,
		width: Math.max(
			2,
			Math.round((Number(c.valueMinor < 0n ? -c.valueMinor : c.valueMinor) / Number(largest)) * 100)
		),
		detail: c.detail
	}));

	return { period, briefing, flow, baseCurrency, composition };
};
