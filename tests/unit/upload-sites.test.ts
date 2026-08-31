// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * There are two kinds of file control in this product, and they are not the
 * same control wearing different labels.
 *
 * A DOCUMENT UPLOAD takes whatever paper the household has — a receipt, a bill,
 * a contract, a statement — in whichever of several formats it arrived in. It
 * goes through UploadDropzone, so that drag, click and (once the scan engine
 * lands) the camera are offered in one place rather than at whichever site
 * someone remembered to update.
 *
 * A FORMAT-SPECIFIC IMPORTER reads one named file that Continuum itself, or one
 * named service, produced: the settings JSON, a broker's .xlsx. There is nothing
 * to photograph and no format to choose between, so the plain button it already
 * has is the right control and this rule does not reach it.
 */
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
