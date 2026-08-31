// SPDX-License-Identifier: AGPL-3.0-or-later
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

// Directories a backup must never be written into. Not a security boundary —
// the only person who can set this is already the administrator — but the dump
// is plaintext SQL holding every password hash, the API tokens, the calendar
// token and the Home Assistant token, so a typo here has consequences a
// mistyped label does not.
const SYSTEM_DIRS = new Set([
	'/',
	'/bin',
	'/boot',
	'/dev',
	'/etc',
	'/lib',
	'/proc',
	'/root',
	'/sbin',
	'/sys',
	'/usr',
	'/var'
]);

/** Normalise a path for comparison: absolute, no trailing slash, no '..'. */
function tidy(path: string): string {
	const parts: string[] = [];
	for (const segment of path.split('/')) {
		if (!segment || segment === '.') continue;
		if (segment === '..') parts.pop();
		else parts.push(segment);
	}
	return '/' + parts.join('/');
}

/**
 * Why this backup destination is unusable, or null if it is fine.
 *
 * Deliberately permissive: the destination is normally a mounted cloud-sync
 * folder and this app cannot know what those are called, so anything the user
 * types is allowed. What is refused is the small set of paths that are either
 * a typo or actively harmful — a system directory, and the upload directory,
 * whose contents this server publishes over HTTP.
 *
 * Both arguments must already be resolved against the working directory. A
 * relative destination is perfectly legal (the E2E suite uses one), but
 * UPLOAD_DIR defaults to the relative "data", so comparing raw strings would
 * miss exactly the overlap this is here to catch.
 */
export function backupDirProblem(dirAbsolute: string, uploadDirAbsolute: string): string | null {
	const raw = dirAbsolute.trim();
	if (!raw) return null; // empty means "not set up", which is allowed

	const resolved = tidy(raw);
	if (SYSTEM_DIRS.has(resolved)) {
		return `${resolved} is a system directory — pick a folder of your own.`;
	}

	const uploads = tidy(uploadDirAbsolute);
	if (resolved === uploads || resolved.startsWith(uploads + '/')) {
		return 'That is inside the uploads folder, which this server publishes — the backup holds password hashes and access tokens. Pick a folder outside it.';
	}
	return null;
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
