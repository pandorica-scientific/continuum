import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { account } from '$lib/server/db/schema';
import { buildBriefing } from '$lib/server/briefing';
import { flowData, type Period } from '$lib/server/cashflow';
import { convertMinor } from '$lib/server/fx';
import { getBaseCurrency } from '$lib/server/settings';
import { displayCurrency, formatMinor } from '$lib/money';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const period: Period = url.searchParams.get('period') === 'month' ? 'month' : 'ytd';
	const baseCurrency = await getBaseCurrency();

	const [briefing, flow, accounts] = await Promise.all([
		buildBriefing(),
		flowData(period),
		db.select().from(account).where(eq(account.kind, 'current'))
	]);

	// Net-worth composition. Until Property/Investments/Loans land, cash is
	// the only live component; the others appear as their modules arrive.
	const allAccounts = await db.select().from(account);
	let cash = 0n;
	for (const a of allAccounts) {
		if (a.kind === 'brokerage') continue;
		const inBase = await convertMinor(a.balanceMinor, a.currency, baseCurrency);
		if (inBase !== null) cash += inBase;
	}

	const composition = [
		{
			label: 'Cash across accounts',
			value: `${formatMinor(cash, baseCurrency)} ${displayCurrency(baseCurrency)}`,
			colorVar: '--teal',
			width: 100,
			detail: `${allAccounts.filter((a) => a.kind !== 'brokerage').length} accounts, statement balances`
		}
	];

	return {
		period,
		briefing,
		flow,
		baseCurrency,
		composition,
		accountsCount: accounts.length
	};
};
