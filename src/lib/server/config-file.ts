// Settings export/import as ledger.config.json — configuration only, never
// data or secrets. The whitelist is the contract: an imported file can touch
// exactly these keys and nothing else.

import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { setSetting } from '$lib/server/settings';

export const EXPORTABLE_KEYS = [
	'householdName',
	'baseCurrency',
	'modules',
	'retirement',
	'backup',
	'payslipLabels'
] as const;

export interface ConfigFile {
	continuum: 1;
	exportedAt: string;
	settings: Record<string, unknown>;
}

export async function exportConfig(): Promise<ConfigFile> {
	const rows = await db.select().from(settings);
	const out: Record<string, unknown> = {};
	for (const key of EXPORTABLE_KEYS) {
		const row = rows.find((r) => r.key === key);
		if (row) out[key] = row.value;
	}
	return { continuum: 1, exportedAt: new Date().toISOString(), settings: out };
}

/** Apply a config file; returns the keys actually imported. */
export async function importConfig(raw: unknown): Promise<string[]> {
	if (typeof raw !== 'object' || raw === null) throw new Error('Not a config file.');
	const file = raw as Partial<ConfigFile>;
	if (file.continuum !== 1 || typeof file.settings !== 'object' || file.settings === null) {
		throw new Error('Not a Continuum config file.');
	}
	const applied: string[] = [];
	for (const key of EXPORTABLE_KEYS) {
		if (key in file.settings) {
			await setSetting(key, (file.settings as Record<string, unknown>)[key]);
			applied.push(key);
		}
	}
	return applied;
}
