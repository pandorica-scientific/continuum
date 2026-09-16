// SPDX-License-Identifier: AGPL-3.0-or-later
// The price seam, shaped like the broker seam in `$lib/server/invest/adapter`:
// a provider turns a ticker into one close, and the refresh never knows which
// feed answered. Adding a feed is one file that registers itself here.

export interface Quote {
	/** ISO date of the close. */
	day: string;
	closeMinor: bigint;
	/** The market's currency; empty when the feed does not say. */
	currency: string;
}

export type PriceProviderId = 'yahoo' | 'stooq';

export interface PriceProvider {
	id: PriceProviderId;
	fetchClose(ticker: string, fetchFn: typeof fetch): Promise<Quote | null>;
}

const registry: PriceProvider[] = [];

export function registerPriceProvider(provider: PriceProvider): void {
	if (!registry.some((p) => p.id === provider.id)) registry.push(provider);
}

export function priceProviders(): PriceProvider[] {
	return [...registry];
}

/**
 * Broker suffix → provider suffix. Format facts, not tunables: what Yahoo and
 * Stooq call the Prague exchange is theirs to decide.
 */
const YAHOO_SUFFIX: Record<string, string> = {
	US: '',
	DE: '.DE',
	UK: '.L',
	CZ: '.PR',
	FR: '.PA',
	NL: '.AS',
	PL: '.WA',
	ES: '.MC',
	IT: '.MI',
	CH: '.SW',
	AT: '.VI',
	BE: '.BR',
	PT: '.LS',
	SE: '.ST',
	DK: '.CO',
	FI: '.HE',
	NO: '.OL',
	CA: '.TO',
	JP: '.T',
	HK: '.HK'
};
const STOOQ_SUFFIX: Record<string, string> = {
	US: '.us',
	DE: '.de',
	UK: '.uk',
	PL: '.pl',
	HU: '.hu',
	JP: '.jp',
	HK: '.hk'
};

/** The symbol a provider wants for a broker-form ticker, or null when it cannot price that market. */
export function providerSymbol(ticker: string, provider: PriceProviderId): string | null {
	const at = ticker.lastIndexOf('.');
	if (at <= 0) return null;
	const base = ticker.slice(0, at);
	const market = ticker.slice(at + 1).toUpperCase();
	if (provider === 'yahoo') {
		const suffix = YAHOO_SUFFIX[market];
		return suffix === undefined ? null : `${base}${suffix}`;
	}
	const suffix = STOOQ_SUFFIX[market];
	return suffix === undefined ? null : `${base.toLowerCase()}${suffix}`;
}
