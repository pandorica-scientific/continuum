// SPDX-License-Identifier: AGPL-3.0-or-later
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
	debtFreeYear,
	interestForYear,
	periodForMonth,
	type FixationPeriod
} from '$lib/loans/amortise';
import { DAY_COUNTS, type DayCount } from '$lib/loans';
import { fixationPill } from '$lib/loans/pill';
import { fixationBand } from '$lib/loans/fixation-band';
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
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import {
	createLoan,
	recordRepayment,
	replaceFixation,
	updateLoan
} from '$lib/server/loans/mutations';
import { securedPropertiesFromForm } from '$lib/loans/form';
import { displayCurrency, formatMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function monthNow(): string {
	return today().slice(0, 7);
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
	// Loaded once for the whole screen rather than converted per loan in the loop below.
	const todayIso = today();
	const [loans, allPeriods, properties, links, allEvents, rates] = await Promise.all([
		db.select().from(loan).orderBy(loan.createdAt, loan.id),
		db.select().from(loanFixationPeriod),
		db.select({ id: property.id, name: property.name }).from(property),
		db.select().from(loanProperty),
		db.select().from(loanEvent).orderBy(loanEvent.happenedOn),
		loadRateTable()
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

	// Fetched once for all loans up front, not once per loan in the loop below.
	const loanIds = loans.map((l) => l.id);
	const [documentsByLoan, candidatesByLoan] = await Promise.all([
		Promise.all(loanIds.map(async (id) => [id, await documentsAbout(id)] as const)).then(
			(pairs) => new Map(pairs)
		),
		candidateDocumentsFor(loanIds)
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
			// Same rule the what-if preview uses, so the saved chart and preview
			// can't disagree — a balance observed after the payment day already
			// reflects this month's instalment.
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

		const owedBase = convertOrFace(rates, l.owedMinor, l.currency, baseCurrency, todayIso);
		const paymentBase = convertOrFace(rates, payment, l.currency, baseCurrency, todayIso);
		totalOwedBase += owedBase;
		totalPaymentBase += l.owedMinor > 0n ? paymentBase : 0n;

		const interest = interestForYear(terms, periods, year);
		if (interest) {
			const interestBase = convertOrFace(
				rates,
				interest.interestMinor,
				l.currency,
				baseCurrency,
				todayIso
			);
			interestYearBase += interestBase;
			if (
				interest.fromMonth !== `${year}-01` &&
				(interestFromMonth === null || interest.fromMonth > interestFromMonth)
			) {
				interestFromMonth = interest.fromMonth;
			}
		}

		const freeYear = debtFreeYear(terms, periods);
		const bandEnd = l.endsOn ?? (freeYear !== null ? `${freeYear}-12-31` : null);
		if (freeYear !== null && (latestDebtFree === null || freeYear > latestDebtFree)) {
			latestDebtFree = freeYear;
		}

		const repaid = l.principalMinor - l.owedMinor;
		const paidPct = l.principalMinor > 0n ? Number((repaid * 1000n) / l.principalMinor) / 10 : 0;
		const rate = currentPeriod?.annualRatePct ?? null;
		const schedule = amortise(terms, periods, monthNow()).slice(0, 1);

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
			edit: {
				name: l.name,
				lender: l.lender,
				kind: l.kind,
				paymentDay: l.paymentDay,
				endsOn: l.endsOn,
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
			pill: fixationPill(l.regime, periods, l.owedMinor <= 0n, today()),
			// A loan with no agreed end date still gets one from the projected `debtFreeYear`,
			// so the band always has a truthful whole to take shares of.
			band: fixationBand(periods, bandEnd, today()),
			// Earliest period first: the band sorts its own copy, and a caption reading a
			// later year than the band's first segment would label it wrongly.
			bandRange:
				periods.length > 0 && bandEnd
					? `${[...periods].sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0].startsOn.slice(0, 4)} → ${bandEnd.slice(0, 4)}`
					: null,
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
			// Raw inputs for the browser-side what-if engine (bigints as strings).
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
		unit,
		count: loans.length,
		metrics: {
			totalOwed: formatMinor(totalOwedBase, baseCurrency),
			monthlyPayments: formatMinor(totalPaymentBase, baseCurrency),
			interestThisYear: formatMinor(interestYearBase, baseCurrency),
			// Without booked history, interest is only visible from the balance anchor forward.
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

	/** Correct a loan's description and secured properties. Rate, payment and
	 *  balance are not here — that's `addFixation` and `addRepayment`. */
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
			// Deductibility is Czech-specific and the tax statements carry the real figures;
			// the column stays (schema is additive-only) and createLoan still requires it.
			interestDeductible: false,
			secured
		});
		return result.ok ? result : fail(result.status, { message: result.message });
	},

	/** The "Attach" picker on a loan's `DocumentsCard`; one action serves every
	 *  loan, disambiguated by `targetId`. */
	attachDocument: async ({ request }) => {
		const form = await request.formData();
		const targetId = asRowId(form.get('targetId'));
		const documentId = String(form.get('documentId') ?? '').trim();
		if (!documentId) return fail(400, { message: 'Choose a document to attach.' });
		const result = await attachDocument(targetId, documentId);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/** Unfile a document — the link only; the document stays on its shelf. */
	detachDocument: async ({ request }) => {
		const form = await request.formData();
		const targetId = asRowId(form.get('targetId'));
		const documentId = String(form.get('documentId') ?? '').trim();
		if (!documentId) return fail(400, { message: 'Which document?' });
		const result = await detachDocument(targetId, documentId);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	}
};
