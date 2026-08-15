import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	backupDirProblem,
	backupDue,
	labelForDestination,
	legacyDumps
} from '$lib/server/backup/policy';
import { orderTables } from '$lib/server/backup/dump';

describe('backup policy', () => {
	const now = new Date('2026-08-13T12:00:00Z');

	it('never due when off, always due when never run', () => {
		expect(backupDue('2020-01-01T00:00:00Z', 'off', now)).toBe(false);
		expect(backupDue(null, 'weekly', now)).toBe(true);
		expect(backupDue(null, 'monthly', now)).toBe(true);
	});

	it('weekly waits seven days, monthly thirty', () => {
		expect(backupDue('2026-08-07T12:00:00Z', 'weekly', now)).toBe(false);
		expect(backupDue('2026-08-06T12:00:00Z', 'weekly', now)).toBe(true);
		expect(backupDue('2026-07-15T12:00:00Z', 'monthly', now)).toBe(false);
		expect(backupDue('2026-07-14T12:00:00Z', 'monthly', now)).toBe(true);
	});

	it('recognises only old timestamped dumps as cleanup targets', () => {
		const names = ['continuum-2026-01-01-0300.sql', 'continuum-backup.sql', 'files', 'holiday.jpg'];
		expect(legacyDumps(names)).toEqual(['continuum-2026-01-01-0300.sql']);
	});

	it('labels cloud-sync folders by their client naming', () => {
		expect(
			labelForDestination('/Users/x/Library/CloudStorage/GoogleDrive-a@gmail.com/My Drive')
		).toBe('Google Drive (a@gmail.com)');
		expect(labelForDestination('/Users/x/Library/CloudStorage/OneDrive-Personal')).toBe(
			'OneDrive (Personal)'
		);
		expect(labelForDestination('/Users/x/Dropbox')).toBe('Dropbox');
		expect(labelForDestination('/backups')).toBe('backups');
	});
});

describe('orderTables', () => {
	it('puts parents before children', () => {
		const order = orderTables(
			['transaction', 'account', 'import_file'],
			[
				['transaction', 'account'],
				['transaction', 'import_file']
			]
		);
		expect(order.indexOf('account')).toBeLessThan(order.indexOf('transaction'));
		expect(order.indexOf('import_file')).toBeLessThan(order.indexOf('transaction'));
	});

	it('tolerates self-references and cycles', () => {
		expect(orderTables(['a'], [['a', 'a']])).toEqual(['a']);
		const cyclic = orderTables(
			['a', 'b'],
			[
				['a', 'b'],
				['b', 'a']
			]
		);
		expect(cyclic.sort()).toEqual(['a', 'b']);
	});

	it('leaves unrelated tables in place', () => {
		expect(orderTables(['x', 'y'], []).sort()).toEqual(['x', 'y']);
	});
});

describe('backupDirProblem', () => {
	const UPLOADS = '/app/data';

	it('allows the folders people actually use', () => {
		expect(backupDirProblem('/backups', UPLOADS)).toBeNull();
		expect(backupDirProblem('/Users/jana/Library/CloudStorage/Dropbox', UPLOADS)).toBeNull();
		expect(backupDirProblem('/mnt/nas/continuum', UPLOADS)).toBeNull();
		expect(backupDirProblem('  /backups  ', UPLOADS)).toBeNull();
	});

	it('allows empty, which means backups are not set up', () => {
		expect(backupDirProblem('', UPLOADS)).toBeNull();
	});

	it('refuses the uploads folder, which this server publishes', () => {
		// The dump is plaintext SQL holding every password hash, the API tokens
		// and the calendar token.
		expect(backupDirProblem('/app/data', UPLOADS)).toMatch(/uploads/i);
		expect(backupDirProblem('/app/data/backups', UPLOADS)).toMatch(/uploads/i);
		expect(backupDirProblem('/app/data/../data', UPLOADS)).toMatch(/uploads/i);
	});

	it('is not fooled by a lookalike sibling of the uploads folder', () => {
		expect(backupDirProblem('/app/database', UPLOADS)).toBeNull();
	});

	it('refuses system directories', () => {
		expect(backupDirProblem('/', UPLOADS)).toMatch(/system directory/);
		expect(backupDirProblem('/etc', UPLOADS)).toMatch(/system directory/);
		expect(backupDirProblem('/usr/', UPLOADS)).toMatch(/system directory/);
	});

	it('compares resolved paths, so a relative destination is judged correctly', () => {
		// Callers resolve before calling — a relative path is perfectly legal
		// (the E2E suite uses one), it just has to be resolved first or the
		// overlap with the served uploads folder would never be spotted.
		expect(backupDirProblem(resolve('/app', 'data/backups'), UPLOADS)).toMatch(/uploads/i);
		expect(backupDirProblem(resolve('/app', 'scratch/backups'), UPLOADS)).toBeNull();
	});
});
