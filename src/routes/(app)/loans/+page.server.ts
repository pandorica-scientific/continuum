import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	loan,
	loanEvent,
	loanFixationPeriod,
	loanProperty,
	loanTag,
	property,
	tag
} from '$lib/server/db/schema';
import {
	amortise,
	DAY_COUNTS,
	debtFreeYear,
	interestForYear,
	periodForMonth,
	type DayCount,
	type FixationPeriod
} from '$lib/loans/amortise';
import { anchorMonthFor, project } from '$lib/loans/simulate';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { normaliseTagName, setLoanTags } from '$lib/server/tags';
import { getBaseCurrency } from '$lib/server/settings';
import { convertOrFace } from '$lib/server/fx';
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

const EVENT_LABELS: Record<string, string> = {
	payment: 'payment',
	extra_payment: 'extra repayment',
	refix: 're-fix',
	fee: 'fee',
	balance: 'balance statement'
};

export const load: PageServerLoad = async () => {
	const baseCurrency = await getBaseCurrency();
	const [loans, allPeriods, properties, links, allEvents] = await Promise.all([
		db.select().from(loan).orderBy(loan.createdAt),
		db.select().from(loanFixationPeriod),
		db.select({ id: property.id, name: property.name }).from(property),
		db.select().from(loanProperty),
		db.select().from(loanEvent).orderBy(loanEvent.happenedOn)
	]);

	const year = new Date().getFullYear();
	let totalOwedBase = 0n;
	let totalPaymentBase = 0n;
	let interestYearBase = 0n;
	let deductibleYearBase = 0n;
	let interestFromMonth: string | null = null;
	let latestDebtFree: number | null = null;

	const [loanTagRows, allTags] = await Promise.all([
		db.select().from(loanTag),
		db.select().from(tag)
	]);
	const tagName = new Map(allTags.map((t) => [t.id, t.name]));
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
			// Same rule the what-if preview uses, so the saved chart and the
			// preview it was decided from cannot disagree: a balance observed
			// after the payment day already reflects this month's instalment.
			owedAsOfMonth: anchorMonthFor(
				l.owedAsOf ?? new Date().toISOString().slice(0, 10),
				l.paymentDay
			),
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

		const owedBase = await convertOrFace(l.owedMinor, l.currency, baseCurrency);
		const paymentBase = await convertOrFace(payment, l.currency, baseCurrency);
		totalOwedBase += owedBase;
		totalPaymentBase += l.owedMinor > 0n ? paymentBase : 0n;

		const interest = interestForYear(terms, periods, year);
		if (interest) {
			const interestBase = await convertOrFace(interest.interestMinor, l.currency, baseCurrency);
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

		// Full projected schedule, aggregated per year, for the interest vs
		// principal chart.
		const { rows: fullSchedule, years } = project(terms, periods);
		const chart = years.map((y) => ({
			year: y.year,
			interest: Number(y.interestMinor),
			principal: Number(y.principalMinor),
			interestLabel: formatMinor(y.interestMinor, l.currency),
			principalLabel: formatMinor(y.principalMinor, l.currency)
		}));
		// Beyond the last fixation the engine carries the last known terms
		// forward (documented re-fix-gap behaviour) — say so on the chart.
		const lastKnown = periods.reduce<string | null>(
			(max, p) => (p.endDate && (!max || p.endDate > max) ? p.endDate : max),
			null
		);
		const lastMonth = fullSchedule.at(-1)?.month ?? null;
		const scheduleEnds =
			lastKnown && lastMonth && lastMonth > lastKnown.slice(0, 7) ? lastKnown.slice(0, 7) : null;

		const events = allEvents
			.filter((e) => e.loanId === l.id)
			.sort((a, b) => (a.happenedOn < b.happenedOn ? 1 : -1))
			.map((e) => ({
				id: e.id,
				date: e.happenedOn,
				label: EVENT_LABELS[e.kind] ?? e.kind,
				amount: formatMinor(e.amountMinor, l.currency),
				note: e.note ?? ''
			}));

		cards.push({
			id: l.id,
			name: l.name,
			tags: loanTagRows
				.filter((r) => r.loanId === l.id)
				.map((r) => tagName.get(r.tagId) ?? '')
				.filter(Boolean),
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
			monthInterest: schedule[0] ? formatMinor(schedule[0].interestMinor, l.currency) : null,
			chart,
			chartNote: [
				`projected from ${terms.owedAsOfMonth}`,
				scheduleEnds ? `after ${scheduleEnds} at the last known rate` : null
			]
				.filter(Boolean)
				.join(' · '),
			events,
			currency: l.currency,
			// raw inputs for the browser-side what-if engine (bigints as strings)
			sim: {
				terms: {
					owedMinor: String(terms.owedMinor),
					owedAsOfMonth: terms.owedAsOfMonth,
					dayCount: terms.dayCount,
					accrualStyle: terms.accrualStyle,
					paymentDay: terms.paymentDay
				},
				periods: periods.map((p) => ({
					startDate: p.startDate,
					endDate: p.endDate,
					annualRatePct: p.annualRatePct,
					paymentMinor: String(p.paymentMinor)
				}))
			}
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
		knownTags: allTags.map((t) => ({ id: t.id, name: t.name })),
		properties,
		currencies: await availableCurrencies()
	};
};

export const actions: Actions = {
	tags: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { message: 'Missing loan.' });
		const existing = await db
			.select({ loanId: loanTag.loanId, name: tag.name })
			.from(loanTag)
			.innerJoin(tag, eq(loanTag.tagId, tag.id));
		const added = String(form.get('tagName') ?? '').trim();
		const removed = String(form.get('removeTag') ?? '').trim();
		const names = existing
			.filter((r) => r.loanId === id)
			.map((r) => r.name)
			.filter((n) => n !== removed);
		if (added && !names.some((n) => normaliseTagName(n) === normaliseTagName(added)))
			names.push(added);
		await setLoanTags(id, names);
		return { ok: true };
	},

	addRepayment: async ({ request }) => {
		const form = await request.formData();
		const loanId = String(form.get('loanId') ?? '');
		const rows = await db.select().from(loan).where(eq(loan.id, loanId));
		const l = rows[0];
		if (!l) return fail(404, { message: 'Loan not found.' });

		const date = String(form.get('date') ?? '').trim() || new Date().toISOString().slice(0, 10);
		let amount: bigint;
		let balanceAfter: bigint | null = null;
		try {
			amount = parseAmountToMinor(String(form.get('amount') ?? ''), l.currency);
			if (amount <= 0n) throw new Error('amount');
			const balanceRaw = String(form.get('balanceAfter') ?? '').trim();
			if (balanceRaw) balanceAfter = parseAmountToMinor(balanceRaw, l.currency);
		} catch {
			return fail(400, { message: 'The repayment amount must be a positive number.' });
		}

		// The bank's post-repayment balance is the best anchor when known;
		// otherwise the repayment simply comes off the current balance.
		let newOwed = balanceAfter ?? l.owedMinor - amount;
		if (newOwed < 0n) newOwed = 0n;

		await db.insert(loanEvent).values({
			id: randomUUID(),
			loanId,
			happenedOn: date,
			kind: 'extra_payment',
			amountMinor: amount,
			note: String(form.get('note') ?? '').trim() || null
		});
		await db.update(loan).set({ owedMinor: newOwed, owedAsOf: date }).where(eq(loan.id, loanId));
		return { ok: true };
	},

	addFixation: async ({ request }) => {
		const form = await request.formData();
		const loanId = String(form.get('loanId') ?? '');
		const rows = await db.select().from(loan).where(eq(loan.id, loanId));
		const l = rows[0];
		if (!l) return fail(404, { message: 'Loan not found.' });

		const startDate = String(form.get('startDate') ?? '').trim();
		if (!startDate) return fail(400, { message: 'The new fixation needs its start date.' });
		const endDate = String(form.get('endDate') ?? '').trim() || null;
		let payment: bigint;
		const rate = Number(String(form.get('rate') ?? '').replace(',', '.'));
		try {
			payment = parseAmountToMinor(String(form.get('payment') ?? ''), l.currency);
			if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('rate');
		} catch {
			return fail(400, { message: 'Rate and payment must be numbers.' });
		}

		// The new period takes over from its start date: any period still open
		// (or reaching past the start) is closed there — history stays intact.
		await db
			.update(loanFixationPeriod)
			.set({ endDate: startDate })
			.where(
				and(
					eq(loanFixationPeriod.loanId, loanId),
					lt(loanFixationPeriod.startDate, startDate),
					or(isNull(loanFixationPeriod.endDate), gt(loanFixationPeriod.endDate, startDate))
				)
			);
		await db.insert(loanFixationPeriod).values({
			id: randomUUID(),
			loanId,
			startDate,
			endDate,
			annualRatePct: String(rate),
			paymentMinor: payment
		});
		await db.insert(loanEvent).values({
			id: randomUUID(),
			loanId,
			happenedOn: startDate,
			kind: 'refix',
			amountMinor: payment,
			note: `${rate.toFixed(2)}%${endDate ? ` to ${endDate}` : ''}`
		});
		return { ok: true };
	},

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
