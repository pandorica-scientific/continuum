// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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
import { document, property, tagLink } from '$lib/server/db/schema';
import { convertedTagTotal, tagTotals, tagUsage } from '$lib/server/tags';
import { getBaseCurrency } from '$lib/server/settings';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { displayCurrency, formatMinor } from '$lib/money';

/** Inline list cap: the items themselves, "+N more" only past this. */
const INLINE = 5;

export async function loadTagsScreen() {
	const [totals, usage, base, rates, docTagRows, propTagRows, docs, properties] = await Promise.all(
		[
			tagTotals(),
			tagUsage(),
			getBaseCurrency(),
			loadRateTable(),
			db
				.select({ documentId: tagLink.targetId, tagId: tagLink.tagId })
				.from(tagLink)
				.innerJoin(document, eq(document.id, tagLink.targetId)),
			db
				.select({ propertyId: tagLink.targetId, tagId: tagLink.tagId })
				.from(tagLink)
				.innerJoin(property, eq(property.id, tagLink.targetId)),
			db.select({ id: document.id, name: document.name, file: document.storedName }).from(document),
			db.select({ id: property.id, name: property.name }).from(property)
		]
	);
	const docById = new Map(docs.map((d) => [d.id, d]));
	const propById = new Map(properties.map((p) => [p.id, p]));

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
				const used = usage.get(t.id) ?? { tagged: 0, rules: 0 };
				return {
					id: t.id,
					name: t.name,
					// What a delete would untag, so the confirmation can say it rather
					// than leaving the reader to guess. Rules are the invisible half:
					// one that applied this tag quietly stops applying it.
					tagged: used.tagged,
					rules: used.rules,
					// The items, inline — a count is not a link.
					documents: taggedDocs.slice(0, INLINE),
					documentsMore: Math.max(0, taggedDocs.length - INLINE),
					properties: taggedProps.slice(0, INLINE),
					propertiesMore: Math.max(0, taggedProps.length - INLINE),
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
