import { randomUUID } from 'node:crypto';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { createSession, hashPassword } from '$lib/server/auth';
import { setSetting } from '$lib/server/settings';
import { MODULE_KEYS, type ModuleToggles } from '$lib/modules/registry';
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
		for (const p of people) {
			if (p.password.length < 8) {
				return fail(400, { message: `${p.name}'s password needs at least 8 characters.` });
			}
		}

		const modules = Object.fromEntries(
			MODULE_KEYS.map((key) => [key, form.get(`module_${key}`) === 'on'])
		) as ModuleToggles;

		let firstId = '';
		for (const p of people) {
			const id = randomUUID();
			if (!firstId) firstId = id;
			await db.insert(person).values({
				id,
				name: p.name,
				initials: p.name
					.split(/\s+/)
					.map((w) => w[0] ?? '')
					.join('')
					.slice(0, 2)
					.toUpperCase(),
				birthYear: p.birthYear ? Number(p.birthYear) : null,
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
