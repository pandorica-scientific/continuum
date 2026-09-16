// SPDX-License-Identifier: AGPL-3.0-or-later
import { asRowId } from '$lib/ids';
import { fail, redirect } from '@sveltejs/kit';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { isOpenMode } from '$lib/server/auth/open-mode';
import { person } from '$lib/server/db/schema';
import { createSession, verifyPassword } from '$lib/server/auth';
import {
	blockedForSeconds,
	loginLimitSubject,
	recordFailure,
	recordSuccess
} from '$lib/server/auth/ratelimit';
import { personHues } from '$lib/people';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const openMode = await isOpenMode();
	const people = await db
		.select({ id: person.id, name: person.name, initials: person.initials })
		.from(person)
		// Only people who can actually sign in (same conditions as canSignIn) — otherwise
		// a not-yet-enrolled account spends the shared per-address failure budget.
		// In open mode a password isn't required, so don't filter on it.
		.where(
			openMode
				? isNull(person.deactivatedAt)
				: and(isNull(person.deactivatedAt), isNotNull(person.passwordHash))
		)
		.orderBy(person.createdAt, person.id);
	// The same colour each person is tagged with everywhere else in the app, so
	// the picker on the way in matches the sidebar on the other side of it.
	const hues = personHues(people.map((p) => p.id));
	return {
		people: people.map((p) => ({ ...p, hue: hues.get(p.id) ?? '--fg3' })),
		openMode
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const address = getClientAddress();
		const form = await request.formData();
		const personId = asRowId(form.get('personId'));
		const password = String(form.get('password') ?? '');

		// Cheap indexed lookup before spending Argon2; unknown IDs share one rate-limit subject.
		const rows = await db.select().from(person).where(eq(person.id, personId));
		const row = rows[0];
		const limitSubject = loginLimitSubject(personId, Boolean(row));
		const wait = blockedForSeconds('login', address, limitSubject);
		if (wait > 0) {
			return fail(429, {
				message: `Too many failed attempts — try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.`
			});
		}

		// verifyPassword must always run (not short-circuited) so a deactivated or
		// never-enrolled account isn't distinguishable from a wrong password by timing.
		// Open mode skips the credential but still requires a real, usable account.
		const open = await isOpenMode();
		const correct = open || (await verifyPassword(row?.passwordHash ?? null, password));
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
