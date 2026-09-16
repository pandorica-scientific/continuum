// SPDX-License-Identifier: AGPL-3.0-or-later
import { uuidv7 } from 'uuidv7';
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { createSession, hashPassword } from '$lib/server/auth';
import { initialSetupPeopleLimitError, runInitialSetup } from '$lib/server/auth/generation';
import { setSetting } from '$lib/server/settings';
import { MODULE_KEYS, type ModuleToggles } from '$lib/modules/registry';
import { passwordMinLength } from '$lib/server/system/policy';
import { currentAddresses } from '$lib/server/system/addresses';
import { passwordLengthError, passwordsMatchError } from '$lib/password-policy';
import { BIRTH_YEAR_ERROR, initialsFor, parseBirthYear } from '$lib/people';
import { availableCurrencies } from '$lib/server/fx/currencies';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => ({
	currencies: await availableCurrencies(),
	passwordMinLength: passwordMinLength(),
	addresses: await currentAddresses(url.hostname)
});

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const form = await request.formData();

		const householdName = String(form.get('householdName') ?? '').trim();
		const baseCurrency = String(form.get('baseCurrency') ?? 'CZK').toUpperCase();

		const names = form.getAll('personName').map((v) => String(v).trim());
		const passwords = form.getAll('personPassword').map((v) => String(v));
		const confirmations = form.getAll('personPasswordConfirm').map((v) => String(v));
		const birthYears = form.getAll('personBirthYear').map((v) => String(v).trim());

		const modules = Object.fromEntries(
			MODULE_KEYS.map((key) => [key, form.get(`module_${key}`) === 'on'])
		) as ModuleToggles;

		// `entered` below re-populates the wizard on rejection; passwords are deliberately
		// excluded so they never get echoed into response HTML.
		// See auth/open-mode.ts for what open mode means (everyone reaching the address,
		// including the admin, can sign in as anyone). Ticking this box here IS the
		// intent — unlike enabling it later, which requires re-entering a password to
		// prove intent, there's no password yet to do that with.
		const openMode = form.get('openMode') === 'on';

		const entered = {
			householdName,
			baseCurrency,
			openMode,
			modules,
			people: names.map((name, i) => ({ name, birthYear: birthYears[i] ?? '' }))
		};
		const reject = (status: number, message: string) => fail(status, { message, entered });

		if (!/^[A-Z]{3}$/.test(baseCurrency)) {
			return reject(400, 'Base currency must be a three-letter code.');
		}

		const people = names
			.map((name, i) => ({
				name,
				password: passwords[i] ?? '',
				confirmation: confirmations[i] ?? '',
				birthYear: birthYears[i] ?? ''
			}))
			.filter((p) => p.name.length > 0);

		if (people.length === 0) {
			return reject(400, 'Add at least one person.');
		}
		const peopleLimitError = initialSetupPeopleLimitError(people.length);
		if (peopleLimitError) return reject(400, peopleLimitError);
		const now = new Date();
		const minLength = passwordMinLength();
		const validated: { name: string; password: string; birthYear: number | null }[] = [];
		for (const p of people) {
			// Open mode: no password to validate, the fields are disabled client-side.
			if (!openMode) {
				const passwordError = passwordLengthError(p.password, minLength, `${p.name}'s password`);
				if (passwordError) return reject(400, passwordError);
				// Confirmed twice: a typo here would lock the owner out with nothing to fall back on.
				const mismatch = passwordsMatchError(p.password, p.confirmation, `${p.name}'s passwords`);
				if (mismatch) return reject(400, mismatch);
			}
			const birthYear = parseBirthYear(p.birthYear, now);
			if (birthYear === 'invalid') {
				return reject(400, `${p.name}: ${BIRTH_YEAR_ERROR.toLowerCase()}`);
			}
			validated.push({ name: p.name, password: openMode ? '' : p.password, birthYear });
		}

		const prepared = validated.map((p) => ({ ...p, id: uuidv7() }));

		// Claim the setup singleton first so concurrent losing requests skip hashing
		// entirely. Hashes run sequentially so an attacker-sized form can't trigger
		// parallel Argon2 memory pressure. Wrapped in a transaction so a failure rolls
		// the claim back and setup stays retryable.
		const initialized = await runInitialSetup(db, async (tx) => {
			const firstId = prepared[0].id;
			for (const p of prepared) {
				// null, not hashPassword(''), or an empty form field would satisfy the "credential".
				const hash = openMode ? null : await hashPassword(p.password);
				await tx.insert(person).values({
					id: p.id,
					name: p.name,
					initials: initialsFor(p.name),
					// The wizard's runner administers the instance; anyone else added is a member.
					role: p.id === firstId ? 'admin' : 'member',
					birthYear: p.birthYear,
					passwordHash: hash
				});
			}
			await setSetting('householdName', householdName || people.map((p) => p.name).join(' & '), tx);
			await setSetting('baseCurrency', baseCurrency, tx);
			await setSetting('modules', modules, tx);
			if (openMode) await setSetting('openMode', true, tx);
			return firstId;
		});
		if (!initialized.claimed) {
			return reject(409, 'Setup has already been completed.');
		}

		if (!(await createSession(cookies, initialized.value, 0))) {
			return reject(409, 'Setup completed; sign in to continue.');
		}
		redirect(303, '/overview');
	}
};
