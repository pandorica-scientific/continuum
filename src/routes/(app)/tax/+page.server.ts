// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { asOptionalRowId, asRowId } from '$lib/ids';
import { extname } from 'node:path';
import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { document, documentLink, person } from '$lib/server/db/schema';
import { deleteStatement, loadStatements, saveStatement } from '$lib/server/tax';
import { effectiveRatePct, payslipYearTotalConverted, taxSeries } from '$lib/tax';
import { getBaseCurrency } from '$lib/server/settings';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { removeUpload, saveUpload } from '$lib/server/system/files';
import { displayCurrency, formatMinor, parseAmountToMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [statements, people, payslipDocs, slipOwners, taxDocs, base, rates, currencies] =
		await Promise.all([
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
				.where(eq(document.shelf, 'tax'))
				.orderBy(document.addedOn),
			getBaseCurrency(),
			loadRateTable(),
			// The same list every other money screen offers, derived from the rate
			// table — a code typed by hand could name a currency nothing can convert.
			availableCurrencies()
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
			currency: d.currency ?? base
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
		currencies,
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
		// No fixed fallback: an empty field means "the household's own currency",
		// which is configured, not a constant this file gets to decide.
		const currency = (String(form.get('currency') ?? '').trim() || (await getBaseCurrency()))
			.trim()
			.toUpperCase();
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

		// The statement itself can bring its paperwork with it: a file chosen here
		// becomes a document on the Tax shelf, filed against the same person, and
		// the statement points at it. Before this, attaching anything meant leaving
		// the screen, filing the document elsewhere, and coming back.
		const file = form.get('file');
		let attachment: { storedName: string; ext: string; addedOn: string } | null = null;
		if (file instanceof File && file.size > 0) {
			try {
				attachment = {
					storedName: await saveUpload(file),
					ext: extname(file.name).replace('.', '').toUpperCase() || 'PDF',
					addedOn: new Date().toISOString().slice(0, 10)
				};
			} catch (err) {
				return fail(400, { message: err instanceof Error ? err.message : 'Upload failed.' });
			}
		}

		// The file is on the volume before the row is, so every way out of the save
		// that does not commit the statement takes the file with it — refusal and
		// failure alike. An upload nothing points at is invisible litter.
		let result;
		try {
			result = await saveStatement({
				personId: asRowId(form.get('personId')),
				year: Number(form.get('year')),
				country: String(form.get('country') ?? ''),
				currency,
				grossIncomeMinor: gross,
				taxPaidMinor: taxPaid,
				// Optional: a statement need not have a document attached.
				documentId: asOptionalRowId(form.get('documentId')) ?? null,
				note: String(form.get('note') ?? '').trim() || null,
				lines,
				attachment
			});
		} catch (err) {
			if (attachment) await removeUpload(attachment.storedName);
			throw err;
		}
		if (!result.ok) {
			if (attachment) await removeUpload(attachment.storedName);
			return fail(result.status, { message: result.message });
		}
		return { ok: true };
	},

	remove: async ({ request }) => {
		const form = await request.formData();
		await deleteStatement(asRowId(form.get('id')));
		return { ok: true };
	}
};
