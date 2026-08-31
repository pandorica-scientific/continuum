// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { MAX_PAGES, createSession } from '$lib/scan/client/session.svelte';

// The session hands out object URLs for its tiles; node has neither.
vi.stubGlobal('URL', {
	createObjectURL: (blob: Blob) => `blob:${blob.size}-${Math.random()}`,
	revokeObjectURL: vi.fn()
});

const blob = () => new Blob(['x']);

describe('the scan session', () => {
	it('keeps pages in the order they arrived, because that order IS the document', () => {
		const session = createSession();
		session.add('bw', blob());
		session.add('bw', blob());
		session.add('bw', blob());
		const [a, b, c] = session.pages.map((p) => p.id);
		session.move(c, -1);
		expect(session.pages.map((p) => p.id)).toEqual([a, c, b]);
	});

	it('moves the first page to the end in one action', () => {
		// Up-only takes four taps on OTHER tiles to do this.
		const session = createSession();
		session.add('bw', blob());
		session.add('bw', blob());
		const [first] = session.pages.map((p) => p.id);
		session.move(first, 1);
		expect(session.pages[1].id).toBe(first);
	});

	it('leaves an edge move alone rather than wrapping', () => {
		const session = createSession();
		session.add('bw', blob());
		const [only] = session.pages.map((p) => p.id);
		session.move(only, -1);
		session.move(only, 1);
		expect(session.pages.map((p) => p.id)).toEqual([only]);
	});

	it('removes a page and frees its preview', () => {
		const session = createSession();
		session.add('bw', blob());
		session.add('color', blob());
		const [first] = session.pages.map((p) => p.id);
		session.remove(first);
		expect(session.pages.length).toBe(1);
		expect(URL.revokeObjectURL).toHaveBeenCalled();
	});

	it('remembers the mode each page was rendered in', () => {
		// The PDF embeds a bilevel page at one bit per pixel and everything else
		// as JPEG, so the mode has to survive to assembly.
		const session = createSession();
		session.add('bw', blob());
		session.add('original', blob());
		expect(session.pages.map((p) => p.mode)).toEqual(['bw', 'original']);
	});

	it('caps at twenty pages', () => {
		const session = createSession();
		for (let i = 0; i < MAX_PAGES + 5; i++) session.add('bw', blob());
		expect(session.pages.length).toBe(MAX_PAGES);
		expect(session.full).toBe(true);
	});

	it('falls back to the dated name when the user clears the field', () => {
		const session = createSession();
		session.rename('   ');
		expect(session.filename).toMatch(/^Scan \d{4}-\d{2}-\d{2}$/);
	});

	it('keeps a name the user actually typed', () => {
		const session = createSession();
		session.rename('  Nájemní smlouva  ');
		expect(session.filename).toBe('Nájemní smlouva');
	});

	it('frees every preview on dispose', () => {
		const session = createSession();
		session.add('bw', blob());
		session.add('bw', blob());
		session.dispose();
		expect(session.pages).toEqual([]);
	});
});
