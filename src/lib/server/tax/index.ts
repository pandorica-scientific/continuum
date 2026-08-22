// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Database side of tax statements: load, upsert, delete. All arithmetic lives
// in the pure module; nothing here computes what is owed.

import { uuidv7 } from 'uuidv7';
import { eq } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { person, taxStatement, taxStatementLine } from '$lib/server/db/schema';
import { insertDocumentAggregate } from '$lib/server/documents/mutations';

/**
 * A file uploaded with the statement itself, to be filed on the Tax shelf and
 * pointed at by the statement in one commit.
 *
 * The screen used to assume the paperwork had already been filed elsewhere: the
 * only way to attach it was to pick from a list of tax documents that someone
 * had to go and create first, on another screen, before the statement could be
 * recorded. Recording the statement and filing the paper it came from are one
 * act, so they are one save.
 */
interface StatementAttachment {
	/** The stored upload's name on the data volume, from `saveUpload`. */
	storedName: string;
	ext: string;
	addedOn: string;
}

interface StatementInput {
	personId: string;
	year: number;
	country: string;
	currency: string;
	grossIncomeMinor: bigint;
	taxPaidMinor: bigint;
	documentId: string | null;
	note: string | null;
	lines: { label: string; amountMinor: bigint }[];
	/** Overrides `documentId`: a new document is filed and linked instead. */
	attachment?: StatementAttachment | null;
}

/**
 * What the filed statement is called on the Tax shelf.
 *
 * Derived from the statement, not typed again: the name a document is found by
 * should say the same thing the statement says, and a second free-text field
 * would be free to disagree with it.
 */
export function statementDocumentName(year: number, country: string): string {
	return `${year} ${country.trim().toUpperCase()} tax statement`;
}

type TaxResult = { ok: true } | { ok: false; status: number; message: string };

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
	const attachment = input.attachment ?? null;
	const attachmentId = attachment ? uuidv7() : null;
	const values = {
		personId: input.personId,
		year: input.year,
		country,
		currency,
		grossIncomeMinor: input.grossIncomeMinor,
		taxPaidMinor: input.taxPaidMinor,
		// An upload wins over the picker: choosing a file is the more specific
		// intent, and the two controls are mutually exclusive on screen. A document
		// this statement pointed at before stays on the shelf — filing a newer copy
		// is not a reason to destroy the older one.
		documentId: attachmentId ?? input.documentId,
		note: input.note
	};
	await handle.transaction(async (tx) => {
		// The document goes in first — the statement's foreign key needs the row
		// to exist — and in this same transaction, so a statement that fails to
		// save cannot leave its paperwork filed on the shelf on its own.
		if (attachment && attachmentId) {
			await insertDocumentAggregate(
				{
					id: attachmentId,
					name: statementDocumentName(input.year, country),
					shelf: 'tax',
					storedName: attachment.storedName,
					ext: attachment.ext,
					addedOn: attachment.addedOn,
					expiresOn: null,
					expiryVerb: 'expires',
					// Filed against whose statement it is. Without a link the documents
					// screen builds no column for it, so a document filed here would be
					// missing from the household's own files.
					personIds: [input.personId],
					propertyIds: [],
					accountIds: [],
					transactionIds: [],
					subjectIds: [],
					tagNames: []
				},
				tx
			);
		}
		// The unique key resolves concurrent saves of the same statement and
		// RETURNING gives us the winning row id. Replacing its lines in this same
		// transaction means a failed insert can never leave an empty statement.
		const saved = await tx
			.insert(taxStatement)
			.values({ id: uuidv7(), ...values })
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
					id: uuidv7(),
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
