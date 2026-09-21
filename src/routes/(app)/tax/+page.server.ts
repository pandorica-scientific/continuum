// SPDX-License-Identifier: AGPL-3.0-or-later
import { asOptionalRowId, asRowId } from '$lib/ids';
import { isEnumValue } from '$lib/enums';
import { extname } from 'node:path';
import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { mayActFor } from '$lib/server/auth/policy';
import { document, documentLink, person, salaryEntry, taxStatement } from '$lib/server/db/schema';
import {
	attachDocumentsToStatement,
	deleteStatement,
	loadStatements,
	saveStatement,
	type StatementAttachment
} from '$lib/server/tax';
import { detachDocument } from '$lib/server/documents/targets';
import { removeDocument } from '$lib/server/documents/lifecycle';
import { enqueueExtraction } from '$lib/server/documents/extract/queue';
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
import { removeUpload, saveUploadAndHash } from '$lib/server/system/files';
import { foldCountry } from '$lib/countries';
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
			// Salary entries, not payslip documents: the document carries no figure
			// of its own, so gross must come from the salary row.
			db
				.select({
					personId: salaryEntry.personId,
					periodMonth: salaryEntry.periodMonth,
					grossMinor: salaryEntry.grossMinor,
					currency: salaryEntry.currency
				})
				.from(salaryEntry),
			// What "link an existing document" may offer.
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

	// Prefill totals, computed at display time (never stored, so it cannot go stale).
	// Only years with a GROSS figure — a bank-credit-only year is after-tax, not a declared statement.
	const payslipYears = [
		...new Set(
			salaryRows.filter((r) => r.grossMinor !== null).map((r) => Number(r.periodMonth.slice(0, 4)))
		)
	];
	/*
	 * Keyed by currency as well as person and year.
	 *
	 * The figure is dropped into a form whose currency field the filer can
	 * change, and it used to be computed in the household's own currency and
	 * nothing else — so choosing CZK on a Czech statement put a EUR number in
	 * the box under a CZK label. That is not a display preference, it is a wrong
	 * number in a tax return.
	 *
	 * Computed for every currency the form OFFERS, so the box is never blank
	 * merely because nobody has filed in that currency before — filing a Polish
	 * statement for a year of Czech income is exactly when a converted figure is
	 * wanted. The currencies the income is already in cost nothing to include
	 * and convert nothing at all: a year of Czech payslips read in CZK is the
	 * sum of what the payslips said, not a round trip through the base currency
	 * and back.
	 *
	 * A few hundred small sums, none of which touches the database.
	 */
	const prefillCurrencies = [
		...new Set([base, ...currencies, ...salaryRows.map((r) => r.currency)])
	];
	const prefillTotals: Record<string, { amount: string; months: number }> = {};
	for (const p of people) {
		for (const year of payslipYears) {
			for (const code of prefillCurrencies) {
				const t = salaryYearGrossTotalConverted(salaryRows, p.id, year, code, convert);
				if (t.months > 0)
					prefillTotals[`${p.id}|${year}|${code}`] = {
						amount: formatMinor(t.totalMinor, code),
						months: t.months
					};
			}
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

	// The household's own currency, plus the ones actually filed in — not
	// availableCurrencies(), which is every code the rate table quotes.
	// Payslip currencies count too: a year of Czech income is worth reading in
	// CZK before any statement has been filed for it, and that is exactly when
	// the screen is used.
	const displayCurrencies = [
		base,
		...statements.map((s) => s.currency),
		...salaryRows.map((r) => r.currency)
	].filter((code, i, all) => all.indexOf(code) === i);

	return {
		// ?add=1 opens the statement dialog on arrival — the same convention the
		// quick-add menu uses for /documents and /salary.
		openAdd: url.searchParams.get('add') === '1',
		// `&year=&country=` opens it on the year an obligation elsewhere is
		// complaining about, so "Add the 2024 return" lands on the 2024 form
		// rather than on a blank one the reader has to fill in again.
		addDefaults: {
			year: Number(url.searchParams.get('year')) || null,
			country: (url.searchParams.get('country') ?? '').trim().toUpperCase() || null
		},
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
		// Draws the lock on a restricted attachment, on the card each statement's
		// paperwork renders through. Never what decides which rows it is handed.
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
					role: s.role,
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
 * Save every file the form carried, or none of them. If any upload throws,
 * the ones already on the volume are removed too — a half-saved batch is litter.
 */
async function takeUploads(
	form: FormData
): Promise<{ attachments: StatementAttachment[] } | { message: string }> {
	/*
	 * One kind per file, paired by position.
	 *
	 * A year's filing is several papers and they are rarely the same paper: the
	 * statement, the employer's earnings report, the broker's. One kind for the
	 * whole batch meant either a mixed batch saved twice or — what actually
	 * happened — every document filed under whatever the first one was.
	 *
	 * Paired against the UNFILTERED list so an empty file picked by accident
	 * cannot shift every kind after it onto the wrong document. A form sending a
	 * single kind (or none) still works: every file falls back to it.
	 */
	const picked = form.getAll('file').filter((f): f is File => f instanceof File);
	const kinds = form.getAll('fileKind').map((v) => attachmentKind(String(v)).key);
	// Same pairing for the country each paper came from. Blank means "the
	// statement's own", so a filing whose papers are all from one place carries
	// nothing extra.
	const countries = form.getAll('fileCountry').map((v) => String(v).trim().toUpperCase());
	// A code or blank, nothing else: the document's country column refuses
	// prose, and it would do so as a 500 after the files were already saved.
	if (countries.some((c) => c !== '' && !foldCountry(c)))
		return { message: "Name each paper's country as a two-letter code, like CZ." };
	const addedOn = new Date().toISOString().slice(0, 10);

	const attachments: StatementAttachment[] = [];
	for (const [index, file] of picked.entries()) {
		if (file.size === 0) continue;
		const kind = kinds[index] ?? kinds[0] ?? 'statement';
		const from = countries[index] ?? countries[0] ?? '';
		try {
			const { storedName, contentHash } = await saveUploadAndHash(file);
			attachments.push({
				storedName,
				ext: extname(file.name).replace('.', '').toUpperCase() || 'PDF',
				addedOn,
				kind,
				...(from ? { country: from } : {}),
				original: file.name,
				contentHash
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

const NOT_YOUR_STATEMENT = 'You can only file your own tax statements.';

/**
 * The statement an action names, if the signed-in person may act on it. The
 * owning person is read from the row, not trusted from the form.
 */
async function statementFor(
	statementId: string,
	actor: App.Locals['person']
): Promise<
	| { ok: true; statement: { id: string; personId: string; year: number; country: string } }
	| { ok: false; status: 403 | 404; message: string }
> {
	const [statement] = await db
		.select({
			id: taxStatement.id,
			personId: taxStatement.personId,
			year: taxStatement.year,
			country: taxStatement.country
		})
		.from(taxStatement)
		.where(eq(taxStatement.id, statementId));
	if (!statement) return { ok: false, status: 404, message: 'That statement is no longer there.' };
	if (!mayActFor(actor, statement.personId)) {
		return { ok: false, status: 403, message: NOT_YOUR_STATEMENT };
	}
	return { ok: true, statement };
}

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const form = await request.formData();
		// Whose statement this is comes from the form for a new one, so the check
		// is on the form value — before any parsing, and before any upload lands.
		const personId = asRowId(form.get('personId'));
		if (!mayActFor(locals.person, personId)) {
			return fail(403, { message: NOT_YOUR_STATEMENT });
		}
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
		// a document on the Finance shelf, filed against the same person, and
		// linked to the statement.
		const uploaded = await takeUploads(form);
		if ('message' in uploaded) return fail(400, { message: uploaded.message });
		const { attachments } = uploaded;

		// Files land on the volume before the rows do, so any failure to commit takes all of them with it.
		let result;
		try {
			result = await saveStatement({
				personId,
				year: Number(form.get('year')),
				country: String(form.get('country') ?? ''),
				currency,
				grossIncomeMinor: gross,
				taxPaidMinor: taxPaid,
				// Blank stays blank: an unclassified statement proves nothing about
				// residence, which is the honest state until somebody says.
				role: isEnumValue('tax_statement.role', form.get('role'))
					? (form.get('role') as 'residence' | 'source')
					: null,
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
		// A duplicate inside the form is not reported — saving the statement is the
		// point — but its bytes are already on the volume with nothing pointing at
		// them, so they go the same way a refused upload's would.
		await discardUploads(attachments.filter((a) => result.skipped?.includes(a.storedName)));
		return { ok: true };
	},

	/** Add files to a statement that already exists — same filing rules as the dialog's own upload. */
	attach: async ({ request, locals }) => {
		const form = await request.formData();
		const statementId = asRowId(form.get('id'));

		const found = await statementFor(statementId, locals.person);
		if (!found.ok) return fail(found.status, { message: found.message });
		const { statement } = found;
		// A statement filed before countries were codes cannot take paper: its
		// documents would carry its country, and that column refuses prose.
		if (!foldCountry(statement.country))
			return fail(400, {
				message:
					"Set this statement's country to a two-letter code, like CZ, before filing paper under it."
			});

		const uploaded = await takeUploads(form);
		if ('message' in uploaded) return fail(400, { message: uploaded.message });
		const { attachments } = uploaded;
		if (attachments.length === 0) return fail(400, { message: 'Choose a file to attach.' });

		let filed: Awaited<ReturnType<typeof attachDocumentsToStatement>>;
		try {
			filed = await db.transaction((tx) =>
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
		// A skipped upload's bytes reached the volume before this ran and nothing
		// points at them now. Discarded here rather than left behind, because the
		// document they duplicate is already keeping a copy.
		await discardUploads(
			attachments.filter((a) => filed.skipped.some((s) => s.storedName === a.storedName))
		);
		// After the commit, never inside it: a queued job pointing at a document
		// the transaction went on to roll back is work with nothing to read.
		for (const documentId of filed.filedIds) await enqueueExtraction(documentId);
		if (filed.skipped.length > 0) {
			const names = [...new Set(filed.skipped.map((s) => s.existingName))].join(', ');
			return { ok: true, message: `Already filed here: ${names}.` };
		}
		return { ok: true };
	},

	/** Unlink only; the document stays filed. `DocumentsCard` posts `targetId`, not `id`. */
	detach: async ({ request, locals }) => {
		const form = await request.formData();
		const statementId = asRowId(form.get('targetId'));
		const found = await statementFor(statementId, locals.person);
		if (!found.ok) return fail(found.status, { message: found.message });
		// The registry's own detach, shared with every other card — not a local copy.
		const outcome = await detachDocument(statementId, asRowId(form.get('documentId')));
		if (!outcome.ok) return fail(outcome.status, { message: outcome.message });
		return { ok: true };
	},

	/**
	 * Delete the document itself, and the file behind it — destroys filed
	 * paperwork, unlike detach. Routed through `removeDocument` rather than a
	 * plain row delete: a tax attachment can be a payslip, and a direct delete
	 * would leave `salary_entry.document_id` SET NULL, an orphaned row still
	 * counted in a year's total.
	 */
	deleteAttachment: async ({ request, locals }) => {
		const form = await request.formData();
		const documentId = asRowId(form.get('documentId'));
		// The document names no person of its own; the statements it is linked
		// to do. Every one of them has to be the actor's to touch — paper shared
		// between two people's returns is not one person's to destroy.
		const linked = await db
			.select({ personId: taxStatement.personId })
			.from(documentLink)
			.innerJoin(taxStatement, eq(taxStatement.id, documentLink.targetId))
			.where(eq(documentLink.documentId, documentId));
		if (linked.length === 0) return fail(404, { message: 'That document is no longer there.' });
		if (!linked.every((row) => mayActFor(locals.person, row.personId))) {
			return fail(403, { message: NOT_YOUR_STATEMENT });
		}
		const outcome = await removeDocument(documentId);
		if (!outcome.ok) return fail(outcome.status, { message: outcome.message });
		return { ok: true };
	},

	remove: async ({ request, locals }) => {
		const form = await request.formData();
		const found = await statementFor(asRowId(form.get('id')), locals.person);
		if (!found.ok) return fail(found.status, { message: found.message });
		await deleteStatement(found.statement.id);
		return { ok: true };
	}
};
