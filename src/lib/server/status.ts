// Live facts about this installation for the Settings → Self-hosting panel:
// version, database, storage locations and their health. Everything is read
// fresh on each load — this is the screen someone opens when something
// misbehaves, so nothing here is cached.

import { access, readdir, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';

interface StorageFact {
	label: string;
	path: string;
	writable: boolean;
	size: string | null;
}

interface ServerStatus {
	version: string;
	migrations: number;
	databaseSize: string;
	uptime: string;
	origin: string;
	node: string;
	storage: StorageFact[];
}

export function formatBytes(bytes: number): string {
	const units = ['B', 'kB', 'MB', 'GB', 'TB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

export function formatUptime(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

async function dirFact(label: string, path: string): Promise<StorageFact> {
	const writable = await access(path, constants.W_OK).then(
		() => true,
		() => false
	);
	let size: string | null;
	try {
		const names = await readdir(path);
		let total = 0;
		for (const name of names) {
			try {
				const s = await stat(join(path, name));
				total += s.isDirectory() ? 0 : s.size;
			} catch {
				// file vanished between readdir and stat — skip it
			}
		}
		size = formatBytes(total);
	} catch {
		size = null;
	}
	return { label, path, writable, size };
}

export async function serverStatus(): Promise<ServerStatus> {
	let version = 'dev';
	try {
		const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version?: string };
		if (pkg.version) version = pkg.version;
	} catch {
		// package.json not next to the built app — keep 'dev'
	}

	let migrations = 0;
	let databaseSize = '—';
	try {
		const m = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
		migrations = Number((m as unknown as { n: number }[])[0]?.n ?? 0);
		const s = await db.execute(sql`select pg_database_size(current_database())::bigint as b`);
		databaseSize = formatBytes(Number((s as unknown as { b: string }[])[0]?.b ?? 0));
	} catch {
		// database facts stay at their fallbacks if the queries fail
	}

	const storage: StorageFact[] = [await dirFact('Uploads', env.UPLOAD_DIR || 'data')];
	if (env.BACKUP_DIR) storage.push(await dirFact('Backups', env.BACKUP_DIR));

	return {
		version,
		migrations,
		databaseSize,
		uptime: formatUptime(process.uptime()),
		origin: env.ORIGIN || 'not set',
		node: process.version,
		storage
	};
}
