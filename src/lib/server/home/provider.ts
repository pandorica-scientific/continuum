// SPDX-License-Identifier: AGPL-3.0-or-later
// The smart-home capability seam. Screens talk ONLY to this interface; which
// platform sits behind it is configuration. Adding support for another
// platform (or expanding what a platform can do) means writing a new provider
// or extending this contract — never editing screens.

export interface HomeMetric {
	key: string; // power | energyMonth | water | temperature | air | …
	label: string;
	value: string;
	unit?: string;
	note?: string;
}

export interface HomeDevice {
	id: string;
	emoji: string;
	name: string;
	on: boolean;
	/** state line, e.g. "Warm, 40%" / "Off" */
	state: string;
	/** whether setDevice can act on it (climate is often read-only here) */
	controllable: boolean;
}

export interface HomeRoom {
	name: string;
	climate: string | null; // "23.1 °C · 44%"
	devices: HomeDevice[];
}

export interface AttentionItem {
	emoji: string;
	text: string;
	hue: 'yellow' | 'red';
}

export interface DayEnergy {
	day: string; // ISO date
	kwh: number;
}

export interface HomeSnapshot {
	metrics: HomeMetric[];
	rooms: HomeRoom[];
	attention: AttentionItem[];
	/** month-to-date energy, for the budget line */
	monthKwh: number | null;
}

export interface HomeProvider {
	id: string;
	label: string;
	/** cheap connectivity check with a human-readable outcome */
	probe(): Promise<{ ok: boolean; detail: string }>;
	snapshot(): Promise<HomeSnapshot>;
	setDevice(deviceId: string, on: boolean): Promise<void>;
	energyHistory(days: number): Promise<DayEnergy[]>;
}

/**
 * What a provider needs to be configured — the connect form renders itself
 * from this description, so a new platform never edits the Home screen.
 */
export interface ProviderField {
	key: string;
	label: string;
	placeholder?: string;
	required?: boolean;
	/** render and store as a secret (password input) */
	secret?: boolean;
	/** validation: plain text, an http(s) url, or a money amount */
	kind?: 'text' | 'url' | 'amount';
}

/**
 * Provider registry. A new platform registers a factory here; everything else
 * — settings UI, the Home screen, the bills wiring — picks it up by key.
 */
type ProviderFactory = (config: Record<string, string>) => HomeProvider;

interface RegistryEntry {
	label: string;
	make: ProviderFactory;
	fields: ProviderField[];
	/** one line of help under the form, e.g. where to find entity ids */
	hint: string;
}

const registry = new Map<string, RegistryEntry>();

export function registerHomeProvider(
	id: string,
	label: string,
	make: ProviderFactory,
	fields: ProviderField[] = [],
	hint = ''
): void {
	registry.set(id, { label, make, fields, hint });
}

export interface ProviderKind {
	id: string;
	label: string;
	fields: ProviderField[];
	hint: string;
}

export function homeProviderKinds(): ProviderKind[] {
	return [...registry.entries()].map(([id, entry]) => ({
		id,
		label: entry.label,
		fields: entry.fields,
		hint: entry.hint
	}));
}

export function makeHomeProvider(
	kind: string,
	config: Record<string, string>
): HomeProvider | null {
	const entry = registry.get(kind);
	return entry ? entry.make(config) : null;
}
