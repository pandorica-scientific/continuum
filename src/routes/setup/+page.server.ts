import { randomUUID } from 'node:crypto';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { createSession, hashPassword } from '$lib/server/auth';
import { setSetting } from '$lib/server/settings';
import { MODULE_KEYS, type ModuleToggles } from '$lib/modules/registry';
import { PASSWORD_MIN_LENGTH } from '$lib/password-policy';
import { BIRTH_YEAR_ERROR, initialsFor, parseBirthYear } from '$lib/people';
import { availableCurrencies } from '$lib/server/fx/currencies';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ currencies: await availableCurrencies() });

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const form = await request.formData();

		const householdName = String(form.get('householdName') ?? '').trim();
		const baseCurrency = String(form.get('baseCurrency') ?? 'CZK').toUpperCase();
		if (!/^[A-Z]{3}$/.test(baseCurrency)) {
			return fail(400, { message: 'Base currency must be a three-letter code.' });
		}

		const names = form.getAll('personName').map((v) => String(v).trim());
		const passwords = form.getAll('personPassword').map((v) => String(v));
		const birthYears = form.getAll('personBirthYear').map((v) => String(v).trim());

		const people = names
			.map((name, i) => ({ name, password: passwords[i] ?? '', birthYear: birthYears[i] ?? '' }))
			.filter((p) => p.name.length > 0);

		if (people.length === 0) {
			return fail(400, { message: 'Add at least one person.' });
		}
		const now = new Date();
		const validated: { name: string; password: string; birthYear: number | null }[] = [];
		for (const p of people) {
			if (p.password.length < PASSWORD_MIN_LENGTH) {
				return fail(400, {
					message: `${p.name}'s password needs at least ${PASSWORD_MIN_LENGTH} characters.`
				});
			}
			const birthYear = parseBirthYear(p.birthYear, now);
			if (birthYear === 'invalid') {
				return fail(400, { message: `${p.name}: ${BIRTH_YEAR_ERROR.toLowerCase()}` });
			}
			validated.push({ name: p.name, password: p.password, birthYear });
		}

		const modules = Object.fromEntries(
			MODULE_KEYS.map((key) => [key, form.get(`module_${key}`) === 'on'])
		) as ModuleToggles;

		let firstId = '';
		for (const p of validated) {
			const id = randomUUID();
			if (!firstId) firstId = id;
			await db.insert(person).values({
				id,
				name: p.name,
				initials: initialsFor(p.name),
				// The person who runs the wizard administers the instance; anyone
				// else added here is an ordinary member.
				role: firstId === id ? 'admin' : 'member',
				birthYear: p.birthYear,
				passwordHash: await hashPassword(p.password)
			});
		}

		await setSetting('householdName', householdName || people.map((p) => p.name).join(' & '));
		await setSetting('baseCurrency', baseCurrency);
		await setSetting('modules', modules);

		await createSession(cookies, firstId);
		redirect(303, '/overview');
	}
};
