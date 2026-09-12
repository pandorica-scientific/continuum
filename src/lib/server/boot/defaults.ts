// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The core's own boot steps and tasks.
 *
 * All twelve register here rather than in the module that owns each piece of
 * work. Registration happens at import time, so a registration inside
 * `home/index.ts` would pull the whole home module into the boot path — and
 * five of these are dynamically imported precisely to keep them out of it.
 * Which of them is static and which is dynamic mirrors what hooks.server.ts
 * did before this file existed, module for module: this moves code, it does
 * not change what gets loaded when.
 *
 * Exported as a function rather than run on import: index.ts calls it after
 * its own arrays are initialised, because an import declaration hoists and
 * would otherwise run these calls into a temporal dead zone.
 */
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { runMigrations } from '$lib/server/db/migrate';
import { refreshCurrencies } from '$lib/server/db/currency-refresh';
import { seedBanks, seedCategories } from '$lib/server/categorize';
import { runCpuQueue } from '$lib/server/jobs';
import { refreshRates } from '$lib/server/fx';
import { maybeRunScheduledBackup } from '$lib/server/backup';
import { isSetUp } from '$lib/server/settings';
import { registerBootStep, registerBootTask } from './index';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Register everything this product itself needs at boot. */
export function registerCoreBoot(): void {
	registerBootStep({ id: 'migrate', run: runMigrations });

	// Before anything writes a currency. Fourteen columns now carry a foreign key
	// into this table, so an empty one refuses every insert — and the migration
	// seeds only the two codes it needed to attach those keys.
	registerBootStep({
		id: 'currencies',
		run: async () => {
			await refreshCurrencies(db);
		}
	});

	registerBootStep({ id: 'categories', run: seedCategories });

	// Before any account is written: account.bank carries a foreign key here.
	registerBootStep({ id: 'banks', run: seedBanks });

	// DEMO=1 fills a pristine instance with the fictional Novák household so
	// screenshots and first impressions need no real data. Never touches an
	// instance that has people.
	registerBootStep({
		id: 'demo',
		run: async () => {
			if (!env.DEMO || (await isSetUp())) return;
			const { seedDemo } = await import('$lib/server/system/demo');
			await seedDemo();
			console.log('Demo data seeded (DEMO=1).');
		}
	});

	// Statements accepted but not yet read.
	//
	// The queue survives a restart because the work is in the database rather
	// than in memory, but nothing would pick it up again on its own: a file
	// uploaded a second before the process stopped would sit there indefinitely,
	// having told its owner it was accepted. One sweep at boot, and a slow tick
	// afterwards so a job whose worker died is retried without waiting for the
	// next upload.
	registerBootTask({
		id: 'cpu-queue',
		label: 'CPU queue',
		every: 5 * MINUTE,
		run: async () => {
			await runCpuQueue();
		}
	});

	// Abandoned scans, on the same five-minute tick.
	//
	// Required, not housekeeping, and the module says so: a scan in progress is
	// files and nothing else, so a phone that goes flat halfway through a stack —
	// or a tab closed on a train — leaves 2–4 MB a page behind with nothing in
	// the product that would ever remove it. The screen asks the server to drop
	// its own session when it is closed properly; this is for every other way a
	// scan ends.
	registerBootTask({
		id: 'scan-sweep',
		label: 'Scan sweep',
		every: 5 * MINUTE,
		run: async () => {
			const { sweepScanSessions } = await import('$lib/server/scan/session');
			await sweepScanSessions();
		}
	});

	// Daily FX fixing; failures are logged, never fatal — a home server may be
	// offline and the app keeps working with the last known rates.
	registerBootTask({
		id: 'fx',
		label: 'FX refresh',
		every: 6 * HOUR,
		run: async () => {
			await refreshRates();
		}
	});

	// Scheduled backups: the hourly check is cheap; whether one actually runs
	// is decided by the configured cadence (weekly / monthly).
	registerBootTask({
		id: 'backup',
		label: 'Scheduled backup',
		every: HOUR,
		run: async () => {
			await maybeRunScheduledBackup();
		}
	});

	// The smart-meter reading writes itself onto the lived-in flat's energy
	// bill. It belongs on a tick, not in the home page's load: that load is a
	// GET, and app.html preloads on hover, so hovering the sidebar link wrote to
	// the database. A no-op unless a home platform and a price per kWh are set.
	registerBootTask({
		id: 'meter',
		label: 'Meter bill sync',
		every: HOUR,
		run: async () => {
			const { syncMeterBill } = await import('$lib/server/home');
			await syncMeterBill();
		}
	});

	// Connected calendars. The tick is every minute and cheap — whether a pass
	// actually runs is decided by each account's own last-sync time against the
	// configured interval, so changing that setting takes effect without a
	// restart. An account with no calendar chosen is skipped rather than failed.
	registerBootTask({
		id: 'calendar',
		label: 'Calendar sync',
		every: MINUTE,
		run: async () => {
			const { syncAllAccounts } = await import('$lib/server/calendar/sync');
			await syncAllAccounts();
		}
	});

	// Today's net worth, for the month-on-month delta. One row per day, upserted
	// — it used to be written by computeNetWorth() itself, which the app layout
	// calls on every page and GET /api/v1/networth calls on every poll, so the
	// documented read-only API wrote to the database.
	registerBootTask({
		id: 'networth',
		label: 'Net worth snapshot',
		every: HOUR,
		run: async () => {
			const { recordNetWorthSnapshot } = await import('$lib/server/networth');
			await recordNetWorthSnapshot();
		}
	});
}
