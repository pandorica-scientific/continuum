// SPDX-License-Identifier: AGPL-3.0-or-later
import { db, type Queryable } from '$lib/server/db';
import { getSetting, setSetting } from '$lib/server/settings';

export interface PriceSettings {
	/** Hours between quote refreshes. */
	refreshEveryHours: number;
	/** A latest close older than this many days is shown as needing a hand-typed one. */
	staleAfterDays: number;
}

const PRICE_SETTINGS_KEY = 'prices';
export const DEFAULT_PRICE_SETTINGS: PriceSettings = { refreshEveryHours: 24, staleAfterDays: 7 };

export async function getPriceSettings(handle: Queryable = db): Promise<PriceSettings> {
	const stored = await getSetting<Partial<PriceSettings>>(PRICE_SETTINGS_KEY, {}, handle);
	return { ...DEFAULT_PRICE_SETTINGS, ...stored };
}

/**
 * A broker ticker's real symbol, where a feed does not call the same
 * security what the broker does. Tesla on Xetra is "TL0", not "TSLA" — the
 * exchange suffix is right, only the base differs, so this replaces just the
 * base and the existing suffix table still decides the rest.
 *
 * Keyed by the household's own settings, not a static table: which broker
 * ticker needs which override is a fact about accounts nobody here has, and
 * a household hits it once and fixes it once.
 */
const PRICE_ALIASES_KEY = 'priceTickerAliases';

export async function getPriceAliases(handle: Queryable = db): Promise<Record<string, string>> {
	return getSetting<Record<string, string>>(PRICE_ALIASES_KEY, {}, handle);
}

export async function setPriceAlias(
	ticker: string,
	overrideBase: string,
	handle: Queryable = db
): Promise<void> {
	const aliases = await getPriceAliases(handle);
	await setSetting(PRICE_ALIASES_KEY, { ...aliases, [ticker]: overrideBase }, handle);
}

/** The symbol a feed is asked for: the alias's base with the ticker's own suffix, or the ticker as-is. */
export function withAlias(ticker: string, aliases: Record<string, string>): string {
	const override = aliases[ticker];
	if (!override) return ticker;
	const at = ticker.lastIndexOf('.');
	return at > 0 ? `${override}${ticker.slice(at)}` : override;
}
