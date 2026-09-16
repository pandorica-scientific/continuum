// SPDX-License-Identifier: AGPL-3.0-or-later
import { db, type Queryable } from '$lib/server/db';
import { getSetting } from '$lib/server/settings';

export interface PriceSettings {
	/** Hours between quote refreshes. */
	refreshEveryHours: number;
	/** A latest close older than this many days is shown as needing a hand-typed one. */
	staleAfterDays: number;
}

export const PRICE_SETTINGS_KEY = 'prices';
export const DEFAULT_PRICE_SETTINGS: PriceSettings = { refreshEveryHours: 24, staleAfterDays: 7 };

export async function getPriceSettings(handle: Queryable = db): Promise<PriceSettings> {
	const stored = await getSetting<Partial<PriceSettings>>(PRICE_SETTINGS_KEY, {}, handle);
	return { ...DEFAULT_PRICE_SETTINGS, ...stored };
}
