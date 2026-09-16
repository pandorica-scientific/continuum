// SPDX-License-Identifier: AGPL-3.0-or-later
import { asRowId } from '$lib/ids';
import { uuidv7 } from 'uuidv7';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fail, redirect } from '@sveltejs/kit';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db, type Tx } from '$lib/server/db';
import { loadCategories } from '$lib/server/categorize/leaves';
import { calendarAccount, person, session } from '$lib/server/db/schema';
import { currentSessionId } from '$lib/server/auth';
import { changeOwnPassword } from '$lib/server/auth/password';
import { canChangeRole, canDeactivate, canSignIn, requireAdmin } from '$lib/server/auth/policy';
import { createEnrollmentToken, revokeEnrollmentTokens } from '$lib/server/auth/enrollment';
import { BIRTH_YEAR_ERROR, initialsFor, parseBirthYear } from '$lib/people';
import { loadCategoryGroups } from '$lib/server/categorize/groups';
import {
	createCategory,
	createCategoryGroup,
	countCategoryDependants,
	deleteCategory,
	deleteCategoryGroup,
	renameCategoryGroup,
	reorderCategories
} from '$lib/server/categorize/taxonomy';
import { CATEGORY_GROUP_SEED, RESERVE_COLOR_TOKENS } from '$lib/categories';
import { passwordsMatchError } from '$lib/password-policy';
import { disableOpenMode, enableOpenMode, isOpenMode } from '$lib/server/auth/open-mode';
import { asEnumValue, ENUMS } from '$lib/enums';
import { enrollmentLinkDays, passwordMinLength } from '$lib/server/system/policy';
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
import { importConfig as importConfigFile } from '$lib/server/system/config-file';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { getBaseCurrency, getModules, getSetting, setSetting } from '$lib/server/settings';
import { DEFAULT_GAINS_POLICY, parseGainsPolicy, type GainsPolicy } from '$lib/invest/gains';
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
import { serverStatus } from '$lib/server/system/status';
import { MODULE_KEYS, type ModuleKey } from '$lib/modules/registry';
import { createToken, listTokens, revokeToken } from '$lib/server/api/tokens';
import type { Action } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/**
 * Refusing from inside a transaction has to throw: `fail()` only returns a
 * value, which Drizzle reads as a normal completion and commits.
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
 * transaction — so two administrators demoting each other at once cannot both
 * read "2", both pass, and leave the instance with nobody in charge.
 *
 * The predicate matches canSignIn's exactly, in SQL — an admin with no
 * password (still pending enrollment) cannot reach these controls and must not
 * count toward the quorum. Postgres refuses FOR UPDATE alongside an aggregate,
 * so this returns the rows and measures them; ordering by id avoids deadlocks
 * between concurrent transactions taking the same locks.
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
 * The person an action acts on, read inside the same transaction as the count
 * and after it, so the two cannot disagree about the administrator quorum.
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

export const load: PageServerLoad = async ({ locals, url }) => {
	const openMode = await isOpenMode();
	// Everything but the household roster and the member's own password is
	// administrator business and is not fetched at all for anyone else, so it
	// cannot leak through the payload. Members see who lives here (not a secret),
	// but not roles, birth years, deactivation, or pending enrollment.
	const isAdmin = locals.person?.role === 'admin';

	const [
		modules,
		baseCurrency,
		currencies,
		people,
		backup,
		lastBackup,
		status,
		tokens,
		calendarAccounts,
		calendarMarkers,
		calendarSyncMinutes,
		investTax
	] = await Promise.all([
		// All three render only inside the isAdmin branches, so a member skips the queries.
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
		isAdmin ? serverStatus(url.hostname) : null,
		isAdmin ? listTokens() : [],
		// Administrator business: a connected calendar is a credential someone
		// entered, and the account list names where the household's diary goes.
		isAdmin ? listCalendarAccounts() : [],
		isAdmin ? getCalendarMarkers() : true,
		isAdmin ? getSyncIntervalMinutes() : 15,
		// How realised gains are taxed — beside base currency, both facts about the taxing country.
		isAdmin ? getSetting<GainsPolicy>('investTax', DEFAULT_GAINS_POLICY) : null
	]);

	const groups = await loadCategoryGroups();
	const leaves = await loadCategories();

	return {
		isAdmin,
		taxonomy: groups.map((group) => ({
			key: group.key,
			label: group.label,
			colorToken: group.colorToken,
			role: group.role,
			items: leaves
				.filter((leaf) => leaf.groupKey === group.key)
				// isCatchAll travels with each leaf: the screen needs it to know which
				// chips are draggable, and a chip that looks draggable and then refuses
				// to move is worse than one that never offered.
				.map((leaf) => ({ id: leaf.id, name: leaf.name, isCatchAll: leaf.isCatchAll }))
		})),
		// Every leaf, for the "move them to" picker a deletion needs.
		allLeaves: leaves.map((leaf) => ({ id: leaf.id, name: leaf.name })),
		groupRoles: ENUMS['category_group.role'],
		// The whole palette, so a group can be recoloured to any of it — including
		// a token another group is using, which is a legitimate choice when a
		// household has more groups than there are distinct colours.
		paletteTokens: [...CATEGORY_GROUP_SEED.map((seed) => seed.colorToken), ...RESERVE_COLOR_TOKENS],
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
		investTax,
		people,
		// The component needs to know who you are to decide which controls are
		// yours and whether you may administer anyone.
		me: locals.person,
		openMode,
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
const MEMBER_ACTIONS = new Set(['changePassword']);

/**
 * Administrator enforcement for the whole page, applied once, rather than a
 * requireAdmin() call repeated at the top of every action — where forgetting
 * one means an action anyone signed in can call, silently.
 *
 * The cast preserves the concrete shape of the object literal, which is what
 * SvelteKit derives the page's `form` type from; widening it to `Actions`
 * would lose every field.
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

		// One account per provider: two connected to the same calendar would each
		// keep their own view of what they sent, so neither sees the other's writes.
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

		// The same one-account-per-provider rule connectCalendar enforces.
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
		// browser is away. Only pending ATTEMPTS are cleared — a working connection
		// must survive pressing Authorise again.
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

	setCalendarInterval: async ({ request }) => {
		const form = await request.formData();
		const minutes = Number(form.get('minutes'));
		if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
			return fail(400, { message: 'Poll between 1 and 1440 minutes.' });
		}
		await setSetting('calendarSyncMinutes', Math.round(minutes));
		return { ok: true };
	},

	/** How realised gains are taxed — the rate, and whether a long hold is exempt. */
	setTax: async ({ request }) => {
		const form = await request.formData();
		const current = await getSetting<GainsPolicy>('investTax', DEFAULT_GAINS_POLICY);
		const text = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value : null);
		const parsed = parseGainsPolicy(
			{
				ratePct: text(form.get('ratePct')),
				exemptLongHeld: form.get('exemptLongHeld') === 'on',
				exemptAfterYears: text(form.get('exemptAfterYears'))
			},
			current
		);
		if ('message' in parsed) return fail(400, { message: parsed.message });
		await setSetting('investTax', parsed.policy);
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

	/**
	 * Open the instance to anyone who can reach it.
	 *
	 * The administrator's own password is required — not as a second factor, but
	 * because it is the last moment a password can prove that the person asking
	 * for this is the person who will live with it.
	 */
	enableOpenMode: async ({ request, locals }) => {
		if (!locals.person) return fail(403, { message: 'Sign in first.' });
		const form = await request.formData();
		const result = await enableOpenMode(locals.person.id, String(form.get('password') ?? ''));
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/** Close it again. Deliberately asks for nothing — the door is already open. */
	disableOpenMode: async () => {
		await disableOpenMode();
		return { ok: true };
	},

	// ---- The category tree ----
	// Colour is chosen from the palette rather than typed: the set is validated
	// for separation under colour-vision deficiency, which a free hex is not.

	addGroup: async ({ request }) => {
		const form = await request.formData();
		const result = await createCategoryGroup({
			label: String(form.get('groupLabel') ?? ''),
			role: asEnumValue('category_group.role', form.get('groupRole'), 'expense')
		});
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	editGroup: async ({ request }) => {
		const form = await request.formData();
		const result = await renameCategoryGroup(String(form.get('groupKey') ?? ''), {
			label: String(form.get('groupLabel') ?? ''),
			colorToken: String(form.get('colorToken') ?? '')
		});
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	removeGroup: async ({ request }) => {
		const form = await request.formData();
		const result = await deleteCategoryGroup(String(form.get('groupKey') ?? ''));
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/** The order of the categories inside one group, as a person arranged them. */
	reorderLeaves: async ({ request }) => {
		const form = await request.formData();
		const result = await reorderCategories(
			String(form.get('groupKey') ?? ''),
			String(form.get('order') ?? '')
				.split(',')
				.filter(Boolean)
		);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	addLeaf: async ({ request }) => {
		const form = await request.formData();
		const result = await createCategory({
			groupKey: String(form.get('groupKey') ?? ''),
			name: String(form.get('categoryName') ?? '')
		});
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	removeLeaf: async ({ request }) => {
		const form = await request.formData();
		// Rechecked here, not trusted from the screen: deleteCategory refuses if
		// anything has been filed under it in the meantime.
		const result = await deleteCategory(
			String(form.get('categoryId') ?? ''),
			String(form.get('reassignTo') ?? '') || null
		);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/** What still points at a category, so the screen can ask only when there is
	 *  something to ask about. */
	countLeafDependants: async ({ request }) => {
		const form = await request.formData();
		const dependants = await countCategoryDependants(String(form.get('categoryId') ?? ''));
		return { dependants };
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

	saveBackup: async ({ request }) => {
		const form = await request.formData();
		const cadence = String(form.get('cadence') ?? '') as BackupCadence;
		if (!BACKUP_CADENCES.includes(cadence)) return fail(400, { message: 'Unknown cadence.' });
		const dir = String(form.get('dir') ?? '').trim();
		// The dump is plaintext SQL carrying every password hash and access token,
		// so where it lands is checked here, before it is stored.
		const problem = dir ? backupDirProblem(resolve(dir), resolve(env.UPLOAD_DIR || 'data')) : null;
		if (problem) return fail(400, { message: problem });
		if (dir) {
			// The folder need not exist yet — the backup creates it — so walk up to the nearest ancestor that does.
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
		// Started, not awaited: a full dump + file copy can take a while, and the
		// outcome is not lost — `runBackup` records it under `backupLastRun`.
		if (backupInProgress()) return { ok: true, message: 'A backup is already running.' };
		// An unhandled rejection here would take the process down.
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
		const mismatch = passwordsMatchError(next, confirm, 'The two new passwords');
		if (mismatch) return fail(400, { message: mismatch });

		const keep = currentSessionId(cookies);
		const result = await changeOwnPassword(locals.person.id, current, next, keep);
		if (!result.ok) return fail(400, { message: result.message });

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
		// An enrollment link overwrites a password and signs its visitor in, so
		// minting one for somebody already enrolled would be an account takeover —
		// checked here, not only in the markup deciding whether to draw the button.
		if (target.passwordHash !== null) {
			return fail(400, { message: 'That person has already enrolled.' });
		}
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
			// Counted first, because that call is what takes the locks.
			const activeAdmins = await lockActiveAdminCount(tx);
			const target = await policyTarget(tx, personId);
			if (!target) throw new Refused(404, 'No such person.');

			const verdict = canDeactivate(locals.person!, target, activeAdmins);
			if (!verdict.ok) throw new Refused(400, verdict.reason);

			await tx.update(person).set({ deactivatedAt: new Date() }).where(eq(person.id, personId));
			// Credentials stay intact so reactivation is a clean undo; sessions and
			// any un-opened enrollment link are cut so a closed account is not claimable.
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
