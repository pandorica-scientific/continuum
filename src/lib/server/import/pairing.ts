// SPDX-License-Identifier: AGPL-3.0-or-later
// Pure pairing logic, separated from the database so it can be unit tested
// hard — transfer mistakes silently corrupt income and spending figures.
//
// Only tier 1 (the counter-account provably names the other own account) may
// pair automatically. Everything weaker becomes a review proposal the user
// confirms, and stays inside the income/spending figures until they do.

export interface PairableTx {
	id: string;
	accountId: string;
	bookedOn: string; // ISO
	amountMinor: bigint;
	currency: string;
	counterparty?: string | null;
	counterpartyAccount?: string | null;
}

interface OwnAccount {
	id: string;
	currency: string;
	/** normalised account-number forms, retaining Czech prefix/bank separators */
	numberKeys: string[];
}

interface PairProposal {
	outId: string;
	inId: string;
	/** auto pairs are excluded from figures immediately; review pairs ask */
	confidence: 'auto' | 'review';
}

export function normaliseAccountKey(raw: string): string {
	return raw.toUpperCase().replace(/[^A-Z0-9/-]/g, '');
}

interface CzechAccountIdentity {
	bank: string;
	prefix: string;
	number: string;
}

function stripLeadingZeroes(value: string): string {
	return value.replace(/^0+/, '') || '0';
}

function czechAccountIdentity(raw: string): CzechAccountIdentity | null {
	const key = normaliseAccountKey(raw);
	const local = /^(?:(\d{1,6})-)?(\d{1,10})\/(\d{4})$/.exec(key);
	if (local) {
		return {
			bank: local[3],
			prefix: stripLeadingZeroes(local[1] ?? '0'),
			number: stripLeadingZeroes(local[2])
		};
	}

	// Czech IBAN: country/check digits, bank code, six-digit prefix and
	// ten-digit account number.
	const iban = /^CZ\d{2}(\d{4})(\d{6})(\d{10})$/.exec(key);
	if (!iban) return null;
	return {
		bank: iban[1],
		prefix: stripLeadingZeroes(iban[2]),
		number: stripLeadingZeroes(iban[3])
	};
}

/** Stable lock/dedup key; Czech local and IBAN forms collapse to one identity. */
export function canonicalAccountIdentity(raw: string): string {
	const identity = czechAccountIdentity(raw);
	return identity
		? `CZ:${identity.bank}:${identity.prefix}:${identity.number}`
		: normaliseAccountKey(raw);
}

function isIban(key: string): boolean {
	return /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(key);
}

/** Digits only, leading zeros dropped, for comparing the same account written
 *  as an IBAN and as a national number. */
function digitCore(key: string): string {
	return stripLeadingZeroes(key.replace(/\D/g, ''));
}

/** "93531803/5500" matches "CZ6955000000000093531803" and vice versa. */
export function accountKeysMatch(a: string, b: string): boolean {
	if (!a || !b) return false;
	const keyA = normaliseAccountKey(a);
	const keyB = normaliseAccountKey(b);
	if (keyA === keyB) return true;

	const identityA = czechAccountIdentity(keyA);
	const identityB = czechAccountIdentity(keyB);
	if (identityA && identityB) {
		return (
			identityA.bank === identityB.bank &&
			identityA.prefix === identityB.prefix &&
			identityA.number === identityB.number
		);
	}
	// A Czech reference is structural: its local form reorders the IBAN's
	// fields, so comparing it as a flat run of digits would be wrong both ways.
	if (identityA || identityB) return false;

	// Everywhere else the national number is the IBAN's own body, so the same
	// account written both ways differs only by country and check digits.
	// Requiring a Czech identity on both sides meant a Polish or Revolut account
	// could never match its own IBAN: own-account transfers stopped pairing and
	// kept counting as real income and real spending, and resolveAccount saw no
	// match and minted a duplicate account that every row was re-imported under.
	const aIsIban = isIban(keyA);
	const bIsIban = isIban(keyB);
	// Two different IBANs are two different accounts, and two national forms
	// have already been compared exactly.
	if (aIsIban === bIsIban) return false;
	const ibanKey = aIsIban ? keyA : keyB;
	const local = digitCore(aIsIban ? keyB : keyA);
	if (local.length < 8) return false;
	// Some countries' national form is the IBAN body; others — Poland's NRB
	// among them — keep the check digits in it. Accept either reading rather
	// than encoding a per-country table for a household ledger.
	return local === digitCore(ibanKey.slice(4)) || local === digitCore(ibanKey.slice(2));
}

/**
 * Household-name tokens usable as transfer evidence: whole words of at least
 * four letters, diacritics stripped. Excludes short first names ("Jan", "Eva")
 * that substring-match half the Czech merchant registry.
 */
export function nameTokens(personNames: string[]): string[] {
	return personNames
		.flatMap((name) => name.split(/[\s,]+/))
		.map((token) =>
			token
				.toLowerCase()
				.normalize('NFD')
				.replace(/[̀-ͯ]/g, '')
				.replace(/[^a-z]/g, '')
		)
		.filter((token) => token.length >= 4);
}

function mentionsName(text: string | null | undefined, tokens: string[]): boolean {
	if (!text) return false;
	const words = text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.split(/[^a-z]+/);
	return tokens.some((token) => words.includes(token));
}

function daysBetween(a: string, b: string): number {
	return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;
}

export interface PairingContext {
	accounts: OwnAccount[];
	/** full person names; tokenised internally */
	personNames: string[];
	/** FX conversion for cross-currency candidates; null = unknown rate. */
	convert: (amountMinor: bigint, from: string, to: string, day: string) => bigint | null;
}

/**
 * Propose transfer pairs among the given transactions (both legs must be
 * present). Tiers of evidence:
 *  1. auto   — the out leg names the in leg's account (or vice versa), same
 *              currency, same amount, within 4 days
 *  2. review — same amount and currency, opposite signs, different accounts,
 *              within 2 days, and a household name (whole word, ≥4 letters)
 *              on a counterparty
 *  3. review — cross-currency, FX-converted amounts within 2.5%, within 3 days
 *
 * Candidates are scored (tier first, then date gap); a tie between two equally
 * good candidates downgrades an auto pair to review. Input order never changes
 * the outcome: legs are sorted internally.
 */
export function proposePairs(txs: PairableTx[], ctx: PairingContext): PairProposal[] {
	const proposals: PairProposal[] = [];
	const used = new Set<string>();
	const accountById = new Map(ctx.accounts.map((a) => [a.id, a]));
	const tokens = nameTokens(ctx.personNames);

	const byDateThenId = (a: PairableTx, b: PairableTx) =>
		a.bookedOn < b.bookedOn ? -1 : a.bookedOn > b.bookedOn ? 1 : a.id < b.id ? -1 : 1;
	const outs = txs.filter((t) => t.amountMinor < 0n).sort(byDateThenId);
	const ins = txs.filter((t) => t.amountMinor > 0n).sort(byDateThenId);

	const counterpartyPointsAt = (t: PairableTx, other: OwnAccount) => {
		const key = t.counterpartyAccount ? normaliseAccountKey(t.counterpartyAccount) : '';
		return key !== '' && other.numberKeys.some((k) => accountKeysMatch(k, key));
	};

	interface Candidate {
		inn: PairableTx;
		tier: 1 | 2 | 3;
		gap: number;
	}

	for (const out of outs) {
		if (used.has(out.id)) continue;
		const outAccount = accountById.get(out.accountId);
		if (!outAccount) continue;

		const candidates: Candidate[] = [];
		for (const inn of ins) {
			if (used.has(inn.id) || inn.accountId === out.accountId) continue;
			const inAccount = accountById.get(inn.accountId);
			if (!inAccount) continue;
			const gap = daysBetween(out.bookedOn, inn.bookedOn);

			if (
				out.currency === inn.currency &&
				-out.amountMinor === inn.amountMinor &&
				gap <= 4 &&
				(counterpartyPointsAt(out, inAccount) || counterpartyPointsAt(inn, outAccount))
			) {
				candidates.push({ inn, tier: 1, gap });
			} else if (
				out.currency === inn.currency &&
				-out.amountMinor === inn.amountMinor &&
				gap <= 2 &&
				(mentionsName(out.counterparty, tokens) || mentionsName(inn.counterparty, tokens))
			) {
				candidates.push({ inn, tier: 2, gap });
			} else if (out.currency !== inn.currency && gap <= 3) {
				const converted = ctx.convert(-out.amountMinor, out.currency, inn.currency, out.bookedOn);
				if (converted !== null && converted > 0n && inn.amountMinor > 0n) {
					const diff = Number(converted - inn.amountMinor) / Number(inn.amountMinor);
					if (Math.abs(diff) <= 0.025) candidates.push({ inn, tier: 3, gap });
				}
			}
		}

		if (candidates.length === 0) continue;
		candidates.sort((a, b) => a.tier - b.tier || a.gap - b.gap || (a.inn.id < b.inn.id ? -1 : 1));
		const best = candidates[0];
		const tied =
			candidates.length > 1 && candidates[1].tier === best.tier && candidates[1].gap === best.gap;

		const confidence: 'auto' | 'review' = best.tier === 1 && !tied ? 'auto' : 'review';
		proposals.push({ outId: out.id, inId: best.inn.id, confidence });
		used.add(out.id);
		used.add(best.inn.id);
	}

	return proposals;
}
