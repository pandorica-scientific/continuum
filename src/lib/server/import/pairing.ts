import type { ParsedRow } from './types';

// Pure pairing logic, separated from the database so it can be unit tested
// hard — transfer mistakes silently corrupt income and spending figures.

export interface PairableTx {
	id: string;
	accountId: string;
	bookedAt: string; // ISO
	amountMinor: bigint;
	currency: string;
	counterparty?: string | null;
	counterpartyAccount?: string | null;
}

export interface OwnAccount {
	id: string;
	currency: string;
	/** normalised digit/letter-only forms of the account's numbers */
	numberKeys: string[];
}

export interface PairProposal {
	outId: string;
	inId: string;
	/** auto pairs are excluded silently; review pairs ask the user */
	confidence: 'auto' | 'review';
}

export function normaliseAccountKey(raw: string): string {
	return raw.toUpperCase().replace(/[^A-Z0-9/]/g, '');
}

/**
 * The identity core of an account number: for the local Czech "number/bank"
 * form the number part, otherwise all digits — leading zeros stripped so the
 * zero-padded middle of an IBAN still contains it.
 */
function accountCore(key: string): string {
	const local = key.includes('/') ? key.slice(0, key.indexOf('/')) : key;
	return local.replace(/\D/g, '').replace(/^0+/, '');
}

/** "93531803/5500" matches "CZ6955000000000093531803" and vice versa. */
export function accountKeysMatch(a: string, b: string): boolean {
	if (!a || !b) return false;
	if (a === b) return true;
	const coreA = accountCore(a);
	const coreB = accountCore(b);
	if (coreA.length < 6 || coreB.length < 6) return false;
	return coreA.includes(coreB) || coreB.includes(coreA);
}

function daysBetween(a: string, b: string): number {
	return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;
}

export interface PairingContext {
	accounts: OwnAccount[];
	personNames: string[]; // normalised lowercase
	/** FX conversion for cross-currency candidates; null = unknown rate. */
	convert: (amountMinor: bigint, from: string, to: string, day: string) => bigint | null;
}

/**
 * Propose transfer pairs among the given transactions (both legs must be
 * present). Tiers:
 *  1. auto  — the out leg names the in leg's account (or vice versa), same
 *             currency, same amount, within 4 days
 *  2. auto  — same amount and currency, opposite signs, different accounts,
 *             within 2 days, and a household person's name on the counterparty
 *  3. review — cross-currency, FX-converted amounts within 2.5%, within 3 days
 */
export function proposePairs(txs: PairableTx[], ctx: PairingContext): PairProposal[] {
	const proposals: PairProposal[] = [];
	const used = new Set<string>();
	const accountById = new Map(ctx.accounts.map((a) => [a.id, a]));

	const outs = txs.filter((t) => t.amountMinor < 0n);
	const ins = txs.filter((t) => t.amountMinor > 0n);

	const namesCounterparty = (t: PairableTx) => {
		const norm = (t.counterparty ?? '').toLowerCase();
		return ctx.personNames.some((n) => n && norm.includes(n));
	};

	const counterpartyPointsAt = (t: PairableTx, other: OwnAccount) => {
		const key = t.counterpartyAccount ? normaliseAccountKey(t.counterpartyAccount) : '';
		return key !== '' && other.numberKeys.some((k) => accountKeysMatch(k, key));
	};

	// Tier 1 then tier 2 then tier 3, never reusing a leg.
	for (const tier of [1, 2, 3] as const) {
		for (const out of outs) {
			if (used.has(out.id)) continue;
			for (const inn of ins) {
				if (used.has(inn.id) || inn.accountId === out.accountId) continue;
				const inAccount = accountById.get(inn.accountId);
				const outAccount = accountById.get(out.accountId);
				if (!inAccount || !outAccount) continue;

				let hit = false;
				let confidence: 'auto' | 'review' = 'auto';

				if (tier === 1) {
					hit =
						out.currency === inn.currency &&
						-out.amountMinor === inn.amountMinor &&
						daysBetween(out.bookedAt, inn.bookedAt) <= 4 &&
						(counterpartyPointsAt(out, inAccount) || counterpartyPointsAt(inn, outAccount));
				} else if (tier === 2) {
					hit =
						out.currency === inn.currency &&
						-out.amountMinor === inn.amountMinor &&
						daysBetween(out.bookedAt, inn.bookedAt) <= 2 &&
						(namesCounterparty(out) || namesCounterparty(inn));
				} else {
					if (out.currency !== inn.currency && daysBetween(out.bookedAt, inn.bookedAt) <= 3) {
						const converted = ctx.convert(
							-out.amountMinor,
							out.currency,
							inn.currency,
							out.bookedAt
						);
						if (converted !== null && converted > 0n) {
							const diff = Number(converted - inn.amountMinor) / Number(inn.amountMinor);
							hit = Math.abs(diff) <= 0.025;
							confidence = 'review';
						}
					}
				}

				if (hit) {
					proposals.push({ outId: out.id, inId: inn.id, confidence });
					used.add(out.id);
					used.add(inn.id);
					break;
				}
			}
		}
	}

	return proposals;
}

/** Rows whose text marks them as internal moves even without the pair present. */
export function looksLikeTransfer(row: ParsedRow): boolean {
	const text = `${row.counterparty ?? ''} ${row.description ?? ''}`.toLowerCase();
	return /top-up|topup|vlastní převod|převod mezi|sent from revolut|to czk|to eur|to pln|exchange/i.test(
		text
	);
}
