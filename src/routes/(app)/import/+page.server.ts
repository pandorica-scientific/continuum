// SPDX-License-Identifier: AGPL-3.0-or-later
import { asOptionalRowId, asRowId } from '$lib/ids';
import { fail } from '@sveltejs/kit';
import { and, desc, eq, gte, inArray, isNotNull, isNull, not, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { loadCategories } from '$lib/server/categorize/leaves';
import { account, importFile, person, transaction, transferPair } from '$lib/server/db/schema';
import { fileTransaction } from '$lib/server/transactions';
import { dismissJob, enqueue, jobBytes, queueStatus } from '$lib/server/import/queue';
import { logoHref } from '$lib/server/banks/logos';
import { activeAccount } from '$lib/server/accounts';
import { UNTRACKED_ACCOUNT } from '$lib/import/transfer-target';
import { identifyingDetail } from '$lib/import/row-detail';
import { matchAttribution } from '$lib/server/salary';
import { recallDestination } from '$lib/import/transfer-memory';
import { laneRank } from '$lib/import/review-lane';
import { groupReviewRows, takeGroups } from '$lib/import/review-groups';

import { salaryAttribution } from '$lib/server/db/schema';
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
	markUntrackedTransfer,
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

/**
 * How many queued rows the screen shows at once.
 *
 * A cap, not a page: there is no "next fifty". Every row is ranked before the
 * cut (see `ranked` below), so the fifty shown are the fifty most worth
 * answering, and answering them brings up the next fifty.
 */
const REVIEW_PAGE = 50;

/** A calendar day, or nothing. Checks shape AND validity — `2026-13-45` matches the pattern but isn't a date. */
function isoDay(value: string | null): string | null {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const parsed = new Date(`${value}T00:00:00Z`);
	return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
		? null
		: value;
}

/**
 * How long a statement stays under "Recent imports" before it ages out.
 *
 * Long enough to come back to a batch later in the week and read what each
 * file was checked against; short enough that the list is the recent few and
 * not everything ever filed. Ageing out hides the row and nothing else — the
 * import, its transactions, its stored file and its document all stay, and a
 * re-upload is still caught as a duplicate by content hash.
 */
const RECENT_IMPORT_MS = 7 * 24 * 60 * 60 * 1000;

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

	/**
	 * The in-leg of each proposal, hidden from the queue.
	 *
	 * A proposal puts BOTH legs in `needs_review`, so once a row started showing
	 * its counterpart stacked beneath it the same pair drew twice — once from
	 * each end, each displaying the other. One decision, asked twice, and
	 * answering either resolved both.
	 *
	 * The money LEAVING is the one kept: it reads as the action, and the row
	 * beneath it as where it went. Safe to hide the other because confirming or
	 * rejecting acts on the pair, whichever leg's button is pressed.
	 */
	const redundantLegIds = proposedPairs.map((p) => p.inTransactionId);

	/**
	 * The OTHER leg of each proposal, keyed by the leg being asked about.
	 *
	 * Confirming a pair meant pressing "Own transfer" on a row that never said
	 * what it had been matched WITH — the one fact needed to answer. Both legs
	 * are read here so the row can show its counterpart and be checked rather
	 * than trusted.
	 */
	const legIds = [...proposedLegIds];
	const legRows = legIds.length
		? await db
				.select({
					id: transaction.id,
					bookedOn: transaction.bookedOn,
					amountMinor: transaction.amountMinor,
					currency: transaction.currency,
					counterparty: transaction.counterparty,
					description: transaction.description,
					// The counterpart leg is just as likely to be a row named after a
					// payment method, and it is the one being checked against.
					counterpartyAccount: transaction.counterpartyAccount,
					variableSymbol: transaction.variableSymbol,
					constantSymbol: transaction.constantSymbol,
					specificSymbol: transaction.specificSymbol,
					bankRef: transaction.bankRef,
					originalAmountMinor: transaction.originalAmountMinor,
					originalCurrency: transaction.originalCurrency,
					accountName: account.name
				})
				.from(transaction)
				.innerJoin(account, eq(account.id, transaction.accountId))
				.where(inArray(transaction.id, legIds))
		: [];
	const legById = new Map(legRows.map((l) => [l.id, l]));
	const counterpartOf = new Map<string, (typeof legRows)[number]>();
	for (const pair of proposedPairs) {
		const out = legById.get(pair.outTransactionId);
		const inn = legById.get(pair.inTransactionId);
		if (out && inn) {
			counterpartOf.set(pair.outTransactionId, inn);
			counterpartOf.set(pair.inTransactionId, out);
		}
	}

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
			// stored file and document all stay. So does one that simply got old:
			// this list is the last few statements and what they were checked
			// against, not a permanent ledger, and a household that never presses
			// ✕ should not accumulate one forever.
			.where(
				and(
					isNull(importFile.acknowledgedAt),
					gte(importFile.uploadedAt, new Date(Date.now() - RECENT_IMPORT_MS))
				)
			)
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
				// What the row is identified BY when its name identifies nothing —
				// a Czech statement names the payment method, not the payee.
				counterpartyAccount: transaction.counterpartyAccount,
				variableSymbol: transaction.variableSymbol,
				constantSymbol: transaction.constantSymbol,
				specificSymbol: transaction.specificSymbol,
				bankRef: transaction.bankRef,
				originalAmountMinor: transaction.originalAmountMinor,
				originalCurrency: transaction.originalCurrency,
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
			.where(
				and(
					eq(transaction.reviewState, 'needs_review'),
					redundantLegIds.length > 0 ? not(inArray(transaction.id, redundantLegIds)) : undefined
				)
			)
			// Newest first WITHIN a lane; which lane comes first is decided below,
			// in one place, by the same `reviewLane` the colours use.
			//
			// No cap here, and that is the point. The list shows fifty, and which
			// fifty is the whole question: ordered by date alone, a proposal is
			// only ever as recent as the older of the two statements that made
			// it, so ours sat in April to August behind a hundred and fourteen
			// newer rows — past the cap, and the queue is the only place a
			// proposal can be answered at all. Sorting the fetched page would not
			// have fixed it; the rows have to be ranked before anything is cut.
			// The predicate above already narrows this to rows needing review.
			.orderBy(desc(transaction.bookedOn)),
		loadCategories(),
		db
			.select({
				id: account.id,
				name: account.name,
				currency: account.currency,
				emoji: account.emoji,
				bank: account.bank,
				balanceAsOf: account.balanceOn
			})
			.from(account)
			.where(activeAccount())
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

	/**
	 * The queue in the order it is worked.
	 *
	 * `sort` is stable, so ranking by lane alone keeps the newest-first order
	 * the query already applied within each lane. Ranking BEFORE the page is
	 * cut is what puts every transfer and every pre-filled row on the first
	 * page rather than whichever fifty happen to be most recent.
	 */
	const ranked = [...reviewRows].sort(
		(a, b) =>
			laneRank({
				isTransfer: proposedLegIds.has(a.id),
				suggestedCategoryId: a.suggestedCategoryId,
				reason: a.reviewReason
			}) -
			laneRank({
				isTransfer: proposedLegIds.has(b.id),
				suggestedCategoryId: b.suggestedCategoryId,
				reason: b.reviewReason
			})
	);

	// Read once for the whole queue rather than per row: the answer to "whose
	// pay is this" is the same rule the filing action applies, and asking it
	// fifty times would read the table fifty times.
	const attributions = await db
		.select({
			matchKey: salaryAttribution.matchKey,
			personId: salaryAttribution.personId,
			accountId: salaryAttribution.accountId
		})
		.from(salaryAttribution);
	const personName = new Map(people.map((p) => [p.id, p.name]));

	// Every one-sided transfer anybody has already answered. This IS the
	// memory behind the "moved to" default — no preference is stored, the
	// past decisions are read back.
	const pastDestinations = await db
		.select({
			accountId: transaction.accountId,
			counterpartyAccount: transaction.counterpartyAccount,
			toAccountId: transaction.transferToAccountId,
			untracked: transaction.transferToUntracked,
			bookedOn: transaction.bookedOn
		})
		.from(transaction)
		.where(
			or(isNotNull(transaction.transferToAccountId), eq(transaction.transferToUntracked, true))
		);
	const openAccountIds = new Set(accounts.map((a) => a.id));

	/**
	 * One payee, one card.
	 *
	 * Grouped AFTER ranking, so a group sits where its first row ranked, and
	 * cut on whole groups so a card never says "3 rows" with one missing.
	 *
	 * Grouped on the grouping fields alone; only the rows that survive the cut
	 * are filled in below. Whose pay this is, what it was matched with and
	 * where it probably went each scan a table, and the queue can hold
	 * hundreds of rows while the screen shows fifty.
	 */
	const shownGroups = takeGroups(
		groupReviewRows(
			ranked.map((r) => ({
				id: r.id,
				merchant: r.counterparty ?? r.description ?? '—',
				// What makes two rows the same payee, and the amount compared
				// exactly rather than as a formatted string.
				counterparty: r.counterparty,
				counterpartyAccount: r.counterpartyAccount,
				amountKey: r.amountMinor.toString(),
				row: r
			}))
		),
		REVIEW_PAGE
	);

	const card = (r: (typeof ranked)[number]) => ({
		id: r.id,
		counterparty: r.counterparty,
		counterpartyAccount: r.counterpartyAccount,
		amountKey: r.amountMinor.toString(),
		date: r.bookedOn,
		merchant: r.counterparty ?? r.description ?? '—',
		detail: identifyingDetail(r, r.counterparty ?? r.description),
		reason: r.reviewReason ?? 'needs a look',
		// Whose pay this would be recorded as, if it is filed as salary.
		// Sent whether or not the answer is known, because the screen has to
		// say which of the two it is: silently attributing money to a person
		// puts it in their salary history and their retirement projection,
		// and the one screen that could have shown it said nothing.
		salaryFor: (() => {
			const found = matchAttribution(
				{
					accountOwnerPersonId: r.accountOwnerPersonId,
					counterparty: r.counterparty,
					accountId: r.accountId
				},
				attributions
			);
			if (!found.personId) return null;
			return {
				personId: found.personId,
				name: personName.get(found.personId) ?? 'someone',
				// An owned account answers from its own owner and has nothing
				// to unlearn; a learned rule does, so the two are offered
				// differently.
				learned: r.accountOwnerPersonId === null
			};
		})(),
		amount: `${formatMinor(r.amountMinor, r.currency, { signed: true })} ${displayCurrency(r.currency)}`,
		negative: r.amountMinor < 0n,
		isTransfer: proposedLegIds.has(r.id),
		// What the engine matched this against, so "Own transfer" is a
		// judgement rather than a leap of faith. Null unless this row is
		// half of a proposal.
		pairedWith: (() => {
			const other = counterpartOf.get(r.id);
			if (!other) return null;
			return {
				date: other.bookedOn,
				account: other.accountName,
				amount: `${formatMinor(other.amountMinor, other.currency, { signed: true })} ${displayCurrency(other.currency)}`,
				negative: other.amountMinor < 0n,
				merchant: other.counterparty ?? other.description ?? '—',
				detail: identifyingDetail(other, other.counterparty ?? other.description),
				// Days apart: the tie-breaker the pairer itself sorts on, so a
				// match made four days late is visibly a weaker one.
				daysApart: Math.abs(daysBetween(other.bookedOn, r.bookedOn))
			};
		})(),
		account: r.accountName,
		// Lets the "moved to my…" picker exclude the account the money left.
		accountId: r.accountId,
		// What this row was probably a transfer to, from what the same
		// destination number — or failing that, this account — was answered
		// before. Preselected, never submitted on its own: the button is
		// still a decision somebody makes.
		recalled: (() => {
			const found = recallDestination(r, pastDestinations);
			if (!found) return null;
			// A remembered account that has since been closed, or is the one
			// the money left, cannot be offered — the option is not there.
			if (found.toAccountId !== null) {
				if (!openAccountIds.has(found.toAccountId)) return null;
				if (found.toAccountId === r.accountId) return null;
			}
			return found;
		})(),
		accountIsJoint: r.accountOwnerPersonId === null,
		// The engine's best guess, pre-selected so the row arrives with a suggestion.
		suggestedCategoryId: r.suggestedCategoryId
	});
	const cardGroups = shownGroups.map((g) => ({ ...g, rows: g.rows.map(({ row }) => card(row)) }));
	const shownRows = cardGroups.reduce((n, g) => n + g.rows.length, 0);

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
			logo: logoHref(a.bank),
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
		// `repeated` is a Set on the server and an array over the wire.
		reviewGroups: cardGroups.map((g) => ({
			key: g.key,
			label: g.label,
			rows: g.rows,
			repeated: [...g.repeated]
		})),
		reviewCount: shownRows,
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
		const to = String(form.get('toAccountId') ?? '');
		// The picker's escape hatch. Not a row id, so it is matched before
		// `asRowId` is allowed anywhere near it.
		const result =
			to === UNTRACKED_ACCOUNT
				? await markUntrackedTransfer(asRowId(form.get('id')))
				: await markOneSidedTransfer(asRowId(form.get('id')), asRowId(to));
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
