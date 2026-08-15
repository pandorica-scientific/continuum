// Database side of tax statements: load, upsert, delete. All arithmetic lives
// in the pure module; nothing here computes what is owed.

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
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
export async function saveStatement(input: StatementInput, handle: Db = db): Promise<TaxResult> {
	if (!input.personId) return { ok: false, status: 400, message: 'Pick whose statement this is.' };
	if (!Number.isInteger(input.year) || input.year < 1900 || input.year > 2200)
		return { ok: false, status: 400, message: 'That year does not look right.' };
	if (!input.country.trim()) return { ok: false, status: 400, message: 'Name the country.' };
	const currency = input.currency.trim().toUpperCase();
	if (!/^[A-Z]{3}$/.test(currency))
		return { ok: false, status: 400, message: 'Use a three-letter currency code.' };
	if (input.grossIncomeMinor < 0n || input.taxPaidMinor < 0n)
		return { ok: false, status: 400, message: 'Figures on a statement cannot be negative.' };

	const country = input.country.trim().toUpperCase();
	const values = {
		personId: input.personId,
		year: input.year,
		country,
		currency,
		grossIncomeMinor: input.grossIncomeMinor,
		taxPaidMinor: input.taxPaidMinor,
		documentId: input.documentId,
		note: input.note
	};
	await handle.transaction(async (tx) => {
		// The unique key resolves concurrent saves of the same statement and
		// RETURNING gives us the winning row id. Replacing its lines in this same
		// transaction means a failed insert can never leave an empty statement.
		const saved = await tx
			.insert(taxStatement)
			.values({ id: randomUUID(), ...values })
			.onConflictDoUpdate({
				target: [taxStatement.personId, taxStatement.year, taxStatement.country],
				set: values
			})
			.returning({ id: taxStatement.id });
		const id = saved[0].id;

		await tx.delete(taxStatementLine).where(eq(taxStatementLine.statementId, id));
		if (input.lines.length > 0) {
			await tx.insert(taxStatementLine).values(
				input.lines.map((line, sort) => ({
					id: randomUUID(),
					statementId: id,
					label: line.label,
					amountMinor: line.amountMinor,
					sort
				}))
			);
		}
	});
	return { ok: true };
}

export async function deleteStatement(id: string): Promise<TaxResult> {
	await db.delete(taxStatement).where(eq(taxStatement.id, id));
	return { ok: true };
}
