// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { eq } from 'drizzle-orm';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { completeEnrollment, lookupEnrollmentToken } from '$lib/server/auth/enrollment';
import { currentOrigin, passkeysUsableFrom } from '$lib/server/auth/webauthn/origin';
import { passwordMinLength } from '$lib/server/system/policy';
import { passwordLengthError, passwordsMatchError } from '$lib/password-policy';
import { blockedForSeconds, recordFailure } from '$lib/server/auth/ratelimit';
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

export const load: PageServerLoad = async ({ params, url }) => {
	const target = await enrollableePerson(params.token);
	if (!target) return INVALID;
	return {
		valid: true as const,
		name: target.name,
		passkeys: passkeysUsableFrom(url.origin, currentOrigin()).usable,
		passwordMinLength: passwordMinLength()
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, params, getClientAddress }) => {
		const address = getClientAddress();
		const wait = blockedForSeconds('enroll', address);
		if (wait > 0) {
			return fail(429, {
				message: `Too many attempts — try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.`
			});
		}

		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirmPassword') ?? '');
		const passwordError = passwordLengthError(password, passwordMinLength());
		if (passwordError) return fail(400, { message: passwordError });
		const mismatch = passwordsMatchError(password, confirm);
		if (mismatch) return fail(400, { message: mismatch });

		// completeEnrollment rechecks the token, active person and pending-password
		// state in one transaction, so a closed account never burns its link.
		if (!(await completeEnrollment(params.token, password, cookies))) {
			recordFailure('enroll', address);
			return fail(400, { message: UNUSABLE });
		}

		// No recordSuccess: spending a valid link does not clear the failure
		// budget, the same rule the API gate documents — a caller holding one
		// good link must not be able to reset their guessing allowance with it.
		redirect(303, '/overview');
	}
};
