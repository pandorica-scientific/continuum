import { json, requireToken } from '$lib/server/api/respond';
import { money } from '$lib/api/serialise';
import { computeNetWorth } from '$lib/server/networth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, getClientAddress }) => {
	const refused = await requireToken(request, getClientAddress());
	if (refused) return refused;

	const nw = await computeNetWorth();
	const base = nw.baseCurrency;
	return json({
		total: money(nw.totalMinor, base),
		assets: money(nw.assetsMinor, base),
		liabilities: money(nw.liabilitiesMinor, base),
		deltaThisMonth: nw.deltaThisMonthMinor === null ? null : money(nw.deltaThisMonthMinor, base),
		groups: nw.groups.map((g) => ({
			key: g.key,
			label: g.label,
			asset: money(g.assetMinor, base),
			liability: money(g.liabilityMinor, base),
			detail: g.detail
		}))
	});
};
