// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The core's own boot steps and tasks, registered here rather than in the
 * module that owns each piece of work — several are dynamically imported so
 * a boot with nothing to do for them does not pull that module in.
 *
 * Exported as a function rather than run on import: index.ts calls it after
 * its own arrays are initialised, since an import declaration hoists and
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

	// Before anything writes a currency: many columns carry a foreign key into
	// this table, and an empty one refuses every insert.
	registerBootStep({
		id: 'currencies',
		run: async () => {
			await refreshCurrencies(db);
		}
	});

	registerBootStep({ id: 'categories', run: seedCategories });

	// Before any account is written: account.bank carries a foreign key here.
	registerBootStep({ id: 'banks', run: seedBanks });

	// The curated sights. Dynamic so a boot with no geodata fetched does not pay
	// for pulling in the reader; a no-op in that case.
	registerBootStep({
		id: 'places',
		run: async () => {
			const { seedPlaces } = await import('$lib/server/life/places');
			await seedPlaces();
		}
	});

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

	// Statements accepted but not yet read. The queue survives a restart since
	// the work is in the database, but nothing would pick it up again on its
	// own without this sweep and the slow tick after it.
	registerBootTask({
		id: 'cpu-queue',
		label: 'CPU queue',
		every: 5 * MINUTE,
		run: async () => {
			await runCpuQueue();
		}
	});

	// Abandoned scans, on the same five-minute tick. A scan in progress is files
	// and nothing else, so a phone going flat mid-stack leaves several MB behind
	// with nothing else that would ever remove it.
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
			// Backfill the years the household's history reaches into, once each;
			// after the first boot this finds nothing to do.
			const { backfillRates } = await import('$lib/server/fx');
			await backfillRates();
		}
	});

	// Daily closes for every ticker the household owns. The cadence is a
	// setting read at each run, so changing it needs no restart: the task ticks
	// hourly and does the work only when the configured interval has elapsed.
	let lastPriceRun = 0;
	registerBootTask({
		id: 'prices',
		label: 'Price refresh',
		every: HOUR,
		run: async () => {
			const { getPriceSettings } = await import('$lib/server/prices/settings');
			const { refreshEveryHours } = await getPriceSettings();
			if (Date.now() - lastPriceRun < refreshEveryHours * HOUR) return;
			const { refreshPrices } = await import('$lib/server/prices');
			await refreshPrices();
			lastPriceRun = Date.now();
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
	// bill. Belongs on a tick, not the home page's load, since that load is a
	// GET and app.html preloads on hover. A no-op unless a home platform and a
	// price per kWh are set.
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
	// actually runs is decided by each account's own last-sync time against its
	// configured interval. An account with no calendar chosen is skipped.
	registerBootTask({
		id: 'calendar',
		label: 'Calendar sync',
		every: MINUTE,
		run: async () => {
			const { syncAllAccounts } = await import('$lib/server/calendar/sync');
			await syncAllAccounts();
		}
	});

	// Today's net worth, for the month-on-month delta. One row per day, upserted.
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
