// SPDX-License-Identifier: AGPL-3.0-or-later
// The areas an API token can be limited to, as Settings offers them.

import { ENUMS, isEnumValue, type EnumValue } from '$lib/enums';
import { MODULES } from '$lib/modules/registry';

type ApiArea = EnumValue<'api_token.area'>;

/**
 * Worded the way the module toggles word them, so "Trips" in the token form is
 * the same Trips as in the module list above it. The ledger is no module — it
 * is the part of the app that is always on — so it names itself.
 */
export const API_AREA_OPTIONS: { key: ApiArea; emoji: string; label: string }[] = ENUMS[
	'api_token.area'
].map((key) =>
	key === 'ledger'
		? { key, emoji: '💰', label: 'Accounts & transactions' }
		: { key, emoji: MODULES[key].emoji, label: MODULES[key].label }
);

/**
 * The areas a token form asked for: null for everything, otherwise the ticked
 * ones. "Only these" with nothing ticked is an empty list — a token that reaches
 * nothing — and never quietly everything.
 *
 * Undefined when the form says neither: a mangled or outdated form must not be
 * read as "everything", so the caller refuses it.
 */
export function areasFromForm(form: FormData): ApiArea[] | null | undefined {
	const reach = form.get('reach');
	if (reach === 'everything') return null;
	if (reach !== 'areas') return undefined;
	return form
		.getAll('area')
		.filter((value): value is ApiArea => isEnumValue('api_token.area', value));
}

/** "everything", or the areas' own labels. */
export function describeReach(areas: readonly ApiArea[] | null): string {
	if (areas === null) return 'everything';
	if (areas.length === 0) return 'nothing';
	return API_AREA_OPTIONS.filter((option) => areas.includes(option.key))
		.map((option) => option.label)
		.join(', ');
}
