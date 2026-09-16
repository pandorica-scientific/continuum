// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The briefing's tunable thresholds: when tax is worth chasing, and how long
 * an account may go quiet before it looks forgotten. Everything else on the
 * strip is a constant in `index.ts` since it states a fact rather than a
 * preference about being nagged.
 *
 * Shaped like `prices/settings.ts`: one key, partial storage, defaults merged
 * on read.
 */
import { db, type Queryable } from '$lib/server/db';
import { getSetting } from '$lib/server/settings';

export interface BriefingSettings {
	/**
	 * The month of the year from which last year's unfiled tax is raised, 1–12.
	 * Default 3: the Czech paper deadline is the first of April.
	 */
	taxReminderMonth: number;
	/** An account with no movement and no statement balance for this many days looks stale. */
	statementStaleDays: number;
}

export const BRIEFING_SETTINGS_KEY = 'briefing';
export const DEFAULT_BRIEFING_SETTINGS: BriefingSettings = {
	taxReminderMonth: 3,
	// Six weeks: a monthly statement is a fortnight late by then already.
	statementStaleDays: 45
};

export async function getBriefingSettings(handle: Queryable = db): Promise<BriefingSettings> {
	const stored = await getSetting<Partial<BriefingSettings>>(BRIEFING_SETTINGS_KEY, {}, handle);
	return { ...DEFAULT_BRIEFING_SETTINGS, ...stored };
}
