import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { credential, person, session } from '$lib/server/db/schema';
import { currentSessionId } from '$lib/server/auth';
import { changeOwnPassword, revokeOtherSessions } from '$lib/server/auth/password';
import { canChangeRole, canDeactivate, requireAdmin } from '$lib/server/auth/policy';
import { createEnrollmentToken } from '$lib/server/auth/enrollment';
import { passkeysAvailable } from '$lib/server/auth/webauthn/origin';
import { BIRTH_YEAR_ERROR, initialsFor, parseBirthYear } from '$lib/people';
import {
	BACKUP_CADENCES,
	detectDestinations,
	getBackupConfig,
	getLastBackupRun,
	runBackup,
	setBackupConfig,
	type BackupCadence
} from '$lib/server/backup';
import { importConfig as importConfigFile } from '$lib/server/config-file';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { getBaseCurrency, getModules, setSetting } from '$lib/server/settings';
import { serverStatus } from '$lib/server/status';
import { MODULE_KEYS, type ModuleKey } from '$lib/modules/registry';
import { createToken, listTokens, revokeToken } from '$lib/server/api/tokens';
import type { Actions, PageServerLoad } from './$types';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Admins who could still sign in, with those rows locked for the rest of the
 * transaction. The lock is the whole point: the guard and the write have to see
 * the same count, or two administrators demoting each other in the same moment
 * both read "2", both pass, and the instance is left with nobody in charge.
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
		.where(and(eq(person.role, 'admin'), isNull(person.deactivatedAt)))
		.orderBy(person.id)
		.for('update');
	return rows.length;
}

export const load: PageServerLoad = async ({ locals }) => {
	// Members reach this page for their own password and passkeys. Everything
	// else on it — backup destinations on the host filesystem, server status,
	// the API token list — is administrator business and is not fetched at all
	// for anyone else, so it cannot leak through the payload.
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
		tokens
	] = await Promise.all([
		getModules(),
		getBaseCurrency(),
		availableCurrencies(),
		db
			.select({
				id: person.id,
				name: person.name,
				initials: person.initials,
				role: person.role,
				birthYear: person.birthYear,
				deactivatedAt: person.deactivatedAt,
				// Created but never enrolled: no password chosen yet.
				pending: sql<boolean>`${person.passwordHash} is null`
			})
			.from(person)
			.orderBy(person.createdAt),
		isAdmin ? getBackupConfig() : null,
		isAdmin ? getLastBackupRun() : null,
		locals.person
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
		isAdmin ? listTokens() : []
	]);

	return {
		isAdmin,
		moduleToggles: modules,
		baseCurrency,
		currencies,
		people,
		// The component needs to know who you are to decide which controls are
		// yours and whether you may administer anyone.
		me: locals.person,
		passkeys: passkeysAvailable(),
		myPasskeys,
		backup,
		lastBackup,
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

export const actions: Actions = {
	createApiToken: async ({ request, locals }) => {
		requireAdmin(locals.person);
		const form = await request.formData();
		const { raw } = await createToken(String(form.get('label') ?? ''));
		// Returned once and never stored: only its hash is in the database.
		return { createdToken: raw };
	},

	revokeApiToken: async ({ request, locals }) => {
		requireAdmin(locals.person);
		const form = await request.formData();
		await revokeToken(String(form.get('id') ?? ''));
		return { ok: true };
	},

	toggleModule: async ({ request, locals }) => {
		requireAdmin(locals.person);
		const form = await request.formData();
		const key = String(form.get('key') ?? '') as ModuleKey;
		if (!MODULE_KEYS.includes(key)) return fail(400, { message: 'Unknown module.' });
		const modules = await getModules();
		modules[key] = !modules[key];
		await setSetting('modules', modules);
		return { ok: true };
	},

	setBaseCurrency: async ({ request, locals }) => {
		requireAdmin(locals.person);
		const form = await request.formData();
		const code = String(form.get('baseCurrency') ?? '').toUpperCase();
		if (!/^[A-Z]{3}$/.test(code)) return fail(400, { message: 'Use a three-letter code.' });
		await setSetting('baseCurrency', code);
		return { ok: true };
	},

	saveBackup: async ({ request, locals }) => {
		// `dir` is a path on the host that the server will later write a full
		// database dump to. Nobody but an administrator gets to choose it.
		requireAdmin(locals.person);
		const form = await request.formData();
		const cadence = String(form.get('cadence') ?? '') as BackupCadence;
		if (!BACKUP_CADENCES.includes(cadence)) return fail(400, { message: 'Unknown cadence.' });
		await setBackupConfig({ dir: String(form.get('dir') ?? '').trim(), cadence });
		return { ok: true };
	},

	importConfig: async ({ request, locals }) => {
		requireAdmin(locals.person);
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

	runBackupNow: async ({ locals }) => {
		requireAdmin(locals.person);
		const run = await runBackup();
		if (!run.ok) return fail(500, { message: `Backup failed: ${run.note}` });
		return { ok: true };
	},

	changePassword: async ({ request, cookies, locals }) => {
		if (!locals.person) return fail(401, { message: 'Sign in first.' });
		const form = await request.formData();
		const current = String(form.get('currentPassword') ?? '');
		const next = String(form.get('newPassword') ?? '');
		const confirm = String(form.get('confirmPassword') ?? '');
		if (next !== confirm) return fail(400, { message: 'The two new passwords do not match.' });

		const result = await changeOwnPassword(locals.person.id, current, next);
		if (!result.ok) return fail(400, { message: result.message });

		const keep = currentSessionId(cookies);
		if (keep) await revokeOtherSessions(locals.person.id, keep);
		return { ok: true };
	},

	addPerson: async ({ request, locals, url }) => {
		requireAdmin(locals.person);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const role = form.get('role') === 'admin' ? 'admin' : 'member';
		if (!name) return fail(400, { message: 'A person needs a name.' });

		const birthYear = parseBirthYear(String(form.get('birthYear') ?? ''), new Date());
		if (birthYear === 'invalid') return fail(400, { message: BIRTH_YEAR_ERROR });

		const id = randomUUID();
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

	reissueEnrollment: async ({ request, locals, url }) => {
		requireAdmin(locals.person);
		const form = await request.formData();
		const personId = String(form.get('personId') ?? '');
		const rows = await db
			.select({ id: person.id, passwordHash: person.passwordHash })
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

		const { raw } = await createEnrollmentToken(personId);
		return { ok: true, enrollmentLink: `${url.origin}/enroll/${raw}` };
	},

	deactivatePerson: async ({ request, locals }) => {
		requireAdmin(locals.person);
		const form = await request.formData();
		const personId = String(form.get('personId') ?? '');

		return db.transaction(async (tx) => {
			const rows = await tx
				.select({ id: person.id, role: person.role })
				.from(person)
				.where(eq(person.id, personId));
			const target = rows[0];
			if (!target) return fail(404, { message: 'No such person.' });

			const verdict = canDeactivate(locals.person!, target, await lockActiveAdminCount(tx));
			if (!verdict.ok) return fail(400, { message: verdict.reason });

			await tx.update(person).set({ deactivatedAt: new Date() }).where(eq(person.id, personId));
			// Credentials and the password hash are left intact so reactivation is a
			// clean undo; only live sessions are cut.
			await tx.delete(session).where(eq(session.personId, personId));
			return { ok: true };
		});
	},

	reactivatePerson: async ({ request, locals }) => {
		requireAdmin(locals.person);
		const form = await request.formData();
		const personId = String(form.get('personId') ?? '');
		const updated = await db
			.update(person)
			.set({ deactivatedAt: null })
			.where(eq(person.id, personId))
			.returning({ id: person.id });
		if (!updated[0]) return fail(404, { message: 'No such person.' });
		return { ok: true };
	},

	changePersonRole: async ({ request, locals }) => {
		requireAdmin(locals.person);
		const form = await request.formData();
		const personId = String(form.get('personId') ?? '');
		const next = form.get('role') === 'admin' ? 'admin' : 'member';

		return db.transaction(async (tx) => {
			const rows = await tx
				.select({ id: person.id, role: person.role })
				.from(person)
				.where(eq(person.id, personId));
			const target = rows[0];
			if (!target) return fail(404, { message: 'No such person.' });

			const verdict = canChangeRole(locals.person!, target, next, await lockActiveAdminCount(tx));
			if (!verdict.ok) return fail(400, { message: verdict.reason });

			await tx.update(person).set({ role: next }).where(eq(person.id, personId));
			return { ok: true };
		});
	}
};
