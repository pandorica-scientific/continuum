// Money is always integer minor units + a currency code. Formatting follows
// the design: space-grouped thousands, decimals only when they carry
// information, and every number set in the mono face by the caller.

const digitCache = new Map<string, number>();

/**
 * Minor units per currency, from the runtime's own ISO 4217 data rather than a
 * hand-kept table. `availableCurrencies()` offers every code the CNB quotes —
 * which includes JPY, KRW, HUF and ISK, all of which have no minor unit at all
 * — so a four-entry table with `?? 2` stored those amounts 100× too large, and
 * the same wrong factor reached the register's SQL amount filter and the API's
 * wire format. Well-formed codes the runtime does not recognise still fall back
 * to 2, the ISO default.
 */
export function minorDigits(currency: string): number {
	const cached = digitCache.get(currency);
	if (cached !== undefined) return cached;
	let digits = 2;
	try {
		digits =
			new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
				.maximumFractionDigits ?? 2;
	} catch {
		// Not a currency code at all (empty or malformed) — keep the default.
	}
	digitCache.set(currency, digits);
	return digits;
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
	// A currency with no minor unit has no fraction to print, not even when
	// `exact` asks for one — "¥1 500.0" is not a yen amount.
	if (digits > 0 && (options.exact || fraction !== 0n)) {
		out += '.' + fraction.toString().padStart(digits, '0');
	}
	if (negative) out = '−' + out;
	else if (options.signed) out = '+' + out;
	return out;
}

/**
 * Parse a decimal string like "1 234,56" or "-53.91" into minor units.
 *
 * Accepts U+2212 as a minus sign, because `formatMinor` emits one: without it
 * a formatted amount could not be parsed back, so any round trip through a
 * pre-filled input threw. Excess decimals round rather than truncate \u2014 "12.999"
 * is 13.00, not 12.99.
 */
export function parseAmountToMinor(raw: string, currency: string): bigint {
	const digits = minorDigits(currency);
	const cleaned = raw
		.replace(/[\s\u00a0\u202f]/gu, '')
		.replace(/\u2212/g, '-')
		.replace(',', '.')
		.trim();
	const match = cleaned.match(/^([+-]?)(\d+)(?:\.(\d*))?$/);
	if (!match) throw new Error(`Unparseable amount: "${raw}"`);
	const [, sign, whole, fractionRaw = ''] = match;
	// One digit past the stored precision decides the rounding.
	const padded = (fractionRaw + '0'.repeat(digits + 1)).slice(0, digits + 1);
	const kept = padded.slice(0, digits);
	let minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt(kept || '0');
	if (Number(padded[digits]) >= 5) minor += 1n;
	return sign === '-' ? -minor : minor;
}
