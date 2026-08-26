// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import ScanReview from '$lib/scan/client/ScanReview.svelte';
import { defaultFilename } from '$lib/scan/core/naming';

const page = (id: string) => ({
	id,
	mode: 'bw' as const,
	blob: new Blob(),
	previewUrl: `blob:${id}`
});
const pages = (n: number) => Array.from({ length: n }, (_, i) => page(`p${i}`));

const props = {
	pages: pages(5),
	filename: 'Nájemní smlouva',
	onmove: () => {},
	onremove: () => {},
	onrename: () => {},
	onadd: () => {},
	onmake: () => {},
	oncancel: () => {}
};

describe('defaultFilename', () => {
	it('dates the file, from a timestamp rather than a clock', () => {
		expect(defaultFilename(Date.UTC(2026, 7, 26, 9, 30))).toBe('Scan 2026-08-26');
	});
});

describe('the review screen', () => {
	it('names the state for the FILE, not the page count', () => {
		// "Uploading page 3 of 5" reads as five separate uploads of five separate
		// files. What the work counts toward is one PDF.
		const { body } = render(ScanReview, { props });
		expect(body).toMatch(/combined into one PDF/i);
	});

	it('asks for a name, this being the only moment the user knows what it is', () => {
		const { body } = render(ScanReview, { props });
		expect(body).toContain('Save as');
		expect(body).toContain('Nájemní smlouva');
	});

	it('offers both directions on every tile', () => {
		// Up-only takes four taps on OTHER tiles to move the first page to the
		// end, which is a wrong document one slip away.
		const { body } = render(ScanReview, { props });
		expect((body.match(/Move page \d+ up/g) ?? []).length).toBe(5);
		expect((body.match(/Move page \d+ down/g) ?? []).length).toBe(5);
	});

	it('dims the edge buttons rather than removing them', () => {
		// A control that vanishes shifts the two beside it, so they stop landing
		// where the eye left them.
		const { body } = render(ScanReview, { props });
		expect(body).toMatch(/aria-disabled="true"/);
	});

	it('locks the order once combining starts', () => {
		const { body } = render(ScanReview, { props: { ...props, busy: true } });
		expect(body).toContain('Combining into one PDF');
		expect(body).not.toContain('Move page 1 up');
	});

	it('offers a photo rather than an empty grid when there is nothing yet', () => {
		const { body } = render(ScanReview, { props: { ...props, pages: [] } });
		expect(body).toContain('No pages yet');
		expect(body).toContain('Take a photo');
	});

	it('says what the cap is where the user meets it', () => {
		const { body } = render(ScanReview, { props: { ...props, pages: pages(20) } });
		expect(body).toMatch(/Twenty pages is the most/);
	});

	it('keeps every tile the same box, whatever shape the page is', () => {
		// A landscape page must not make its row taller than the row beside it.
		const source = readFileSync('src/lib/scan/client/ScanReview.svelte', 'utf8');
		expect(source).toContain('aspect-ratio: 3 / 4');
	});

	it('does not reflow to one column on a narrow screen', () => {
		// That recreates the scrolling list this screen exists to replace.
		const source = readFileSync('src/lib/scan/client/ScanReview.svelte', 'utf8');
		expect(source).toMatch(/repeat\(auto-fill, minmax\(\d+px, 1fr\)\)/);
	});
});

describe('assembling the document', () => {
	const flow = readFileSync('src/lib/scan/client/ScanFlow.svelte', 'utf8');

	it('writes one PDF from every kept page, in order', () => {
		expect(flow).toMatch(/session\.pages\.map\(\(page\) => async \(\) => \{/);
	});

	it('decodes pages one at a time rather than all at once', () => {
		// Twenty A4 pages held as frames is about 700 MB, and twenty is the
		// documented cap — a case that will happen, not a theoretical one.
		expect(flow).toContain('bitmap.close()');
		const pdf = readFileSync('src/lib/scan/core/pdf.ts', 'utf8');
		expect(pdf).toMatch(/pages: readonly PageProvider\[\]/);
		expect(pdf).toMatch(/const \{ frame, mode \} = await load\(\);/);
	});

	it('keeps only the encoded page, never the frame', () => {
		const session = readFileSync('src/lib/scan/client/session.svelte.ts', 'utf8');
		expect(session).toMatch(/blob: Blob;/);
		expect(session).not.toMatch(/frame: Frame/);
	});

	it('revokes a page URL when the page goes', () => {
		const session = readFileSync('src/lib/scan/client/session.svelte.ts', 'utf8');
		expect(session).toContain('URL.revokeObjectURL');
	});
});
