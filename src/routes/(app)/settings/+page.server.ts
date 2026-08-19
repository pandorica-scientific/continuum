import { asRowId } from '$lib/ids';
import { uuidv7 } from 'uuidv7';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fail, redirect } from '@sveltejs/kit';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db, type Tx } from '$lib/server/db';
import { credential, person, session } from '$lib/server/db/schema';
import { currentSessionId } from '$lib/server/auth';
import { changeOwnPassword } from '$lib/server/auth/password';
import { canChangeRole, canDeactivate, canSignIn, requireAdmin } from '$lib/server/auth/policy';
import { createEnrollmentToken, revokeEnrollmentTokens } from '$lib/server/auth/enrollment';
import { currentOrigin, passkeysAvailable } from '$lib/server/auth/webauthn/origin';
import { BIRTH_YEAR_ERROR, initialsFor, parseBirthYear } from '$lib/people';
import { enrollmentLinkDays, passwordMinLength } from '$lib/server/policy';
import { env } from '$env/dynamic/private';
import {
	BACKUP_CADENCES,
	backupDirProblem,
	detectDestinations,
	getBackupConfig,
	getLastBackupRun,
	backupInProgress,
	runBackup,
	setBackupConfig,
	type BackupCadence
} from '$lib/server/backup';
import { importConfig as importConfigFile } from '$lib/server/config-file';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { getBaseCurrency, getModules, setSetting } from '$lib/server/settings';
import { getCalendarMarkers } from '$lib/server/calendar';
import {
	calendarProviderKinds,
	credentialIsPending,
	deletePendingGoogleAccounts,
	getSyncIntervalMinutes,
	listCalendarAccounts,
	makeCalendarProvider as makeCalendarProviderChecked,
	providerFor,
	runSync
} from '$lib/server/calendar/sync';
import { startAuth } from '$lib/server/calendar/sync/google-oauth';
import { calendarAccount } from '$lib/server/db/schema';
import { serverStatus } from '$lib/server/status';
import { MODULE_KEYS, type ModuleKey } from '$lib/modules/registry';
import { createToken, listTokens, revokeToken } from '$lib/server/api/tokens';
import type { Action } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/**
 * Refusing from inside a transaction has to throw. `fail()` only returns a
 * value, which Drizzle reads as a normal completion and commits — harmless
 * while every guard sits above every write, but a trap the day one does not,
 * and it holds the FOR UPDATE locks until COMMIT even for a rejected request.
 */
class Refused extends Error {
	constructor(
		readonly status: number,
		readonly reason: string
	) {
		super(reason);
	}
}

/** Runs `work` in a transaction, turning a `Refused` into an action failure. */
async function transactional(work: (tx: Tx) => Promise<void>) {
	try {
		await db.transaction(work);
		return { ok: true };
	} catch (err) {
		if (err instanceof Refused) return fail(err.status, { message: err.reason });
		throw err;
	}
}

/**
 * Admins who could still sign in, with those rows locked for the rest of the
 * transaction. The lock is the whole point: the guard and the write have to see
 * the same count, or two administrators demoting each other in the same moment
 * both read "2", both pass, and the instance is left with nobody in charge.
 *
 * The predicate is canSignIn's, in SQL. It used to be the deactivation half
 * only, which counted an administrator created but never enrolled — someone who
 * has no password, holds nothing but a one-time link, and cannot reach these
 * controls at all. Adding one was enough to walk the household past this guard:
 * the count read two, the only real administrator was allowed to step down, and
 * recovering meant the psql one-liner in the README.
 *
 * Postgres refuses FOR UPDATE alongside an aggregate, so this returns the rows
 * and measures them. A household has a handful of administrators, and ordering
 * by id keeps two concurrent transactions from taking the locks in opposite
 * orders and deadlocking.
 */
async function lockActiveAdminCount(tx: Tx): Promise<number> {
	const rows = await tx
		.select({ id: person.id })
		.from(person)
		.where(
			and(eq(person.role, 'admin'), isNull(person.deactivatedAt), isNotNull(person.passwordHash))
		)
		.orderBy(person.id)
		.for('update');
	return rows.length;
}

/**
 * The person an action acts on, in the shape the guards want — read inside the
 * same transaction as the count, and after it, so the two cannot disagree about
 * whether this person is one of the administrators still standing.
 */
async function policyTarget(tx: Tx, personId: string) {
	const rows = await tx
		.select({
			id: person.id,
			role: person.role,
			deactivatedAt: person.deactivatedAt,
			passwordHash: person.passwordHash
		})
		.from(person)
		.where(eq(person.id, personId));
	const row = rows[0];
	if (!row) return null;
	return { id: row.id, role: row.role, canSignIn: canSignIn(row) };
}

export const load: PageServerLoad = async ({ locals }) => {
	// Members reach this page for their own password and passkeys. Everything
	// else on it — backup destinations on the host filesystem, server status,
	// the API token list — is administrator business and is not fetched at all
	// for anyone else, so it cannot leak through the payload.
	//
	// The household roster is the one thing in between. Members see who lives
	// here, because that is not a secret in a household; they do not see who
	// administers it, anyone's birth year, who is deactivated, or which accounts
	// have no password set yet — that last one names exactly the people with a
	// live enrollment link outstanding.
	const isAdmin = locals.person?.role === 'admin';

	const [
		modules,
		baseCurrency,
		currencies,
		people,
		backup,
		lastBackup,
		myPasskeys,
		status,
		tokens,
		calendarAccounts,
		calendarMarkers,
		calendarSyncMinutes
	] = await Promise.all([
		// All three render only inside the isAdmin branches of this page, so a
		// member paid for three queries to fill sections their copy never draws.
		// The currency list is the one that costs something real — it reads the FX
		// table. The module map is merely redundant: the (app) layout loads one for
		// everybody to decide the sidebar, so this was a second copy of it rather
		// than a leak of anything.
		isAdmin ? getModules() : null,
		isAdmin ? getBaseCurrency() : null,
		isAdmin ? availableCurrencies() : [],
		db
			.select({
				id: person.id,
				name: person.name,
				initials: person.initials,
				role: isAdmin ? person.role : sql<null>`null`,
				birthYear: isAdmin ? person.birthYear : sql<null>`null`,
				deactivatedAt: isAdmin ? person.deactivatedAt : sql<null>`null`,
				// Created but never enrolled: no password chosen yet.
				pending: isAdmin ? sql<boolean>`${person.passwordHash} is null` : sql<boolean>`false`
			})
			.from(person)
			.orderBy(person.createdAt, person.id),
		isAdmin ? getBackupConfig() : null,
		isAdmin ? getLastBackupRun() : null,
		// Gated on passkeysAvailable() as well as on being signed in: a plain-HTTP
		// LAN instance never renders the passkey card, so this was a round trip
		// per person per visit for the entire life of that deployment.
		passkeysAvailable() && locals.person
			? db
					.select({
						id: credential.id,
						label: credential.label,
						createdAt: credential.createdAt,
						lastUsedAt: credential.lastUsedAt
					})
					.from(credential)
					.where(eq(credential.personId, locals.person.id))
			: [],
		isAdmin ? serverStatus() : null,
		isAdmin ? listTokens() : [],
		// Administrator business: a connected calendar is a credential someone
		// entered, and the account list names where the household's diary goes.
		isAdmin ? listCalendarAccounts() : [],
		isAdmin ? getCalendarMarkers() : true,
		isAdmin ? getSyncIntervalMinutes() : 15
	]);

	return {
		isAdmin,
		calendarAccounts,
		calendarMarkers,
		calendarSyncMinutes,
		// Rendered straight from the registry, so a new provider needs no change
		// to this screen.
		calendarProviders: isAdmin ? calendarProviderKinds() : [],
		passwordMinLength: passwordMinLength(),
		enrollmentLinkDays: enrollmentLinkDays(),
		moduleToggles: modules,
		baseCurrency,
		currencies,
		people,
		// The component needs to know who you are to decide which controls are
		// yours and whether you may administer anyone.
		me: locals.person,
		passkeys: passkeysAvailable(),
		// Named on screen when passkeys are unavailable, so the explanation points
		// at the value actually in force rather than at a variable name.
		origin: currentOrigin(),
		myPasskeys,
		backup,
		lastBackup,
		backupRunning: backupInProgress(),
		backupDestinations: isAdmin ? detectDestinations() : [],
		status,
		apiTokens: tokens.map((t) => ({
			id: t.id,
			label: t.label,
			created: t.createdAt.toISOString().slice(0, 10),
			lastUsed: t.lastUsedAt ? t.lastUsedAt.toISOString().slice(0, 10) : null
		}))
	};
};

/**
 * The two things a member comes to this page for. Everything else on it is
 * household administration.
 */
const MEMBER_ACTIONS = new Set(['changePassword', 'removePasskey']);

/**
 * Administrator enforcement for the whole page, applied once.
 *
 * Written the other way round — a requireAdmin() at the top of each action —
 * the guard was correct twelve times over and the shape was still wrong: the
 * cost of forgetting the thirteenth is an action anyone signed in can call,
 * with nothing failing to say so. That is exactly what /settings/export was
 * until recently. Here, forgetting is a 403 the author meets immediately, and
 * escaping the guard takes naming yourself in MEMBER_ACTIONS above.
 *
 * The cast preserves the concrete shape of the object literal, which is what
 * SvelteKit derives the page's `form` type from — widening it to Actions would
 * cost every field on it.
 */
function administered<T extends Actions>(actions: T): T {
	return Object.fromEntries(
		Object.entries(actions).map(([name, run]) => [
			name,
			(event: Parameters<Action>[0]) => {
				if (!MEMBER_ACTIONS.has(name)) requireAdmin(event.locals.person);
				return (run as Action)(event);
			}
		])
	) as T;
}

export const actions = administered({
	connectCalendar: async ({ request }) => {
		const form = await request.formData();
		const provider = String(form.get('provider') ?? '');
		const kind = calendarProviderKinds().find((k) => k.id === provider);
		if (!kind) return fail(400, { message: 'Unknown calendar provider.' });
		if (kind.oauth) return fail(400, { message: `${kind.label} is connected by authorising it.` });

		// One account per provider. The form is hidden once one exists, but a stale
		// page or a direct POST would otherwise create a second — and two accounts
		// pointed at the same calendar each keep their own view of what they have
		// sent, so neither can see the other's writes.
		const existing = await db
			.select({ id: calendarAccount.id })
			.from(calendarAccount)
			.where(eq(calendarAccount.provider, provider as 'icloud' | 'google'))
			.limit(1);
		if (existing.length > 0) {
			return fail(409, { message: `${kind.label} is already connected. Disconnect it first.` });
		}

		// Only the fields this provider declared. Anything else in the form is
		// ignored rather than stored, so a stray input cannot smuggle a value into
		// the credential blob.
		const config: Record<string, string> = {};
		for (const field of kind.fields) {
			const value = String(form.get(field.key) ?? '').trim();
			if (field.required && !value) {
				return fail(400, { message: `${field.label} is needed.` });
			}
			if (value) config[field.key] = value;
		}

		const built = makeCalendarProviderChecked(provider, config);
		if (!built) return fail(400, { message: 'Could not build that provider.' });

		// Probe BEFORE storing: a credential that does not work is worse than none,
		// because the account then sits in the list looking connected.
		const probe = await built.probe();
		if (!probe.ok) return fail(400, { message: probe.detail });

		const id = uuidv7();
		await db.insert(calendarAccount).values({
			id,
			provider: provider as 'icloud' | 'google',
			label: kind.label,
			credential: JSON.stringify(config)
		});
		return { connected: true };
	},

	authoriseGoogle: async ({ request, url }) => {
		const form = await request.formData();
		const clientId = asRowId(form.get('clientId')).trim();
		const clientSecret = String(form.get('clientSecret') ?? '').trim();
		if (!clientId || !clientSecret) {
			return fail(400, { message: 'The OAuth client ID and secret are both needed.' });
		}

		// The same one-account-per-provider rule connectCalendar enforces, and for
		// the same reason: the form is hidden once one exists, but a stale page or
		// a direct POST would otherwise reach here — and here it would replace a
		// working connection rather than create a second one.
		const connected = await db
			.select({ id: calendarAccount.id, credential: calendarAccount.credential })
			.from(calendarAccount)
			.where(eq(calendarAccount.provider, 'google'));
		if (connected.some((row) => !credentialIsPending(row.credential))) {
			return fail(409, { message: 'Google is already connected. Disconnect it first.' });
		}

		// Derived from the request rather than configured: it has to match the
		// authorised redirect URI in the Cloud console character for character, and
		// the address the browser is on is the only thing that reliably does.
		const redirectUri = `${url.origin}/settings/google/callback`;
		const started = startAuth(clientId, clientSecret, redirectUri);

		// A half-finished row, holding the secret and the state hash while the
		// browser is away. Any earlier ATTEMPT is cleared first so a stale pending
		// row cannot be matched by a later callback.
		//
		// Only attempts. This used to delete every Google row, which meant pressing
		// Authorise again on a WORKING connection destroyed it before the browser
		// had even reached Google — cascading away every sync link (suppressions
		// included, so events the household had deliberately deleted came back) and
		// every unacknowledged conflict. Abandon the consent screen at that point
		// and there was nothing left to go back to.
		await deletePendingGoogleAccounts();
		await db.insert(calendarAccount).values({
			id: uuidv7(),
			provider: 'google',
			label: 'Google Calendar',
			credential: JSON.stringify({
				clientId,
				clientSecret,
				stateHash: started.pending.stateHash
			})
		});

		redirect(303, started.url);
	},

	chooseCalendar: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		const remoteCalId = asRowId(form.get('remoteCalId')).trim();
		const remoteCalName = String(form.get('remoteCalName') ?? '').trim() || null;
		if (!id || !remoteCalId) return fail(400, { message: 'Which calendar?' });

		// The cursor is cleared because it belongs to the OLD collection. Carrying
		// it over would ask the new calendar for changes since a token it never
		// issued — which at best resets, and at worst silently returns nothing.
		await db
			.update(calendarAccount)
			.set({ remoteCalId, remoteCalName, cursor: null, lastSyncAt: null })
			.where(eq(calendarAccount.id, id));
		return { chosen: true };
	},

	listRemoteCalendars: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		const provider = await providerFor(id);
		if (!provider) return fail(404, { message: 'No such account.' });
		try {
			// A provider that makes its own calendar has nothing to offer a picker:
			// under Google's narrow scope the account's calendar list is not even
			// readable. Create one and select it in the same press.
			if (provider.ensureCalendar) {
				const [row] = await db
					.select({ remoteCalId: calendarAccount.remoteCalId })
					.from(calendarAccount)
					.where(eq(calendarAccount.id, id))
					.limit(1);

				// Guarded on the stored id rather than by listing, because listing is
				// exactly what this scope forbids. Without the guard a second press
				// would make a second calendar.
				if (!row?.remoteCalId) {
					const made = await provider.ensureCalendar();
					if (!made) return fail(400, { message: 'Could not create a calendar.' });
					await db
						.update(calendarAccount)
						.set({ remoteCalId: made.id, remoteCalName: made.name, cursor: null, lastSyncAt: null })
						.where(eq(calendarAccount.id, id));
				}
				return { created: true };
			}

			// The account id travels with the list: without it the picker cannot
			// tell which card it belongs to, and with two accounts connected it
			// would appear on both — and write the wrong one.
			return { listedFor: id, calendars: await provider.listCalendars() };
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Could not list calendars.'
			});
		}
	},

	syncCalendarNow: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));

		// The background poller skips an account with no calendar chosen; this had
		// no such guard, so a press between authorising and creating the calendar
		// reached the provider with nothing to write to.
		const [row] = await db
			.select({ remoteCalId: calendarAccount.remoteCalId })
			.from(calendarAccount)
			.where(eq(calendarAccount.id, id))
			.limit(1);
		if (!row) return fail(404, { message: 'No such account.' });
		if (!row.remoteCalId) {
			return fail(400, { message: 'Choose a calendar for that account first.' });
		}

		const report = await runSync(id);
		if (!report) return fail(400, { message: 'Sync failed — see the account for the reason.' });
		if (report.skipped) {
			return fail(409, {
				message: 'A sync is already running for that calendar. Give it a moment and try again.'
			});
		}
		return { synced: report };
	},

	disconnectCalendar: async ({ request }) => {
		const form = await request.formData();
		const id = asRowId(form.get('id'));
		// Links and conflicts cascade. The events themselves stay: they are the
		// household's, not the connection's.
		await db.delete(calendarAccount).where(eq(calendarAccount.id, id));
		return { disconnected: true };
	},

	toggleCalendarMarkers: async () => {
		const now = await getCalendarMarkers();
		await setSetting('calendarMarkers', !now);
		return { ok: true };
	},

	// getSyncIntervalMinutes has read this setting since sync was added and
	// nothing anywhere wrote it, so the documented "a household on a metered
	// connection may want it slower" was not actually available to anyone.
	setCalendarInterval: async ({ request }) => {
		const form = await request.formData();
		const minutes = Number(form.get('minutes'));
		if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
			return fail(400, { message: 'Poll between 1 and 1440 minutes.' });
		}
		await setSetting('calendarSyncMinutes', Math.round(minutes));
		return { ok: true };
	},

	createApiToken: async ({ request }) => {
		const form = await request.formData();
		const { raw } = await createToken(String(form.get('label') ?? ''));
		// Returned once and never stored: only its hash is in the database.
		return { createdToken: raw };
	},

	revokeApiToken: async ({ request }) => {
		const form = await request.formData();
		// NOT asRowId: an api_token id is the sha256 of the bearer token, and that
		// table deliberately keeps a text key. Narrowing it to a uuid turned
		// revocation into a no-op that still reported success.
		await revokeToken(String(form.get('id') ?? ''));
		return { ok: true };
	},

	toggleModule: async ({ request }) => {
		const form = await request.formData();
		const key = String(form.get('key') ?? '') as ModuleKey;
		if (!MODULE_KEYS.includes(key)) return fail(400, { message: 'Unknown module.' });
		const modules = await getModules();
		modules[key] = !modules[key];
		await setSetting('modules', modules);
		return { ok: true };
	},

	setBaseCurrency: async ({ request }) => {
		const form = await request.formData();
		const code = String(form.get('baseCurrency') ?? '').toUpperCase();
		if (!/^[A-Z]{3}$/.test(code)) return fail(400, { message: 'Use a three-letter code.' });
		await setSetting('baseCurrency', code);
		return { ok: true };
	},

	// `dir` is a path on the host that the server will later write a full
	// database dump to. Nobody but an administrator gets to choose it, which is
	// administered()'s job now rather than this action's.
	saveBackup: async ({ request }) => {
		const form = await request.formData();
		const cadence = String(form.get('cadence') ?? '') as BackupCadence;
		if (!BACKUP_CADENCES.includes(cadence)) return fail(400, { message: 'Unknown cadence.' });
		const dir = String(form.get('dir') ?? '').trim();
		// The dump is plaintext SQL carrying every password hash and access
		// token, so where it lands is checked before it is stored — and checked
		// here, where the mistake can still be shown to the person who made it,
		// rather than failing silently at three in the morning.
		const problem = dir ? backupDirProblem(resolve(dir), resolve(env.UPLOAD_DIR || 'data')) : null;
		if (problem) return fail(400, { message: problem });
		if (dir) {
			// The folder itself need not exist — the backup creates it — so the
			// check walks up to the nearest ancestor that does. Catching an
			// unwritable destination here beats discovering it from a failed run
			// at three in the morning.
			let probe = resolve(dir);
			for (;;) {
				const exists = await access(probe, constants.F_OK).then(
					() => true,
					() => false
				);
				if (exists) break;
				const parent = dirname(probe);
				if (parent === probe) break;
				probe = parent;
			}
			const writable = await access(probe, constants.W_OK).then(
				() => true,
				() => false
			);
			if (!writable) {
				return fail(400, {
					message: `This server cannot write to ${probe}. Pick another folder, or change its permissions.`
				});
			}
		}
		await setBackupConfig({ dir, cadence });
		return { ok: true };
	},

	importConfig: async ({ request }) => {
		const form = await request.formData();
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { message: 'Pick a ledger.config.json file.' });
		}
		try {
			const applied = await importConfigFile(JSON.parse(await file.text()));
			if (applied.length === 0) return fail(400, { message: 'The file held no known settings.' });
		} catch (err) {
			return fail(400, {
				message: err instanceof Error ? err.message : 'The file did not parse.'
			});
		}
		return { ok: true };
	},

	runBackupNow: async () => {
		// Started, not awaited. A backup dumps the whole database and copies every
		// uploaded file; awaiting it held the request — and therefore the
		// interface — open for as long as that took, which on a household with
		// years of statements is not a moment.
		//
		// The outcome is not lost by returning early: `runBackup` records it under
		// `backupLastRun`, which this page already reads and shows.
		if (backupInProgress()) return { ok: true, message: 'A backup is already running.' };
		// Rejection handled, not merely ignored: `performBackup` records its own
		// failures, but the config read and the final write sit outside that try,
		// so a database that is briefly away rejects here — and an unhandled
		// rejection takes the process down with it.
		void runBackup().then(
			(run) => {
				if (!run.ok) console.warn('Backup failed:', run.note);
			},
			(error) => console.warn('Backup failed:', error)
		);
		return { ok: true, message: 'Backup started. It will appear here when it finishes.' };
	},

	changePassword: async ({ request, cookies, locals }) => {
		if (!locals.person) return fail(401, { message: 'Sign in first.' });
		const form = await request.formData();
		const current = String(form.get('currentPassword') ?? '');
		const next = String(form.get('newPassword') ?? '');
		const confirm = String(form.get('confirmPassword') ?? '');
		if (next !== confirm) return fail(400, { message: 'The two new passwords do not match.' });

		const keep = currentSessionId(cookies);
		const result = await changeOwnPassword(locals.person.id, current, next, keep);
		if (!result.ok) return fail(400, { message: result.message });

		// Sessions and passkeys both: a passkey enrolled from a stolen session
		// would otherwise survive the one remedy the app offers.
		// Named rather than a bare ok, so the page can confirm the one action here
		// with a real security consequence instead of appearing to do nothing.
		return { passwordChanged: true };
	},

	addPerson: async ({ request, url }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const role = form.get('role') === 'admin' ? 'admin' : 'member';
		if (!name) return fail(400, { message: 'A person needs a name.' });

		const birthYear = parseBirthYear(String(form.get('birthYear') ?? ''), new Date());
		if (birthYear === 'invalid') return fail(400, { message: BIRTH_YEAR_ERROR });

		const id = uuidv7();
		await db.insert(person).values({
			id,
			name,
			initials: initialsFor(name),
			role,
			birthYear,
			// No password: they choose their own through the enrollment link, so
			// the administrator creating them never knows it.
			passwordHash: null
		});

		const { raw } = await createEnrollmentToken(id);
		return { ok: true, enrollmentLink: `${url.origin}/enroll/${raw}` };
	},

	removePasskey: async ({ request, locals }) => {
		if (!locals.person) return fail(401, { message: 'Sign in first.' });
		const form = await request.formData();
		const id = String(form.get('credentialId') ?? '');
		// Scoped to the signed-in person, so one person cannot remove another's.
		await db
			.delete(credential)
			.where(and(eq(credential.id, id), eq(credential.personId, locals.person.id)));
		return { ok: true };
	},

	reissueEnrollment: async ({ request, url }) => {
		const form = await request.formData();
		const personId = asRowId(form.get('personId'));
		const rows = await db
			.select({
				id: person.id,
				passwordHash: person.passwordHash,
				deactivatedAt: person.deactivatedAt
			})
			.from(person)
			.where(eq(person.id, personId));
		const target = rows[0];
		if (!target) return fail(404, { message: 'No such person.' });
		// An enrollment link overwrites a password and signs its visitor in. Minting
		// one for somebody who has already enrolled is an account takeover, so the
		// "still pending" condition has to hold here and not only in the markup
		// that decides whether to draw the button.
		if (target.passwordHash !== null) {
			return fail(400, { message: 'That person has already enrolled.' });
		}
		// Still pending, but closed — deactivation revoked whatever link they had.
		// A replacement would look valid, be passed on in good faith, and then be
		// refused at /enroll with the wording a broken link gets, leaving both
		// sides blaming the URL rather than the account.
		if (target.deactivatedAt) {
			return fail(400, { message: 'That account is deactivated — reactivate them first.' });
		}

		const { raw } = await createEnrollmentToken(personId);
		return { ok: true, enrollmentLink: `${url.origin}/enroll/${raw}` };
	},

	deactivatePerson: async ({ request, locals }) => {
		const form = await request.formData();
		const personId = asRowId(form.get('personId'));

		return transactional(async (tx) => {
			// Counted first, because that call is what takes the locks: every
			// administrator the count includes is held for the rest of the
			// transaction, so if the target is one of them the read below sees a row
			// nobody else can move. A target the count does not include — a member, a
			// pending or deactivated admin — is read unlocked, which is harmless
			// precisely because they are not what the guard is measuring.
			const activeAdmins = await lockActiveAdminCount(tx);
			const target = await policyTarget(tx, personId);
			if (!target) throw new Refused(404, 'No such person.');

			const verdict = canDeactivate(locals.person!, target, activeAdmins);
			if (!verdict.ok) throw new Refused(400, verdict.reason);

			await tx.update(person).set({ deactivatedAt: new Date() }).where(eq(person.id, personId));
			// Credentials and the password hash are left intact so reactivation is a
			// clean undo; live sessions are cut, and so is any enrollment link they
			// never got round to opening — a closed account must not still be
			// claimable by whoever holds that URL.
			await tx.delete(session).where(eq(session.personId, personId));
			await revokeEnrollmentTokens(personId, tx);
		});
	},

	reactivatePerson: async ({ request }) => {
		const form = await request.formData();
		const personId = asRowId(form.get('personId'));
		const updated = await db
			.update(person)
			.set({ deactivatedAt: null })
			.where(eq(person.id, personId))
			.returning({ id: person.id });
		if (!updated[0]) return fail(404, { message: 'No such person.' });
		return { ok: true };
	},

	changePersonRole: async ({ request, locals }) => {
		const form = await request.formData();
		const personId = asRowId(form.get('personId'));
		const next = form.get('role') === 'admin' ? 'admin' : 'member';

		return transactional(async (tx) => {
			// Counted first, for the same reason as deactivatePerson.
			const activeAdmins = await lockActiveAdminCount(tx);
			const target = await policyTarget(tx, personId);
			if (!target) throw new Refused(404, 'No such person.');

			const verdict = canChangeRole(locals.person!, target, next, activeAdmins);
			if (!verdict.ok) throw new Refused(400, verdict.reason);

			await tx.update(person).set({ role: next }).where(eq(person.id, personId));
		});
	}
} satisfies Actions);
