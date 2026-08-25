// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Salary history, assembled from the two places salary is evidenced.
//
// Lived on the Retirement screen until v0.4.4, where it sat beside a projection
// that never read it. It is a Money question — what was earned — so it moved to
// its own screen, and the assembly came here rather than being copied.

import { eq } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { document, documentLink, person, salaryEntry } from '$lib/server/db/schema';
import { salaryStats, type SalaryYear } from '$lib/salary';

export interface SalaryPersonHistory {
	id: string;
	name: string;
	years: SalaryYear[];
	/** Payslip documents filed against this person, newest first. */
	payslips: {
		/** The document id — the stored file, not the figures. */
		id: string;
		periodMonth: string;
		grossMinor: bigint | null;
		netMinor: bigint | null;
		bonusMinor: bigint | null;
		/**
		 * The currency the month was RECORDED in, and the unit these figures are
		 * in — not the base currency.
		 *
		 * The year rows above are converted, because comparing years is the
		 * question they answer and it cannot be asked across currencies. A slip
		 * row is the opposite question: it is the evidence, and the evidence says
		 * 135 887 Kč. Restating it as €5 415 shows a number that appears nowhere
		 * on the piece of paper the row links to.
		 */
		currency: string;
		file: string | null;
	}[];
}

/**
 * Every person's salary history, converted to one currency.
 *
 * Two sources, kept apart on purpose. A payslip states GROSS and is a document
 * on the Payslips shelf; a salary credit the ledger already holds is NET and
 * arrives as a `salary_entry` row. A month can be evidenced by both, and
 * averaging them together would report a figure that is neither.
 *
 * Conversion is at the month's own date, not today's rate — a 2019 payslip
 * restated at this morning's rate is a different number every morning.
 */
export async function loadSalaryHistory(
	baseCurrency: string,
	convert: (amount: bigint, from: string, to: string, day: string) => bigint,
	handle: Db = db
): Promise<SalaryPersonHistory[]> {
	const [people, slipDocs, slipOwners, entries] = await Promise.all([
		handle
			.select({ id: person.id, name: person.name, birthYear: person.birthYear })
			.from(person)
			.orderBy(person.createdAt, person.id),
		handle.select().from(document).where(eq(document.shelf, 'payslips')),
		// Filtered to people: document_link also holds a document's properties,
		// accounts and subjects, and a payslip filed against a flat is not a
		// payslip belonging to a flat.
		handle
			.select({ documentId: documentLink.documentId, personId: documentLink.targetId })
			.from(documentLink)
			.innerJoin(person, eq(person.id, documentLink.targetId)),
		handle.select().from(salaryEntry)
	]);

	const ownerOf = new Map(slipOwners.map((r) => [r.documentId, r.personId]));

	const entriesByPerson = new Map<string, typeof entries>();
	for (const entry of entries) {
		const list = entriesByPerson.get(entry.personId) ?? [];
		list.push(entry);
		entriesByPerson.set(entry.personId, list);
	}

	return people.map((p) => {
		const recorded = entriesByPerson.get(p.id) ?? [];

		// Converted at the MONTH's own date, not today's rate: a 2019 payslip
		// restated at this morning's rate is a different number every morning.
		const months = recorded.map((entry) => {
			const at = `${entry.periodMonth}-01`;
			const to = (amount: bigint | null) =>
				amount === null ? null : convert(amount, entry.currency, baseCurrency, at);
			return {
				periodMonth: entry.periodMonth,
				grossMinor: to(entry.grossMinor),
				netMinor: to(entry.netMinor),
				bonusMinor: to(entry.bonusMinor),
				documentId: entry.documentId
			};
		});

		// The document is the FILE, and nothing else. Its `amountMinor` is not
		// read at all: reading it as gross while the reader picked net is the
		// defect v0.4.6 exists to fix, and a second source is how that happened.
		const fileOf = new Map(
			slipDocs.filter((d) => ownerOf.get(d.id) === p.id).map((d) => [d.id, d.storedName] as const)
		);

		// Slip rows are the entries as STORED — not the converted `months` above.
		const rawOf = new Map(recorded.filter((e) => e.documentId).map((e) => [e.documentId!, e]));

		return {
			id: p.id,
			name: p.name,
			years: salaryStats(
				months.map(({ periodMonth, grossMinor, netMinor, bonusMinor }) => ({
					periodMonth,
					grossMinor,
					netMinor,
					bonusMinor
				})),
				p.birthYear
			),
			payslips: months
				.filter((m) => m.documentId !== null && fileOf.has(m.documentId))
				.map((m) => {
					const raw = rawOf.get(m.documentId!);
					return {
						id: m.documentId!,
						periodMonth: m.periodMonth,
						// As recorded, in the currency it was recorded in. Converting here
						// put every row in the base currency, so a household reporting in
						// euro read its Czech payslips as euro amounts.
						grossMinor: raw?.grossMinor ?? null,
						netMinor: raw?.netMinor ?? null,
						bonusMinor: raw?.bonusMinor ?? null,
						currency: raw?.currency ?? baseCurrency,
						file: fileOf.get(m.documentId!) ?? null
					};
				})
				.sort((a, b) => (a.periodMonth < b.periodMonth ? 1 : -1))
		};
	});
}
