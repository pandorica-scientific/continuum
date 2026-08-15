import { eq } from 'drizzle-orm';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { createSession, hashPassword } from '$lib/server/auth';
import { consumeEnrollmentToken, lookupEnrollmentToken } from '$lib/server/auth/enrollment';
import { passkeysAvailable } from '$lib/server/auth/webauthn/origin';
import { passwordMinLength } from '$lib/server/policy';
import {
	loginBlockedForSeconds,
	recordLoginFailure,
	recordLoginSuccess
} from '$lib/server/auth/ratelimit';
import type { Actions, PageServerLoad } from './$types';

// Every unusable token reads the same to the visitor. Distinguishing "expired"
// from "never existed" would confirm whether a guessed token was ever real.
const UNUSABLE = 'This link is not valid. Ask whoever invited you for a new one.';

const INVALID = { valid: false as const, name: '', passkeys: false, passwordMinLength: 0 };

/** The person a live link belongs to, or null when they cannot enrol after all. */
async function enrollableePerson(token: string): Promise<{ id: string; name: string } | null> {
	const { personId, status } = await lookupEnrollmentToken(token);
	if (status !== 'valid') return null;
	const rows = await db
		.select({
			id: person.id,
			name: person.name,
			deactivatedAt: person.deactivatedAt,
			passwordHash: person.passwordHash
		})
		.from(person)
		.where(eq(person.id, personId));
	const row = rows[0];
	// Deactivation revokes outstanding links, so this is a backstop for one
	// minted and deactivated in the same breath. Without it the visitor sets a
	// password, is handed a session, and is bounced straight back out at
	// /overview by validateSession with nothing explaining why.
	if (!row || row.deactivatedAt) return null;
	// A link must never be spendable against an account that already has a
	// password, because spending it overwrites that password and signs the
	// visitor in. reissueEnrollment refuses to mint one for somebody enrolled,
	// but it reads and then writes in two round trips: a person who enrols inside
	// that window would be left with a fresh, unused link pointing at their live
	// account. Checking again here means a link that should never have existed is
	// refused rather than honoured, whatever the mint side did.
	if (row.passwordHash !== null) return null;
	return { id: row.id, name: row.name };
}

export const load: PageServerLoad = async ({ params }) => {
	const target = await enrollableePerson(params.token);
	if (!target) return INVALID;
	return {
		valid: true as const,
		name: target.name,
		passkeys: passkeysAvailable(),
		passwordMinLength: passwordMinLength()
	};
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
		const minLength = passwordMinLength();
		if (password.length < minLength) {
			return fail(400, { message: `Password needs at least ${minLength} characters.` });
		}
		if (password !== confirm) {
			return fail(400, { message: 'The two passwords do not match.' });
		}

		// Checked before the token is spent, so a link for a closed account is not
		// burned on the way to being refused.
		if (!(await enrollableePerson(params.token))) {
			recordLoginFailure(address);
			return fail(400, { message: UNUSABLE });
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
