// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The rules behind the readiness line.
 *
 * The failure that matters here is a FALSE GREEN: somebody reads "ready",
 * packs, and is turned round at a border. So most of these assert that the app
 * refuses to reassure — a missing passport, an unknown visa pair and an undated
 * document are all grey, never green.
 */
import { describe, expect, it } from 'vitest';
import {
	MONTHS_OF_VALIDITY_REQUIRED,
	PASSPORT_HUE,
	VISA_HUE,
	addMonths,
	passportStatus,
	readinessWord,
	worstOf
} from '$lib/life/readiness';

describe('adding months to a day', () => {
	it('lands on the same day of the month', () => {
		expect(addMonths('2026-06-08', 6)).toBe('2026-12-08');
	});

	it('crosses a year', () => {
		expect(addMonths('2026-10-12', 6)).toBe('2027-04-12');
	});

	// 31 August plus six months is the end of February, never the 3rd of March.
	it('clamps to the end of a shorter month', () => {
		expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
		expect(addMonths('2027-08-31', 6)).toBe('2028-02-29');
	});
});

describe('a passport, for one trip', () => {
	const returns = '2026-06-08';
	const sixMonthsLater = addMonths(returns, MONTHS_OF_VALIDITY_REQUIRED);

	it('is valid with more than six months left after coming home', () => {
		expect(passportStatus({ expiresOn: '2028-01-01' }, returns)).toBe('valid');
	});

	it('is valid on the exact six-month boundary', () => {
		expect(passportStatus({ expiresOn: sixMonthsLater }, returns)).toBe('valid');
	});

	// The case the whole rule exists for: valid on the day, and refused anyway.
	it('is expiring one day inside the six-month window', () => {
		const dayBefore = '2026-12-07';
		expect(dayBefore < sixMonthsLater).toBe(true);
		expect(passportStatus({ expiresOn: dayBefore }, returns)).toBe('expiring');
	});

	it('is expiring when it runs out the day after coming home', () => {
		expect(passportStatus({ expiresOn: '2026-06-09' }, returns)).toBe('expiring');
	});

	it('has expired when it runs out the day before coming home', () => {
		expect(passportStatus({ expiresOn: '2026-06-07' }, returns)).toBe('expired');
	});

	it('has expired when it ran out years ago', () => {
		expect(passportStatus({ expiresOn: '2019-01-01' }, returns)).toBe('expired');
	});

	it('is missing, not valid, when there is none on file', () => {
		expect(passportStatus(null, returns)).toBe('missing');
		expect(passportStatus(undefined, returns)).toBe('missing');
	});

	it('is unknown, not valid, when the expiry was never typed in', () => {
		expect(passportStatus({ expiresOn: null }, returns)).toBe('unknown');
	});
});

describe('what a state is coloured', () => {
	it('never reports an absence as good news', () => {
		expect(PASSPORT_HUE.missing).toBe('grey');
		expect(PASSPORT_HUE.unknown).toBe('grey');
		expect(VISA_HUE.unknown).toBe('grey');
	});

	it('keeps the traffic light meaning what it means', () => {
		expect(PASSPORT_HUE.valid).toBe('green');
		expect(PASSPORT_HUE.expiring).toBe('yellow');
		expect(PASSPORT_HUE.expired).toBe('red');
		expect(VISA_HUE['visa-free']).toBe('green');
		expect(VISA_HUE.required).toBe('red');
	});

	// A visa you can get at the desk is not a problem and not nothing.
	it('treats a visa you can still get as a watch, not a failure', () => {
		expect(VISA_HUE['on-arrival']).toBe('yellow');
		expect(VISA_HUE['e-visa']).toBe('yellow');
	});
});

describe('the worst thing on the line', () => {
	const ready = { passport: 'valid' as const, visas: [{ country: 'PT', position: 'visa-free' as const }] };

	it('is green when everyone is ready', () => {
		expect(worstOf([ready, ready])).toBe('green');
	});

	it('takes the worst of two people', () => {
		const expired = { passport: 'expired' as const, visas: [] };
		expect(worstOf([ready, expired])).toBe('red');
	});

	it('takes the worst across a trip’s destinations', () => {
		const twoStops = {
			passport: 'valid' as const,
			visas: [
				{ country: 'PT', position: 'visa-free' as const },
				{ country: 'RU', position: 'required' as const }
			]
		};
		expect(worstOf([twoStops])).toBe('red');
	});

	// Unknown outranks green, so a trip nobody has checked never reads "Ready".
	it('reports not knowing rather than reporting ready', () => {
		const unchecked = { passport: 'missing' as const, visas: [] };
		expect(worstOf([ready, unchecked])).toBe('grey');
		expect(readinessWord(worstOf([ready, unchecked]))).toBe('Unchecked');
	});

	it('lets a real problem outrank not knowing', () => {
		const unchecked = { passport: 'missing' as const, visas: [] };
		const expiring = { passport: 'expiring' as const, visas: [] };
		expect(worstOf([unchecked, expiring])).toBe('yellow');
	});

	it('has nothing to say about a trip with nobody on it', () => {
		expect(worstOf([])).toBe('green');
	});
});
