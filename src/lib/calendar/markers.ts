// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// What a calendar event looks like once it leaves Continuum.
//
// In Google or iCloud a ledger event sits in the same grid as "dentist, 3pm",
// and a subscribed calendar offers no way to style by source. An emoji in the
// summary is the one signal that survives every client, down to a notification
// banner on a watch.
//
// Pure and client-safe. Decoration is composed at the EDGE — when rendering to
// ICS, Google or CalDAV — and never stored: baking it into a title would make it
// permanent, and would corrupt the content hash the sync merge depends on.

import { EVENT_CATEGORIES, MODULES, type ModuleKey } from '$lib/modules/registry';
import type { OriginBinding } from '$lib/calendar/keys';

/** Appended to events the ledger generated. Never to authored ones. */
export const SOURCE_TAG = ' · Continuum';

/**
 * Which module owns a bound row.
 *
 * A fixation period belongs to Loans even though it lives in its own table —
 * what the marker answers is "which part of the app produced this", not "which
 * table is it in".
 */
const MODULE_FOR_TABLE: Record<OriginBinding['table'], ModuleKey> = {
	loan: 'loans',
	loanFixationPeriod: 'loans',
	tenancy: 'property',
	document: 'documents'
};

/** Rules with no row behind them still belong to a module. */
const MODULE_FOR_RULE: Record<string, ModuleKey> = {
	importReminder: 'import',
	investmentReport: 'investments',
	loanPayments: 'loans',
	propertyDates: 'property',
	expiry: 'documents'
};

/**
 * The emoji a generated event carries.
 *
 * Taken from the BINDING first, and only from the rule when there is no binding.
 * That ordering is the whole point: `expiry` covers leases, fixations, passports
 * and policies, so a rule-keyed marker would give every one of them the same
 * blurred icon, while the binding knows a passport is a document and a fixation
 * is a loan.
 */
export function markerForGenerated(ruleKey: string, binding: OriginBinding | null): string | null {
	const moduleKey = binding ? MODULE_FOR_TABLE[binding.table] : MODULE_FOR_RULE[ruleKey];
	return moduleKey ? MODULES[moduleKey].emoji : null;
}

/** The emoji an authored event carries, from its chosen category. */
export function markerForCategory(category: string | null): string | null {
	if (!category) return null;
	return category in EVENT_CATEGORIES
		? EVENT_CATEGORIES[category as keyof typeof EVENT_CATEGORIES].emoji
		: null;
}

/** `{emoji} {label}{ · Continuum}` — whichever parts apply. */
export function decorate(label: string, marker: string | null, sourceTag: boolean): string {
	const head = marker ? `${marker} ` : '';
	return `${head}${label}${sourceTag ? SOURCE_TAG : ''}`;
}

/**
 * Undo `decorate`, so a title can be hashed as the author wrote it.
 *
 * Takes the marker to remove rather than matching any leading emoji. Blanket
 * stripping would be wrong in a way that loses data silently: an author renaming
 * "🎂 Birthday" to "🎈 Birthday" would hash identically, the merge would see no
 * change, and the edit would never leave this machine.
 */
export function strip(summary: string, marker: string | null): string {
	let out = summary;
	if (out.endsWith(SOURCE_TAG)) out = out.slice(0, -SOURCE_TAG.length);
	if (marker && out.startsWith(`${marker} `)) out = out.slice(marker.length + 1);
	return out.trim();
}
