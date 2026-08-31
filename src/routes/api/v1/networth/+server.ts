// SPDX-License-Identifier: AGPL-3.0-or-later
import { json } from '$lib/server/api/respond';
import { money } from '$lib/api/serialise';
import { computeNetWorth } from '$lib/server/networth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
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
