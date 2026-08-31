// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings export/import as ledger.config.json — configuration only, never
// data or secrets. The whitelist is the contract: an imported file can touch
// exactly these keys and nothing else.

import { db, type Db, type Queryable, type Tx } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import {
	replaceRevisionedSetting,
	revisionedSettingPayload,
	setSetting
} from '$lib/server/settings';

// Keys stored with autosave ordering metadata rather than as a bare value.
// Export unwraps them and import has to re-wrap them; naming the set once is
// what keeps the two halves from drifting apart.
const REVISIONED_KEYS = new Set<string>(['retirement']);

export const EXPORTABLE_KEYS = [
	'householdName',
	'baseCurrency',
	'modules',
	'retirement',
	'backup',
	// Three keys where there was one. `payslipLabels` is still read for
	// migration but never written, so it is not exported: a config file naming
	// it would resurrect a net label under a name that now means nothing.
	'payslipGrossLabels',
	'payslipNetLabels',
	// Bonus labels were never exportable at all, which meant a config restore
	// silently dropped everything the bonus reader had learned.
	'payslipBonusLabels'
] as const;

interface ConfigFile {
	continuum: 1;
	exportedAt: string;
	settings: Record<string, unknown>;
}

export async function exportConfig(handle: Queryable = db): Promise<ConfigFile> {
	const rows = await handle.select().from(settings);
	const out: Record<string, unknown> = {};
	for (const key of EXPORTABLE_KEYS) {
		const row = rows.find((r) => r.key === key);
		if (row) {
			out[key] = REVISIONED_KEYS.has(key) ? revisionedSettingPayload(row.value) : row.value;
		}
	}
	return { continuum: 1, exportedAt: new Date().toISOString(), settings: out };
}

/** Apply a config file; returns the keys actually imported. */
export async function importConfig(raw: unknown, handle: Db | Tx = db): Promise<string[]> {
	if (typeof raw !== 'object' || raw === null) throw new Error('Not a config file.');
	const file = raw as Partial<ConfigFile>;
	if (file.continuum !== 1 || typeof file.settings !== 'object' || file.settings === null) {
		throw new Error('Not a Continuum config file.');
	}
	const applied: string[] = [];
	for (const key of EXPORTABLE_KEYS) {
		if (key in file.settings) {
			const value = (file.settings as Record<string, unknown>)[key];
			if (REVISIONED_KEYS.has(key)) await replaceRevisionedSetting(key, value, handle);
			else await setSetting(key, value, handle);
			applied.push(key);
		}
	}
	return applied;
}
