// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// How money crosses the wire: an integer of minor units and a currency code.
//
// Never a float — that would lose the precision the whole ledger is built to
// protect — and never a pre-formatted string, which would force consumers to
// parse language-specific separators back out.
//
// There is deliberately no generic deep-converter. Each endpoint calls money()
// at the field it applies to, so a bigint nobody thought about becomes a
// JSON.stringify error during development rather than being silently coerced.

export interface Money {
	amountMinor: number;
	currency: string;
}

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function money(amountMinor: bigint, currency: string): Money {
	// bigint does not survive JSON.stringify, so it has to become a Number. At
	// household scale this range cannot be exceeded; the guard exists so that if
	// it ever is, it fails loudly instead of quietly reporting a wrong figure.
	if (amountMinor > SAFE || amountMinor < -SAFE)
		throw new Error(`Amount ${amountMinor} is outside the safe integer range for JSON`);
	return { amountMinor: Number(amountMinor), currency };
}
