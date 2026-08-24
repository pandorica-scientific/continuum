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
		id: string;
		periodMonth: string;
		amountMinor: bigint;
		bonusMinor: bigint | null;
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
	const slips = slipDocs.filter((d) => d.amountMinor !== null && d.periodOn !== null);

	const entriesByPerson = new Map<string, typeof entries>();
	for (const entry of entries) {
		const list = entriesByPerson.get(entry.personId) ?? [];
		list.push(entry);
		entriesByPerson.set(entry.personId, list);
	}

	return people.map((p) => {
		const own = slips
			.filter((d) => ownerOf.get(d.id) === p.id)
			.map((d) => ({
				id: d.id,
				// period_on is a real date; the screens and the form work in months,
				// which is what an <input type="month"> gives and takes.
				periodMonth: d.periodOn!.slice(0, 7),
				amountMinor: d.amountMinor!,
				currency: d.currency ?? baseCurrency,
				file: d.storedName
			}))
			.sort((a, b) => (a.periodMonth < b.periodMonth ? 1 : -1));

		const recorded = entriesByPerson.get(p.id) ?? [];
		const bonusOf = new Map(
			recorded.filter((e) => e.bonusMinor !== null).map((e) => [e.periodMonth, e])
		);

		const months = new Map<
			string,
			{ grossMinor?: bigint; netMinor?: bigint; bonusMinor?: bigint | null }
		>();
		for (const slip of own) {
			months.set(slip.periodMonth, {
				grossMinor: convert(slip.amountMinor, slip.currency, baseCurrency, `${slip.periodMonth}-01`)
			});
		}
		for (const entry of recorded) {
			const at = `${entry.periodMonth}-01`;
			const merged = months.get(entry.periodMonth) ?? {};
			if (entry.grossMinor !== null) {
				merged.grossMinor = convert(entry.grossMinor, entry.currency, baseCurrency, at);
			}
			if (entry.netMinor !== null) {
				merged.netMinor = convert(entry.netMinor, entry.currency, baseCurrency, at);
			}
			if (entry.bonusMinor !== null) {
				merged.bonusMinor = convert(entry.bonusMinor, entry.currency, baseCurrency, at);
			}
			months.set(entry.periodMonth, merged);
		}

		return {
			id: p.id,
			name: p.name,
			years: salaryStats(
				[...months.entries()].map(([periodMonth, figures]) => ({ periodMonth, ...figures })),
				p.birthYear
			),
			payslips: own.map((s) => ({
				...s,
				bonusMinor: bonusOf.get(s.periodMonth)?.bonusMinor ?? null
			}))
		};
	});
}
