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
		/** Always the base currency: the figures arrive already converted. */
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
				.map((m) => ({
					id: m.documentId!,
					periodMonth: m.periodMonth,
					grossMinor: m.grossMinor,
					netMinor: m.netMinor,
					bonusMinor: m.bonusMinor,
					// Figures arrive already converted, so the unit they are IN is the
					// base currency — not the currency the entry was stored in.
					currency: baseCurrency,
					file: fileOf.get(m.documentId!) ?? null
				}))
				.sort((a, b) => (a.periodMonth < b.periodMonth ? 1 : -1))
		};
	});
}
