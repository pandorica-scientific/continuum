// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * How strongly a statement proves itself.
 *
 * A preset may make acceptance fast but never makes it correct — acceptance is
 * arithmetic. This module is deliberately not a score: a statement either
 * satisfies a check, fails it, or the format never printed the evidence, and
 * those three outcomes are not interchangeable.
 *
 * Classes, strongest first:
 *
 *   P4  every row sits on a running balance chain, the chain meets the printed
 *       opening and closing, and the stated totals or count agree too
 *   P3  a complete running chain, with no independent anchor to check it against
 *   P2  no per-row balance, but opening + movements = closing AND the stated
 *       credit and debit totals agree
 *   P1  opening + movements = closing, with nothing independent to corroborate
 *   P0  nothing could be proven
 *
 * P1 is weaker than it looks, which is why it is its own class: two omitted
 * movements that happen to offset each other leave the endpoints intact. They
 * cannot also leave both stated totals intact, which is the whole reason P2
 * ranks above it.
 *
 * And arithmetic alone is not enough. A statement whose amounts AND balances
 * are every one of them misread by the same factor of a thousand closes its
 * chain perfectly. The lexical checks below are what close that hole.
 */
import { minorDigits } from '$lib/money';
import type { EnumValue } from '$lib/enums';
import type { ParsedRow, ParsedStatement } from './types';

// Declared once, in $lib/enums, so the CHECK constraint on import_file.proof_class
// and transaction.proof_class cannot drift from this union.
export type ProofClass = EnumValue<'proof_class'>;

type CheckStatus = 'pass' | 'fail' | 'unavailable';

interface ProofCheck {
	name: string;
	status: CheckStatus;
	/** Phrased for a person reading the statement's evidence panel. */
	detail: string;
}

interface LexicalFacts {
	currency: string;
	/** The amounts as the file displayed them, before any parsing. */
	amountTexts?: string[];
	/** False when the reader had to pick a decimal convention without evidence. */
	decimalMarkSettled?: boolean;
	/** False when the reader had to pick a date order without evidence. */
	dateOrderSettled?: boolean;
}

export interface Proof {
	proofClass: ProofClass;
	checks: ProofCheck[];
	/** Which ledger model the chain closed under, when one did. */
	chainModel?: string;
	/** A lexical check failed, so no arithmetic result may be trusted. */
	lexicallyUnsound: boolean;
}

const abs = (v: bigint) => (v < 0n ? -v : v);
const net = (row: ParsedRow) => row.amountMinor - (row.feeMinor ?? 0n);

const money = (v: bigint, digits = 2): string => {
	const sign = v < 0n ? '-' : '';
	const s = abs(v)
		.toString()
		.padStart(digits + 1, '0');
	return digits === 0 ? `${sign}${s}` : `${sign}${s.slice(0, -digits)}.${s.slice(-digits)}`;
};

/**
 * Does a running balance chain close?
 *
 * Both row orders are tried, because plenty of banks list newest first, and an
 * anchor to the printed opening balance is used when there is one — a chain
 * that closes internally but starts from the wrong place is not proof.
 */
function testChain(statement: ParsedStatement): {
	holds: boolean;
	/** False when the chain cannot be tested at all, which is not a failure. */
	testable: boolean;
	model?: string;
	covered: number;
} {
	const rows = statement.rows;
	const covered = rows.filter((r) => r.balanceAfterMinor !== undefined).length;
	if (covered === 0) return { holds: false, testable: false, covered };
	// A balance on some rows and not others is a real disagreement.
	if (covered !== rows.length) return { holds: false, testable: true, covered };
	// A chain needs somewhere to step FROM: a second balance, or a printed
	// opening balance. One row with one balance and no opening figure is not a
	// broken chain, it is no chain.
	if (rows.length < 2 && statement.openingBalanceMinor === undefined) {
		return { holds: false, testable: false, covered };
	}

	for (const [label, ordered] of [
		['as listed', rows],
		['newest first', [...rows].reverse()]
	] as const) {
		let holds = true;
		for (let i = 1; i < ordered.length; i++) {
			const previous = ordered[i - 1].balanceAfterMinor!;
			const current = ordered[i].balanceAfterMinor!;
			if (current !== previous + net(ordered[i])) {
				holds = false;
				break;
			}
		}
		if (!holds) continue;

		// Anchor to the opening balance when the statement printed one.
		if (statement.openingBalanceMinor !== undefined) {
			const first = ordered[0];
			if (first.balanceAfterMinor! !== statement.openingBalanceMinor + net(first)) continue;
		}
		return { holds: true, testable: true, model: label, covered };
	}
	return { holds: false, testable: true, covered };
}

/**
 * Lexical soundness: does the way the numbers were WRITTEN agree with the way
 * they were read?
 *
 * This is what stops arithmetic closure being mistaken for proof. A uniform
 * scale error survives every balance check ever devised, and shows up here
 * instead — as amounts carrying more fractional digits than the currency has.
 */
function lexicalChecks(facts: LexicalFacts | undefined): ProofCheck[] {
	if (!facts) return [];
	const checks: ProofCheck[] = [];
	const digits = minorDigits(facts.currency);

	if (facts.decimalMarkSettled === false) {
		checks.push({
			name: 'decimal convention',
			status: 'fail',
			detail: 'the file does not settle whether "," or "." is the decimal mark'
		});
	}
	if (facts.dateOrderSettled === false) {
		checks.push({
			name: 'date order',
			status: 'fail',
			detail: 'the file does not settle whether dates are day-first or month-first'
		});
	}

	const texts = (facts.amountTexts ?? []).filter(Boolean);
	if (texts.length > 0) {
		// Precision: a value printed with more fractional digits than the currency
		// has is being read at the wrong scale.
		const overPrecise = texts.filter((text) => {
			const cleaned = text.replace(/[^\d.,]/g, '');
			const lastSeparator = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','));
			if (lastSeparator === -1) return false;
			const tail = cleaned.length - lastSeparator - 1;
			// Three trailing digits is a thousands group, not precision.
			return tail !== 3 && tail > digits;
		});
		checks.push(
			overPrecise.length === 0
				? {
						name: 'monetary precision',
						status: 'pass',
						detail: `every amount fits ${facts.currency}'s ${digits} decimal places`
					}
				: {
						name: 'monetary precision',
						status: 'fail',
						detail: `${overPrecise.length} amounts carry more decimals than ${facts.currency} has, such as "${overPrecise[0]}"`
					}
		);

		// Negative marking: one convention per column, not three.
		const markers = new Set<string>();
		for (const text of texts) {
			if (/^\(.*\)$/.test(text.trim())) markers.add('parentheses');
			else if (text.trim().startsWith('-')) markers.add('leading minus');
			else if (text.trim().endsWith('-')) markers.add('trailing minus');
		}
		if (markers.size > 1) {
			checks.push({
				name: 'negative marking',
				status: 'fail',
				detail: `the column mixes ${[...markers].join(' and ')}`
			});
		}
	}
	return checks;
}

export function proveStatement(statement: ParsedStatement, facts?: LexicalFacts): Proof {
	const digits = minorDigits(statement.currency);
	const checks: ProofCheck[] = [];
	const sum = statement.rows.reduce((a, r) => a + net(r), 0n);

	const chain = testChain(statement);
	checks.push(
		!chain.testable
			? {
					name: 'running balance',
					status: 'unavailable',
					detail:
						chain.covered === 0
							? 'this statement prints no running balance'
							: 'one movement and one balance, with no opening figure to step from'
				}
			: chain.holds
				? {
						name: 'running balance',
						status: 'pass',
						detail: `the chain closes on all ${statement.rows.length} rows (${chain.model})`
					}
				: {
						name: 'running balance',
						status: 'fail',
						detail:
							chain.covered === statement.rows.length
								? 'the running balance does not follow from the movements'
								: `only ${chain.covered} of ${statement.rows.length} rows carry a balance`
					}
	);

	const hasEndpoints =
		statement.openingBalanceMinor !== undefined && statement.closingBalanceMinor !== undefined;
	const endpointsHold =
		hasEndpoints && statement.openingBalanceMinor! + sum === statement.closingBalanceMinor!;
	checks.push(
		!hasEndpoints
			? {
					name: 'opening and closing',
					status: 'unavailable',
					detail: 'this statement prints no opening or closing balance'
				}
			: endpointsHold
				? {
						name: 'opening and closing',
						status: 'pass',
						detail: `${money(statement.openingBalanceMinor!, digits)} + movements = ${money(statement.closingBalanceMinor!, digits)}`
					}
				: {
						name: 'opening and closing',
						status: 'fail',
						detail: `the movements come to ${money(sum, digits)}, which misses the closing balance by ${money(statement.closingBalanceMinor! - statement.openingBalanceMinor! - sum, digits)}`
					}
	);

	const credits = statement.rows.filter((r) => net(r) > 0n).reduce((a, r) => a + net(r), 0n);
	const debits = statement.rows.filter((r) => net(r) < 0n).reduce((a, r) => a - net(r), 0n);

	const totalsStated =
		statement.statedCreditTotalMinor !== undefined || statement.statedDebitTotalMinor !== undefined;
	const creditsHold =
		statement.statedCreditTotalMinor === undefined ||
		abs(statement.statedCreditTotalMinor) === credits;
	const debitsHold =
		statement.statedDebitTotalMinor === undefined ||
		abs(statement.statedDebitTotalMinor) === debits;
	checks.push(
		!totalsStated
			? {
					name: 'stated totals',
					status: 'unavailable',
					detail: 'this statement prints no credit or debit total'
				}
			: creditsHold && debitsHold
				? {
						name: 'stated totals',
						status: 'pass',
						detail: `credits ${money(credits, digits)} and debits ${money(debits, digits)} match the statement`
					}
				: {
						name: 'stated totals',
						status: 'fail',
						detail: `the movements come to ${money(credits, digits)} in and ${money(debits, digits)} out, which the statement does not agree with`
					}
	);

	const countStated = statement.statedRowCount !== undefined;
	const countHolds = !countStated || statement.statedRowCount === statement.rows.length;
	checks.push(
		!countStated
			? {
					name: 'movement count',
					status: 'unavailable',
					detail: 'this statement prints no movement count'
				}
			: countHolds
				? {
						name: 'movement count',
						status: 'pass',
						detail: `${statement.rows.length} movements, as stated`
					}
				: {
						name: 'movement count',
						status: 'fail',
						detail: `${statement.rows.length} movements were read but the statement says ${statement.statedRowCount}`
					}
	);

	const lexical = lexicalChecks(facts);
	checks.push(...lexical);
	const lexicallyUnsound = lexical.some((c) => c.status === 'fail');

	// Evidence that CONTRADICTS the rows is fatal, whatever else passed. A
	// running chain closes over the rows it has, so it cannot see a movement
	// missing from the END — every remaining step still follows — but the
	// printed closing balance can. Unavailable evidence is fine; contradicted
	// evidence is not, and the running balance must be included in this test:
	// otherwise a chain that demonstrably fails to follow from its own movements
	// could still reach P1 on endpoints that happened to survive.
	const chainContradicts = chain.testable && !chain.holds;
	const contradicted =
		chainContradicts ||
		(hasEndpoints && !endpointsHold) ||
		(totalsStated && !(creditsHold && debitsHold)) ||
		(countStated && !countHolds);

	// Ranked lexicographically: the class is decided by evidence, never by a
	// weighted score that could let a well-labelled failure outrank a proof.
	let proofClass: ProofClass = 'P0';
	if (!lexicallyUnsound && !contradicted) {
		const corroborated = (totalsStated && creditsHold && debitsHold) || (countStated && countHolds);
		if (chain.holds && endpointsHold && corroborated) proofClass = 'P4';
		else if (chain.holds) proofClass = 'P3';
		else if (endpointsHold && totalsStated && creditsHold && debitsHold) proofClass = 'P2';
		else if (endpointsHold) proofClass = 'P1';
	}

	return { proofClass, checks, chainModel: chain.model, lexicallyUnsound };
}

/** Ordering for comparison and display. */
export const PROOF_RANK: Record<ProofClass, number> = { P4: 4, P3: 3, P2: 2, P1: 1, P0: 0 };

/**
 * Do these readings already account for every movement the file claims?
 *
 * Asked when one region of a document read into a statement and another
 * failed: is the failing region a PART that would go unimported, or the same
 * money counted a second way (e.g. a balance-by-date recap that reads as a
 * movements table but fails its own arithmetic because its figures are
 * balances)?
 *
 * Arithmetic answers it: when what read closes the chain against the
 * statement's OWN printed opening and closing balances, no movement can be
 * missing, so a further failing region cannot be a part of the same statement.
 * If it does NOT close, money is unaccounted for and the failing region might
 * be carrying it, so filing what read would import only part of the file.
 *
 * A reading with no printed endpoints counts as not accounted for: silence is
 * not evidence. The residual exposure here is P1's own (two omitted movements
 * that offset each other leave the endpoints intact) — this adds none beyond
 * filing a P1 statement already carries.
 */
export function accountsForWholeFile(statements: ParsedStatement[]): boolean {
	if (statements.length === 0) return false;
	return statements.every((statement) => {
		const opening = statement.openingBalanceMinor;
		const closing = statement.closingBalanceMinor;
		if (opening === undefined || closing === undefined) return false;
		return opening + statement.rows.reduce((total, row) => total + net(row), 0n) === closing;
	});
}

interface ImportDecision {
	/** May this statement be filed without asking? */
	autoImport: boolean;
	reason: string;
}

/**
 * The agreed policy, in one place.
 *
 * A complete running chain is strong enough to file on its own. Weaker
 * arithmetic files only when the reading left nothing open — and when
 * something IS open, the answer is one specific question, never a refusal to
 * import at all.
 */
export function decideImport(
	proof: Proof,
	openQuestions: number,
	context: { verifiedProfile?: boolean } = {}
): ImportDecision {
	// Lexical soundness is never waived. A confirmed layout says the columns
	// mean what we think; it says nothing about the numbers being written at
	// the scale we read them.
	if (proof.lexicallyUnsound) {
		return { autoImport: false, reason: 'the numbers are not written the way they were read' };
	}
	if (openQuestions > 0) {
		return { autoImport: false, reason: 'something about the layout is still undecided' };
	}
	if (proof.proofClass === 'P4' || proof.proofClass === 'P3') {
		return { autoImport: true, reason: 'every movement sits on a running balance that closes' };
	}
	// P0 is refused even for a layout someone confirmed: confirming a mapping
	// says the columns mean what we think, not that all the rows are there, and
	// P0 means nothing in the file can answer that question either.
	if (proof.proofClass === 'P0') {
		return { autoImport: false, reason: 'nothing in the statement could be checked' };
	}
	// P1 and P2 only: the arithmetic here is real but partial, so a person
	// checking this mapping against a preview supplies what's missing.
	if (context.verifiedProfile) {
		return { autoImport: true, reason: 'this layout was confirmed for this bank already' };
	}
	// A refusal here is not a dead end: the reader hands back the table it
	// worked out, the person names the date and amount columns once, and the
	// saved profile means every later statement from that bank arrives already
	// understood. One question, once per bank.
	return {
		autoImport: false,
		reason:
			proof.proofClass === 'P2'
				? 'the balances and the stated totals agree, but no running balance carries the movements — confirm the columns once and this layout files unattended after that'
				: 'the opening and closing balances agree and nothing else corroborates them — two omitted movements that offset each other would leave exactly this, so confirm the columns once and this layout files unattended after that'
	};
}
