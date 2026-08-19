import { asOptionalRowId, asRowId } from '$lib/ids';
import { fail } from '@sveltejs/kit';
import { desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { account, category, importFile, transaction, transferPair } from '$lib/server/db/schema';
import { fileTransaction } from '$lib/server/transactions';
import { enqueue, jobBytes, queueStatus, runQueue } from '$lib/server/import/queue';
import { previewLayout } from '$lib/server/import/detect';
import { confirmMapping } from '$lib/server/import/wizard';
import { loadProfiles } from '$lib/server/import/profiles';
import type { ColumnRole } from '$lib/server/import/tabular/vocabulary';
import type { DateOrder, DecimalMark } from '$lib/server/import/tabular/determinacy';
import * as schema from '$lib/server/db/schema';
import { PROOF_LABELS, sourceLabel } from '$lib/transactions/provenance';
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

	const [
		queue,
		recentImports,
		files,
		readAgg,
		autoAgg,
		pairedAgg,
		reviewRows,
		categories,
		accounts
	] = await Promise.all([
		queueStatus(),
		// What each recent import was checked against. The proof engine decided
		// whether to file these and used to discard its reasoning; keeping it
		// means a statement can show its working.
		db
			.select({
				id: importFile.id,
				filename: importFile.filename,
				bank: importFile.bank,
				currency: importFile.currency,
				rowsAdded: importFile.rowsAdded,
				uploadedAt: importFile.uploadedAt,
				sourceMethod: importFile.sourceMethod,
				proofClass: importFile.proofClass,
				reconciliation: importFile.reconciliation
			})
			.from(importFile)
			.orderBy(desc(importFile.uploadedAt))
			.limit(8),
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
				bookedOn: transaction.bookedOn,
				amountMinor: transaction.amountMinor,
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
			.orderBy(desc(transaction.bookedOn))
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
		imports: recentImports.map((file) => ({
			id: file.id,
			filename: file.filename,
			bank: file.bank,
			rowsAdded: file.rowsAdded,
			readAs: sourceLabel(file.sourceMethod),
			proofClass: file.proofClass,
			proofLabel: file.proofClass ? (PROOF_LABELS[file.proofClass] ?? null) : null,
			// Only the checks that actually said something. "Unavailable" means the
			// statement never printed that figure, which is not evidence and not a
			// failure — listing it would bury the checks that did run.
			checks: (file.reconciliation ?? []).filter((check) => check.status !== 'unavailable')
		})),
		stats: {
			filesThisMonth: files[0].count,
			transactionsRead: total,
			autoPct: total > 0 ? Math.round((auto / total) * 100) : null,
			transfersPaired: pairedAgg[0].count
		},
		review: reviewRows.map((r) => ({
			id: r.id,
			date: r.bookedOn,
			merchant: r.counterparty ?? r.description ?? '—',
			reason: r.reviewReason ?? 'needs a look',
			amount: `${formatMinor(r.amountMinor, r.currency, { signed: true })} ${displayCurrency(r.currency)}`,
			negative: r.amountMinor < 0n,
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
		// Optional: an empty field means "work it out from the statement", which is
		// not the same as an id that cannot exist.
		const accountId = asOptionalRowId(form.get('accountId'));

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

	/**
	 * Show what the reader saw in a file it could not file.
	 *
	 * A refusal is the right answer for a layout that cannot prove itself, and on
	 * its own it is a dead end — the person knows what their bank's columns mean
	 * and has no way to say so. This is what they get to point at.
	 */
	previewLayout: async ({ request }) => {
		const form = await request.formData();
		const jobId = String(form.get('jobId') ?? '');
		const file = await jobBytes(jobId);
		if (!file) return fail(404, { message: 'That file is no longer waiting to be read.' });

		const account = file.accountId
			? (await db.select().from(schema.account).where(eq(schema.account.id, file.accountId)))[0]
			: undefined;
		const preview = await previewLayout(file.bytes, {
			currency: account?.currency,
			// Needed for drift: a layout we nearly know should arrive pre-filled.
			profiles: () => loadProfiles(db)
		});
		if (!preview) {
			return fail(422, {
				message:
					'No table of dated movements could be found in that file, so there is nothing to map.'
			});
		}
		return { preview: { ...preview, jobId, filename: file.filename } };
	},

	/**
	 * File a statement under a mapping a person confirmed.
	 *
	 * What they answer is "what are these columns" — the one question they are
	 * better placed to answer than the file. Whether the movements add up is
	 * still decided by the balances.
	 */
	confirmMapping: async ({ request }) => {
		const form = await request.formData();
		const jobId = String(form.get('jobId') ?? '');
		const file = await jobBytes(jobId);
		if (!file) return fail(404, { message: 'That file is no longer waiting to be read.' });

		const headers = form.getAll('header').map(String);
		const roles = form.getAll('role').map((role) => {
			const value = String(role);
			return value ? (value as ColumnRole) : undefined;
		});
		const name = String(form.get('name') ?? '').trim();
		if (!name)
			return fail(400, { message: 'Give this layout a name so it can be recognised again.' });

		const supersedes = String(form.get('supersedes') ?? '') || undefined;
		const result = await confirmMapping(
			{
				name,
				supersedes,
				source: String(form.get('source') ?? 'delimited') as 'delimited' | 'xlsx',
				encoding: String(form.get('encoding') ?? '') || undefined,
				delimiter: String(form.get('delimiter') ?? '') || undefined,
				headers,
				roles,
				dateOrder: String(form.get('dateOrder') ?? 'day-first') as DateOrder,
				decimalMark: String(form.get('decimalMark') ?? '.') as DecimalMark,
				currency: String(form.get('currency') ?? '') || undefined
			},
			file,
			db
		);
		if (result.error) return fail(422, { message: result.error });
		return { mapped: result };
	},

	categorize: async ({ request }) => {
		const form = await request.formData();
		// Shared with the register, so a correction teaches the categoriser the
		// same way wherever it is made.
		const result = await fileTransaction(
			asRowId(form.get('id')),
			String(form.get('categoryId') ?? '')
		);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	confirmTransfer: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		const result = await confirmTransferProposal(id);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	rejectTransfer: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		const result = await rejectTransferProposal(id);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	}
};
