// Money is always integer minor units + a currency code. Formatting follows
// the design: space-grouped thousands, decimals only when they carry
// information, and every number set in the mono face by the caller.

const MINOR_DIGITS: Record<string, number> = { CZK: 2, EUR: 2, USD: 2, PLN: 2 };

export function minorDigits(currency: string): number {
	return MINOR_DIGITS[currency] ?? 2;
}

export function displayCurrency(code: string): string {
	return code === 'CZK' ? 'Kč' : code;
}

export interface FormatOptions {
	/** Always print the fraction digits, even when zero. */
	exact?: boolean;
	/** Prefix positive amounts with +. */
	signed?: boolean;
}

export function formatMinor(
	amountMinor: bigint,
	currency: string,
	options: FormatOptions = {}
): string {
	const digits = minorDigits(currency);
	const negative = amountMinor < 0n;
	const abs = negative ? -amountMinor : amountMinor;
	const divisor = 10n ** BigInt(digits);
	const whole = abs / divisor;
	const fraction = abs % divisor;

	const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); // narrow no-break space

	let out = wholeStr;
	if (options.exact || fraction !== 0n) {
		out += '.' + fraction.toString().padStart(digits, '0');
	}
	if (negative) out = '−' + out;
	else if (options.signed) out = '+' + out;
	return out;
}

/** Parse a decimal string like "1 234,56" or "-53.91" into minor units. */
export function parseAmountToMinor(raw: string, currency: string): bigint {
	const digits = minorDigits(currency);
	const cleaned = raw
		.replace(/[\s\u00a0\u202f]/gu, '')
		.replace(',', '.')
		.trim();
	const match = cleaned.match(/^([+-]?)(\d+)(?:\.(\d*))?$/);
	if (!match) throw new Error(`Unparseable amount: "${raw}"`);
	const [, sign, whole, fractionRaw = ''] = match;
	const fraction = (fractionRaw + '0'.repeat(digits)).slice(0, digits);
	const minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction || '0');
	return sign === '-' ? -minor : minor;
}
