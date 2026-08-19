import { asRowId } from '$lib/ids';
import { fail, redirect } from '@sveltejs/kit';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { passkeysAvailable } from '$lib/server/auth/webauthn/origin';
import { person } from '$lib/server/db/schema';
import { createSession, verifyPassword } from '$lib/server/auth';
import {
	blockedForSeconds,
	loginLimitSubject,
	recordFailure,
	recordSuccess
} from '$lib/server/auth/ratelimit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const people = await db
		.select({ id: person.id, name: person.name, initials: person.initials })
		.from(person)
		// Only people who can actually sign in — the same pair of conditions as
		// canSignIn. Anyone else would sit in the picker failing every attempt,
		// which reads as a broken password rather than as a closed account or one
		// whose enrollment link has not been opened yet. The second is the worse
		// of the two: a new person who tries the picker before reading their mail
		// spends the per-address failure budget that gates everyone's sign-in, and
		// behind a reverse proxy or Tailscale the whole household shares one
		// address.
		.where(and(isNull(person.deactivatedAt), isNotNull(person.passwordHash)))
		.orderBy(person.createdAt, person.id);
	return { people, passkeys: passkeysAvailable() };
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const address = getClientAddress();
		const form = await request.formData();
		const personId = asRowId(form.get('personId'));
		const password = String(form.get('password') ?? '');

		// Resolve existence with one cheap indexed lookup before spending Argon2.
		// Unknown caller-controlled IDs all share one subject, while every failure
		// also spends the coarse address budget.
		const rows = await db.select().from(person).where(eq(person.id, personId));
		const row = rows[0];
		const limitSubject = loginLimitSubject(personId, Boolean(row));
		const wait = blockedForSeconds('login', address, limitSubject);
		if (wait > 0) {
			return fail(429, {
				message: `Too many failed attempts — try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.`
			});
		}

		// A deactivated or never-enrolled account must not be distinguishable from
		// a wrong password — by wording or by how long the answer took. Which is
		// why the verify runs first and is combined afterwards: short-circuiting on
		// `row.deactivatedAt ||` skipped argon2 entirely and returned in about a
		// millisecond, where a wrong password costs the full ~100ms. verifyPassword
		// does the same for a null hash rather than returning early.
		const correct = await verifyPassword(row?.passwordHash ?? null, password);
		if (!row || row.deactivatedAt || !correct) {
			recordFailure('login', address, limitSubject);
			return fail(400, { message: 'Wrong person or password.' });
		}

		if (!(await createSession(cookies, row.id, row.authGeneration))) {
			return fail(400, { message: 'Authentication changed while signing in — try again.' });
		}
		recordSuccess('login', address, limitSubject);
		redirect(303, '/overview');
	}
};
