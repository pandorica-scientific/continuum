// Pure backup policy: when a backup is due, what a backup file is called,
// which old ones to prune, and how a destination folder reads as a label.
// Everything variable is a setting; only format facts and arithmetic live here.

export const BACKUP_CADENCES = ['off', 'weekly', 'monthly'] as const;
export type BackupCadence = (typeof BACKUP_CADENCES)[number];

export interface BackupConfig {
	/** destination directory on the server's filesystem ('' = not set up) */
	dir: string;
	cadence: BackupCadence;
}

export interface BackupRun {
	at: string; // ISO timestamp
	ok: boolean;
	note: string;
}

const DAY_MS = 86400000;
// 'monthly' means "about once a month", not calendar-day bookkeeping
const CADENCE_DAYS: Record<Exclude<BackupCadence, 'off'>, number> = {
	weekly: 7,
	monthly: 30
};

export function backupDue(lastOkAt: string | null, cadence: BackupCadence, now: Date): boolean {
	if (cadence === 'off') return false;
	if (!lastOkAt) return true;
	return now.getTime() - new Date(lastOkAt).getTime() >= CADENCE_DAYS[cadence] * DAY_MS;
}

// One backup, always overwritten — cloud sync clients keep their own version
// history of the file, so point-in-time copies live on that side.
export const BACKUP_FILE = 'continuum-backup.sql';

/** Timestamped dumps from the earlier keep-N scheme, safe to clean up. */
export function legacyDumps(names: string[]): string[] {
	return names.filter((n) => /^continuum-\d{4}-\d{2}-\d{2}-\d{4}\.sql$/.test(n)).sort();
}

/** Human label for a destination path, derived from how sync clients name their folders. */
export function labelForDestination(path: string): string {
	const base = path.split('/').filter(Boolean).at(-1) ?? path;
	const parent = path.split('/').filter(Boolean).at(-2) ?? '';
	const named = parent.startsWith('GoogleDrive-') && base === 'My Drive' ? parent : base;
	const drive = named.match(/^GoogleDrive-(.+)$/);
	if (drive) return `Google Drive (${drive[1]})`;
	const onedrive = named.match(/^OneDrive-(.+)$/);
	if (onedrive) return `OneDrive (${onedrive[1]})`;
	if (named.startsWith('Dropbox')) return 'Dropbox';
	return named;
}
