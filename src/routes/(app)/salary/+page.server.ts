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
import { getBaseCurrency } from '$lib/server/settings';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { saveUpload } from '$lib/server/system/files';
import { formatMinor, parseAmountToMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [baseCurrency, rates] = await Promise.all([getBaseCurrency(), loadRateTable()]);
	const convert = (amount: bigint, from: string, to: string, day: string) =>
		convertOrFace(rates, amount, from, to, day);

	const history = await loadSalaryHistory(baseCurrency, convert);

	return {
		baseCurrency,
		people: history.map((p) => ({ id: p.id, name: p.name })),
		// bigint does not survive serialisation; every figure crosses as a string
		// and the screen formats it, the same contract the Tax screen uses.
		history: history.map((p) => ({
			id: p.id,
			name: p.name,
			years: p.years.map((y) => ({
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
			})),
			payslips: p.payslips.map((s) => ({
				id: s.id,
				periodMonth: s.periodMonth,
				// Each figure names itself. A number on this screen with no stated
				// kind is the whole defect v0.4.6 exists to remove.
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

export const actions: Actions = {
	addPayslip: async ({ request }) => {
		const form = await request.formData();
		const personId = asRowId(form.get('personId')).trim();
		const owner = (await db.select().from(person).where(eq(person.id, personId)))[0];
		if (!owner) return fail(400, { message: 'Pick whose payslip this is.' });
		// The reader's learned labels stay keyed by name; the link is by id.
		const subject = owner.name;
		const baseCurrency = await getBaseCurrency();

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

		// Anything typed wins; the reading fills what was left blank.
		const typedGross = optionalAmount(form, 'gross', baseCurrency);
		if (!typedGross.ok) return fail(400, { message: typedGross.message });
		const typedNet = optionalAmount(form, 'net', baseCurrency);
		if (!typedNet.ok) return fail(400, { message: typedNet.message });
		const typedBonus = optionalAmount(form, 'bonus', baseCurrency);
		if (!typedBonus.ok) return fail(400, { message: typedBonus.message });

		const grossMinor = typedGross.value ?? reading?.grossMinor ?? null;
		const netMinor = typedNet.value ?? reading?.netMinor ?? null;
		const bonusMinor = typedBonus.value ?? reading?.bonusMinor ?? null;
		const periodMonth =
			String(form.get('periodMonth') ?? '').trim() || reading?.periodMonth || null;

		if (grossMinor === null && netMinor === null) {
			return fail(400, {
				message: 'Could not read a gross or net figure from the slip — please fill one in.'
			});
		}
		if (!periodMonth || !MONTH.test(periodMonth)) {
			return fail(400, { message: 'Which month does this payslip cover?' });
		}

		// A stated figure that matches a line on the slip teaches the reader.
		if (reading) {
			if (typedGross.value !== null) {
				await learnGrossLabel(subject, typedGross.value, reading.candidates);
			}
			if (typedNet.value !== null) {
				await learnNetLabel(subject, typedNet.value, reading.candidates);
			}
			if (typedBonus.value !== null) {
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
				currency: baseCurrency,
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
			currency: baseCurrency,
			grossMinor,
			netMinor,
			bonusMinor,
			source: 'payslip',
			documentId,
			// A figure somebody typed is a decision; a reading is not.
			overridden: typedGross.value !== null || typedNet.value !== null || typedBonus.value !== null
		});
		if (!recorded.ok) return fail(recorded.status, { message: recorded.message });

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
		if (field !== 'gross' && field !== 'net') {
			return fail(400, { message: 'That is not a figure this can set.' });
		}

		const [owner] = await db
			.select({ name: person.name })
			.from(person)
			.where(eq(person.id, personId));
		if (!owner) return fail(404, { message: 'That person is no longer here.' });

		const baseCurrency = await getBaseCurrency();
		const parsed = optionalAmount(form, 'amount', baseCurrency);
		if (!parsed.ok) return fail(400, { message: parsed.message });
		if (parsed.value === null || parsed.value <= 0n) {
			return fail(400, { message: 'The amount must be a positive number.' });
		}

		const recorded = await recordSalary({
			personId,
			periodMonth,
			currency: baseCurrency,
			grossMinor: field === 'gross' ? parsed.value : null,
			netMinor: field === 'net' ? parsed.value : null,
			source: 'manual',
			overridden: true
		});
		if (!recorded.ok) return fail(recorded.status, { message: recorded.message });

		// A correction against THIS month's stored slip teaches the reader.
		const slip = await payslipSlipFor(personId, periodMonth);
		if (slip?.storedName) {
			const reading = await readStoredPayslip(slip.storedName, owner.name);
			if (field === 'gross') await learnGrossLabel(owner.name, parsed.value, reading.candidates);
			else await learnNetLabel(owner.name, parsed.value, reading.candidates);
		}
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

		const baseCurrency = await getBaseCurrency();
		const parsed = optionalAmount(form, 'bonus', baseCurrency);
		if (!parsed.ok) return fail(400, { message: parsed.message });

		const recorded = await recordSalary({
			personId,
			periodMonth,
			currency: baseCurrency,
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
