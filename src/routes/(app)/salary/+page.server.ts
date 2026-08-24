// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Salary: what was earned each month, and the payslips it was read from.
//
// Moved out of Retirement in v0.4.4. It sat beside a projection that never read
// it, and "what did I earn" is a Money question — it now lives one tab from the
// Tax screen that asks what was paid on it.
import { uuidv7 } from 'uuidv7';
import { asRowId } from '$lib/ids';
import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { document, documentLink, person, salaryEntry } from '$lib/server/db/schema';
import {
	learnAmountLabel,
	learnBonusLabel,
	loadSalaryHistory,
	readPayslip,
	readStoredPayslip
} from '$lib/server/salary';
import { payslipEditCurrency } from '$lib/salary';
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
				amount: formatMinor(s.amountMinor, s.currency),
				bonus: s.bonusMinor === null ? null : formatMinor(s.bonusMinor, s.currency),
				currency: s.currency,
				file: s.file
			}))
		}))
	};
};

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

		// the user's own entry wins; the PDF reading fills what is left blank
		let amountMinor: bigint | null;
		const amountRaw = String(form.get('amount') ?? '').trim();
		if (amountRaw) {
			try {
				amountMinor = parseAmountToMinor(amountRaw, baseCurrency);
			} catch {
				return fail(400, { message: 'The amount must be a number.' });
			}
		} else {
			amountMinor = reading?.amountMinor ?? null;
		}
		const periodMonth =
			String(form.get('periodMonth') ?? '').trim() || reading?.periodMonth || null;
		if (amountMinor === null || amountMinor <= 0n) {
			return fail(400, {
				message: 'Could not read the amount from the slip — please fill it in.'
			});
		}
		if (!periodMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodMonth)) {
			return fail(400, { message: 'Which month does this payslip cover?' });
		}

		// a stated amount that matches a line on the slip teaches the reader
		if (amountRaw && reading) await learnAmountLabel(subject, amountMinor, reading.candidates);

		const documentId = uuidv7();
		await db.transaction(async (tx) => {
			await tx.insert(document).values({
				id: documentId,
				name: `Payslip ${periodMonth} · ${subject}`,
				shelf: 'payslips',
				storedName,
				ext: storedName ? (storedName.split('.').pop() ?? 'pdf').toUpperCase() : 'PDF',
				addedOn: new Date().toISOString().slice(0, 10),
				amountMinor,
				currency: baseCurrency,
				periodOn: `${periodMonth}-01`
			});
			await tx
				.insert(documentLink)
				.values({ documentId, targetId: personId })
				.onConflictDoNothing();
		});
		return { ok: true };
	},

	setPayslipAmount: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		const rows = await db.select().from(document).where(eq(document.id, id));
		const doc = rows[0];
		if (!doc) return fail(404, { message: 'Payslip not found.' });
		const currency = payslipEditCurrency(doc.currency, await getBaseCurrency());
		let amountMinor: bigint;
		try {
			amountMinor = parseAmountToMinor(String(form.get('amount') ?? ''), currency);
			if (amountMinor <= 0n) throw new Error('amount');
		} catch {
			return fail(400, { message: 'The amount must be a positive number.' });
		}
		// a correction against the stored file teaches the reader for next time
		if (doc.storedName) {
			// The PERSON this payslip is filed against. `document_link` also holds a
			// document's properties, accounts and subjects, so this joins `person`
			// rather than taking the first link and hoping — which is what the old
			// per-pair table was doing for it implicitly.
			const owner = (
				await db
					.select({ id: person.id, name: person.name })
					.from(documentLink)
					.innerJoin(person, eq(person.id, documentLink.targetId))
					.where(eq(documentLink.documentId, doc.id))
					.limit(1)
			)[0];
			if (owner) {
				const reading = await readStoredPayslip(doc.storedName, owner.name);
				await learnAmountLabel(owner.name, amountMinor, reading.candidates);
			}
		}
		await db.update(document).set({ amountMinor, currency: currency }).where(eq(document.id, id));
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
		if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodMonth)) {
			return fail(400, { message: 'Which month is this?' });
		}

		const baseCurrency = await getBaseCurrency();
		const raw = String(form.get('bonus') ?? '').trim();
		let bonusMinor: bigint | null = null;
		if (raw) {
			try {
				bonusMinor = parseAmountToMinor(raw, baseCurrency);
			} catch {
				return fail(400, { message: 'The bonus must be a number.' });
			}
			if (bonusMinor < 0n) return fail(400, { message: 'A bonus cannot be negative.' });
		}

		const [owner] = await db
			.select({ name: person.name })
			.from(person)
			.where(eq(person.id, personId));
		if (!owner) return fail(404, { message: 'That person is no longer here.' });

		const existing = await db.select().from(salaryEntry).where(eq(salaryEntry.personId, personId));
		const row = existing.find((e) => e.periodMonth === periodMonth);

		if (row) {
			await db.update(salaryEntry).set({ bonusMinor }).where(eq(salaryEntry.id, row.id));
		} else {
			await db.insert(salaryEntry).values({
				id: uuidv7(),
				personId,
				periodMonth,
				grossMinor: null,
				netMinor: null,
				bonusMinor,
				currency: baseCurrency,
				source: 'manual'
			});
		}

		// A stated bonus that matches a line on the slip teaches the reader, under
		// its own key so it cannot overwrite the net-pay label.
		const slip = await db
			.select({ storedName: document.storedName })
			.from(document)
			.innerJoin(documentLink, eq(documentLink.documentId, document.id))
			.where(eq(documentLink.targetId, personId));
		const withFile = slip.find((s) => s.storedName !== null);
		if (bonusMinor !== null && withFile?.storedName) {
			const reading = await readStoredPayslip(withFile.storedName, owner.name);
			await learnBonusLabel(owner.name, bonusMinor, reading.candidates);
		}
		return { ok: true };
	}
};
