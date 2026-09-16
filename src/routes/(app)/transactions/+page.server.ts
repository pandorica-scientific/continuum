// SPDX-License-Identifier: AGPL-3.0-or-later
import { asOptionalRowId, asRowId } from '$lib/ids';
import { gt } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { loadCategories } from '$lib/server/categorize/leaves';
import { account, loan, tag } from '$lib/server/db/schema';
import { getBaseCurrency, getModules } from '$lib/server/settings';
import { recordLinkedPayment, unlinkLoanPayment } from '$lib/server/loans/mutations';
import { loanPaymentByTransaction } from '$lib/server/loans/payments';
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
import { SYSTEM_SHELF_KEYS } from '$lib/documents/shelves';
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

export const load: PageServerLoad = async ({ url }) => {
	// Module toggles need nothing, so they load alongside the filter's currency dependency.
	const [baseCurrency, modules] = await Promise.all([getBaseCurrency(), getModules()]);
	const filter = parseFilter(url.searchParams, baseCurrency);

	const [months, categories, accounts, groups, loans] = await Promise.all([
		registerMonths(filter),
		loadCategories(),
		db
			.select({ id: account.id, name: account.name, currency: account.currency })
			.from(account)
			.orderBy(account.createdAt, account.id),
		loadCategoryGroups(),
		// Hidden entirely when the module is off; otherwise only loans with a balance
		// left — a settled mortgage isn't something a debit could be paying towards.
		modules.loans
			? db
					.select({ id: loan.id, name: loan.name, currency: loan.currency })
					.from(loan)
					.where(gt(loan.owedMinor, 0n))
					.orderBy(loan.createdAt, loan.id)
			: Promise.resolve([])
	]);

	// Only the expanded month's transactions are read, or drawing the totals table
	// would load the whole ledger. Newest month opens by default so rows are visible.
	const openMonth = filter.month ?? months[0]?.month ?? null;
	const page = openMonth ? await registerPage({ ...filter, month: openMonth }) : null;

	const categoryName = new Map(categories.map((c) => [c.id, c.name]));
	// A category's colour is its group's, so a row's dot matches the waterfall chart's palette.
	const groupToken = new Map(groups.map((g) => [g.key, g.colorToken]));
	const tokenFor = (categoryId: string | null) => {
		const group = categoryId ? categories.find((c) => c.id === categoryId)?.groupKey : null;
		return (group && groupToken.get(group)) || '--fg3';
	};

	// Empty with no month open — each of these short-circuits on an empty id list.
	const rowIds = page?.rows.map((r) => r.id) ?? [];
	const [splitsByTxn, tagsByTxn, splitTagsBySplit, knownTags, docsByTxn, loanPaymentByTxn] =
		await Promise.all([
			loadSplits(rowIds),
			loadTagsFor(rowIds),
			loadSplitTagsFor(rowIds),
			db.select({ id: tag.id, name: tag.name }).from(tag).orderBy(tag.name),
			loadTransactionDocuments(rowIds),
			// Not gated on the module — the link stays visible even when the loans screens are off.
			loanPaymentByTransaction(rowIds)
		]);

	/** A link that carries every active filter forward. */
	const href = (mutate: (params: URLSearchParams) => void) => {
		const params = new URLSearchParams(url.searchParams);
		mutate(params);
		const query = params.toString();
		return query ? `?${query}` : url.pathname;
	};

	const pageHref = (n: number) => href((params) => params.set('page', String(n)));

	/** Switching page size returns to page one, rather than landing on an arbitrary row offset. */
	const sizeHref = (size: number) =>
		href((params) => {
			params.set('per', String(size));
			params.delete('page');
		});

	/** Opens a month, or closes it when it is already the open one. */
	const monthHref = (month: string) =>
		href((params) => {
			if (openMonth === month) params.delete('month');
			else params.set('month', month);
			// Reset the inner pager — it belonged to whichever month was open before.
			params.delete('page');
		});

	// Per currency — summing across currencies would invent a total true in neither.
	const byCurrency = new Map<string, { in: bigint; out: bigint; ceiling: bigint }>();
	for (const m of months) {
		for (const c of m.byCurrency) {
			const running = byCurrency.get(c.currency) ?? { in: 0n, out: 0n, ceiling: 0n };
			const volume = c.inMinor + c.outMinor;
			byCurrency.set(c.currency, {
				in: running.in + c.inMinor,
				out: running.out + c.outMinor,
				// Widest month sets the scale, so bars compare across months.
				ceiling: volume > running.ceiling ? volume : running.ceiling
			});
		}
	}
	const share = (value: bigint, currency: string) => {
		const ceiling = byCurrency.get(currency)?.ceiling ?? 0n;
		return ceiling === 0n ? 0 : (Number(value) / Number(ceiling)) * 100;
	};

	return {
		baseCurrency: displayCurrency(baseCurrency),
		prevHref: pageHref(Math.max(1, filter.page - 1)),
		nextHref: pageHref(Math.min(page?.pageCount ?? 1, filter.page + 1)),
		filter: {
			...filter,
			// Amount bounds go back to the form as the text the person typed.
			minMinor: filter.minMinor === null ? '' : formatMinor(filter.minMinor, baseCurrency),
			maxMinor: filter.maxMinor === null ? '' : formatMinor(filter.maxMinor, baseCurrency)
		},
		openMonth,
		// No filter-bar control for a group, so it's shown as a removable chip instead.
		groupLabel: filter.groupKey
			? (groups.find((g) => g.key === filter.groupKey)?.label ?? filter.groupKey)
			: null,
		/** Drops the group and keeps every other narrowing in place. */
		clearGroupHref: href((params) => params.delete('group')),
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
			// Carries the row's context so the rule editor opens pre-filled.
			const ruleParams = new URLSearchParams();
			if (r.counterparty) ruleParams.set('counterparty', r.counterparty);
			if (r.categoryId) ruleParams.set('category', r.categoryId);
			// A claimed instalment shows as two lines (interest/principal), formatted
			// like a split since that's how the panel renders them.
			const claim = loanPaymentByTxn.get(r.id) ?? null;
			// Keyed by which half rather than label — two halves can share a label.
			const half = (key: 'interest' | 'principal', amountMinor: bigint, label: string) => ({
				key,
				label,
				amount: `${formatMinor(amountMinor, r.currency, { signed: true })} ${displayCurrency(r.currency)}`,
				negative: amountMinor < 0n
			});
			return {
				id: r.id,
				// Booking date only carried alongside when it differs from the filed (effective) date.
				date: r.effectiveAt,
				bookedDate: r.bookedAt === r.effectiveAt ? null : r.bookedAt,
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
				// Only shown when the source was inferred rather than declared, to avoid noise on every row.
				readAs: INFERRED_SOURCES.includes(r.sourceMethod as never)
					? sourceLabel(r.sourceMethod)
					: null,
				proofClass: r.proofClass,
				ruleHref: `/rules?${ruleParams}`,
				// Raw currency figure the split dialog needs to compute a remainder.
				currency: r.currency,
				// Magnitude only — direction comes from the parent transaction on save.
				amountMajor: formatMinor(r.amount < 0n ? -r.amount : r.amount, r.currency),
				tags: tagsByTxn.get(r.id) ?? [],
				documents: docsByTxn.get(r.id) ?? [],
				// The loan this row is already recorded against, and the two lines it splits into.
				loanPayment: claim && {
					loanId: claim.loanId,
					loanName: claim.loanName,
					halves: claim.halves && [
						half('interest', claim.halves.interestMinor, r.categoryLabel ?? 'Uncategorised'),
						half('principal', claim.halves.principalMinor, claim.halves.principalLabel)
					]
				},
				isSplit: splits.length > 0,
				splits: splits.map((s) => ({
					id: s.id,
					amount: `${formatMinor(s.amountMinor, r.currency, { signed: true })} ${displayCurrency(r.currency)}`,
					// Coloured like the parent transaction it divides, not neutral.
					negative: s.amountMinor < 0n,
					amountMajor: formatMinor(s.amountMinor < 0n ? -s.amountMinor : s.amountMinor, r.currency),
					categoryId: s.categoryId,
					categoryLabel: s.categoryId ? (categoryName.get(s.categoryId) ?? null) : null,
					note: s.note,
					tags: splitTagsBySplit.get(s.id) ?? []
				}))
			};
		}),
		// Over every listed month, not just the open one — the register's overall footing.
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
		// Only inferred-source readings are offered as a filter — the ones worth reviewing.
		sourceMethods: INFERRED_SOURCES.map((method) => ({
			value: method,
			label: SOURCE_LABELS[method] ?? method
		})),
		proofLabels: PROOF_LABELS,
		accounts,
		loans,
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
		// The id travels with the failure so the error renders against the row, not a top banner.
		if (!result.ok) return fail(result.status, { id, message: result.message });
		return { ok: true };
	},

	/**
	 * Attach a receipt: either an uploaded file (becomes a document on the
	 * receipts shelf) or an existing household document, via the same
	 * visibility-checked `attachDocument` every other documents card uses.
	 */
	attachDocument: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('targetId'));
		const existingId = String(form.get('documentId') ?? '').trim();

		if (existingId) {
			const linked = await attachDocument(id, existingId);
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
			// Filed to the inbox shelf — Continuum doesn't know where the household files receipts.
			shelfId: await systemShelfId(SYSTEM_SHELF_KEYS.inbox),
			type: 'receipt',
			storedName,
			ext: extname(file.name).replace('.', '').toUpperCase() || 'PDF',
			addedOn: new Date().toISOString().slice(0, 10),
			expiresOn: null,
			expiryVerb: 'expires',
			contentHash,
			// Same aggregate the documents screen uses, so file and link commit atomically.
			targetIds: [id],
			// No subject tag — the about-filter groups a document by its linked transaction instead.
			tagNames: ['receipt']
		});
		return { ok: true };
	},

	/**
	 * Remove a receipt: deletes the document, not just the link, so it doesn't
	 * become orphaned litter on the Documents shelf. Confirmed twice since a
	 * receipt filed against something else too is removed from there as well.
	 */
	detachDocument: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('targetId'));
		const documentId = String(form.get('documentId') ?? '').trim();
		if (!documentId) return fail(400, { id, message: 'Which receipt?' });

		// Unlink first so the row never references a dangling document.
		await detachDocument(id, documentId);
		// Full removal, not just the link — a receipt could also be a payslip tied to a salary month.
		const outcome = await removeDocument(documentId);
		// A 404 usually means already-gone, which is also what a member without
		// visibility gets back for a restricted receipt — harmless since they're
		// never offered this control for paper they can't see. A 409 is a real refusal.
		if (!outcome.ok && outcome.status === 409) {
			return fail(409, { id, message: outcome.message });
		}
		return { ok: true };
	},

	/**
	 * Documents this transaction could attach — fetched on demand when its
	 * receipts dialog opens, rather than for every row on page load.
	 */
	candidates: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('targetId'));
		return { candidates: await candidateDocuments(id) };
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
					// Carries the stored line's id on edit, so tags follow the line, not its position.
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

	/**
	 * Record this row as a loan instalment. Parsing only — eligibility checks
	 * (debit, not transfer, not already claimed) live in the mutation.
	 */
	loanPayment: async ({ request }) => {
		const form = await request.formData();
		const result = await recordLinkedPayment({
			loanId: asRowId(form.get('loanId')),
			transactionId: asRowId(form.get('transactionId')),
			interest: String(form.get('interest') ?? '')
		});
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/**
	 * Undo a loan-payment link so a misfiled row can be refiled — nothing else
	 * in the app deletes a loan event.
	 */
	unlinkLoanPayment: async ({ request }) => {
		const form = await request.formData();
		const result = await unlinkLoanPayment(asRowId(form.get('transactionId')));
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
