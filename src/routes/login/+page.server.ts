import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { createSession, verifyPassword } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const people = await db
		.select({ id: person.id, name: person.name, initials: person.initials })
		.from(person)
		.orderBy(person.createdAt);
	return { people };
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const form = await request.formData();
		const personId = String(form.get('personId') ?? '');
		const password = String(form.get('password') ?? '');

		const rows = await db.select().from(person).where(eq(person.id, personId));
		const row = rows[0];
		if (!row || !(await verifyPassword(row.passwordHash, password))) {
			return fail(400, { message: 'Wrong person or password.' });
		}

		await createSession(cookies, row.id);
		redirect(303, '/overview');
	}
};
