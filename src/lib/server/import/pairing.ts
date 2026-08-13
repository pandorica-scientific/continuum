// Pure pairing logic, separated from the database so it can be unit tested
// hard — transfer mistakes silently corrupt income and spending figures.
//
// Only tier 1 (the counter-account provably names the other own account) may
// pair automatically. Everything weaker becomes a review proposal the user
// confirms, and stays inside the income/spending figures until they do.

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
	/** auto pairs are excluded from figures immediately; review pairs ask */
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
		a.bookedAt < b.bookedAt ? -1 : a.bookedAt > b.bookedAt ? 1 : a.id < b.id ? -1 : 1;
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
			const gap = daysBetween(out.bookedAt, inn.bookedAt);

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
				const converted = ctx.convert(-out.amountMinor, out.currency, inn.currency, out.bookedAt);
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
