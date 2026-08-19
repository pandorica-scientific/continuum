// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
export interface Ratio {
	numerator: bigint;
	denominator: bigint;
}

export type MinorConverter = (amountMinor: bigint, from: string, to: string, day: string) => bigint;

function gcd(a: bigint, b: bigint): bigint {
	a = a < 0n ? -a : a;
	b = b < 0n ? -b : b;
	while (b !== 0n) [a, b] = [b, a % b];
	return a || 1n;
}

function reduced(numerator: bigint, denominator: bigint): Ratio {
	if (denominator <= 0n) return { numerator: 1n, denominator: 1n };
	const divisor = gcd(numerator, denominator);
	return { numerator: numerator / divisor, denominator: denominator / divisor };
}

/** Exact rational addition, reduced so repeated accumulation stays small. */
export function addRatios(a: Ratio, b: Ratio): Ratio {
	return reduced(
		a.numerator * b.denominator + b.numerator * a.denominator,
		a.denominator * b.denominator
	);
}

export function ratioFromValues(currentMinor: bigint, allMinor: bigint[]): Ratio {
	const total = allMinor.reduce((sum, value) => sum + value, 0n);
	if (total > 0n && currentMinor >= 0n) return reduced(currentMinor, total);
	// A single link still owns the whole facility even before the property is
	// valued. Several zero-value links have no defensible proportional split;
	// leave legacy data unallocated instead of counting 100% on every property.
	return allMinor.length === 1
		? { numerator: 1n, denominator: 1n }
		: { numerator: 0n, denominator: 1n };
}

// loan_property.share_pct is numeric(6,3), so a fourth decimal would be stored
// rounded and then read back as a different ratio than the one validation
// accepted. Reject it instead of silently redenominating a secured share.
const PERCENT_DECIMALS = 3;

/**
 * The one percentage grammar shared by write validation and reading, so a
 * stored share can never parse differently from the share that was accepted.
 * Returns null rather than throwing, for callers that must answer 400 instead
 * of failing a page load.
 */
export function tryRatioFromPercent(raw: string): Ratio | null {
	const value = raw.trim().replace(',', '.');
	const match = value.match(/^(\d+)(?:\.(\d+))?$/);
	if (!match) return null;
	const fraction = match[2] ?? '';
	if (fraction.length > PERCENT_DECIMALS) return null;
	const scale = 10n ** BigInt(fraction.length);
	const percentScaled = BigInt(match[1]) * scale + BigInt(fraction || '0');
	if (percentScaled <= 0n || percentScaled > 100n * scale) return null;
	return reduced(percentScaled, 100n * scale);
}

export function ratioFromPercent(raw: string): Ratio {
	const parsed = tryRatioFromPercent(raw);
	if (!parsed) throw new Error('Invalid percentage');
	return parsed;
}

function multiplyRatio(amountMinor: bigint, ratio: Ratio): bigint {
	if (ratio.denominator <= 0n) throw new Error('Ratio denominator must be positive');
	const scaled = amountMinor * ratio.numerator;
	const quotient = scaled / ratio.denominator;
	const remainder = scaled % ratio.denominator;
	if ((remainder < 0n ? -remainder : remainder) * 2n < ratio.denominator) return quotient;
	return quotient + (scaled < 0n ? -1n : 1n);
}

/**
 * Allocate `amountMinor` across `shares` and return the part at `index`.
 * Rounding each share on its own over- or under-allocates the whole: a 50/50
 * split of an odd amount rounds up on both sides and reports one minor unit
 * more debt than the loan carries. Each part is therefore the gap between two
 * rounded cumulative boundaries, so the parts always sum to the rounded whole
 * no matter how the shares divide it.
 */
export function allocateAtIndex(amountMinor: bigint, shares: Ratio[], index: number): bigint {
	const share = shares[index];
	if (!share) throw new Error('Share index out of range');
	let boundary: Ratio = { numerator: 0n, denominator: 1n };
	for (let position = 0; position < index; position++) {
		boundary = addRatios(boundary, shares[position]);
	}
	return (
		multiplyRatio(amountMinor, addRatios(boundary, share)) - multiplyRatio(amountMinor, boundary)
	);
}

interface SecuredPropertyShareInput {
	propertyId: string;
	sharePct: string | null;
	/** Property value already converted to the one currency shared by the set. */
	valueMinor: bigint;
}

function multiplyRatios(a: Ratio, b: Ratio): Ratio {
	return reduced(a.numerator * b.numerator, a.denominator * b.denominator);
}

/**
 * Shares for every property securing one loan, positionally aligned to
 * `links`. Explicit links use their stored percentage; automatic links divide
 * whatever the explicit ones leave. The caller supplies `links` in a stable
 * order, because allocation boundaries depend on it and must not follow
 * database row order.
 */
export function sharesForLoan(links: SecuredPropertyShareInput[]): Ratio[] {
	// An unreadable stored share is treated as automatic rather than thrown.
	// This runs inside a page load, so one hand-edited row must not take the
	// whole property screen down, and dividing by value is already what an
	// absent share means.
	const explicit = links.map((link) =>
		link.sharePct === null ? null : tryRatioFromPercent(link.sharePct)
	);
	const claimed = explicit.reduce<Ratio>((sum, share) => (share ? addRatios(sum, share) : sum), {
		numerator: 0n,
		denominator: 1n
	});
	// Automatic links divide the remainder, not the whole. Dividing by every
	// linked value would let a mixed set allocate more than the loan: an 80%
	// link beside an equally valued automatic one would hand the second 50%
	// instead of the remaining 20%, inventing 30% of a mortgage. createLoan
	// refuses mixed sets now, but rows written before it did still exist.
	const remaining =
		claimed.numerator >= claimed.denominator
			? { numerator: 0n, denominator: 1n }
			: reduced(claimed.denominator - claimed.numerator, claimed.denominator);
	const automaticValues = links
		.filter((_, index) => explicit[index] === null)
		.map((link) => link.valueMinor);
	return links.map(
		(link, index) =>
			explicit[index] ??
			multiplyRatios(remaining, ratioFromValues(link.valueMinor, automaticValues))
	);
}

interface PropertyFinancialInput {
	day: string;
	propertyValueMinor: bigint;
	propertyCurrency: string;
	loans: PropertyLoanFinancialInput[];
	rentMinor: bigint;
	billsMinor: bigint;
}

interface PropertyLoanFinancialInput {
	id: string;
	principalMinor: bigint;
	owedMinor: bigint;
	paymentMinor: bigint;
	currency: string;
	/** Every share securing this loan, in one stable order. */
	shares: Ratio[];
	/** Which of `shares` belongs to the property being reported. */
	shareIndex: number;
}

interface AllocatedPropertyLoan {
	id: string;
	principalPropertyMinor: bigint;
	owedPropertyMinor: bigint;
	paymentPropertyMinor: bigint;
}

export function propertyFinancials(
	input: PropertyFinancialInput,
	convert: MinorConverter
): {
	loans: AllocatedPropertyLoan[];
	owedPropertyMinor: bigint;
	paymentPropertyMinor: bigint;
	equityMinor: bigint;
	cashFlowMinor: bigint;
} {
	const allocate = (loan: PropertyLoanFinancialInput, amountMinor: bigint) =>
		allocateAtIndex(
			convert(amountMinor, loan.currency, input.propertyCurrency, input.day),
			loan.shares,
			loan.shareIndex
		);
	const loans = input.loans.map((loan) => ({
		id: loan.id,
		principalPropertyMinor: allocate(loan, loan.principalMinor),
		owedPropertyMinor: allocate(loan, loan.owedMinor),
		paymentPropertyMinor: allocate(loan, loan.paymentMinor)
	}));
	const owedPropertyMinor = loans.reduce((sum, loan) => sum + loan.owedPropertyMinor, 0n);
	const paymentPropertyMinor = loans.reduce((sum, loan) => sum + loan.paymentPropertyMinor, 0n);
	return {
		loans,
		owedPropertyMinor,
		paymentPropertyMinor,
		equityMinor: input.propertyValueMinor - owedPropertyMinor,
		cashFlowMinor: input.rentMinor - input.billsMinor - paymentPropertyMinor
	};
}
