// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import UploadDropzone from '$lib/components/UploadDropzone.svelte';

describe('the upload dropzone as a form field', () => {
	it('names its input so the enclosing form posts it', () => {
		const { body } = render(UploadDropzone, {
			props: { name: 'file', idleText: 'Drop a file here, or click to browse' }
		});
		expect(body).toContain('name="file"');
	});

	it('does not hide the input in field mode — a named input a form posts must exist', () => {
		const { body } = render(UploadDropzone, {
			props: { name: 'file', idleText: 'Drop a file here, or click to browse' }
		});
		// The input is visually hidden by class, never by `display: none`, which
		// would be fine for posting but removes it from the accessibility tree.
		expect(body).not.toContain('style="display: none"');
	});

	it('still renders without a name, for the callback call sites', () => {
		const { body } = render(UploadDropzone, {
			props: {
				idleText: 'Drop a statement',
				onfiles: async () => ({ type: 'success' as const, message: null })
			}
		});
		expect(body).toContain('role="button"');
		expect(body).not.toContain('name=');
	});

	it('says what it accepts on hover, not as a permanent second line', () => {
		// A second line costs every form a taller control forever, to answer a
		// question the user asks once.
		const { body } = render(UploadDropzone, {
			props: {
				name: 'file',
				idleText: 'Drop a file here, or click to browse',
				description: 'PDF, PNG or JPEG'
			}
		});
		expect(body).toContain('title="PDF, PNG or JPEG"');
		expect(body).not.toMatch(/<span class="description[^"]*">/);
	});

	it('shows the chosen filename in place of the prompt, on the same one line', () => {
		const { body } = render(UploadDropzone, {
			props: { name: 'file', idleText: 'Drop a file here, or click to browse' }
		});
		// One <span class="title"> and nothing else: the filename replaces the
		// prompt rather than stacking under it.
		expect((body.match(/class="title/g) ?? []).length).toBe(1);
	});
});

describe('the upload dropzone as a control', () => {
	const css = readFileSync('src/lib/components/UploadDropzone.svelte', 'utf8');

	it('stands on the same floor as every other control', () => {
		// A 24px-padded two-line block is a panel, not a control: beside a button
		// it reads as a second, competing region rather than as its neighbour.
		expect(css).toContain('min-height: var(--control-h)');
	});

	it('borrows the button geometry so a dropzone and a button line up', () => {
		expect(css).toContain('border-radius: var(--radius-md)');
		expect(css).toContain('padding: 7px 13px');
		expect(css).toContain('font-size: var(--text-md)');
	});

	it('keeps a long filename on one line rather than growing the row', () => {
		expect(css).toContain('text-overflow: ellipsis');
	});

	it('fires a change event after taking a dropped file', () => {
		// Assigning `input.files` fires nothing, so without this a dropped file
		// filled the field and silently skipped every handler a chosen file is
		// meant to start — reading a payslip, unlocking a dependent select. The
		// failure is invisible: the filename appears and the form still posts.
		//
		// A source assertion because the repo runs vitest under node with no DOM;
		// the behaviour it stands for is verified by dropping a payslip PDF and
		// watching Gross/Net/Bonus fill in.
		expect(css).toMatch(/input\.files = transfer\.files;\s*\n[\s\S]{0,40}dispatchEvent/);
		expect(css).toContain("new Event('change', { bubbles: true })");
	});

	it('does not run the callback twice for one drop', () => {
		// `adopt` fires the change event that runs `receive`; calling `receive`
		// from the drop handler as well would upload the same file twice.
		const dropHandler = css.slice(css.indexOf('ondrop='), css.indexOf('ondrop=') + 600);
		expect(dropHandler).not.toMatch(/receive\(/);
	});
});
