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
		/**
		 * Which organisation the period is with, so a card can name what raised
		 * it. Optional: the derivation worked before the screen asked why, and a
		 * caller that cannot say produces a card with an unnamed reason rather
		 * than no card.
		 */
		organisationId?: string;
		organisationName?: string;
		organisationKind?: string;
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
	/**
	 * Rows on `tax_residence`: where somebody SAID they lived, and for which part
	 * of the year. Two rows in one year are the halves of a year they moved in.
	 */
	residenceDeclarations?: {
		personId: string;
		year: number;
		country: string;
		fromOn: string | null;
		toOn: string | null;
	}[];
	/**
	 * Statements marked `role = 'residence'` — the return somebody filed because
	 * they lived there. A statement marked `source` is deliberately absent: it
	 * proves income arose in a country, never that anybody lived in it.
	 */
	residenceStatements?: { personId: string; year: number; country: string }[];
	/**
	 * `person.citizenship`, by person id. The floor under the derivation.
	 *
	 * Absent or null contributes NOTHING, which is the safe default and not an
	 * oversight: until a household records citizenship, a year with no paper and
	 * no work raises no card, exactly as it did before this existed. The tier
	 * switches itself on when somebody answers.
	 */
	citizenship?: Record<string, string | null>;
	/**
	 * `person.birth_year`, by person id. Bounds the citizenship tier for somebody
	 * with no paper and no work of their own: a household's earliest year is not
	 * a year every member of it owed a return for.
	 */
	birthYears?: Record<string, number | null>;
}

export interface TaxYearRow {
	personId: string;
	personName: string;
}

/**
 * What raised this card — the one thing a drawn card could not say before.
 *
 * The screen offers exactly one way out of an obligation that does not involve
 * filing anything: end the role period that created it. It can only offer that
 * if the card remembers which period it was, which is why the reason carries
 * the organisation rather than just the word "employment".
 *
 * `personId` is null only on `added`, the correction that belongs to the card
 * itself rather than to anybody on it.
 */
export interface TaxYearReason {
	source: 'engagement' | 'filing' | 'residence' | 'added';
	personId: string | null;
	country: string;
	organisationId?: string;
	organisationName?: string;
	organisationKind?: string;
	/** On `residence`: which tier said so, so the panel can say how it knows. */
	evidence?: ResidenceEvidence;
}

/**
 * Which return this is, for the caption under a cell.
 *
 * `residence` is the return owed for having LIVED there; `source` is the one a
 * country wanted because income arose in it — a Polish broker while resident in
 * Czechia. Telling those two apart is the difference between chasing a resident
 * form and a non-resident one.
 *
 * `unclear` is the year somebody MOVED: two countries from one tier and nothing
 * filed, so both owe something and neither may claim to be THE return until the
 * date is said. `unknown` is the different, quieter case of a household that has
 * recorded no residence evidence at all — no citizenship, no statement, no
 * country on an employer. Those must not share a word: "residence unclear" on
 * every cell of a fresh instance is an alarm about a move that never happened.
 */
export type TaxReturnKind = 'residence' | 'source' | 'unclear' | 'unknown';

export interface TaxYearCard {
	year: number;
	country: string;
	rows: TaxYearRow[];
	reasons: TaxYearReason[];
	returnKind: TaxReturnKind;
	/**
	 * The countries this year is torn between, where `returnKind` is `unclear`;
	 * empty otherwise.
	 *
	 * Carried rather than re-derived, because the screen that offers "two
	 * returns, one per country" has to NAME them — and deciding a second time
	 * whether a year is torn is how one panel came to disagree with the cell it
	 * was opened from.
	 */
	candidates: string[];
}

const yearOf = (iso: string): number => Number(iso.slice(0, 4));

/**
 * The years a role period covers, capped at this one.
 *
 * Exported because it is the rule for reading a span off a role period, and the
 * screens draw spans from the same periods this derivation counts them from.
 *
 * A period with no start is a relationship nobody remembers the beginning of —
 * the case `engagement` documents for an office a household has always dealt
 * with — and runs from `floorYear`, the earliest year anything else on record
 * names. Without the floor it would run from nowhere.
 */
export function yearsOf(
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

/** The folded inputs and the year span, shared by the two things that read them. */
function prepare(input: TaxYearInput) {
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
	return { engagements, filings, floorYear, thisYear: input.thisYear };
}

/** One person's residence in one year, with the tier that settled it. */
export interface ResolvedResidence {
	personId: string;
	year: number;
	residence: Residence;
}

/**
 * Where everyone lived, year by year, across the span the cards cover.
 *
 * Resolved HERE rather than on the server so the whole chain is one pure
 * function over one payload — and so the year span the cards already compute is
 * the span residence is asked about, instead of a second opinion about which
 * years exist.
 *
 * Every year is resolved on its own evidence; `residenceForYear` has no
 * parameter for the year before it. See the module note in `$lib/tax-residence`
 * for why that absence is the design rather than an omission.
 */
export function taxResidences(input: TaxYearInput): ResolvedResidence[] {
	const { engagements, filings, floorYear, thisYear } = prepare(input);
	const fold = <T extends { country: string }>(rows: readonly T[]) =>
		rows
			.map((row) => ({ ...row, country: foldCountry(row.country) }))
			.filter((row): row is T & { country: string } => row.country !== null);
	const declarations = fold(input.residenceDeclarations ?? []);
	const statements = fold(input.residenceStatements ?? []);

	/**
	 * The first year THIS person can owe anything.
	 *
	 * The household floor is the earliest engagement or filing across everybody,
	 * and the citizenship tier answers every year it is asked about — so without
	 * a per-person floor, somebody added to the household in 2025 acquires a
	 * never-filed return for every year back to a housemate's first job in 2015.
	 * Nothing about them says they owed one.
	 *
	 * Their own earliest evidence, then: a role period, a filing, a declaration,
	 * or the year they were born. A person with none of those is asked about no
	 * year at all rather than about all of them.
	 */
	const own = (personId: string): number | null => {
		const years = [
			...engagements
				.filter((e) => e.personId === personId && e.startsOn !== null)
				.map((e) => yearOf(e.startsOn as string)),
			...filings.filter((f) => f.personId === personId).map((f) => f.year),
			...declarations.filter((row) => row.personId === personId).map((row) => row.year),
			...statements.filter((row) => row.personId === personId).map((row) => row.year),
			...(input.birthYears?.[personId] ? [input.birthYears[personId] as number] : [])
		];
		return years.length > 0 ? Math.min(...years) : null;
	};

	const resolved: ResolvedResidence[] = [];
	for (const person of input.people) {
		// Nothing at all on record for them: asked about THIS year and no earlier
		// one. Citizenship answers whatever it is asked, so an unbounded question
		// turns "we know they are Czech" into "they owe a decade of returns" —
		// while the year in progress is one they really are resident for, and is
		// the gap year this tier exists to raise.
		const from = own(person.id) ?? thisYear;
		for (let year = Math.max(floorYear, from); year <= thisYear; year++)
			resolved.push({
				personId: person.id,
				year,
				residence: residenceForYear({
					declared: declarations
						.filter((row) => row.personId === person.id && row.year === year)
						.map((row) => ({ country: row.country, fromOn: row.fromOn, toOn: row.toOn })),
					statementCountries: statements
						.filter((row) => row.personId === person.id && row.year === year)
						.map((row) => row.country),
					employmentCountries: engagements
						.filter(
							(e) => e.personId === person.id && yearsOf(e, floorYear, thisYear).includes(year)
						)
						.map((e) => e.country),
					citizenship: input.citizenship?.[person.id] ?? null
				})
			});
	}
	return resolved;
}

/**
 * @param resolved Residence already worked out for this same input, where the
 * caller has it. The payload sends residence to the screen beside the cards, so
 * without this it is resolved twice from one input — the same answer, computed
 * again, with the standing risk of the two readings drifting apart.
 */
export function taxYearCards(
	input: TaxYearInput,
	resolved?: readonly ResolvedResidence[]
): TaxYearCard[] {
	const { engagements, filings, floorYear } = prepare(input);
	const residences = resolved ?? taxResidences(input);

	// A card exists for every year a role period ran in that country, for every
	// filing already on record, and for whatever somebody added by hand; a
	// card-level `expected: false` removes it whichever way it arrived.
	const wanted = new Map<string, { year: number; country: string }>();
	const want = (year: number, country: string) =>
		wanted.set(`${year} ${country}`, { year, country });
	for (const e of engagements)
		for (const year of yearsOf(e, floorYear, input.thisYear)) want(year, e.country);
	for (const f of filings) want(f.year, f.country);
	// Residence raises a card on its own. A return is owed for having LIVED
	// somewhere, not for having earned there, so this is the only source that can
	// put up the year with no role period and no filing — a break, unpaid leave,
	// a year between jobs — which is exactly the year that used to disappear.
	for (const resolved of residences)
		for (const period of resolved.residence.periods) want(resolved.year, period.country);
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
		for (const resolved of residences)
			if (
				resolved.year === year &&
				resolved.residence.periods.some((period) => period.country === country)
			)
				derived.add(resolved.personId);

		const forced = new Map(
			input.overrides
				.filter((o) => o.personId !== null && o.year === year && foldCountry(o.country) === country)
				.map((o) => [o.personId as string, o.expected])
		);
		const rows = input.people
			.filter((person) => forced.get(person.id) ?? derived.has(person.id))
			.map((person) => ({ personId: person.id, personName: person.name }));

		// Why this card is here, in the order the panel wants to offer it: the role
		// period first, because ending one is the only way out that files nothing.
		const reasons: TaxYearReason[] = [];
		for (const e of engagements)
			if (e.country === country && yearsOf(e, floorYear, input.thisYear).includes(year))
				reasons.push({
					source: 'engagement',
					personId: e.personId,
					country,
					organisationId: e.organisationId,
					organisationName: e.organisationName,
					organisationKind: e.organisationKind
				});
		for (const f of filings)
			if (f.country === country && f.year === year)
				reasons.push({ source: 'filing', personId: f.personId, country });
		// Whose residence, and which tier said so: "because you lived there" is a
		// different sentence from "because a statement says you did".
		const here = residences.filter(
			(r) => r.year === year && r.residence.periods.some((p) => p.country === country)
		);
		for (const r of here)
			reasons.push({
				source: 'residence',
				personId: r.personId,
				country,
				evidence: r.residence.evidence
			});
		if (reasons.length === 0) reasons.push({ source: 'added', personId: null, country });

		// A year no tier could call leaves BOTH countries owing something, so
		// neither is the residence return yet — ambiguity outranks the country
		// being in the list, because the employment tier puts both in it. But only
		// a tier that offered a CHOICE is unclear; one that offered nothing at all
		// leaves the question unanswered rather than contested.
		const thisYearsResidences = residences.filter((r) => r.year === year);
		const judged = here.length > 0 ? here : thisYearsResidences;
		const torn = judged.some((r) => r.residence.ambiguous && r.residence.candidates.length > 1);
		const anywhere = thisYearsResidences.some((r) => r.residence.periods.length > 0);
		const returnKind: TaxReturnKind = torn
			? 'unclear'
			: here.length > 0
				? 'residence'
				: anywhere
					? 'source'
					: 'unknown';
		return {
			year,
			country,
			rows,
			reasons,
			returnKind,
			candidates: torn ? [...new Set(judged.flatMap((r) => r.residence.candidates))].sort() : []
		};
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
import { residenceForYear, type Residence, type ResidenceEvidence } from '$lib/tax-residence';

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
 * The paper on one card, listed once.
 *
 * A joint return sits on two people's rows and is one document; a card that
 * counted it twice would report more filings than the household owns. Both
 * views ask this, so it is answered here rather than in each of them.
 */
export function cardPaper<D extends { id: string }>(card: {
	rows: { documents: D[] }[];
	supporting: D[];
}): D[] {
	const seen = new Set<string>();
	const paper: D[] = [];
	for (const doc of [...card.rows.flatMap((row) => row.documents), ...card.supporting])
		if (!seen.has(doc.id)) {
			seen.add(doc.id);
			paper.push(doc);
		}
	return paper;
}

/** How many pieces of paper a cell would list, for the count it carries. */
export function paperCount(card: {
	rows: { documents: { id: string }[] }[];
	supporting: { id: string }[];
}): number {
	return cardPaper(card).length;
}

/**
 * The caption under a cell: which return it is about.
 *
 * `unknown` is deliberately silent. A household that has recorded no residence
 * anywhere would otherwise read a move alarm on every cell it owns — see
 * `TaxReturnKind`.
 */
const RETURN_KIND_WORDS: Record<TaxReturnKind, string> = {
	residence: 'residence return',
	source: 'second return',
	unclear: 'residence unclear',
	unknown: ''
};

export function returnKindWords(kind: TaxReturnKind | undefined): string {
	return kind ? RETURN_KIND_WORDS[kind] : '';
}

/**
 * Five words for five states. "not due yet" is not "never filed", and a screen
 * that used one for the other would send somebody chasing paper nobody owes.
 */
export const STATE_WORDS: Record<GridCellState, string> = {
	filed: 'filed',
	partial: 'partly filed',
	gap: 'never filed',
	open: 'not due yet',
	none: 'nothing owed'
};

/**
 * One card folded to a state, the same way the grid folds it.
 *
 * The grid already holds this for every cell it draws, and `TimelineView` reads
 * it there. This is for the two places holding a card without the grid around
 * it — a year's dossier row, and an opened obligation.
 */
export function cardState(card: { rows: { state: TaxRowState }[] }): GridCellState {
	return foldRows(card.rows).state;
}
