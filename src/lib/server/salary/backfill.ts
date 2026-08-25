// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * One-off: move payslips uploaded before v0.4.6 into `salary_entry`.
 *
 * Until v0.4.6 a payslip's figure lived in `document.amountMinor` as one
 * untyped number, and `loadSalaryHistory` read it as GROSS — while the reader
 * that produced it preferred NET wordings. Every such year is wrong by the tax
 * and insurance withheld, on the Salary screen and in the Tax prefill both.
 *
 * The files are still on disk, so the honest repair is to read them again with
 * the reader that knows the difference. Where the file is gone, the amount is
 * filed as net: that is what the old reader preferred, so it is the most likely
 * truth about a number whose provenance is otherwise unknowable.
 */

import { eq } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { document, documentLink, person, salaryEntry } from '$lib/server/db/schema';
import { getBaseCurrency, getSetting, setSetting } from '$lib/server/settings';
import { readStoredPayslip } from './reader';
import { recordSalary } from './entries';

/** Set once the backfill has run, so a restart does not re-examine every slip. */
const GUARD = 'payslipBackfillV046';

export interface BackfillOutcome {
	/** False when the guard was already set: nothing was examined. */
	ran: boolean;
	written: number;
	reread: number;
	unreadable: number;
	/** Slips whose figures the entry refused, with the reason it gave. */
	rejected: { periodMonth: string; person: string; message: string }[];
}

export async function backfillPayslips(handle: Db = db): Promise<BackfillOutcome> {
	if (await getSetting<boolean>(GUARD, false, handle)) {
		return { ran: false, written: 0, reread: 0, unreadable: 0, rejected: [] };
	}

	// Joined to `person` rather than taking any link: document_link also holds a
	// document's properties, accounts and subjects, and a payslip filed against
	// a flat is not a payslip belonging to a flat.
	const slips = await handle
		.select({
			id: document.id,
			storedName: document.storedName,
			amountMinor: document.amountMinor,
			currency: document.currency,
			periodOn: document.periodOn,
			personId: person.id,
			personName: person.name
		})
		.from(document)
		.innerJoin(documentLink, eq(documentLink.documentId, document.id))
		.innerJoin(person, eq(person.id, documentLink.targetId))
		.where(eq(document.shelf, 'payslips'));

	const existing = await handle.select().from(salaryEntry);
	const held = new Map(existing.map((e) => [`${e.personId}|${e.periodMonth}`, e]));

	let written = 0;
	let reread = 0;
	let unreadable = 0;
	const rejected: BackfillOutcome['rejected'] = [];

	for (const slip of slips) {
		// A slip with no month cannot be filed. Inventing one from `addedOn` would
		// put August's pay in September for anyone paid in arrears.
		if (!slip.periodOn) continue;
		const periodMonth = slip.periodOn.slice(0, 7);

		const already = held.get(`${slip.personId}|${periodMonth}`);
		// A hand-corrected row is never touched, and a month that already carries
		// a figure is already better evidenced than this document is.
		if (already?.amountOverridden) continue;
		if (already && (already.grossMinor !== null || already.netMinor !== null)) continue;

		let grossMinor: bigint | null = null;
		let netMinor: bigint | null = null;
		let bonusMinor: bigint | null = null;
		// What the SLIP says, ahead of what the document row says. The document's
		// currency was itself written from the household's base, so trusting it
		// here would carry that assumption forward into the entry.
		let read: string | null = null;

		if (slip.storedName) {
			const reading = await readStoredPayslip(slip.storedName, slip.personName);
			grossMinor = reading.grossMinor;
			netMinor = reading.netMinor;
			bonusMinor = reading.bonusMinor;
			read = reading.currency;
		}

		const currency = read ?? slip.currency ?? (await getBaseCurrency(handle));

		if (grossMinor === null && netMinor === null) {
			// The file is gone, or the reader found no pay line in it.
			unreadable++;
			netMinor = slip.amountMinor;
		} else {
			reread++;
		}

		// Nothing to file: no readable figure and no stored amount either.
		if (grossMinor === null && netMinor === null) continue;

		const outcome = await recordSalary(
			{
				personId: slip.personId,
				periodMonth,
				currency,
				grossMinor,
				netMinor,
				bonusMinor,
				source: 'payslip',
				documentId: slip.id
			},
			handle
		);
		// A refusal is the interesting outcome, not a rounding error. Counting a
		// slip as re-read and then dropping it in silence is how a run could
		// report "4 slips re-read" while filing two of them — which is exactly
		// what a mis-read gross looked like from the outside.
		if (outcome.ok) written++;
		else rejected.push({ periodMonth, person: slip.personName, message: outcome.message });
	}

	await setSetting(GUARD, true, handle);
	console.log(
		`[salary] backfill: ${written} entries written, ${reread} slips re-read, ${unreadable} unreadable, ${rejected.length} refused`
	);
	for (const r of rejected) {
		console.warn(`[salary] backfill refused ${r.person} ${r.periodMonth}: ${r.message}`);
	}
	return { ran: true, written, reread, unreadable, rejected };
}
