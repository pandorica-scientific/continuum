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
import { passwordLengthError, passwordsMatchError } from '$lib/password-policy';
import { BIRTH_YEAR_ERROR, initialsFor, parseBirthYear } from '$lib/people';
import { availableCurrencies } from '$lib/server/fx/currencies';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({
	currencies: await availableCurrencies(),
	passwordMinLength: passwordMinLength()
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

		// A rejected submission re-renders the wizard, so it has to carry back what
		// was typed — losing a half-filled household to one bad password is its own
		// bug. Passwords are deliberately absent: echoing one would write it into the
		// response HTML, where the browser and any cache along the way can keep it.
		// Asked for explicitly. Everyone who can reach the address is everyone on
		// the instance, including the administrator — see auth/open-mode.ts, which
		// records the consequence rather than mitigating it.
		//
		// Turning it on LATER requires an administrator to re-enter their password,
		// because that is the last moment a password can prove intent. There is no
		// password here yet and no instance to protect, so ticking the box IS the
		// intent, and that is the whole difference.
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
			// With no password protection there is nothing to validate: the fields
			// are disabled on screen and whatever arrives is ignored. Passwords are
			// never DELETED by open mode — there simply are none to store yet, and
			// closing the instance later takes everyone through the normal path.
			if (!openMode) {
				const passwordError = passwordLengthError(p.password, minLength, `${p.name}'s password`);
				if (passwordError) return reject(400, passwordError);
				// Asked twice because this is the only password on a fresh instance: a
				// typo here locked the owner out of their own household immediately,
				// with nothing to fall back on.
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

		// Claim first, then do the expensive work. Concurrent losing requests wait
		// for the singleton and return without hashing any password. Hashes are
		// deliberately sequential as well: even the winning request must not turn an
		// attacker-sized form into parallel Argon2 memory pressure. The surrounding
		// transaction means a hashing or write failure rolls the claim back with the
		// rest, so setup remains retryable.
		const initialized = await runInitialSetup(db, async (tx) => {
			const firstId = prepared[0].id;
			for (const p of prepared) {
				// No password, not an empty one. Hashing '' would store a credential
				// that an empty form field could later satisfy — the opposite of what
				// "this instance has no passwords yet" means. Closing the instance
				// later takes everyone through the normal path of setting one.
				const hash = openMode ? null : await hashPassword(p.password);
				await tx.insert(person).values({
					id: p.id,
					name: p.name,
					initials: initialsFor(p.name),
					// The person who runs the wizard administers the instance; anyone
					// else added here is an ordinary member.
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
