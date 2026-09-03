// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Seven template names, four engines.
 *
 * A template is what a household picks when it makes a shelf; an engine is the
 * component that draws one. `timeline`, `kit` and `obligations` are the dossier
 * with a different start — which lanes a new card is seeded with, and which way
 * its history reads.
 *
 * Nothing about a preset REMOVES a part. A card on a `timeline` shelf that
 * gains a yearly lane draws its cells, and a `kit` card that collects letters
 * draws a history. The preset decides what a card begins with, never what it
 * may become, for the same reason `shelf_type` decides what the type filter
 * offers first and not what the shelf will accept.
 *
 * This replaces `src/lib/shelf-profiles.ts`, which keyed the same knowledge by
 * shelf and so had nothing to say about a shelf somebody made.
 */
import type { EnumValue } from '$lib/enums';

export type ShelfTemplate = EnumValue<'shelf.template'>;
export type ShelfUnit = EnumValue<'shelf.unit'>;
export type LaneCadence = EnumValue<'lane.cadence'>;

/** The four components that draw a shelf. */
export type ShelfEngine = 'queue' | 'wallet' | 'completeness' | 'dossier';

/** What a new card on a shelf starts with. Stored on `shelf.lane_seeds`. */
export interface LaneSeed {
	label: string;
	cadence: LaneCadence;
	/** For `yearly`: a cell every N years. 1 for every other cadence. */
	every: number;
}

export interface TemplateDefaults {
	laneSeeds: LaneSeed[];
	/** Which way a card's rhythm-less paper reads. */
	historyOrder: 'newest' | 'oldest';
}

/** What each template is called where a person picks it. */
export const TEMPLATE_LABELS: Record<ShelfTemplate, string> = {
	queue: 'Queue',
	wallet: 'Wallet',
	completeness: 'Completeness',
	dossier: 'Dossier',
	timeline: 'Timeline',
	kit: 'Kit',
	obligations: 'Obligations'
};

/**
 * What each ENGINE is called where a person switches away from it.
 *
 * Four rather than seven, because the switch names what is on screen: a `kit`
 * shelf and an `obligations` shelf both draw a dossier, and offering "Kit" as
 * the alternative to "List" would name a preset the screen is not showing.
 */
export const ENGINE_LABELS: Record<ShelfEngine, string> = {
	queue: 'Queue',
	wallet: 'Wallet',
	completeness: 'Completeness',
	dossier: 'Cards'
};

/** One line under each name in the shelf dialog, so the choice is informed. */
export const TEMPLATE_BLURBS: Record<ShelfTemplate, string> = {
	queue: 'One document at a time, until nothing is left.',
	wallet: 'A card per document, by whose it is.',
	completeness: 'A band per account, across the year.',
	dossier: 'A card per counterparty, with what it owes you.',
	timeline: 'A card per person or thing, in the order it happened.',
	kit: 'A card per thing, with its receipt, warranty and manual.',
	obligations: 'A card per thing, with what falls due and when.'
};

export function templateEngine(template: ShelfTemplate): ShelfEngine {
	switch (template) {
		case 'queue':
		case 'wallet':
		case 'completeness':
			return template;
		default:
			return 'dossier';
	}
}

export function templateDefaults(template: ShelfTemplate): TemplateDefaults {
	switch (template) {
		case 'kit':
			// One object's paperwork. The missing manual is the finding, which is
			// why all three draw whether or not anything is filed in them.
			return {
				laneSeeds: [
					{ label: 'Receipt', cadence: 'once', every: 1 },
					{ label: 'Warranty', cadence: 'once', every: 1 },
					{ label: 'Manual', cadence: 'once', every: 1 }
				],
				historyOrder: 'newest'
			};
		case 'timeline':
			// Read forwards: the previous result is the context for the current one.
			return { laneSeeds: [], historyOrder: 'oldest' };
		case 'obligations':
			// The one duty every insured thing has. A shelf that needs more says so
			// on its own row — Vehicles seeds three — and a card takes whatever the
			// household adds to it afterwards.
			return {
				laneSeeds: [{ label: 'Insurance', cadence: 'yearly', every: 1 }],
				historyOrder: 'newest'
			};
		default:
			return { laneSeeds: [], historyOrder: 'newest' };
	}
}

/**
 * Which units a template can be organised by; the shelf dialog offers these.
 *
 * The three fixed engines take exactly one unit because each was built for it:
 * a wallet card is a person's document, a ribbon row is an account's year, and
 * the Inbox is organised by the paper itself because nothing about it is
 * decided yet. The dossier takes any of the four that can hold a card.
 */
export function unitsForTemplate(template: ShelfTemplate): ShelfUnit[] {
	switch (templateEngine(template)) {
		case 'queue':
			return ['document'];
		case 'wallet':
			return ['person'];
		case 'completeness':
			return ['account'];
		case 'dossier':
			return ['organisation', 'property', 'subject', 'person'];
	}
}

/** Whether a card on this unit is made from the Documents screen at all. */
export function unitMakesCards(unit: ShelfUnit): boolean {
	// People, accounts and properties have screens of their own, and a card for
	// each already exists the moment the record does. Only these two are made
	// here, which is also why only these two carry a home shelf.
	return unit === 'subject' || unit === 'organisation';
}
