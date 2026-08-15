// The home module's front door: providers register themselves on import, and
// the configured one is built from settings. Screens import from here only.

import './homeassistant';
import './demo';

import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { property, propertyBill } from '$lib/server/db/schema';
import { getBaseCurrency, getSetting } from '$lib/server/settings';
import { convertOrFace } from '$lib/server/fx';
import {
	homeProviderKinds,
	makeHomeProvider,
	type HomeProvider,
	type ProviderKind
} from './provider';

export * from './provider';
export { haMeterCandidates } from './homeassistant';

export interface HomeConfig {
	kind: string;
	[key: string]: string;
}

export async function getHomeConfig(): Promise<HomeConfig | null> {
	const stored = await getSetting<HomeConfig | null>('home', null);
	return stored && stored.kind ? stored : null;
}

export async function configuredHomeProvider(): Promise<HomeProvider | null> {
	const config = await getHomeConfig();
	if (!config) return null;
	const { kind, ...rest } = config;
	// Configs saved before the currency was recorded beside each amount get
	// today's base currency, which is what they were typed in at the time.
	for (const key of Object.keys(rest)) {
		if (!key.endsWith('Currency') || rest[key]) continue;
		rest[key] = await getBaseCurrency();
	}
	if (rest.pricePerKwh && !rest.pricePerKwhCurrency) {
		rest.pricePerKwhCurrency = await getBaseCurrency();
	}
	return makeHomeProvider(kind, rest);
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
export async function syncMeterBill(): Promise<string | null> {
	const config = await getHomeConfig();
	if (!config) return null;
	const price = Number(config.pricePerKwh);
	if (!Number.isFinite(price) || price <= 0) return null;

	const provider = await configuredHomeProvider();
	if (!provider) return null;

	const properties = await db.select().from(property).where(eq(property.kind, 'lived'));
	const livedIn = properties[0];
	if (!livedIn) return null;

	const snapshot = await provider.snapshot();
	if (snapshot.monthKwh === null) return null;

	// The price is in minor units of the currency it was typed in; the bill is
	// denominated in the property's. Converting was not optional the moment
	// those two could differ.
	const priceCurrency = config.pricePerKwhCurrency ?? (await getBaseCurrency());
	const inPriceCurrency = BigInt(Math.round(snapshot.monthKwh * price));
	const amountMinor = await convertOrFace(inPriceCurrency, priceCurrency, livedIn.currency);

	// Bound by the typed source column, and only ever to a bill the household
	// pointed at the meter. Creating one unasked is what made the flat's total
	// count electricity twice — the estimate the household already had stayed
	// exactly where it was, beside the new line.
	const existing = await db
		.select()
		.from(propertyBill)
		.where(and(eq(propertyBill.propertyId, livedIn.id), eq(propertyBill.source, 'meter')));
	if (!existing[0]) return null;

	await db.update(propertyBill).set({ amountMinor }).where(eq(propertyBill.id, existing[0].id));
	return `“${existing[0].label}” on ${livedIn.name} is read from the meter, so the budget follows what it actually did.`;
}
