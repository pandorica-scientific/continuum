import { redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { building } from '$app/environment';
import { validateSession } from '$lib/server/auth';
import { seedCategories } from '$lib/server/categorize';
import { runMigrations } from '$lib/server/db/migrate';
import { refreshRates } from '$lib/server/fx';
import { isSetUp } from '$lib/server/settings';

// Requests must not race the boot migrations, so handle() awaits this.
let ready: Promise<void> | null = null;

async function boot(): Promise<void> {
	await runMigrations();
	await seedCategories();

	// Daily FX fixing; failures are logged, never fatal — a home server may be
	// offline and the app keeps working with the last known rates.
	const refresh = () =>
		refreshRates().catch((err) => console.warn('FX refresh failed:', err.message ?? err));
	void refresh();
	setInterval(refresh, 6 * 60 * 60 * 1000);
}

export const init: ServerInit = async () => {
	if (building) return;
	ready ??= boot();
	await ready;
};

const PUBLIC_PATHS = ['/login', '/setup'];

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
