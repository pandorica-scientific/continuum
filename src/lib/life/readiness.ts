// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Whether the people going on a trip can actually get in.
 *
 * Two questions, kept apart because they fail differently: does this person
 * hold a passport that will still be valid, and does that passport need a visa
 * for where they are going.
 *
 * The whole module is pure and takes today as an argument. A readiness screen
 * that reads the clock itself cannot be tested for the day before an expiry,
 * which is the only day that matters.
 */

/**
 * How much validity a passport needs beyond the day somebody comes home.
 *
 * Six months is the near-universal entry requirement — it is what the Schengen
 * area, the United States, most of Asia and most of Africa ask for. It is a
 * rule about the world rather than a preference, so it is a constant with a
 * comment rather than a setting nobody would know how to answer.
 *
 * A household that genuinely needs a different number changes it here, in one
 * place, which is the whole reason it is named.
 */
export const MONTHS_OF_VALIDITY_REQUIRED = 6;

export type PassportState =
	/** Valid for the whole trip and six months past it. */
	| 'valid'
	/** Valid on the day they come home, but not six months past it. */
	| 'expiring'
	/** Expires before they come home, or already has. */
	| 'expired'
	/** No passport on file for this person. NOT the same as valid. */
	| 'missing'
	/** A passport on file with no expiry date typed in. */
	| 'unknown';

export interface PassportRecord {
	/** ISO day. Null where the household filed the document without one. */
	expiresOn: string | null;
}

/** Add whole months to an ISO day, clamping at the end of a short month. */
export function addMonths(iso: string, months: number): string {
	const [year, month, day] = iso.split('-').map(Number);
	const target = new Date(Date.UTC(year, month - 1 + months, 1));
	// 31 August plus six months is 28 or 29 February, never 3 March.
	const lastDay = new Date(
		Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
	).getUTCDate();
	target.setUTCDate(Math.min(day, lastDay));
	return target.toISOString().slice(0, 10);
}

/**
 * What a passport is worth for one trip.
 *
 * Measured against the day the household comes HOME, not the day it leaves:
 * the border that asks is the one on the way back in, and a passport that
 * expires mid-holiday is a problem the moment the trip is booked.
 */
export function passportStatus(
	passport: PassportRecord | null | undefined,
	returnsOn: string
): PassportState {
	if (!passport) return 'missing';
	if (!passport.expiresOn) return 'unknown';
	if (passport.expiresOn < returnsOn) return 'expired';
	return passport.expiresOn < addMonths(returnsOn, MONTHS_OF_VALIDITY_REQUIRED)
		? 'expiring'
		: 'valid';
}

/** What a person reads on the line. */
export const PASSPORT_WORDING: Record<PassportState, string> = {
	valid: 'Passport valid',
	expiring: `Expires within ${MONTHS_OF_VALIDITY_REQUIRED} months of coming home`,
	expired: 'Passport expires before you are back',
	missing: 'No passport on file',
	unknown: 'Passport on file, no expiry date'
};

/**
 * The traffic light for a passport.
 *
 * `missing` and `unknown` are GREY, not green and not red. The archive not
 * knowing something is not the same as the answer being bad, and a green tick
 * over "we have never seen your passport" is the app making a promise on
 * nobody's behalf.
 */
export const PASSPORT_HUE: Record<PassportState, 'green' | 'yellow' | 'red' | 'grey'> = {
	valid: 'green',
	expiring: 'yellow',
	expired: 'red',
	missing: 'grey',
	unknown: 'grey'
};

export type VisaPosition = 'visa-free' | 'on-arrival' | 'e-visa' | 'required' | 'unknown';

export const VISA_WORDING: Record<VisaPosition, string> = {
	'visa-free': 'Visa-free',
	'on-arrival': 'Visa on arrival',
	'e-visa': 'e-Visa needed',
	required: 'Visa required',
	unknown: 'Look it up'
};

/**
 * The traffic light for a visa position.
 *
 * `unknown` is grey for the same reason `missing` is: the table not covering a
 * pair is a gap in what this app knows, and colouring a gap green would be the
 * worst possible mistake here — somebody arrives at a border on the strength of
 * it.
 */
export const VISA_HUE: Record<VisaPosition, 'green' | 'yellow' | 'red' | 'grey'> = {
	'visa-free': 'green',
	'on-arrival': 'yellow',
	'e-visa': 'yellow',
	required: 'red',
	unknown: 'grey'
};

export interface Readiness {
	passport: PassportState;
	/** One per destination country, in the trip's own order. */
	visas: { country: string; position: VisaPosition }[];
}

/**
 * The worst thing on the line, which is what a pill on a trip row says.
 *
 * Red beats yellow beats grey beats green. Grey outranks green deliberately:
 * "we do not know" must not be reported as "everyone is ready".
 */
export function worstOf(readiness: Readiness[]): 'green' | 'yellow' | 'red' | 'grey' {
	const order = { red: 3, yellow: 2, grey: 1, green: 0 } as const;
	let worst: 'green' | 'yellow' | 'red' | 'grey' = 'green';
	const consider = (hue: 'green' | 'yellow' | 'red' | 'grey') => {
		if (order[hue] > order[worst]) worst = hue;
	};
	for (const person of readiness) {
		consider(PASSPORT_HUE[person.passport]);
		for (const visa of person.visas) consider(VISA_HUE[visa.position]);
	}
	return worst;
}

/** The one-word summary beside that pill. */
export function readinessWord(hue: 'green' | 'yellow' | 'red' | 'grey'): string {
	return { green: 'Ready', yellow: 'Needs a look', red: 'Not ready', grey: 'Unchecked' }[hue];
}
