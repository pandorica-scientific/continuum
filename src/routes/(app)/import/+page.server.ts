import { fail } from '@sveltejs/kit';
import { and, desc, eq, gte, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { account, category, importFile, transaction, transferPair } from '$lib/server/db/schema';
import { fileTransaction } from '$lib/server/transactions';
import { ingestFile, pairAndCategorise, type IngestResult } from '$lib/server/import/ingest';
import { CATEGORY_GROUPS } from '$lib/categories';
import { displayCurrency, formatMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const monthStart = new Date();
	monthStart.setDate(1);
	const monthStartIso = monthStart.toISOString().slice(0, 10);

	const proposedPairs = await db
		.select()
		.from(transferPair)
		.where(eq(transferPair.state, 'proposed'));
	const proposedLegIds = new Set(
		proposedPairs.flatMap((p) => [p.outTransactionId, p.inTransactionId])
	);

	const [files, readAgg, autoAgg, pairedAgg, reviewRows, categories, accounts] = await Promise.all([
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(importFile)
			.where(gte(importFile.uploadedAt, new Date(monthStartIso))),
		db.select({ count: sql<number>`count(*)::int` }).from(transaction),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(transaction)
			.where(sql`${transaction.reviewState} in ('auto','confirmed')`),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(transaction)
			.where(isNotNull(transaction.transferPairId)),
		db
			.select({
				id: transaction.id,
				bookedAt: transaction.bookedAt,
				amount: transaction.amount,
				currency: transaction.currency,
				counterparty: transaction.counterparty,
				description: transaction.description,
				reviewReason: transaction.reviewReason,
				suggestedCategoryId: transaction.suggestedCategoryId,
				transferPairId: transaction.transferPairId,
				accountName: account.name
			})
			.from(transaction)
			.innerJoin(account, eq(transaction.accountId, account.id))
			.where(eq(transaction.reviewState, 'needs_review'))
			.orderBy(desc(transaction.bookedAt))
			.limit(50),
		db.select().from(category).orderBy(category.groupKey, category.sort),
		db
			.select({ id: account.id, name: account.name, currency: account.currency })
			.from(account)
			.orderBy(account.createdAt)
	]);

	const total = readAgg[0].count;
	const auto = autoAgg[0].count;

	return {
		stats: {
			filesThisMonth: files[0].count,
			transactionsRead: total,
			autoPct: total > 0 ? Math.round((auto / total) * 100) : null,
			transfersPaired: pairedAgg[0].count
		},
		review: reviewRows.map((r) => ({
			id: r.id,
			date: r.bookedAt,
			merchant: r.counterparty ?? r.description ?? '—',
			reason: r.reviewReason ?? 'needs a look',
			amount: `${formatMinor(r.amount, r.currency, { signed: true })} ${displayCurrency(r.currency)}`,
			negative: r.amount < 0n,
			isTransfer: proposedLegIds.has(r.id),
			account: r.accountName,
			// The engine's best guess, pre-selected below so a contested or
			// unproven row arrives with a suggestion rather than nothing.
			suggestedCategoryId: r.suggestedCategoryId
		})),
		accounts,
		categories: CATEGORY_GROUPS.map((group) => ({
			key: group.key,
			label: group.label,
			items: categories.filter((c) => c.groupKey === group.key)
		})).filter((g) => g.items.length > 0)
	};
};

export const actions: Actions = {
	upload: async ({ request }) => {
		const form = await request.formData();
		const files = form
			.getAll('statements')
			.filter((f): f is File => f instanceof File && f.size > 0);
		if (files.length === 0) return fail(400, { message: 'Choose at least one statement file.' });
		const accountId = String(form.get('accountId') ?? '').trim() || undefined;

		const results: IngestResult[] = [];
		for (const file of files) {
			results.push(
				await ingestFile(file.name, new Uint8Array(await file.arrayBuffer()), accountId)
			);
		}
		return { results };
	},

	categorize: async ({ request }) => {
		const form = await request.formData();
		// Shared with the register, so a correction teaches the categoriser the
		// same way wherever it is made.
		const result = await fileTransaction(
			String(form.get('id') ?? ''),
			String(form.get('categoryId') ?? '')
		);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	confirmTransfer: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		// Proposals live only in transferPair until confirmed; find by leg.
		// The leg test must go through or(), not a raw fragment: drizzle's and()
		// parenthesises the list as a whole and never its operands, so a raw
		// `a = x or b = x` inside it renders as `(state = ? and a = ?) or b = ?`
		// — AND binds tighter — and the state filter would not cover the in-leg.
		const pairs = await db
			.select()
			.from(transferPair)
			.where(
				and(
					eq(transferPair.state, 'proposed'),
					or(eq(transferPair.outTransactionId, id), eq(transferPair.inTransactionId, id))
				)
			);
		const pair = pairs[0];
		if (!pair) return fail(404, { message: 'No transfer proposal on this row.' });
		await db.update(transferPair).set({ state: 'confirmed' }).where(eq(transferPair.id, pair.id));
		for (const legId of [pair.outTransactionId, pair.inTransactionId]) {
			await db
				.update(transaction)
				.set({
					transferPairId: pair.id,
					reviewState: 'confirmed',
					reviewReason: null,
					categoryId: null
				})
				.where(eq(transaction.id, legId));
		}
		return { ok: true };
	},

	rejectTransfer: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		// Same shape as confirmTransfer, and the same state filter: the reject
		// button only ever appears on a proposed pair, so a confirmed or
		// already-rejected one must not be reachable through it.
		const pairs = await db
			.select()
			.from(transferPair)
			.where(
				and(
					eq(transferPair.state, 'proposed'),
					or(eq(transferPair.outTransactionId, id), eq(transferPair.inTransactionId, id))
				)
			);
		const pair = pairs[0];
		if (!pair) return fail(404, { message: 'No transfer proposal on this row.' });
		for (const legId of [pair.outTransactionId, pair.inTransactionId]) {
			await db
				.update(transaction)
				.set({
					transferPairId: null,
					reviewState: 'needs_review',
					reviewReason: 'transfer rejected — pick a category'
				})
				.where(eq(transaction.id, legId));
		}
		// Keep the pair as 'rejected' so the pairing pass never re-proposes it.
		await db.update(transferPair).set({ state: 'rejected' }).where(eq(transferPair.id, pair.id));
		await pairAndCategorise();
		return { ok: true };
	}
};
