// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// A DOCUMENT UPLOAD (any paper the household has, in several formats) must go
// through UploadDropzone, so drag/click/camera are offered in one place. A
// FORMAT-SPECIFIC IMPORTER reads one named file a service produced, with
// nothing to photograph and no format to choose, so a plain button is correct
// and this rule does not reach it.
const EXEMPT = new Map([
	[
		join('src', 'lib', 'components', 'UploadDropzone.svelte'),
		'owns the raw input every other site now goes through'
	],
	[
		join('src', 'routes', '(app)', 'settings', '+page.svelte'),
		'restores the settings JSON Continuum exported — a format-specific importer, not a document upload'
	],
	[
		join('src', 'lib', 'components', 'BulkPayslipDialog.svelte'),
		'takes .pdf only, from one payroll system — a format-specific importer'
	],
	[
		join('src', 'lib', 'components', 'ContactForm.svelte'),
		'a portrait in three image formats, not a document: there is no paper here to scan'
	],
	[
		join('src', 'lib', 'components', 'ImageSlot.svelte'),
		'a photo tile, not a file input: it renders its image and owns a drag state, a two-tap remove and a lightbox, with the input only as the picker that tile opens'
	],
	[
		join('src', 'lib', 'scan', 'client', 'ScanFlow.svelte'),
		'the phone camera app as the source of the NEXT page on a plain-http address, where the in-page viewfinder cannot open: it is reached from inside the scanner, which UploadDropzone already opened'
	]
]);

function svelteFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return svelteFiles(path);
		return path.endsWith('.svelte') ? [path] : [];
	});
}

describe('file inputs', () => {
	it('exist only where a plain one is the right control', () => {
		const offenders = svelteFiles('src')
			.filter((path) => !EXEMPT.has(path))
			.filter((path) => /type="file"/.test(readFileSync(path, 'utf8')));
		expect(offenders).toEqual([]);
	});

	it('keeps every exemption honest — an exempt file must still have one', () => {
		// An exemption that stops applying is worse than no exemption: it silently
		// permits the next raw input someone adds to that file.
		const stale = [...EXEMPT.keys()].filter(
			(path) => !/type="file"/.test(readFileSync(path, 'utf8'))
		);
		expect(stale).toEqual([]);
	});
});
