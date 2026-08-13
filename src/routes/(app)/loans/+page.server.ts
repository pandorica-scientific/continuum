import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { loan, loanFixationPeriod, property } from '$lib/server/db/schema';
import {
	amortise,
	debtFreeYear,
	interestForYear,
	rateForMonth,
	type FixationPeriod
} from '$lib/server/loans/amortise';
import { getBaseCurrency } from '$lib/server/settings';
import { convertMinor } from '$lib/server/fx';
import { displayCurrency, formatMinor, parseAmountToMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

function monthNow(): string {
	return new Date().toISOString().slice(0, 7);
}

function fixationPill(regime: string, periods: FixationPeriod[], paidOff: boolean) {
	if (paidOff) return { label: 'paid off', hue: 'grey' as const };
	const now = `${monthNow()}-01`;
	const current = periods.find(
		(p) => p.startDate <= now && (p.endDate === null || now < p.endDate)
	);
	if (regime === 'floating') return { label: 'floating rate', hue: 'yellow' as const };
	if (regime === 'fixed_term') return { label: 'fixed for the whole term', hue: 'teal' as const };
	if (current?.endDate) {
		const end = new Date(current.endDate);
		const label = `fixed to ${end.toLocaleString('en', { month: 'short' })} ${end.getFullYear()}`;
		const monthsLeft =
			(end.getFullYear() - new Date().getFullYear()) * 12 + end.getMonth() - new Date().getMonth();
		return { label, hue: monthsLeft <= 12 ? ('yellow' as const) : ('green' as const) };
	}
	return { label: 'no fixation on record', hue: 'grey' as const };
}

export const load: PageServerLoad = async () => {
	const baseCurrency = await getBaseCurrency();
	const [loans, allPeriods, properties] = await Promise.all([
		db.select().from(loan).orderBy(loan.createdAt),
		db.select().from(loanFixationPeriod),
		db.select({ id: property.id, name: property.name }).from(property)
	]);

	const year = new Date().getFullYear();
	let totalOwedBase = 0n;
	let totalPaymentBase = 0n;
	let interestYearBase = 0n;
	let deductibleYearBase = 0n;
	let latestDebtFree: number | null = null;

	const cards = [];
	for (const l of loans) {
		const periods: FixationPeriod[] = allPeriods
			.filter((p) => p.loanId === l.id)
			.map((p) => ({
				startDate: p.startDate,
				endDate: p.endDate,
				annualRatePct: Number(p.annualRatePct)
			}));
		const terms = {
			owedMinor: l.owedMinor,
			owedAsOfMonth: (l.owedAsOf ?? new Date().toISOString().slice(0, 10)).slice(0, 7),
			paymentMinor: l.paymentMinor
		};

		const owedBase = (await convertMinor(l.owedMinor, l.currency, baseCurrency)) ?? l.owedMinor;
		const paymentBase =
			(await convertMinor(l.paymentMinor, l.currency, baseCurrency)) ?? l.paymentMinor;
		totalOwedBase += owedBase;
		totalPaymentBase += l.owedMinor > 0n ? paymentBase : 0n;

		const interest = interestForYear(terms, periods, year);
		const interestBase = (await convertMinor(interest, l.currency, baseCurrency)) ?? interest;
		interestYearBase += interestBase;
		if (l.interestDeductible) deductibleYearBase += interestBase;

		const freeYear = debtFreeYear(terms, periods);
		if (freeYear !== null && (latestDebtFree === null || freeYear > latestDebtFree)) {
			latestDebtFree = freeYear;
		}

		const repaid = l.principalMinor - l.owedMinor;
		const paidPct = l.principalMinor > 0n ? Number((repaid * 1000n) / l.principalMinor) / 10 : 0;
		const rate = rateForMonth(periods, monthNow());
		const schedule = amortise(terms, periods, monthNow()).slice(0, 1);

		cards.push({
			id: l.id,
			name: l.name,
			sub: [
				l.lender,
				rate !== null ? `${rate.toFixed(2)}%` : null,
				l.kind === 'mortgage' ? 'secured by the flat' : null
			]
				.filter(Boolean)
				.join(' · '),
			pill: fixationPill(l.regime, periods, l.owedMinor <= 0n),
			facts: [
				{ label: 'Owed', value: formatMinor(l.owedMinor, l.currency), color: 'var(--red)' },
				{ label: 'Payment', value: formatMinor(l.paymentMinor, l.currency), color: 'var(--fg1)' },
				{ label: 'Rate', value: rate !== null ? `${rate.toFixed(2)}%` : '—', color: 'var(--fg2)' },
				{
					label: 'Ends',
					value: freeYear !== null ? String(freeYear) : (l.endDate?.slice(0, 4) ?? '—'),
					color: 'var(--fg2)'
				}
			],
			paidPct: Math.max(0, Math.min(paidPct, 100)),
			paidNote: `${formatMinor(repaid, l.currency)} of ${formatMinor(l.principalMinor, l.currency)} repaid`,
			monthInterest: schedule[0] ? formatMinor(schedule[0].interestMinor, l.currency) : null
		});
	}

	const unit = displayCurrency(baseCurrency);
	return {
		unit,
		count: loans.length,
		metrics: {
			totalOwed: formatMinor(totalOwedBase, baseCurrency),
			monthlyPayments: formatMinor(totalPaymentBase, baseCurrency),
			interestThisYear: formatMinor(interestYearBase, baseCurrency),
			deductible: formatMinor(deductibleYearBase, baseCurrency),
			debtFree: latestDebtFree
		},
		loans: cards,
		properties
	};
};

export const actions: Actions = {
	addLoan: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const currency = String(form.get('currency') ?? 'CZK').toUpperCase();
		if (!name) return fail(400, { message: 'The loan needs a name.' });

		let principal: bigint, owed: bigint, payment: bigint, rate: number;
		try {
			principal = parseAmountToMinor(String(form.get('principal') ?? ''), currency);
			owed = parseAmountToMinor(String(form.get('owed') ?? ''), currency);
			payment = parseAmountToMinor(String(form.get('payment') ?? ''), currency);
			rate = Number(String(form.get('rate') ?? '').replace(',', '.'));
			if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('rate');
		} catch {
			return fail(400, { message: 'Principal, owed, payment and rate must be numbers.' });
		}

		const regime = String(form.get('regime') ?? 'fixed_period');
		const fixedUntil = String(form.get('fixedUntil') ?? '').trim() || null;
		if (regime === 'fixed_period' && !fixedUntil) {
			return fail(400, { message: 'A fixed-period loan needs the date the fixation ends.' });
		}

		const loanId = randomUUID();
		await db.insert(loan).values({
			id: loanId,
			name,
			lender: String(form.get('lender') ?? '').trim(),
			kind: String(form.get('kind') ?? 'mortgage'),
			currency,
			principalMinor: principal,
			owedMinor: owed,
			owedAsOf: new Date().toISOString().slice(0, 10),
			paymentMinor: payment,
			startDate: String(form.get('startDate') ?? '').trim() || null,
			endDate: String(form.get('endDate') ?? '').trim() || null,
			regime,
			securedByPropertyId: String(form.get('securedBy') ?? '').trim() || null,
			interestDeductible: form.get('deductible') === 'on' ? 1 : 0
		});
		await db.insert(loanFixationPeriod).values({
			id: randomUUID(),
			loanId,
			startDate:
				String(form.get('startDate') ?? '').trim() || new Date().toISOString().slice(0, 10),
			endDate: regime === 'fixed_period' ? fixedUntil : null,
			annualRatePct: String(rate)
		});
		return { ok: true };
	}
};
