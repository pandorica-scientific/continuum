// Tags group transactions and split lines into projects — a renovation, a
// holiday — and every tag carries a running total. They hold no tax meaning;
// tax treatment belongs to the tax module, not here.

import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	tag,
	transaction,
	transactionSplit,
	transactionSplitTag,
	transactionTag
} from '$lib/server/db/schema';
import { effectiveLines, type LineSource, type SplitSource } from '$lib/transactions/lines';

/** Uniqueness key: trimmed, lowercased, inner whitespace collapsed. */
export function normaliseTagName(raw: string): string {
	return raw.trim().toLowerCase().replace(/\s+/gu, ' ');
}

export interface TagRefs {
	transactionTags: { transactionId: string; tagId: string }[];
	splitTags: { splitId: string; tagId: string }[];
}

/**
 * Tag totals, as tagId → currency → summed minor units.
 *
 * A transaction-level tag covers every line of its transaction; a split-level
 * tag covers only its own line. When both carry the same tag the transaction
 * counts once, which is the only place a tag total could silently inflate.
 */
export function rollUpTagTotals(
	txns: (LineSource & { id: string; currency: string })[],
	splits: Map<string, SplitSource[]>,
	refs: TagRefs
): Map<string, Map<string, bigint>> {
	const byId = new Map(txns.map((t) => [t.id, t]));
	const out = new Map<string, Map<string, bigint>>();

	const add = (tagId: string, currency: string, amount: bigint) => {
		const perCurrency = out.get(tagId) ?? new Map<string, bigint>();
		perCurrency.set(currency, (perCurrency.get(currency) ?? 0n) + amount);
		out.set(tagId, perCurrency);
	};

	const wholeTagged = new Set<string>();
	for (const ref of refs.transactionTags) {
		const txn = byId.get(ref.transactionId);
		if (!txn) continue;
		wholeTagged.add(`${ref.transactionId} ${ref.tagId}`);
		for (const line of effectiveLines(txn, splits.get(txn.id) ?? [])) {
			add(ref.tagId, txn.currency, line.amountMinor);
		}
	}

	const parentOfSplit = new Map<string, string>();
	for (const [txnId, rows] of splits) {
		for (const row of rows) if (row.id) parentOfSplit.set(row.id, txnId);
	}
	for (const ref of refs.splitTags) {
		const txnId = parentOfSplit.get(ref.splitId);
		if (!txnId) continue;
		// Already counted whole, under this same tag.
		if (wholeTagged.has(`${txnId} ${ref.tagId}`)) continue;
		const txn = byId.get(txnId);
		if (!txn) continue;
		const line = effectiveLines(txn, splits.get(txnId) ?? []).find(
			(l) => l.splitId === ref.splitId
		);
		if (line) add(ref.tagId, txn.currency, line.amountMinor);
	}

	return out;
}

export async function upsertTag(name: string): Promise<{ id: string; name: string }> {
	const normalisedName = normaliseTagName(name);
	const existing = await db.select().from(tag).where(eq(tag.normalisedName, normalisedName));
	if (existing[0]) return { id: existing[0].id, name: existing[0].name };
	const row = { id: randomUUID(), name: name.trim(), normalisedName };
	await db.insert(tag).values(row).onConflictDoNothing();
	// A concurrent insert would have won the unique index; read back either way.
	const after = await db.select().from(tag).where(eq(tag.normalisedName, normalisedName));
	return { id: after[0].id, name: after[0].name };
}

/** The caller passes the complete desired set; the join rows are replaced. */
export async function setTransactionTags(transactionId: string, names: string[]): Promise<void> {
	const wanted = names.map((n) => n.trim()).filter(Boolean);
	const tags = [];
	for (const name of wanted) tags.push(await upsertTag(name));

	await db.delete(transactionTag).where(eq(transactionTag.transactionId, transactionId));
	if (tags.length > 0) {
		await db
			.insert(transactionTag)
			.values(tags.map((t) => ({ transactionId, tagId: t.id })))
			.onConflictDoNothing();
	}
}

/**
 * Add tags without removing any. Rules use this rather than setTransactionTags:
 * a rule contributes tags, it does not own the transaction's whole set.
 */
export async function addTagsToTransaction(transactionId: string, tagIds: string[]): Promise<void> {
	if (tagIds.length === 0) return;
	await db
		.insert(transactionTag)
		.values(tagIds.map((tagId) => ({ transactionId, tagId })))
		.onConflictDoNothing();
}

export async function setSplitTags(splitId: string, names: string[]): Promise<void> {
	const wanted = names.map((n) => n.trim()).filter(Boolean);
	const tags = [];
	for (const name of wanted) tags.push(await upsertTag(name));

	await db.delete(transactionSplitTag).where(eq(transactionSplitTag.splitId, splitId));
	if (tags.length > 0) {
		await db
			.insert(transactionSplitTag)
			.values(tags.map((t) => ({ splitId, tagId: t.id })))
			.onConflictDoNothing();
	}
}

/** Tag names attached to each of the given transactions, directly or via a split. */
export async function loadTagsFor(
	transactionIds: string[]
): Promise<Map<string, { id: string; name: string }[]>> {
	const out = new Map<string, { id: string; name: string }[]>();
	if (transactionIds.length === 0) return out;

	const direct = await db
		.select({ transactionId: transactionTag.transactionId, id: tag.id, name: tag.name })
		.from(transactionTag)
		.innerJoin(tag, eq(transactionTag.tagId, tag.id))
		.where(inArray(transactionTag.transactionId, transactionIds));

	for (const row of direct) {
		const list = out.get(row.transactionId) ?? [];
		list.push({ id: row.id, name: row.name });
		out.set(row.transactionId, list);
	}
	return out;
}

/** Every tag with its per-currency running total, heaviest first. */
export async function tagTotals(): Promise<
	{ id: string; name: string; totals: { currency: string; sumMinor: bigint }[] }[]
> {
	const [tags, txns, splitRows, txnTags, splitTags] = await Promise.all([
		db.select().from(tag).orderBy(tag.name),
		db
			.select({
				id: transaction.id,
				amount: transaction.amount,
				feeMinor: transaction.feeMinor,
				categoryId: transaction.categoryId,
				currency: transaction.currency
			})
			.from(transaction),
		db.select().from(transactionSplit),
		db.select().from(transactionTag),
		db.select().from(transactionSplitTag)
	]);

	const splits = new Map<string, SplitSource[]>();
	for (const row of splitRows) {
		const list = splits.get(row.transactionId) ?? [];
		list.push(row);
		splits.set(row.transactionId, list);
	}

	const totals = rollUpTagTotals(txns, splits, {
		transactionTags: txnTags,
		splitTags
	});

	return tags.map((t) => ({
		id: t.id,
		name: t.name,
		totals: [...(totals.get(t.id) ?? new Map<string, bigint>()).entries()]
			.map(([currency, sumMinor]) => ({ currency, sumMinor }))
			.sort((a, b) => (a.currency < b.currency ? -1 : 1))
	}));
}
