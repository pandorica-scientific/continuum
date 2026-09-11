// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The one door to the three artwork generators.
 *
 * Nothing outside this file imports `stamps/`, `dishes/` or `bottles/`
 * directly, so the vendored libraries can be replaced without a search across
 * the screens that draw their output.
 *
 * ## Two rules, and they are the whole point
 *
 * **1. Artwork is resolved once and stored as a definition.** A trip, an idea
 * and a recipe each carry an `art` column holding what the generator decided.
 * Rendering afterwards reproduces that decision. Renaming a recipe therefore
 * does not silently repaint it, and upgrading one of these libraries does not
 * repaint the household's history. `resolve*` is for the moment a row is
 * created; `render*` is for every time afterwards.
 *
 * **2. Colour comes from a token, never from a hex.** The stamp generator bakes
 * the colour it is given into the SVG, which would be a hard-coded value that
 * is wrong in one of the two themes. So a stamp is rendered with a sentinel
 * that is swapped for `currentColor`, and the element around it sets
 * `color: var(--series-…)`. The dish library already emits `currentColor` and
 * needs none of this.
 */
import { createStamp, destinations, renderStamp, symbols } from './stamps/index.mjs';
import { createRecipeArtwork, renderRecipeDefinition } from './dishes/index.mjs';
import { bottles, renderBottle } from './bottles/index.mjs';
import type { EnumValue } from '$lib/enums';
import { COUNTRY_PALETTE, countryColour, type CountryColour } from '$lib/life/geo/country-colour';
import { COUNTRY_COLOURS } from '$lib/life/geo/country-colour-table';

/**
 * The colour handed to the stamp generator, and immediately taken back out.
 *
 * Any six-digit hex works — the generator puts the colour it is given in the
 * SVG and nowhere else, and it is the only hex in the output, which is what
 * makes the swap total rather than a best effort. This value is never seen.
 */
const INK_SENTINEL = '#010203';

/** What a row stores in its `art` column. Shape belongs to the generator. */
export type ArtDefinition = Record<string, unknown>;

/**
 * Anything that could execute, or fetch, if this markup were inlined.
 *
 * The generated SVG is the one place in this product that reaches `{@html}`,
 * and `src/lib/icons.ts` is explicit about why the icon set avoids it: "a typo
 * in a path cannot inject anything". Here the household's own trip name is
 * printed inside the drawing, so the input is not entirely machine-made.
 *
 * The generators escape the text they insert. This does not take their word for
 * it. Checked rather than trusted, because the cost of checking is a regex and
 * the cost of being wrong is script running on the page.
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
	// A generator that started emitting a second colour would otherwise ship a
	// hex that is wrong in one theme, and nobody would see it until a screenshot.
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

/**
 * The 17 symbols the library marks as suitable for anywhere.
 *
 * Sorted, so the choice below is stable whatever order the library happens to
 * enumerate its symbols in.
 */
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
 * Find a place the library has a drawing for, named inside free text.
 *
 * A household calls an idea "Lisbon again" or "Kyoto in the autumn", not
 * "Lisbon" — so looking the whole string up finds nothing and every card falls
 * back to the same marker. Matching within the country the idea already names
 * keeps that from reaching for a same-named town on another continent.
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
 * Three goes at finding the right drawing, in order of how much it knows:
 *
 * 1. The **city**, when the record names one. A trip called "A week off" to
 *    Porto gets Porto's bridge rather than a generic marker.
 * 2. A **place named inside the text**, matched within the country the record
 *    already carries. This is what turns "Lisbon again" into Lisbon's tram.
 * 3. Failing both, one of the library's seventeen go-anywhere symbols, chosen
 *    from the name itself. The library's own fallback is the map pin every
 *    time, so a board of four ideas came out as four identical pins — which
 *    reads as artwork that failed rather than as artwork standing in.
 *
 * The label always stays whatever the household called it. The artwork is the
 * place's; the words are theirs.
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
		// An explicit choice wins. Failing that, only when nothing was
		// recognised: the library's own pick is the better one when it has made a
		// real match, and the worse one when it has not — its fallback is the map
		// pin every time.
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
 * What to offer when somebody wants a different picture.
 *
 * The place's own landmark first, where the library has one — that is the
 * drawing somebody would actually want — then the seventeen symbols marked
 * suitable for anywhere. Not all 150: a grid of every symbol in the library is
 * a catalogue, and the household is choosing a stamp rather than shopping.
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
 * Read a definition that came in on a form, and refuse anything strange.
 *
 * The dialogs draw the stamp in the browser and post back what was previewed,
 * so what arrives is client-controlled. It is accepted only if it renders —
 * which also runs the inertness check — and otherwise the caller resolves one
 * server-side instead. A household never sees a failure here; it sees the
 * stamp the app would have chosen anyway.
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
 * The hue a stamp is inked in.
 *
 * Its destination country's own colour on the map, which is what ties the stamp
 * wall to the map: a trip to Portugal and Portugal itself are the same colour,
 * and you notice that without being told.
 *
 * Where there is no country — an idea called "somewhere hot", a trip nobody has
 * pinned down — the colour comes from the name instead, so every stamp still
 * has one of its own. A wall of identically inked stamps reads as a list; a
 * wall of differently inked ones reads as a collection, which is what it is.
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
 * Which drawing each type of bottle gets.
 *
 * Ten types, eight silhouettes, so three pairs share one. That is a statement
 * about glass rather than a shortcut: a bourbon and a whisky come in the same
 * squat bottle, a rum and a cognac in the same decanter. `wine` takes the
 * Bordeaux shape because it is the one most wine is actually sold in — a
 * household that wants the Burgundy slope is asking for a wine-style field,
 * which the cellar deliberately does not have.
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
	/** A cropped label photograph on the data volume, as `/files/[name]`. */
	labelPhoto?: string | null;
}

/**
 * Draw a bottle. There is no definition to store: the silhouette follows the
 * type, so the drawing is a function of the row rather than a decision about it.
 *
 * `idPrefix` is the row's own id, because the SVG defines gradients and clip
 * paths by id and a grid of twenty bottles on one page would otherwise have
 * twenty elements all called `bottle-1`.
 */
export function bottleSvg(subject: BottleSubject, width = 400): string {
	return renderBottle({
		type: SILHOUETTE[subject.type] ?? 'bordeaux',
		labelImage: subject.labelPhoto ?? undefined,
		labelFit: 'contain',
		title: [subject.producer, subject.name].filter(Boolean).join(' '),
		width,
		idPrefix: `bottle-${subject.id.replaceAll(/[^a-zA-Z0-9-]/g, '')}`
	});
}

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
