// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What the Tags view shows: every tag, what it is on, and what it has cost.
 *
 * Lived on its own screen under Money; a tag is a cross-cut over transactions
 * AND documents, and the household files paper far more often than it audits
 * project totals, so the view now sits in the Documents rail. The loader is
 * separate from either route so the view can move again without being copied.
 */
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	document,
	loan,
	property,
	tagLink,
	transaction,
	transactionSplit
} from '$lib/server/db/schema';
import { visibleDocumentPredicate, type Actor } from '$lib/server/documents/visibility';
import { convertedTagTotal, tagTotals, tagUsage } from '$lib/server/tags';
import { getBaseCurrency } from '$lib/server/settings';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { displayCurrency, formatMinor } from '$lib/money';

/** Inline list cap: the items themselves, "+N more" only past this. */
const INLINE = 5;

/**
 * The view, as one reader may see it.
 *
 * Every document select below carries the read rule, and so does the usage
 * count: a tag showing five documents but saying "6 tagged" would have told a
 * member the sixth exists, which is the fact the rule protects.
 */
export async function loadTagsScreen(actor: Actor | null) {
	const [
		totals,
		usage,
		base,
		rates,
		docTagRows,
		propTagRows,
		loanTagRows,
		txnTagRows,
		splitTagRows,
		docs,
		properties,
		loans
	] = await Promise.all([
		tagTotals(),
		tagUsage(actor),
		getBaseCurrency(),
		loadRateTable(),
		db
			.select({ documentId: tagLink.targetId, tagId: tagLink.tagId })
			.from(tagLink)
			.innerJoin(document, eq(document.id, tagLink.targetId))
			.where(visibleDocumentPredicate(actor)),
		db
			.select({ propertyId: tagLink.targetId, tagId: tagLink.tagId })
			.from(tagLink)
			.innerJoin(property, eq(property.id, tagLink.targetId)),
		// A loan is not a document — nothing D2 covers hides one — so, unlike the
		// two selects above, this carries no visibility predicate.
		db
			.select({ loanId: tagLink.targetId, tagId: tagLink.tagId })
			.from(tagLink)
			.innerJoin(loan, eq(loan.id, tagLink.targetId)),
		// A tag applied to a whole transaction — the ordinary path, `setTransactionTags`
		// / `updateTransactionTags` — has no card of its own to list either: there is
		// no name to show beside a property or a document. Counted here, separately
		// from the split select below, so it is reported rather than silently
		// dropped from both the list and the count.
		db
			.select({ transactionId: tagLink.targetId, tagId: tagLink.tagId })
			.from(tagLink)
			.innerJoin(transaction, eq(transaction.id, tagLink.targetId)),
		// A tag on one split line of a transaction has no card of its own to list —
		// it is money-only, already inside the figures below. Counted here so the
		// household is told the line exists rather than the tag looking orphaned
		// when every place it touches is a split.
		db
			.select({ splitId: tagLink.targetId, tagId: tagLink.tagId })
			.from(tagLink)
			.innerJoin(transactionSplit, eq(transactionSplit.id, tagLink.targetId)),
		db
			.select({ id: document.id, name: document.name, file: document.storedName })
			.from(document)
			.where(visibleDocumentPredicate(actor)),
		db.select({ id: property.id, name: property.name }).from(property),
		db.select({ id: loan.id, name: loan.name }).from(loan)
	]);
	const docById = new Map(docs.map((d) => [d.id, d]));
	const propById = new Map(properties.map((p) => [p.id, p]));
	const loanById = new Map(loans.map((l) => [l.id, l]));

	return {
		baseCurrency: displayCurrency(base),
		tags: totals
			.map((t) => {
				// Native buckets remain useful context, but the combined figure is
				// built from dated effective lines. Converting a historical USD bucket
				// at today's rate rewrites the past whenever exchange rates move.
				const convertedMinor = convertedTagTotal(t.amounts, base, (amount, from, to, day) =>
					convertOrFace(rates, amount, from, to, day)
				);
				const taggedDocs = docTagRows
					.filter((r) => r.tagId === t.id)
					.map((r) => docById.get(r.documentId))
					.filter((d) => d !== undefined);
				const taggedProps = propTagRows
					.filter((r) => r.tagId === t.id)
					.map((r) => propById.get(r.propertyId))
					.filter((p) => p !== undefined);
				const taggedLoans = loanTagRows
					.filter((r) => r.tagId === t.id)
					.map((r) => loanById.get(r.loanId))
					.filter((l) => l !== undefined);
				const transactions = txnTagRows.filter((r) => r.tagId === t.id).length;
				const splitLines = splitTagRows.filter((r) => r.tagId === t.id).length;
				const used = usage.get(t.id) ?? { tagged: 0, rules: 0 };
				return {
					id: t.id,
					name: t.name,
					// The headline figure: exactly the three lists rendered below, so it
					// can never run ahead of what is actually listed — a member must not
					// be able to infer a restricted document from a count that is one too
					// high. A whole transaction or a split has no card here to be "listed"
					// at all, so neither counts towards this number; both are reported
					// separately below instead of being silently dropped.
					tagged: taggedDocs.length + taggedProps.length + taggedLoans.length,
					rules: used.rules,
					// Unlisted carriers, reported separately so the household is told they
					// exist rather than a tag used only on one of these looking unused.
					// `TagsPanel`'s delete confirmation totals `tagged + transactions +
					// splitLines` — every carrier the delete actually removes — since a
					// delete is never gated on what happens to be shown as a chip.
					transactions,
					splitLines,
					// The items, inline — a count is not a link.
					documents: taggedDocs.slice(0, INLINE),
					documentsMore: Math.max(0, taggedDocs.length - INLINE),
					properties: taggedProps.slice(0, INLINE),
					propertiesMore: Math.max(0, taggedProps.length - INLINE),
					loans: taggedLoans.slice(0, INLINE),
					loansMore: Math.max(0, taggedLoans.length - INLINE),
					parts: t.totals.map((part) => ({
						amount: `${formatMinor(part.sumMinor, part.currency, { signed: true })} ${displayCurrency(part.currency)}`
					})),
					converted: `${formatMinor(convertedMinor, base, { signed: true })} ${displayCurrency(base)}`,
					mixed: t.totals.length > 1,
					empty: t.totals.length === 0
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name))
	};
}

export type TagsScreen = Awaited<ReturnType<typeof loadTagsScreen>>;
