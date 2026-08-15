import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openUpload, removeUpload, saveUpload } from '$lib/server/files';

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
