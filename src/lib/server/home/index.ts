// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The home module's front door: providers register themselves on import, and
// the configured one is built from settings. Screens import from here only.

import './homeassistant';
import './demo';

import { and, eq } from 'drizzle-orm';
import { db, type Db, type Queryable } from '$lib/server/db';
import { property, settings } from '$lib/server/db/schema';
import { convertOrFace, loadRateTable } from '$lib/server/fx/table';
import { updateMeterBillAmount } from '$lib/server/property/mutations';
import {
	homeProviderKinds,
	makeHomeProvider,
	type HomeProvider,
	type ProviderKind
} from './provider';

export * from './provider';
export { haMeterCandidates } from './homeassistant';

interface HomeConfig {
	kind: string;
	[key: string]: string;
}

export function configuredMeterProperty<T extends { id: string; kind: string }>(
	config: HomeConfig | null,
	properties: T[]
): T | null {
	if (!config?.meterPropertyId) return null;
	return (
		properties.find(
			(candidate) => candidate.id === config.meterPropertyId && candidate.kind === 'lived'
		) ?? null
	);
}

export async function getHomeConfig(handle: Queryable = db): Promise<HomeConfig | null> {
	const rows = await handle
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, 'home'));
	const stored = (rows[0]?.value ?? null) as HomeConfig | null;
	return stored && stored.kind ? stored : null;
}

function providerForConfig(config: HomeConfig): HomeProvider | null {
	const { kind, ...rest } = config;
	return makeHomeProvider(kind, rest);
}

function sameHomeConfig(left: HomeConfig, right: HomeConfig | null): boolean {
	if (!right) return false;
	const keys = Object.keys(left);
	return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

export async function configuredHomeProvider(handle: Queryable = db): Promise<HomeProvider | null> {
	const config = await getHomeConfig(handle);
	return config ? providerForConfig(config) : null;
}

export function availableHomeProviders(): ProviderKind[] {
	return homeProviderKinds();
}

/**
 * Write this month's meter reading onto the lived-in flat's energy bill, so the
 * budget follows what the meter actually did.
 *
 * This is a write, so it lives behind an explicit call and never inside a page
 * load. It used to run in the home page's GET `load`, and app.html asks
 * SvelteKit to preload on hover — so moving the pointer across the sidebar
 * mutated the database. It runs on the hourly tick and once when a platform is
 * connected; the home page only reads.
 *
 * Returns the bill note for the page, or null when there is nothing to write.
 */
export async function syncMeterBill(handle: Db = db): Promise<string | null> {
	const config = await getHomeConfig(handle);
	if (!config) return null;
	const price = Number(config.pricePerKwh);
	if (!Number.isFinite(price) || price <= 0) return null;
	const priceCurrency = config.pricePerKwhCurrency;
	const meterPropertyId = config.meterPropertyId;
	if (!priceCurrency || !meterPropertyId) return null;

	// Build from the same immutable snapshot used for price/property decisions.
	// Re-reading here could combine credentials from a new configuration with
	// the old configuration's billing target.
	const provider = providerForConfig(config);
	if (!provider) return null;

	const snapshot = await provider.snapshot();
	const monthKwh = snapshot.monthKwh;
	if (monthKwh === null) return null;

	return handle.transaction(async (tx) => {
		// Serialize this final check with configure/disconnect. If either committed
		// while the provider was doing network I/O, discard the stale reading. If
		// it starts now, the settings-row lock makes it wait until this write ends.
		const configRows = await tx
			.select({ value: settings.value })
			.from(settings)
			.where(eq(settings.key, 'home'))
			.for('update');
		const currentConfig = (configRows[0]?.value ?? null) as HomeConfig | null;
		if (!sameHomeConfig(config, currentConfig)) return null;

		const properties = await tx
			.select()
			.from(property)
			.where(and(eq(property.id, meterPropertyId), eq(property.kind, 'lived')));
		const livedIn = properties[0];
		if (!livedIn) return null;

		// The price is in minor units of the currency it was typed in; the bill is
		// denominated in the property's. Migration 0031 binds legacy prices to the
		// base currency in force at upgrade, so malformed unbound configs fail
		// closed above instead of being silently redenominated.
		const inPriceCurrency = BigInt(Math.round(monthKwh * price));
		const amountMinor = convertOrFace(
			await loadRateTable(tx),
			inPriceCurrency,
			priceCurrency,
			livedIn.currency,
			new Date().toISOString().slice(0, 10)
		);

		// Bound by the typed source column, and only ever to a bill the household
		// pointed at the meter. Creating one unasked duplicates energy spending.
		const updated = await updateMeterBillAmount(livedIn.id, amountMinor, tx);
		if (!updated) return null;
		return `“${updated.label}” on ${livedIn.name} is read from the meter, so the budget follows what it actually did.`;
	});
}
