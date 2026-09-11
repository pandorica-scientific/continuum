// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The visa table, and the one thing it must never do.
 *
 * It must never answer "visa-free" for a pair nobody checked. The cost of a
 * wrong "you need a visa" is five minutes; the cost of a wrong "you do not" is
 * somebody turned round at a border.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isCoveredPassport, visaCaption, visaPosition, VISA_AS_OF } from '$lib/life/visa';
import { COVERED_PASSPORTS, VISA_TABLE } from '$lib/life/visa/table';
import { VISA_HUE } from '$lib/life/readiness';

describe('looking a pair up', () => {
	it('knows the ones this household actually travels on', () => {
		expect(visaPosition('CZ', 'PT')).toBe('visa-free');
		expect(visaPosition('CZ', 'HR')).toBe('visa-free');
		expect(visaPosition('PL', 'ES')).toBe('visa-free');
		expect(visaPosition('CZ', 'JP')).toBe('visa-free');
	});

	it('knows where a visa is actually needed', () => {
		expect(visaPosition('CZ', 'RU')).toBe('required');
		expect(visaPosition('CZ', 'CN')).toBe('required');
	});

	it('separates one you can get at the desk from one you apply for', () => {
		expect(visaPosition('CZ', 'EG')).toBe('on-arrival');
		expect(visaPosition('CZ', 'AU')).toBe('e-visa');
	});

	it('lets anyone home without a table entry', () => {
		expect(visaPosition('CZ', 'CZ')).toBe('visa-free');
		expect(visaPosition('ZZ', 'ZZ')).toBe('visa-free');
	});

	// The load-bearing one.
	it('says it does not know rather than saying visa-free', () => {
		// A destination the table does not list.
		expect(visaPosition('CZ', 'MN')).toBe('unknown');
		// A passport the table has never been checked for.
		expect(visaPosition('BR', 'PT')).toBe('unknown');
	});

	it('refuses anything that is not two letters', () => {
		expect(visaPosition('', 'PT')).toBe('unknown');
		expect(visaPosition('CZE', 'PT')).toBe('unknown');
		expect(visaPosition('CZ', 'Portugal')).toBe('unknown');
	});

	it('does not care about case or stray spaces', () => {
		expect(visaPosition('cz', ' pt ')).toBe('visa-free');
	});

	it('never colours a gap green', () => {
		expect(VISA_HUE[visaPosition('CZ', 'MN')]).toBe('grey');
		expect(VISA_HUE[visaPosition('BR', 'PT')]).toBe('grey');
	});
});

describe('the table itself', () => {
	it('covers every passport it claims to', () => {
		for (const passport of COVERED_PASSPORTS) {
			expect(VISA_TABLE[passport], passport).toBeDefined();
		}
		expect(Object.keys(VISA_TABLE).sort()).toEqual([...COVERED_PASSPORTS].sort());
	});

	it('agrees with `isCoveredPassport`', () => {
		expect(isCoveredPassport('cz')).toBe(true);
		expect(isCoveredPassport('BR')).toBe(false);
	});

	it('uses only ISO 3166-1 alpha-2 codes, upper case', () => {
		for (const [passport, destinations] of Object.entries(VISA_TABLE)) {
			expect(passport, passport).toMatch(/^[A-Z]{2}$/);
			for (const destination of Object.keys(destinations)) {
				expect(destination, `${passport} → ${destination}`).toMatch(/^[A-Z]{2}$/);
			}
		}
	});

	it('gives every entry one of the four positions', () => {
		const allowed = ['visa-free', 'on-arrival', 'e-visa', 'required'];
		for (const destinations of Object.values(VISA_TABLE)) {
			for (const [destination, position] of Object.entries(destinations)) {
				expect(allowed, destination).toContain(position);
			}
		}
	});

	it('never lists a passport as needing a visa for its own country', () => {
		for (const [passport, destinations] of Object.entries(VISA_TABLE)) {
			if (destinations[passport]) expect(destinations[passport]).toBe('visa-free');
		}
	});
});

describe('saying how old the answer is', () => {
	it('states a real ISO day', () => {
		expect(VISA_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(Number.isNaN(Date.parse(VISA_AS_OF))).toBe(false);
	});

	it('builds the caption from that constant, not from a template', () => {
		expect(visaCaption()).toContain('check before you travel');
		const year = VISA_AS_OF.slice(0, 4);
		expect(visaCaption()).toContain(year);
	});

	// A date written into a component drifts from the date the table was last
	// read, and then the app is confidently stating a freshness it does not have.
	it('is written in one place', () => {
		const sources = ['src/lib/life/visa/index.ts', 'src/lib/life/trips/Readiness.svelte'];
		for (const path of sources) {
			let source: string;
			try {
				source = readFileSync(path, 'utf8');
			} catch {
				continue;
			}
			expect(source, path).not.toMatch(/Visa data as of \d/);
		}
	});
});
