// SPDX-License-Identifier: AGPL-3.0-or-later
// Auto-detected backup destinations: the mounted cloud-sync folders this
// server can see. Nothing is assumed — only folders that actually exist are
// offered, and the user can always type any other path.

import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import { labelForDestination } from './policy';

interface BackupDestination {
	path: string;
	label: string;
}

function isDir(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

export function detectDestinations(): BackupDestination[] {
	const found: string[] = [];

	// The Docker image mounts a backups volume and points BACKUP_DIR at it.
	if (env.BACKUP_DIR && isDir(env.BACKUP_DIR)) found.push(env.BACKUP_DIR);

	const home = homedir();

	// macOS cloud-sync mounts (Google Drive, OneDrive, Dropbox desktop clients)
	const cloudStorage = join(home, 'Library', 'CloudStorage');
	if (isDir(cloudStorage)) {
		for (const entry of readdirSync(cloudStorage)) {
			const mount = join(cloudStorage, entry);
			if (!isDir(mount)) continue;
			// Google Drive mounts sync inside "My Drive", not the mount root
			const myDrive = join(mount, 'My Drive');
			found.push(entry.startsWith('GoogleDrive-') && isDir(myDrive) ? myDrive : mount);
		}
	}

	// Older direct sync folders in the home directory
	for (const name of ['Dropbox', 'Google Drive', 'OneDrive', 'Nextcloud', 'Sync']) {
		const path = join(home, name);
		if (isDir(path)) found.push(path);
	}

	return [...new Set(found)].map((path) => ({ path, label: labelForDestination(path) }));
}
