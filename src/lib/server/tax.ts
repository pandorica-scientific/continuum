// Database side of tax statements: load, upsert, delete. All arithmetic lives
// in the pure module; nothing here computes what is owed.

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person, taxStatement, taxStatementLine } from '$lib/server/db/schema';

export interface StatementInput {
	personId: string;
	year: number;
	country: string;
	currency: string;
	grossIncomeMinor: bigint;
	taxPaidMinor: bigint;
	documentId: string | null;
	note: string | null;
	lines: { label: string; amountMinor: bigint }[];
}

export type TaxResult = { ok: true } | { ok: false; status: number; message: string };

export async function loadStatements() {
	const [rows, lines, people] = await Promise.all([
		db.select().from(taxStatement),
		db.select().from(taxStatementLine),
		db.select({ id: person.id, name: person.name }).from(person)
	]);
	const personName = new Map(people.map((p) => [p.id, p.name]));
	return rows.map((r) => ({
		...r,
		personName: personName.get(r.personId) ?? '—',
		lines: lines
			.filter((l) => l.statementId === r.id)
			.sort((a, b) => a.sort - b.sort)
			.map((l) => ({ label: l.label, amountMinor: l.amountMinor }))
	}));
}

/**
 * One statement per person per country per year: an existing one is updated in
 * place and its lines replaced wholesale — the same contract tags use.
 */
export async function saveStatement(input: StatementInput): Promise<TaxResult> {
	if (!input.personId) return { ok: false, status: 400, message: 'Pick whose statement this is.' };
	if (!Number.isInteger(input.year) || input.year < 1900 || input.year > 2200)
		return { ok: false, status: 400, message: 'That year does not look right.' };
	if (!input.country.trim()) return { ok: false, status: 400, message: 'Name the country.' };
	if (!input.currency.trim()) return { ok: false, status: 400, message: 'Name the currency.' };
	if (input.grossIncomeMinor < 0n || input.taxPaidMinor < 0n)
		return { ok: false, status: 400, message: 'Figures on a statement cannot be negative.' };

	const country = input.country.trim().toUpperCase();
	const existing = await db
		.select()
		.from(taxStatement)
		.where(
			and(
				eq(taxStatement.personId, input.personId),
				eq(taxStatement.year, input.year),
				eq(taxStatement.country, country)
			)
		);

	const id = existing[0]?.id ?? randomUUID();
	const values = {
		personId: input.personId,
		year: input.year,
		country,
		currency: input.currency.trim().toUpperCase(),
		grossIncomeMinor: input.grossIncomeMinor,
		taxPaidMinor: input.taxPaidMinor,
		documentId: input.documentId,
		note: input.note
	};
	if (existing[0]) {
		await db.update(taxStatement).set(values).where(eq(taxStatement.id, id));
		await db.delete(taxStatementLine).where(eq(taxStatementLine.statementId, id));
	} else {
		await db.insert(taxStatement).values({ id, ...values });
	}
	if (input.lines.length > 0) {
		await db.insert(taxStatementLine).values(
			input.lines.map((l, sort) => ({
				id: randomUUID(),
				statementId: id,
				label: l.label,
				amountMinor: l.amountMinor,
				sort
			}))
		);
	}
	return { ok: true };
}

export async function deleteStatement(id: string): Promise<TaxResult> {
	await db.delete(taxStatement).where(eq(taxStatement.id, id));
	return { ok: true };
}
