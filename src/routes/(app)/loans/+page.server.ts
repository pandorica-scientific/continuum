// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { asOptionalRowId, asRowId } from '$lib/ids';
import { eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import {
	loan,
	loanEvent,
	loanFixationPeriod,
	loanProperty,
	tagLink,
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
import { updateLoanTags } from '$lib/server/tags';
import {
	attachDocument,
	candidateDocumentsFor,
	detachDocument,
	documentsAbout
} from '$lib/server/documents/targets';
import { getBaseCurrency } from '$lib/server/settings';
import { convertOrFace } from '$lib/server/fx';
import {
	createLoan,
	recordRepayment,
	replaceFixation,
	updateLoan
} from '$lib/server/loans/mutations';
import { securedPropertiesFromForm } from '$lib/loans/form';
import { displayCurrency, formatMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

function monthNow(): string {
	return new Date().toISOString().slice(0, 7);
}

function fixationPill(regime: string, periods: FixationPeriod[], paidOff: boolean) {
	if (paidOff) return { label: 'paid off', hue: 'grey' as const };
	const current = periodForMonth(periods, monthNow());
	if (regime === 'floating') return { label: 'floating rate', hue: 'yellow' as const };
	if (regime === 'fixed_term') return { label: 'fixed for the whole term', hue: 'teal' as const };
	if (current?.endsOn) {
		const end = new Date(current.endsOn);
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

export const load: PageServerLoad = async ({ locals }) => {
	const actor = locals.person ?? null;
	const baseCurrency = await getBaseCurrency();
	const [loans, allPeriods, properties, links, allEvents] = await Promise.all([
		db.select().from(loan).orderBy(loan.createdAt, loan.id),
		db.select().from(loanFixationPeriod),
		db.select({ id: property.id, name: property.name }).from(property),
		db.select().from(loanProperty),
		db.select().from(loanEvent).orderBy(loanEvent.happenedOn)
	]);

	const year = new Date().getFullYear();
	let totalOwedBase = 0n;
	let totalPaymentBase = 0n;
	let interestYearBase = 0n;
	let interestFromMonth: string | null = null;
	let latestDebtFree: number | null = null;

	const [loanTagRows, allTags] = await Promise.all([
		// tag_link spans every kind, so this says which one it means.
		db
			.select({ loanId: tagLink.targetId, tagId: tagLink.tagId })
			.from(tagLink)
			.innerJoin(loan, eq(loan.id, tagLink.targetId)),
		db.select().from(tag)
	]);
	const tagName = new Map(allTags.map((t) => [t.id, t.name]));

	// The agreement and each re-fix letter, through the one query every
	// documents card uses — `documentsAbout` stays one query per loan (it is
	// narrow), but run concurrently for every loan up front rather than
	// awaited one at a time inside the loop below. `candidateDocumentsFor`
	// is the other half: ONE query for the whole visible library plus ONE for
	// `document_link` across every loan, not the whole library fetched again
	// for each loan's picker.
	const loanIds = loans.map((l) => l.id);
	const [documentsByLoan, candidatesByLoan] = await Promise.all([
		Promise.all(loanIds.map(async (id) => [id, await documentsAbout(id, actor)] as const)).then(
			(pairs) => new Map(pairs)
		),
		candidateDocumentsFor(loanIds, actor)
	]);

	const cards = [];
	for (const l of loans) {
		const periods: FixationPeriod[] = allPeriods
			.filter((p) => p.loanId === l.id)
			.map((p) => ({
				startsOn: p.startsOn,
				endsOn: p.endsOn,
				annualRatePct: Number(p.annualRatePct),
				paymentMinor: p.paymentMinor
			}));
		const terms = {
			owedMinor: l.owedMinor,
			// Same rule the what-if preview uses, so the saved chart and the
			// preview it was decided from cannot disagree: a balance observed
			// after the payment day already reflects this month's instalment.
			owedAsOfMonth: anchorMonthFor(
				l.owedOn ?? new Date().toISOString().slice(0, 10),
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

		const documents = documentsByLoan.get(l.id) ?? [];
		const documentCandidates = candidatesByLoan.get(l.id) ?? [];

		const owedBase = await convertOrFace(l.owedMinor, l.currency, baseCurrency);
		const paymentBase = await convertOrFace(payment, l.currency, baseCurrency);
		totalOwedBase += owedBase;
		totalPaymentBase += l.owedMinor > 0n ? paymentBase : 0n;

		const interest = interestForYear(terms, periods, year);
		if (interest) {
			const interestBase = await convertOrFace(interest.interestMinor, l.currency, baseCurrency);
			interestYearBase += interestBase;
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
			(max, p) => (p.endsOn && (!max || p.endsOn > max) ? p.endsOn : max),
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
			// What the edit form starts from. A loan could be created but never
			// corrected, so a mortgage entered without its second flat meant
			// starting over.
			edit: {
				name: l.name,
				lender: l.lender,
				kind: l.kind,
				paymentDay: l.paymentDay,
				endsOn: l.endsOn,
				// How the loan works, as opposed to what it has done. Reported as
				// fixed and uncorrectable.
				regime: l.regime,
				accrualStyle: l.accrualStyle,
				dayCount: l.dayCount,
				interestDeductible: l.interestDeductible,
				secured: links
					.filter((link) => link.loanId === l.id)
					.map((link) => ({ propertyId: link.propertyId, sharePct: link.sharePct }))
			},
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
					value: freeYear !== null ? String(freeYear) : (l.endsOn?.slice(0, 4) ?? '—'),
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
			documents,
			documentCandidates,
			addDocumentHref: `/documents?add=1&addShelfKey=finance&targetKind=loan&targetId=${l.id}`,
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
					startsOn: p.startsOn,
					endsOn: p.endsOn,
					annualRatePct: p.annualRatePct,
					paymentMinor: String(p.paymentMinor)
				}))
			}
		});
	}

	const unit = displayCurrency(baseCurrency);
	return {
		isAdmin: locals.person?.role === 'admin',
		unit,
		count: loans.length,
		metrics: {
			totalOwed: formatMinor(totalOwedBase, baseCurrency),
			monthlyPayments: formatMinor(totalPaymentBase, baseCurrency),
			interestThisYear: formatMinor(interestYearBase, baseCurrency),
			// Honesty about the projection's blind spot: without booked history,
			// interest is only visible from the balance anchor forward.
			//
			// This used to lead with a deductible total. Deductibility is Czech law
			// stated as a general fact on a screen with no jurisdiction, and the tax
			// statements carry the real figures from real documents.
			interestNote: interestFromMonth ? `projected from ${interestFromMonth}` : undefined,
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
		const id = asOptionalRowId(form.get('id'));
		if (!id) return fail(400, { message: 'Missing loan.' });
		const added = String(form.get('tagName') ?? '').trim();
		const removed = String(form.get('removeTag') ?? '').trim();
		await updateLoanTags(id, {
			add: added || undefined,
			remove: removed || undefined
		});
		return { ok: true };
	},

	addRepayment: async ({ request }) => {
		const form = await request.formData();
		const result = await recordRepayment({
			loanId: asRowId(form.get('loanId')),
			date: String(form.get('date') ?? ''),
			amount: String(form.get('amount') ?? ''),
			balanceAfter: String(form.get('balanceAfter') ?? ''),
			note: String(form.get('note') ?? '')
		});
		return result.ok ? result : fail(result.status, { message: result.message });
	},

	addFixation: async ({ request }) => {
		const form = await request.formData();
		const result = await replaceFixation({
			loanId: asRowId(form.get('loanId')),
			startsOn: String(form.get('startsOn') ?? ''),
			endsOn: String(form.get('endsOn') ?? '') || null,
			rate: String(form.get('rate') ?? ''),
			payment: String(form.get('payment') ?? '')
		});
		return result.ok ? result : fail(result.status, { message: result.message });
	},

	/**
	 * Correct a loan's description and which properties secure it.
	 *
	 * Rate, payment and balance are not here: those are what `addFixation` and
	 * `addRepayment` are for, and they understand the history they rewrite.
	 */
	editLoan: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		const propertiesAll = await db.select({ id: property.id }).from(property);
		const secured = securedPropertiesFromForm(
			form,
			propertiesAll.map((row) => row.id)
		);
		const paymentDayRaw = String(form.get('paymentDay') ?? '').trim();
		const result = await updateLoan(id, {
			name: String(form.get('name') ?? ''),
			lender: String(form.get('lender') ?? ''),
			kind: String(form.get('kind') ?? 'mortgage'),
			paymentDay: paymentDayRaw ? Number(paymentDayRaw) : null,
			endsOn: String(form.get('endsOn') ?? '').trim() || null,
			secured,
			// How the loan works. Reported as fixed and uncorrectable: a rate regime
			// or accrual style entered wrongly meant starting the loan again.
			regime: String(form.get('regime') ?? ''),
			accrualStyle: String(form.get('accrualStyle') ?? ''),
			dayCount: String(form.get('dayCount') ?? ''),
			interestDeductible: form.get('interestDeductible') === 'on'
		});
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	addLoan: async ({ request }) => {
		const form = await request.formData();
		const paymentDayRaw = Number(form.get('paymentDay'));
		const paymentDay =
			Number.isInteger(paymentDayRaw) && paymentDayRaw >= 1 && paymentDayRaw <= 31
				? paymentDayRaw
				: null;

		// One agreement can secure several flats, each with its own share.
		const propertiesAll = await db.select({ id: property.id }).from(property);
		const secured = securedPropertiesFromForm(
			form,
			propertiesAll.map((property) => property.id)
		);

		const result = await createLoan({
			name: String(form.get('name') ?? ''),
			lender: String(form.get('lender') ?? ''),
			kind: String(form.get('kind') ?? 'mortgage'),
			currency: String(form.get('currency') ?? 'CZK'),
			principal: String(form.get('principal') ?? ''),
			owed: String(form.get('owed') ?? ''),
			payment: String(form.get('payment') ?? ''),
			rate: String(form.get('rate') ?? ''),
			regime: String(form.get('regime') ?? 'fixed_period'),
			dayCount: String(form.get('dayCount') ?? '30/360'),
			accrualStyle: String(form.get('accrualStyle') ?? 'payment'),
			paymentDay,
			fixedUntil: String(form.get('fixedUntil') ?? '') || null,
			startsOn: String(form.get('startsOn') ?? '') || null,
			endsOn: String(form.get('endsOn') ?? '') || null,
			// The screen no longer asks: deductibility is Czech-specific and the tax
			// statements carry the real figures. The column stays — the schema is
			// additive-only — and createLoan still requires the field.
			interestDeductible: false,
			secured
		});
		return result.ok ? result : fail(result.status, { message: result.message });
	},

	/**
	 * File an existing document against a loan — the "Attach" picker on its
	 * `DocumentsCard`. Every loan's card posts here with its own `targetId`, so
	 * one action serves all of them; the registry resolves which loan it was.
	 */
	attachDocument: async ({ request, locals }) => {
		const form = await request.formData();
		const targetId = asRowId(form.get('targetId'));
		const documentId = String(form.get('documentId') ?? '').trim();
		if (!documentId) return fail(400, { message: 'Choose a document to attach.' });
		const result = await attachDocument(targetId, documentId, locals.person ?? null);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/**
	 * Unfile a document — the link only. The document stays on its shelf, so a
	 * mis-click costs a re-attach rather than evidence.
	 */
	detachDocument: async ({ request, locals }) => {
		const form = await request.formData();
		const targetId = asRowId(form.get('targetId'));
		const documentId = String(form.get('documentId') ?? '').trim();
		if (!documentId) return fail(400, { message: 'Which document?' });
		const result = await detachDocument(targetId, documentId, locals.person ?? null);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	}
};
