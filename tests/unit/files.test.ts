import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	hashBytes,
	hashStoredUpload,
	openUpload,
	removeUpload,
	saveUpload
} from '$lib/server/system/files';

const DIRECTORY = resolve('scratch-workspace/files-test');
let previousDirectory: string | undefined;

beforeAll(() => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
});

afterAll(async () => {
	if (previousDirectory === undefined) delete process.env.UPLOAD_DIR;
	else process.env.UPLOAD_DIR = previousDirectory;
	await rm(DIRECTORY, { recursive: true, force: true });
});

describe('removeUpload', () => {
	it('removes only a generated upload name', async () => {
		const name = await saveUpload(new File(['image'], 'photo.png', { type: 'image/png' }));
		expect(await openUpload(name)).not.toBeNull();

		expect(await removeUpload(name)).toBe(true);
		expect(await openUpload(name)).toBeNull();
		expect(await removeUpload('../photo.png')).toBe(false);
	});
});

describe('hashing an upload', () => {
	it('fingerprints the contents, not the name a browser gave it', () => {
		const bytes = new TextEncoder().encode('%PDF-1.4 payslip');
		// The same slip re-exported under another name is the same slip; a month
		// may hold two payslips, so nothing keyed on the month catches it.
		expect(hashBytes(bytes)).toBe(hashBytes(new TextEncoder().encode('%PDF-1.4 payslip')));
		expect(hashBytes(bytes)).not.toBe(hashBytes(new TextEncoder().encode('%PDF-1.4 payslop')));
	});

	it('refuses a name it did not generate', async () => {
		expect(await hashStoredUpload('../payslip.pdf')).toBeNull();
	});

	it('is null for a file that is no longer there', async () => {
		const name = await saveUpload(new File(['slip'], 'payslip.pdf', { type: 'application/pdf' }));
		await removeUpload(name);
		// A document whose upload has been lost cannot be matched against, and
		// must not stop the ones that can.
		expect(await hashStoredUpload(name)).toBeNull();
	});
});
