// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { uuidv7 } from 'uuidv7';
import { asEnumValue, isEnumValue, type EnumValue } from '$lib/enums';
import { and, asc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';

import { PAYMENT_KINDS } from '$lib/loans';
import { splitLoanPayment } from '$lib/loans/payment-split';
import { parseAmountToMinor } from '$lib/money';
import { addRatios, tryRatioFromPercent, type Ratio } from '$lib/property/finance';
import { db, type Db } from '$lib/server/db';
import {
	loan,
	loanEvent,
	loanFixationPeriod,
	loanProperty,
	property,
	transaction
} from '$lib/server/db/schema';

type LoanMutationResult = { ok: true } | { ok: false; status: number; message: string };

/**
 * The kind a linked instalment is written as, and the only kind unlinking takes
 * back. Named once so the two cannot answer differently: an `extra_payment`
 * moved the balance anchor when it was recorded, so deleting one would leave the
 * loan owing less than its own history accounts for. Undoing that is the
 * repayment's business, not this one's.
 */
const LINKED_PAYMENT_KIND: EnumValue<'loan_event.kind'> = 'payment';

/**
 * The kind that states what was owed on a day.
 *
 * Read when a payment is recorded without a stated interest: a payment older
 * than everything the schedule projects is charged on the newest balance
 * statement in its month or earlier — rule 4 of the split.
 */
const BALANCE_KIND: EnumValue<'loan_event.kind'> = 'balance';

interface RepaymentInput {
	loanId: string;
	date: string;
	amount: string;
	balanceAfter: string;
	note: string;
}

interface LinkedPaymentInput {
	loanId: string;
	transactionId: string;
	/** What the statement said the interest was; blank when it did not say. */
	interest?: string;
	note?: string;
}

interface FixationInput {
	loanId: string;
	startsOn: string;
	endsOn: string | null;
	rate: string;
	payment: string;
}

export interface SecuredPropertyInput {
	propertyId: string;
	sharePct: string | null;
}

export interface CreateLoanInput {
	name: string;
	lender: string;
	kind: string;
	currency: string;
	principal: string;
	owed: string;
	payment: string;
	rate: string;
	regime: string;
	dayCount: string;
	accrualStyle: string;
	paymentDay: number | null;
	fixedUntil: string | null;
	startsOn: string | null;
	endsOn: string | null;
	interestDeductible: boolean;
	secured: SecuredPropertyInput[];
	today?: string;
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function isIsoDay(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Record an extra repayment and move the balance anchor as one serialized
 * mutation. Locking the loan ensures two tabs subtract from successive
 * balances instead of the same stale balance.
 */
export async function recordRepayment(
	input: RepaymentInput,
	handle: Db = db
): Promise<LoanMutationResult> {
	const happenedOn = input.date.trim() || today();
	if (!isIsoDay(happenedOn)) {
		return { ok: false, status: 400, message: 'The repayment needs a valid date.' };
	}
	if (happenedOn > today()) {
		return { ok: false, status: 400, message: 'The repayment cannot be in the future.' };
	}

	return handle.transaction(async (tx) => {
		const rows = await tx.select().from(loan).where(eq(loan.id, input.loanId)).for('update');
		const current = rows[0];
		if (!current) return { ok: false, status: 404, message: 'Loan not found.' };
		if (current.startsOn && happenedOn < current.startsOn) {
			return {
				ok: false,
				status: 400,
				message: 'The repayment cannot predate the loan agreement.'
			};
		}
		if (current.owedOn && happenedOn < current.owedOn) {
			return {
				ok: false,
				status: 400,
				message: 'The repayment cannot predate the current balance.'
			};
		}

		let amount: bigint;
		let balanceAfter: bigint | null = null;
		try {
			amount = parseAmountToMinor(input.amount, current.currency);
			if (amount <= 0n) throw new Error('amount');
			if (input.balanceAfter.trim()) {
				balanceAfter = parseAmountToMinor(input.balanceAfter, current.currency);
				if (balanceAfter < 0n) throw new Error('balance');
			}
		} catch {
			return {
				ok: false,
				status: 400,
				message: 'The repayment amount must be a positive number.'
			};
		}
		if (
			current.owedMinor <= 0n ||
			amount > current.owedMinor ||
			(balanceAfter !== null && balanceAfter >= current.owedMinor)
		) {
			return {
				ok: false,
				status: 400,
				message: 'The repayment cannot exceed or increase the current balance.'
			};
		}

		let newOwed = balanceAfter ?? current.owedMinor - amount;
		if (newOwed < 0n) newOwed = 0n;

		await tx.insert(loanEvent).values({
			id: uuidv7(),
			loanId: input.loanId,
			happenedOn,
			kind: 'extra_payment',
			amountMinor: amount,
			note: input.note.trim() || null
		});
		await tx
			.update(loan)
			.set({ owedMinor: newOwed, owedOn: happenedOn })
			.where(eq(loan.id, input.loanId));
		return { ok: true };
	});
}

/**
 * Record a bank debit as an instalment paid towards a loan.
 *
 * The link is the whole point. `loan_event.transaction_id` is what divides an
 * instalment into the interest the household will never see again and the
 * principal it moved into a flat — and nothing wrote that column, so the split
 * was code that could never fire on a real ledger.
 *
 * The division itself is decided here, once, and written to `interest_minor`.
 * Every reader afterwards — the chart and the register's own SQL — reads that
 * one figure, which is what stops the two of them working out two different
 * answers about the same debit.
 *
 * Deliberately does NOT move the balance anchor, which is what separates this
 * from `recordRepayment` above. A scheduled instalment is the payment the
 * amortisation already assumes; subtracting it from `owed_minor` as well would
 * count it twice and walk the balance down at double speed. Only an extra
 * repayment — money the schedule did not expect — moves the anchor.
 *
 * Serialised on the loan row for the same reason repayments are: two tabs
 * recording the same statement must not both get past the duplicate check.
 */
export async function recordLinkedPayment(
	input: LinkedPaymentInput,
	handle: Db = db
): Promise<LoanMutationResult> {
	return handle.transaction(async (tx) => {
		const rows = await tx.select().from(loan).where(eq(loan.id, input.loanId)).for('update');
		const current = rows[0];
		if (!current) return { ok: false, status: 404, message: 'Loan not found.' };

		const movements = await tx
			.select()
			.from(transaction)
			.where(eq(transaction.id, input.transactionId));
		const movement = movements[0];
		if (!movement) return { ok: false, status: 404, message: 'Transaction not found.' };
		if (movement.amountMinor >= 0n) {
			return {
				ok: false,
				status: 400,
				message: 'Only money leaving an account can be a loan payment.'
			};
		}
		// `notOwnTransfer()` as a predicate over one loaded row rather than as SQL,
		// and it has to exclude both kinds for the same reason that helper does: a
		// matched pair proved by two statements, and a one-sided transfer asserted
		// by a person. Neither left the household, so neither paid anybody's loan.
		if (movement.transferPairId !== null || movement.transferToAccountId !== null) {
			return {
				ok: false,
				status: 400,
				message: 'A transfer between your own accounts is not a loan payment.'
			};
		}

		// The two figures have to be in the same unit or nothing downstream means
		// anything: the split divides the event's amount by an interest stated in
		// the loan's currency, and the chart applies that ratio to the register
		// line. Converting here would be this mutation guessing a rate on a day
		// nobody asked it about, so it refuses and names both currencies instead.
		if (movement.currency !== current.currency) {
			return {
				ok: false,
				status: 400,
				message: `This debit is in ${movement.currency}; ${current.name} is in ${current.currency}.`
			};
		}

		// One claim per transaction, over every loan rather than this one: the same
		// debit recorded against two mortgages would be the household paying one
		// instalment twice, and the split keeps only the first claim anyway.
		const claimed = await tx
			.select({ id: loanEvent.id })
			.from(loanEvent)
			.where(
				and(
					eq(loanEvent.transactionId, input.transactionId),
					inArray(loanEvent.kind, PAYMENT_KINDS)
				)
			)
			.limit(1);
		if (claimed.length > 0) {
			return {
				ok: false,
				status: 409,
				message: 'This transaction is already recorded as a loan payment.'
			};
		}

		// Net of the bank's own fee and as a magnitude: `amount_minor - fee_minor`
		// is what every other consumer of a transaction counts, and a loan event
		// states what was paid rather than which way it went.
		const amount = -(movement.amountMinor - (movement.feeMinor ?? 0n));

		let interestMinor: bigint | null = null;
		const stated = input.interest?.trim() ?? '';
		if (stated) {
			try {
				interestMinor = parseAmountToMinor(stated, current.currency);
				if (interestMinor < 0n || interestMinor > amount) throw new Error('range');
			} catch {
				return {
					ok: false,
					status: 400,
					message: 'The interest part must be an amount within the payment.'
				};
			}
		}

		// The value date when the bank prints one, which is the day the money
		// actually moved — the same preference cash flow reads a row by.
		const happenedOn = movement.valueOn ?? movement.bookedOn;

		// What the statement did not say, worked out here rather than on every
		// render. The five rules in `$lib/loans/payment-split` are unchanged and
		// still the only place that decides it; deciding it ONCE is what lets the
		// register express the same two lines in SQL, where an amortisation
		// schedule per row is not something a query can run. Null stays null: a
		// month with no rate on record has no honest split, and that payment is
		// simply not divided, on any screen.
		if (interestMinor === null) {
			const periods = await tx
				.select()
				.from(loanFixationPeriod)
				.where(eq(loanFixationPeriod.loanId, input.loanId));
			const balances = await tx
				.select()
				.from(loanEvent)
				.where(and(eq(loanEvent.loanId, input.loanId), eq(loanEvent.kind, BALANCE_KIND)));
			const split = splitLoanPayment(
				{ happenedOn, kind: LINKED_PAYMENT_KIND, amountMinor: amount, interestMinor: null },
				{
					owedMinor: current.owedMinor,
					owedOn: current.owedOn,
					dayCount: current.dayCount,
					accrualStyle: current.accrualStyle,
					paymentDay: current.paymentDay,
					periods: periods.map((period) => ({
						startsOn: period.startsOn,
						endsOn: period.endsOn,
						annualRatePct: Number(period.annualRatePct),
						paymentMinor: period.paymentMinor
					})),
					balances: balances.map((balance) => ({
						happenedOn: balance.happenedOn,
						amountMinor: balance.amountMinor
					})),
					// What an undated balance is current as of. Read here, at record
					// time, so the figure stored is the one the record supported on
					// the day somebody said this debit was an instalment.
					today: new Date().toISOString().slice(0, 10)
				}
			);
			interestMinor = split?.interestMinor ?? null;
		}

		await tx.insert(loanEvent).values({
			id: uuidv7(),
			loanId: input.loanId,
			happenedOn,
			kind: LINKED_PAYMENT_KIND,
			amountMinor: amount,
			interestMinor,
			note: input.note?.trim() || null,
			transactionId: input.transactionId
		});
		return { ok: true };
	});
}

/**
 * Take back a recorded instalment, leaving the transaction as it was.
 *
 * Recording is otherwise a one-way door, and a wrong one is easy to walk
 * through: the loan is chosen from a list, a stated interest beats every
 * derivation the split would have made, and the duplicate guard then refuses to
 * let anybody correct it. Nothing else in the app deletes a `loan_event`, so
 * without this a debit filed against the wrong mortgage stayed filed against it.
 *
 * Only the kind `recordLinkedPayment` writes, never an `extra_payment` — see
 * `LINKED_PAYMENT_KIND`. No lock and no transaction: one conditional DELETE is
 * atomic on its own, and the row count is what says whether there was anything
 * to take back.
 */
export async function unlinkLoanPayment(
	transactionId: string,
	handle: Db = db
): Promise<LoanMutationResult> {
	const removed = await handle
		.delete(loanEvent)
		.where(and(eq(loanEvent.transactionId, transactionId), eq(loanEvent.kind, LINKED_PAYMENT_KIND)))
		.returning({ id: loanEvent.id });
	if (removed.length === 0) {
		return {
			ok: false,
			status: 404,
			message: 'No loan payment is recorded against this transaction.'
		};
	}
	return { ok: true };
}

/**
 * Replace the projected fixation schedule from a boundary while preserving
 * immutable history before it. The event and chronology change commit or roll
 * back together.
 */
export async function replaceFixation(
	input: FixationInput,
	handle: Db = db
): Promise<LoanMutationResult> {
	const startsOn = input.startsOn.trim();
	if (!isIsoDay(startsOn)) {
		return { ok: false, status: 400, message: 'The new fixation needs a valid start date.' };
	}
	const endsOn = input.endsOn?.trim() || null;
	if (endsOn && (!isIsoDay(endsOn) || endsOn <= startsOn)) {
		return { ok: false, status: 400, message: 'The fixation end must be after its start.' };
	}

	return handle.transaction(async (tx) => {
		const rows = await tx.select().from(loan).where(eq(loan.id, input.loanId)).for('update');
		const current = rows[0];
		if (!current) return { ok: false, status: 404, message: 'Loan not found.' };
		if (current.startsOn && startsOn < current.startsOn) {
			return {
				ok: false,
				status: 400,
				message: 'The fixation cannot predate the loan agreement.'
			};
		}
		if (
			current.endsOn &&
			(startsOn >= current.endsOn || (endsOn !== null && endsOn > current.endsOn))
		) {
			return { ok: false, status: 400, message: 'The fixation cannot outlast the loan.' };
		}
		let payment: bigint;
		const rate = Number(input.rate.replace(',', '.'));
		try {
			payment = parseAmountToMinor(input.payment, current.currency);
			if (payment <= 0n || !Number.isFinite(rate) || rate < 0 || rate > 100) {
				throw new Error('rate');
			}
		} catch {
			return {
				ok: false,
				status: 400,
				message: 'Rate and payment must be positive numbers.'
			};
		}

		// A later period is schedule the bank has already agreed, not something a
		// re-fix may silently destroy. Deleting everything from startsOn onward
		// threw away a committed follow-on with no warning and no recovery, so
		// only the period starting on exactly this boundary is replaced.
		const following = await tx
			.select({ startsOn: loanFixationPeriod.startsOn })
			.from(loanFixationPeriod)
			.where(
				and(eq(loanFixationPeriod.loanId, input.loanId), gt(loanFixationPeriod.startsOn, startsOn))
			)
			.orderBy(asc(loanFixationPeriod.startsOn))
			.limit(1);
		const nextStart = following[0]?.startsOn ?? null;
		if (endsOn && nextStart && endsOn > nextStart) {
			return {
				ok: false,
				status: 400,
				message: `The fixation would overlap the one starting ${nextStart}.`
			};
		}
		// A blank end means "not fixed to a date", so it runs until the next
		// agreed period or stays open. Defaulting to the loan's maturity wrote a
		// decades-long fixation nobody entered and the dialog never previewed.
		const persistedEndDate = endsOn ?? nextStart;

		await tx
			.delete(loanFixationPeriod)
			.where(
				and(eq(loanFixationPeriod.loanId, input.loanId), eq(loanFixationPeriod.startsOn, startsOn))
			);
		await tx
			.update(loanFixationPeriod)
			.set({ endsOn: startsOn })
			.where(
				and(
					eq(loanFixationPeriod.loanId, input.loanId),
					lt(loanFixationPeriod.startsOn, startsOn),
					or(isNull(loanFixationPeriod.endsOn), gt(loanFixationPeriod.endsOn, startsOn))
				)
			);
		await tx.insert(loanFixationPeriod).values({
			id: uuidv7(),
			loanId: input.loanId,
			startsOn,
			endsOn: persistedEndDate,
			annualRatePct: String(rate),
			paymentMinor: payment
		});
		await tx.insert(loanEvent).values({
			id: uuidv7(),
			loanId: input.loanId,
			happenedOn: startsOn,
			kind: 'refix',
			amountMinor: payment,
			note: `${rate.toFixed(2)}%${persistedEndDate ? ` to ${persistedEndDate}` : ''}`
		});
		return { ok: true };
	});
}

/** Insert the agreement, every secured-property link, and its first terms. */
/**
 * Validate a set of secured-property links: no repeats, and shares that are
 * either all given and summing to at most the whole, or all blank.
 *
 * Shared by create and edit rather than restated: the two drifting apart would
 * mean a loan that could be created but not saved again, or the reverse.
 */
function validateSecured(
	secured: SecuredPropertyInput[]
): LoanMutationResult | { explicitShares: number } {
	const propertyIds = secured.map((link) => link.propertyId);
	if (new Set(propertyIds).size !== propertyIds.length) {
		return { ok: false, status: 400, message: 'A property can secure this loan only once.' };
	}
	// Validate with the same grammar the property page reads back, and sum the
	// shares as exact rationals. `Number` accepted forms the reader rejects and
	// spent float precision on money-adjacent input.
	let explicitShareTotal: Ratio = { numerator: 0n, denominator: 1n };
	let explicitShares = 0;
	for (const link of secured) {
		if (link.sharePct === null) continue;
		explicitShares++;
		const share = tryRatioFromPercent(link.sharePct);
		if (!share) {
			return { ok: false, status: 400, message: 'Secured-property shares must be percentages.' };
		}
		explicitShareTotal = addRatios(explicitShareTotal, share);
	}
	if (explicitShareTotal.numerator > explicitShareTotal.denominator) {
		return { ok: false, status: 400, message: 'Secured-property shares cannot exceed 100%.' };
	}
	if (explicitShares > 0 && explicitShares < secured.length) {
		return {
			ok: false,
			status: 400,
			message: 'Enter a share for every secured property, or leave every share blank.'
		};
	}
	return { explicitShares };
}

export interface UpdateLoanInput {
	name: string;
	lender: string;
	kind: string;
	paymentDay: number | null;
	endsOn: string | null;
	secured: SecuredPropertyInput[];
	/** How the rate is set: a fixation period, a fixed term, or floating. */
	regime: string;
	/** Whether interest is charged on the payment date or over the calendar month. */
	accrualStyle: string;
	/** The convention interest is counted with — 30/360, act/365, act/360. */
	dayCount: string;
	/** Whether this loan's interest reduces taxable income. */
	interestDeductible: boolean;
}

/**
 * Edit what a loan IS, not what it costs.
 *
 * Name, lender, kind, payment day, end date and which properties secure it. A
 * loan could be created but never corrected, so a mortgage entered without its
 * second flat — the reported case, and the shape of a real household with one
 * mortgage over two properties — meant starting again.
 *
 * Rate REGIME, accrual style, day count and deductibility are here too, and the
 * distinction is worth stating because it is what keeps this safe. They describe
 * HOW the loan works — how its rate is set, how interest is counted — and
 * changing one re-derives the schedule from the periods already recorded. They
 * do not rewrite a period, and they cannot remove one.
 *
 * Deliberately still does NOT touch rate, payment, principal, balance or
 * currency. Those have their own operations (`replaceFixation`,
 * `recordRepayment`) that understand the history they rewrite. Above all this
 * never deletes a fixation period: that history is the loan's evidence, every
 * interest figure is derived from it, and nothing else the app stores could
 * reconstruct it. An edit is a correction to a description, not permission to
 * discard the record.
 */
export async function updateLoan(
	id: string,
	input: UpdateLoanInput,
	handle: Db = db
): Promise<LoanMutationResult> {
	const name = input.name.trim();
	if (!name) return { ok: false, status: 400, message: 'The loan needs a name.' };

	const endsOn = input.endsOn?.trim() || null;
	if (endsOn !== null && !isIsoDay(endsOn)) {
		return { ok: false, status: 400, message: 'Loan dates must be valid calendar dates.' };
	}

	const checked = validateSecured(input.secured);
	if ('ok' in checked) return checked;

	const paymentDay =
		Number.isInteger(input.paymentDay) && input.paymentDay! >= 1 && input.paymentDay! <= 31
			? input.paymentDay
			: null;

	return handle.transaction(async (tx) => {
		const [existing] = await tx.select().from(loan).where(eq(loan.id, id)).for('update');
		if (!existing) return { ok: false as const, status: 404, message: 'Loan not found.' };

		// The guard, enforced rather than trusted: an end date inside the recorded
		// history would leave fixation periods running past the end of the loan
		// they belong to. Refusing is right — the alternative is truncating the
		// history to fit the new date, which is the deletion this must never do.
		if (endsOn !== null) {
			const periods = await tx
				.select()
				.from(loanFixationPeriod)
				.where(eq(loanFixationPeriod.loanId, id));
			const latest = periods.reduce<string | null>(
				(newest, period) =>
					period.endsOn && (newest === null || period.endsOn > newest) ? period.endsOn : newest,
				null
			);
			if (latest !== null && endsOn < latest) {
				return {
					ok: false as const,
					status: 400,
					message: 'The loan cannot end before its recorded fixation periods do.'
				};
			}
		}

		if (input.secured.length > 1 && checked.explicitShares === 0) {
			const propertyIds = input.secured.map((link) => link.propertyId);
			const securedProperties = await tx
				.select({ id: property.id, valueMinor: property.valueMinor })
				.from(property)
				.where(inArray(property.id, propertyIds))
				.orderBy(property.id)
				.for('update');
			if (
				securedProperties.length !== propertyIds.length ||
				securedProperties.every((candidate) => candidate.valueMinor <= 0n)
			) {
				return {
					ok: false as const,
					status: 400,
					message: 'Enter secured-property shares until those properties have values.'
				};
			}
		}

		await tx
			.update(loan)
			.set({
				name,
				lender: input.lender.trim(),
				kind: asEnumValue('loan.kind', input.kind, existing.kind),
				paymentDay,
				endsOn,
				// How the loan works, as opposed to what it has done. Each of these
				// re-derives the schedule from the periods already recorded; none of
				// them rewrites or removes one. asEnumValue narrows at the boundary, so
				// a hand-crafted form post falls back to what is stored rather than
				// reaching the CHECK constraint.
				regime: asEnumValue('loan.regime', input.regime, existing.regime),
				accrualStyle: asEnumValue('loan.accrual_style', input.accrualStyle, existing.accrualStyle),
				dayCount: asEnumValue('loan.day_count', input.dayCount, existing.dayCount),
				interestDeductible: input.interestDeductible
			})
			.where(eq(loan.id, id));

		// Delete-then-insert over the links only. They carry no history of their
		// own — a share is a current fact about the loan, not a record of one —
		// which is what makes replacing them safe where replacing a fixation
		// period would not be.
		await tx.delete(loanProperty).where(eq(loanProperty.loanId, id));
		if (input.secured.length > 0) {
			await tx.insert(loanProperty).values(
				input.secured.map((link) => ({
					id: uuidv7(),
					loanId: id,
					propertyId: link.propertyId,
					sharePct: link.sharePct
				}))
			);
		}
		return { ok: true as const };
	});
}

export async function createLoan(
	input: CreateLoanInput,
	handle: Db = db
): Promise<LoanMutationResult> {
	const name = input.name.trim();
	if (!name) return { ok: false, status: 400, message: 'The loan needs a name.' };

	const currency = input.currency.trim().toUpperCase() || 'CZK';
	if (!/^[A-Z]{3}$/.test(currency)) {
		return { ok: false, status: 400, message: 'Use a three-letter currency code.' };
	}
	let principal: bigint;
	let owed: bigint;
	let payment: bigint;
	const rate = Number(input.rate.replace(',', '.'));
	try {
		principal = parseAmountToMinor(input.principal, currency);
		owed = parseAmountToMinor(input.owed, currency);
		payment = parseAmountToMinor(input.payment, currency);
		if (
			principal <= 0n ||
			owed < 0n ||
			owed > principal ||
			payment <= 0n ||
			!Number.isFinite(rate) ||
			rate < 0 ||
			rate > 100
		) {
			throw new Error('range');
		}
	} catch {
		return {
			ok: false,
			status: 400,
			message: 'Principal and payment must be positive; owed must be between zero and principal.'
		};
	}

	const regime = input.regime || 'fixed_period';
	// Checked against the one list, not a second copy of it: the form and the
	// CHECK constraint on loan.regime both come from `ENUMS`.
	if (!isEnumValue('loan.regime', regime)) {
		return { ok: false, status: 400, message: 'Choose a valid rate regime.' };
	}
	const observedOn = (input.today ?? today()).trim();
	const startsOn = input.startsOn?.trim() || null;
	const endsOn = input.endsOn?.trim() || null;
	const fixedUntil = input.fixedUntil?.trim() || null;
	if (
		!isIsoDay(observedOn) ||
		(startsOn !== null && !isIsoDay(startsOn)) ||
		(endsOn !== null && !isIsoDay(endsOn)) ||
		(fixedUntil !== null && !isIsoDay(fixedUntil))
	) {
		return { ok: false, status: 400, message: 'Loan dates must be valid calendar dates.' };
	}
	const scheduleStart = startsOn ?? observedOn;
	if (owed > 0n && startsOn && startsOn > observedOn) {
		return { ok: false, status: 400, message: 'A loan with a balance cannot start in the future.' };
	}
	if (owed > 0n && endsOn && endsOn < observedOn) {
		return { ok: false, status: 400, message: 'An ended loan cannot keep a current balance.' };
	}
	if (endsOn && endsOn <= scheduleStart) {
		return { ok: false, status: 400, message: 'The loan end must be after its start.' };
	}
	if (regime === 'fixed_period' && !fixedUntil) {
		return {
			ok: false,
			status: 400,
			message: 'A fixed-period loan needs the date the fixation ends.'
		};
	}
	if (fixedUntil && fixedUntil <= scheduleStart) {
		return { ok: false, status: 400, message: 'The fixation end must be after its start.' };
	}
	if (fixedUntil && endsOn && fixedUntil > endsOn) {
		return { ok: false, status: 400, message: 'The fixation cannot outlast the loan.' };
	}
	const propertyIds = input.secured.map((link) => link.propertyId);
	const checked = validateSecured(input.secured);
	if ('ok' in checked) return checked;
	const explicitShares = checked.explicitShares;

	const dayCount = asEnumValue('loan.day_count', input.dayCount, '30/360');
	const accrualStyle = asEnumValue('loan.accrual_style', input.accrualStyle, 'payment');
	const paymentDay =
		Number.isInteger(input.paymentDay) && input.paymentDay! >= 1 && input.paymentDay! <= 31
			? input.paymentDay
			: null;
	const loanId = uuidv7();

	return handle.transaction(async (tx) => {
		if (input.secured.length > 1 && explicitShares === 0) {
			const securedProperties = await tx
				.select({ id: property.id, valueMinor: property.valueMinor })
				.from(property)
				.where(inArray(property.id, propertyIds))
				.orderBy(property.id)
				.for('update');
			if (
				securedProperties.length !== propertyIds.length ||
				securedProperties.every((candidate) => candidate.valueMinor <= 0n)
			) {
				return {
					ok: false as const,
					status: 400,
					message: 'Enter secured-property shares until those properties have values.'
				};
			}
		}
		await tx.insert(loan).values({
			id: loanId,
			name,
			lender: input.lender.trim(),
			kind: asEnumValue('loan.kind', input.kind, 'mortgage'),
			currency,
			principalMinor: principal,
			owedMinor: owed,
			owedOn: observedOn,
			startsOn,
			endsOn,
			regime,
			dayCount,
			accrualStyle,
			paymentDay,
			interestDeductible: input.interestDeductible
		});
		if (input.secured.length > 0) {
			await tx.insert(loanProperty).values(
				input.secured.map((link) => ({
					id: uuidv7(),
					loanId,
					propertyId: link.propertyId,
					sharePct: link.sharePct
				}))
			);
		}
		await tx.insert(loanFixationPeriod).values({
			id: uuidv7(),
			loanId,
			startsOn: startsOn ?? observedOn,
			endsOn: regime === 'fixed_period' ? fixedUntil : null,
			annualRatePct: String(rate),
			paymentMinor: payment
		});
		return { ok: true };
	});
}
