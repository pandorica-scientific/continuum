import { redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { validateSession } from '$lib/server/auth';
import { maybeRunScheduledBackup } from '$lib/server/backup';
import { seedCategories } from '$lib/server/categorize';
import { runMigrations } from '$lib/server/db/migrate';
import { refreshRates } from '$lib/server/fx';
import { isSetUp } from '$lib/server/settings';

// Requests must not race the boot migrations, so handle() awaits this.
let ready: Promise<void> | null = null;

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
}

export const init: ServerInit = async () => {
	if (building) return;
	ready ??= boot();
	await ready;
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
const PUBLIC_PATHS = ['/login', '/setup', '/ics', '/api', '/enroll'];

export const handle: Handle = async ({ event, resolve }) => {
	await (ready ??= boot());

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
