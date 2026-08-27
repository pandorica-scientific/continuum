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

	it('still reaches the scan pipeline from a computer, through the drop path', () => {
		// What makes hiding the buttons affordable: a photo dropped or browsed
		// anywhere still becomes a cropped, flattened PDF.
		const source = readFileSync('src/lib/components/UploadDropzone.svelte', 'utf8');
		expect(source).toContain('offersScan && picked.length === 1 && isImageFile(picked[0])');
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

describe('the capture buttons', () => {
	it('offers a photo where a photograph can be uploaded', () => {
		const { body } = render(UploadDropzone, {
			props: { name: 'file', accept: 'application/pdf,image/*', idleText: 'Drop a file' }
		});
		expect(body).toContain('Take a photo');
	});

	it('offers a scan where a PDF can be uploaded', () => {
		// A scan is a PDF whatever it was photographed with, so the question is
		// about PDFs rather than about cameras.
		const { body } = render(UploadDropzone, {
			props: { name: 'file', accept: '.pdf', idleText: 'Drop a payslip' }
		});
		expect(body).toContain('Scan a document');
		expect(body).not.toContain('Take a photo');
	});

	it('offers a photo but no scan where a PDF would be refused', () => {
		const { body } = render(UploadDropzone, {
			props: { name: 'photo', accept: 'image/png,image/jpeg', idleText: 'Drop a photo' }
		});
		expect(body).toContain('Take a photo');
		expect(body).not.toContain('Scan a document');
	});

	it('offers both where both are welcome', () => {
		const { body } = render(UploadDropzone, {
			props: { name: 'file', accept: '.pdf,image/*', idleText: 'Drop the payslip' }
		});
		expect(body).toContain('Take a photo');
		expect(body).toContain('Scan a document');
	});

	it('offers neither where a camera could not help', () => {
		for (const accept of ['application/json', '.xlsx']) {
			const { body } = render(UploadDropzone, {
				props: { name: 'file', accept, idleText: 'Drop a file' }
			});
			expect(body).not.toContain('Take a photo');
			expect(body).not.toContain('Scan a document');
		}
	});

	it('says what each one does, because the difference is not obvious', () => {
		// A photograph is kept as it is; a scan is cropped, flattened and made
		// into a PDF. Choosing wrongly either destroys a picture or yields an
		// unusable document.
		const { body } = render(UploadDropzone, {
			props: { name: 'file', accept: '.pdf,image/*', idleText: 'Drop a file' }
		});
		expect(body).toMatch(/title="Take a photo[^"]*kept as it is"/);
		expect(body).toMatch(/title="Scan a document[^"]*PDF"/);
	});

	it('are real buttons, so they land in the tab order after the region', () => {
		const { body } = render(UploadDropzone, {
			props: { name: 'file', accept: 'image/*', idleText: 'Drop a file' }
		});
		expect(body).toMatch(/<button[^>]*type="button"/);
	});

	it('carry labels, being icon-only', () => {
		const { body } = render(UploadDropzone, {
			props: { name: 'file', accept: '.pdf,image/*', idleText: 'Drop a file' }
		});
		expect(body).toContain('aria-label="Take a photo"');
		expect(body).toContain('aria-label="Scan a document"');
	});

	it('stop the click reaching the region behind them', () => {
		// They sit inside a clickable region; without this, tapping one also
		// opens the file browser behind it.
		const source = readFileSync('src/lib/components/UploadDropzone.svelte', 'utf8');
		expect((source.match(/stopPropagation/g) ?? []).length).toBeGreaterThanOrEqual(2);
	});

	it('meet the 44px touch floor on a finger, not on a mouse', () => {
		// 44px exists for fingers. Forcing it on a desktop would make a 36px form
		// row taller wherever a camera happens to be offered.
		const source = readFileSync('src/lib/components/UploadDropzone.svelte', 'utf8');
		expect(source).toContain('@media (pointer: coarse)');
		expect(source).toContain('height: var(--touch-min)');
	});

	it('opens the native camera, which needs no secure context', () => {
		// getUserMedia requires https, so a self-hosted instance on a plain-http
		// LAN address can never show an in-app viewfinder. `capture` can.
		const { body } = render(UploadDropzone, {
			props: { name: 'file', accept: 'image/*', idleText: 'Drop a file' }
		});
		expect(body).toContain('capture="environment"');
	});

	it('routes the photo onto the field input, so one event reaches the form', () => {
		const source = readFileSync('src/lib/components/UploadDropzone.svelte', 'utf8');
		const camera = source.slice(source.indexOf('bind:this={cameraInput}'));
		expect(camera.slice(0, 400)).toContain('adopt(cameraInput.files)');
	});
});
