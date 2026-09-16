// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The one door to the three artwork generators — nothing outside this file
 * imports `stamps/`, `dishes/` or `bottles/` directly.
 *
 * Two rules: (1) artwork is resolved once and stored as a definition, so
 * renaming a trip/idea/recipe or upgrading a generator does not repaint
 * history — `resolve*` runs at creation, `render*` every time after.
 * (2) Colour comes from a token, never a hex: a stamp is rendered with a
 * sentinel swapped for `currentColor` so the surrounding element can theme it.
 */
import { createStamp, destinations, renderStamp, symbols } from './stamps/index.mjs';
import { createRecipeArtwork, renderRecipeDefinition } from './dishes/index.mjs';
import { bottles, renderBottle } from './bottles/index.mjs';
import type { EnumValue } from '$lib/enums';
import { COUNTRY_PALETTE, countryColour, type CountryColour } from '$lib/life/geo/country-colour';
import { COUNTRY_COLOURS } from '$lib/life/geo/country-colour-table';

/**
 * The colour handed to the stamp generator, then swapped back out.
 * Any six-digit hex works — it is the only hex the generator emits, which
 * makes the later swap to `currentColor` total. Never seen by a user.
 */
const INK_SENTINEL = '#010203';

/** What a row stores in its `art` column. Shape belongs to the generator. */
export type ArtDefinition = Record<string, unknown>;

/**
 * Anything that could execute, or fetch, if this markup were inlined.
 *
 * The generated SVG is the one place in this product that reaches `{@html}`,
 * and it prints household-supplied text (a trip name), so the input is not
 * entirely machine-made. Checked rather than trusted: generators claim to
 * escape their text, but the cost of checking is a regex.
 */
const DANGEROUS = [
	/<\s*script/i,
	/<\s*foreignObject/i,
	/<\s*(iframe|embed|object|use|image|link|style)\b/i,
	// on-anything handlers, and any URL scheme that is not a plain fragment.
	/\son[a-z]+\s*=/i,
	/(?:href|xlink:href|src)\s*=\s*["']?(?!#)/i,
	/javascript:/i,
	/data:(?!image\/(?:png|jpeg|webp);base64,)/i
];

/**
 * Assert that a generated drawing is inert, and hand it back.
 *
 * Throws rather than sanitising: a drawing carrying a script is a broken
 * generator, and quietly stripping it would hide that for months.
 */
export function assertInertSvg(svg: string): string {
	for (const pattern of DANGEROUS) {
		if (pattern.test(svg)) {
			throw new Error(`generated artwork is not inert: matched ${pattern}`);
		}
	}
	return svg;
}

/** Swap the sentinel for `currentColor`, and prove none of it is left. */
function inkFromContext(svg: string): string {
	const painted = svg.replaceAll(INK_SENTINEL, 'currentColor');
	// Catch a generator emitting a second colour — it would be wrong in one theme.
	if (/#[0-9a-f]{3,8}/i.test(painted)) {
		throw new Error('stamp artwork carries a colour literal the theme cannot override');
	}
	return assertInertSvg(painted);
}

// ---- Trip stamps ----

export interface StampSubject {
	/** The trip or idea's name, which is the label on the stamp. */
	name: string;
	/** ISO 3166-1 alpha-2 of where it goes, when that is known. */
	country?: string | null;
	/** A city, when the trip names one: a known city gets its own landmark. */
	city?: string | null;
}

/** The 17 symbols the library marks as suitable for anywhere, sorted for stable ordering. */
const ANYWHERE = Object.entries(symbols)
	.filter(([, symbol]) => (symbol as { universal?: boolean }).universal)
	.map(([id]) => id)
	.sort();

/** A small stable number from a string. Not security, just repeatability. */
function hash(text: string): number {
	let value = 0;
	for (const character of text) value = (value * 31 + character.codePointAt(0)!) >>> 0;
	return value;
}

/**
 * Find a place the library has a drawing for, named inside free text (e.g.
 * "Lisbon again"). Matching is scoped to the idea's own country so it doesn't
 * match a same-named town elsewhere.
 */
function knownPlaceIn(text: string, country: string | null | undefined): string | null {
	if (!country) return null;
	const haystack = text.toLowerCase();
	const candidates = destinations
		.filter((destination) => destination.country === country.toUpperCase())
		// Longest first: "San Sebastián" before "San", so the better match wins.
		.sort((a, b) => b.name.length - a.name.length);
	for (const candidate of candidates) {
		if (haystack.includes(candidate.name.toLowerCase())) return candidate.name;
	}
	return null;
}

/**
 * Decide a stamp once, at the moment a trip or an idea is created.
 *
 * Tries, in order: the record's own city; a place named inside the text
 * (scoped to its country); then a go-anywhere symbol chosen from the name.
 * The library's own fallback is a single map-pin symbol for everything, which
 * reads as failed artwork on a board of several ideas — hence the fallback here.
 */
export interface StampChoice {
	/**
	 * A new seed gives the same place a different composition — border, layout,
	 * ink and motif — while keeping its symbol. This is "try another".
	 */
	seed?: number;
	/** An explicit symbol, chosen by the household over whatever was picked. */
	icon?: string;
}

export function resolveStamp(subject: StampSubject, choice: StampChoice = {}): ArtDefinition {
	const city = subject.city?.trim();
	const lookup = city || knownPlaceIn(subject.name, subject.country);

	const { definition } = createStamp({
		name: lookup || subject.name,
		country: subject.country ?? undefined,
		color: INK_SENTINEL,
		...(choice.seed === undefined ? {} : { seed: choice.seed }),
		// An explicit choice wins; otherwise only fall back to a symbol when
		// nothing was recognised — the library's own match is better than ours.
		...(choice.icon
			? { icon: choice.icon }
			: lookup
				? {}
				: { icon: ANYWHERE[hash(subject.name) % ANYWHERE.length] ?? undefined })
	});
	return { ...definition, name: subject.name } as ArtDefinition;
}

/** A symbol the household can pick, for the customise row in the dialogs. */
export interface SymbolChoice {
	id: string;
	label: string;
}

/**
 * What to offer when somebody wants a different picture: the place's own
 * landmark first, then the go-anywhere symbols. Not the library's full ~150 —
 * the household is choosing a stamp, not shopping a catalogue.
 */
export function stampSymbolChoices(subject: StampSubject): SymbolChoice[] {
	const label = (id: string): string =>
		(symbols as Record<string, { label?: string }>)[id]?.label ?? id;

	const city = subject.city?.trim();
	const lookup = city || knownPlaceIn(subject.name, subject.country);
	const own = lookup
		? destinations.find(
				(destination) =>
					destination.name.toLowerCase() === lookup.toLowerCase() &&
					(!subject.country || destination.country === subject.country.toUpperCase())
			)?.icon
		: undefined;

	const ids = own ? [own, ...ANYWHERE.filter((id) => id !== own)] : [...ANYWHERE];
	return ids.map((id) => ({ id, label: label(id) }));
}

/**
 * Read a definition posted back from the browser and refuse anything strange.
 * Client-controlled input: accepted only if it renders (which also runs the
 * inertness check), otherwise the caller resolves a fresh one server-side.
 */
export function parseStoredStamp(raw: unknown): ArtDefinition | null {
	if (typeof raw !== 'string' || raw.trim() === '') return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		stampSvg(parsed as ArtDefinition);
		return parsed as ArtDefinition;
	} catch {
		return null;
	}
}

/** Draw a stored stamp. Colour comes from the element around it. */
export const stampSvg = (art: ArtDefinition): string =>
	inkFromContext(renderStamp({ ...art, color: INK_SENTINEL } as never));

/**
 * The hue a stamp is inked in: the destination country's own map colour,
 * ties the stamp wall to the map. With no country, falls back to a colour
 * hashed from the name, so every stamp still gets one of its own.
 */
export const stampHue = (
	country: string | null | undefined,
	fallbackFrom = ''
): CountryColour | null => {
	if (country) return countryColour(country, COUNTRY_COLOURS);
	if (!fallbackFrom.trim()) return null;
	return COUNTRY_PALETTE[hash(fallbackFrom) % COUNTRY_PALETTE.length];
};

// ---- Recipe artwork ----

export interface DishSubject {
	name: string;
	/** The rail's category, which steers the choice when the title is vague. */
	category?: string | null;
	/** Ingredient names, not rows: the library reads words. */
	ingredients?: string[];
}

export function resolveDish(subject: DishSubject): ArtDefinition {
	const { definition } = createRecipeArtwork({
		title: subject.name,
		category: subject.category ?? undefined,
		ingredients: subject.ingredients ?? []
	});
	return definition as ArtDefinition;
}

/** Draw a stored dish. Already `currentColor`; only inertness to check. */
export const dishSvg = (art: ArtDefinition): string =>
	assertInertSvg(renderRecipeDefinition(art as never));

// ---- Bottle silhouettes ----

/**
 * Which drawing each type of bottle gets. Ten types share eight silhouettes
 * by actual glass shape (bourbon/whisky share a squat bottle, rum/cognac a
 * decanter); `wine` defaults to Bordeaux as the most common wine bottle shape.
 */
const SILHOUETTE: Record<EnumValue<'bottle.type'>, keyof typeof bottles> = {
	wine: 'bordeaux',
	champagne: 'champagne',
	whisky: 'whisky',
	bourbon: 'whisky',
	gin: 'gin',
	rum: 'cognac',
	beer: 'beer',
	liqueur: 'riesling',
	cognac: 'cognac',
	other: 'bordeaux'
};

export interface BottleSubject {
	id: string;
	type: EnumValue<'bottle.type'>;
	producer: string;
	name: string;
	vintage?: number | null;
}

/**
 * Draw a bottle. No definition to store: the silhouette follows the type.
 *
 * Deliberately without the label photograph — `assertInertSvg` refuses
 * `<image>`/non-fragment `href`, so it must be overlaid as a plain `<img>`
 * instead (see `BottleArt.svelte`, `bottleLabelBox`).
 *
 * `idPrefix` is the row's own id, since the SVG defines gradients/clip paths
 * by id and a grid of bottles would otherwise collide on the same ids.
 */
export function bottleSvg(subject: BottleSubject, width = 400): string {
	return renderBottle({
		type: SILHOUETTE[subject.type] ?? 'bordeaux',
		title: [subject.producer, subject.name].filter(Boolean).join(' '),
		width,
		idPrefix: `bottle-${subject.id.replaceAll(/[^a-zA-Z0-9-]/g, '')}`
	});
}

/**
 * Where the label plate sits on a silhouette, as percentages of the drawing
 * (the library's box is in its 400 × 160 viewBox; the overlay doesn't know
 * the SVG's rendered pixel size).
 */
export function bottleLabelBox(type: EnumValue<'bottle.type'>): {
	left: string;
	top: string;
	width: string;
	height: string;
} {
	const shape = bottles[SILHOUETTE[type] ?? 'bordeaux'];
	const box = shape.labelBox;
	const pct = (value: number, of: number) => `${(value / of) * 100}%`;
	return {
		left: pct(box.x, VIEWBOX_WIDTH),
		top: pct(box.y, VIEWBOX_HEIGHT),
		width: pct(box.width, VIEWBOX_WIDTH),
		height: pct(box.height, VIEWBOX_HEIGHT)
	};
}

/** The viewBox every silhouette is drawn in. The library's own contract. */
const VIEWBOX_WIDTH = 400;
const VIEWBOX_HEIGHT = 160;

/** The aspect the drawing holds, for a box an overlay can be measured against. */
export const BOTTLE_ASPECT = `${VIEWBOX_WIDTH} / ${VIEWBOX_HEIGHT}`;

/** The initials shown on the label plate until a photograph replaces it. */
export function labelInitials(producer: string, name: string): string {
	const source = producer.trim() || name.trim();
	const words = source.split(/\s+/).filter(Boolean);
	if (words.length === 0) return '';
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return words
		.slice(0, 2)
		.map((word) => word[0])
		.join('')
		.toUpperCase();
}
