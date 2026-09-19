// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which tax-year cards exist, and who is on each.
 *
 * A card is `(year, country)` and holds EVERYONE, because a couple may file
 * separately or jointly and one joint return is one document naming both. It is
 * drawn and never stored, on the same contract lane cells already keep: what is
 * expected is computed from what the household has told us, and only the
 * corrections are rows.
 *
 * It replaces the yearly lane an employer used to seed. An annual return is one
 * filing per person per year, not one per employer — a year worked at two
 * companies is filed once, and two cards each demanding a declaration were two
 * alarms for one obligation.
 *
 * **The country comes from the year, never from the household.** A role period
 * with a Czech employer is a year a Czech return is owed; a role period with a
 * Spanish one is a Spanish year. The first cut of this crossed every country
 * the household had ever filed in with every year it had ever worked, and on a
 * real history — Spain, then Czechia, with one Polish broker report — that was
 * wrong eight cards out of twelve. An organisation with no country contributes
 * no card: a quieter failure than a card for the wrong country.
 */

/** A hand correction, from `tax_filing_override`. */
export interface TaxYearOverride {
	year: number;
	country: string;
	/** Null for the card itself rather than for one person on it. */
	personId: string | null;
	expected: boolean;
}

export interface TaxYearInput {
	/**
	 * Every role period in the household, with the country of the organisation
	 * it is with. `country` is null where the household has not said, and such
	 * a period then says nothing about which return is owed.
	 */
	engagements: {
		personId: string;
		country: string | null;
		startsOn: string | null;
		endsOn: string | null;
	}[];
	/**
	 * Filings already on record: a `tax_statement`, or a tax document dated to a
	 * year and carrying a country. `personId` is who it names, or null where it
	 * names nobody — such a filing still makes the card exist.
	 */
	filings: { personId: string | null; year: number; country: string }[];
	overrides: TaxYearOverride[];
	/** Everyone, in the order rows should read. */
	people: { id: string; name: string }[];
	thisYear: number;
}

export interface TaxYearRow {
	personId: string;
	personName: string;
}

export interface TaxYearCard {
	year: number;
	country: string;
	rows: TaxYearRow[];
}

const yearOf = (iso: string): number => Number(iso.slice(0, 4));

/**
 * The years a role period covers, capped at this one.
 *
 * A period with no start is a relationship nobody remembers the beginning of —
 * the case `engagement` documents for an office a household has always dealt
 * with — and runs from `floorYear`, the earliest year anything else on record
 * names. Without the floor it would run from nowhere.
 */
function yearsOf(
	period: { startsOn: string | null; endsOn: string | null },
	floorYear: number,
	thisYear: number
): number[] {
	const first = period.startsOn ? yearOf(period.startsOn) : floorYear;
	const last = Math.min(period.endsOn ? yearOf(period.endsOn) : thisYear, thisYear);
	const years: number[] = [];
	for (let year = first; year <= last; year++) years.push(year);
	return years;
}

export function taxYearCards(input: TaxYearInput): TaxYearCard[] {
	const engagements = input.engagements
		.map((e) => ({ ...e, country: foldCountry(e.country) }))
		.filter((e): e is typeof e & { country: string } => e.country !== null);
	const filings = input.filings
		.map((f) => ({ ...f, country: foldCountry(f.country) }))
		.filter((f): f is typeof f & { country: string } => f.country !== null);

	const dated = [
		...engagements
			.map((e) => e.startsOn)
			.filter((d): d is string => d !== null)
			.map(yearOf),
		...filings.map((f) => f.year)
	];
	const floorYear = dated.length > 0 ? Math.min(...dated) : input.thisYear;

	// A card exists for every year a role period ran in that country, for every
	// filing already on record, and for whatever somebody added by hand; a
	// card-level `expected: false` removes it whichever way it arrived.
	const wanted = new Map<string, { year: number; country: string }>();
	const want = (year: number, country: string) =>
		wanted.set(`${year} ${country}`, { year, country });
	for (const e of engagements)
		for (const year of yearsOf(e, floorYear, input.thisYear)) want(year, e.country);
	for (const f of filings) want(f.year, f.country);
	for (const o of input.overrides) {
		if (o.personId !== null) continue;
		const country = foldCountry(o.country);
		if (!country) continue;
		if (o.expected) want(o.year, country);
		else wanted.delete(`${o.year} ${country}`);
	}

	const cards = [...wanted.values()].map(({ year, country }) => {
		// Who is on THIS country's return for THIS year: a role period there
		// overlapping it, or a filing there naming them. Not "anyone employed
		// anywhere that year" — a Czech job says nothing about a Spanish return.
		const derived = new Set<string>();
		for (const e of engagements)
			if (e.country === country && yearsOf(e, floorYear, input.thisYear).includes(year))
				derived.add(e.personId);
		for (const f of filings)
			if (f.personId !== null && f.country === country && f.year === year) derived.add(f.personId);

		const forced = new Map(
			input.overrides
				.filter((o) => o.personId !== null && o.year === year && foldCountry(o.country) === country)
				.map((o) => [o.personId as string, o.expected])
		);
		const rows = input.people
			.filter((person) => forced.get(person.id) ?? derived.has(person.id))
			.map((person) => ({ personId: person.id, personName: person.name }));
		return { year, country, rows };
	});

	// Newest first, then by country: a household looking for a year is almost
	// always looking for the one that just ended.
	return cards.sort((a, b) => b.year - a.year || a.country.localeCompare(b.country));
}

/** What one person's row on a card says. */
export type TaxRowState = 'filed' | 'gap' | 'open';

/**
 * A year still running is not late.
 *
 * The same distinction `yearlyCells` draws with `not-arrived`: a cell empty
 * because nothing is owed yet must not read like one empty because something
 * never came.
 */
export function taxRowState(filedCount: number, year: number, thisYear: number): TaxRowState {
	if (filedCount > 0) return 'filed';
	return year >= thisYear ? 'open' : 'gap';
}

// ---- The two ways the tab draws the cards ----

import { ATTACHMENT_KINDS } from '$lib/tax';
import { foldCountry } from '$lib/countries';

/**
 * Whether a tax document is paper BEHIND a return rather than the return.
 *
 * The Tax screen files every attachment as `tax_document` and records what
 * each one is as a tag from `ATTACHMENT_KINDS` — an employer's earnings report,
 * a broker's report. Those support a filing; they are not one, and counting
 * them closed a gap that was still open. Read from the registry the Tax screen
 * writes, never from a second list here.
 */
const SUPPORTING_TAGS: ReadonlySet<string> = new Set(
	ATTACHMENT_KINDS.filter((kind) => kind.key === 'employer' || kind.key === 'broker').map(
		(kind) => kind.tag
	)
);

export function isSupportingPaper(tags: readonly string[]): boolean {
	return tags.some((tag) => SUPPORTING_TAGS.has(tag.trim().toLowerCase()));
}

/** One card, as the two views read it. */
export interface CardForView {
	year: number;
	country: string;
	rows: { personId: string; personName: string; state: TaxRowState }[];
}

/**
 * The household view: one cell per year and country, everybody folded in.
 *
 * `filed` when everyone who owes that return has filed, `partial` when some
 * have, `gap` when nobody has and the year is over, `open` while the year is
 * still running, and `none` where nobody owes — a blank cell is how the grid
 * says "you never had to file here".
 */
export type GridCellState = 'filed' | 'partial' | 'gap' | 'open' | 'none';

export interface GridCell {
	year: number;
	country: string;
	state: GridCellState;
	filed: number;
	owed: number;
}

export interface TaxYearGrid {
	/** Newest first. */
	years: number[];
	/** Alphabetical, by code. */
	countries: string[];
	/** Row-major: every country for the first year, then the next year. */
	cells: GridCell[];
}

function foldRows(rows: { state: TaxRowState }[]): {
	state: GridCellState;
	filed: number;
	owed: number;
} {
	const owed = rows.length;
	const filed = rows.filter((r) => r.state === 'filed').length;
	if (owed === 0) return { state: 'none', filed, owed };
	if (filed === owed) return { state: 'filed', filed, owed };
	if (filed > 0) return { state: 'partial', filed, owed };
	return { state: rows.some((r) => r.state === 'open') ? 'open' : 'gap', filed, owed };
}

export function taxYearGrid(cards: CardForView[]): TaxYearGrid {
	const years = [...new Set(cards.map((c) => c.year))].sort((a, b) => b - a);
	const countries = [...new Set(cards.map((c) => c.country))].sort();
	const byKey = new Map(cards.map((c) => [`${c.year} ${c.country}`, c]));
	const cells: GridCell[] = [];
	for (const year of years)
		for (const country of countries) {
			const card = byKey.get(`${year} ${country}`);
			cells.push({
				year,
				country,
				...(card ? foldRows(card.rows) : { state: 'none' as const, filed: 0, owed: 0 })
			});
		}
	return { years, countries, cells };
}

/**
 * The per-person view: a card per person, a lane per country they owe in,
 * cells over the household's years so every lane shares one time axis — the
 * hand-off from one country to the next reads as one lane ending where the
 * next begins.
 */
export interface PersonLaneCell {
	year: number;
	/** `none` where this person owes nothing there that year. */
	state: TaxRowState | 'none';
}

export interface PersonLane {
	country: string;
	cells: PersonLaneCell[];
	filed: number;
	gaps: number;
}

export interface PersonBreakdown {
	personId: string;
	personName: string;
	lanes: PersonLane[];
}

export function taxYearsByPerson(cards: CardForView[], years: number[]): PersonBreakdown[] {
	const people = new Map<string, string>();
	for (const card of cards) for (const row of card.rows) people.set(row.personId, row.personName);

	return [...people.entries()]
		.sort((a, b) => a[1].localeCompare(b[1]))
		.map(([personId, personName]) => {
			const countries = [
				...new Set(
					cards.filter((c) => c.rows.some((r) => r.personId === personId)).map((c) => c.country)
				)
			].sort();
			const lanes = countries.map((country) => {
				const cells = years.map((year) => {
					const row = cards
						.find((c) => c.year === year && c.country === country)
						?.rows.find((r) => r.personId === personId);
					return { year, state: row ? row.state : ('none' as const) };
				});
				return {
					country,
					cells,
					filed: cells.filter((c) => c.state === 'filed').length,
					gaps: cells.filter((c) => c.state === 'gap').length
				};
			});
			return { personId, personName, lanes };
		});
}
