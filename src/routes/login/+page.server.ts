import { fail, redirect } from '@sveltejs/kit';
import { eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { createSession, verifyPassword } from '$lib/server/auth';
import {
	loginBlockedForSeconds,
	recordLoginFailure,
	recordLoginSuccess
} from '$lib/server/auth/ratelimit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const people = await db
		.select({ id: person.id, name: person.name, initials: person.initials })
		.from(person)
		// Deactivated people would otherwise sit in the picker failing every
		// attempt, which reads as a broken password rather than a closed account.
		.where(isNull(person.deactivatedAt))
		.orderBy(person.createdAt);
	return { people };
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const address = getClientAddress();
		const wait = loginBlockedForSeconds(address);
		if (wait > 0) {
			return fail(429, {
				message: `Too many failed attempts — try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.`
			});
		}

		const form = await request.formData();
		const personId = String(form.get('personId') ?? '');
		const password = String(form.get('password') ?? '');

		const rows = await db.select().from(person).where(eq(person.id, personId));
		const row = rows[0];
		// A deactivated account must not be distinguishable from a wrong password.
		if (!row || row.deactivatedAt || !(await verifyPassword(row.passwordHash, password))) {
			recordLoginFailure(address);
			return fail(400, { message: 'Wrong person or password.' });
		}

		recordLoginSuccess(address);
		await createSession(cookies, row.id);
		redirect(303, '/overview');
	}
};
