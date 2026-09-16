// SPDX-License-Identifier: AGPL-3.0-or-later
// Salary history, assembled from the two places salary is evidenced.

import { eq } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { document, documentLink, person, salaryEntry } from '$lib/server/db/schema';
import { salaryStats, type SalaryYear, type VestSummary } from '$lib/salary';

/**
 * How an amount crosses currencies. Spelled once: three callers here take the
 * same function, and three copies of a four-argument signature drift.
 */
export type ConvertMinor = (amount: bigint, from: string, to: string, day: string) => bigint;

/** What the fold below needs off a `salary_entry` row, and nothing more. */
export interface SalaryEntryFigures {
	periodMonth: string;
	currency: string;
	grossMinor: bigint | null;
	netMinor: bigint | null;
	bonusMinor: bigint | null;
}

/** One month of a person's pay, converted, with every statement of it added up. */
export interface SalaryMonthTotal {
	periodMonth: string;
	grossMinor: bigint | null;
	netMinor: bigint | null;
	bonusMinor: bigint | null;
}

/**
 * A person's months, oldest first, with each month's statements ADDED UP.
 *
 * A month can hold more than one payslip (two jobs); taking any single row
 * would silently drop the other. Summed only after each row is converted, at
 * the MONTH's own date — not today's rate, which would make history reprice
 * every morning.
 *
 * Pure and exported (not folded into the loader) so the Overview's Salary
 * panel computes the same months from the same rows.
 */
export function monthlyTotals(
	entries: readonly SalaryEntryFigures[],
	convert: ConvertMinor,
	baseCurrency: string
): SalaryMonthTotal[] {
	const converted = entries.map((entry) => {
		const at = `${entry.periodMonth}-01`;
		const to = (amount: bigint | null) =>
			amount === null ? null : convert(amount, entry.currency, baseCurrency, at);
		return {
			periodMonth: entry.periodMonth,
			grossMinor: to(entry.grossMinor),
			netMinor: to(entry.netMinor),
			bonusMinor: to(entry.bonusMinor)
		};
	});

	return [...new Set(converted.map((e) => e.periodMonth))].sort().map((periodMonth) => {
		const rows = converted.filter((e) => e.periodMonth === periodMonth);
		// Null is "nobody said", and stays null. Summing it as zero would turn a
		// month with no net stated into a month that earned nothing net.
		const total = (pick: (row: (typeof rows)[number]) => bigint | null) => {
			const stated = rows.map(pick).filter((v) => v !== null);
			return stated.length === 0 ? null : stated.reduce((a, b) => a + b, 0n);
		};
		return {
			periodMonth,
			grossMinor: total((r) => r.grossMinor),
			netMinor: total((r) => r.netMinor),
			bonusMinor: total((r) => r.bonusMinor)
		};
	});
}

export interface SalaryPersonHistory {
	id: string;
	name: string;
	years: SalaryYear[];
	/** Payslip documents filed against this person, newest first. */
	payslips: {
		/**
		 * The salary ENTRY's id, not the document's — a month can hold two
		 * payslips, and a correction needs to name which row it corrects.
		 */
		id: string;
		/**
		 * The stored file this statement was read from — null when the reader may
		 * not know it exists. Restricted paper is ABSENT rather than forbidden;
		 * what the month earned stays either way.
		 */
		documentId: string | null;
		periodMonth: string;
		grossMinor: bigint | null;
		netMinor: bigint | null;
		bonusMinor: bigint | null;
		/**
		 * The currency the month was RECORDED in, not the base currency — unlike
		 * the year rows above, a slip row is the evidence and must match the paper.
		 */
		currency: string;
		file: string | null;
	}[];
}

/**
 * Every person's salary history, converted to one currency.
 *
 * Two sources kept apart: a payslip states GROSS (a document); a ledger
 * salary credit is NET (`salary_entry`). Averaging them would report neither.
 * Conversion is at the month's own date, not today's rate.
 */
export async function loadSalaryHistory(
	baseCurrency: string,
	convert: ConvertMinor,
	handle: Db = db,
	/** Vested equity per person, already in the base currency; see `vestValues`. */
	vests: (VestSummary & { personId: string })[] = []
): Promise<SalaryPersonHistory[]> {
	const [people, slipDocs, slipOwners, entries] = await Promise.all([
		handle
			.select({ id: person.id, name: person.name, birthYear: person.birthYear })
			.from(person)
			.orderBy(person.createdAt, person.id),
		handle.select().from(document).where(eq(document.type, 'payslip')),
		// Filtered to people: document_link also holds properties, accounts and
		// subjects, which aren't payslip owners.
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

		// The one fold, shared with the Overview's Salary panel: the year rows
		// below and the panel's latest month have to be the same arithmetic or
		// two screens report two different Julys.
		const months = monthlyTotals(recorded, convert, baseCurrency);

		// The document is the FILE, and nothing else — every figure below comes
		// from the entry, not the document.
		const fileOf = new Map(
			slipDocs.filter((d) => ownerOf.get(d.id) === p.id).map((d) => [d.id, d.storedName] as const)
		);

		return {
			id: p.id,
			name: p.name,
			years: salaryStats(
				months,
				p.birthYear,
				vests.filter((v) => v.personId === p.id)
			),
			// Slip rows are the entries as STORED, built from `recorded` not
			// `converted` — every figure below is the raw one.
			payslips: recorded
				.filter((e) => e.documentId !== null)
				.map((e) => {
					// A slip this reader may not see costs the row its PAPER only —
					// the figures below are the entry's own regardless.
					const paper = fileOf.has(e.documentId!);
					return {
						/** The ENTRY, not the document: a correction has to name a row. */
						id: e.id,
						documentId: paper ? e.documentId : null,
						periodMonth: e.periodMonth,
						// In the currency it was recorded in. Converting here put every row
						// in the base currency, so a household reporting in euro read its
						// Czech payslips as euro amounts.
						grossMinor: e.grossMinor,
						netMinor: e.netMinor,
						bonusMinor: e.bonusMinor,
						currency: e.currency ?? baseCurrency,
						file: paper ? (fileOf.get(e.documentId!) ?? null) : null
					};
				})
				.sort((a, b) => (a.periodMonth < b.periodMonth ? 1 : -1))
		};
	});
}

/** A person's newest month on record, and the one before it to compare against. */
export interface LatestSalary {
	personId: string;
	name: string;
	latest: SalaryMonthTotal;
	previous: SalaryMonthTotal | null;
}

/**
 * The last month each person was paid for, and the month before it.
 *
 * What the Overview's Salary panel needs, avoiding the full history's queries
 * for payslip rows and paper. No actor: every figure comes from `salary_entry`
 * directly, not gated by document read rules. No entries means no row.
 */
export async function latestSalaryByPerson(
	baseCurrency: string,
	convert: ConvertMinor,
	handle: Db = db
): Promise<LatestSalary[]> {
	const [people, entries] = await Promise.all([
		handle
			.select({ id: person.id, name: person.name })
			.from(person)
			.orderBy(person.createdAt, person.id),
		handle.select().from(salaryEntry)
	]);

	const byPerson = new Map<string, typeof entries>();
	for (const entry of entries) {
		const list = byPerson.get(entry.personId) ?? [];
		list.push(entry);
		byPerson.set(entry.personId, list);
	}

	const rows: LatestSalary[] = [];
	for (const p of people) {
		// Oldest first, so the last two are the newest month and its predecessor.
		const months = monthlyTotals(byPerson.get(p.id) ?? [], convert, baseCurrency);
		const latest = months.at(-1);
		if (!latest) continue;
		rows.push({ personId: p.id, name: p.name, latest, previous: months.at(-2) ?? null });
	}
	return rows;
}
