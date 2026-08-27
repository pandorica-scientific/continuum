// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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

/**
 * Minor units as an exact decimal string in major units, for a form field.
 *
 * Not `toMajor`: that goes through Number and loses precision by construction,
 * which is acceptable for a chart and not acceptable for a value someone is
 * about to edit and save back. Plain digits and a dot, with no grouping, so
 * `parseAmountToMinor` round-trips it whatever the locale.
 */
export function toMajorString(amountMinor: bigint, currency: string): string {
	const digits = minorDigits(currency);
	const negative = amountMinor < 0n;
	const magnitude = negative ? -amountMinor : amountMinor;
	if (digits === 0) return `${negative ? '-' : ''}${magnitude}`;
	const scale = 10n ** BigInt(digits);
	const whole = magnitude / scale;
	const fraction = (magnitude % scale).toString().padStart(digits, '0');
	return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function fromMajor(major: number, currency: string): bigint {
	return BigInt(Math.round(major * 10 ** minorDigits(currency)));
}

interface FormatOptions {
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

/**
 * A figure short enough to scan down a column: `4.37M`, `41k`, `368`.
 *
 * No currency symbol — the column header carries it, and repeating it on every
 * cell is noise in a grid whose whole purpose is comparing one number to the
 * one below it.
 *
 * The thousand and million thresholds are decimal facts, not policy, and the
 * exponent still comes from the currency: a zero-decimal currency's minor unit
 * IS its major unit, so 4 370 000 minor JPY abbreviates to 4.37M like anything
 * else of that size.
 */
export function compactMinor(amountMinor: bigint, currency: string, decimals?: number): string {
	const major = toMajor(amountMinor, currency);
	const magnitude = Math.abs(major);
	const sign = major < 0 ? '-' : '';
	if (magnitude >= 1_000_000) return `${sign}${(magnitude / 1_000_000).toFixed(decimals ?? 2)}M`;
	if (magnitude >= 1_000) return `${sign}${(magnitude / 1_000).toFixed(decimals ?? 0)}k`;
	return `${sign}${magnitude.toFixed(decimals ?? 0)}`;
}

/** The steps an axis abbreviates by, largest first. */
const AXIS_STEPS = [
	{ divisor: 1_000_000, suffix: 'M' },
	{ divisor: 1_000, suffix: 'k' },
	{ divisor: 1, suffix: '' }
] as const;

/**
 * Labels for one axis's gridlines.
 *
 * Two rules, and neither is what mapping `compactMinor` over the values gives
 * you — which is what this used to do.
 *
 * ONE step across the whole axis, chosen from its largest value. Left to decide
 * for itself, every label crossed the thousand and million thresholds on its
 * own, so a single scale printed `0 · 653k · 1M · 2M · 3M`. Those are five even
 * steps of about 653 000, and nothing on screen says so: the reader has to
 * convert two units in their head before the axis is even linear.
 *
 * And a label may not move its own gridline nearer a neighbouring one than the
 * one it names — half the closest gap, below. Distinctness was the whole of the
 * old test, and at whole millions 1.96M and 2.61M are distinct: as "2M" and
 * "3M", each overstating its line by about a sixth. Distinctness cannot catch
 * that, because it asks whether two labels differ rather than whether either is
 * true. A gridline is a claim about where a value sits; sharing the step is
 * what makes the precision affordable, because one decimal now buys it on every
 * label at once.
 *
 * A cell may still round hard — `compactMinor` is untouched. It stands alone,
 * with no neighbour to be measured against and no scale to be linear on.
 */
export function compactAxis(values: bigint[], currency: string): string[] {
	const majors = values.map((v) => toMajor(v, currency));
	const largest = majors.reduce((most, major) => Math.max(most, Math.abs(major)), 0);
	const step = AXIS_STEPS.find(({ divisor }) => largest >= divisor) ?? AXIS_STEPS.at(-1)!;

	// Half the closest two gridlines ever come. An axis of one distinct value
	// has no gap to be measured against, so nothing but an exact label will do.
	const ordered = [...new Set(majors)].sort((a, b) => a - b);
	const tolerance =
		ordered.length < 2
			? 0
			: ordered
					.slice(1)
					.reduce((closest, major, i) => Math.min(closest, major - ordered[i]), Infinity) / 2;

	// Zero is zero at every step. "0.0M" is not more precise than "0", only
	// longer, and it is the one label on the axis that cannot be rounded wrong.
	const label = (major: number, decimals: number) =>
		major === 0 ? '0' : `${(major / step.divisor).toFixed(decimals)}${step.suffix}`;
	/** How far this label moves the gridline it names. */
	const drift = (major: number, decimals: number) =>
		Math.abs(Number.parseFloat((major / step.divisor).toFixed(decimals)) * step.divisor - major);

	for (let decimals = 0; decimals <= 2; decimals++) {
		const labels = majors.map((major) => label(major, decimals));
		if (new Set(labels).size !== labels.length) continue;
		if (majors.every((major) => drift(major, decimals) <= tolerance)) return labels;
	}
	// Two gridlines on the same figure cannot be told apart at any precision.
	// That is the caller's business, not something to keep looping over.
	return majors.map((major) => label(major, 2));
}
