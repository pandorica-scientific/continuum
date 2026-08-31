// SPDX-License-Identifier: AGPL-3.0-or-later
import { uuidv7 } from 'uuidv7';
import { asEnumValue } from '$lib/enums';
import { asOptionalRowId, asRowId } from '$lib/ids';
import { parseAccountNumbers, updateAccount } from '$lib/server/accounts';
import { fail } from '@sveltejs/kit';
import { desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { account, bank, person, transaction, transferPair } from '$lib/server/db/schema';
import { loadRateTable } from '$lib/server/fx/table';
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

export const load: PageServerLoad = async ({ locals }) => {
	const actor = locals.person ?? null;
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
				ownerName: person.name
			})
			.from(account)
			.leftJoin(person, eq(account.ownerPersonId, person.id))
			.orderBy(account.createdAt, account.id),
		loadRateTable(),
		db.select().from(bank).orderBy(bank.label),
		// Whose an account is. Everything has been joint by omission until now:
		// addAccount never set an owner, so the join below always found nobody and
		// the row said "joint" because there was nothing else it could say.
		db
			.select({ id: person.id, name: person.name })
			.from(person)
			.where(isNull(person.deactivatedAt))
			.orderBy(person.name)
	]);
	const bankEmoji = new Map(banks.map((b) => [b.key, b.emoji]));
	const today = new Date().toISOString().slice(0, 10);

	// How many transactions each account holds. Currency may only be corrected
	// while an account is empty: every stored amount is minor units OF THAT
	// currency, so a later change would reinterpret history rather than convert
	// it. Counted here so the form does not offer what the server will refuse.
	const held = new Map(
		(
			await db
				.select({ accountId: transaction.accountId, n: sql<number>`count(*)::int` })
				.from(transaction)
				.groupBy(transaction.accountId)
		).map((row) => [row.accountId, row.n])
	);

	// Statements and broker reports, through the one query every documents card
	// uses. `documentsAbout` stays one query per account (it is narrow), run
	// concurrently for every account up front rather than one at a time.
	// `candidateDocumentsFor` is the other half: ONE query for the whole
	// visible library plus ONE for `document_link` across every account, not
	// the whole library fetched again for each account's picker.
	const accountIds = accounts.map((a) => a.id);
	const [documentsByAccountId, candidatesByAccountId] = await Promise.all([
		Promise.all(accountIds.map(async (id) => [id, await documentsAbout(id, actor)] as const)).then(
			(pairs) => new Map(pairs)
		),
		candidateDocumentsFor(accountIds, actor)
	]);

	const rows = [];
	for (const a of accounts) {
		const converted = accountBalanceInBase(
			rates,
			a.balanceMinor,
			a.currency,
			baseCurrency,
			// This is today's cash/net-worth total. The statement date describes
			// freshness; it must not make this screen use a different FX basis from
			// the net-worth total in the sidebar.
			today
		);
		rows.push({
			id: a.id,
			name: a.name,
			bank: a.bank,
			ownerPersonId: a.ownerPersonId,
			canChangeCurrency: (held.get(a.id) ?? 0) === 0,
			// What the person actually typed, for the edit form. The display emoji
			// below falls back to the bank's, which is not the same thing: putting a
			// fallback into an edit field turns "unset" into a value on the next save.
			ownEmoji: a.emoji || '',
			// The numbers this account is known by. Written when it was created AND
			// learned from statements as they arrive, but never shown until now — so
			// the one thing that explains why a transfer did or did not pair was
			// unreachable.
			numbers: a.numbers ?? [],
			emoji: a.emoji || bankEmoji.get(a.bank) || '🏦',
			kind: a.kind,
			currency: a.currency,
			meta: [
				a.currency,
				a.ownerName ?? 'joint',
				a.balanceAsOf ? `statement to ${a.balanceAsOf}` : 'no statement yet'
			].join(' · '),
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
	const cashRows = rows.filter((r) => r.kind !== 'brokerage');
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
			// id, not name: two accounts may legitimately share a name, and a keyed
			// each block with a repeated key throws rather than degrading.
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
				// The pair's own id. What this list is keyed on in the markup, and it
				// has to be something unique: it was keyed on date+route, and two
				// transfers between the same two accounts on the same day — which is
				// ordinary, a standing order and a manual top-up — produced the same
				// key twice. Svelte throws `each_key_duplicate` on that during
				// hydration, which killed the whole page and rendered it blank.
				id: p.id,
				date: out.bookedOn,
				route: `${accountName(out.accountId)} → ${accountName(into.accountId)}`,
				amount: `${formatMinor(-out.amountMinor, out.currency)} ${displayCurrency(out.currency)}`
			}
		];
	});

	return {
		isAdmin: locals.person?.role === 'admin',
		currencies: await availableCurrencies(),
		// "Other" is a fallback rather than an institution, so it goes last —
		// just above the "add a bank" control the markup renders after this list.
		banks: orderBanksForChoosing(
			banks.map((b) => ({ key: b.key, label: b.label, emoji: b.emoji }))
		),
		accounts: rows.map((r) => ({ ...r, balanceMinorBase: undefined })),
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
	 * Add a bank the list does not have.
	 *
	 * Choosing "Other" used to file the account under a row literally called
	 * Other, losing the name of the bank it is actually with. The five that
	 * shipped were the five the author banked with.
	 */
	addBank: async ({ request }) => {
		const form = await request.formData();
		const label = String(form.get('label') ?? '').trim();
		const emoji = String(form.get('emoji') ?? '').trim() || '🏦';
		if (!label) return fail(400, { message: 'The bank needs a name.' });

		const key = bankKeyFor(label);
		if (!key) return fail(400, { message: 'That name has no letters or digits in it.' });

		const [existing] = await db.select().from(bank).where(eq(bank.key, key));
		// Not an error: the household meant to end up with this bank on the list,
		// and it is. Reporting a clash would be pedantry about spelling.
		if (existing) return { ok: true, bankKey: key };

		await db.insert(bank).values({ key, label, emoji });
		return { ok: true, bankKey: key };
	},

	/**
	 * File an existing document against an account — the "Attach" picker on its
	 * `DocumentsCard`. There is no upload here: an imported statement files
	 * itself, and a brokerage report is added from Investments, so this card
	 * only ever attaches paper that already exists.
	 */
	attachDocument: async ({ request, locals }) => {
		const form = await request.formData();
		const targetId = asRowId(form.get('targetId'));
		const documentId = String(form.get('documentId') ?? '').trim();
		if (!documentId) return fail(400, { message: 'Choose a document to attach.' });
		const result = await attachDocument(targetId, documentId, locals.person ?? null);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/**
	 * Unfile a document — the link only. The document stays on its shelf, so a
	 * mis-click costs a re-attach rather than evidence.
	 */
	detachDocument: async ({ request, locals }) => {
		const form = await request.formData();
		const targetId = asRowId(form.get('targetId'));
		const documentId = String(form.get('documentId') ?? '').trim();
		if (!documentId) return fail(400, { message: 'Which document?' });
		const result = await detachDocument(targetId, documentId, locals.person ?? null);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	}
};
