import { asOptionalRowId, asRowId } from '$lib/ids';
import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { document, documentLink, person } from '$lib/server/db/schema';
import { deleteStatement, loadStatements, saveStatement } from '$lib/server/tax';
import { effectiveRatePct, payslipYearTotalConverted, taxSeries } from '$lib/tax';
import { getBaseCurrency } from '$lib/server/settings';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { displayCurrency, formatMinor, parseAmountToMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [statements, people, payslipDocs, slipOwners, taxDocs, base, rates] = await Promise.all([
		loadStatements(),
		db
			.select({ id: person.id, name: person.name })
			.from(person)
			.orderBy(person.createdAt, person.id),
		db.select().from(document).where(eq(document.shelf, 'payslips')),
		db
			.select({ documentId: documentLink.documentId, personId: documentLink.targetId })
			.from(documentLink)
			.innerJoin(person, eq(person.id, documentLink.targetId)),
		db
			.select({ id: document.id, name: document.name })
			.from(document)
			.where(eq(document.shelf, 'tax')),
		getBaseCurrency(),
		loadRateTable()
	]);
	const convert = (amount: bigint, from: string, to: string, day: string) =>
		convertOrFace(rates, amount, from, to, day);

	// Whose payslip is whose comes from document_person — a real link, exactly
	// as the retirement screen reads it, so the two screens cannot disagree.
	const ownerOf = new Map(slipOwners.map((r) => [r.documentId, r.personId]));
	const slips = payslipDocs
		.filter((d) => d.periodOn !== null)
		.map((d) => ({
			personId: ownerOf.get(d.id) ?? '',
			periodMonth: d.periodOn!.slice(0, 7),
			amountMinor: d.amountMinor,
			currency: d.amountCurrency ?? base
		}));

	// Prefill totals for every person × payslip-year, as editable major-unit
	// text. Computed at display time, never stored — so it cannot go stale.
	const years = [...new Set(slips.map((s) => Number(s.periodMonth.slice(0, 4))))];
	const prefillTotals: Record<string, { amount: string; months: number }> = {};
	for (const p of people) {
		for (const year of years) {
			const t = payslipYearTotalConverted(slips, p.id, year, base, convert);
			if (t.months > 0)
				prefillTotals[`${p.id}|${year}`] = {
					amount: formatMinor(t.totalMinor, base),
					months: t.months
				};
		}
	}

	const taxDocName = new Map(taxDocs.map((d) => [d.id, d.name]));

	return {
		// Form values carry the ISO code. Display symbols belong only in labels;
		// sending "Kč" back through the currency input stored a non-currency.
		baseCurrency: base,
		people,
		taxDocs,
		prefillTotals,
		statements: statements
			.sort((a, b) => b.year - a.year)
			.map((s) => {
				const rate = effectiveRatePct(s.grossIncomeMinor, s.taxPaidMinor);
				// The divergence note is recomputed here, every load. A statement's
				// declared figure legitimately differs from the payslip sum (bonuses,
				// corrections) — that is information, not an error.
				const payslips = payslipYearTotalConverted(slips, s.personId, s.year, s.currency, convert);
				const diverges =
					payslips.months > 0 && payslips.totalMinor !== s.grossIncomeMinor
						? `payslips total ${formatMinor(payslips.totalMinor, s.currency)} — this statement says ${formatMinor(s.grossIncomeMinor, s.currency)}`
						: null;
				return {
					id: s.id,
					personId: s.personId,
					personName: s.personName,
					year: s.year,
					country: s.country,
					currency: displayCurrency(s.currency),
					currencyCode: s.currency,
					gross: formatMinor(s.grossIncomeMinor, s.currency),
					taxPaid: formatMinor(s.taxPaidMinor, s.currency),
					ratePct: rate === null ? null : rate.toFixed(2),
					lines: s.lines.map((l) => ({
						label: l.label,
						amount: formatMinor(l.amountMinor, s.currency)
					})),
					documentId: s.documentId,
					documentName: s.documentId ? (taxDocName.get(s.documentId) ?? null) : null,
					note: s.note,
					diverges
				};
			}),
		series: taxSeries(statements).map((s) => ({
			key: s.key,
			label: s.label,
			currency: displayCurrency(s.currency),
			points: s.points.map((p) => ({
				year: p.year,
				// Display-grade numbers for the charts; the exact figures stay in
				// the statements themselves.
				gross: p.grossMajor,
				tax: p.taxMajor,
				ratePct: p.ratePct
			}))
		}))
	};
};

export const actions: Actions = {
	save: async ({ request }) => {
		const form = await request.formData();
		const currency = (String(form.get('currency') ?? '').trim() || 'CZK').toUpperCase();
		if (!/^[A-Z]{3}$/.test(currency)) {
			return fail(400, { message: 'Use a three-letter currency code.' });
		}

		let gross: bigint;
		let taxPaid: bigint;
		const lines: { label: string; amountMinor: bigint }[] = [];
		try {
			gross = parseAmountToMinor(String(form.get('gross') ?? '0') || '0', currency);
			taxPaid = parseAmountToMinor(String(form.get('taxPaid') ?? '0') || '0', currency);
			const labels = form.getAll('lineLabel').map(String);
			const amounts = form.getAll('lineAmount').map(String);
			for (let i = 0; i < labels.length; i++) {
				if (!labels[i].trim() || !amounts[i]?.trim()) continue;
				lines.push({
					label: labels[i].trim(),
					amountMinor: parseAmountToMinor(amounts[i], currency)
				});
			}
		} catch {
			return fail(400, { message: 'An amount will not parse.' });
		}

		const result = await saveStatement({
			personId: asRowId(form.get('personId')),
			year: Number(form.get('year')),
			country: String(form.get('country') ?? ''),
			currency,
			grossIncomeMinor: gross,
			taxPaidMinor: taxPaid,
			// Optional: a statement need not have a document attached.
			documentId: asOptionalRowId(form.get('documentId')) ?? null,
			note: String(form.get('note') ?? '').trim() || null,
			lines
		});
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	remove: async ({ request }) => {
		const form = await request.formData();
		await deleteStatement(asRowId(form.get('id')));
		return { ok: true };
	}
};
