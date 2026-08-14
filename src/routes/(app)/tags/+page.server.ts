import { tagTotals } from '$lib/server/tags';
import { getBaseCurrency } from '$lib/server/settings';
import { convertMinorSync, loadRateTable } from '$lib/server/fx/table';
import { displayCurrency, formatMinor } from '$lib/money';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [totals, base, rates] = await Promise.all([
		tagTotals(),
		getBaseCurrency(),
		loadRateTable()
	]);

	const today = new Date().toISOString().slice(0, 10);

	return {
		baseCurrency: displayCurrency(base),
		tags: totals
			.map((t) => {
				// Per-currency sums stand as they are; the single figure beside them
				// is only a convenience, converted at today's rate.
				const convertedMinor = t.totals.reduce((sum, part) => {
					const converted = convertMinorSync(rates, part.sumMinor, part.currency, base, today);
					return sum + (converted ?? part.sumMinor);
				}, 0n);
				return {
					id: t.id,
					name: t.name,
					parts: t.totals.map((part) => ({
						amount: `${formatMinor(part.sumMinor, part.currency, { signed: true })} ${displayCurrency(part.currency)}`
					})),
					converted: `${formatMinor(convertedMinor, base, { signed: true })} ${displayCurrency(base)}`,
					mixed: t.totals.length > 1,
					empty: t.totals.length === 0
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name))
	};
};
