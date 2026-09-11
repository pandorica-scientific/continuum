// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reading a bottle out of a posted form.
 *
 * Shared by the add and the edit action, which post the same fields. Two copies
 * of this is two chances for one of them to start treating a blank price
 * differently from the other — and the edit is the dangerous one, because a
 * field it forgets to read is a field it silently clears.
 */
import { ENUMS, type EnumValue } from '$lib/enums';
import { isCurrencyCode, parseAmountToMinor } from '$lib/money';

/** A number field that may be blank. Blank is null, not zero. */
export function optionalInt(raw: FormDataEntryValue | null): number | null {
	const text = String(raw ?? '').trim();
	const value = Number(text);
	return text === '' || !Number.isFinite(value) ? null : Math.round(value);
}

export interface BottleFields {
	type: EnumValue<'bottle.type'>;
	producer: string;
	name: string;
	vintage: number | null;
	ageYears: number | null;
	country: string | null;
	region: string;
	grapeOrCask: string;
	abv: string | null;
	sizeMl: number | null;
	drinkFrom: number | null;
	drinkTo: number | null;
	owned: number;
	boughtOn: string | null;
	boughtWhere: string;
	boughtMinor: bigint | null;
	boughtCurrency: string | null;
}

/**
 * Everything about a bottle except which shelf it stands on and how many are
 * open — the first is context, the second belongs to the ownership controls.
 *
 * Returns a message instead of the fields when something required is missing,
 * so the caller has one thing to check.
 */
export function bottleFrom(
	form: FormData,
	fallbackOwned: number
): { fields: BottleFields } | { message: string } {
	const name = String(form.get('name') ?? '').trim();
	const type = String(form.get('type') ?? '') as EnumValue<'bottle.type'>;

	if (!name) return { message: 'A bottle needs a name.' };
	if (!ENUMS['bottle.type'].includes(type)) {
		return { message: 'Pick what kind of bottle it is.' };
	}

	const abv = String(form.get('abv') ?? '').trim();
	const country = String(form.get('country') ?? '')
		.trim()
		.toUpperCase();

	// The currency comes back through the form so a bottle bought abroad keeps
	// what it was paid for in. An unrecognised code is dropped along with the
	// price rather than stored: a number with no currency is not an amount.
	const currency = String(form.get('boughtCurrency') ?? '')
		.trim()
		.toUpperCase();
	const price = String(form.get('price') ?? '').trim();

	let boughtMinor: bigint | null = null;
	let boughtCurrency: string | null = null;
	if (price !== '' && isCurrencyCode(currency)) {
		try {
			boughtMinor = parseAmountToMinor(price, currency);
			boughtCurrency = currency;
		} catch {
			// Not a number anybody meant. Left unset rather than guessed at.
			boughtMinor = null;
		}
	}

	return {
		fields: {
			type,
			producer: String(form.get('producer') ?? '').trim(),
			name,
			vintage: optionalInt(form.get('vintage')),
			ageYears: optionalInt(form.get('ageYears')),
			country: country.length === 2 ? country : null,
			region: String(form.get('region') ?? '').trim(),
			grapeOrCask: String(form.get('grapeOrCask') ?? '').trim(),
			abv: abv === '' || !Number.isFinite(Number(abv)) ? null : abv,
			sizeMl: optionalInt(form.get('sizeMl')),
			drinkFrom: optionalInt(form.get('drinkFrom')),
			drinkTo: optionalInt(form.get('drinkTo')),
			owned: Math.max(0, optionalInt(form.get('owned')) ?? fallbackOwned),
			boughtOn: String(form.get('boughtOn') ?? '').trim() || null,
			boughtWhere: String(form.get('boughtWhere') ?? '').trim(),
			boughtMinor,
			boughtCurrency
		}
	};
}
