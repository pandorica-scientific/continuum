// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { uuidv7 } from 'uuidv7';
import { asEnumValue, isEnumValue } from '$lib/enums';
import { and, asc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';

import { parseAmountToMinor } from '$lib/money';
import { addRatios, tryRatioFromPercent, type Ratio } from '$lib/property/finance';
import { db, type Db } from '$lib/server/db';
import { loan, loanEvent, loanFixationPeriod, loanProperty, property } from '$lib/server/db/schema';

type LoanMutationResult = { ok: true } | { ok: false; status: number; message: string };

interface RepaymentInput {
	loanId: string;
	date: string;
	amount: string;
	balanceAfter: string;
	note: string;
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
}

/**
 * Edit what a loan IS, not what it costs.
 *
 * Name, lender, kind, payment day, end date and which properties secure it. A
 * loan could be created but never corrected, so a mortgage entered without its
 * second flat — the reported case, and the shape of a real household with one
 * mortgage over two properties — meant starting again.
 *
 * Deliberately does NOT touch rate, payment, principal, balance or currency.
 * Those have their own operations (`replaceFixation`, `recordRepayment`) that
 * understand the history they rewrite. Above all it never deletes a fixation
 * period: that history is the loan's evidence, every interest figure is derived
 * from it, and nothing else the app stores could reconstruct it. An edit is a
 * correction to a description, not permission to discard the record.
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
				endsOn
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
