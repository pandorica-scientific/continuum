// Money is always integer minor units + a currency code. Formatting follows
// the design: space-grouped thousands, decimals only when they carry
// information, and every number set in the mono face by the caller.

const digitCache = new Map<string, number>();

/**
 * Minor units per currency, from the runtime's own CLDR data rather than a
 * hand-kept table. `availableCurrencies()` offers every code the CNB quotes —
 * which includes HUF, JPY, KRW and ISK, all of which CLDR gives no minor unit
 * at all — so a four-entry table with `?? 2` stored those amounts 100× too
 * large, and the same wrong factor reached the register's SQL amount filter and
 * the API's wire format. Well-formed codes the runtime does not recognise still
 * fall back to 2.
 *
 * CLDR, not ISO 4217: the two disagree (ISO gives HUF two digits, CLDR gives
 * zero) and CLDR follows how the currency is actually written, which is what a
 * ledger showing a person their own money should do.
 */
/**
 * Is this actually a currency?
 *
 * Three capital letters is a shape, not a fact. `SYN-0001` is an account
 * number, and the pattern that finds a currency beside a figure matched its
 * first three characters — so a workbook imported with a currency of "SYN",
 * past a guard that checked the shape and nothing else.
 *
 * The list comes from the platform's own locale data rather than a table
 * written here, so it neither goes stale nor has to be maintained: ICU knows
 * what the currencies are, and it is already what `minorDigits` asks how many
 * decimal places each one has.
 */
const KNOWN = new Set(
	typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : []
);

export function isCurrencyCode(value: string): boolean {
	const code = value.trim().toUpperCase();
	if (!/^[A-Z]{3}$/.test(code)) return false;
	// An older runtime without `supportedValuesOf` falls back to the shape test
	// rather than rejecting every currency there is.
	return KNOWN.size === 0 || KNOWN.has(code);
}

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

/**
 * Minor units as a plain number of major units, and back.
 *
 * Every conversion between the two goes through these. Scattering `/ 100` and
 * `* 100` across charts, screens and the API worked only while every currency
 * had exactly two minor units: the moment `minorDigits` started telling the
 * truth about HUF and JPY, one half of a round trip could be currency-aware
 * while the other stayed hardcoded, and the figure came out a hundred times
 * wrong with nothing to flag it.
 *
 * `toMajor` loses precision by construction — it exists for charts and
 * percentages, which need a number. Anything that has to stay exact should keep
 * the bigint and use `formatMinor`.
 */
export function toMajor(amountMinor: bigint | number, currency: string): number {
	return Number(amountMinor) / 10 ** minorDigits(currency);
}

export function fromMajor(major: number, currency: string): bigint {
	return BigInt(Math.round(major * 10 ** minorDigits(currency)));
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
