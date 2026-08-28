// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { asOptionalRowId, asRowId } from '$lib/ids';
import { extname } from 'node:path';
import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { document, person, salaryEntry, taxStatement } from '$lib/server/db/schema';
import {
	attachDocumentsToStatement,
	deleteStatement,
	detachDocument,
	loadStatements,
	saveStatement,
	type StatementAttachment
} from '$lib/server/tax';
import { deleteDocument } from '$lib/server/documents/mutations';
import {
	attachmentKind,
	blendedRatePct,
	effectiveRatePct,
	flaggedThresholdMinor,
	normaliseTaxView,
	salaryYearGrossTotalConverted,
	taxByYear
} from '$lib/tax';
import { countryName, hueTokens } from '$lib/tax-hues';
import { getBaseCurrency } from '$lib/server/settings';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { removeUpload, saveUpload } from '$lib/server/system/files';
import { displayCurrency, formatMinor, parseAmountToMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const [statements, people, salaryRows, taxDocs, base, rates, currencies, prefRows] =
		await Promise.all([
			loadStatements(),
			db
				.select({ id: person.id, name: person.name })
				.from(person)
				.orderBy(person.createdAt, person.id),
			// Salary entries, not payslip documents. A document's `amountMinor` is
			// the net-shaped figure this screen was reading as gross.
			db
				.select({
					personId: salaryEntry.personId,
					periodMonth: salaryEntry.periodMonth,
					grossMinor: salaryEntry.grossMinor,
					currency: salaryEntry.currency
				})
				.from(salaryEntry),
			db
				.select({ id: document.id, name: document.name })
				.from(document)
				.where(eq(document.type, 'tax_document'))
				.orderBy(document.addedOn),
			getBaseCurrency(),
			loadRateTable(),
			// The same list every other money screen offers, derived from the rate
			// table — a code typed by hand could name a currency nothing can convert.
			availableCurrencies(),
			locals.person
				? db.select({ taxView: person.taxView }).from(person).where(eq(person.id, locals.person.id))
				: Promise.resolve([])
		]);
	const convert = (amount: bigint, from: string, to: string, day: string) =>
		convertOrFace(rates, amount, from, to, day);

	// Prefill totals for every person × salary-year, as editable major-unit
	// text. Computed at display time, never stored — so it cannot go stale.
	//
	// Only years with a GROSS figure: a year evidenced solely by bank credits
	// knows what arrived after tax, which is not what a tax statement declares.
	const payslipYears = [
		...new Set(
			salaryRows.filter((r) => r.grossMinor !== null).map((r) => Number(r.periodMonth.slice(0, 4)))
		)
	];
	const prefillTotals: Record<string, { amount: string; months: number }> = {};
	for (const p of people) {
		for (const year of payslipYears) {
			const t = salaryYearGrossTotalConverted(salaryRows, p.id, year, base, convert);
			if (t.months > 0)
				prefillTotals[`${p.id}|${year}`] = {
					amount: formatMinor(t.totalMinor, base),
					months: t.months
				};
		}
	}

	// How this person left the screen last time. Everything below the summary
	// band answers to it, so it is resolved here rather than in the component:
	// the year rows are converted and filtered server-side.
	const stored = prefRows[0]?.taxView ?? null;
	const prefs = normaliseTaxView(
		stored,
		people.map((p) => p.id),
		currencies,
		base
	);
	const filterPerson = prefs.person === 'both' ? undefined : prefs.person;

	const years = taxByYear(statements, prefs.currency, convert, filterPerson);
	const hues = hueTokens(statements.map((s) => s.country));

	// The currencies worth offering as a display currency: the household's own,
	// plus the ones it has actually filed in. NOT availableCurrencies(), which
	// is every code the rate table quotes — thirty-odd of them, rendered as a
	// segmented control nobody can use, and offering to restate a Czech-and-
	// Spanish record in Malaysian ringgit.
	const displayCurrencies = [base, ...statements.map((s) => s.currency)].filter(
		(code, i, all) => all.indexOf(code) === i
	);

	return {
		// ?add=1 opens the statement dialog on arrival — the same convention the
		// quick-add menu uses for /documents and /salary.
		openAdd: url.searchParams.get('add') === '1',
		// Form values carry the ISO code. Display symbols belong only in labels;
		// sending "Kč" back through the currency input stored a non-currency.
		baseCurrency: base,
		// Every code the rate table knows — the statement editor still offers
		// these, because a statement can be filed in anything.
		currencies,
		// Just the ones this record is actually about, for the display toggle.
		displayCurrencies,
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
				const payslips = salaryYearGrossTotalConverted(
					salaryRows,
					s.personId,
					s.year,
					s.currency,
					convert
				);
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
					attachments: s.attachments,
					note: s.note,
					diverges
				};
			}),
		prefs,
		countries: [...hues.entries()]
			.map(([code, token]) => ({ code, name: countryName(code), token }))
			.sort((a, b) => a.code.localeCompare(b.code)),
		blendedRatePct: blendedRatePct(years),
		// A filing below this is too small to be a full year, and the matrix says
		// so. Derived from the record rather than fixed, so it cannot go stale.
		flaggedThreshold: flaggedThresholdMinor(years).toString(),
		// bigint does not survive serialisation, so every figure crosses as a
		// string and the screen formats it — the same contract `statements` has
		// always had.
		years: years.map((y) => ({
			year: y.year,
			grossMinor: y.grossMinor.toString(),
			taxMinor: y.taxMinor.toString(),
			ratePct: y.ratePct,
			byCountry: y.byCountry.map((c) => ({
				country: c.country,
				grossMinor: c.grossMinor.toString(),
				taxMinor: c.taxMinor.toString(),
				ratePct: c.ratePct,
				native: c.native.map((n) => ({
					currency: n.currency,
					grossMinor: n.grossMinor.toString(),
					taxMinor: n.taxMinor.toString()
				}))
			}))
		}))
	};
};

/**
 * Save every file the form carried, or none of them.
 *
 * One kind per batch: three broker PDFs at once is one action, a mixed batch is
 * two. If any upload throws, the ones already on the volume go with it — a
 * half-saved batch nothing points at is litter no screen ever shows.
 */
async function takeUploads(
	form: FormData
): Promise<{ attachments: StatementAttachment[] } | { message: string }> {
	const kind = attachmentKind(String(form.get('fileKind') ?? 'statement')).key;
	const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
	const addedOn = new Date().toISOString().slice(0, 10);

	const attachments: StatementAttachment[] = [];
	for (const file of files) {
		try {
			attachments.push({
				storedName: await saveUpload(file),
				ext: extname(file.name).replace('.', '').toUpperCase() || 'PDF',
				addedOn,
				kind,
				original: file.name
			});
		} catch (err) {
			await discardUploads(attachments);
			return { message: err instanceof Error ? err.message : 'Upload failed.' };
		}
	}
	return { attachments };
}

/** Unlink a batch of just-saved uploads after the write they belonged to failed. */
async function discardUploads(attachments: StatementAttachment[]): Promise<void> {
	await Promise.all(attachments.map((a) => removeUpload(a.storedName)));
}

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

		// A statement brings its paperwork with it: every file chosen here becomes
		// a document on the Tax shelf, filed against the same person, and linked
		// to the statement. Before this, attaching anything meant leaving the
		// screen, filing the document elsewhere, and coming back — and only one
		// document could be attached at all, though a year's filing is several.
		const uploaded = await takeUploads(form);
		if ('message' in uploaded) return fail(400, { message: uploaded.message });
		const { attachments } = uploaded;

		// The files are on the volume before the rows are, so every way out of the
		// save that does not commit the statement takes ALL of them with it —
		// refusal and failure alike. An upload nothing points at is invisible
		// litter, and half a batch of it is worse than none.
		let result;
		try {
			result = await saveStatement({
				personId: asRowId(form.get('personId')),
				year: Number(form.get('year')),
				country: String(form.get('country') ?? ''),
				currency,
				grossIncomeMinor: gross,
				taxPaidMinor: taxPaid,
				note: String(form.get('note') ?? '').trim() || null,
				lines,
				attachments,
				// Optional: a document already on the shelf is linked, not re-filed.
				linkDocumentIds: [asOptionalRowId(form.get('documentId'))].filter((id): id is string =>
					Boolean(id)
				)
			});
		} catch (err) {
			await discardUploads(attachments);
			throw err;
		}
		if (!result.ok) {
			await discardUploads(attachments);
			return fail(result.status, { message: result.message });
		}
		return { ok: true };
	},

	/**
	 * Add files to a statement that already exists.
	 *
	 * Same filing rules as the dialog's own upload, because both go through the
	 * domain — the two cannot drift into naming or tagging things differently.
	 */
	attach: async ({ request }) => {
		const form = await request.formData();
		const statementId = asRowId(form.get('id'));

		const [statement] = await db
			.select({
				personId: taxStatement.personId,
				year: taxStatement.year,
				country: taxStatement.country
			})
			.from(taxStatement)
			.where(eq(taxStatement.id, statementId));
		if (!statement) return fail(404, { message: 'That statement is no longer there.' });

		const uploaded = await takeUploads(form);
		if ('message' in uploaded) return fail(400, { message: uploaded.message });
		const { attachments } = uploaded;
		if (attachments.length === 0) return fail(400, { message: 'Choose a file to attach.' });

		try {
			await db.transaction((tx) =>
				attachDocumentsToStatement(
					statementId,
					statement.personId,
					statement.year,
					statement.country,
					attachments,
					tx
				)
			);
		} catch (err) {
			await discardUploads(attachments);
			throw err;
		}
		return { ok: true };
	},

	/**
	 * Unlink. The document stays on the Tax shelf, still filed against the
	 * person — only the connection to this statement goes.
	 */
	detach: async ({ request }) => {
		const form = await request.formData();
		const outcome = await detachDocument(asRowId(form.get('id')), asRowId(form.get('documentId')));
		if (!outcome.ok) return fail(404, { message: 'That document is no longer attached.' });
		return { ok: true };
	},

	/**
	 * Delete the document itself, and the file behind it.
	 *
	 * Deliberately a different action from detach: this destroys filed
	 * paperwork, which is why the screen arms it twice before it fires.
	 */
	deleteAttachment: async ({ request }) => {
		const form = await request.formData();
		const outcome = await deleteDocument(asRowId(form.get('documentId')));
		if (!outcome.ok) return fail(404, { message: 'That document is no longer there.' });
		return { ok: true };
	},

	remove: async ({ request }) => {
		const form = await request.formData();
		await deleteStatement(asRowId(form.get('id')));
		return { ok: true };
	}
};
