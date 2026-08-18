import { fail } from '@sveltejs/kit';
import { desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { account, category, importFile, transaction, transferPair } from '$lib/server/db/schema';
import { fileTransaction } from '$lib/server/transactions';
import { enqueue, queueStatus, runQueue } from '$lib/server/import/queue';
import {
	confirmTransferProposal,
	rejectTransferProposal
} from '$lib/server/import/transfer-decisions';
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

	const [queue, files, readAgg, autoAgg, pairedAgg, reviewRows, categories, accounts] =
		await Promise.all([
			queueStatus(),
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
				.orderBy(account.createdAt, account.id)
		]);

	const total = readAgg[0].count;
	const auto = autoAgg[0].count;

	return {
		// What the queue is doing, so the page can show depth and per-file
		// progress rather than a spinner that says nothing.
		queue: {
			waiting: queue.waiting,
			running: queue.running,
			files: queue.recent.map((job) => ({
				id: job.id,
				filename: job.filename,
				state: job.state,
				result: job.result,
				error: job.error
			}))
		},
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

		// Accept the files and return. Reading them is background work: a
		// multi-page PDF is recovered from glyph coordinates by two assemblers and
		// every candidate reading is proved before one is chosen, and nobody
		// should sit in front of a spinner while that happens six times over.
		const queued: string[] = [];
		for (const file of files) {
			queued.push(await enqueue(file.name, new Uint8Array(await file.arrayBuffer()), accountId));
		}

		// Start the worker without waiting for it. It claims one job at a time and
		// stops when the queue is empty, so a second upload arriving mid-run does
		// not start a second reader — it finds nothing to claim and returns.
		void runQueue().catch((error) => {
			console.error('Statement queue stopped unexpectedly.', error);
		});

		return { queued };
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
		const result = await confirmTransferProposal(id);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	rejectTransfer: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const result = await rejectTransferProposal(id);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	}
};
