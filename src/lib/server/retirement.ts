// The projection's inputs, gathered from every corner of the household: cash,
// portfolio, property, mortgages and rent.
//
// This lived inside the Retirement page loader until the Overview grew a
// retirement panel. Two callers computing a forty-year amortisation from
// slightly different copies of this logic is exactly the drift worth avoiding,
// so it moved here and both call it.

import { asc, desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	account,
	loan,
	loanFixationPeriod,
	person,
	portfolioSnapshot,
	property,
	tenancy
} from '$lib/server/db/schema';
import { monthlyHistory } from '$lib/server/cashflow';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { amortise, DAY_COUNTS, type DayCount } from '$lib/loans/amortise';
import { anchorMonthFor } from '$lib/loans/simulate';
import { activeTenanciesByProperty } from '$lib/property/tenancy';
import { toMajor } from '$lib/money';
import type { RetireInputs } from '$lib/retire';

/** How many years ahead the projection samples mortgage balances. */
const HORIZON = 40;

export async function retirementInputs(baseCurrency: string): Promise<RetireInputs> {
	const [accounts, snapshots, loans, periods, properties, tenancies, people, history, rates] =
		await Promise.all([
			db.select().from(account),
			db.select().from(portfolioSnapshot).orderBy(desc(portfolioSnapshot.day)).limit(1),
			db.select().from(loan),
			db.select().from(loanFixationPeriod),
			db.select().from(property),
			db.select().from(tenancy),
			db.select().from(person).orderBy(asc(person.createdAt)),
			monthlyHistory(),
			loadRateTable()
		]);

	const today = new Date().toISOString().slice(0, 10);
	const toBase = (amount: bigint, currency: string, day = today) =>
		toMajor(convertOrFace(rates, amount, currency, baseCurrency, day), baseCurrency);

	let liquid = 0;
	for (const a of accounts) {
		if (a.kind === 'brokerage') continue;
		liquid += toBase(a.balanceMinor, a.currency, a.balanceAsOf ?? today);
	}
	if (snapshots[0])
		liquid += toBase(snapshots[0].valueMinor, snapshots[0].currency, snapshots[0].day);

	// What the household actually saves: kept money over the last 12 recorded
	// months, annualised. Zero history → zero contribution, honestly.
	const last12 = history.slice(-12);
	const kept = last12.reduce((s, m) => s + (m.earned - m.spent), 0);
	const contribution = last12.length > 0 ? (kept / last12.length) * 12 : 0;

	let propertyValue = 0;
	for (const p of properties)
		propertyValue += toBase(p.valueMinor, p.currency, p.valuedAt ?? today);

	const year = new Date().getFullYear();
	const month = today.slice(0, 7);
	const mortgageOwedByYear = Array.from({ length: HORIZON + 1 }, () => 0);
	for (const l of loans) {
		if (l.owedMinor <= 0n) continue;
		const loanPeriods = periods
			.filter((period) => period.loanId === l.id)
			.map((period) => ({
				startDate: period.startDate,
				endDate: period.endDate,
				annualRatePct: Number(period.annualRatePct),
				paymentMinor: period.paymentMinor
			}));
		const schedule = amortise(
			{
				owedMinor: l.owedMinor,
				owedAsOfMonth: anchorMonthFor(l.owedAsOf ?? today, l.paymentDay),
				dayCount: (DAY_COUNTS as readonly string[]).includes(l.dayCount)
					? (l.dayCount as DayCount)
					: '30/360',
				accrualStyle: l.accrualStyle === 'calendar' ? 'calendar' : 'payment',
				paymentDay: l.paymentDay ?? 1
			},
			loanPeriods,
			`${year + HORIZON}-${month.slice(5)}`
		);

		mortgageOwedByYear[0] += toBase(l.owedMinor, l.currency, l.owedAsOf ?? today);
		let rowIndex = -1;
		for (let offset = 1; offset <= HORIZON; offset++) {
			const targetMonth = `${year + offset}-${month.slice(5)}`;
			while (schedule[rowIndex + 1]?.month <= targetMonth) rowIndex++;
			const balance = rowIndex >= 0 ? schedule[rowIndex].owedAfterMinor : l.owedMinor;
			// Future exchange rates are unknowable; keep the loan engine in its
			// native currency and translate each sampled balance at today's rate.
			mortgageOwedByYear[offset] += toBase(balance, l.currency, today);
		}
	}

	let monthlyRent = 0;
	for (const t of activeTenanciesByProperty(tenancies, today).values()) {
		const currency = properties.find((p) => p.id === t.propertyId)?.currency ?? baseCurrency;
		monthlyRent += toBase(t.rentMinor, currency, today);
	}

	const bornOne = people[0]?.birthYear ?? year - 36;
	const bornTwo = people[1]?.birthYear ?? bornOne;

	return {
		liquid,
		contribution,
		propertyValue,
		mortgageOwedByYear,
		monthlyRent,
		bornOne,
		bornTwo,
		year
	};
}
