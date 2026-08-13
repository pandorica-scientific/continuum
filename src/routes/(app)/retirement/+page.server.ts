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
import { convertMinor } from '$lib/server/fx';
import { periodForMonth } from '$lib/server/loans/amortise';
import { getBaseCurrency, getSetting, setSetting } from '$lib/server/settings';
import { RETIRE_DEFAULTS, type RetireConfig, type RetireInputs } from '$lib/retire';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const baseCurrency = await getBaseCurrency();
	const toBase = async (amount: bigint, currency: string) =>
		Number((await convertMinor(amount, currency, baseCurrency)) ?? amount) / 100;

	const [accounts, snapshots, loans, periods, properties, tenancies, people, history, stored] =
		await Promise.all([
			db.select().from(account),
			db.select().from(portfolioSnapshot).orderBy(desc(portfolioSnapshot.day)).limit(1),
			db.select().from(loan),
			db.select().from(loanFixationPeriod),
			db.select().from(property),
			db.select().from(tenancy),
			db.select().from(person).orderBy(asc(person.createdAt)),
			monthlyHistory(),
			getSetting<Partial<RetireConfig>>('retirement', {})
		]);

	let liquid = 0;
	for (const a of accounts) {
		if (a.kind === 'brokerage') continue;
		liquid += await toBase(a.balanceMinor, a.currency);
	}
	if (snapshots[0]) liquid += await toBase(snapshots[0].valueMinor, snapshots[0].currency);

	// What the household actually saves: kept money over the last 12 recorded
	// months, annualised. Zero history → zero contribution, honestly.
	const last12 = history.slice(-12);
	const kept = last12.reduce((s, m) => s + (m.earned - m.spent), 0);
	const contribution = last12.length > 0 ? (kept / last12.length) * 12 : 0;

	let propertyValue = 0;
	for (const p of properties) propertyValue += await toBase(p.valueMinor, p.currency);

	let mortgageOwed = 0;
	let mortgageYearlyPayment = 0;
	let weightedRate = 0;
	const month = new Date().toISOString().slice(0, 7);
	for (const l of loans) {
		if (l.owedMinor <= 0n) continue;
		const owed = await toBase(l.owedMinor, l.currency);
		const current = periodForMonth(
			periods
				.filter((p) => p.loanId === l.id)
				.map((p) => ({
					startDate: p.startDate,
					endDate: p.endDate,
					annualRatePct: Number(p.annualRatePct),
					paymentMinor: p.paymentMinor
				})),
			month
		);
		mortgageOwed += owed;
		if (current) {
			mortgageYearlyPayment += (await toBase(current.paymentMinor, l.currency)) * 12;
			weightedRate += (current.annualRatePct / 100) * owed;
		}
	}
	const mortgageRate = mortgageOwed > 0 ? weightedRate / mortgageOwed : 0;

	const today = new Date().toISOString().slice(0, 10);
	let monthlyRent = 0;
	for (const t of tenancies) {
		if (!t.endDate || t.endDate >= today) monthlyRent += Number(t.rentMinor) / 100;
	}

	const year = new Date().getFullYear();
	const bornOne = people[0]?.birthYear ?? year - 36;
	const bornTwo = people[1]?.birthYear ?? bornOne;

	const inputs: RetireInputs = {
		liquid,
		contribution,
		propertyValue,
		mortgageOwed,
		mortgageYearlyPayment,
		mortgageRate,
		monthlyRent,
		bornOne,
		bornTwo,
		year
	};

	return {
		inputs,
		config: { ...RETIRE_DEFAULTS, ...stored },
		personNames: [people[0]?.name ?? 'Person one', people[1]?.name ?? 'Person two'],
		baseCurrency
	};
};

export const actions: Actions = {
	save: async ({ request }) => {
		const form = await request.formData();
		const number = (key: string, fallback: number) => {
			const value = Number(String(form.get(key) ?? '').replace(',', '.'));
			return Number.isFinite(value) ? value : fallback;
		};
		const plan = String(form.get('plan') ?? 'keep');
		const config: RetireConfig = {
			spend: Math.max(0, number('spend', RETIRE_DEFAULTS.spend)),
			swr: [3, 3.5, 4].includes(number('swr', RETIRE_DEFAULTS.swr))
				? number('swr', RETIRE_DEFAULTS.swr)
				: RETIRE_DEFAULTS.swr,
			realReturn: Math.min(8, Math.max(0, number('realReturn', RETIRE_DEFAULTS.realReturn))),
			plan: plan === 'rent' || plan === 'sell' ? plan : 'keep',
			pensionOne: Math.max(0, number('pensionOne', RETIRE_DEFAULTS.pensionOne)),
			pensionTwo: Math.max(0, number('pensionTwo', RETIRE_DEFAULTS.pensionTwo)),
			ageOne: Math.max(50, number('ageOne', RETIRE_DEFAULTS.ageOne)),
			ageTwo: Math.max(50, number('ageTwo', RETIRE_DEFAULTS.ageTwo))
		};
		await setSetting('retirement', config);
		return { ok: true };
	}
};
