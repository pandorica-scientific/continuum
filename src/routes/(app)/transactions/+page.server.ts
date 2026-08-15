import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { account, category, tag } from '$lib/server/db/schema';
import { getBaseCurrency } from '$lib/server/settings';
import { fileTransaction, PAGE_SIZE, registerPage } from '$lib/server/transactions';
import { deleteSplits, loadSplits, saveSplits } from '$lib/server/splits';
import {
	loadSplitTagsFor,
	loadTagsFor,
	setSplitTagSets,
	updateTransactionTags
} from '$lib/server/tags';
import { parseFilter, REVIEW_STATES } from '$lib/transactions/filter';
import { CATEGORY_GROUPS } from '$lib/categories';
import { displayCurrency, formatMinor, parseAmountToMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const baseCurrency = await getBaseCurrency();
	const filter = parseFilter(url.searchParams, baseCurrency);

	const [page, categories, accounts] = await Promise.all([
		registerPage(filter),
		db.select().from(category).orderBy(category.groupKey, category.sort),
		db
			.select({ id: account.id, name: account.name, currency: account.currency })
			.from(account)
			.orderBy(account.createdAt)
	]);

	const categoryName = new Map(categories.map((c) => [c.id, c.name]));
	const rowIds = page.rows.map((r) => r.id);
	const [splitsByTxn, tagsByTxn, splitTagsBySplit, knownTags] = await Promise.all([
		loadSplits(rowIds),
		loadTagsFor(rowIds),
		loadSplitTagsFor(rowIds),
		db.select({ id: tag.id, name: tag.name }).from(tag).orderBy(tag.name)
	]);

	/** A page link that carries every active filter forward. */
	const pageHref = (n: number) => {
		const params = new URLSearchParams(url.searchParams);
		params.set('page', String(n));
		return `?${params}`;
	};

	return {
		baseCurrency: displayCurrency(baseCurrency),
		prevHref: pageHref(Math.max(1, filter.page - 1)),
		nextHref: pageHref(Math.min(page.pageCount, filter.page + 1)),
		filter: {
			...filter,
			// Amount bounds go back to the form as the text the person typed.
			minMinor: filter.minMinor === null ? '' : formatMinor(filter.minMinor, baseCurrency),
			maxMinor: filter.maxMinor === null ? '' : formatMinor(filter.maxMinor, baseCurrency)
		},
		rows: page.rows.map((r) => {
			const splits = (splitsByTxn.get(r.id) ?? []).sort((a, b) => a.sort - b.sort);
			return {
				id: r.id,
				date: r.bookedAt,
				merchant: r.counterparty ?? r.description ?? '—',
				detail: r.counterparty && r.description ? r.description : null,
				amount: `${formatMinor(r.amount, r.currency, { signed: true })} ${displayCurrency(r.currency)}`,
				negative: r.amount < 0n,
				categoryId: r.categoryId,
				categoryLabel: r.categoryLabel,
				reviewState: r.reviewState,
				account: r.accountName,
				isTransfer: r.isTransfer,
				// The dialog works in the transaction's own currency and needs the
				// raw figure to compute a remainder against.
				currency: r.currency,
				// Magnitudes: the dialog divides "how much", and the direction comes
				// from the parent transaction on save.
				amountMajor: formatMinor(r.amount < 0n ? -r.amount : r.amount, r.currency),
				tags: tagsByTxn.get(r.id) ?? [],
				isSplit: splits.length > 0,
				splits: splits.map((s) => ({
					id: s.id,
					amount: `${formatMinor(s.amountMinor, r.currency, { signed: true })} ${displayCurrency(r.currency)}`,
					amountMajor: formatMinor(s.amountMinor < 0n ? -s.amountMinor : s.amountMinor, r.currency),
					categoryId: s.categoryId,
					categoryLabel: s.categoryId ? (categoryName.get(s.categoryId) ?? null) : null,
					note: s.note,
					tags: splitTagsBySplit.get(s.id) ?? []
				}))
			};
		}),
		totals: page.totals.map((t) => ({
			currency: displayCurrency(t.currency),
			amount: formatMinor(t.sumMinor, t.currency, { signed: true })
		})),
		total: page.total,
		pageCount: page.pageCount,
		pageSize: PAGE_SIZE,
		knownTags,
		reviewStates: REVIEW_STATES,
		accounts,
		categories: CATEGORY_GROUPS.map((group) => ({
			key: group.key,
			label: group.label,
			items: categories.filter((c) => c.groupKey === group.key)
		})).filter((g) => g.items.length > 0)
	};
};

export const actions: Actions = {
	file: async ({ request }) => {
		const form = await request.formData();
		const result = await fileTransaction(
			String(form.get('id') ?? ''),
			String(form.get('categoryId') ?? '')
		);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	split: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const currency = String(form.get('currency') ?? '');
		const amounts = form.getAll('amount').map(String);
		const categoryIds = form.getAll('categoryId').map(String);
		const lineIds = form.getAll('lineId').map(String);
		const splitTagNames = form.getAll('splitTags').map(String);

		let lines;
		try {
			lines = amounts
				.map((raw, i) => ({
					raw: raw.trim(),
					categoryId: categoryIds[i] || null,
					tagNames: (splitTagNames[i] ?? '')
						.split(',')
						.map((name) => name.trim())
						.filter(Boolean),
					// Carries the stored row's id when this line is an edit of one,
					// so its tags follow the line and not its position.
					id: lineIds[i] || null
				}))
				.filter((l) => l.raw !== '')
				.map((l) => ({
					id: l.id,
					amountMinor: parseAmountToMinor(l.raw, currency),
					categoryId: l.categoryId,
					tagNames: l.tagNames
				}));
		} catch {
			return fail(400, { message: 'Every split line needs a valid amount.' });
		}

		const result = await saveSplits(
			id,
			lines.map((line) => ({
				id: line.id,
				amountMinor: line.amountMinor,
				categoryId: line.categoryId
			})),
			async (tx, saved) => {
				await setSplitTagSets(
					saved.map((line) => ({
						splitId: line.id,
						names: lines[line.sort]?.tagNames ?? []
					})),
					tx
				);
			}
		);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	unsplit: async ({ request }) => {
		const form = await request.formData();
		const result = await deleteSplits(String(form.get('id') ?? ''));
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	// Tags are set as a whole set, so adding and removing are the same action.
	tags: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { message: 'Missing transaction.' });

		const added = String(form.get('tagName') ?? '').trim();
		const removed = String(form.get('removeTag') ?? '').trim();
		await updateTransactionTags(id, {
			add: added || undefined,
			remove: removed || undefined
		});
		return { ok: true };
	}
};
