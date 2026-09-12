// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reading a recipe out of a posted form.
 *
 * Shared by the create and the edit action, which post the same fields. Two
 * copies of this is two chances for one of them to start treating a blank
 * quantity differently from the other.
 */

/**
 * The ingredients and the steps, as parallel arrays of repeated fields.
 *
 * Rows are positional and blank ones are dropped, so deleting a line in the
 * browser is deleting a row rather than sending a tombstone.
 */
export function linesFrom(form: FormData): {
	ingredients: [string | null, string, string][];
	steps: string[];
} {
	const quantities = form.getAll('quantity').map(String);
	const units = form.getAll('unit').map(String);
	const names = form.getAll('ingredient').map(String);

	const ingredients = names
		.map((name, index): [string | null, string, string] => {
			const quantity = quantities[index]?.trim() ?? '';
			return [
				// Empty is NULL, not zero: "a splash" is a quantity a recipe is
				// allowed to have, and the scaler leaves those alone.
				quantity === '' || Number.isNaN(Number(quantity)) ? null : quantity,
				units[index]?.trim() ?? '',
				name.trim()
			];
		})
		.filter(([, , name]) => name !== '');

	const steps = form
		.getAll('step')
		.map(String)
		.map((body) => body.trim())
		.filter(Boolean);

	return { ingredients, steps };
}

/**
 * Tag names, from one comma-separated field or several repeated ones.
 *
 * Both, because the dialog sends one field holding "weeknight, guests" and a
 * form posted without script may send the field more than once. Duplicates are
 * dropped case-insensitively, so "Guests, guests" is one tag.
 */
export function tagNamesFrom(form: FormData): string[] {
	const seen = new Set<string>();
	const names: string[] = [];
	for (const field of form.getAll('tag').map(String)) {
		for (const raw of field.split(',')) {
			const name = raw.trim();
			if (!name) continue;
			const key = name.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			names.push(name);
		}
	}
	return names;
}
