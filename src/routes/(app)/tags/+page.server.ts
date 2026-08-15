import { db } from '$lib/server/db';
import { document, documentTag, property, propertyTag } from '$lib/server/db/schema';
import { convertedTagTotal, tagTotals } from '$lib/server/tags';
import { getBaseCurrency } from '$lib/server/settings';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { displayCurrency, formatMinor } from '$lib/money';
import type { PageServerLoad } from './$types';

/** Inline list cap: the items themselves, "+N more" only past this. */
const INLINE = 5;

export const load: PageServerLoad = async () => {
	const [totals, base, rates, docTagRows, propTagRows, docs, properties] = await Promise.all([
		tagTotals(),
		getBaseCurrency(),
		loadRateTable(),
		db.select().from(documentTag),
		db.select().from(propertyTag),
		db.select({ id: document.id, name: document.name, file: document.storedName }).from(document),
		db.select({ id: property.id, name: property.name }).from(property)
	]);
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
				return {
					id: t.id,
					name: t.name,
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
};
