// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BANK_SEED } from '$lib/banks';

let dir: string;
let logos: typeof import('$lib/server/banks/logos');

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), 'bank-logos-'));
	writeFileSync(join(dir, 'ing.webp'), 'not really a webp, but it is present');
	process.env.BANK_LOGOS_DIR = dir;
	logos = await import('$lib/server/banks/logos');
	logos.forgetLogos();
});

afterAll(() => {
	delete process.env.BANK_LOGOS_DIR;
	rmSync(dir, { recursive: true, force: true });
});

describe('bank logos on disk', () => {
	it('finds a logo that is there and reports none for a bank without one', () => {
		// The ordinary case is "none": this repository ships no logos, and every
		// bank falls back to its emoji.
		expect(logos.hasLogo('ing')).toBe(true);
		expect(logos.hasLogo('n26')).toBe(false);
	});

	it('serves the bytes of a logo that exists', async () => {
		expect(await logos.bankLogo('ing')).not.toBeNull();
		expect(await logos.bankLogo('n26')).toBeNull();
	});

	it('refuses a key that could climb out of the directory', async () => {
		// The key reaches a path, so its shape is checked rather than trusted —
		// same lesson as /files/[name] and the place engravings.
		for (const bad of ['../secret', 'a/b', '/etc/passwd', '..', 'UPPER', '-leading']) {
			expect(logos.hasLogo(bad)).toBe(false);
			expect(await logos.bankLogo(bad)).toBeNull();
		}
	});
});

describe('the seeded banks', () => {
	it('gives every bank a key the logo loader would accept', () => {
		// A seed whose key the loader rejects could never show a logo, and the
		// failure would be silent.
		for (const seed of BANK_SEED) {
			expect(/^[a-z0-9][a-z0-9-]{0,60}$/.test(seed.key), seed.key).toBe(true);
		}
	});

	it('has no duplicate keys, and keeps Other as the fallback', () => {
		const keys = BANK_SEED.map((b) => b.key);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys).toContain('other');
	});

	it('gives every bank a label and an emoji to fall back to', () => {
		for (const seed of BANK_SEED) {
			expect(seed.label.length, seed.key).toBeGreaterThan(0);
			expect(seed.emoji.length, seed.key).toBeGreaterThan(0);
		}
	});
});
