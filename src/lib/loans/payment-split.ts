// SPDX-License-Identifier: AGPL-3.0-or-later
// How much of a loan payment was interest, and how much was principal.
//
// A mortgage instalment is not one cost. The interest is money the household
// will never see again; the principal is its own money, moved out of an account
// and into a flat. Counting the whole instalment as spending understates what
// the household puts aside by the larger half of it, every month, for decades —
// which is why the cash-flow chart asks for the two halves separately.
//
// The rules, in the order they are tried. Each answer carries the basis it was
// reached by, because "the bank said so" and "we worked it out from a balance
// that is newer than the payment" are not the same claim:
//
//   1. `stated` — the statement split the payment and the split was recorded.
//      Nothing derived beats what the bank printed.
//   2. `extra` — an extra repayment with nothing stated is all principal. It is
//      paid on top of the instalment that already carried the month's interest.
//   3. `amortised` — the payment falls in a month the projection reaches, so
//      the schedule's own row for that month says what the instalment carried:
//      the instalment minus the principal it repaid, which is the row's own
//      interest under the payment style and last month's charge under the
//      calendar one, where a month's interest is collected with the next
//      instalment.
//   4. `balance-event` / `current-balance` — the payment is older than the
//      balance on record, so no projection reaches it. Interest is charged on
//      the newest balance statement in that month or earlier; with no statement
//      the current balance stands in, which understates an old month because
//      the debt was larger then. The basis is what lets a reader tell.
//   5. Interest is capped at the payment, so the principal half is never
//      negative — and a month with no rate on record is left unsplit
//      altogether, because inventing a rate would invent a cost.
//
// Pure: no database, no clock. The day an undated balance is current as of
// arrives as `today`, so every rule above is decidable from its arguments and
// the same payment always splits the same way.

import {
	amortise,
	interestForMonth,
	periodForMonth,
	rateForMonth,
	type DayCount,
	type FixationPeriod,
	type LoanTerms,
	type MonthRow
} from './amortise';
import { anchorMonthFor } from './simulate';

/** How a split was arrived at, worst case last. */
export type SplitBasis = 'stated' | 'extra' | 'amortised' | 'balance-event' | 'current-balance';

/** A payment as the record holds it, reduced to what a split needs. */
export interface LoanPaymentEvent {
	/** ISO date. */
	happenedOn: string;
	/** `payment` or `extra_payment`; anything else is treated as an instalment. */
	kind: string;
	amountMinor: bigint;
	/** What the statement said the interest was, on the statements that say. */
	interestMinor: bigint | null;
}

/** A balance statement: what was owed, and the day it was said. */
export interface BalanceStatement {
	happenedOn: string;
	amountMinor: bigint;
}

/** The loan a payment belongs to, as plain rows rather than a query. */
export interface SplitLoan {
	owedMinor: bigint;
	/** The day `owedMinor` was observed, null when nobody has said. */
	owedOn: string | null;
	dayCount?: DayCount;
	accrualStyle?: LoanTerms['accrualStyle'];
	paymentDay?: number | null;
	periods: FixationPeriod[];
	/** Every balance statement on the loan, in any order. */
	balances?: BalanceStatement[];
	/** The day the record is being read on, for a balance carrying no date. */
	today: string;
}

export interface PaymentSplit {
	interestMinor: bigint;
	principalMinor: bigint;
	basis: SplitBasis;
}

/**
 * The two halves of one payment, or null when nothing honest can be said —
 * a payment of nothing, or a month the loan has no rate for.
 */
export function splitLoanPayment(event: LoanPaymentEvent, loan: SplitLoan): PaymentSplit | null {
	const payment = event.amountMinor;
	// A payment of nothing has no halves, and every caller divides by it to get
	// a ratio — which is how one bad row becomes a NaN three screens away.
	if (payment <= 0n) return null;

	if (event.interestMinor !== null) return capped(event.interestMinor, payment, 'stated');
	if (event.kind === 'extra_payment') return capped(0n, payment, 'extra');

	const month = event.happenedOn.slice(0, 7);
	const paymentDay = loan.paymentDay ?? 1;
	// The rule the loans screen anchors its own projection with: a balance
	// observed after the payment day already reflects that month's instalment,
	// so the schedule starts the month after.
	const owedAsOfMonth = anchorMonthFor(loan.owedOn ?? loan.today, loan.paymentDay);
	const terms: LoanTerms = {
		owedMinor: loan.owedMinor,
		owedAsOfMonth,
		dayCount: loan.dayCount,
		accrualStyle: loan.accrualStyle,
		paymentDay
	};

	if (month >= owedAsOfMonth) {
		const row = amortise(terms, loan.periods, month).find((booked) => booked.month === month);
		// A schedule can stop short of the month asked for — a loan paid off
		// before it, periods that do not reach it — and a projection that never
		// booked the month cannot say what it charged. The older-month rule
		// below answers instead of a zero.
		if (row) return capped(instalmentInterest(row, loan, month), payment, 'amortised');
	}

	const rate = rateForMonth(loan.periods, month);
	if (rate === null) return null;
	const statement = newestBalanceUpTo(loan.balances ?? [], month);
	return capped(
		interestForMonth(
			statement?.amountMinor ?? loan.owedMinor,
			rate,
			month,
			loan.dayCount,
			paymentDay
		),
		payment,
		statement ? 'balance-event' : 'current-balance'
	);
}

/**
 * The interest inside the instalment collected in `month`, which is not always
 * the interest the schedule books against that month.
 *
 * Under the calendar style — Česká spořitelna's, and the reason the column
 * exists — interest accrues over the calendar month, is charged on its last day
 * and is collected with the NEXT instalment. The row for a month therefore
 * carries the charge that month accrued while its `principalMinor` is what this
 * month's instalment repaid after clearing LAST month's charge. Taking the
 * row's own `interestMinor` would split the payment against a charge it did not
 * carry, by a tenth of it in a long act/360 month, and the split would disagree
 * with the schedule the loans screen draws from the same rows.
 *
 * What the instalment carried is what it did not repay, which is true under
 * both styles — and under the payment style it is `row.interestMinor` again,
 * except in a final month whose principal was clamped to the balance left.
 */
function instalmentInterest(row: MonthRow, loan: SplitLoan, month: string): bigint {
	if (loan.accrualStyle !== 'calendar') return row.interestMinor;
	const instalment = periodForMonth(loan.periods, month)?.paymentMinor;
	// A row exists only for a month a period was in force for, so the period is
	// there; without one there is nothing to subtract from and the row's own
	// figure is the better of two imperfect answers.
	return instalment === undefined ? row.interestMinor : instalment - row.principalMinor;
}

/**
 * The newest balance stated in `month` or earlier, or null.
 *
 * Compared by month rather than by day, because the rule is about which month's
 * interest is being worked out: a statement issued during the month is still the
 * best account of what the month was charged on.
 */
function newestBalanceUpTo(balances: BalanceStatement[], month: string): BalanceStatement | null {
	let newest: BalanceStatement | null = null;
	for (const balance of balances) {
		if (balance.happenedOn.slice(0, 7) > month) continue;
		if (!newest || balance.happenedOn > newest.happenedOn) newest = balance;
	}
	return newest;
}

/**
 * How one register line divides, given the claim that says what the payment
 * carried.
 *
 * `netMinor` is the line as every other consumer counts it — `amount_minor`
 * less the bank's own fee, signed, so a debit stays negative. The claim is the
 * loan event: its own amount, and the interest inside it.
 *
 * A share of the line rather than the event's own minor units, because the two
 * can be stated in different scales — a fee netted off, an event recorded
 * against a figure the statement rounded — and a share is what keeps the halves
 * summing to exactly the line they came from. The principal is the remainder
 * for that reason, and rule 5's clamp is applied here too, so a stated interest
 * larger than the payment cannot produce a line repaying a negative debt.
 *
 * Rounded half away from zero, which is what `round(numeric)` does — and the
 * register's own effective-line relation computes these same two halves in the
 * database, so the two roundings have to agree or a panel prints figures its own
 * footer contradicts by a minor unit.
 *
 * Agreeing takes more than picking the same rounding rule. The arithmetic below
 * is exact throughout: the product is taken first and the single division is the
 * only place anything is lost, which is why the SQL multiplies before it divides
 * rather than working out a share and applying it. A share worked out first is a
 * numeric of about twenty digits, and an exact half — 20 000 of a 2 400 000
 * payment against a line of 2 402 100 is exactly 20 017.5 — is no longer exactly
 * a half by the time it is rounded.
 */
export function splitPaymentLine(
	netMinor: bigint,
	claim: { amountMinor: bigint; interestMinor: bigint }
): { interestMinor: bigint; principalMinor: bigint } | null {
	if (claim.amountMinor <= 0n) return null;
	const stated =
		claim.interestMinor < 0n
			? 0n
			: claim.interestMinor > claim.amountMinor
				? claim.amountMinor
				: claim.interestMinor;
	const scaled = netMinor * stated;
	const whole = scaled / claim.amountMinor;
	const rest = scaled % claim.amountMinor;
	const magnitude = rest < 0n ? -rest : rest;
	// Half away from zero: `>=` rather than `>`, and stepped in the direction the
	// line itself points, which is what `round()` does to a negative numeric.
	const rounded = 2n * magnitude >= claim.amountMinor ? (scaled < 0n ? -1n : 1n) : 0n;
	const interestMinor = whole + rounded;
	return { interestMinor, principalMinor: netMinor - interestMinor };
}

/**
 * Rule 5, applied to every answer above rather than to one of them: interest is
 * whatever was worked out, clamped into the payment it was taken from. A
 * statement can disagree with the schedule and a stale balance can overstate the
 * charge, but neither is grounds for reporting a payment that repaid a negative
 * amount of debt.
 */
function capped(interestMinor: bigint, payment: bigint, basis: SplitBasis): PaymentSplit {
	const interest = interestMinor < 0n ? 0n : interestMinor > payment ? payment : interestMinor;
	return { interestMinor: interest, principalMinor: payment - interest, basis };
}
