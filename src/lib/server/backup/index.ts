// Backups: a restorable database dump plus a copy of every uploaded file,
// written straight into a folder of the user's choosing — typically a mounted
// cloud-sync folder (Google Drive, Dropbox, …), so the sync client carries it
// off-machine. The dump is one file, overwritten on every run; sync clients
// keep their own version history of it. Destination and cadence are settings.

import { copyFile, mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from '$env/dynamic/private';
import { getSetting, setSetting } from '$lib/server/settings';
import { dumpDatabase } from './dump';
import {
	BACKUP_CADENCES,
	BACKUP_FILE,
	backupDirProblem,
	backupDue,
	legacyDumps,
	type BackupCadence,
	type BackupConfig,
	type BackupRun
} from './policy';

export { detectDestinations } from './destinations';
export { backupDirProblem } from './policy';
export { BACKUP_CADENCES, type BackupCadence, type BackupConfig, type BackupRun };

// Backups get their own subfolder so a shared Drive folder stays tidy.
const SUBFOLDER = 'Continuum backups';

export async function getBackupConfig(): Promise<BackupConfig> {
	const stored = await getSetting<Partial<BackupConfig>>('backup', {});
	return {
		dir: typeof stored.dir === 'string' ? stored.dir : '',
		cadence: BACKUP_CADENCES.includes(stored.cadence as BackupCadence)
			? (stored.cadence as BackupCadence)
			: 'monthly'
	};
}

export async function setBackupConfig(config: BackupConfig): Promise<void> {
	await setSetting('backup', config);
}

export async function getLastBackupRun(): Promise<BackupRun | null> {
	return getSetting<BackupRun | null>('backupLastRun', null);
}

export async function runBackup(): Promise<BackupRun> {
	const startedAt = new Date();
	const config = await getBackupConfig();
	let run: BackupRun;
	try {
		if (!config.dir) throw new Error('No backup destination is set.');
		// Checked again at write time, not only where it was typed: the setting
		// can also arrive through an imported ledger.config.json, or have been
		// stored before this check existed.
		const problem = backupDirProblem(resolve(config.dir), resolve(env.UPLOAD_DIR || 'data'));
		if (problem) throw new Error(problem);
		const dest = join(config.dir, SUBFOLDER);
		await mkdir(dest, { recursive: true });

		// 1. The database, as one restorable SQL file, overwritten every run —
		// written next to its final name and renamed, so a crash mid-write can
		// never leave a truncated backup as the only copy.
		const dumpSql = await dumpDatabase();
		const finalPath = join(dest, BACKUP_FILE);
		await writeFile(finalPath + '.tmp', dumpSql, 'utf8');
		await rename(finalPath + '.tmp', finalPath);

		// 2. Uploaded files (documents, photos, statements). Their names are
		// content-addressed UUIDs that never change, so copying only what is
		// missing makes every later backup incremental.
		const uploadDir = env.UPLOAD_DIR || 'data';
		const filesDest = join(dest, 'files');
		await mkdir(filesDest, { recursive: true });
		let copied = 0;
		let uploads: string[] = [];
		try {
			uploads = await readdir(uploadDir);
		} catch {
			uploads = []; // no uploads yet
		}
		const already = new Set(await readdir(filesDest));
		for (const name of uploads) {
			if (name.startsWith('.') || already.has(name)) continue;
			await copyFile(join(uploadDir, name), join(filesDest, name));
			copied++;
		}

		// 3. Clean up timestamped dumps from the earlier keep-N scheme.
		for (const old of legacyDumps(await readdir(dest))) {
			await unlink(join(dest, old));
		}

		run = {
			at: startedAt.toISOString(),
			ok: true,
			note: `Database dumped, ${copied} new file${copied === 1 ? '' : 's'} copied.`
		};
	} catch (err) {
		run = {
			at: startedAt.toISOString(),
			ok: false,
			note: err instanceof Error ? err.message : 'Backup failed.'
		};
	}
	await setSetting('backupLastRun', run);
	return run;
}

/** Called by the in-process scheduler; runs a backup when one is due. */
export async function maybeRunScheduledBackup(): Promise<void> {
	const config = await getBackupConfig();
	if (!config.dir || config.cadence === 'off') return;
	const last = await getLastBackupRun();
	if (backupDue(last?.ok ? last.at : null, config.cadence, new Date())) {
		await runBackup();
	}
}
