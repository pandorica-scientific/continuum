// SPDX-License-Identifier: AGPL-3.0-or-later
// The calendar sync module's front door: providers register themselves on
// import, and screens import from here only.
//
// Importing for the side effect is the same arrangement src/lib/server/home
// uses. It means adding a provider is one import here plus the adapter file —
// the Settings screen renders whatever is registered and never learns any
// provider's name.

import './icloud';
import './google';

import { eq, inArray } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { calendarAccount } from '$lib/server/db/schema';
import { getSetting } from '$lib/server/settings';
import { calendarProviderKinds, makeCalendarProvider, type CalendarProvider } from './provider';
import { syncAccount, type SyncReport } from './engine';

export * from './provider';
export { syncAccount, type SyncReport } from './engine';

export type CalendarAccountRow = typeof calendarAccount.$inferSelect;

/** Connected accounts, without their credentials. */
export async function listCalendarAccounts(handle: Db = db) {
	return handle
		.select({
			id: calendarAccount.id,
			provider: calendarAccount.provider,
			label: calendarAccount.label,
			remoteCalId: calendarAccount.remoteCalId,
			remoteCalName: calendarAccount.remoteCalName,
			cursor: calendarAccount.cursor,
			lastSyncAt: calendarAccount.lastSyncAt,
			lastError: calendarAccount.lastError,
			createdAt: calendarAccount.createdAt
		})
		.from(calendarAccount)
		.orderBy(calendarAccount.createdAt);
}

/**
 * Build the provider for a stored account.
 *
 * The credential is read here and nowhere else: it never reaches a load
 * function, a page payload or the config export.
 */
export async function providerFor(
	accountId: string,
	handle: Db = db
): Promise<CalendarProvider | null> {
	const [row] = await handle
		.select()
		.from(calendarAccount)
		.where(eq(calendarAccount.id, accountId))
		.limit(1);
	if (!row) return null;

	const config = JSON.parse(row.credential) as Record<string, string>;
	return makeCalendarProvider(row.provider, {
		...config,
		calendarUrl: row.remoteCalId ?? ''
	});
}

/**
 * Whether a stored credential is a half-finished authorisation.
 *
 * The state hash is written when the browser is sent to the provider and
 * removed the moment a token arrives, so its presence is exactly "this row is
 * an attempt, not a connection".
 */
export function credentialIsPending(credential: string): boolean {
	try {
		return Boolean((JSON.parse(credential) as { stateHash?: string }).stateHash);
	} catch {
		// Unreadable is not pending. A row nobody can parse is left for a human
		// rather than deleted on a guess.
		return false;
	}
}

/**
 * Remove abandoned Google authorisations, and ONLY those.
 *
 * Shared by the action that starts a flow and the callback that finishes one,
 * because both used to clear "every Google row" and both therefore destroyed a
 * live connection — with its sync links and conflict history — on a press or a
 * Cancel. Deleting by id keeps the predicate in one place.
 */
export async function deletePendingGoogleAccounts(handle: Db = db): Promise<number> {
	const rows = await handle
		.select({ id: calendarAccount.id, credential: calendarAccount.credential })
		.from(calendarAccount)
		.where(eq(calendarAccount.provider, 'google'));

	const pending = rows.filter((row) => credentialIsPending(row.credential)).map((row) => row.id);
	if (pending.length === 0) return 0;

	await handle.delete(calendarAccount).where(inArray(calendarAccount.id, pending));
	return pending.length;
}

/** Run one pass, recording the outcome on the account either way. */
export async function runSync(accountId: string, handle: Db = db): Promise<SyncReport | null> {
	const provider = await providerFor(accountId, handle);
	if (!provider) return null;

	try {
		return await syncAccount(accountId, provider, handle);
	} catch (error) {
		// A failing account records why and backs off; it must not take the other
		// accounts down with it, so the error is stored rather than rethrown.
		//
		// `lastSyncAt` is stamped on failure as well as on success, and that is what
		// the backing off actually IS: syncDue reads only that column, so leaving it
		// alone meant a never-successful account was due unconditionally and the
		// sixty-second tick presented a dead credential to Apple or Google 1,440
		// times a day, forever. An attempt was made; the interval now applies to it.
		await handle
			.update(calendarAccount)
			.set({
				lastError: error instanceof Error ? error.message : 'Sync failed.',
				lastSyncAt: new Date()
			})
			.where(eq(calendarAccount.id, accountId));
		return null;
	}
}

export { calendarProviderKinds };

/**
 * How often connected calendars are polled, in minutes.
 *
 * A setting rather than a constant: a household on a metered connection may want
 * it slower, and someone testing a change wants it faster. Google's webhook push
 * would avoid polling entirely, but it needs a publicly reachable HTTPS endpoint,
 * which a self-hosted instance usually does not have.
 */
export async function getSyncIntervalMinutes(handle: Db = db): Promise<number> {
	const stored = await getSetting<number>('calendarSyncMinutes', 15, handle);
	// Below a minute is a mistake rather than a preference, and would spend a
	// provider's rate limit on nothing.
	return Number.isFinite(stored) && stored >= 1 ? stored : 15;
}

/**
 * One pass over every account that is ready to sync.
 *
 * Accounts are done one after another, not in parallel: they share the ledger,
 * and two passes writing generated events at once would each take the advisory
 * lock the other is waiting on. A failure is recorded on its own account and
 * never stops the rest.
 */
export async function syncAllAccounts(handle: Db = db, now = new Date()): Promise<void> {
	const interval = await getSyncIntervalMinutes(handle);
	const accounts = await listCalendarAccounts(handle);

	for (const account of accounts) {
		// No calendar chosen yet means there is nowhere to write. Not an error —
		// the account is connected but not finished being set up.
		if (!account.remoteCalId) continue;
		if (!syncDue(account.lastSyncAt, interval, now)) continue;
		await runSync(account.id, handle);
	}
}

/**
 * Whether an account is due.
 *
 * Read from the account's own last-sync time rather than from a timer, so the
 * interval setting takes effect without a restart and a process that was down
 * for an hour syncs once on the way back up rather than not at all.
 */
export function syncDue(
	lastSyncAt: Date | null,
	intervalMinutes: number,
	now: Date = new Date()
): boolean {
	if (!lastSyncAt) return true;
	return now.getTime() - lastSyncAt.getTime() >= intervalMinutes * 60_000;
}
