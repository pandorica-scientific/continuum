// Tags group transactions and split lines into projects — a renovation, a
// holiday — and every tag carries a running total. They hold no tax meaning;
// tax treatment belongs to the tax module, not here.

import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db, type Db, type Queryable } from '$lib/server/db';
import {
	loan,
	loanTag,
	property,
	propertyTag,
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

export interface TaggedAmount {
	amountMinor: bigint;
	currency: string;
	/** The transaction's value date when present, otherwise its booking date. */
	day: string;
}

type DatedTransaction = LineSource & {
	id: string;
	currency: string;
	bookedAt?: string;
	valueDate?: string | null;
};

/**
 * Resolve tag coverage without throwing away the date of each effective line.
 * Native-currency totals can be derived from these rows, and FX conversion can
 * use the rate that actually applied when the money moved.
 */
export function rollUpTaggedAmounts(
	txns: DatedTransaction[],
	splits: Map<string, SplitSource[]>,
	refs: TagRefs
): Map<string, TaggedAmount[]> {
	const byId = new Map(txns.map((txn) => [txn.id, txn]));
	const out = new Map<string, TaggedAmount[]>();
	const add = (tagId: string, txn: DatedTransaction, amountMinor: bigint) => {
		const amounts = out.get(tagId) ?? [];
		amounts.push({
			amountMinor,
			currency: txn.currency,
			day: txn.valueDate ?? txn.bookedAt ?? ''
		});
		out.set(tagId, amounts);
	};

	const wholeTagged = new Set<string>();
	for (const ref of refs.transactionTags) {
		const txn = byId.get(ref.transactionId);
		if (!txn) continue;
		wholeTagged.add(`${ref.transactionId} ${ref.tagId}`);
		for (const line of effectiveLines(txn, splits.get(txn.id) ?? [])) {
			add(ref.tagId, txn, line.amountMinor);
		}
	}

	const parentOfSplit = new Map<string, string>();
	for (const [transactionId, rows] of splits) {
		for (const row of rows) if (row.id) parentOfSplit.set(row.id, transactionId);
	}
	for (const ref of refs.splitTags) {
		const transactionId = parentOfSplit.get(ref.splitId);
		if (!transactionId || wholeTagged.has(`${transactionId} ${ref.tagId}`)) continue;
		const txn = byId.get(transactionId);
		if (!txn) continue;
		const line = effectiveLines(txn, splits.get(transactionId) ?? []).find(
			(candidate) => candidate.splitId === ref.splitId
		);
		if (line) add(ref.tagId, txn, line.amountMinor);
	}

	return out;
}

export function convertedTagTotal(
	amounts: TaggedAmount[],
	baseCurrency: string,
	convert: (amount: bigint, from: string, to: string, day: string) => bigint
): bigint {
	return amounts.reduce(
		(sum, amount) => sum + convert(amount.amountMinor, amount.currency, baseCurrency, amount.day),
		0n
	);
}

/**
 * Tag totals, as tagId → currency → summed minor units.
 *
 * A transaction-level tag covers every line of its transaction; a split-level
 * tag covers only its own line. When both carry the same tag the transaction
 * counts once, which is the only place a tag total could silently inflate.
 */
export function rollUpTagTotals(
	txns: DatedTransaction[],
	splits: Map<string, SplitSource[]>,
	refs: TagRefs
): Map<string, Map<string, bigint>> {
	const out = new Map<string, Map<string, bigint>>();
	for (const [tagId, amounts] of rollUpTaggedAmounts(txns, splits, refs)) {
		const perCurrency = out.get(tagId) ?? new Map<string, bigint>();
		for (const amount of amounts) {
			perCurrency.set(
				amount.currency,
				(perCurrency.get(amount.currency) ?? 0n) + amount.amountMinor
			);
		}
		out.set(tagId, perCurrency);
	}
	return out;
}

export async function upsertTag(
	name: string,
	handle: Queryable = db
): Promise<{ id: string; name: string }> {
	const normalisedName = normaliseTagName(name);
	const existing = await handle.select().from(tag).where(eq(tag.normalisedName, normalisedName));
	if (existing[0]) return { id: existing[0].id, name: existing[0].name };
	const row = { id: randomUUID(), name: name.trim(), normalisedName };
	await handle.insert(tag).values(row).onConflictDoNothing();
	// A concurrent insert would have won the unique index; read back either way.
	const after = await handle.select().from(tag).where(eq(tag.normalisedName, normalisedName));
	return { id: after[0].id, name: after[0].name };
}

function wantedNames(names: string[]): string[] {
	const unique = new Map<string, string>();
	for (const raw of names) {
		const name = raw.trim();
		if (name) unique.set(normaliseTagName(name), name);
	}
	return [...unique.values()];
}

export interface TagDelta {
	add?: string;
	remove?: string;
}

/** Apply one UI add/remove intent by the same normalized identity tags store. */
export function applyTagDelta(existingNames: string[], delta: TagDelta): string[] {
	const removed = delta.remove ? normaliseTagName(delta.remove) : null;
	const names = existingNames.filter((name) => !removed || normaliseTagName(name) !== removed);
	const added = delta.add?.trim();
	if (added && !names.some((name) => normaliseTagName(name) === normaliseTagName(added))) {
		names.push(added);
	}
	return wantedNames(names);
}

/** One implementation for every wholesale tag replacement. */
async function replaceTagSet(
	names: string[],
	handle: Queryable,
	remove: () => Promise<unknown>,
	insert: (tagIds: string[]) => Promise<unknown>
): Promise<void> {
	const resolved = [];
	for (const name of wantedNames(names)) resolved.push(await upsertTag(name, handle));
	await remove();
	if (resolved.length > 0) await insert(resolved.map((item) => item.id));
}

async function withinTransaction<T>(
	handle: Queryable,
	operation: (tx: Queryable) => Promise<T>
): Promise<T> {
	const transactional = handle as Db;
	return typeof transactional.transaction === 'function'
		? transactional.transaction((tx) => operation(tx))
		: operation(handle);
}

interface TagDeltaOperations {
	lockOwner: (handle: Queryable) => Promise<unknown>;
	loadNames: (handle: Queryable) => Promise<{ name: string }[]>;
	remove: (handle: Queryable) => Promise<unknown>;
	insert: (handle: Queryable, tagIds: string[]) => Promise<unknown>;
}

/** Serialize a UI delta on its owner, then replace the relation in one commit. */
async function updateTagRelation(
	delta: TagDelta,
	handle: Queryable,
	operations: TagDeltaOperations
): Promise<void> {
	await withinTransaction(handle, async (tx) => {
		await operations.lockOwner(tx);
		const existing = await operations.loadNames(tx);
		await replaceTagSet(
			applyTagDelta(
				existing.map((row) => row.name),
				delta
			),
			tx,
			() => operations.remove(tx),
			(tagIds) => operations.insert(tx, tagIds)
		);
	});
}

/** The caller passes the complete desired set; the join rows are replaced. */
export async function setTransactionTags(
	transactionId: string,
	names: string[],
	handle: Queryable = db
): Promise<void> {
	await withinTransaction(handle, (tx) =>
		replaceTagSet(
			names,
			tx,
			() => tx.delete(transactionTag).where(eq(transactionTag.transactionId, transactionId)),
			(tagIds) =>
				tx
					.insert(transactionTag)
					.values(tagIds.map((tagId) => ({ transactionId, tagId })))
					.onConflictDoNothing()
		)
	);
}

export async function updateTransactionTags(
	transactionId: string,
	delta: TagDelta,
	handle: Queryable = db
): Promise<void> {
	await updateTagRelation(delta, handle, {
		lockOwner: (tx) =>
			tx
				.select({ id: transaction.id })
				.from(transaction)
				.where(eq(transaction.id, transactionId))
				.for('update'),
		loadNames: (tx) =>
			tx
				.select({ name: tag.name })
				.from(transactionTag)
				.innerJoin(tag, eq(transactionTag.tagId, tag.id))
				.where(eq(transactionTag.transactionId, transactionId)),
		remove: (tx) =>
			tx.delete(transactionTag).where(eq(transactionTag.transactionId, transactionId)),
		insert: (tx, tagIds) =>
			tx
				.insert(transactionTag)
				.values(tagIds.map((tagId) => ({ transactionId, tagId })))
				.onConflictDoNothing()
	});
}

/**
 * Add tags without removing any. Rules use this rather than setTransactionTags:
 * a rule contributes tags, it does not own the transaction's whole set.
 */
export async function addTagsToTransaction(
	transactionId: string,
	tagIds: string[],
	handle: Queryable = db
): Promise<void> {
	if (tagIds.length === 0) return;
	await handle
		.insert(transactionTag)
		.values(tagIds.map((tagId) => ({ transactionId, tagId })))
		.onConflictDoNothing();
}

/** Same wholesale-replace contract as transactions, for loans. */
export async function setLoanTags(
	loanId: string,
	names: string[],
	handle: Queryable = db
): Promise<void> {
	await withinTransaction(handle, (tx) =>
		replaceTagSet(
			names,
			tx,
			() => tx.delete(loanTag).where(eq(loanTag.loanId, loanId)),
			(tagIds) =>
				tx
					.insert(loanTag)
					.values(tagIds.map((tagId) => ({ loanId, tagId })))
					.onConflictDoNothing()
		)
	);
}

export async function updateLoanTags(
	loanId: string,
	delta: TagDelta,
	handle: Queryable = db
): Promise<void> {
	await updateTagRelation(delta, handle, {
		lockOwner: (tx) =>
			tx.select({ id: loan.id }).from(loan).where(eq(loan.id, loanId)).for('update'),
		loadNames: (tx) =>
			tx
				.select({ name: tag.name })
				.from(loanTag)
				.innerJoin(tag, eq(loanTag.tagId, tag.id))
				.where(eq(loanTag.loanId, loanId)),
		remove: (tx) => tx.delete(loanTag).where(eq(loanTag.loanId, loanId)),
		insert: (tx, tagIds) =>
			tx
				.insert(loanTag)
				.values(tagIds.map((tagId) => ({ loanId, tagId })))
				.onConflictDoNothing()
	});
}

/** Same wholesale-replace contract as transactions, for properties. */
export async function setPropertyTags(
	propertyId: string,
	names: string[],
	handle: Queryable = db
): Promise<void> {
	await withinTransaction(handle, (tx) =>
		replaceTagSet(
			names,
			tx,
			() => tx.delete(propertyTag).where(eq(propertyTag.propertyId, propertyId)),
			(tagIds) =>
				tx
					.insert(propertyTag)
					.values(tagIds.map((tagId) => ({ propertyId, tagId })))
					.onConflictDoNothing()
		)
	);
}

export async function updatePropertyTags(
	propertyId: string,
	delta: TagDelta,
	handle: Queryable = db
): Promise<void> {
	await updateTagRelation(delta, handle, {
		lockOwner: (tx) =>
			tx
				.select({ id: property.id })
				.from(property)
				.where(eq(property.id, propertyId))
				.for('update'),
		loadNames: (tx) =>
			tx
				.select({ name: tag.name })
				.from(propertyTag)
				.innerJoin(tag, eq(propertyTag.tagId, tag.id))
				.where(eq(propertyTag.propertyId, propertyId)),
		remove: (tx) => tx.delete(propertyTag).where(eq(propertyTag.propertyId, propertyId)),
		insert: (tx, tagIds) =>
			tx
				.insert(propertyTag)
				.values(tagIds.map((tagId) => ({ propertyId, tagId })))
				.onConflictDoNothing()
	});
}

async function replaceSplitTags(
	splitId: string,
	names: string[],
	handle: Queryable
): Promise<void> {
	await replaceTagSet(
		names,
		handle,
		() => handle.delete(transactionSplitTag).where(eq(transactionSplitTag.splitId, splitId)),
		(tagIds) =>
			handle
				.insert(transactionSplitTag)
				.values(tagIds.map((tagId) => ({ splitId, tagId })))
				.onConflictDoNothing()
	);
}

export async function setSplitTags(
	splitId: string,
	names: string[],
	handle: Queryable = db
): Promise<void> {
	await withinTransaction(handle, (tx) => replaceSplitTags(splitId, names, tx));
}

/** Replace several split lines' tag sets in one commit. */
export async function setSplitTagSets(
	sets: { splitId: string; names: string[] }[],
	handle: Queryable = db
): Promise<void> {
	await withinTransaction(handle, async (tx) => {
		for (const set of sets) await replaceSplitTags(set.splitId, set.names, tx);
	});
}

/** Tag names attached to each of the given transactions, directly or via a split. */
export interface LoadedTag {
	id: string;
	name: string;
	direct: boolean;
	split: boolean;
}

export async function loadTagsFor(
	transactionIds: string[],
	handle: Queryable = db
): Promise<Map<string, LoadedTag[]>> {
	const out = new Map<string, LoadedTag[]>();
	if (transactionIds.length === 0) return out;

	const [direct, throughSplits] = await Promise.all([
		handle
			.select({ transactionId: transactionTag.transactionId, id: tag.id, name: tag.name })
			.from(transactionTag)
			.innerJoin(tag, eq(transactionTag.tagId, tag.id))
			.where(inArray(transactionTag.transactionId, transactionIds)),
		handle
			.select({ transactionId: transactionSplit.transactionId, id: tag.id, name: tag.name })
			.from(transactionSplitTag)
			.innerJoin(transactionSplit, eq(transactionSplitTag.splitId, transactionSplit.id))
			.innerJoin(tag, eq(transactionSplitTag.tagId, tag.id))
			.where(inArray(transactionSplit.transactionId, transactionIds))
	]);

	const append = (
		row: { transactionId: string; id: string; name: string },
		source: 'direct' | 'split'
	) => {
		const list = out.get(row.transactionId) ?? [];
		const existing = list.find((item) => item.id === row.id);
		if (existing) existing[source] = true;
		else
			list.push({
				id: row.id,
				name: row.name,
				direct: source === 'direct',
				split: source === 'split'
			});
		out.set(row.transactionId, list);
	};
	for (const row of direct) append(row, 'direct');
	for (const row of throughSplits) append(row, 'split');
	for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

/** Split-line tag names for the editor, loaded for a page in one query. */
export async function loadSplitTagsFor(
	transactionIds: string[],
	handle: Queryable = db
): Promise<Map<string, { id: string; name: string }[]>> {
	const out = new Map<string, { id: string; name: string }[]>();
	if (transactionIds.length === 0) return out;
	const rows = await handle
		.select({ splitId: transactionSplitTag.splitId, id: tag.id, name: tag.name })
		.from(transactionSplitTag)
		.innerJoin(transactionSplit, eq(transactionSplitTag.splitId, transactionSplit.id))
		.innerJoin(tag, eq(transactionSplitTag.tagId, tag.id))
		.where(inArray(transactionSplit.transactionId, transactionIds));
	for (const row of rows) {
		const list = out.get(row.splitId) ?? [];
		if (!list.some((item) => item.id === row.id)) list.push({ id: row.id, name: row.name });
		out.set(row.splitId, list);
	}
	for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

/** Every tag with its per-currency running total, heaviest first. */
export async function tagTotals(handle: Queryable = db): Promise<
	{
		id: string;
		name: string;
		totals: { currency: string; sumMinor: bigint }[];
		amounts: TaggedAmount[];
	}[]
> {
	const [tags, txns, splitRows, txnTags, splitTags] = await Promise.all([
		handle.select().from(tag).orderBy(tag.name),
		handle
			.select({
				id: transaction.id,
				bookedAt: transaction.bookedAt,
				valueDate: transaction.valueDate,
				amount: transaction.amount,
				feeMinor: transaction.feeMinor,
				categoryId: transaction.categoryId,
				currency: transaction.currency
			})
			// Transfer legs stay in. Excluding them is right for cash flow, where a
			// move between own accounts is not income or spending, but a tag is a
			// deliberate filing decision: tagging the outgoing leg of a move to
			// track money set aside must not silently total zero while the chip is
			// still rendered on the row in the register.
			.from(transaction),
		handle.select().from(transactionSplit),
		handle.select().from(transactionTag),
		handle.select().from(transactionSplitTag)
	]);

	const splits = new Map<string, SplitSource[]>();
	for (const row of splitRows) {
		const list = splits.get(row.transactionId) ?? [];
		list.push(row);
		splits.set(row.transactionId, list);
	}

	const refs = {
		transactionTags: txnTags,
		splitTags
	};
	const totals = rollUpTagTotals(txns, splits, refs);
	const amounts = rollUpTaggedAmounts(txns, splits, refs);

	return tags.map((t) => ({
		id: t.id,
		name: t.name,
		amounts: amounts.get(t.id) ?? [],
		totals: [...(totals.get(t.id) ?? new Map<string, bigint>()).entries()]
			.map(([currency, sumMinor]) => ({ currency, sumMinor }))
			.sort((a, b) => (a.currency < b.currency ? -1 : 1))
	}));
}
