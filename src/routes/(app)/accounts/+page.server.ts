import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { account, person, transaction, transferPair } from '$lib/server/db/schema';
import { loadRateTable } from '$lib/server/fx/table';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { getBaseCurrency } from '$lib/server/settings';
import { displayCurrency, formatMinor } from '$lib/money';
import { positiveDonutSlices } from '$lib/charts/donut';
import { accountBalanceInBase } from '$lib/accounts/balance';
import type { Actions, PageServerLoad } from './$types';

const BANK_EMOJI: Record<string, string> = {
	fio: '🏦',
	revolut: '💠',
	mbank: '🅜',
	rb: '🟡',
	cs: '🔵',
	other: '💼'
};

export const load: PageServerLoad = async () => {
	const baseCurrency = await getBaseCurrency();
	const [accounts, rates] = await Promise.all([
		db
			.select({
				id: account.id,
				name: account.name,
				emoji: account.emoji,
				bank: account.bank,
				kind: account.kind,
				currency: account.currency,
				balanceMinor: account.balanceMinor,
				balanceAsOf: account.balanceAsOf,
				ownerName: person.name
			})
			.from(account)
			.leftJoin(person, eq(account.ownerPersonId, person.id))
			.orderBy(account.createdAt, account.id),
		loadRateTable()
	]);
	const today = new Date().toISOString().slice(0, 10);

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
			emoji: a.emoji || BANK_EMOJI[a.bank] || '🏦',
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
			balanceMinorBase: converted.totalMinor
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
			return { label: r.name, pct, from, to, color: colors[i % colors.length] };
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
				date: out.bookedAt,
				route: `${accountName(out.accountId)} → ${accountName(into.accountId)}`,
				amount: `${formatMinor(-out.amount, out.currency)} ${displayCurrency(out.currency)}`
			}
		];
	});

	return {
		currencies: await availableCurrencies(),
		accounts: rows.map((r) => ({ ...r, balanceMinorBase: undefined })),
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
		const bank = String(form.get('bank') ?? 'other');
		const kind = String(form.get('kind') ?? 'current');
		const numbersRaw = String(form.get('numbers') ?? '').trim();
		if (!name) return fail(400, { message: 'The account needs a name.' });
		if (!/^[A-Z]{3}$/.test(currency))
			return fail(400, { message: 'Currency must be a three-letter code.' });
		await db.insert(account).values({
			id: randomUUID(),
			name,
			emoji: BANK_EMOJI[bank] ?? '🏦',
			bank,
			kind,
			currency,
			numbers: numbersRaw ? numbersRaw.split(/[,;\s]+/).filter(Boolean) : []
		});
		return { ok: true };
	}
};
