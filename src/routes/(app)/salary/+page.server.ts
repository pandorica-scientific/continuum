// SPDX-License-Identifier: AGPL-3.0-or-later
import { asRowId } from '$lib/ids';
import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { mayActFor } from '$lib/server/auth/policy';
import {
	createGrant,
	engagementOwner,
	forfeitPending,
	grantOwner,
	grantsWithTranches,
	parseSchedule,
	recordSale,
	recordSettlement,
	replaceSchedule,
	trancheOwner
} from '$lib/server/equity';
import { engagement, organisation, person, salaryEntry } from '$lib/server/db/schema';
import {
	learnBonusLabel,
	learnGrossLabel,
	learnNetLabel,
	learnPayslipCurrency,
	entryWithOwner,
	filePayslipDocument,
	loadSalaryHistory,
	vestValues,
	payslipMatchingContent,
	payslipStatementsFor,
	readPayslip,
	readStoredPayslip,
	recordSalary,
	slipDocument
} from '$lib/server/salary';
import { removeDocument } from '$lib/server/documents/lifecycle';
import { mergeSalaryYears, type SalaryYear } from '$lib/salary';
import { getBaseCurrency } from '$lib/server/settings';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { hashBytes, removeUpload, saveUploadBytes } from '$lib/server/system/files';
import { displayCurrency, formatMinor, parseAmountToMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

/** bigint does not survive serialisation; every figure crosses as a string and
 *  the screen formats it, the same contract the Tax screen uses. */
function serialiseYear(y: SalaryYear) {
	return {
		year: y.year,
		age: y.age,
		grossAvgMinor: y.grossAvgMinor?.toString() ?? null,
		netAvgMinor: y.netAvgMinor?.toString() ?? null,
		grossTotalMinor: y.grossTotalMinor.toString(),
		baseTotalMinor: y.baseTotalMinor.toString(),
		bonusTotalMinor: y.bonusTotalMinor.toString(),
		netTotalMinor: y.netTotalMinor.toString(),
		equityTotalMinor: y.equityTotalMinor.toString(),
		equityOnPayslipMinor: y.equityOnPayslipMinor.toString(),
		grossMonths: y.grossMonths,
		netMonths: y.netMonths,
		netComplete: y.netComplete,
		deltaPct: y.deltaPct,
		baseDeltaPct: y.baseDeltaPct
	};
}

export const load: PageServerLoad = async ({ url }) => {
	const [baseCurrency, rates, currencies] = await Promise.all([
		getBaseCurrency(),
		loadRateTable(),
		availableCurrencies()
	]);
	const convert = (amount: bigint, from: string, to: string, day: string) =>
		convertOrFace(rates, amount, from, to, day);

	// A member gets every month/figure; slips they may not see arrive with no file behind them.
	const vests = await vestValues(baseCurrency, convert);
	const history = await loadSalaryHistory(baseCurrency, convert, db, vests);

	// For the grant dialog: jobs a grant can hang off, plus grants already recorded.
	const [engagements, grantRows] = await Promise.all([
		db
			.select({
				id: engagement.id,
				personId: engagement.personId,
				employer: organisation.name,
				role: engagement.role,
				endsOn: engagement.endsOn
			})
			.from(engagement)
			.innerJoin(organisation, eq(organisation.id, engagement.organisationId)),
		grantsWithTranches()
	]);
	const grants = grantRows.map(({ grant, tranches }) => ({
		id: grant.id,
		personId: grant.personId,
		ticker: grant.ticker,
		label: grant.label,
		totalUnits: grant.totalUnits,
		currency: grant.currency,
		vestYears: [...new Set(tranches.map((t) => Number((t.settledOn ?? t.vestsOn).slice(0, 4))))]
	}));

	// Computed here, not in markup: merging must sum totals, not average the per-person averages.
	const household = mergeSalaryYears(history.map((p) => p.years));

	return {
		// ?add=1 opens the upload form on arrival, same convention as /documents.
		openAdd: url.searchParams.get('add') === '1',
		openGrant: url.searchParams.get('add') === 'grant',
		engagements,
		grants,
		baseCurrency,
		// A payslip's own currency need not match the household's base (reporting) currency.
		currencies,
		people: history.map((p) => ({ id: p.id, name: p.name })),
		household: household.map(serialiseYear),
		history: history.map((p) => ({
			id: p.id,
			name: p.name,
			years: p.years.map(serialiseYear),
			payslips: p.payslips.map((s) => ({
				id: s.id,
				periodMonth: s.periodMonth,
				// Base = gross minus bonus, computed here so the screen never subtracts formatted strings.
				base:
					s.grossMinor === null
						? null
						: formatMinor(s.grossMinor - (s.bonusMinor ?? 0n), s.currency),
				gross: s.grossMinor === null ? null : formatMinor(s.grossMinor, s.currency),
				net: s.netMinor === null ? null : formatMinor(s.netMinor, s.currency),
				bonus: s.bonusMinor === null ? null : formatMinor(s.bonusMinor, s.currency),
				// currencyCode is separate because the ⋯ menu's select needs the code, not "Kč".
				currency: displayCurrency(s.currency),
				currencyCode: s.currency,
				// Served through the document, so the stored name never reaches the browser.
				documentId: s.documentId,
				fileExt: s.file ? (s.file.split('.').pop() ?? 'pdf').toUpperCase() : null
			}))
		}))
	};
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** One optional money field off the form. Blank is null, not zero. */
function optionalAmount(
	form: FormData,
	field: string,
	currency: string
): { ok: true; value: bigint | null } | { ok: false; message: string } {
	const raw = String(form.get(field) ?? '').trim();
	if (!raw) return { ok: true, value: null };
	try {
		const value = parseAmountToMinor(raw, currency);
		if (value < 0n) return { ok: false, message: `The ${field} cannot be negative.` };
		return { ok: true, value };
	} catch {
		return { ok: false, message: `The ${field} must be a number.` };
	}
}

/** The one sentence a refused payslip upload answers with. */
const NOT_YOUR_PAYSLIP = 'You can only file your own payslips.';
const NOT_YOUR_EQUITY = 'You can only record your own equity.';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A units figure off the form, or a refusal sentence. */
function unitsField(form: FormData, field: string, allowZero = false): number {
	const n = Number(String(form.get(field) ?? '').replace(',', '.'));
	if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) {
		throw new Error(
			`${field} must be a ${allowZero ? 'non-negative' : 'positive'} number of units.`
		);
	}
	return n;
}

function userSentence(err: unknown, fallback: string): string {
	return err instanceof Error ? err.message : fallback;
}

/**
 * Whose payslips this person may file: their own, or anybody's if an admin.
 *
 * `payslipMatchingContent` matches by content hash alone, restricted slips
 * included, so without this gate a member could restate paper they are not
 * allowed to know exists. The check stays here rather than narrowing the
 * match itself, or a member's upload would miss the slip it duplicates and
 * create a second entry reporting double pay.
 */
function mayFilePayslipsFor(actor: App.Locals['person'], personId: string): boolean {
	return mayActFor(actor, personId);
}

export const actions: Actions = {
	addPayslip: async ({ request, locals }) => {
		const form = await request.formData();
		const personId = asRowId(form.get('personId')).trim();
		if (!mayFilePayslipsFor(locals.person, personId)) {
			return fail(403, { message: NOT_YOUR_PAYSLIP });
		}
		const owner = (await db.select().from(person).where(eq(person.id, personId)))[0];
		if (!owner) return fail(400, { message: 'Pick whose payslip this is.' });
		// Learned labels stay keyed by name; the link is by id.
		const subject = owner.name;

		const file = form.get('file');
		let storedName: string | null = null;
		let contentHash: string | null = null;
		let reading = null;
		/**
		 * The slip already filed that IS this file. A month can hold more than one
		 * payslip, so identity is by content bytes, not by month.
		 */
		let sameSlip: { id: string; periodMonth: string | null } | null = null;
		if (file instanceof File && file.size > 0) {
			const data = new Uint8Array(await file.arrayBuffer());
			contentHash = hashBytes(data);
			// Reading the PDF shares no data with the shelf lookup, so run them together.
			[sameSlip, reading] = await Promise.all([
				payslipMatchingContent(personId, contentHash),
				readPayslip(data, subject)
			]);
			// A recognised slip keeps the copy already on the volume rather than duplicating it.
			if (!sameSlip) {
				try {
					storedName = await saveUploadBytes(data, file.name);
				} catch (err) {
					return fail(400, { message: err instanceof Error ? err.message : 'Upload failed.' });
				}
			}
		}

		// Which fields the person actually edited — a reader-filled prefill is
		// still a reading, not a decision, and should not teach the reader itself.
		const touched = new Set(
			String(form.get('touched') ?? '')
				.split(',')
				.map((f) => f.trim())
				.filter(Boolean)
		);

		const stated = String(form.get('currency') ?? '')
			.trim()
			.toUpperCase();

		// Whatever was typed goes back with the failure so it can be corrected, not retyped
		// (the file itself cannot be handed back — a browser will not repopulate a file input).
		const typedBack = {
			personId,
			gross: String(form.get('gross') ?? ''),
			net: String(form.get('net') ?? ''),
			bonus: String(form.get('bonus') ?? ''),
			periodMonth: String(form.get('periodMonth') ?? ''),
			currency: stated
		};
		const reject = (message: string) => fail(400, { message, values: typedBack, reopen: true });

		// The currency the slip is PRINTED in, not the household's reporting currency.
		// Mandatory, with no fallback: a default would be a guess nobody sees.
		const currencies = await availableCurrencies();
		const currency = stated || reading?.currency || '';
		if (!currency) {
			return reject('Which currency is this payslip in?');
		}
		if (!currencies.includes(currency)) {
			return reject(`${currency} is not a currency this instance can convert.`);
		}

		// Anything typed wins; the reading fills what was left blank.
		const typedGross = optionalAmount(form, 'gross', currency);
		if (!typedGross.ok) return fail(400, { message: typedGross.message });
		const typedNet = optionalAmount(form, 'net', currency);
		if (!typedNet.ok) return fail(400, { message: typedNet.message });
		const typedBonus = optionalAmount(form, 'bonus', currency);
		if (!typedBonus.ok) return fail(400, { message: typedBonus.message });

		const grossMinor = typedGross.value ?? reading?.grossMinor ?? null;
		const netMinor = typedNet.value ?? reading?.netMinor ?? null;
		const bonusMinor = typedBonus.value ?? reading?.bonusMinor ?? null;
		const periodMonth =
			String(form.get('periodMonth') ?? '').trim() || reading?.periodMonth || null;

		if (grossMinor === null && netMinor === null) {
			return reject('Could not read a gross or net figure from the slip — please fill one in.');
		}
		if (!periodMonth || !MONTH.test(periodMonth)) {
			return reject('Which month does this payslip cover?');
		}

		// A currency the person CHOSE teaches the reader for next time. Outside the
		// `if (reading)` block below on purpose: a month with no file still states one.
		if (touched.has('currency')) {
			await learnPayslipCurrency(subject, currency);
		}

		// A figure the person stated teaches the reader; a reader-produced prefill would not.
		if (reading) {
			if (touched.has('gross') && typedGross.value !== null) {
				await learnGrossLabel(subject, typedGross.value, reading.candidates);
			}
			if (touched.has('net') && typedNet.value !== null) {
				await learnNetLabel(subject, typedNet.value, reading.candidates);
			}
			if (touched.has('bonus') && typedBonus.value !== null) {
				await learnBonusLabel(subject, typedBonus.value, reading.candidates);
			}
		}

		// A month worked twice has two payslips, so upload only ever ADDS — never
		// replaces by month, which would throw away the other job's slip.
		const alreadyFiled = sameSlip ? [] : await payslipStatementsFor(personId, periodMonth);

		// A recognised slip's document is reused, not replaced, so `recordSalary`
		// finds its own row by document id and writes over it.
		const documentId = await filePayslipDocument({
			personId,
			subject,
			periodMonth,
			storedName,
			contentHash,
			existingId: sameSlip?.id
		});

		const recorded = await recordSalary({
			personId,
			periodMonth,
			currency,
			// A re-upload restates the currency too, or a corrected currency's digits stay mislabelled.
			restateCurrency: true,
			grossMinor,
			netMinor,
			bonusMinor,
			source: 'payslip',
			documentId,
			// A figure somebody typed is a decision; a reading is not — including a
			// reading this dialog put in the field for them to look at.
			overridden: touched.size > 0
		});
		if (!recorded.ok) {
			// The figures the entry refused come back in the form, READ ones
			// included: "net cannot be more than gross" is unanswerable without
			// seeing which two numbers it meant.
			return fail(recorded.status, {
				message: recorded.message,
				reopen: true,
				values: {
					...typedBack,
					periodMonth,
					currency,
					gross: grossMinor === null ? '' : formatMinor(grossMinor, currency),
					net: netMinor === null ? '' : formatMinor(netMinor, currency),
					bonus: bonusMinor === null ? '' : formatMinor(bonusMinor, currency)
				}
			});
		}

		// Said out loud rather than acted on: a second slip for a month can mean two
		// jobs or a mistaken re-upload — the person decides which.
		return {
			ok: true,
			alsoFiled: alreadyFiled.length > 0 ? { periodMonth, count: alreadyFiled.length } : null,
			sameSlip: sameSlip
				? {
						periodMonth,
						moved: sameSlip.periodMonth !== null && sameSlip.periodMonth !== periodMonth
					}
				: null
		};
	},

	/**
	 * File a year of payslips in one go. Unlike `addPayslip`, nobody checks
	 * twelve slips in a dialog, so this files only what it can read with
	 * confidence and hands back, by name, every file it could not — and nothing
	 * here is stored as a decision, since no figure was looked at.
	 */
	addPayslips: async ({ request, locals }) => {
		const form = await request.formData();
		const personId = asRowId(form.get('personId')).trim();
		if (!mayFilePayslipsFor(locals.person, personId)) {
			return fail(403, { message: NOT_YOUR_PAYSLIP });
		}
		const owner = (await db.select().from(person).where(eq(person.id, personId)))[0];
		if (!owner) return fail(400, { message: 'Pick whose payslips these are.' });
		const subject = owner.name;

		const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
		if (files.length === 0) return fail(400, { message: 'Choose at least one payslip file.' });

		// Fallback for slips that do not name a currency; otherwise the file is refused, not guessed.
		const currencies = await availableCurrencies();
		const fallback = String(form.get('currency') ?? '')
			.trim()
			.toUpperCase();
		if (fallback && !currencies.includes(fallback)) {
			return fail(400, { message: `${fallback} is not a currency this instance can convert.` });
		}

		const filed: { name: string; periodMonth: string }[] = [];
		const skipped: { name: string; reason: string }[] = [];
		/**
		 * Files already on the shelf, listed back rather than filed again. A
		 * separate bucket from `skipped` (which needs the person's help) so eleven
		 * of twelve landing does not read as a failure.
		 */
		const already: { name: string; periodMonth: string | null }[] = [];
		/** Fingerprints filed by THIS run, so one drop of the same file twice is
		 *  caught as well as a second drop weeks later. */
		const seen = new Map<string, string>();

		for (const file of files) {
			const data = new Uint8Array(await file.arrayBuffer());
			const contentHash = hashBytes(data);
			const inThisRun = seen.get(contentHash);
			if (inThisRun !== undefined) {
				already.push({ name: file.name, periodMonth: inThisRun });
				continue;
			}
			const onTheShelf = await payslipMatchingContent(personId, contentHash);
			if (onTheShelf) {
				already.push({ name: file.name, periodMonth: onTheShelf.periodMonth });
				continue;
			}
			let storedName: string;
			try {
				storedName = await saveUploadBytes(data, file.name);
			} catch (err) {
				skipped.push({
					name: file.name,
					reason: err instanceof Error ? err.message : 'could not be stored'
				});
				continue;
			}

			// Every refusal from here on removes the file it just stored, or it would linger unreferenced.
			const refuse = async (reason: string) => {
				await removeUpload(storedName);
				skipped.push({ name: file.name, reason });
			};

			const reading = await readPayslip(data, subject);
			const currency = reading.currency ?? fallback;
			if (!currency) {
				await refuse('names no currency, and none has been stated for this person yet');
				continue;
			}
			if (!reading.periodMonth || !MONTH.test(reading.periodMonth)) {
				await refuse('no month could be read from it');
				continue;
			}
			if (reading.grossMinor === null && reading.netMinor === null) {
				await refuse('no gross or net figure could be read from it');
				continue;
			}

			const periodMonth = reading.periodMonth;
			const documentId = await filePayslipDocument({
				personId,
				subject,
				periodMonth,
				storedName,
				contentHash
			});

			const recorded = await recordSalary({
				personId,
				periodMonth,
				currency,
				restateCurrency: true,
				grossMinor: reading.grossMinor,
				netMinor: reading.netMinor,
				bonusMinor: reading.bonusMinor,
				source: 'payslip',
				documentId
				// `overridden` stays false: nobody looked at these figures.
			});
			if (!recorded.ok) {
				// Rollback of the just-made document, via the same removal path as any
				// other deletion in case a half-successful re-upload left a row behind.
				await removeDocument(documentId);
				skipped.push({ name: file.name, reason: recorded.message.toLowerCase() });
				continue;
			}
			filed.push({ name: file.name, periodMonth });
			seen.set(contentHash, periodMonth);
		}

		return { ok: true, filed, skipped, already };
	},

	/** Correct one figure of one month. */
	setPayslipFigure: async ({ request }) => {
		const form = await request.formData();
		const field = String(form.get('field') ?? '');
		if (field !== 'gross' && field !== 'net' && field !== 'base') {
			return fail(400, { message: 'That is not a figure this can set.' });
		}

		const found = await entryWithOwner(asRowId(form.get('entryId')));
		if (!found) return fail(404, { message: 'That payslip is no longer here.' });
		const { entry, owner } = found;
		const { personId, periodMonth, currency } = entry;

		const parsed = optionalAmount(form, 'amount', currency);
		if (!parsed.ok) return fail(400, { message: parsed.message });
		if (parsed.value === null || parsed.value <= 0n) {
			return fail(400, { message: 'The amount must be a positive number.' });
		}

		// Base is gross minus bonus, so setting it writes gross and leaves the bonus
		// alone: correcting an award is the separate bonus field.
		let grossMinor: bigint | null = null;
		if (field === 'gross') grossMinor = parsed.value;
		if (field === 'base') grossMinor = parsed.value + (entry.bonusMinor ?? 0n);

		const recorded = await recordSalary({
			personId,
			periodMonth,
			entryId: entry.id,
			currency,
			grossMinor,
			netMinor: field === 'net' ? parsed.value : null,
			source: 'manual',
			overridden: true
		});
		if (!recorded.ok) return fail(recorded.status, { message: recorded.message });

		// A correction against this month's stored slip teaches the reader. Base is
		// excluded: no line on the slip prints gross-minus-bonus directly.
		const slip = entry.documentId ? await slipDocument(entry.documentId) : null;
		if (slip?.storedName && field !== 'base') {
			const reading = await readStoredPayslip(slip.storedName, owner.name);
			if (field === 'gross') await learnGrossLabel(owner.name, parsed.value, reading.candidates);
			else await learnNetLabel(owner.name, parsed.value, reading.candidates);
		}
		return { ok: true };
	},

	/**
	 * Correct which currency a month was paid in — a relabel, never a
	 * conversion. The digits on the slip are the only true thing on the row;
	 * multiplying them by a rate would destroy that.
	 */
	setPayslipCurrency: async ({ request }) => {
		const form = await request.formData();
		const currency = String(form.get('currency') ?? '')
			.trim()
			.toUpperCase();
		if (!currency) return fail(400, { message: 'Pick a currency.' });
		if (!(await availableCurrencies()).includes(currency)) {
			return fail(400, { message: `${currency} is not a currency this instance can convert.` });
		}

		const found = await entryWithOwner(asRowId(form.get('entryId')));
		if (!found) return fail(404, { message: 'That payslip is no longer here.' });
		const { entry, owner } = found;

		// The entry is the only place a payslip's currency lives, so this is one write.
		await db.update(salaryEntry).set({ currency }).where(eq(salaryEntry.id, entry.id));

		// Teach the reader too, so the next upload does not ask the same question again.
		await learnPayslipCurrency(owner.name, currency);
		return { ok: true };
	},

	/**
	 * Correct what of a month was a bonus. Stored on the salary entry, not the
	 * document — a month can be evidenced by both a payslip and a bank credit.
	 * An empty field clears it to "the slip did not say", not zero.
	 */
	setBonus: async ({ request }) => {
		const form = await request.formData();
		const found = await entryWithOwner(asRowId(form.get('entryId')));
		if (!found) return fail(404, { message: 'That payslip is no longer here.' });
		const { entry, owner } = found;

		const parsed = optionalAmount(form, 'bonus', entry.currency);
		if (!parsed.ok) return fail(400, { message: parsed.message });

		const recorded = await recordSalary({
			personId: entry.personId,
			periodMonth: entry.periodMonth,
			entryId: entry.id,
			currency: entry.currency,
			bonusMinor: parsed.value,
			source: 'manual',
			overridden: true
		});
		if (!recorded.ok) return fail(recorded.status, { message: recorded.message });

		// This statement's own slip specifically, not any document linked to this person.
		if (parsed.value !== null) {
			const slip = entry.documentId ? await slipDocument(entry.documentId) : null;
			if (slip?.storedName) {
				const reading = await readStoredPayslip(slip.storedName, owner.name);
				await learnBonusLabel(owner.name, parsed.value, reading.candidates);
			}
		}
		return { ok: true };
	},

	/**
	 * Remove a payslip and the month it evidenced. A merged bank credit reverts
	 * to its credit-only row rather than being deleted too. Goes through
	 * `removeDocument` (row + document in one transaction) or the FK's SET NULL
	 * would leave a second unclaimed row that the partial unique index refuses.
	 */
	deletePayslip: async ({ request }) => {
		const form = await request.formData();
		const found = await entryWithOwner(asRowId(form.get('entryId')));
		if (!found) return fail(404, { message: 'That payslip is no longer here.' });
		const { entry } = found;

		if (entry.documentId) {
			// Keyed to the document, not the month, so a month worked twice keeps its other job.
			const outcome = await removeDocument(entry.documentId);
			if (!outcome.ok) return fail(outcome.status, { message: outcome.message });
			return { ok: true };
		}
		await db.delete(salaryEntry).where(eq(salaryEntry.id, entry.id));
		return { ok: true };
	},

	// ---- Equity grants. Same ownership rule as payslips: the person the grant
	// is for is stated in the form for a new one and read from the row after.

	addGrant: async ({ request, locals }) => {
		const form = await request.formData();
		const personId = asRowId(form.get('personId')).trim();
		if (!mayActFor(locals.person, personId)) return fail(403, { message: NOT_YOUR_EQUITY });
		const currency = String(form.get('currency') ?? '').toUpperCase();
		if (!(await availableCurrencies()).includes(currency)) {
			return fail(400, { message: `${currency} is not a currency this instance can convert.` });
		}
		const grantedOn = String(form.get('grantedOn') ?? '');
		if (!ISO_DATE.test(grantedOn)) return fail(400, { message: 'Pick the grant date.' });
		try {
			const engagementId = form.get('engagementId') ? asRowId(form.get('engagementId')) : null;
			if (engagementId && (await engagementOwner(engagementId)) !== personId) {
				return fail(400, { message: 'That job belongs to somebody else.' });
			}
			await createGrant({
				personId,
				engagementId,
				ticker: String(form.get('ticker') ?? ''),
				currency,
				grantedOn,
				totalUnits: unitsField(form, 'totalUnits'),
				label: String(form.get('label') ?? '').trim() || null,
				documentId: null,
				note: String(form.get('note') ?? '').trim() || null,
				schedule: parseSchedule(form)
			});
		} catch (err) {
			return fail(400, { message: userSentence(err, 'That grant did not save.') });
		}
		return { ok: true };
	},

	editSchedule: async ({ request, locals }) => {
		const form = await request.formData();
		const grantId = asRowId(form.get('grantId'));
		const owner = await grantOwner(grantId);
		if (!owner) return fail(404, { message: 'That grant is no longer here.' });
		if (!mayActFor(locals.person, owner)) return fail(403, { message: NOT_YOUR_EQUITY });
		try {
			await replaceSchedule(grantId, unitsField(form, 'totalUnits'), parseSchedule(form));
		} catch (err) {
			return fail(400, { message: userSentence(err, 'That schedule did not save.') });
		}
		return { ok: true };
	},

	recordSettlement: async ({ request, locals }) => {
		const form = await request.formData();
		const trancheId = asRowId(form.get('trancheId'));
		const owner = await trancheOwner(trancheId);
		if (!owner) return fail(404, { message: 'That tranche is no longer here.' });
		if (!mayActFor(locals.person, owner)) return fail(403, { message: NOT_YOUR_EQUITY });
		const settledOn = String(form.get('settledOn') ?? '');
		if (!ISO_DATE.test(settledOn)) return fail(400, { message: 'Pick the settlement date.' });
		try {
			await recordSettlement(trancheId, {
				settledOn,
				deliveredUnits: unitsField(form, 'deliveredUnits', true),
				withheldUnits: unitsField(form, 'withheldUnits', true),
				onPayslip: form.get('onPayslip') === 'on'
			});
		} catch (err) {
			return fail(400, { message: userSentence(err, 'That settlement did not save.') });
		}
		return { ok: true };
	},

	recordSale: async ({ request, locals }) => {
		const form = await request.formData();
		const trancheId = asRowId(form.get('trancheId'));
		const owner = await trancheOwner(trancheId);
		if (!owner) return fail(404, { message: 'That tranche is no longer here.' });
		if (!mayActFor(locals.person, owner)) return fail(403, { message: NOT_YOUR_EQUITY });
		try {
			await recordSale(trancheId, unitsField(form, 'soldUnits'));
		} catch (err) {
			return fail(400, { message: userSentence(err, 'That sale did not save.') });
		}
		return { ok: true };
	},

	forfeitGrant: async ({ request, locals }) => {
		const form = await request.formData();
		const grantId = asRowId(form.get('grantId'));
		const owner = await grantOwner(grantId);
		if (!owner) return fail(404, { message: 'That grant is no longer here.' });
		if (!mayActFor(locals.person, owner)) return fail(403, { message: NOT_YOUR_EQUITY });
		const forfeitedOn = String(form.get('forfeitedOn') ?? '');
		if (!ISO_DATE.test(forfeitedOn)) return fail(400, { message: 'Pick the leaving date.' });
		const count = await forfeitPending(grantId, forfeitedOn);
		return { ok: true, forfeited: count };
	}
};
