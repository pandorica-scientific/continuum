// SPDX-License-Identifier: AGPL-3.0-or-later
import { uuidv7 } from 'uuidv7';
import { asEnumValue } from '$lib/enums';
import { asOptionalRowId, asRowId } from '$lib/ids';
import {
	archiveAccount,
	deleteAccount,
	parseAccountNumbers,
	unarchiveAccount,
	updateAccount
} from '$lib/server/accounts';
import { fail } from '@sveltejs/kit';
import { desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { account, bank, person, transaction, transferPair } from '$lib/server/db/schema';
import { loadRateTable } from '$lib/server/fx/table';
import { balanceAge, balanceAgeLabel } from '$lib/statements/balance-age';
import { logoHref } from '$lib/server/banks/logos';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { getBaseCurrency } from '$lib/server/settings';
import { displayCurrency, formatMinor } from '$lib/money';
import { positiveDonutSlices } from '$lib/charts/donut';
import { accountBalanceInBase } from '$lib/accounts/balance';
import { bankKeyFor, orderBanksForChoosing } from '$lib/banks';
import {
	attachDocument,
	candidateDocumentsFor,
	detachDocument,
	documentsAbout
} from '$lib/server/documents/targets';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const baseCurrency = await getBaseCurrency();
	const [accounts, rates, banks, people] = await Promise.all([
		db
			.select({
				id: account.id,
				name: account.name,
				emoji: account.emoji,
				bank: account.bank,
				kind: account.kind,
				currency: account.currency,
				balanceMinor: account.balanceMinor,
				balanceAsOf: account.balanceOn,
				numbers: account.numbers,
				ownerPersonId: account.ownerPersonId,
				ownerName: person.name,
				archivedAt: account.archivedAt
			})
			.from(account)
			.leftJoin(person, eq(account.ownerPersonId, person.id))
			.orderBy(account.createdAt, account.id),
		loadRateTable(),
		db.select().from(bank).orderBy(bank.label),
		db
			.select({ id: person.id, name: person.name })
			.from(person)
			.where(isNull(person.deactivatedAt))
			.orderBy(person.name)
	]);
	const bankEmoji = new Map(banks.map((b) => [b.key, b.emoji]));
	const today = new Date().toISOString().slice(0, 10);

	// Currency may only change while an account is empty: every stored amount is
	// minor units of that currency, so a later change would reinterpret history.
	const held = new Map(
		(
			await db
				.select({ accountId: transaction.accountId, n: sql<number>`count(*)::int` })
				.from(transaction)
				.groupBy(transaction.accountId)
		).map((row) => [row.accountId, row.n])
	);

	// `documentsAbout` is one query per account, run concurrently. `candidateDocumentsFor`
	// is one query for the whole library plus one for links, not refetched per account.
	const accountIds = accounts.map((a) => a.id);
	const [documentsByAccountId, candidatesByAccountId] = await Promise.all([
		Promise.all(accountIds.map(async (id) => [id, await documentsAbout(id)] as const)).then(
			(pairs) => new Map(pairs)
		),
		candidateDocumentsFor(accountIds)
	]);

	const rows = [];
	for (const a of accounts) {
		const converted = accountBalanceInBase(
			rates,
			a.balanceMinor,
			a.currency,
			baseCurrency,
			// Today, not the statement date — keeps this on the same FX basis as the sidebar's net worth.
			today
		);
		rows.push({
			id: a.id,
			name: a.name,
			bank: a.bank,
			ownerPersonId: a.ownerPersonId,
			canChangeCurrency: (held.get(a.id) ?? 0) === 0,
			archived: a.archivedAt !== null,
			// The same count the currency rule uses: an account that never carried
			// a row is the one that can be deleted rather than closed.
			transactions: held.get(a.id) ?? 0,
			// Raw value for the edit form; falling back to the bank's emoji here would
			// turn "unset" into a value on the next save.
			ownEmoji: a.emoji || '',
			// Numbers learned from statements as they arrive, shown so a transfer's
			// pairing (or non-pairing) is explainable.
			numbers: a.numbers ?? [],
			emoji: a.emoji || bankEmoji.get(a.bank) || '🏦',
			// A logo only where one has actually been fetched. Null is the
			// ordinary case — this repository ships none — and the emoji above is
			// what draws then, exactly as it always has.
			logo: logoHref(a.bank),
			kind: a.kind,
			currency: a.currency,
			meta: [
				a.currency,
				a.ownerName ?? 'joint',
				a.balanceAsOf ? `statement to ${a.balanceAsOf}` : 'no statement yet'
			].join(' · '),
			// How old the figure beside it is. A correct balance from last month
			// looks exactly like a current one otherwise, which reads as the app
			// being wrong rather than the statements being behind.
			balanceAge: (() => {
				const age = balanceAge(a.balanceAsOf ?? null, today);
				return age?.stale ? balanceAgeLabel(age) : null;
			})(),
			balance: formatMinor(a.balanceMinor, a.currency),
			baseEquivalent:
				a.currency === baseCurrency
					? null
					: converted.exactMinor === null
						? '—'
						: `≈ ${formatMinor(converted.exactMinor, baseCurrency)} ${displayCurrency(baseCurrency)}`,
			balanceMinorBase: converted.totalMinor,
			documents: documentsByAccountId.get(a.id) ?? [],
			documentCandidates: candidatesByAccountId.get(a.id) ?? []
		});
	}

	// Donut: share of cash by account, excluding the brokerage, in base currency.
	// A missing rate uses the app-wide, explicitly-bannered face-value fallback;
	// dropping that row would make this total disagree with net worth.
	// A closed account holds nothing to show a share of, and net worth has
	// already stopped counting it (see the view).
	const cashRows = rows.filter((r) => r.kind !== 'brokerage' && !r.archived);
	const cashTotal = cashRows.reduce((sum, r) => sum + r.balanceMinorBase, 0n);
	const donut = positiveDonutSlices(cashRows, (row) => row.balanceMinorBase).map(
		({ item: r, pct, from, to }, i) => {
			const colors = [
				'var(--blue)',
				'var(--teal)',
				'var(--purple)',
				'var(--orange)',
				'var(--yellow)',
				'var(--green)'
			];
			// id, not name: two accounts may share a name, and a duplicate key throws in the keyed each block.
			return { id: r.id, label: r.name, pct, from, to, color: colors[i % colors.length] };
		}
	);

	// Recent matched transfer pairs with their legs (proposals and rejections
	// belong to the review queue, not here).
	const pairs = await db
		.select()
		.from(transferPair)
		.where(sql`${transferPair.state} in ('auto', 'confirmed')`)
		.orderBy(desc(transferPair.createdAt))
		.limit(8);
	const legIds = pairs.flatMap((p) => [p.outTransactionId, p.inTransactionId]);
	const legs = legIds.length
		? await db.select().from(transaction).where(inArray(transaction.id, legIds))
		: [];
	const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? '?';
	const transfers = pairs.flatMap((p) => {
		const out = legs.find((t) => t.id === p.outTransactionId);
		const into = legs.find((t) => t.id === p.inTransactionId);
		if (!out || !into) return [];
		return [
			{
				// Pair id, not date+route: two transfers between the same accounts on
				// the same day (e.g. standing order + manual top-up) would otherwise share a key.
				id: p.id,
				date: out.bookedOn,
				route: `${accountName(out.accountId)} → ${accountName(into.accountId)}`,
				amount: `${formatMinor(-out.amountMinor, out.currency)} ${displayCurrency(out.currency)}`
			}
		];
	});

	// Reuses the donut's share/colour rather than recomputing, so the bar on a
	// card and its wedge in the pie never disagree. Brokerage has no wedge, so no bar.
	const shareById = new Map(donut.map((d) => [d.id, { pct: d.pct, color: d.color }]));

	return {
		currencies: await availableCurrencies(),
		// "Other" is a fallback, not an institution, so it goes last.
		banks: orderBanksForChoosing(
			banks.map((b) => ({ key: b.key, label: b.label, emoji: b.emoji }))
		),
		accounts: rows.map((r) => ({
			...r,
			// Only an account that never held anything may be deleted outright;
			// anything else is closed, because the delete would cascade.
			deletable: r.transactions === 0,
			balanceMinorBase: undefined,
			share: shareById.get(r.id)?.pct ?? null,
			color: shareById.get(r.id)?.color ?? 'var(--fg3)'
		})),
		people,
		cashTotalFormatted: formatMinor(cashTotal, baseCurrency),
		baseCurrencyDisplay: displayCurrency(baseCurrency),
		donut,
		transfers
	};
};

export const actions: Actions = {
	addAccount: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const currency = String(form.get('currency') ?? '')
			.trim()
			.toUpperCase();
		const bankKey = String(form.get('bank') ?? 'other');
		// Narrowed at the boundary, so a hand-crafted form post cannot reach the
		// CHECK constraint and turn a bad field into a failed insert.
		const kind = asEnumValue('account.kind', form.get('kind'), 'current');
		const numbersRaw = String(form.get('numbers') ?? '').trim();
		if (!name) return fail(400, { message: 'The account needs a name.' });
		if (!/^[A-Z]{3}$/.test(currency))
			return fail(400, { message: 'Currency must be a three-letter code.' });
		const [chosen] = await db.select().from(bank).where(eq(bank.key, bankKey));
		// account.bank carries a foreign key, so an unknown key would fail the
		// insert with a constraint error rather than a sentence anyone can read.
		if (!chosen) return fail(400, { message: 'That bank is not on the list.' });
		await db.insert(account).values({
			id: uuidv7(),
			name,
			ownerPersonId: asOptionalRowId(form.get('ownerPersonId')) ?? null,
			emoji: chosen.emoji,
			bank: bankKey,
			kind,
			currency,
			numbers: numbersRaw ? numbersRaw.split(/[,;\s]+/).filter(Boolean) : []
		});
		return { ok: true };
	},

	editAccount: async ({ request }) => {
		const form = await request.formData();
		const result = await updateAccount(asRowId(form.get('id')), {
			name: String(form.get('name') ?? ''),
			emoji: String(form.get('emoji') ?? ''),
			bank: String(form.get('bank') ?? 'other'),
			kind: String(form.get('kind') ?? 'current'),
			// Empty means joint. A real answer, not an absence.
			ownerPersonId: asOptionalRowId(form.get('ownerPersonId')) ?? null,
			numbers: parseAccountNumbers(String(form.get('numbers') ?? '')),
			currency:
				String(form.get('currency') ?? '')
					.trim()
					.toUpperCase() || null
		});
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/**
	 * Close an account. Its rows stay; only its balance stops counting.
	 */
	archiveAccount: async ({ request }) => {
		const result = await archiveAccount(asRowId((await request.formData()).get('id')));
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	unarchiveAccount: async ({ request }) => {
		const result = await unarchiveAccount(asRowId((await request.formData()).get('id')));
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/**
	 * Delete one added by mistake. Refused the moment it holds a transaction —
	 * the foreign key cascades, and tidying a list must not take history with it.
	 */
	deleteAccount: async ({ request }) => {
		const result = await deleteAccount(asRowId((await request.formData()).get('id')));
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	addBank: async ({ request }) => {
		const form = await request.formData();
		const label = String(form.get('label') ?? '').trim();
		const emoji = String(form.get('emoji') ?? '').trim() || '🏦';
		if (!label) return fail(400, { message: 'The bank needs a name.' });

		const key = bankKeyFor(label);
		if (!key) return fail(400, { message: 'That name has no letters or digits in it.' });

		const [existing] = await db.select().from(bank).where(eq(bank.key, key));
		// Not an error: the household meant to end up with this bank on the list, and it is.
		if (existing) return { ok: true, bankKey: key };

		await db.insert(bank).values({ key, label, emoji });
		return { ok: true, bankKey: key };
	},

	/**
	 * File an existing document against an account. No upload here — a statement
	 * files itself, and a brokerage report is added from Investments.
	 */
	attachDocument: async ({ request }) => {
		const form = await request.formData();
		const targetId = asRowId(form.get('targetId'));
		const documentId = String(form.get('documentId') ?? '').trim();
		if (!documentId) return fail(400, { message: 'Choose a document to attach.' });
		const result = await attachDocument(targetId, documentId);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/**
	 * Unfile a document — the link only. The document stays on its shelf, so a
	 * mis-click costs a re-attach rather than evidence.
	 */
	detachDocument: async ({ request }) => {
		const form = await request.formData();
		const targetId = asRowId(form.get('targetId'));
		const documentId = String(form.get('documentId') ?? '').trim();
		if (!documentId) return fail(400, { message: 'Which document?' });
		const result = await detachDocument(targetId, documentId);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	}
};
