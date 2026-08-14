import { eq } from 'drizzle-orm';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { createSession, hashPassword } from '$lib/server/auth';
import { consumeEnrollmentToken, lookupEnrollmentToken } from '$lib/server/auth/enrollment';
import { passkeysAvailable } from '$lib/server/auth/webauthn/origin';
import {
	loginBlockedForSeconds,
	recordLoginFailure,
	recordLoginSuccess
} from '$lib/server/auth/ratelimit';
import type { Actions, PageServerLoad } from './$types';

// Every unusable token reads the same to the visitor. Distinguishing "expired"
// from "never existed" would confirm whether a guessed token was ever real.
const UNUSABLE = 'This link is not valid. Ask whoever invited you for a new one.';

export const load: PageServerLoad = async ({ params }) => {
	const { personId, status } = await lookupEnrollmentToken(params.token);
	if (status !== 'valid') return { valid: false as const, name: '', passkeys: false };
	const rows = await db.select({ name: person.name }).from(person).where(eq(person.id, personId));
	return { valid: true as const, name: rows[0]?.name ?? '', passkeys: passkeysAvailable() };
};

export const actions: Actions = {
	default: async ({ request, cookies, params, getClientAddress }) => {
		const address = getClientAddress();
		const wait = loginBlockedForSeconds(address);
		if (wait > 0) {
			return fail(429, {
				message: `Too many attempts — try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.`
			});
		}

		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirmPassword') ?? '');
		if (password.length < 8) {
			return fail(400, { message: 'Password needs at least 8 characters.' });
		}
		if (password !== confirm) {
			return fail(400, { message: 'The two passwords do not match.' });
		}

		const consumed = await consumeEnrollmentToken(params.token);
		if (!consumed) {
			recordLoginFailure(address);
			return fail(400, { message: UNUSABLE });
		}

		recordLoginSuccess(address);
		await db
			.update(person)
			.set({ passwordHash: await hashPassword(password) })
			.where(eq(person.id, consumed.personId));
		await createSession(cookies, consumed.personId);
		redirect(303, '/overview');
	}
};
