// SPDX-License-Identifier: AGPL-3.0-or-later
import { asOptionalRowId, asRowId } from '$lib/ids';
import { fail } from '@sveltejs/kit';
import { desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { loadCategories } from '$lib/server/categorize/leaves';
import { account, importFile, person, transaction, transferPair } from '$lib/server/db/schema';
import { fileTransaction } from '$lib/server/transactions';
import { dismissJob, enqueue, jobBytes, queueStatus } from '$lib/server/import/queue';
import { runCpuQueue } from '$lib/server/jobs';
import { previewLayout } from '$lib/server/import/detect';
import { confirmMapping } from '$lib/server/import/wizard';
import { loadProfiles } from '$lib/server/import/profiles';
import type { ColumnRole } from '$lib/server/import/tabular/vocabulary';
import type { DateOrder, DecimalMark } from '$lib/server/import/tabular/determinacy';
import { PROOF_LABELS, sourceLabel } from '$lib/transactions/provenance';
import {
	confirmTransferProposal,
	markOneSidedTransfer,
	rejectTransferProposal
} from '$lib/server/import/transfer-decisions';
import { loadCategoryGroups } from '$lib/server/categorize/groups';
import { createCategory, createCategoryGroup, taxonomyKey } from '$lib/server/categorize/taxonomy';
import { asEnumValue, ENUMS } from '$lib/enums';
import { daysBetween } from '$lib/dates';
import { cadenceWord, statementStatus } from '$lib/statements/cadence';
import { localToday } from '$lib/dates';
import { displayCurrency, formatMinor } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

/** A calendar day, or nothing. Checks shape AND validity — `2026-13-45` matches the pattern but isn't a date. */
function isoDay(value: string | null): string | null {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const parsed = new Date(`${value}T00:00:00Z`);
	return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
		? null
		: value;
}

export const load: PageServerLoad = async ({ url }) => {
	const monthStart = new Date();
	monthStart.setDate(1);
	const monthStartIso = monthStart.toISOString().slice(0, 10);

	const wantedAccount = url.searchParams.get('account');

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
		accounts,
		groups,
		people
	] = await Promise.all([
		queueStatus(),
		// Keeps the proof engine's reasoning so a statement can show its working.
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
			// Acknowledged imports leave this list only — the record, transactions,
			// stored file and document all stay.
			.where(isNull(importFile.acknowledgedAt))
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
				accountId: transaction.accountId,
				// A joint account has no owner, so it can't answer "whose salary is this?" alone.
				accountOwnerPersonId: account.ownerPersonId,
				accountName: account.name
			})
			.from(transaction)
			.innerJoin(account, eq(transaction.accountId, account.id))
			.where(eq(transaction.reviewState, 'needs_review'))
			.orderBy(desc(transaction.bookedOn))
			.limit(50),
		loadCategories(),
		db
			.select({
				id: account.id,
				name: account.name,
				currency: account.currency,
				emoji: account.emoji,
				balanceAsOf: account.balanceOn
			})
			.from(account)
			.orderBy(account.createdAt, account.id),
		loadCategoryGroups(),
		// For the "whose salary is this?" sub-select on a joint account.
		db
			.select({ id: person.id, name: person.name })
			.from(person)
			.where(isNull(person.deactivatedAt))
			.orderBy(person.name)
	]);

	const total = readAgg[0].count;
	const auto = autoAgg[0].count;

	// Local calendar date: the UTC day reads a day behind Prague every evening.
	const todayIso = localToday();
	// Same overdue arithmetic as the Overview's Statements panel, so the two
	// screens agree. An account never imported is not overdue.
	const uploads = await db
		.select({ accountId: importFile.accountId, uploadedAt: importFile.uploadedAt })
		.from(importFile)
		.where(isNotNull(importFile.accountId));
	const uploadDays = new Map<string, string[]>();
	for (const upload of uploads) {
		if (!upload.accountId) continue;
		const days = uploadDays.get(upload.accountId) ?? [];
		days.push(upload.uploadedAt.toISOString().slice(0, 10));
		uploadDays.set(upload.accountId, days);
	}
	const statements = accounts.map((a) => {
		const days = uploadDays.get(a.id) ?? [];
		const status = statementStatus(days, todayIso);
		return {
			id: a.id,
			name: a.name,
			emoji: a.emoji || '🏦',
			to: a.balanceAsOf,
			days: a.balanceAsOf ? daysBetween(a.balanceAsOf, todayIso) : status.daysSince,
			cadence: cadenceWord(days),
			overdue: status.stale
		};
	});

	return {
		statements,
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
			// "Unavailable" means the statement never printed that figure — not
			// evidence, not a failure — so it's dropped to avoid burying real checks.
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
			// Lets the "moved to my…" picker exclude the account the money left.
			accountId: r.accountId,
			accountIsJoint: r.accountOwnerPersonId === null,
			// The engine's best guess, pre-selected so the row arrives with a suggestion.
			suggestedCategoryId: r.suggestedCategoryId
		})),
		accounts,
		/**
		 * Prefill from the Statements ribbon's link, so filing a gap doesn't mean
		 * re-answering what sent you here. Every value is checked, not trusted —
		 * a stale bookmark naming a deleted account is dropped, never refused.
		 */
		prefill: {
			accountId: accounts.some((a) => a.id === wantedAccount) ? wantedAccount : null,
			from: isoDay(url.searchParams.get('from')),
			to: isoDay(url.searchParams.get('to'))
		},
		// Every group, including empty ones — the modal needs somewhere to put a new category.
		groups: groups.map((group) => ({ key: group.key, label: group.label })),
		groupRoles: ENUMS['category_group.role'],
		people,
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
	upload: async ({ request }) => {
		const form = await request.formData();
		const files = form
			.getAll('statements')
			.filter((f): f is File => f instanceof File && f.size > 0);
		if (files.length === 0) return fail(400, { message: 'Choose at least one statement file.' });
		// Optional: empty means "work it out from the statement", not an id that can't exist.
		const accountId = asOptionalRowId(form.get('accountId'));

		// Accept the files and return; reading them is background work, since
		// proving a multi-page PDF reading takes several passes.
		const queued: string[] = [];
		for (const file of files) {
			queued.push(await enqueue(file.name, new Uint8Array(await file.arrayBuffer()), accountId));
		}

		// Started without waiting: the worker claims one job at a time and stops
		// when empty, so a second upload mid-run just finds nothing to claim.
		void runCpuQueue().catch((error) => {
			console.error('Statement queue stopped unexpectedly.', error);
		});

		return { queued };
	},

	/** Take a file out of the queue: a cancellation while it waits, a tidy-up
	 *  once it has settled. Refused while it is being read. */
	dismissJob: async ({ request }) => {
		const form = await request.formData();
		const result = await dismissJob(String(form.get('jobId') ?? ''));
		if (!result.ok) return fail(409, { message: result.message });
		return { ok: true };
	},

	/** "I have looked at this one." Hides the row; deletes nothing. */
	acknowledgeImport: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('fileId'));
		await db.update(importFile).set({ acknowledgedAt: new Date() }).where(eq(importFile.id, id));
		return { ok: true };
	},

	previewLayout: async ({ request }) => {
		const form = await request.formData();
		const jobId = String(form.get('jobId') ?? '');
		const file = await jobBytes(jobId);
		if (!file) return fail(404, { message: 'That file is no longer waiting to be read.' });

		const into = file.accountId
			? (await db.select().from(account).where(eq(account.id, file.accountId)))[0]
			: undefined;
		const preview = await previewLayout(file.bytes, {
			currency: into?.currency,
			// A layout we nearly know should arrive pre-filled.
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

	/** File a statement under a mapping a person confirmed — "what are these
	 *  columns"; whether the movements add up is still decided by the balances. */
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
		const id = asRowId(form.get('id'));
		// Only reached for a salary category on a joint account; an owned
		// account answers "whose salary" itself.
		const salaryPersonId = asOptionalRowId(form.get('salaryPersonId'));
		const result = await fileTransaction(
			id,
			String(form.get('categoryId') ?? ''),
			undefined,
			salaryPersonId
				? { personId: salaryPersonId, remember: form.get('rememberWhose') === 'on' }
				: undefined
		);
		// The id travels with the failure so the message renders against its row.
		if (!result.ok) return fail(result.status, { id, message: result.message });
		return { ok: true };
	},

	/** Add a category, and a group to hold it, without leaving the review queue. */
	addCategory: async ({ request }) => {
		const form = await request.formData();
		const newGroupLabel = String(form.get('newGroupLabel') ?? '').trim();
		let groupKey = String(form.get('groupKey') ?? '').trim();

		if (newGroupLabel) {
			const created = await createCategoryGroup({
				label: newGroupLabel,
				role: asEnumValue('category_group.role', form.get('newGroupRole'), 'expense')
			});
			if (!created.ok) return fail(created.status, { message: created.message });
			groupKey = taxonomyKey(newGroupLabel);
		}
		if (!groupKey) return fail(400, { message: 'Choose a group, or name a new one.' });

		const result = await createCategory({ groupKey, name: String(form.get('name') ?? '') });
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/** Say a row is a transfer to an account whose statements aren't imported
	 *  — the pairing machinery needs both legs, and only one exists here. */
	markOneSided: async ({ request }) => {
		const form = await request.formData();
		const result = await markOneSidedTransfer(
			asRowId(form.get('id')),
			asRowId(form.get('toAccountId'))
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
