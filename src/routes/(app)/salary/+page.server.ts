// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Salary: what was earned each month, and the payslips it was read from.
//
// Moved out of Retirement in v0.4.4. It sat beside a projection that never read
// it, and "what did I earn" is a Money question — it now lives one tab from the
// Tax screen that asks what was paid on it.
import { asRowId } from '$lib/ids';
import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { document, person, salaryEntry } from '$lib/server/db/schema';
import {
	learnBonusLabel,
	learnGrossLabel,
	learnNetLabel,
	learnPayslipCurrency,
	entryWithOwner,
	filePayslipDocument,
	loadSalaryHistory,
	payslipMatchingContent,
	payslipStatementsFor,
	readPayslip,
	readStoredPayslip,
	recordSalary,
	slipDocument
} from '$lib/server/salary';
import { deleteDocument } from '$lib/server/documents/mutations';
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

	const history = await loadSalaryHistory(baseCurrency, convert);

	// The household series, computed here rather than in the screen: merging
	// TOTALS is the only honest way to it, and doing that in markup invites the
	// shortcut of averaging the per-person averages.
	const household = mergeSalaryYears(history.map((p) => p.years));

	return {
		// ?add=1 opens the upload form on arrival — the convention the quick-add
		// menu already uses for /documents. A shortcut that lands you on a screen
		// you then have to find a button on is half a shortcut.
		openAdd: url.searchParams.get('add') === '1',
		baseCurrency,
		// Every currency the app can convert. A payslip states its own currency —
		// the household's base is where it is REPORTED, not what it was paid in —
		// so the dialog has to be able to offer any of them.
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
				// Each figure names itself. A number on this screen with no stated
				// kind is the whole defect v0.4.6 exists to remove.
				// Base is gross with the award taken out, the same split the year rows
				// draw. Computed here rather than in markup so the screen never has
				// to subtract two formatted strings.
				base:
					s.grossMinor === null
						? null
						: formatMinor(s.grossMinor - (s.bonusMinor ?? 0n), s.currency),
				gross: s.grossMinor === null ? null : formatMinor(s.grossMinor, s.currency),
				net: s.netMinor === null ? null : formatMinor(s.netMinor, s.currency),
				bonus: s.bonusMinor === null ? null : formatMinor(s.bonusMinor, s.currency),
				// The symbol goes beside every figure on the row, the way the Tax
				// screen prints a statement's. The code travels alongside it because
				// the ⋯ menu's currency select has to send back a currency, and "Kč"
				// is not one.
				currency: displayCurrency(s.currency),
				currencyCode: s.currency,
				// The document, and the extension the overlay needs: the file is
				// served through the document now, so the stored name never has to
				// reach the browser.
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

export const actions: Actions = {
	addPayslip: async ({ request }) => {
		const form = await request.formData();
		const personId = asRowId(form.get('personId')).trim();
		const owner = (await db.select().from(person).where(eq(person.id, personId)))[0];
		if (!owner) return fail(400, { message: 'Pick whose payslip this is.' });
		// The reader's learned labels stay keyed by name; the link is by id.
		const subject = owner.name;

		const file = form.get('file');
		let storedName: string | null = null;
		let contentHash: string | null = null;
		let reading = null;
		/**
		 * The slip already filed that IS this file.
		 *
		 * A month may hold more than one payslip since v0.5.5, so nothing keyed on
		 * the month catches a re-upload any more — the same file dropped in twice
		 * made two documents, two entries and a month reporting double pay. The
		 * bytes are what recognise it; two jobs paying alike are still two slips.
		 */
		let sameSlip: { id: string; periodMonth: string | null } | null = null;
		if (file instanceof File && file.size > 0) {
			const data = new Uint8Array(await file.arrayBuffer());
			contentHash = hashBytes(data);
			// Reading the PDF is the long pole of this request and it shares no
			// data with the shelf lookup, so neither waits for the other. Only the
			// save below depends on the answer.
			[sameSlip, reading] = await Promise.all([
				payslipMatchingContent(personId, contentHash),
				readPayslip(data, subject)
			]);
			// A recognised slip keeps the copy already on the volume. Saving a
			// second identical file would leave the first orphaned by whichever
			// document lost the race, and there is nothing in it that the stored
			// one does not already have.
			if (!sameSlip) {
				try {
					storedName = await saveUploadBytes(data, file.name);
				} catch (err) {
					return fail(400, { message: err instanceof Error ? err.message : 'Upload failed.' });
				}
			}
		}

		// Which fields the person actually EDITED.
		//
		// The dialog prefills gross, net and bonus from a read of the same file so
		// they can be checked before anything is written — but a figure that
		// arrived that way is still a reading, not a decision. Without this every
		// prefill would be stored as a hand-correction, immune to later re-reads,
		// and would teach the reader a label nobody chose.
		const touched = new Set(
			String(form.get('touched') ?? '')
				.split(',')
				.map((f) => f.trim())
				.filter(Boolean)
		);

		const stated = String(form.get('currency') ?? '')
			.trim()
			.toUpperCase();

		// Whatever was typed goes back with the failure, so a rejected upload is
		// corrected rather than retyped. The file cannot be handed back — a
		// browser will not let a file input be repopulated — so the form says so.
		const typedBack = {
			personId,
			gross: String(form.get('gross') ?? ''),
			net: String(form.get('net') ?? ''),
			bonus: String(form.get('bonus') ?? ''),
			periodMonth: String(form.get('periodMonth') ?? ''),
			currency: stated
		};
		const reject = (message: string) => fail(400, { message, values: typedBack, reopen: true });

		// The currency the slip is PRINTED in, which is not the currency the
		// household reports in. Taking the base currency for it is the v0.4.4
		// defect this replaces: six Czech payslips were filed as 135 887 EUR, and
		// every conversion downstream then multiplied koruna by the euro rate.
		//
		// Mandatory, with no fallback. The dialog fills it in from the slip when
		// the slip says, and asks when it does not — and what a person states
		// there is an answer, where a default is only ever a guess that nobody is
		// shown.
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

		// A currency the person CHOSE teaches the reader, so the next slip for the
		// same job arrives with the field already right. Plenty of payslips print
		// no currency anywhere on the page, and without this the question has to
		// be answered by hand every month for an employer that has not changed.
		//
		// Outside the `if (reading)` below on purpose: a month filed with no file
		// at all still states a currency, and that statement is worth just as
		// much. `touched` is what separates a decision from the reader's own
		// prefill — learning a prefill back would teach it nothing.
		if (touched.has('currency')) {
			await learnPayslipCurrency(subject, currency);
		}

		// A figure the person STATED, that matches a line on the slip, teaches the
		// reader. A prefill the reader produced teaches it nothing — it would only
		// be learning its own answer back.
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

		/**
		 * A month used to identify an entry, so a re-upload REPLACED the slip
		 * already filed for it. It cannot any more: a month worked twice has two
		 * payslips, and "replace August's" would throw away the other job.
		 *
		 * So an upload only ever ADDS, and nothing deletes a stored file behind
		 * the person's back. Filing the same slip twice leaves two rows, which is
		 * visible on the screen and removed from its ⋯ menu — where a silently
		 * destroyed payslip was neither.
		 */
		const alreadyFiled = sameSlip ? [] : await payslipStatementsFor(personId, periodMonth);

		/**
		 * A recognised slip corrects the statement it already produced.
		 *
		 * Its document is reused rather than replaced, so `recordSalary` finds ITS
		 * OWN row by document id and writes over it — figures, currency and the
		 * month alike. `filePayslipDocument` restates the month as part of that:
		 * the same file cannot be two statements, so filing it again with a
		 * corrected month moves the row rather than leaving the old one behind.
		 */
		const documentId = await filePayslipDocument({
			personId,
			subject,
			periodMonth,
			currency,
			storedName,
			contentHash,
			existingId: sameSlip?.id
		});

		const recorded = await recordSalary({
			personId,
			periodMonth,
			currency,
			// A re-upload restates the month, its currency included: filing the
			// same month again with a corrected currency has to move the label as
			// well as the figures, or the koruna digits stay under a euro sign.
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

		// Said out loud rather than acted on: a second slip for a month is exactly
		// what two jobs look like, and also what a mistaken re-upload looks like.
		return {
			ok: true,
			alsoFiled: alreadyFiled.length > 0 ? { periodMonth, count: alreadyFiled.length } : null,
			// Said out loud too, and the opposite news: nothing was added, the
			// statement this file already made was corrected. Silence here would
			// look exactly like a second upload that did nothing.
			sameSlip: sameSlip
				? {
						periodMonth,
						moved: sameSlip.periodMonth !== null && sameSlip.periodMonth !== periodMonth
					}
				: null
		};
	},

	/**
	 * File a year of payslips in one go.
	 *
	 * Deliberately NOT the same action as `addPayslip`. That one exists so a
	 * single slip can be checked before it is written — the figures are read,
	 * shown, and corrected, and a correction teaches the reader. Nobody checks
	 * twelve slips in a dialog, so this one files only what it can read with
	 * confidence and hands back, by name, every file it could not.
	 *
	 * Nothing here is stored as a decision: every figure lands as a reading, so a
	 * later re-read may still correct it and no label is learned from a number
	 * nobody looked at.
	 */
	addPayslips: async ({ request }) => {
		const form = await request.formData();
		const personId = asRowId(form.get('personId')).trim();
		const owner = (await db.select().from(person).where(eq(person.id, personId)))[0];
		if (!owner) return fail(400, { message: 'Pick whose payslips these are.' });
		const subject = owner.name;

		const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
		if (files.length === 0) return fail(400, { message: 'Choose at least one payslip file.' });

		// A currency for the slips that do not name one. Optional: most do, or the
		// reader has learned this person's from an earlier upload. Where neither is
		// true the file is refused by name rather than filed under a guess.
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
		 * Files that were already on the shelf, listed back rather than filed again.
		 *
		 * Its own bucket, not `skipped`. Skipped means "this one needs you" — a
		 * slip nothing could be read from. A file already filed needs nothing;
		 * saying so is only so that eleven of twelve landing does not read as a
		 * failure. Nothing is re-read either: unlike the single-slip dialog, no
		 * figure here was checked by anybody, so there is no correction to carry
		 * back into the statement the file already made.
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

			// Every refusal from here on removes the file it just stored. An upload
			// nothing points at is invisible and stays on the disk for ever.
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
				currency,
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
				await deleteDocument(documentId);
				skipped.push({ name: file.name, reason: recorded.message.toLowerCase() });
				continue;
			}
			filed.push({ name: file.name, periodMonth });
			seen.set(contentHash, periodMonth);
		}

		return { ok: true, filed, skipped, already };
	},

	/**
	 * Correct one figure of one month.
	 *
	 * Replaces `setPayslipAmount`, which wrote to the document and — having no
	 * caller in the UI — was never reachable at all.
	 */
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

		/**
		 * Base is gross with the award taken out, so setting it sets gross.
		 *
		 * It used to be read-only for exactly that reason — an editable derived
		 * figure has to decide which of its inputs it writes. It writes gross and
		 * leaves the bonus alone, because that is what correcting a base means:
		 * "the award was right, the pay under it was not". Correcting the award
		 * itself is the bonus field, one column over.
		 */
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

		// A correction against THIS month's stored slip teaches the reader.
		//
		// Base is excluded on purpose: what a person typed there is gross minus an
		// award, and no line on the slip prints that sum. Teaching the reader to
		// look for it would point the gross label at a number the slip never had.
		const slip = entry.documentId ? await slipDocument(entry.documentId) : null;
		if (slip?.storedName && field !== 'base') {
			const reading = await readStoredPayslip(slip.storedName, owner.name);
			if (field === 'gross') await learnGrossLabel(owner.name, parsed.value, reading.candidates);
			else await learnNetLabel(owner.name, parsed.value, reading.candidates);
		}
		return { ok: true };
	},

	/**
	 * Correct which currency a month was paid in.
	 *
	 * A RELABEL, never a conversion. The figures are the digits printed on the
	 * slip; what was wrong is the name attached to them, and multiplying them by
	 * a rate would destroy the only true thing on the row. Reporting into the
	 * base currency happens on the way out, from this currency, so fixing the
	 * label is the whole fix.
	 *
	 * It exists because the currency used to be taken from the household's base:
	 * every month filed before v0.5.1 carries that base rather than what the
	 * slip said, and a re-upload is not always possible — the file may be gone.
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

		await db.transaction(async (tx) => {
			await tx.update(salaryEntry).set({ currency }).where(eq(salaryEntry.id, entry.id));
			// The stored slip carries a currency of its own, written from the same
			// wrong source. Left behind it would put the old currency back the next
			// time anything read the document rather than the entry.
			if (entry.documentId) {
				await tx.update(document).set({ currency }).where(eq(document.id, entry.documentId));
			}
		});

		// A correction is the strongest statement there is about this person's
		// pay, so it teaches the reader too — fixing one month should not leave
		// the next upload asking the same question again.
		await learnPayslipCurrency(owner.name, currency);
		return { ok: true };
	},

	/**
	 * Correct what of a month was a bonus.
	 *
	 * Stored on the salary entry rather than on the document, because a month
	 * can be evidenced by a payslip and a bank credit both, and the bonus is a
	 * fact about the month rather than about one piece of paper. An empty field
	 * clears it back to "the slip did not say", which is not the same as zero.
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

		// THIS statement's own slip. Not "any document linked to this person that
		// happens to have a file", and — now that a month can hold two — not
		// whichever of the month's slips came back first either.
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
	 * Remove a payslip and the month it evidenced.
	 *
	 * The whole entry goes, not just the payslip-side fields. A month also
	 * evidenced by a bank credit loses that credit's net figure too — the
	 * confirmation on the screen names what is going, and re-filing the salary
	 * transaction rebuilds it.
	 */
	deletePayslip: async ({ request }) => {
		const form = await request.formData();
		const found = await entryWithOwner(asRowId(form.get('entryId')));
		if (!found) return fail(404, { message: 'That payslip is no longer here.' });
		const { entry } = found;

		// This ONE statement of the month, and the file it was read from. A month
		// worked twice keeps its other job: deleting by month took both, which was
		// harmless while a month could only hold one and is not any more.
		await db.delete(salaryEntry).where(eq(salaryEntry.id, entry.id));
		if (entry.documentId) await deleteDocument(entry.documentId);
		return { ok: true };
	}
};
