// SPDX-License-Identifier: AGPL-3.0-or-later
import { redirect, type Handle, type HandleServerError, type ServerInit } from '@sveltejs/kit';
import { building } from '$app/environment';
// First, and before anything that reads a registry. See the file's own comment.
import '$lib/server/extensions';
import { validateSession } from '$lib/server/auth';
import { csrfRefusal, sameSiteFormPost } from '$lib/server/auth/csrf';
import { authorizeApiRequest } from '$lib/server/api/respond';
import { isPublicPath, requestGates } from '$lib/server/auth/gates';
import { bootSteps, bootTasks } from '$lib/server/boot';
import { isSetUp } from '$lib/server/settings';
import { withRequest } from '$lib/server/auth/cookies';

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
	// Steps first, in order, and a rejection here fails the boot — see
	// ensureReady() above, which clears its slot so the next request retries.
	for (const step of bootSteps()) await step.run();

	// Then the recurring work. A task's failure is logged and its schedule
	// continues: a home server that cannot reach the currency fixing must keep
	// working on the rates it already has.
	for (const task of bootTasks()) {
		const tick = () =>
			task.run().catch((err) => console.warn(`${task.label} failed:`, err.message ?? err));
		void tick();
		setInterval(tick, task.every);
	}
}

// A warm-up, not a gate: it moves the boot migrations off the first request
// rather than deciding whether the server may run. So a failure here is logged
// and swallowed — ensureReady() has already cleared its slot, and handle()
// awaits it on every request, so the next one retries and the server recovers
// on its own once the database is reachable. Letting the rejection escape
// instead would kill the process: SvelteKit propagates it out of Server.init()
// and adapter-node awaits that at module top level, so an unreachable database
// at start became an unhandled rejection, an exit, and — under a restart
// policy — an endless crash loop that no later recovery could interrupt.
export const init: ServerInit = async () => {
	if (building) return;
	await ensureReady().catch((err) =>
		console.warn('Boot deferred to first request:', err.message ?? err)
	);
};

// Every cookie written while this request is handled needs to know whether
// the browser used https; see $lib/server/auth/cookies.
export const handle: Handle = ({ event, resolve }) =>
	withRequest(event.request, () => handleRequest(event, resolve));

const handleRequest = async (
	event: Parameters<Handle>[0]['event'],
	resolve: Parameters<Handle>[0]['resolve']
) => {
	// Before ensureReady(): a request that is going to be refused has no business
	// waiting on the boot migrations, and this decision needs nothing from the
	// database. SvelteKit's own origin check used to run even earlier, ahead of
	// this hook entirely — which is why it could not be improved and had to be
	// replaced (see vite.config.ts and $lib/server/auth/csrf).
	if (!sameSiteFormPost(event.request)) return csrfRefusal(event.request);

	await ensureReady();

	const { pathname } = event.url;

	event.locals.person = await validateSession(event.cookies);

	const apiRefusal = await authorizeApiRequest(pathname, event.request, event.getClientAddress());
	if (apiRefusal) return apiRefusal;

	// Reasons to refuse that this product does not have; empty here. A gate
	// throws redirect() to send the visitor somewhere instead, so this loop
	// deliberately does not catch.
	for (const gate of requestGates()) {
		const refusal = await gate.check(event);
		if (refusal) return refusal;
	}

	const isPublic = isPublicPath(pathname);

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

// An unexpected error becomes a short reference, printed to the log beside the
// stack and shown on the error screen. Two halves of one pair: the stack never
// reaches the browser — it can name file paths and, in a query, real figures —
// and the reference is useless on its own without the log entry it points at.
//
// SvelteKit routes 404s through here as well, and those are neither unexpected
// nor worth a stack in the log: a reference invites somebody to report a typed
// address as a fault, and a log line per bad URL buries the real errors. So
// only a server-side failure earns one.
export const handleError: HandleServerError = ({ error, event, status, message }) => {
	if (status < 500) return { message };

	// Two four-character groups: long enough not to collide within one log file,
	// short enough to read down a phone to somebody.
	const reference = `${rand()}·${rand()}`;
	console.error(`[${reference}] ${status} ${event.request.method} ${event.url.pathname}`, error);
	return { message, reference };
};

function rand(): string {
	return Math.random().toString(16).slice(2, 6).padStart(4, '0');
}
