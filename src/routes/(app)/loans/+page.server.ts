import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { loan, loanFixationPeriod, loanProperty, property } from '$lib/server/db/schema';
import {
	amortise,
	DAY_COUNTS,
	debtFreeYear,
	interestForYear,
	periodForMonth,
	type DayCount,
	type FixationPeriod
} from '$lib/server/loans/amortise';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { getBaseCurrency } from '$lib/server/settings';
import { convertMinor } from '$lib/server/fx';
import { displayCurrency, formatMinor, parseAmountToMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

function monthNow(): string {
	return new Date().toISOString().slice(0, 7);
}

function fixationPill(regime: string, periods: FixationPeriod[], paidOff: boolean) {
	if (paidOff) return { label: 'paid off', hue: 'grey' as const };
	const current = periodForMonth(periods, monthNow());
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
	const [loans, allPeriods, properties, links] = await Promise.all([
		db.select().from(loan).orderBy(loan.createdAt),
		db.select().from(loanFixationPeriod),
		db.select({ id: property.id, name: property.name }).from(property),
		db.select().from(loanProperty)
	]);

	const year = new Date().getFullYear();
	let totalOwedBase = 0n;
	let totalPaymentBase = 0n;
	let interestYearBase = 0n;
	let deductibleYearBase = 0n;
	let interestFromMonth: string | null = null;
	let latestDebtFree: number | null = null;

	const cards = [];
	for (const l of loans) {
		const periods: FixationPeriod[] = allPeriods
			.filter((p) => p.loanId === l.id)
			.map((p) => ({
				startDate: p.startDate,
				endDate: p.endDate,
				annualRatePct: Number(p.annualRatePct),
				paymentMinor: p.paymentMinor
			}));
		const terms = {
			owedMinor: l.owedMinor,
			owedAsOfMonth: (l.owedAsOf ?? new Date().toISOString().slice(0, 10)).slice(0, 7),
			dayCount: (DAY_COUNTS as readonly string[]).includes(l.dayCount)
				? (l.dayCount as DayCount)
				: ('30/360' as DayCount),
			accrualStyle: l.accrualStyle === 'calendar' ? ('calendar' as const) : ('payment' as const),
			paymentDay: l.paymentDay ?? 1
		};
		const securedNames = links
			.filter((lp) => lp.loanId === l.id)
			.map((lp) => properties.find((p) => p.id === lp.propertyId)?.name)
			.filter(Boolean);
		const currentPeriod = periodForMonth(periods, monthNow());
		const payment = currentPeriod?.paymentMinor ?? 0n;

		const owedBase = (await convertMinor(l.owedMinor, l.currency, baseCurrency)) ?? l.owedMinor;
		const paymentBase = (await convertMinor(payment, l.currency, baseCurrency)) ?? payment;
		totalOwedBase += owedBase;
		totalPaymentBase += l.owedMinor > 0n ? paymentBase : 0n;

		const interest = interestForYear(terms, periods, year);
		if (interest) {
			const interestBase =
				(await convertMinor(interest.interestMinor, l.currency, baseCurrency)) ??
				interest.interestMinor;
			interestYearBase += interestBase;
			if (l.interestDeductible) deductibleYearBase += interestBase;
			if (
				interest.fromMonth !== `${year}-01` &&
				(interestFromMonth === null || interest.fromMonth > interestFromMonth)
			) {
				interestFromMonth = interest.fromMonth;
			}
		}

		const freeYear = debtFreeYear(terms, periods);
		if (freeYear !== null && (latestDebtFree === null || freeYear > latestDebtFree)) {
			latestDebtFree = freeYear;
		}

		const repaid = l.principalMinor - l.owedMinor;
		const paidPct = l.principalMinor > 0n ? Number((repaid * 1000n) / l.principalMinor) / 10 : 0;
		const rate = currentPeriod?.annualRatePct ?? null;
		const schedule = amortise(terms, periods, monthNow()).slice(0, 1);

		cards.push({
			id: l.id,
			name: l.name,
			sub: [
				l.lender,
				rate !== null ? `${rate.toFixed(2)}%` : null,
				securedNames.length ? `secured by ${securedNames.join(' + ')}` : null
			]
				.filter(Boolean)
				.join(' · '),
			pill: fixationPill(l.regime, periods, l.owedMinor <= 0n),
			facts: [
				{ label: 'Owed', value: formatMinor(l.owedMinor, l.currency), color: 'var(--red)' },
				{ label: 'Payment', value: formatMinor(payment, l.currency), color: 'var(--fg1)' },
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
			// Honesty about the projection's blind spot: without booked history,
			// interest is only visible from the balance anchor forward.
			interestNote: interestFromMonth
				? `deductible: ${formatMinor(deductibleYearBase, baseCurrency)} · projected from ${interestFromMonth}`
				: `deductible: ${formatMinor(deductibleYearBase, baseCurrency)}`,
			debtFree: latestDebtFree
		},
		loans: cards,
		properties,
		currencies: await availableCurrencies()
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
		const accrualStyle = String(form.get('accrualStyle')) === 'calendar' ? 'calendar' : 'payment';
		const dayCountRaw = String(form.get('dayCount') ?? '30/360');
		const dayCount = (DAY_COUNTS as readonly string[]).includes(dayCountRaw)
			? dayCountRaw
			: '30/360';
		const paymentDayRaw = Number(form.get('paymentDay'));
		const paymentDay =
			Number.isInteger(paymentDayRaw) && paymentDayRaw >= 1 && paymentDayRaw <= 31
				? paymentDayRaw
				: null;
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
			startDate: String(form.get('startDate') ?? '').trim() || null,
			endDate: String(form.get('endDate') ?? '').trim() || null,
			regime,
			dayCount,
			accrualStyle,
			paymentDay,
			interestDeductible: form.get('deductible') === 'on' ? 1 : 0
		});
		// One agreement can secure several flats, each with its own share.
		const propertiesAll = await db.select({ id: property.id }).from(property);
		for (const prop of propertiesAll) {
			if (form.get(`secured_${prop.id}`) !== 'on') continue;
			const shareRaw = String(form.get(`share_${prop.id}`) ?? '')
				.replace(',', '.')
				.trim();
			const share = Number(shareRaw);
			await db.insert(loanProperty).values({
				id: randomUUID(),
				loanId,
				propertyId: prop.id,
				sharePct:
					shareRaw && Number.isFinite(share) && share > 0 && share <= 100 ? String(share) : null
			});
		}
		await db.insert(loanFixationPeriod).values({
			id: randomUUID(),
			loanId,
			startDate:
				String(form.get('startDate') ?? '').trim() || new Date().toISOString().slice(0, 10),
			endDate: regime === 'fixed_period' ? fixedUntil : null,
			annualRatePct: String(rate),
			paymentMinor: payment
		});
		return { ok: true };
	}
};
