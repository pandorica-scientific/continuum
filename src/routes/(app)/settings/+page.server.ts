import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { hashPassword } from '$lib/server/auth';
import {
	BACKUP_CADENCES,
	detectDestinations,
	getBackupConfig,
	getLastBackupRun,
	runBackup,
	setBackupConfig,
	type BackupCadence
} from '$lib/server/backup';
import { importConfig as importConfigFile } from '$lib/server/config-file';
import { availableCurrencies } from '$lib/server/fx/currencies';
import { getBaseCurrency, getModules, setSetting } from '$lib/server/settings';
import { serverStatus } from '$lib/server/status';
import { MODULE_KEYS, type ModuleKey } from '$lib/modules/registry';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [modules, baseCurrency, currencies, people, backup, lastBackup] = await Promise.all([
		getModules(),
		getBaseCurrency(),
		availableCurrencies(),
		db
			.select({
				id: person.id,
				name: person.name,
				initials: person.initials,
				role: person.role,
				birthYear: person.birthYear
			})
			.from(person)
			.orderBy(person.createdAt),
		getBackupConfig(),
		getLastBackupRun()
	]);
	return {
		moduleToggles: modules,
		baseCurrency,
		currencies,
		people,
		backup,
		lastBackup,
		backupDestinations: detectDestinations(),
		status: await serverStatus()
	};
};

export const actions: Actions = {
	toggleModule: async ({ request }) => {
		const form = await request.formData();
		const key = String(form.get('key') ?? '') as ModuleKey;
		if (!MODULE_KEYS.includes(key)) return fail(400, { message: 'Unknown module.' });
		const modules = await getModules();
		modules[key] = !modules[key];
		await setSetting('modules', modules);
		return { ok: true };
	},

	setBaseCurrency: async ({ request }) => {
		const form = await request.formData();
		const code = String(form.get('baseCurrency') ?? '').toUpperCase();
		if (!/^[A-Z]{3}$/.test(code)) return fail(400, { message: 'Use a three-letter code.' });
		await setSetting('baseCurrency', code);
		return { ok: true };
	},

	saveBackup: async ({ request }) => {
		const form = await request.formData();
		const cadence = String(form.get('cadence') ?? '') as BackupCadence;
		if (!BACKUP_CADENCES.includes(cadence)) return fail(400, { message: 'Unknown cadence.' });
		await setBackupConfig({ dir: String(form.get('dir') ?? '').trim(), cadence });
		return { ok: true };
	},

	importConfig: async ({ request }) => {
		const form = await request.formData();
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { message: 'Pick a ledger.config.json file.' });
		}
		try {
			const applied = await importConfigFile(JSON.parse(await file.text()));
			if (applied.length === 0) return fail(400, { message: 'The file held no known settings.' });
		} catch (err) {
			return fail(400, {
				message: err instanceof Error ? err.message : 'The file did not parse.'
			});
		}
		return { ok: true };
	},

	runBackupNow: async () => {
		const run = await runBackup();
		if (!run.ok) return fail(500, { message: `Backup failed: ${run.note}` });
		return { ok: true };
	},

	addPerson: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const birthYear = String(form.get('birthYear') ?? '').trim();
		if (!name) return fail(400, { message: 'A person needs a name.' });
		if (password.length < 8) return fail(400, { message: 'Password needs at least 8 characters.' });
		await db.insert(person).values({
			id: randomUUID(),
			name,
			initials: name
				.split(/\s+/)
				.map((w) => w[0] ?? '')
				.join('')
				.slice(0, 2)
				.toUpperCase(),
			birthYear: birthYear ? Number(birthYear) : null,
			passwordHash: await hashPassword(password)
		});
		return { ok: true };
	}
};
