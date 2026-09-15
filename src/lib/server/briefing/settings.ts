// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The briefing's tunable thresholds.
 *
 * Two of the sources ask a question whose right answer is the household's, not
 * the code's: when in the year tax is worth chasing (a country's deadline, and
 * how early this household likes to be asked), and how long an account may go
 * quiet before it looks forgotten rather than merely unused. Everything else on
 * the strip is a constant in `index.ts`, because it states a fact about the
 * thing rather than a preference about being nagged.
 *
 * Shaped like `prices/settings.ts`: one key, partial storage, defaults merged
 * on read, so a household that has never opened the setting still gets sound
 * behaviour and one that has set only one field keeps the other.
 */
import { db, type Queryable } from '$lib/server/db';
import { getSetting } from '$lib/server/settings';

export interface BriefingSettings {
	/**
	 * The month of the year from which last year's unfiled tax is raised, 1–12.
	 *
	 * Three: the Czech paper deadline is the first of April, so March is the
	 * month in which it stops being early and starts being late.
	 */
	taxReminderMonth: number;
	/** An account with no movement and no statement balance for this many days looks stale. */
	statementStaleDays: number;
}

export const BRIEFING_SETTINGS_KEY = 'briefing';
export const DEFAULT_BRIEFING_SETTINGS: BriefingSettings = {
	taxReminderMonth: 3,
	// Six weeks: a monthly statement that has not arrived is a fortnight late by
	// then, which is long enough to be a fact rather than a delay.
	statementStaleDays: 45
};

export async function getBriefingSettings(handle: Queryable = db): Promise<BriefingSettings> {
	const stored = await getSetting<Partial<BriefingSettings>>(BRIEFING_SETTINGS_KEY, {}, handle);
	return { ...DEFAULT_BRIEFING_SETTINGS, ...stored };
}
