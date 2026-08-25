// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Salary: what was earned each month, and the payslips it was read from.
//
// Moved out of Retirement in v0.4.4. It sat beside a projection that never read
// it, and "what did I earn" is a Money question — it now lives one tab from the
// Tax screen that asks what was paid on it.
import { uuidv7 } from 'uuidv7';
import { asRowId } from '$lib/ids';
import { fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { document, documentLink, person, salaryEntry } from '$lib/server/db/schema';
import {
	learnBonusLabel,
	learnGrossLabel,
	learnNetLabel,
	loadSalaryHistory,
	payslipSlipFor,
	readPayslip,
	readStoredPayslip,
	recordSalary
} from '$lib/server/salary';
import { deleteDocument } from '$lib/server/documents/mutations';
import { mergeSalaryYears, type SalaryYear } from '$lib/salary';
import { getBaseCurrency } from '$lib/server/settings';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { saveUpload } from '$lib/server/system/files';
import { formatMinor, parseAmountToMinor } from '$lib/money';
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
				currency: s.currency,
				file: s.file
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

/**
 * The currency a month is already recorded in.
 *
 * Every correction to a month has to be read in the currency that month was
 * filed in, not the household's base. Parsing "102 202" as euro on a koruna
 * month stores a euro figure, and the screen then prints it beside koruna.
 *
 * The base currency is the fallback only for a month that does not exist yet,
 * which is the one case where there is nothing truer to use.
 */
async function currencyForMonth(personId: string, periodMonth: string): Promise<string> {
	const [entry] = await db
		.select({ currency: salaryEntry.currency })
		.from(salaryEntry)
		.where(and(eq(salaryEntry.personId, personId), eq(salaryEntry.periodMonth, periodMonth)));
	return entry?.currency ?? (await getBaseCurrency());
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
		let reading = null;
		if (file instanceof File && file.size > 0) {
			const data = new Uint8Array(await file.arrayBuffer());
			try {
				storedName = await saveUpload(
					new File([new Blob([data as BlobPart])], file.name, { type: file.type })
				);
			} catch (err) {
				return fail(400, { message: err instanceof Error ? err.message : 'Upload failed.' });
			}
			reading = await readPayslip(data, subject);
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

		// A month uniquely identifies an entry, so a re-upload REPLACES rather
		// than accumulating. The previous document goes after the new one is
		// written: a failure between the two leaves two slips for the month,
		// which is visible and fixable, rather than none.
		const previous = await payslipSlipFor(personId, periodMonth);

		const documentId = uuidv7();
		await db.transaction(async (tx) => {
			await tx.insert(document).values({
				id: documentId,
				name: `Payslip ${periodMonth} · ${subject}`,
				shelf: 'payslips',
				storedName,
				ext: storedName ? (storedName.split('.').pop() ?? 'pdf').toUpperCase() : 'PDF',
				addedOn: new Date().toISOString().slice(0, 10),
				currency,
				periodOn: `${periodMonth}-01`
			});
			await tx
				.insert(documentLink)
				.values({ documentId, targetId: personId })
				.onConflictDoNothing();
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

		if (previous && previous.id !== documentId) await deleteDocument(previous.id);
		return { ok: true };
	},

	/**
	 * Correct one figure of one month.
	 *
	 * Replaces `setPayslipAmount`, which wrote to the document and — having no
	 * caller in the UI — was never reachable at all.
	 */
	setPayslipFigure: async ({ request }) => {
		const form = await request.formData();
		const personId = asRowId(form.get('personId'));
		const periodMonth = String(form.get('periodMonth') ?? '').trim();
		const field = String(form.get('field') ?? '');
		if (!MONTH.test(periodMonth)) return fail(400, { message: 'Which month is this?' });
		if (field !== 'gross' && field !== 'net' && field !== 'base') {
			return fail(400, { message: 'That is not a figure this can set.' });
		}

		const [owner] = await db
			.select({ name: person.name })
			.from(person)
			.where(eq(person.id, personId));
		if (!owner) return fail(404, { message: 'That person is no longer here.' });

		const currency = await currencyForMonth(personId, periodMonth);
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
		if (field === 'base') {
			const [entry] = await db
				.select({ bonusMinor: salaryEntry.bonusMinor })
				.from(salaryEntry)
				.where(and(eq(salaryEntry.personId, personId), eq(salaryEntry.periodMonth, periodMonth)));
			grossMinor = parsed.value + (entry?.bonusMinor ?? 0n);
		}

		const recorded = await recordSalary({
			personId,
			periodMonth,
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
		const slip = await payslipSlipFor(personId, periodMonth);
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
		const personId = asRowId(form.get('personId'));
		const periodMonth = String(form.get('periodMonth') ?? '').trim();
		const currency = String(form.get('currency') ?? '')
			.trim()
			.toUpperCase();
		if (!MONTH.test(periodMonth)) return fail(400, { message: 'Which month is this?' });
		if (!currency) return fail(400, { message: 'Pick a currency.' });
		if (!(await availableCurrencies()).includes(currency)) {
			return fail(400, { message: `${currency} is not a currency this instance can convert.` });
		}

		const [entry] = await db
			.select({ id: salaryEntry.id, documentId: salaryEntry.documentId })
			.from(salaryEntry)
			.where(and(eq(salaryEntry.personId, personId), eq(salaryEntry.periodMonth, periodMonth)));
		if (!entry) return fail(404, { message: 'That month is not recorded.' });

		await db.transaction(async (tx) => {
			await tx.update(salaryEntry).set({ currency }).where(eq(salaryEntry.id, entry.id));
			// The stored slip carries a currency of its own, written from the same
			// wrong source. Left behind it would put the old currency back the next
			// time anything read the document rather than the entry.
			if (entry.documentId) {
				await tx.update(document).set({ currency }).where(eq(document.id, entry.documentId));
			}
		});
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
		const personId = asRowId(form.get('personId'));
		const periodMonth = String(form.get('periodMonth') ?? '').trim();
		if (!MONTH.test(periodMonth)) return fail(400, { message: 'Which month is this?' });

		const [owner] = await db
			.select({ name: person.name })
			.from(person)
			.where(eq(person.id, personId));
		if (!owner) return fail(404, { message: 'That person is no longer here.' });

		const currency = await currencyForMonth(personId, periodMonth);
		const parsed = optionalAmount(form, 'bonus', currency);
		if (!parsed.ok) return fail(400, { message: parsed.message });

		const recorded = await recordSalary({
			personId,
			periodMonth,
			currency,
			bonusMinor: parsed.value,
			source: 'manual',
			overridden: true
		});
		if (!recorded.ok) return fail(recorded.status, { message: recorded.message });

		// THIS month's slip, on the payslips shelf. Not "any document linked to
		// this person that happens to have a file", which is what it used to be.
		if (parsed.value !== null) {
			const slip = await payslipSlipFor(personId, periodMonth);
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
		const personId = asRowId(form.get('personId'));
		const periodMonth = String(form.get('periodMonth') ?? '').trim();
		if (!MONTH.test(periodMonth)) return fail(400, { message: 'Which month is this?' });

		const slip = await payslipSlipFor(personId, periodMonth);
		await db
			.delete(salaryEntry)
			.where(and(eq(salaryEntry.personId, personId), eq(salaryEntry.periodMonth, periodMonth)));
		if (slip) await deleteDocument(slip.id);
		return { ok: true };
	}
};
