import { redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { validateSession } from '$lib/server/auth';
import { maybeRunScheduledBackup } from '$lib/server/backup';
import { seedCategories } from '$lib/server/categorize';
import { runMigrations } from '$lib/server/db/migrate';
import { refreshRates } from '$lib/server/fx';
import { isSetUp } from '$lib/server/settings';

// Requests must not race the boot migrations, so handle() awaits this. A
// *failed* boot must not be cached: `ready ??= boot()` alone would memoise the
// rejection forever, so one unreachable database during migration would 500
// every later request until the container restarted, long after the database
// came back. Clearing the slot on rejection lets the next request retry.
let ready: Promise<void> | null = null;

function ensureReady(): Promise<void> {
	ready ??= boot().catch((err) => {
		ready = null;
		throw err;
	});
	return ready;
}

async function boot(): Promise<void> {
	await runMigrations();
	await seedCategories();

	// DEMO=1 fills a pristine instance with the fictional Novák household so
	// screenshots and first impressions need no real data. Never touches an
	// instance that has people.
	if (env.DEMO && !(await isSetUp())) {
		const { seedDemo } = await import('$lib/server/demo');
		await seedDemo();
		console.log('Demo data seeded (DEMO=1).');
	}

	// Daily FX fixing; failures are logged, never fatal — a home server may be
	// offline and the app keeps working with the last known rates.
	const refresh = () =>
		refreshRates().catch((err) => console.warn('FX refresh failed:', err.message ?? err));
	void refresh();
	setInterval(refresh, 6 * 60 * 60 * 1000);

	// Scheduled backups: the hourly check is cheap; whether one actually runs
	// is decided by the configured cadence (weekly / monthly).
	const backup = () =>
		maybeRunScheduledBackup().catch((err) =>
			console.warn('Scheduled backup failed:', err.message ?? err)
		);
	void backup();
	setInterval(backup, 60 * 60 * 1000);

	// The smart-meter reading writes itself onto the lived-in flat's energy
	// bill. It belongs on a tick, not in the home page's load: that load is a
	// GET, and app.html preloads on hover, so hovering the sidebar link wrote to
	// the database. A no-op unless a home platform and a price per kWh are set.
	const meter = async () => {
		const { syncMeterBill } = await import('$lib/server/home');
		return syncMeterBill();
	};
	const meterTick = () =>
		meter().catch((err) => console.warn('Meter bill sync failed:', err.message ?? err));
	void meterTick();
	setInterval(meterTick, 60 * 60 * 1000);

	// Today's net worth, for the month-on-month delta. One row per day, upserted
	// — it used to be written by computeNetWorth() itself, which the app layout
	// calls on every page and GET /api/v1/networth calls on every poll, so the
	// documented read-only API wrote to the database.
	const snapshot = async () => {
		const { recordNetWorthSnapshot } = await import('$lib/server/networth');
		return recordNetWorthSnapshot();
	};
	const snapshotTick = () =>
		snapshot().catch((err) => console.warn('Net worth snapshot failed:', err.message ?? err));
	void snapshotTick();
	setInterval(snapshotTick, 60 * 60 * 1000);
}

export const init: ServerInit = async () => {
	if (building) return;
	await ensureReady();
};

// /ics/<token> is public by design: calendar apps subscribe without a session,
// authenticated by the secret token in the URL. /api authenticates itself the
// same way, with a bearer token instead of a cookie. /enroll/<token> is the
// same shape again — the visitor has no session yet, and the token in the URL
// is what authorises them to set a password.
//
// This exempts them from the redirect to /login, NOT from authentication —
// every /api route calls requireToken itself, and one that forgets to would be
// wide open. The E2E journey asserts an unauthenticated request gets a 401.
//
// /auth/passkey/register is on the list for the same reason, and only that
// reason: both of its endpoints refuse a request without a session themselves.
// They are fetched by script, so answering them with a 303 to the login page
// meant the browser followed it and tried to parse an HTML page as JSON — an
// expired session surfaced as "Unexpected token <" instead of "sign in again",
// and the endpoints' own 401 could never fire.
const PUBLIC_PATHS = [
	'/login',
	'/setup',
	'/ics',
	'/api',
	'/enroll',
	'/auth/passkey/login',
	'/auth/passkey/register'
];

export const handle: Handle = async ({ event, resolve }) => {
	await ensureReady();

	const { pathname } = event.url;

	event.locals.person = await validateSession(event.cookies);

	const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));

	if (pathname === '/setup') {
		// The wizard only exists until the first person is created.
		if (await isSetUp()) redirect(303, event.locals.person ? '/overview' : '/login');
	} else if (pathname === '/login') {
		if (!(await isSetUp())) redirect(303, '/setup');
		if (event.locals.person) redirect(303, '/overview');
	} else if (!isPublic && !event.locals.person) {
		if (!(await isSetUp())) redirect(303, '/setup');
		redirect(303, '/login');
	}

	return resolve(event);
};
