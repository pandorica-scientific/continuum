// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { asOptionalRowId, asRowId } from '$lib/ids';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { loadCategories } from '$lib/server/categorize/leaves';
import { account, tag } from '$lib/server/db/schema';
import { getBaseCurrency } from '$lib/server/settings';
import { fileTransaction, registerMonths, registerPage } from '$lib/server/transactions';
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
import { loadTransactionDocuments } from '$lib/server/transactions/documents';
import { attachDocument, candidateDocuments, detachDocument } from '$lib/server/documents/targets';
import { createDocument } from '$lib/server/documents/mutations';
import { removeDocument } from '$lib/server/documents/lifecycle';
import { systemShelfId } from '$lib/server/documents/shelves';
import { saveUploadAndHash } from '$lib/server/system/files';
import { uuidv7 } from 'uuidv7';
import { extname } from 'node:path';
import { displayCurrency, formatMinor, parseAmountToMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

/** A month as a person reads it — "July 2026", not "2026-07". */
function monthLabel(month: string): string {
	const [year, index] = month.split('-').map(Number);
	return `${new Date(Date.UTC(2000, index - 1, 1)).toLocaleString('en', { month: 'long' })} ${year}`;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const baseCurrency = await getBaseCurrency();
	const filter = parseFilter(url.searchParams, baseCurrency);

	const [months, categories, accounts, groups] = await Promise.all([
		registerMonths(filter),
		loadCategories(),
		db
			.select({ id: account.id, name: account.name, currency: account.currency })
			.from(account)
			.orderBy(account.createdAt, account.id),
		loadCategoryGroups()
	]);

	// Only the expanded month's transactions are read. The register lists a row
	// per month and opens one at a time, so loading every row it lists a month
	// for would mean fetching the whole ledger — with its splits, tags and
	// receipts — to draw a table of totals.
	const page = filter.month ? await registerPage(filter) : null;

	const categoryName = new Map(categories.map((c) => [c.id, c.name]));
	// A category's colour is its GROUP's: the dot on a row says which part of the
	// waterfall the money went to, which is the distinction the charts are
	// coloured by, so the two agree rather than each inventing a palette.
	const groupToken = new Map(groups.map((g) => [g.key, g.colorToken]));
	const tokenFor = (categoryId: string | null) => {
		const group = categoryId ? categories.find((c) => c.id === categoryId)?.groupKey : null;
		return (group && groupToken.get(group)) || '--fg3';
	};

	// Empty with no month open, and each of these returns without touching the
	// database on an empty id list — so a collapsed register costs one query for
	// the known tags and nothing else.
	const rowIds = page?.rows.map((r) => r.id) ?? [];
	const [splitsByTxn, tagsByTxn, splitTagsBySplit, knownTags, docsByTxn] = await Promise.all([
		loadSplits(rowIds),
		loadTagsFor(rowIds),
		loadSplitTagsFor(rowIds),
		db.select({ id: tag.id, name: tag.name }).from(tag).orderBy(tag.name),
		loadTransactionDocuments(rowIds, locals.person ?? null)
	]);

	/** A link that carries every active filter forward. */
	const href = (mutate: (params: URLSearchParams) => void) => {
		const params = new URLSearchParams(url.searchParams);
		mutate(params);
		const query = params.toString();
		return query ? `?${query}` : url.pathname;
	};

	const pageHref = (n: number) => href((params) => params.set('page', String(n)));

	/**
	 * Switching page size returns to page one.
	 *
	 * Staying put would be arithmetic nobody asked for: page 6 of 50 is page 26
	 * of 10, and landing three hundred rows into the ledger is not what pressing
	 * "10" means.
	 */
	const sizeHref = (size: number) =>
		href((params) => {
			params.set('per', String(size));
			params.delete('page');
		});

	/** Opens a month, or closes it when it is already the open one. */
	const monthHref = (month: string) =>
		href((params) => {
			if (filter.month === month) params.delete('month');
			else params.set('month', month);
			// The inner pager belongs to the month it was paging. Carrying page 4
			// into a month with one page would open it on nothing at all.
			params.delete('page');
		});

	// Per currency, over every month listed. Two currencies in one month are two
	// facts; adding them would invent a third that is true in neither.
	const byCurrency = new Map<string, { in: bigint; out: bigint; ceiling: bigint }>();
	for (const m of months) {
		for (const c of m.byCurrency) {
			const running = byCurrency.get(c.currency) ?? { in: 0n, out: 0n, ceiling: 0n };
			const volume = c.inMinor + c.outMinor;
			byCurrency.set(c.currency, {
				in: running.in + c.inMinor,
				out: running.out + c.outMinor,
				// The widest month in this currency, so the bars compare months
				// against each other rather than each against itself.
				ceiling: volume > running.ceiling ? volume : running.ceiling
			});
		}
	}
	const share = (value: bigint, currency: string) => {
		const ceiling = byCurrency.get(currency)?.ceiling ?? 0n;
		return ceiling === 0n ? 0 : (Number(value) / Number(ceiling)) * 100;
	};

	return {
		isAdmin: locals.person?.role === 'admin',
		baseCurrency: displayCurrency(baseCurrency),
		prevHref: pageHref(Math.max(1, filter.page - 1)),
		nextHref: pageHref(Math.min(page?.pageCount ?? 1, filter.page + 1)),
		filter: {
			...filter,
			// Amount bounds go back to the form as the text the person typed.
			minMinor: filter.minMinor === null ? '' : formatMinor(filter.minMinor, baseCurrency),
			maxMinor: filter.maxMinor === null ? '' : formatMinor(filter.maxMinor, baseCurrency)
		},
		openMonth: filter.month,
		months: months.map((m) => ({
			month: m.month,
			label: monthLabel(m.month),
			count: m.count,
			currencies: m.byCurrency.map((c) => ({
				currency: displayCurrency(c.currency),
				in: formatMinor(c.inMinor, c.currency),
				out: formatMinor(c.outMinor, c.currency),
				net: formatMinor(c.sumMinor, c.currency, { signed: true }),
				negative: c.sumMinor < 0n,
				inPct: share(c.inMinor, c.currency),
				outPct: share(c.outMinor, c.currency)
			})),
			href: monthHref(m.month)
		})),
		rows: (page?.rows ?? []).map((r) => {
			const splits = (splitsByTxn.get(r.id) ?? []).sort((a, b) => a.sort - b.sort);
			// Carries what the rule would be about, so the editor opens describing
			// this row rather than asking for what you were just looking at.
			const ruleParams = new URLSearchParams();
			if (r.counterparty) ruleParams.set('counterparty', r.counterparty);
			if (r.categoryId) ruleParams.set('category', r.categoryId);
			return {
				id: r.id,
				date: r.bookedAt,
				merchant: r.counterparty ?? r.description ?? '—',
				detail: r.counterparty && r.description ? r.description : null,
				amount: `${formatMinor(r.amount, r.currency, { signed: true })} ${displayCurrency(r.currency)}`,
				negative: r.amount < 0n,
				categoryId: r.categoryId,
				categoryLabel: r.categoryLabel,
				categoryToken: tokenFor(r.categoryId),
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
				ruleHref: `/rules?${ruleParams}`,
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
		// Over every month listed, never the open one: this is the register's own
		// footing, and a total that moved when a month was expanded would be
		// answering a different question from the one its label asks.
		totals: [...byCurrency.entries()]
			.sort((a, b) => (a[0] < b[0] ? -1 : 1))
			.map(([currency, sums]) => ({
				currency: displayCurrency(currency),
				in: formatMinor(sums.in, currency),
				out: formatMinor(sums.out, currency),
				net: formatMinor(sums.in - sums.out, currency, { signed: true }),
				negative: sums.in < sums.out
			})),
		total: months.reduce((n, m) => n + m.count, 0),
		/** How many pages the OPEN month runs to; one when nothing is open. */
		pageCount: page?.pageCount ?? 1,
		monthTotal: page?.total ?? 0,
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
		categories: groups
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
	 * linked, or a document already in the household's files — through the
	 * same visibility-checked `attachDocument` every other documents card
	 * posts to, so a member cannot attach a document by id that their own
	 * query would never have offered them. No schema work behind either path:
	 * `document_link` targets any entity and a transaction is one.
	 */
	attachDocument: async ({ request, locals }) => {
		const form = await request.formData();
		const id = asRowId(form.get('targetId'));
		const existingId = String(form.get('documentId') ?? '').trim();

		if (existingId) {
			const linked = await attachDocument(id, existingId, locals.person ?? null);
			if (!linked.ok) return fail(linked.status, { id, message: linked.message });
			return { ok: true };
		}

		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { id, message: 'Choose a file, or a document you already have.' });
		}
		let storedName: string;
		let contentHash: string;
		try {
			({ storedName, contentHash } = await saveUploadAndHash(file));
		} catch (err) {
			return fail(400, { id, message: err instanceof Error ? err.message : 'Upload failed.' });
		}

		const documentId = uuidv7();
		await createDocument({
			id: documentId,
			name: file.name || 'Receipt',
			// Continuum knows this is a receipt and what it evidences; it does not
			// know where the household files receipts, so it lands in the inbox
			// rather than being guessed onto a shelf.
			shelfId: await systemShelfId('inbox'),
			type: 'receipt',
			storedName,
			ext: extname(file.name).replace('.', '').toUpperCase() || 'PDF',
			addedOn: new Date().toISOString().slice(0, 10),
			expiresOn: null,
			expiryVerb: 'expires',
			contentHash,
			// Linked in the same aggregate the documents screen uses, so the file and
			// its link commit together or not at all.
			targetIds: [id],
			// No subject: that used to be how a receipt reached the Documents
			// screen at all, filing every one of them under a subject literally
			// called "Receipts" whether or not the household ever had such a
			// thing. The about-filter now groups a document by the transaction
			// it is linked to, so the link above is enough on its own.
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
	 * receipt became litter nobody could clear. `detachDocument` here is the
	 * same visibility-checked unlink every documents card uses; what makes
	 * this one different is what runs after it.
	 *
	 * The control says "Delete?" and asks twice, because this is not local to
	 * the transaction: a receipt filed against something else as well goes
	 * from there too.
	 */
	detachDocument: async ({ request, locals }) => {
		const form = await request.formData();
		const id = asRowId(form.get('targetId'));
		const documentId = String(form.get('documentId') ?? '').trim();
		if (!documentId) return fail(400, { id, message: 'Which receipt?' });

		// Unlink first: if the document is already gone, the row must still end up
		// without a dangling reference to it.
		await detachDocument(id, documentId, locals.person ?? null);
		// The whole removal, not just the row: a receipt is rarely a payslip, but
		// nothing stops one being filed against a transaction, and the salary
		// month behind it must not be orphaned from here either.
		const outcome = await removeDocument(documentId, locals.person);
		// A 404 usually is "it was already gone", the state the unlink above was
		// asking for anyway — but it is also what a member gets back from BOTH
		// calls for a restricted receipt they cannot see: neither the unlink nor
		// this delete does anything, and this still answers ok. That is fine only
		// because a member is never offered the control that posts here for
		// paper they cannot see; a 409 is a real refusal and has to be said.
		if (!outcome.ok && outcome.status === 409) {
			return fail(409, { id, message: outcome.message });
		}
		return { ok: true };
	},

	/**
	 * What "Attach existing" may offer for one transaction — asked for only
	 * when its receipts dialog is open, and only for that transaction.
	 *
	 * The register can page fifty rows. Computing this for every one of them
	 * the way `load` does for `documents` would mean handing the page a copy
	 * of the household's whole visible document library once per row, for the
	 * sake of the single dialog a person might open — so it is fetched on
	 * demand instead, the same way the categories screen checks what a leaf
	 * holds before it lets you delete it.
	 */
	candidates: async ({ request, locals }) => {
		const form = await request.formData();
		const id = asRowId(form.get('targetId'));
		return { candidates: await candidateDocuments(id, locals.person ?? null) };
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
