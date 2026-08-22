// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { asOptionalRowId, asRowId } from '$lib/ids';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { loadCategories } from '$lib/server/categorize/leaves';
import { account, tag } from '$lib/server/db/schema';
import { getBaseCurrency } from '$lib/server/settings';
import { fileTransaction, registerPage } from '$lib/server/transactions';
import { deleteSplits, loadSplits, saveSplits } from '$lib/server/splits';
import {
	loadSplitTagsFor,
	loadTagsFor,
	setSplitTagSets,
	updateTransactionTags
} from '$lib/server/tags';
import {
	DEFAULT_PAGE_SIZE,
	PAGE_SIZES,
	parseFilter,
	REVIEW_STATES
} from '$lib/transactions/filter';
import {
	INFERRED_SOURCES,
	PROOF_LABELS,
	SOURCE_LABELS,
	sourceLabel
} from '$lib/transactions/provenance';
import { loadCategoryGroups } from '$lib/server/categorize/groups';
import {
	attachDocumentToTransaction,
	detachDocumentFromTransaction,
	loadTransactionDocuments
} from '$lib/server/transactions/documents';
import { createDocument, deleteDocument } from '$lib/server/documents/mutations';
import { saveUpload } from '$lib/server/system/files';
import { uuidv7 } from 'uuidv7';
import { extname } from 'node:path';
import { displayCurrency, formatMinor, parseAmountToMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const baseCurrency = await getBaseCurrency();
	const filter = parseFilter(url.searchParams, baseCurrency);

	const [page, categories, accounts] = await Promise.all([
		registerPage(filter),
		loadCategories(),
		db
			.select({ id: account.id, name: account.name, currency: account.currency })
			.from(account)
			.orderBy(account.createdAt, account.id)
	]);

	const categoryName = new Map(categories.map((c) => [c.id, c.name]));
	const rowIds = page.rows.map((r) => r.id);
	const [splitsByTxn, tagsByTxn, splitTagsBySplit, knownTags, docsByTxn] = await Promise.all([
		loadSplits(rowIds),
		loadTagsFor(rowIds),
		loadSplitTagsFor(rowIds),
		db.select({ id: tag.id, name: tag.name }).from(tag).orderBy(tag.name),
		loadTransactionDocuments(rowIds)
	]);

	/** A page link that carries every active filter forward. */
	const pageHref = (n: number) => {
		const params = new URLSearchParams(url.searchParams);
		params.set('page', String(n));
		return `?${params}`;
	};

	/**
	 * Switching page size returns to page one.
	 *
	 * Staying put would be arithmetic nobody asked for: page 6 of 50 is page 26
	 * of 10, and landing three hundred rows into the ledger is not what pressing
	 * "10" means.
	 */
	const sizeHref = (size: number) => {
		const params = new URLSearchParams(url.searchParams);
		params.set('per', String(size));
		params.delete('page');
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
				transferKind: r.transferKind,
				// Only shown when the structure was worked out rather than declared:
				// a row from a published format has nothing interesting to say here,
				// and saying it on every row would be noise.
				readAs: INFERRED_SOURCES.includes(r.sourceMethod as never)
					? sourceLabel(r.sourceMethod)
					: null,
				proofClass: r.proofClass,
				// The dialog works in the transaction's own currency and needs the
				// raw figure to compute a remainder against.
				currency: r.currency,
				// Magnitudes: the dialog divides "how much", and the direction comes
				// from the parent transaction on save.
				amountMajor: formatMinor(r.amount < 0n ? -r.amount : r.amount, r.currency),
				tags: tagsByTxn.get(r.id) ?? [],
				documents: docsByTxn.get(r.id) ?? [],
				isSplit: splits.length > 0,
				splits: splits.map((s) => ({
					id: s.id,
					amount: `${formatMinor(s.amountMinor, r.currency, { signed: true })} ${displayCurrency(r.currency)}`,
					// Coloured like the transaction it divides: a split line reading in
					// neutral grey under a red parent looks like a different kind of
					// figure rather than a share of the same one.
					negative: s.amountMinor < 0n,
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
		pageSize: filter.pageSize,
		defaultPageSize: DEFAULT_PAGE_SIZE,
		pageSizes: PAGE_SIZES.map((size) => ({
			size,
			href: sizeHref(size),
			active: size === filter.pageSize
		})),
		knownTags,
		reviewStates: REVIEW_STATES,
		// Offered as a filter because these are the readings whose structure was
		// worked out rather than declared — the ones worth being able to review.
		sourceMethods: INFERRED_SOURCES.map((method) => ({
			value: method,
			label: SOURCE_LABELS[method] ?? method
		})),
		proofLabels: PROOF_LABELS,
		accounts,
		categories: (await loadCategoryGroups())
			.map((group) => ({
				key: group.key,
				label: group.label,
				items: categories.filter((c) => c.groupKey === group.key)
			}))
			.filter((g) => g.items.length > 0)
	};
};

export const actions: Actions = {
	file: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		const result = await fileTransaction(id, String(form.get('categoryId') ?? ''));
		// The id travels with the failure so the screen can render the message
		// against the row that produced it rather than in a banner at the top,
		// where it read as unrelated to the button that was just pressed.
		if (!result.ok) return fail(result.status, { id, message: result.message });
		return { ok: true };
	},

	/**
	 * Attach a receipt to a transaction.
	 *
	 * Either a file, which becomes a document on the receipts shelf and is then
	 * linked, or a document already in the household's files. No schema work
	 * behind it: `document_link` targets any entity and a transaction is one.
	 */
	attachDocument: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		const existingId = String(form.get('documentId') ?? '').trim();

		if (existingId) {
			const linked = await attachDocumentToTransaction(id, existingId);
			if (!linked.ok) return fail(linked.status, { id, message: linked.message });
			return { ok: true };
		}

		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { id, message: 'Choose a file, or a document you already have.' });
		}
		let storedName: string;
		try {
			storedName = await saveUpload(file);
		} catch (err) {
			return fail(400, { id, message: err instanceof Error ? err.message : 'Upload failed.' });
		}

		const documentId = uuidv7();
		await createDocument({
			id: documentId,
			name: file.name || 'Receipt',
			shelf: 'family',
			storedName,
			ext: extname(file.name).replace('.', '').toUpperCase() || 'PDF',
			addedOn: new Date().toISOString().slice(0, 10),
			expiresOn: null,
			expiryVerb: 'expires',
			personIds: [],
			propertyIds: [],
			accountIds: [],
			// Linked in the same aggregate the documents screen uses, so the file and
			// its link commit together or not at all.
			transactionIds: [id],
			subjectIds: [],
			// Also filed under a subject, and this is not decoration. The documents
			// screen builds its columns from people, properties, accounts and
			// subjects — a document linked only to a transaction would appear in no
			// column at all, so a receipt you just attached would be missing from
			// your own files. The subject is upserted by name, so they collect in
			// one place.
			newSubjectName: 'Receipts',
			tagNames: ['receipt']
		});
		return { ok: true };
	},

	/**
	 * Remove a receipt from a transaction.
	 *
	 * This deletes the document, not just the link. Unlinking only left the file
	 * on the Documents shelf with no way to reach it from the row it came from
	 * and — until now — no way to delete it there either, so every removed
	 * receipt became litter nobody could clear.
	 *
	 * The control says "Delete" and asks twice, because this is not local to the
	 * transaction: a receipt filed against something else as well goes from there
	 * too.
	 */
	detachDocument: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		const documentId = String(form.get('documentId') ?? '').trim();
		if (!documentId) return fail(400, { id, message: 'Which receipt?' });

		// Unlink first: if the document is already gone, the row must still end up
		// without a dangling reference to it.
		await detachDocumentFromTransaction(id, documentId);
		await deleteDocument(documentId);
		return { ok: true };
	},

	split: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
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
		const result = await deleteSplits(asRowId(form.get('id')));
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	// Tags are set as a whole set, so adding and removing are the same action.
	tags: async ({ request }) => {
		const form = await request.formData();
		const id = asOptionalRowId(form.get('id'));
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
